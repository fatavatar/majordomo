import { describe, expect, it } from 'vitest';

import { EMPTY_CHARACTER, type CharacterState } from '../../../shared/character';
import { statsSnapshot } from '../snapshot';

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

describe('a stats snapshot', () => {
  it('names every reading as the board does, the engine’s figures where it has them', () => {
    const snapshot = statsSnapshot(
      fatty(),
      {
        expMade: 36750,
        expNeeded: 3999,
        expNeededLevel: 76,
        expPerHour: 1_250_000,
        levelEta: '2 minutes',
        status: 'Looping ... (Lap 12)',
        path: 'Orc Training - 81 steps to lap end'
      },
      '1.2.3'
    );
    expect(snapshot).toEqual({
      level: 75,
      exp: 912_345_678,
      exp_made: 36750,
      exp_needed: 3999,
      exp_needed_level: 76,
      exp_rate_hour: 1_250_000,
      level_eta: '2 minutes',
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
      megamud_version: 'mudengine 1.2.3'
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
      '1.2.3'
    );
    expect(snapshot['kai']).toBe(232);
    expect(snapshot).not.toHaveProperty('mana');
    expect(snapshot).not.toHaveProperty('lives');
    expect(snapshot).not.toHaveProperty('status_text');
    expect(snapshot['exp_needed']).toBe(4_000);
  });
});
