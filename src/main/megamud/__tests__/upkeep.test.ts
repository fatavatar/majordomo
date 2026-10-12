import { describe, expect, it } from 'vitest';

import type { ItemRec, SpellRec } from '../data';
import { equipForSpell } from '../health/cast';
import { addEntity } from '../room/entities';
import { blessStep } from '../script/bless';
import { cureStep, selfCures } from '../script/cures';
import { hideStep, sneakStep } from '../script/stealth';
import { session } from './fixture';

/* `0x410130`, `0x410440`, `0x4066f0`, `0x407ac0`, `0x40b520` and `0x40cc80`, read 2026-10-12. */

function spell(short: string, flags: number, cost = 5, item = ''): SpellRec {
  return { layer: 0, id: 1, short, name: short, item, flags, magic: 0, level: 0, cost };
}

function item(name: string, type: number): ItemRec {
  return {
    id: 1,
    layer: 0,
    name,
    shop: '',
    ifNeeded: '',
    flags: 0,
    type,
    location: 0,
    min: 0,
    max: 0,
    weight: 1,
    price: 0
  };
}

function character(spells: SpellRec[] = []) {
  const r = session({ spells });
  const { s } = r;
  s.inGame = 1;
  s.online = 1;
  s.now = r.clock.now;
  s.Player_Name = 'Skinny';
  s.Player_MaxHP = 100;
  s.Player_MaxMana = 100;
  s.hp = 100;
  s.mana = 100;
  s.MegaMud_AutoHeal = 1;
  s.Comms_LagWait = 2;
  return r;
}

describe('hiding (0x407ac0)', () => {
  it('hides while idle', () => {
    const { s, out } = character();
    s.Player_Stealth = 1;
    s.MegaMud_AutoHide = 1;
    expect(hideStep(s)).toBe(1);
    expect(out.sent).toEqual(['hide\r']);
    expect(s.hidden).toBe(1);
    expect(s.state).toBe(0x13);
  });

  it('not with a monster here', () => {
    const { s, out } = character();
    s.Player_Stealth = 1;
    s.MegaMud_AutoHide = 1;
    addEntity(s).type = 2;
    expect(hideStep(s)).toBe(0);
    expect(out.sent).toEqual([]);
  });
});

describe('sneaking (0x40b520)', () => {
  it('sneaks with AutoSneak', () => {
    const { s, out } = character();
    s.Player_Stealth = 1;
    s.MegaMud_AutoSneak = 1;
    expect(sneakStep(s)).toBe(1);
    expect(out.sent).toEqual(['sn\r']);
    expect(s.sneaking).toBe(1);
  });

  it('readies the backstab weapon first', () => {
    const { s, out } = character();
    s.Player_Stealth = 1;
    s.MegaMud_AutoSneak = 1;
    s.Combat_CanBackStab = 1;
    s.Combat_BsWeapon = 'dagger';
    s.inventory.push({ count: 1, flags: 0, item: item('dagger', 1) });
    expect(sneakStep(s)).toBe(1);
    expect(out.sent).toEqual(['equip dagger\r']);
    expect(s.state).toBe(0x1f);
    expect(sneakStep(s)).toBe(1);
    expect(out.sent[1]).toBe('sn\r');
  });
});

describe('curing (0x410440, 0x410130)', () => {
  it('cures its own blindness in a fight', () => {
    const { s, out } = character([spell('cure', 0x10)]);
    s.Spells_BlindCmd = 'cure';
    s.blind = 1;
    expect(selfCures(s, 1)).toBe(1);
    expect(out.sent).toEqual(['cure\r']);
    expect(s.blind).toBe(0);
  });

  it("cures a member's poison out of a fight", () => {
    const { s, out } = character([spell('slow', 0x20)]);
    s.Spells_PoisonCmd = 'slow';
    s.partySize = 2;
    s.party[0]!.name = 'Skinny';
    s.party[1]!.name = 'Fatty';
    s.party[1]!.flags28 = 0x1000;
    expect(cureStep(s, 0)).toBe(1);
    expect(out.sent).toEqual(['slow Fatty\r']);
    expect(s.party[1]!.flags28 & 0x1000).toBe(0);
  });
});

describe('blessings (0x4066f0)', () => {
  it('casts a blessing never cast, and waits for its message', () => {
    const { s, out } = character([spell('bles', 0x12)]);
    s.MegaMud_AutoBless = 1;
    s.Spells_BlessCmd1 = 'bles';
    expect(blessStep(s, 0)).toBe(1);
    expect(out.sent).toEqual(['bles\r']);
    expect(s.state).toBe(0x10);
    expect(s.blessSlot).toBe(0);
  });

  it('casts it again only once BlessTim has passed', () => {
    const { s, out } = character([spell('bles', 0x12)]);
    s.MegaMud_AutoBless = 1;
    s.Spells_BlessCmd1 = 'bles';
    s.Spells_BlessTim1 = 60;
    s.blessCastAt[0] = s.now - 30;
    s.blessSeenAt[0] = s.now - 30;
    expect(blessStep(s, 0)).toBe(0);
    s.blessSeenAt[0] = s.now - 90;
    expect(blessStep(s, 0)).toBe(1);
    expect(out.sent).toEqual(['bles\r']);
  });

  it('leaves priority blessings to the fight step', () => {
    const { s } = character([spell('bles', 0x12)]);
    s.MegaMud_AutoBless = 1;
    s.Spells_BlessCmd1 = 'bles';
    s.Spells_BlessPri1 = 1;
    expect(blessStep(s, 0)).toBe(0);
    expect(blessStep(s, 1)).toBe(1);
  });
});

describe("equipping a spell's item (0x40cc80)", () => {
  it('equips the item the spell is cast from', () => {
    const wand = { ...spell('zap', 0x20, 5, 'zap wand'), name: 'wand of zapping' };
    const { s, out } = character([wand]);
    s.inventory.push({ count: 1, flags: 0, item: item('wand of zapping', 1) });
    expect(equipForSpell(s, 'zap')).toBe(1);
    expect(out.sent).toEqual(['equip wand of zapping\r']);
    s.inventory[0]!.flags = 1;
    expect(equipForSpell(s, 'zap')).toBe(-1);
  });
});
