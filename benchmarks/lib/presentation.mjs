/**
 * Pure presentation-metric helpers for the real-playground benchmark.
 *
 * Chrome/Perfetto emits one `FrameSequenceTrackerV3` track per frame sequence
 * (WheelScroll, RAF, ...). Counters are
 * cumulative per track and are only comparable inside the same sequence name.
 * Real Chrome JSON puts them on the async BEGIN (`args.args.data`) and emits an
 * empty END, so begin payloads are authoritative. This module therefore:
 *   - groups strictly by sequence type;
 *   - sums only non-overlapping segments of the same type;
 *   - treats a forked/backfilled overlapping segment as a duplicate, not as
 *     another contribution;
 *   - returns null (never 0) when a counter is absent or unsupported.
 *
 * It deliberately does not expose an "all sequences" total: adding WheelScroll
 * to RAF/JSAnimation would not describe native scrolling.
 */

export const FRAME_SEQUENCE_EVENT = 'FrameSequenceTrackerV3';
export const NATIVE_SCROLL_SEQUENCE = 'WheelScroll';

const COUNTER_KEYS = [
  'expected',
  'dropped_v3',
  'dropped_v4',
  'missing_content',
  'checkerboarded',
  'checkerboarded_need_raster',
  'checkerboarded_need_record',
];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOrNull(value) {
  return isFiniteNumber(value) ? value : null;
}

function extractEvents(input) {
  if (input == null) throw new Error('trace is null/undefined');
  if (Buffer.isBuffer(input)) input = input.toString('utf8');
  if (typeof input === 'string') input = JSON.parse(input);
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.traceEvents)) return input.traceEvents;
  if (Array.isArray(input.value)) return input.value;
  if (Array.isArray(input.events)) return input.events;
  throw new Error('trace does not contain a traceEvents/value/events array');
}

function eventData(event) {
  const args = event?.args ?? {};
  // Chrome's trace JSON wraps NamedTrack payloads once more:
  //   args.args = { name: 'WheelScroll', data: { expected, dropped_v4, ... } }
  // Older/synthetic events use args or args.data directly.
  if (args.args && typeof args.args === 'object') {
    const nested = args.args;
    if (nested.data && typeof nested.data === 'object') return nested.data;
    return nested;
  }
  const data = args.data && typeof args.data === 'object' ? args.data : args;
  return data.values && typeof data.values === 'object' ? data.values : data;
}

function eventType(event) {
  const args = event?.args ?? {};
  const nested = args.args && typeof args.args === 'object' ? args.args : {};
  const data = eventData(event);
  const candidates = [
    nested.name,
    args.name,
    nested.trackName,
    args.trackName,
    nested.track_name,
    args.track_name,
    nested.tracker_type,
    args.tracker_type,
    nested.trackerType,
    args.trackerType,
    data.sequence,
    data.sequence_name,
    data.sequenceName,
    data.tracker_type,
    data.trackerType,
    nested.sequence,
    args.sequence,
    nested.sequence_name,
    args.sequence_name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length) return candidate;
  }
  return null;
}

function countersFrom(event) {
  const data = eventData(event);
  const values = {};
  for (const key of COUNTER_KEYS) {
    values[key] = numberOrNull(data?.[key]);
  }
  return values;
}

function hasAnyCounter(counters) {
  return COUNTER_KEYS.some(key => counters[key] !== null);
}

