import { describe, expect, it } from 'vitest';

import {
  castStamp,
  roundEvent,
  RoundEvent,
  roundTimer,
  spellLocked,
  tooSoon
} from '../combat/timer';
import { session } from './fixture';

/* `0x49af70`, `0x49b9a0`, `0x49b220`, `0x49be90` and `0x49bb90`, disassembled 2026-10-12. */

/** Blows every round at `phase` ms into it, `rounds` times. */
function blows(
  clock: { now: number; ms: number },
  s: Parameters<typeof tooSoon>[0],
  rounds: number,
  phase: number
) {
  for (let i = 0; i < rounds; i += 1) {
    clock.ms = Math.ceil(clock.ms / 5000) * 5000 + phase;
    clock.now = Math.floor(clock.ms / 1000);
    roundEvent(s, RoundEvent.Combat);
    clock.ms += 1;
  }
}

describe('the cast gate before the round is known (0x49af70)', () => {
  it('waits secs + 5 seconds after a cast', () => {
    const { s, clock } = session();
    castStamp(s);
    clock.ms += 4000;
    clock.now += 4;
    expect(tooSoon(s, 0)).toBe(true);
    clock.ms += 1500;
    clock.now += 2;
    expect(tooSoon(s, 0)).toBe(false);
  });
});

describe('syncing to the round (0x49b220, 0x49be90)', () => {
  it('trusts the round after four blows on it', () => {
    const { s, clock } = session();
    blows(clock, s, 3, 200);
    expect(s.roundSynced).toBe(1);
    expect(s.roundConfidence).toBe(70);
    blows(clock, s, 1, 230);
    expect(s.roundConfidence).toBe(80);
    expect(s.roundAnchor).toBe(200);
  });

  it('moves the round after two blows that agree far off it', () => {
    const { s, clock } = session();
    blows(clock, s, 4, 200);
    blows(clock, s, 2, 3400);
    expect(s.roundAnchor).toBe(3400);
  });

  it('merges events under 1.5 s apart', () => {
    const { s, clock } = session();
    roundEvent(s, RoundEvent.Combat);
    clock.ms += 1000;
    roundEvent(s, RoundEvent.Combat);
    expect(s.roundEvents).toBe(1);
  });
});

describe('the cast gate once the round is trusted', () => {
  it('allows one cast a round, from half a second into the next', () => {
    const { s, clock } = session();
    blows(clock, s, 4, 0);
    clock.ms += 1000;
    castStamp(s);
    expect(tooSoon(s, 0)).toBe(true);
    clock.ms = Math.ceil(clock.ms / 5000) * 5000 + 100;
    expect(tooSoon(s, 0)).toBe(true);
    clock.ms += 500;
    expect(tooSoon(s, 0)).toBe(false);
  });

  it("holds after the game's spell lock until the next round", () => {
    const { s, clock } = session();
    blows(clock, s, 4, 0);
    clock.ms += 1000;
    spellLocked(s);
    expect(tooSoon(s, 0)).toBe(true);
    clock.ms = Math.ceil(clock.ms / 5000) * 5000 + 600;
    expect(tooSoon(s, 0)).toBe(false);
  });

  it('casts only late in the round with CastEndOfRound', () => {
    const { s, clock } = session();
    blows(clock, s, 4, 0);
    s.Other_CastEndOfRound = 1;
    clock.ms = Math.ceil(clock.ms / 5000) * 5000 + 1000;
    expect(tooSoon(s, 0)).toBe(true);
    clock.ms += 2000;
    expect(tooSoon(s, 0)).toBe(false);
  });
});

describe('the status bar round timer (0x4aa670, 0x49b8f0, 0x49af00)', () => {
  it('has no round before one is found', () => {
    const { s } = session();
    expect(roundTimer(s)).toEqual({ tone: 'unsynced', nextInMs: null });
  });

  it('is amber while the round is not trusted, with the time to the next', () => {
    const { s, clock } = session();
    blows(clock, s, 3, 200);
    clock.ms = Math.floor(clock.ms / 5000) * 5000 + 1200;
    expect(roundTimer(s)).toEqual({ tone: 'unsure', nextInMs: 4000 });
  });

  it('turns blue on a cast and green again when the round turns', () => {
    const { s, clock } = session();
    blows(clock, s, 4, 200);
    clock.ms = Math.floor(clock.ms / 5000) * 5000 + 1200;
    expect(roundTimer(s).tone).toBe('ready');
    castStamp(s);
    expect(roundTimer(s)).toEqual({ tone: 'wait', nextInMs: 4000 });
    clock.ms += 4100;
    expect(roundTimer(s).tone).toBe('ready');
  });
});
