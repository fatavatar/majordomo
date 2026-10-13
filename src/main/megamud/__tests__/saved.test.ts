import { describe, expect, it } from 'vitest';

import { newItem, newMonster } from '../data';
import { rememberItem, rememberPlayers, rememberStance, savedItems, savedStances } from '../saved';
import type { PlayerFacts } from '../../../shared/players';
import { session } from './fixture';

const DAY = 86400;

/* `0x46fa70`, `0x45a240` and `0x494640`, read 2026-10-13. */
describe('what MegaMUD saves, in our shapes', () => {
  it('saves the stance of each monster changed in play', () => {
    const { s } = session();
    s.data.monsters = [];
    // As read from Monsters.md: no `0x40000000`.
    Object.assign(newMonster(s.data), { name: 'kobold', relationship: 4, flags: 0 });
    Object.assign(newMonster(s.data), { name: 'mutated dragon hatchling', relationship: 4 });
    Object.assign(newMonster(s.data), { name: 'stranger', relationship: 0 });
    expect(savedStances(s)).toEqual([['mutated dragon hatchling', 'enemy']]);
  });

  it('saves what was learned of each item changed in play', () => {
    const { s } = session();
    Object.assign(newItem(s.data), { name: 'Krabby Pattie', weight: -1 });
    Object.assign(newItem(s.data), { name: 'runed silk gloves', weight: 4, location: 13 });
    expect(savedItems(s)).toEqual([
      { name: 'Krabby Pattie', weight: null, slot: null, weapon: false },
      { name: 'runed silk gloves', weight: 4, slot: 13, weapon: false }
    ]);
  });

  it('takes a stance and an item back up as the loader would have read them', () => {
    const { s } = session();
    s.data.monsters = [];
    rememberStance(s, 'mutated dragon hatchling', 'avoid');
    expect(s.data.monsters[0]).toMatchObject({ relationship: 3, flags: 2 });
    rememberItem(s, { name: 'Staff of the Undead', weight: 300, slot: null, weapon: true });
    expect(s.data.items.at(-1)).toMatchObject({ weight: 300, type: 1, flags: 1 });
  });

  it('takes up the players this realm has seen, but those unseen in DelPlayers days', () => {
    const { s } = session();
    s.data.players = [];
    s.now = 100 * DAY;
    s.Other_DelPlayers = 90;
    const facts = (name: string, seenDay: number): PlayerFacts =>
      ({
        name,
        alignment: 'Saint',
        gang: null,
        level: 64,
        race: null,
        className: null,
        lastSeen: seenDay * DAY * 1000
      }) as PlayerFacts;
    rememberPlayers(s, [facts('Oldtimer', 5), facts('Fatty', 99)]);
    expect(s.data.players.map((p) => [p.name, p.level, p.alignment])).toEqual([['Fatty', 64, 2]]);
  });
});
