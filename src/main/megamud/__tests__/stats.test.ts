import { describe, expect, it } from 'vitest';

import type { ClassRec } from '../data';
import { newPlayer } from '../data';
import { statLine } from '../stats/stats';
import { session } from './fixture';

/* `0x494e70`, read 2026-10-12; the display is Skinny's, 2026-10-12. */

const STAT = [
  'Name: Skinny Fatterson                 Lives/CP:      9/7    ',
  'Race: Wood-Elf    Exp: 16076201143     Perception:    345',
  'Class: Necrolyte  Level: 80            Stealth:       152',
  'Hits:   128/1182  Armour Class: 121/8  Thievery:        0',
  'Mana: * 816/816   Spellcasting: 425    Traps:           0',
  '                                       Picklocks:       0',
  'Strength:  105    Agility: 103         Tracking:      291',
  'Intellect: 90     Health:  166         Martial Arts:   88',
  'Willpower: 165    Charm:   100         MagicRes:      106'
];

const NECROLYTE: ClassRec = {
  id: 12,
  layer: 0,
  name: 'Necrolyte',
  f28: 0,
  bytes: [0, 0, 0, 0, 0],
  magic: 0,
  abilities: [],
  values: []
};

function stated() {
  const r = session({
    classes: [NECROLYTE],
    races: [{ id: 4, layer: 0, name: 'Wood-Elf', exp: 0 }]
  });
  r.s.inGame = 1;
  r.s.Player_Name = 'Skinny';
  r.s.blind = 1;
  r.s.blessCastAt[3] = 99;
  const me = newPlayer(r.s.data, 0);
  me.name = 'Skinny';
  for (const line of STAT) statLine(r.s, line);
  return { ...r, me };
}

describe('stat (0x494e70)', () => {
  /*
   * Fatty's sheet, 2026-10-19: a raised stat starred, hard against the label.
   * `0x4ad430` stops at the star, so MegaMUD read 0 for both, and the
   * `"Intellect: "` it compares misses `Intellect:*105` altogether.
   */
  it('reads a starred stat, ours where MegaMUD reads none', () => {
    const { s } = session();
    s.inGame = 1;
    for (const line of [
      'Strength: *205    Agility:*150         Tracking:      313',
      'Intellect:*105    Health:  146         Martial Arts:   67',
      'Willpower:*130    Charm:   120         MagicRes:      118'
    ])
      statLine(s, line);
    expect([s.Player_Strength, s.Player_Agility, s.Player_Tracking]).toEqual([205, 150, 313]);
    expect([s.Player_Intellect, s.Player_Health, s.Player_MartialArts]).toEqual([105, 146, 67]);
    expect([s.Player_Wisdom, s.Player_Charm, s.Player_MagicRes]).toEqual([130, 120, 118]);
  });

  it('reads every column', () => {
    const { s } = stated();
    expect(s.Player_Surname).toBe('Fatterson');
    expect(s.Player_Lives).toBe(9);
    expect(s.Player_CPs).toBe(7);
    expect(s.Player_Race).toBe(4);
    expect(s.exp).toBe(16076201143);
    expect(s.Player_Class).toBe(12);
    expect(s.Player_Level).toBe(80);
    expect(s.hp).toBe(128);
    expect(s.Player_MaxHP).toBe(1182);
    expect(s.armourClass).toBe(121);
    expect(s.mana).toBe(816);
    expect(s.Player_MaxMana).toBe(816);
    expect(s.Player_SpellCasting).toBe(425);
    expect(s.Player_Stealth).toBe(152);
    expect(s.Player_Tracking).toBe(291);
    expect(s.Player_MartialArts).toBe(88);
    expect(s.Player_MagicRes).toBe(106);
  });

  it('takes the conditions and blessings as gone', () => {
    const { s } = stated();
    expect(s.blind).toBe(0);
    expect(s.blessCastAt[3]).toBe(0);
  });

  it("keeps this character's player record up to date", () => {
    const { s, me } = stated();
    expect(me.level).toBe(80);
    expect(me.cls).toBe(12);
    expect(me.surname).toBe('Fatterson');
    expect(s.playersChanged).toBe(1);
  });
});