function eventKey(event) {
  return `${event.pid ?? 0}:${event.tid ?? 0}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function asyncKey(event) {
  const id = event.id2 ?? event.id;
  if (id == null) return null;
  // id2 is an object such as { local: '0x28' } or { scope: 'global', local: ... }.
  // String interpolation yields "[object Object]" and mixes concurrent Wheel /
  // Canvas trackers. Serialize its scope/value, plus process/thread/namespace/
  // category, so identical local ids in different scopes cannot be paired.
  return JSON.stringify({
    pid: event.pid ?? null,
    tid: event.tid ?? null,
    cat: event.cat ?? null,
    namespace: event.args?.namespace ?? event.namespace ?? null,
    id: canonicalize(id),
  });
}

function parentEvent(event) {
  return typeof event?.name === 'string' &&
    event.name.startsWith(FRAME_SEQUENCE_EVENT);
}

function frameEvent(event) {
  return typeof event?.name === 'string' && event.name.trim() === 'Frame';
}

function makeSlice(begin, end, type, warnings) {
  const beginCounters = begin?.counters ?? {};
  const endCounters = end ? countersFrom(end) : {};
  const nested = begin?.lastFrame?.data ?? {};
  const nestedCounters = {};
  for (const key of COUNTER_KEYS) nestedCounters[key] = numberOrNull(nested[key]);

  const counters = {};
  for (const key of COUNTER_KEYS) {
    counters[key] = endCounters[key] ?? beginCounters[key] ?? nestedCounters[key] ?? null;
  }

  const startTs = numberOrNull(begin?.ts);
  const endTs = numberOrNull(end?.ts) ?? numberOrNull(begin?.lastFrame?.ts) ?? startTs;
  const durationMs = startTs !== null && endTs !== null && endTs >= startTs
    ? (endTs - startTs) / 1000
    : null;

  // Real Chrome traces put the cumulative payload on the async BEGIN
  // (`args.args.data`) and leave the END args empty. The begin payload is the
  // complete segment only because a BEGIN was emitted with counters; do not
  // require end counters.
  const complete = counters.expected !== null && end !== null;
  if (!complete && end) warnings.push(`${type}: begin/termination counters missing; used last nested Frame`);
  if (!end) warnings.push(`${type}: sequence has no FrameSequenceTrackerV3 end event`);

  return {
    type: type ?? 'Unknown',
    pid: begin?.pid ?? end?.pid ?? 0,
    tid: begin?.tid ?? end?.tid ?? 0,
    startTs,
    endTs,
    durationMs,
    expected: counters.expected,
    droppedV3: counters.dropped_v3,
    droppedV4: counters.dropped_v4,
    missingContent: counters.missing_content,
    checkerboarded: counters.checkerboarded,
    checkerboardedNeedRaster: counters.checkerboarded_need_raster,
    checkerboardedNeedRecord: counters.checkerboarded_need_record,
    complete,
    terminated: Boolean(end),
    lastFrameTs: numberOrNull(begin?.lastFrame?.ts),
  };
}

function attachNestedFrame(active, event) {
  const key = asyncKey(event);
  const entry = [...active].reverse().find(parent => key !== null
    ? parent.asyncKey === key
    : parent.pid === event.pid && parent.tid === event.tid);
  if (!entry) return;
  // Frame END has no payload. Preserve the cumulative BEGIN counters while
  // extending the timestamp through presentation; concurrent trackers use id2.
  const data = countersFrom(event);
  if (hasAnyCounter(data)) entry.lastFrame = { ts: numberOrNull(event.ts), data };
  else if (entry.lastFrame) entry.lastFrame.ts = numberOrNull(event.ts) ?? entry.lastFrame.ts;
}

function slicesOverlap(a, b) {
  if (a.startTs === null || a.endTs === null || b.startTs === null || b.endTs === null) {
    return false;
  }
  return Math.min(a.endTs, b.endTs) > Math.max(a.startTs, b.startTs);
}

function sameCounters(a, b) {
  return COUNTER_KEYS.every(key => {
    if (key === 'dropped_v3') return a.droppedV3 === b.droppedV3;
    if (key === 'dropped_v4') return a.droppedV4 === b.droppedV4;
    if (key === 'missing_content') return a.missingContent === b.missingContent;
    if (key === 'checkerboarded_need_raster') {
      return a.checkerboardedNeedRaster === b.checkerboardedNeedRaster;
    }
    if (key === 'checkerboarded_need_record') {
      return a.checkerboardedNeedRecord === b.checkerboardedNeedRecord;
    }
    return a[key] === b[key];
  });
}

function moreComplete(candidate, current) {
  const candidateExpected = candidate.expected ?? -1;
  const currentExpected = current.expected ?? -1;
  if (candidateExpected !== currentExpected) return candidateExpected > currentExpected;
  if (candidate.terminated !== current.terminated) return candidate.terminated;
  const candidateDuration = candidate.durationMs ?? -1;
  const currentDuration = current.durationMs ?? -1;
  return candidateDuration > currentDuration;
}

/**
 * Keep exactly one segment per overlapping cluster of the same sequence name.
 * Non-overlapping segments are preserved and later summed.
 */
function dedupeSlices(slices, warnings) {
  const sorted = [...slices].sort((a, b) => {
    const at = a.startTs ?? Number.POSITIVE_INFINITY;
    const bt = b.startTs ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return (a.endTs ?? at) - (b.endTs ?? bt);
  });
  const kept = [];
  for (const slice of sorted) {
    const overlapIndex = kept.findIndex(other => slicesOverlap(other, slice));
    if (overlapIndex < 0) {
      kept.push(slice);
      continue;
    }
    const current = kept[overlapIndex];
    const duplicate = sameCounters(current, slice) ||
      (current.startTs <= slice.startTs && current.endTs >= slice.endTs) ||
      (slice.startTs <= current.startTs && slice.endTs >= current.endTs);
    if (duplicate) {
      warnings.push(
        `${slice.type}: ignored overlapping duplicate/backfill segment ` +
        `[${slice.startTs}, ${slice.endTs}]`,
      );
    } else {
      warnings.push(
        `${slice.type}: overlapping segments with different counters; kept one ` +
        `(fork/backfill segments are not addable)`,
      );
    }
    if (moreComplete(slice, current)) kept[overlapIndex] = slice;
  }
  return kept;
}

function unionDurationMs(slices) {
  const ranges = slices
    .filter(slice => slice.startTs !== null && slice.endTs !== null)
    .map(slice => [slice.startTs, slice.endTs])
    .sort((a, b) => a[0] - b[0]);
  if (!ranges.length) return null;
  let total = 0;
  let [start, end] = ranges[0];
  for (const [nextStart, nextEnd] of ranges.slice(1)) {
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  total += end - start;
  return total / 1000;
}

function sumOrNull(slices, field) {
  if (!slices.length) return null;
  let total = 0;
  for (const slice of slices) {
    if (slice[field] === null) return null;
    total += slice[field];
  }
  return total;
}

function aggregateType(type, slices) {
  const activeMs = unionDurationMs(slices);
  const expected = sumOrNull(slices, 'expected');
  const droppedV3 = sumOrNull(slices, 'droppedV3');
  const droppedV4 = sumOrNull(slices, 'droppedV4');
  const missingContent = sumOrNull(slices, 'missingContent');
  const checkerboarded = sumOrNull(slices, 'checkerboarded');
  const checkerboardedNeedRaster = sumOrNull(slices, 'checkerboardedNeedRaster');
  const checkerboardedNeedRecord = sumOrNull(slices, 'checkerboardedNeedRecord');
  const validFrameCount = expected !== null && droppedV4 !== null
    ? expected - droppedV4
    : null;
  const validFps = validFrameCount !== null && activeMs !== null && activeMs > 0
    ? validFrameCount / (activeMs / 1000)
    : null;
  const badFrameRatio = expected !== null && expected > 0 && droppedV4 !== null
    ? droppedV4 / expected
    : null;
  const missingContentRatio =
    expected !== null && expected > 0 && missingContent !== null
      ? missingContent / expected
      : null;

  return {
    sequenceType: type,
    sequenceCount: slices.length,
    complete: slices.every(slice => slice.complete),
    expected,
    droppedV3,
    droppedV4,
    missingContent,
    checkerboarded,
    checkerboardedNeedRaster,
    checkerboardedNeedRecord,
    activeMs,
    validFrameCount,
    validFps,
    badFrameRatio,
    missingContentRatio,
    segments: slices.map(slice => ({ ...slice })),
  };
}

/**
 * Parse a Chrome trace object/string. The return value intentionally contains
 * no cross-type total. `byType[WheelScroll]` is the native-scroll evidence.
 */
export function parseTrace(input) {
  const events = extractEvents(input);
  const warnings = [];
  const slices = [];
  const syncStacks = new Map();
  const asyncStarts = new Map();
  const activeParents = [];

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (parentEvent(event)) {
      const key = asyncKey(event);
      const phase = event.ph;
      if ((phase === 'b' || phase === 'B') && key !== null && phase === 'b') {
        const begin = {
          type: eventType(event),
          ts: numberOrNull(event.ts),
          pid: event.pid,
          tid: event.tid,
          lastFrame: null,
          counters: countersFrom(event),
          asyncKey: key,
        };
        if (!asyncStarts.has(key)) asyncStarts.set(key, []);
        asyncStarts.get(key).push(begin);
        activeParents.push(begin);
      } else if ((phase === 'e' || phase === 'E') && key !== null && phase === 'e') {
        const stack = asyncStarts.get(key);
        const begin = stack?.pop();
        if (stack && !stack.length) asyncStarts.delete(key);
        const index = begin ? activeParents.indexOf(begin) : -1;
        if (index >= 0) activeParents.splice(index, 1);
        if (!begin) {
          warnings.push('FrameSequenceTrackerV3: end event without matching async begin');
          continue;
        }
        slices.push(makeSlice(begin, event, begin.type ?? eventType(event), warnings));
      } else if (phase === 'B') {
        const stackKey = eventKey(event);
        const begin = {
          type: eventType(event),
          ts: numberOrNull(event.ts),
          pid: event.pid,
          tid: event.tid,
          lastFrame: null,
          counters: countersFrom(event),
        };
        if (!syncStacks.has(stackKey)) syncStacks.set(stackKey, []);
        syncStacks.get(stackKey).push(begin);
        activeParents.push(begin);
      } else if (phase === 'E') {
        const stackKey = eventKey(event);
        const stack = syncStacks.get(stackKey) ?? [];
        const begin = stack.pop();
        const index = begin ? activeParents.indexOf(begin) : -1;
        if (index >= 0) activeParents.splice(index, 1);
        if (!begin) {
          warnings.push('FrameSequenceTrackerV3: end event without matching begin');
          continue;
        }
        slices.push(makeSlice(begin, event, begin.type ?? eventType(event), warnings));
      } else if (phase === 'X') {
        const startTs = numberOrNull(event.ts);
        const durationUs = numberOrNull(event.dur);
        const begin = {
          type: eventType(event),
          ts: startTs,
          pid: event.pid,
          tid: event.tid,
          lastFrame: null,
          counters: countersFrom(event),
        };
        const end = {
          ...event,
          ts: startTs !== null && durationUs !== null ? startTs + durationUs : startTs,
        };
        slices.push(makeSlice(begin, end, begin.type ?? eventType(event), warnings));
      }
      continue;
    }
    if (frameEvent(event)) attachNestedFrame(activeParents, event);
  }

  // A trace can be stopped while a sequence is still active. Preserve its last
  // nested cumulative counters, but mark it incomplete so callers do not
  // mistake a null missing_content for zero.
  for (const begin of [...syncStacks.values()].flat()) {
    slices.push(makeSlice(begin, null, begin.type, warnings));
  }
  for (const stack of asyncStarts.values()) {
    for (const begin of stack) slices.push(makeSlice(begin, null, begin.type, warnings));
  }

  const byType = {};
  const types = new Map();
  for (const slice of slices) {
    if (!types.has(slice.type)) types.set(slice.type, []);
    types.get(slice.type).push(slice);
  }
  for (const [type, typeSlices] of types) {
    const kept = dedupeSlices(typeSlices, warnings);
    byType[type] = aggregateType(type, kept);
  }

  return {
    eventCount: events.length,
    sequenceCount: slices.length,
    sequences: slices,
    byType,
    wheelScroll: byType[NATIVE_SCROLL_SEQUENCE] ?? null,
    warnings,
  };
}

/**
 * Thresholds use the benchmark's explicit definition:
 *   validFps = (expected - dropped_v4) / active sequence seconds
 *   badFrameRatio = dropped_v4 / expected
 * Missing counters make every derived value null and the gate fails.
 */
export function evaluateThresholds(metrics, options = {}) {
  const minValidFps = options.minValidFps ?? 59;
  const maxBadFrameRatio = options.maxBadFrameRatio ?? 0.01;
  const requireNoMissingContent = options.requireNoMissingContent ?? true;
  const failures = [];

  if (!metrics) {
    return {
      pass: false,
      status: 'fail',
      failures: ['frame sequence is missing'],
      metrics: {
        validFps: null,
        badFrameRatio: null,
        missingContent: null,
        missingContentRatio: null,
        expected: null,
      },
      thresholds: { minValidFps, maxBadFrameRatio, requireNoMissingContent },
    };
  }

  if (metrics.complete === false) failures.push('frame sequence is incomplete');

  if (metrics.validFps === null || !isFiniteNumber(metrics.validFps)) {
    failures.push('validFps is unavailable');
  } else if (metrics.validFps < minValidFps) {
    failures.push(`validFps ${metrics.validFps.toFixed(2)} < ${minValidFps}`);
  }

  if (metrics.badFrameRatio === null || !isFiniteNumber(metrics.badFrameRatio)) {
    failures.push('badFrameRatio is unavailable');
  } else if (metrics.badFrameRatio > maxBadFrameRatio) {
    failures.push(
      `badFrameRatio ${(metrics.badFrameRatio * 100).toFixed(3)}% > ` +
      `${(maxBadFrameRatio * 100).toFixed(1)}%`,
    );
  }

  if (metrics.missingContent === null || !isFiniteNumber(metrics.missingContent)) {
    if (requireNoMissingContent) failures.push('missing_content is unavailable');
  } else if (metrics.missingContent > 0) {
    failures.push(`missing_content ${metrics.missingContent} > 0`);
  }

  return {
    pass: failures.length === 0,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    metrics: {
      validFps: numberOrNull(metrics.validFps),
      badFrameRatio: numberOrNull(metrics.badFrameRatio),
      missingContent: numberOrNull(metrics.missingContent),
      missingContentRatio: numberOrNull(metrics.missingContentRatio),
      expected: numberOrNull(metrics.expected),
      droppedV4: numberOrNull(metrics.droppedV4),
      activeMs: numberOrNull(metrics.activeMs),
      complete: Boolean(metrics.complete),
      sequenceCount: numberOrNull(metrics.sequenceCount),
    },
    thresholds: { minValidFps, maxBadFrameRatio, requireNoMissingContent },
  };
}

/**
 * Evaluate one named sequence. The caller chooses the name explicitly; this
 * function never falls back to another animation type.
 */
export function evaluateSequence(parsed, sequenceType, options = {}) {
  const metrics = parsed?.byType?.[sequenceType] ?? null;
  return {
    sequenceType,
    role: options.role ?? sequenceType,
    present: metrics !== null,
    metrics,
    thresholds: evaluateThresholds(metrics, options),
  };
}
