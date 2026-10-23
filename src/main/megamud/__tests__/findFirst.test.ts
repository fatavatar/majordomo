import { describe, expect, it } from 'vitest';

import { newMonster } from '../data';
import { findLongestFirst, findMonster } from '../room/checkNames';
import { session } from './fixture';

/*
 * `forgotten dragon` came first and its name is inside `forgotten dragon
 * slayer`, so the slayer was taken for the dragon and fought with the
 * dragon's settings (skinny, 2026-10-13).
 */
describe('a monster whose name holds another’s', () => {
  it('is found for itself, longest name first', () => {
    const { s } = session();
    s.data.monsters = [];
    const dragon = Object.assign(newMonster(s.data), { name: 'forgotten dragon', flags: 0 });
    const slayer = Object.assign(newMonster(s.data), { name: 'forgotten dragon slayer', flags: 0 });
    const giant = Object.assign(newMonster(s.data), { name: 'storm giant', flags: 0 });
    const king = Object.assign(newMonster(s.data), { name: 'storm giant king', flags: 0 });
    expect(findMonster(s, 'forgotten dragon slayer')).toBe(dragon);

    findLongestFirst(s);
    expect(findMonster(s, 'forgotten dragon slayer')).toBe(slayer);
    expect(findMonster(s, 'forgotten dragon')).toBe(dragon);
    expect(findMonster(s, 'storm giant king')).toBe(king);
    expect(findMonster(s, 'storm giant')).toBe(giant);
    expect(dragon.flags & 8).toBe(0);
  });
});
