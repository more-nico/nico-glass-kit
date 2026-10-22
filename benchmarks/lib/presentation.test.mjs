import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSequence,
  evaluateThresholds,
  parseTrace,
} from './presentation.mjs';

function begin(type, ts, extra = {}) {
  return {
    name: 'FrameSequenceTrackerV3',
    cat: 'cc,benchmark',
    ph: 'B',
    pid: 7,
    tid: 9,
    ts,
    args: { name: type },
    ...extra,
  };
}

function end(ts, data, extra = {}) {
  return {
    name: 'FrameSequenceTrackerV3',
    cat: 'cc,benchmark',
    ph: 'E',
    pid: 7,
    tid: 9,
    ts,
    args: { data },
    ...extra,
  };
}

function nested(ts, data) {
  return {
    name: 'Frame',
    cat: 'cc,benchmark',
    ph: 'B',
    pid: 7,
    tid: 9,
    ts,
    args: { data },
  };
}

function counters(overrides = {}) {
  return {
    expected: 60,
    dropped_v3: 0,
    dropped_v4: 0,
    missing_content: 0,
    checkerboarded: 0,
    checkerboarded_need_raster: 0,
    checkerboarded_need_record: 0,
    ...overrides,
  };
}

function segment(type, startTs, endTs, values = counters()) {
  return [begin(type, startTs), end(endTs, values)];
}

// Real Chrome/Perfetto schema: async b/e, cumulative counters on BEGIN under
// args.args.data, empty END args, and id2 objects. Keep these tests independent
// from the older synthetic args.data schema.
function realCounters(expected, droppedV4, missingContent) {
  return {
    checkerboarded: missingContent,
    checkerboarded_need_raster: missingContent,
    checkerboarded_need_record: 0,
    dropped_v3: 0,
    dropped_v4: droppedV4,
    expected,
    missing_content: missingContent,
  };
}

function realBegin(type, ts, id2, data = null) {
  return {
    name: 'FrameSequenceTrackerV3',
    cat: 'cc,benchmark',
    ph: 'b',
    pid: 73084,
    tid: 19200796,
    ts,
    id2,
    args: { args: data ? { name: type, data } : { name: type } },
  };
}

function realEnd(ts, id2) {
  return {
    name: 'FrameSequenceTrackerV3',
    cat: 'cc,benchmark',
    ph: 'e',
    pid: 73084,
    tid: 19200796,
    ts,
    id2,
    args: {},
  };
}

test('real trace schema: begin counters, empty end, interleaved id2 locals', () => {
  const parsed = parseTrace({ traceEvents: [
    realBegin('WheelScroll', 1_000_000, { local: '0x28' }, realCounters(107, 66, 103)),
    realBegin('CanvasAnimation', 1_100_000, { local: '0x3d' }, realCounters(81, 50, 68)),
    realEnd(2_000_000, { local: '0x3d' }),
    realEnd(2_100_000, { local: '0x28' }),
    realBegin('CanvasAnimation', 2_200_000, { local: '0x3d' }, realCounters(144, 94, 127)),
    realEnd(3_200_000, { local: '0x3d' }),
  ] });

  assert.equal(parsed.byType.WheelScroll.sequenceCount, 1);
  assert.equal(parsed.byType.WheelScroll.expected, 107);
  assert.equal(parsed.byType.WheelScroll.droppedV4, 66);
  assert.equal(parsed.byType.WheelScroll.missingContent, 103);
  assert.equal(parsed.byType.WheelScroll.complete, true);
  assert.equal(parsed.byType.CanvasAnimation.sequenceCount, 2);
  assert.equal(parsed.byType.CanvasAnimation.expected, 225);
  assert.equal(parsed.byType.CanvasAnimation.droppedV4, 144);
  assert.equal(parsed.byType.CanvasAnimation.missingContent, 195);
  // Canvas must never be added into the WheelScroll total.
  assert.equal(parsed.wheelScroll.expected, 107);
});

test('real trace schema: same local id is safe to reuse and scope-separated', () => {
  const parsed = parseTrace({ traceEvents: [
    realBegin('WheelScroll', 1_000_000, { scope: 'global', local: '0x28' }, realCounters(107, 66, 103)),
    realBegin('CanvasAnimation', 1_050_000, { scope: 'local', local: '0x28' }, realCounters(81, 50, 68)),
    realEnd(2_000_000, { scope: 'local', local: '0x28' }),
    realEnd(2_100_000, { scope: 'global', local: '0x28' }),
    // Reuse the same local id after the first sequence ended.
    realBegin('WheelScroll', 2_200_000, { scope: 'global', local: '0x28' }, realCounters(109, 61, 96)),
    realEnd(3_300_000, { scope: 'global', local: '0x28' }),
  ] });

  assert.equal(parsed.byType.WheelScroll.sequenceCount, 2);
  assert.equal(parsed.byType.WheelScroll.expected, 216);
  assert.equal(parsed.byType.WheelScroll.droppedV4, 127);
  assert.equal(parsed.byType.WheelScroll.missingContent, 199);
  assert.deepEqual(
    parsed.byType.WheelScroll.segments.map(segment => segment.expected),
    [107, 109],
  );
  assert.deepEqual(
    parsed.byType.WheelScroll.segments.map(segment => segment.droppedV4),
    [66, 61],
  );
  assert.deepEqual(
    parsed.byType.WheelScroll.segments.map(segment => segment.missingContent),
    [103, 96],
  );
  assert.equal(parsed.byType.CanvasAnimation.expected, 81);
});

