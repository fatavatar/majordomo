import { describe, expect, it } from 'vitest';

import {
  abilityValue,
  DEFAULT_FILTERS,
  orderRows,
  passes,
  type ExplorerFilters
} from '../explorer';
import type { ExplorerFacts, ExplorerRow } from '@shared/explorer';

function row(
  number: number,
  cells: ExplorerRow['cells'] = {},
  facts: Partial<ExplorerFacts> = {}
): ExplorerRow {
  return {
    number,
    name: `item ${number}`,
    usable: true,
    inGame: true,
    worn: false,
    cells,
    facts: {
      type: '1H Sharp',
      magical: 0,
      hasMagical: false,
      hitMagic: 0,
      limit: 0,
      strength: 0,
      speed: 1000,
      backstabs: true,
      abilities: [],
      negates: [],
      ...facts
    }
  };
}

const filters = (over: Partial<ExplorerFilters> = {}): ExplorerFilters => ({
  ...DEFAULT_FILTERS,
  ...over
});

describe('the Explorer’s order, as mudtool’s list orders it', () => {
  /* The AC/DR column read as text put `18/3` before `6/0.1` (2026-10-18). */
  it('sorts by the value main sends (MME’s AC-then-DR tag), not what is shown', () => {
    const rows = [row(1, { acdr: 6000001 }), row(2, { acdr: 18000030 }), row(3, { acdr: 6000005 })];
    expect(orderRows(rows, (r) => r.cells['acdr'], -1).map((r) => r.number)).toEqual([2, 3, 1]);
  });

  it('puts an empty cell last whichever way round, and ties by the realm’s number', () => {
    const rows = [row(3, { bs: 'No' }), row(1, { bs: 'No' }), row(2, { bs: '' })];
    expect(orderRows(rows, (r) => r.cells['bs'], 1).map((r) => r.number)).toEqual([1, 3, 2]);
    expect(orderRows(rows, (r) => r.cells['bs'], -1).map((r) => r.number)).toEqual([1, 3, 2]);
  });
});

describe('the Explorer’s filters, as mudtool’s tabs apply them', () => {
  it('keeps to what the character can use and the realm has, on by default', () => {
    expect(passes({ ...row(1), usable: false }, 'weapons', filters())).toBe(false);
    expect(passes({ ...row(1), inGame: false }, 'weapons', filters())).toBe(false);
    expect(passes({ ...row(1), usable: false }, 'weapons', filters({ usableOnly: false }))).toBe(
      true
    );
  });

  it('reads Magic >= with hit-magic stacked, as stock MajorMUD does', () => {
    const hitting = row(1, {}, { magical: 1, hitMagic: 3 });
    expect(passes(hitting, 'weapons', filters({ magic: 3 }))).toBe(true);
    expect(passes(hitting, 'weapons', filters({ magic: 4 }))).toBe(false);
  });

  it('keeps Limiteds off the Weapons list only when unticked, and No Limit on Armour', () => {
    const limited = row(1, {}, { limit: 2 });
    expect(passes(limited, 'weapons', filters())).toBe(true);
    expect(passes(limited, 'weapons', filters({ limiteds: false }))).toBe(false);
    expect(passes(limited, 'armour', filters({ noLimit: true }))).toBe(false);
  });

  it('asks Non-magic of a weapon’s value and of an armour’s stating it at all', () => {
    const statedZero = row(1, {}, { magical: 0, hasMagical: true });
    expect(passes(statedZero, 'weapons', filters({ nonMagic: true }))).toBe(true);
    expect(passes(statedZero, 'armour', filters({ nonMagic: true }))).toBe(false);
  });

  it('keeps to backstab weapons under a backstab Calc. Combat', () => {
    const blunt = row(1, {}, { backstabs: false });
    expect(passes(blunt, 'weapons', filters())).toBe(true);
    expect(passes(blunt, 'weapons', filters(), true)).toBe(false);
  });

  it('filters and shows an ability as MME’s ability filter does', () => {
    const accurate = row(
      1,
      {},
      {
        abilities: [
          [22, 5],
          [22, 8]
        ]
      }
    );
    expect(
      passes(accurate, 'weapons', filters({ ability: { abil: 22, op: 'ge', value: 8 } }))
    ).toBe(true);
    expect(
      passes(accurate, 'weapons', filters({ ability: { abil: 22, op: 'ge', value: 9 } }))
    ).toBe(false);
    // The column reads the last slot stating it, as `weaponCols` does.
    expect(abilityValue(accurate, 22)).toBe(8);
    const negating = row(2, {}, { negates: [44] });
    expect(
      passes(negating, 'armour', filters({ ability: { abil: -1, op: 'ge', value: 44 } }))
    ).toBe(true);
    expect(
      passes(negating, 'armour', filters({ ability: { abil: -1, op: 'ge', value: 45 } }))
    ).toBe(false);
  });
});

/*
 * mudtool's own `spell filters (FilterSpells)` test (`test/explorers.test.js`),
 * on fireball's facts as main sends them (`main/mme/__tests__/Explorer.test.ts`).
 */
describe('the Spells filter (spellPasses)', () => {
  const fireball = (over: Partial<NonNullable<ExplorerRow['spell']>> = {}): ExplorerRow => ({
    ...row(64, {}, { abilities: [[17, 0]] }),
    name: 'fireball',
    usable: false,
    spell: {
      magery: 1,
      mageryLevel: 3,
      targets: 12,
      attType: 1,
      learnable: 1,
      anyMagery: false,
      usableLearnable: false,
      kaiLearns: true,
      short: 'fbal',
      mageryName: 'Mage-3',
      level: 10,
      mana: 12,
      target: 'Room',
      ...over
    }
  });
  const keeps = (f: Partial<ExplorerFilters>, spell = fireball()): boolean =>
    passes(spell, 'spells', filters({ usableOnly: false, ...f }));

  it('keeps by magery, attack, target and ability as mudtool does', () => {
    expect(keeps({ magery: 1 })).toBe(true);
    expect(keeps({ magery: 2 })).toBe(false);
    // `Hot/Fire` is the list's 2, `AttType` 1.
    expect(keeps({ attType: 2 })).toBe(true);
    expect(keeps({ attType: 1 })).toBe(false);
    // Room: targets 11, 12, 9 and 3.
    expect(keeps({ target: 5 })).toBe(true);
    expect(keeps({ target: 3 })).toBe(false);
    expect(keeps({ hasAbility: 17 })).toBe(true);
    expect(keeps({ hasAbility: 1 })).toBe(false);
  });

  it('keeps to the character with the global filter, a Priest not casting fireball', () => {
    expect(keeps({ usableOnly: true })).toBe(false);
    expect(keeps({ usableOnly: true }, { ...fireball(), usable: true })).toBe(true);
  });

  it('keeps a learnable spell of no magery for any magery the character may learn it under', () => {
    const open = fireball({ magery: 0, anyMagery: true });
    expect(keeps({ magery: 2, usableOnly: true }, { ...open, usable: true })).toBe(true);
    expect(keeps({ magery: 2 }, open)).toBe(false);
  });

  it('keeps to learnable spells, Kai the exception, and finds one by its short name', () => {
    const unlearnable = fireball({ learnable: 0 });
    expect(keeps({ learnableOnly: true }, unlearnable)).toBe(false);
    expect(keeps({ learnableOnly: true, magery: 5 }, fireball({ learnable: 0, magery: 5 }))).toBe(
      true
    );
    expect(keeps({ query: 'fbal' })).toBe(true);
  });
});
