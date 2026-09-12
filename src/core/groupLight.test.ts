import { describe, expect, it } from 'vitest';
import { GROUP_HOLD_MS, INITIAL_GROUP_LIGHT_STATE, stepGroupLight } from './groupLight';

const LIGHT = 0.9;
const DARK = 0.05;

describe('stepGroupLight', () => {
  it('commits the first readable sample immediately', () => {
    const step = stepGroupLight(INITIAL_GROUP_LIGHT_STATE, LIGHT, 0);
    expect(step.state.committed).toBe(true);
    expect(step.changed).toBe(true);
    expect(step.refireInMs).toBeNull();
  });

  it('keeps the committed mode while luminance agrees', () => {
    const committed = { committed: true, pending: null, pendingSince: 0 };
    const step = stepGroupLight(committed, LIGHT, 500);
    expect(step.state.committed).toBe(true);
    expect(step.changed).toBe(false);
    expect(step.refireInMs).toBeNull();
  });

  it('holds a new decision for the hold window before committing', () => {
    const committed = { committed: false, pending: null, pendingSince: 0 };
    const first = stepGroupLight(committed, LIGHT, 1000);
    expect(first.changed).toBe(false);
    expect(first.state.pending).toBe(true);
    expect(first.refireInMs).toBe(GROUP_HOLD_MS);

    const early = stepGroupLight(first.state, LIGHT, 1000 + GROUP_HOLD_MS - 50);
    expect(early.changed).toBe(false);
    expect(early.state.committed).toBe(false);
    expect(early.refireInMs).toBe(50);

    const late = stepGroupLight(early.state, LIGHT, 1000 + GROUP_HOLD_MS);
    expect(late.changed).toBe(true);
    expect(late.state.committed).toBe(true);
    expect(late.state.pending).toBeNull();
    expect(late.refireInMs).toBeNull();
  });

  it('cancels a pending flip that reverts to the committed mode', () => {
    const committed = { committed: false, pending: null, pendingSince: 0 };
    const pending = stepGroupLight(committed, LIGHT, 0).state;
    expect(pending.pending).toBe(true);
    const reverted = stepGroupLight(pending, DARK, 100);
    expect(reverted.state.committed).toBe(false);
    expect(reverted.state.pending).toBeNull();
    expect(reverted.changed).toBe(false);
  });

  it('honours a custom hold duration', () => {
    const committed = { committed: false, pending: null, pendingSince: 0 };
    const first = stepGroupLight(committed, LIGHT, 0, 50);
    expect(first.refireInMs).toBe(50);
    const done = stepGroupLight(first.state, LIGHT, 50, 50);
    expect(done.changed).toBe(true);
    expect(done.state.committed).toBe(true);
  });
});
