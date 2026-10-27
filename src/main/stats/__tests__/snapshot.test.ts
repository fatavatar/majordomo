import { describe, expect, it } from 'vitest';

import { EMPTY_CHARACTER, type CharacterState } from '../../../shared/character';
import { NO_TALLY, type CombatTally } from '../../../shared/tally';
import { statsSnapshot, type CardScope } from '../snapshot';

/* The board's reading names (its ingest specification, 2026-10-16). */
function fatty(): CharacterState {
  return {
    ...EMPTY_CHARACTER,
    phase: 'in-game',
    name: 'Fatty',
    race: 'Dwarf',
    className: 'Skald',
    vitals: {
      ...EMPTY_CHARACTER.vitals,
      hp: 1455,
      hpMax: 1505,
      mana: 232,
      manaMax: 290,
      manaType: 'MA'
    },
    progress: {
      ...EMPTY_CHARACTER.progress,
      level: 75,
      exp: 912_345_678,
      expNeeded: 4_000,
      lives: 9
    },
    // Fifty thousand made over half an hour in the realm, this series.
    tally: { ...NO_TALLY, since: 1_000, at: 5_000, experience: 50_000, onlineMs: 1_800_000 },
    inventory: {
      ...EMPTY_CHARACTER.inventory,
      wealth: 416_000_000,
      encumbrance: 9228,
      encumbranceMax: 29283,
      encumbranceWord: 'Light'
    },
    room: {
      ...EMPTY_CHARACTER.room,
      name: 'Hazy Swamp',
      exits: [{ direction: 'south', note: null } as never],
      occupants: [{ name: 'Skinny', kind: 'player' } as never]
    }
  };
}

/** The card reset ten minutes and ten thousand in: what is posted is since then. */
const RESET: CombatTally = {
  ...NO_TALLY,
  since: 1_000,
  at: 2_000,
  experience: 10_000,
  onlineMs: 600_000
};
const card = (baseline: CombatTally | null = RESET): CardScope => ({
  baseline,
  rateFloorMs: 5_000,
  now: 9_000
});

describe('a stats snapshot', () => {
  it('names every reading as the board does, the experience as the Combat Stats card reads it', () => {
    const snapshot = statsSnapshot(
      fatty(),
      { status: 'Looping ... (Lap 12)', path: 'Orc Training - 81 steps to lap end' },
      '1.2.3',
      card()
    );
    expect(snapshot).toEqual({
      level: 75,
      exp: 912_345_678,
      // 40,000 over the twenty minutes since the reset: 120,000 an hour, and
      // the 4,000 still owed two minutes of it.
      exp_made: 40_000,
      exp_needed: 4_000,
      exp_needed_level: 76,
      exp_rate_hour: 120_000,
      level_eta: '0:02:00',
      hp: 1455,
      hp_max: 1505,
      mana: 232,
      mana_max: 290,
      lives: 9,
      wealth: 416_000_000,
      wealth_unit: 'copper',
      encumbrance: 9228,
      encumbrance_max: 29283,
      encumbrance_label: 'Light',
      location: 'Hazy Swamp',
      exits: 'south',
      who_text: 'Skinny',
      status_text: 'Looping ... (Lap 12)',
      path_text: 'Orc Training - 81 steps to lap end',
      race: 'Dwarf',
      class: 'Skald',
      megamud_version: 'Majordomo 1.2.3'
    });
  });

  it('posts a kai figure as kai, and leaves out what is not known', () => {
    const state = fatty();
    const snapshot = statsSnapshot(
      {
        ...state,
        vitals: { ...state.vitals, manaType: 'KAI' },
        progress: { ...state.progress, lives: null }
      },
      null,
      '1.2.3',
      card()
    );
    expect(snapshot['kai']).toBe(232);
    expect(snapshot).not.toHaveProperty('mana');
    expect(snapshot).not.toHaveProperty('lives');
    expect(snapshot).not.toHaveProperty('status_text');
    expect(snapshot['exp_needed']).toBe(4_000);
  });

  it('reads the whole series without a baseline, or with one from another series', () => {
    const whole = statsSnapshot(fatty(), null, '1.2.3', card(null));
    expect([whole['exp_made'], whole['exp_rate_hour']]).toEqual([50_000, 100_000]);
    const other = statsSnapshot(fatty(), null, '1.2.3', card({ ...RESET, since: 7 }));
    expect(other['exp_made']).toBe(50_000);
  });
});
