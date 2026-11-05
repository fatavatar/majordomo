import { describe, expect, it } from 'vitest';

import type { CarriedItem } from '@shared/character';
import { wireItem } from '@shared/entities';

import { groupWeights, packGroupOf, packRows } from '../pack';

const item = (over: Partial<CarriedItem> & { name: string }): CarriedItem => ({
  ...wireItem(over.name),
  ...over
});

const WEIGHT: Record<string, number> = {
  broadsword: 100,
  cudgel: 20,
  'padded gloves': 2,
  torch: 3
};
const weigh = (carried: CarriedItem): number | null => WEIGHT[carried.name] ?? null;

describe('the pack by what it is and what it weighs', () => {
  const pack = [
    item({ name: 'torch', kind: 'light' }),
    item({ name: 'cudgel', kind: 'weapon' }),
    item({ name: 'broadsword', kind: 'weapon', equipped: true, slot: 'Weapon Hand' }),
    item({ name: 'cudgel', kind: 'weapon' }),
    item({ name: 'bear claw' }),
    item({ name: 'padded gloves', kind: 'armour', equipped: true, slot: 'Hands' }),
    item({ name: 'cudgel', kind: 'weapon' })
  ];

  it('puts what is on first, then kit, supplies and the rest', () => {
    expect(packRows(pack, weigh).map((row) => [row.group, row.item.name, row.count])).toEqual([
      ['worn', 'broadsword', 1],
      ['worn', 'padded gloves', 1],
      ['kit', 'cudgel', 3],
      ['supplies', 'torch', 1],
      ['other', 'bear claw', 1]
    ]);
  });

  it('weighs a stack whole, and leaves the unweighable unweighed', () => {
    const rows = packRows(pack, weigh);
    expect(rows.find((row) => row.item.name === 'cudgel')?.weight).toBe(60);
    expect(rows.find((row) => row.item.name === 'bear claw')?.weight).toBeNull();
    expect(groupWeights(rows)).toEqual({ worn: 102, kit: 60, supplies: 3, other: 0 });
  });

  it('keeps two of a thing worn as two rows, and a spare beside them apart', () => {
    const rings = [
      item({ name: 'gold ring', kind: 'armour', equipped: true, slot: 'Finger' }),
      item({ name: 'gold ring', kind: 'armour', equipped: true, slot: 'Finger' }),
      item({ name: 'gold ring', kind: 'armour' })
    ];
    expect(packRows(rings, () => 1).map((row) => [row.group, row.count])).toEqual([
      ['worn', 1],
      ['worn', 1],
      ['kit', 1]
    ]);
  });

  it('reads a thing the realm cannot place as other', () => {
    expect(packGroupOf(item({ name: 'odd thing' }))).toBe('other');
  });
});
