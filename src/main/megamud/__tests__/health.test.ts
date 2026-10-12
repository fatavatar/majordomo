import { describe, expect, it } from 'vitest';

import type { SpellRec } from '../data';
import { castSpell } from '../health/cast';
import { healStep } from '../health/heal';
import { healthStep } from '../health/rest';
import { session } from './fixture';

/* `0x414300`, `0x413890`, `0x413760` and `0x40c8a0`, read 2026-10-12. */

function spell(short: string, cost = 5, flags = 0x10): SpellRec {
  return { layer: 0, id: 1, short, name: short, item: '', flags, magic: 0, level: 0, cost };
}

function healthy(spells: SpellRec[] = []) {
  const r = session({ spells });
  const { s } = r;
  s.inGame = 1;
  s.online = 1;
  s.MegaMud_AutoHeal = 1;
  s.Player_MaxHP = 100;
  s.Player_MaxMana = 50;
  s.hp = 100;
  s.mana = 50;
  s.Health_HpRestPct = 50;
  s.Health_HpFullPct = 100;
  s.Health_ManaRestPct = 20;
  s.Health_ManaFullPct = 100;
  s.Comms_LagWait = 2;
  s.now = r.clock.now;
  return r;
}

describe('the health step (0x414300)', () => {
  it('rests when HP fall below HpRest%', () => {
    const { s, out } = healthy();
    s.hp = 40;
    expect(healthStep(s)).toBe(1);
    expect(out.sent).toEqual(['rest\r']);
    expect(s.state).toBe(2);
    expect(s.resting).toBe(1);
    expect(s.restReason).toBe("HP's too low");
    expect(out.activity).toContain("Resting because HP's are too low");
  });

  it('keeps resting to full once it has started', () => {
    const { s, out } = healthy();
    s.hp = 40;
    healthStep(s);
    s.hp = 90;
    s.state = 0;
    expect(healthStep(s)).toBe(1);
    expect(s.state).toBe(3);
    expect(out.sent).toEqual(['rest\r']);
  });

  it('does nothing when healthy', () => {
    const { s, out } = healthy();
    expect(healthStep(s)).toBe(0);
    expect(out.sent).toEqual([]);
  });

  it('casts the mana-full spell once mana is full', () => {
    const { s, out } = healthy([spell('mfl')]);
    s.Spells_MaFullCmd = 'mfl';
    expect(healthStep(s)).toBe(1);
    expect(out.sent).toEqual(['mfl\r']);
    expect(s.manaFullCast).toBe(1);
  });

  it('meditates first with MeditateB4Rest', () => {
    const { s, out } = healthy();
    s.Health_UseMeditate = 1;
    s.Health_MeditateB4Rest = 1;
    s.mana = 5;
    expect(healthStep(s)).toBe(1);
    expect(out.sent).toEqual(['meditate\r']);
    expect(s.state).toBe(4);
  });

  it('asks the leader to wait when following', () => {
    const { s, out } = healthy();
    s.following = 1;
    s.leaderName = 'Fatty';
    s.hp = 40;
    expect(healthStep(s)).toBe(1);
    expect(out.sent[0]).toBe("/Fatty @wait (HP's too low)\r");
    expect(s.holdingLeader).toBe(1);
  });

  it('lets the leader go with AutoHeal off', () => {
    const { s, out } = healthy();
    s.MegaMud_AutoHeal = 0;
    s.holdingLeader = 1;
    s.leaderName = 'Fatty';
    s.Party_PartyResumeCmd = '';
    expect(healthStep(s)).toBe(1);
    expect(out.sent[0]).toBe('/Fatty @ok\r');
    expect(s.holdingLeader).toBe(0);
  });
});

describe('lighting a dark room (0x413760)', () => {
  it('casts the light spell in the dark', () => {
    const { s, out } = healthy([spell('ligh')]);
    s.MegaMud_AutoLight = 1;
    s.Spells_LightCmd = 'ligh';
    s.darkness = 2;
    expect(healStep(s)).toBe(1);
    expect(out.sent).toEqual(['ligh\r']);
    expect(s.darkness).toBe(0);
  });

  it('leaves a dim room alone without LightDimRooms', () => {
    const { s } = healthy([spell('ligh')]);
    s.MegaMud_AutoLight = 1;
    s.Spells_LightCmd = 'ligh';
    s.darkness = 1;
    expect(healStep(s)).toBe(0);
  });
});

describe('casting (0x40c8a0)', () => {
  it("sends the spell's command instead of its name, with the target", () => {
    const wand = { ...spell('zap', 5, 0x20), item: 'zap wand^M' };
    const { s, out } = healthy([wand]);
    expect(castSpell(s, 'zap', 'orc')).toBe(1);
    expect(out.sent).toEqual(['zap wand orc\r']);
    expect(s.state).toBe(0x15);
    expect(s.lastCast).toBe('zap');
  });

  it('waits out the round timer before a second cast', () => {
    const { s, out } = healthy([spell('mfl')]);
    expect(castSpell(s, 'mfl', null)).toBe(1);
    expect(castSpell(s, 'mfl', null)).toBe(0);
    expect(out.sent).toEqual(['mfl\r']);
  });

  it('will not cast short of mana', () => {
    const { s } = healthy([spell('big', 60)]);
    expect(castSpell(s, 'big', null)).toBe(0);
  });
});
