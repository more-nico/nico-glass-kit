/**
 * Group-level Light/Dark state for `GlassLightGroup`.
 *
 * A group turns many per-element backdrops into one decision: the members
 * share a single Light/Dark flip, so they cannot flicker against each other.
 * On top of the per-probe hysteresis in {@link decideLight}, a group holds a
 * new decision for {@link GROUP_HOLD_MS} before committing, which suppresses
 * whole-group flapping when the sampled luminance hovers at the threshold.
 *
 * The state machine is pure so it can be unit-tested in the node environment;
 * only the timer that re-probes to confirm a pending change lives in the DOM
 * layer.
 */

import { decideLight } from './backdropProbe';

/** How long a new group decision must hold before it is committed. */
export const GROUP_HOLD_MS = 200;

export interface GroupLightState {
  /** Current committed mode; null until the first readable sample. */
  committed: boolean | null;
  /** Candidate waiting out the hold window, null when none. */
  pending: boolean | null;
  /** Timestamp (caller clock) the pending candidate was first seen. */
  pendingSince: number;
}

export const INITIAL_GROUP_LIGHT_STATE: GroupLightState = {
  committed: null,
  pending: null,
  pendingSince: 0,
};

export interface GroupLightStep {
  state: GroupLightState;
  /** True when `committed` changed and the group must re-render. */
  changed: boolean;
  /**
   * When non-null, a re-probe is needed in this many ms to confirm (and
   * commit) the pending candidate.
   */
  refireInMs: number | null;
}

function settled(state: GroupLightState): GroupLightState {
  return { committed: state.committed, pending: null, pendingSince: 0 };
}

/**
 * Folds one readable luminance sample into the group state. The first sample
 * commits immediately (no startup delay); later changes wait out `holdMs`.
 */
export function stepGroupLight(
  state: GroupLightState,
  luminance: number,
  now: number,
  holdMs: number = GROUP_HOLD_MS,
): GroupLightStep {
  const next = decideLight(luminance, state.committed);

  // First readable sample: commit without holding so the group does not sit
  // on the scheme fallback longer than necessary.
  if (state.committed === null) {
    return { state: { committed: next, pending: null, pendingSince: 0 }, changed: true, refireInMs: null };
  }

  if (next === state.committed) {
    return { state: settled(state), changed: false, refireInMs: null };
  }

  if (state.pending === next) {
    const elapsed = now - state.pendingSince;
    if (elapsed >= holdMs) {
      return { state: { committed: next, pending: null, pendingSince: 0 }, changed: true, refireInMs: null };
    }
    return { state, changed: false, refireInMs: holdMs - elapsed };
  }

  return {
    state: { committed: state.committed, pending: next, pendingSince: now },
    changed: false,
    refireInMs: holdMs,
  };
}
