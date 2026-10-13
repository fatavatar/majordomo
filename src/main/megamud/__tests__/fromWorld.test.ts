import { describe, expect, it } from 'vitest';

import { megaDataFrom, messageRec, spellMagic } from '../fromWorld';
import type { WorldGraph } from '../../world/WorldGraph';
import type { MessageTrigger } from '../../../shared/messageTriggers';
import type {
  WorldClass,
  WorldItem,
  WorldMob,
  WorldMobRow,
  WorldRace,
  WorldShop,
  WorldSpell
} from '../../../shared/world';

/** As much of a realm as the builder asks of one. */
function world(parts: {
  classes?: WorldClass[];
  races?: WorldRace[];
  spells?: WorldSpell[];
  mobs?: WorldMob[];
  items?: WorldItem[];
  shops?: WorldShop[];
  rows?: WorldMobRow[];
}): WorldGraph {
  return {
    allClasses: () => parts.classes ?? [],
    allRaces: () => parts.races ?? [],
    allSpells: () => parts.spells ?? [],
    allMobs: () => parts.mobs ?? [],
    allItems: () => parts.items ?? [],
    mobRow: (id: number) => parts.rows?.find((row) => row.id === id),
    shopNamed: (name: string) => parts.shops?.find((shop) => shop.name === name)
  } as unknown as WorldGraph;
}

const NONE = { items: [], messages: [] };

