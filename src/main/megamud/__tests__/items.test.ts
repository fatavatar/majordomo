import { describe, expect, it } from 'vitest';

import { readData } from '../data';
import { buyLine } from '../items/buy';
import { dropLine } from '../items/drop';
import { equipLine } from '../items/equip';
import { getLine } from '../items/get';
import { findCarried, inventoryLine } from '../items/inventory';
import { sellLine } from '../items/sell';
import { addEntity } from '../room/entities';
import { session } from './fixture';

/* `0x454b90`, `0x453ef0`, `0x454320`, `0x453a70` and `0x455d30`, read 2026-10-12. */

function carrying() {
  const r = session(readData({}));
  const { s } = r;
  s.inGame = 1;
  for (const line of [
    'You are carrying 25 platinum pieces, 3 gold crowns, dagger (Weapon Hand), rope',
    'and grapple, 2 lanterns',
    'You have no keys.',
    'Wealth: 250300 copper farthings',
    'Encumbrance: 100/2000 - Light [5%]'
  ]) {
    inventoryLine(s, line, 0);
  }
  return r;
}

describe('picking up (0x454b90)', () => {
  it('carries what was picked up and counts the room down', () => {
    const { s } = carrying();
    const e = addEntity(s);
    e.type = 3;
    e.name = 'lantern';
    e.count = 3;
    getLine(s, 'You picked up 2 lantern.');
    expect(findCarried(s, 'lantern')?.count).toBe(4);
    expect(e.count).toBe(1);
  });

  it('forgets an item that is not there', () => {
    const { s } = carrying();
    const e = addEntity(s);
    e.type = 3;
    e.name = 'lantern';
    e.count = 1;
    getLine(s, "You don't see lantern here.");
    expect(s.room).toHaveLength(0);
    expect(s.f_e290).toBe(1);
  });
});

describe('dropping (0x453ef0)', () => {
  it('carries less, and the room has it', () => {
    const { s } = carrying();
    dropLine(s, 'You dropped 2 lanterns.');
    expect(findCarried(s, 'lantern')).toBeNull();
    expect(s.room.find((e) => e.name === 'lanterns')?.count).toBe(2);
  });

  it('gives away without leaving it in the room', () => {
    const { s } = carrying();
    dropLine(s, 'You gave rope and grapple to Fatty.');
    expect(findCarried(s, 'rope and grapple')).toBeNull();
    expect(s.room).toHaveLength(0);
  });
});

describe('equipping (0x454320)', () => {
  it('marks what is worn, and answers an equip', () => {
    const { s } = carrying();
    s.f_a5f8 = 1;
    equipLine(s, 'You are now wearing rope and grapple.');
    expect(findCarried(s, 'rope and grapple')?.flags).toBe(1);
    expect(s.f_a5f8).toBe(0);
  });

  it('forgets the weapon removed', () => {
    const { s } = carrying();
    expect(s.s_b060).toBe('dagger');
    equipLine(s, 'You have removed dagger.');
    expect(s.s_b060).toBe('');
    expect(findCarried(s, 'dagger')?.flags).toBe(0);
  });
});

describe('buying and selling (0x453a70, 0x455d30)', () => {
  it('carries what was bought and pays for it', () => {
    const { s } = carrying();
    buyLine(s, 'You just bought lantern for 1 gold crowns.');
    expect(findCarried(s, 'lantern')?.count).toBe(3);
    expect(findCarried(s, 'gold crowns')?.count).toBe(2);
  });

  it('carries the coins a sale brings', () => {
    const { s } = carrying();
    sellLine(s, 'You sold dagger for 5 gold crowns.');
    expect(findCarried(s, 'dagger')).toBeNull();
    expect(findCarried(s, 'gold crowns')?.count).toBe(8);
  });

  it('stops walking when the shop cannot help', () => {
    const { s } = carrying();
    s.walking = 1;
    buyLine(s, 'You cannot afford a lantern.');
    expect(s.walking).toBe(0);
  });
});