test('real nested Frame values follow their tracker and survive empty ends', () => {
  const wheel = { local: '0x28' }, canvas = { local: '0x3d' };
  const frame = (id2, ts, ph, values) => ({
    ...realEnd(ts, id2), name: 'Frame', ph,
    args: values ? { data: { values } } : {},
  });
  const parsed = parseTrace([
    realBegin('WheelScroll', 1_000_000, wheel),
    realBegin('CanvasAnimation', 1_050_000, canvas),
    frame(wheel, 1_500_000, 'b', { expected: 30, dropped_v4: 12 }),
    frame(canvas, 1_600_000, 'b', { expected: 500, dropped_v4: 400 }),
    frame(wheel, 1_700_000, 'e'),
    frame(canvas, 1_800_000, 'e'),
  ]);
  assert.equal(parsed.wheelScroll.expected, 30);
  assert.equal(parsed.wheelScroll.droppedV4, 12);
  assert.equal(parsed.wheelScroll.activeMs, 700);
  assert.equal(parsed.wheelScroll.missingContent, null);
  assert.equal(parsed.byType.CanvasAnimation.expected, 500);
  assert.equal(parsed.wheelScroll.complete, false);
  assert.equal(evaluateThresholds({ ...parsed.wheelScroll, missingContent: 0 }).pass, false);
});

test('dedupes overlapping fork/backfill segments instead of adding them', () => {
  const values = counters({ expected: 60, dropped_v4: 2, missing_content: 1 });
  const events = [
    ...segment('WheelScroll', 1_000_000, 2_000_000, values),
    ...segment('WheelScroll', 1_000_000, 2_000_000, values),
    // A containing segment with the same counters is the same evidence.
    ...segment('WheelScroll', 900_000, 2_100_000, values),
  ];
  const parsed = parseTrace(events);

  assert.equal(parsed.wheelScroll.sequenceCount, 1);
  assert.equal(parsed.wheelScroll.expected, 60);
  assert.equal(parsed.wheelScroll.droppedV4, 2);
  assert.equal(parsed.wheelScroll.missingContent, 1);
  assert.ok(parsed.warnings.some(message => message.includes('duplicate')));
});

test('incomplete track uses last nested Frame counters but leaves missing_content null', () => {
  const parsed = parseTrace([
    begin('WheelScroll', 1_000_000),
    nested(1_500_000, {
      expected: 30,
      dropped_v3: 0,
      dropped_v4: 2,
    }),
  ]);

  const wheel = parsed.wheelScroll;
  assert.equal(wheel.sequenceCount, 1);
  assert.equal(wheel.complete, false);
  assert.equal(wheel.expected, 30);
  assert.equal(wheel.droppedV4, 2);
  assert.equal(wheel.missingContent, null, 'missing counter is null, never 0');
  assert.equal(wheel.activeMs, 500);
  assert.equal(wheel.validFps, 56);
  assert.equal(wheel.badFrameRatio, 2 / 30);

  const result = evaluateSequence(parsed, 'WheelScroll', { role: 'native-scroll' });
  assert.equal(result.present, true);
  assert.equal(result.thresholds.pass, false);
  assert.ok(result.thresholds.failures.some(reason => reason.includes('missing_content')));
  assert.equal(result.thresholds.metrics.missingContent, null);
});

test('threshold boundaries: >=59 fps, <=1% dropped_v4, zero missing content', () => {
  const base = {
    validFps: 59,
    badFrameRatio: 0.01,
    missingContent: 0,
    missingContentRatio: 0,
    expected: 100,
    droppedV4: 1,
    activeMs: 1000,
    complete: true,
    sequenceCount: 1,
  };

  assert.equal(evaluateThresholds(base).pass, true);
  assert.equal(evaluateThresholds({ ...base, validFps: 58.999 }).pass, false);
  assert.equal(evaluateThresholds({ ...base, badFrameRatio: 0.010001 }).pass, false);
  assert.equal(evaluateThresholds({ ...base, missingContent: 1 }).pass, false);
  assert.equal(evaluateThresholds({ ...base, missingContent: null }).pass, false);
  assert.equal(evaluateThresholds({ ...base, validFps: null }).pass, false);

  // Explicit zeroes are real data; only absent data becomes null.
  const zero = evaluateThresholds({
    ...base,
    validFps: 0,
    badFrameRatio: 0,
    missingContent: 0,
  });
  assert.equal(zero.pass, false);
  assert.equal(zero.metrics.validFps, 0);
});

test('missing counters stay null and fail the gate', () => {
  const parsed = parseTrace([
    begin('WheelScroll', 1_000_000),
    end(2_000_000, { expected: 60, missing_content: 0 }),
  ]);
  const wheel = parsed.wheelScroll;
  assert.equal(wheel.expected, 60);
  assert.equal(wheel.droppedV4, null);
  assert.equal(wheel.validFrameCount, null);
  assert.equal(wheel.validFps, null);
  assert.equal(wheel.badFrameRatio, null);
  const result = evaluateSequence(parsed, 'WheelScroll');
  assert.equal(result.thresholds.pass, false);
  assert.ok(result.thresholds.failures.some(reason => reason.includes('badFrameRatio')));
});