describe("MegaMUD's databases from the realm's own data", () => {
  /*
   * Checked against Skinny's own Classes.md and Races.md, 2026-10-13: the
   * Necrolyte's 200 and the Wood-Elf's 50 make the 250 chart his next-level
   * totals matched.
   */
  it('takes a class and a race as MegaMUD holds them', () => {
    const data = megaDataFrom(
      world({
        classes: [
          {
            id: 4,
            name: 'Necrolyte',
            expTable: 100,
            magery: 3,
            mageryType: 2,
            combat: 4,
            abilities: [[31, 0]]
          },
          { id: 15, name: 'Mystic', expTable: 100, magery: 1, mageryType: 5, weaponType: 9 }
        ],
        races: [{ id: 15, name: 'Wood-Elf', expTable: 50 }]
      }),
      NONE
    );
    expect(data.classes?.[0]).toMatchObject({
      id: 4,
      f28: 200,
      magic: 0x203,
      bytes: [4, 0, 0, 0, 0]
    });
    expect(data.classes?.[0]?.abilities.slice(0, 2)).toEqual([31, 0]);
    expect(data.classes?.[1]).toMatchObject({ magic: 0x501, bytes: [0, 0, 0, 9, 0] });
    expect(data.races).toEqual([{ id: 15, layer: 0, name: 'Wood-Elf', exp: 50 }]);
  });

  // Every (Magery, MageryLVL) pair Skinny's Spells.md holds against the realm's.
  it("numbers a spell's magic as MegaMUD does", () => {
    expect([0, 1, 2, 3].map((l) => spellMagic(2, l))).toEqual([1, 1, 2, 3]);
    expect([0, 1, 2, 3].map((l) => spellMagic(1, l))).toEqual([4, 4, 5, 6]);
    expect([0, 1, 2, 3].map((l) => spellMagic(3, l))).toEqual([7, 7, 8, 9]);
    expect([0, 1, 2, 3].map((l) => spellMagic(4, l))).toEqual([10, 10, 12, 13]);
    expect(spellMagic(5, 0)).toBe(11);
    expect(spellMagic(0, 3)).toBe(0);
  });

  it('marks a spell timed, an attack, and who it may be cast on', () => {
    const data = megaDataFrom(
      world({
        spells: [
          {
            id: 1,
            name: 'magic missile',
            short: 'mmis',
            level: 1,
            mana: 1,
            targets: 4,
            abilities: [[1, 0]],
            magery: 2,
            mageryLevel: 1
          },
          { id: 2, name: 'holy aura', short: 'aura', level: 9, mana: 15, targets: 2, duration: 30 },
          { id: 3, name: 'fireball', targets: 12, abilities: [[17, 0]] }
        ]
      }),
      NONE
    );
    expect(data.spells.map((spell) => [spell.short, spell.flags, spell.magic, spell.cost])).toEqual(
      [
        ['mmis', 0x44, 1, 1],
        ['aura', 0x32, 0, 15],
        ['', 0x84, 0, 0]
      ]
    );
  });

  it('gives a monster its experience multiplied and its health', () => {
    const data = megaDataFrom(
      world({
        mobs: [
          {
            name: 'mosquito swarm',
            hp: 50,
            ids: [12],
            experience: 512011,
            expMulti: 48
          } as WorldMob
        ]
      }),
      NONE
    );
    expect(data.monsters).toEqual([
      expect.objectContaining({ name: 'mosquito swarm', id: 12, exp: 24576528, maxHp: 50 })
    ]);
  });

  // `giant rat` is eight rows in mudrev, and MegaMUD's file has a record for each.
  it("gives a name of several rows a record for each, in the realm's order", () => {
    const data = megaDataFrom(
      world({
        mobs: [{ name: 'giant rat', hp: 2500, ids: [109, 1007, 1], experience: 42 } as WorldMob],
        rows: [
          { id: 1, hp: 12, experience: 42 } as WorldMobRow,
          { id: 109, hp: 12, experience: 42 } as WorldMobRow,
          { id: 1007, hp: 2500, experience: 4410, expMulti: 10 } as WorldMobRow
        ]
      }),
      NONE
    );
    expect(data.monsters.map((mon) => [mon.id, mon.exp, mon.maxHp])).toEqual([
      [1, 42, 12],
      [109, 42, 12],
      [1007, 44100, 2500]
    ]);
  });

  it("takes an item's facts, priced at its shop, with the choices laid on", () => {
    const data = megaDataFrom(
      world({
        items: [
          {
            id: 7,
            name: 'Ring of Faith',
            kind: 'armour',
            worn: 13,
            encumbrance: 2,
            price: 10,
            currency: 'gold',
            shops: ['General Store'],
            abilities: [[100, 1]]
          } as WorldItem,
          { id: 8, name: 'altar', kind: 'sign', gettable: false } as WorldItem
        ],
        shops: [{ id: 1, name: 'General Store', items: [], markup: 120 } as WorldShop]
      }),
      {
        items: [
          { item: 'ring of faith', buy: true, keep: 2 },
          { item: 'rope', collect: true }
        ],
        messages: []
      },
      'Krabby Patties'
    );
    const named = new Map(data.items.map((item) => [item.name, item]));
    expect(named.get('Krabby Patties')).toBeDefined();
    expect(named.get('Ring of Faith')).toMatchObject({
      type: 0,
      location: 4,
      weight: 2,
      // 10 gold at a 120% markup.
      price: 2200,
      shop: 'General Store',
      min: 2,
      flags: 0x20000 | 0x4
    });
    expect(named.get('altar')).toMatchObject({ type: 3, flags: 0x40 });
    expect(named.get('rope')).toMatchObject({ flags: 1 | 0x2, weight: -1 });
  });

  // A MegaMUD room name in *Bought/sold* names no shop of the realm's: the realm's own stands.
  it("keeps the realm's shop for an item whose row names a shop the realm has not", () => {
    const data = megaDataFrom(
      world({
        items: [{ id: 7, name: 'rope', price: 5, shops: ['General Store'] } as WorldItem],
        shops: [{ id: 1, name: 'General Store', items: [] } as WorldShop]
      }),
      { items: [{ item: 'rope', shop: 'General Store (Giovanni)' }], messages: [] }
    );
    expect(data.items.find((item) => item.name === 'rope')?.shop).toBe('General Store');
  });

  it('builds nothing but the coins for a realm with no data', () => {
    const data = megaDataFrom(undefined, NONE);
    expect(data.monsters).toEqual([]);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.every((item) => (item.flags & 0x8000000) !== 0)).toBe(true);
  });
});

describe("a realm's message rows as MegaMUD's", () => {
  it('keeps the effects, the options and the action', () => {
    const trigger: MessageTrigger = {
      name: 'poison',
      match: 'You feel sick',
      endsWith: 'You feel better',
      response: 'cure^M',
      effects: ['poisoned'],
      action: 'rest-hp',
      anywhere: true,
      conversations: false,
      chase: false,
      enabled: false
    };
    expect(messageRec(trigger)).toMatchObject({
      name: 'poison',
      msg: 'You feel sick',
      endMsg: 'You feel better',
      action: 'cure^M',
      effects: 0x4 | 0x400 | 0x8000,
      number: 3
    });
  });
});
