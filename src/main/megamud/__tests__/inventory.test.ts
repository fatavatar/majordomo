import { describe, expect, it } from 'vitest';

import { normalWeapon } from '../combat/weapons';
import { findCarried, inventoryLine, sameItemName } from '../items/inventory';
import { addEntity } from '../room/entities';
import { session } from './fixture';

/* `0x455230`, `0x4530c0` and `0x45a100`, read 2026-10-12; the listing is Skinny's, 2026-10-12. */

const LISTING = [
  'You are carrying 517 Krabby Patties, 25 platinum pieces, 8 silver nobles, Ring',
  "of Faith (Finger), bracers of enlightnment (Arms), demon's skull mask (Face),",
  'dragonscale belt (Waist), platinum moonstone ring (Finger), runed silk robes',
  '(Torso), black rose (Worn), runed silk slippers (Feet), darkwood bracelet',
  '(Wrist), runed silk pants (Legs), etched platinum circlet (Head), reading',
  'glasses (Eyes), emerald main-gauche (Off-Hand), sunstone wristband (Wrist),',
  'jeweled moonstone medallion (Neck), runed silk gloves (Hands), cloak of faith',
  '(Back), onyx earrings (Ears), metallic silver staff (Weapon Hand), dented',
  "wizard's hat, phoenix feather, severed head of Goru-Nezar, 2 waterskin,",
  "firestone pendant, mine pass, sorceror's monocle, Balance Stone, rope and",
  'grapple, medallion of faith, bracelet of haste, etched platinum ring, runed',
  'silk headdress',
  'You have the following keys:  amber key, ruby key, angular key, 2 iron keys,',
  'sapphire key, glass key, feathered key, glowing key, black star key.',
  'Wealth: 517250080 copper farthings',
  'Encumbrance: 1517/6786 - Light [22%]'
];

function listed() {
  const r = session();
  r.s.inGame = 1;
  for (const line of LISTING) inventoryLine(r.s, line, 0);
  return r;
}

describe('the inventory (0x455230)', () => {
  it('lists every item, joined across lines', () => {
    const { s } = listed();
    const names = s.inventory.map((c) => c.item?.name);
    expect(names).toContain('Ring of Faith');
    expect(names).toContain('runed silk robes');
    expect(names).toContain('runed silk headdress');
    expect(names).toContain('rope and grapple');
    expect(names).toContain('black star key');
    expect(s.inventory.length).toBe(44);
  });

  it('counts stacks', () => {
    const { s } = listed();
    expect(findCarried(s, 'platinum piece')?.count).toBe(25);
    expect(findCarried(s, 'iron key')?.count).toBe(2);
  });

  it('marks what is worn, and the weapon wielded', () => {
    const { s } = listed();
    expect(findCarried(s, 'cloak of faith')?.flags).toBe(1);
    expect(findCarried(s, 'phoenix feather')?.flags).toBe(0);
    expect(findCarried(s, 'cloak of faith')?.item?.location).toBe(7);
    expect(findCarried(s, 'emerald main-gauche')?.item?.location).toBe(12);
    expect(s.s_b060).toBe('metallic silver staff');
    expect(s.Combat_NrmWeapon).toBe('metallic silver staff');
  });

  it('reads the wealth and the encumbrance, and ends the listing', () => {
    const { s } = listed();
    expect(s.f_8428).toBe(517250080);
    expect(s.f_8464).toBe(1517);
    expect(s.f_8468).toBe(6786);
    expect(s.f_846c).toBe(1);
    expect(s.lineFlags & 0x1c00).toBe(0);
    expect(s.state).toBe(0);
  });

  it('learns unknown items, without the plural s (as MegaMUD drops it)', () => {
    const { s, out } = listed();
    expect(out.shown).toContain('[Krabby Pattie added to known items]');
    expect(findCarried(s, 'Krabby Patties')?.item?.weight).toBe(-1);
  });
});

describe('item names (0x45a100)', () => {
  it('matches plurals and apostrophes', () => {
    expect(sameItemName('iron keys', 'iron key')).toBe(true);
    expect(sameItemName("wizard's hat", 'wizards hat')).toBe(true);
    expect(sameItemName('iron key', 'gold key')).toBe(false);
  });
});

describe('the weapon for the fight (0x410f50)', () => {
  function armed() {
    const r = listed();
    const { s } = r;
    s.Combat_NrmWeapon = 'phoenix feather';
    s.Combat_AltWeapon = 'metallic silver staff';
    const e = addEntity(s);
    e.type = 2;
    e.kind = 4;
    e.name = 'orc';
    return { ...r, e };
  }

  it('equips the normal weapon', () => {
    const { s, out } = armed();
    expect(normalWeapon(s)).toBe(1);
    expect(out.sent).toEqual(['equip phoenix feather\r']);
    expect(s.s_b060).toBe('phoenix feather');
  });

  it('switches to the alt weapon against a monster immune to the normal one', () => {
    const { s, out, e } = armed();
    e.flags |= 0x200;
    // The staff is already in hand: nothing to send.
    expect(normalWeapon(s)).toBe(0);
    expect(out.sent).toEqual([]);
    expect(s.f_b0fc).toBe(1);
    expect(s.s_b060).toBe('metallic silver staff');
  });

  it('gives the fight up when every weapon is exhausted', () => {
    const { s, out, e } = armed();
    e.flags |= 0x200 | 0x400;
    expect(normalWeapon(s)).toBe(1);
    expect(s.f_8bec).toBe(1);
    expect(out.shown).toContain('[all configured weapons exhausted vs orc]');
  });
});
