import { describe, expect, it } from 'vitest';

import { sharesOf, timelineOf } from '../timeline';

/* 2026-11-01: the Timeline card's strip, from the record of what the character was doing. */
describe('the timeline over a window', () => {
  const spans = [
    { at: 0, kind: 'idle' as const },
    { at: 100, kind: 'fight' as const },
    { at: 300, kind: 'rest' as const }
  ];

  it('runs each span until the next, the one running at the window’s start included', () => {
    expect(timelineOf(spans, [], null, 50, 400)).toEqual([
      { from: 50, to: 100, kind: 'idle' },
      { from: 100, to: 300, kind: 'fight' },
      { from: 300, to: 400, kind: 'rest' }
    ]);
  });

  it('cuts a stretch out of the realm in on top', () => {
    expect(timelineOf(spans, [{ from: 150, to: 200 }], null, 0, 400)).toEqual([
      { from: 0, to: 100, kind: 'idle' },
      { from: 100, to: 150, kind: 'fight' },
      { from: 150, to: 200, kind: 'away' },
      { from: 200, to: 300, kind: 'fight' },
      { from: 300, to: 400, kind: 'rest' }
    ]);
  });

  it('draws an open stretch out of the realm while the character is still out', () => {
    expect(timelineOf(spans, [], 350, 0, 400).at(-1)).toEqual({ from: 350, to: 400, kind: 'away' });
  });

  it('draws nothing before the first record: no record is not idle', () => {
    expect(timelineOf([{ at: 200, kind: 'walk' }], [], null, 0, 400)).toEqual([
      { from: 200, to: 400, kind: 'walk' }
    ]);
  });

  it('shares the time in the realm among the kinds, leaving the time away out', () => {
    const shares = sharesOf(timelineOf(spans, [{ from: 0, to: 100 }], null, 0, 400));
    expect(shares.fight).toBeCloseTo(2 / 3);
    expect(shares.rest).toBeCloseTo(1 / 3);
    expect(shares.idle).toBe(0);
  });
});
