import { describe, expect, it } from 'vitest';

import {
  isFullStatline,
  STATLINE_MAX_CELLS,
  statlineMatcher,
  withReading,
  type StatlineFigures
} from '../statline';

describe('what a template can and cannot be built from', () => {
  it('is null for full, in any case', () => {
    expect(statlineMatcher('full')).toBeNull();
    expect(statlineMatcher('  Full ')).toBeNull();
    expect(isFullStatline('FULL')).toBe(true);
  });

  it('is null for %n, an unseen wildcard, a figure asked for twice, or no figure at all', () => {
    expect(statlineMatcher('[HP=%h]%n:')).toBeNull();
    expect(statlineMatcher('[HP=%h,%q]:')).toBeNull();
    expect(statlineMatcher('[HP=%h/%h]:')).toBeNull();
    expect(statlineMatcher('[Hello]:')).toBeNull();
    expect(statlineMatcher('')).toBeNull();
    expect(statlineMatcher('[HP=%')).toBeNull();
  });
});

/*
 * The figures a designed line draws from: what the client tracks, with the
 * prompt's own reading laid over it. The drawing is `rewrites.test.ts`.
 */
describe('the figures a design draws from', () => {
  const figures: StatlineFigures = {
    hp: 120,
    hpMax: 156,
    mana: 5,
    manaMax: 28,
    exp: 10,
    need: 90,
    wealth: 7,
    state: 'resting',
    name: 'Vaelor',
    fullName: 'Vaelor Stone',
    race: 'Human',
    className: 'Mystic',
    manaType: 'KAI',
    level: 3,
    room: 'Town Square',
    lives: 9,
    expSession: 12,
    encumbrance: 100,
    encumbranceMax: 400,
    encumbranceWord: 'None'
  };

  it("lays a prompt's reading over the state, and the prompt's idle over a remembered rest", () => {
    const known: StatlineFigures = { ...figures, hp: 1, state: 'resting' };
    const read = {
      hp: 50,
      hpMax: null,
      mana: null,
      manaMax: null,
      exp: null,
      need: null,
      wealth: null,
      state: null
    };
    expect(withReading(known, read)).toMatchObject({ hp: 50, hpMax: 156, state: null, level: 3 });
  });

  it('states the ceiling the prompt row holds, which is the server’s own repaint width', () => {
    expect(STATLINE_MAX_CELLS).toBe(79);
  });
});
