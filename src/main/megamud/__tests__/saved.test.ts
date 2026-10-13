import { describe, expect, it } from 'vitest';

import { newItem, newMonster, newPlayer } from '../data';
import { savedItems, savedMonsters, savedPlayers } from '../saved';
import { session } from './fixture';

const DAY = 86400;

/* `0x46fa70`, `0x45a240` and `0x494640`, read 2026-10-13. */
describe('what MegaMUD saves of each record', () => {
  it('saves the monsters changed in play, numbering a new one from 10000', () => {
    const { s } = session();
    s.data.monsters = [];
    // As read from Monsters.md: no `0x40000000`.
    Object.assign(newMonster(s.data), { name: 'kobold', id: 12, flags: 0 });
    const learned = newMonster(s.data);
    learned.name = 'mutated dragon hatchling';
    const saved = savedMonsters(s);
    expect(saved.map((m) => [m.name, m.id, m.flags])).toEqual([
      ['mutated dragon hatchling', 10000, 2]
    ]);
  });

  it('numbers past every other record once past 10000', () => {
    const { s } = session();
    const first = newItem(s.data);
    first.name = 'Krabby Pattie';
    first.id = 10004;
    const next = newItem(s.data);
    next.name = 'black rose';
    savedItems(s);
    expect(next.id).toBe(10005);
  });

  it('removes a player not seen in DelPlayers days, and keeps the rest', () => {
    const { s } = session();
    s.now = 100 * DAY;
    s.Other_DelPlayers = 90;
    const gone = newPlayer(s.data, 5 * DAY);
    gone.name = 'Oldtimer';
    const here = newPlayer(s.data, 99 * DAY);
    here.name = 'Fatty';
    here.flags |= 0x8000;
    const { players, removed } = savedPlayers(s, () => undefined);
    expect(removed).toEqual(['Oldtimer']);
    expect(players.map((p) => p.name)).toEqual(['Fatty']);
    expect(players[0]!.flags & 0x8000).toBe(0);
    expect(s.data.players!.map((p) => p.name)).toEqual(['Fatty']);
  });

  it('wants a player’s details until race, class and kind are known', () => {
    const { s } = session();
    s.now = DAY;
    const p = newPlayer(s.data, DAY);
    p.name = 'Fatty';
    expect(savedPlayers(s, () => undefined).players[0]!.flags & 1).toBe(1);
    Object.assign(p, { race: 15, cls: 4, kind: 2 });
    expect(savedPlayers(s, () => undefined).players[0]!.flags & 1).toBe(0);
  });
});
