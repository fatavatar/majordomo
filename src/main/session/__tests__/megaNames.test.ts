import { describe, expect, it } from 'vitest';

import { newItem, type MegaData } from '../../megamud/data';
import { ItemFlag } from '../../megamud/flags';
import { megaNames } from '../MegaEngine';

function data(): MegaData {
  const d: MegaData = { monsters: [], items: [], spells: [] };
  const item = (name: string, type: number, location: number, flags = 0): void => {
    Object.assign(newItem(d), { name, type, location, flags });
  };
  item('short sword', 1, 0);
  item('dagger', 1, 0, ItemFlag.Backstab);
  item('kite shield', 0, 12);
  item('healing potion', 0, 0);
  item('dagger', 1, 0, ItemFlag.Backstab);
  return d;
}

describe("a character's MegaMUD names for its settings boxes", () => {
  it('names every item once, sorted', () => {
    expect(megaNames(data()).items).toEqual([
      'dagger',
      'healing potion',
      'kite shield',
      'short sword'
    ]);
  });

  it('names the weapons, the ones that backstab and the shields as the boxes take them', () => {
    const names = megaNames(data());
    expect(names.weapons).toEqual(['dagger', 'short sword']);
    expect(names.backstab).toEqual(['dagger']);
    expect(names.shields).toEqual(['kite shield']);
  });
});
