import { describe, expect, it } from 'vitest';

import { attack } from '../combat/attack';
import { combatStep, partyHeal, selfHeal } from '../combat/heal';
import type { SpellRec } from '../data';
import { addEntity } from '../room/entities';
import type { Session } from '../Session';
import { escapeCheck } from '../script/escape';
import { runCheck } from '../script/run';
import { session } from './fixture';

/* `0x4120b0`, `0x412b10`, `0x412120` and `0x40f510`, read 2026-10-12. */

function spell(short: string, flags: number, cost = 5): SpellRec {
  return { layer: 0, id: 1, short, name: short, item: '', flags, magic: 0, level: 0, cost };
}

function fighter(spells: SpellRec[]) {
  const r = session({ spells });
  const { s } = r;
  s.inGame = 1;
  s.online = 1;
  s.now = r.clock.now;
  s.MegaMud_AutoHeal = 1;
  s.MegaMud_AutoCombat = 1;
  s.Player_Name = 'Skinny';
  s.Player_MaxHP = 100;
  s.Player_MaxMana = 100;
  s.hp = 100;
  s.mana = 100;
  s.Health_HpHealAttPct = 60;
  s.Health_HpHealMinorPct = 80;
  s.Comms_LagWait = 2;
  return r;
}

function monster(s: Session, name: string) {
  const e = addEntity(s);
  e.type = 2;
  e.kind = 4;
  e.name = name;
  return e;
}

function member(s: Session, i: number, name: string, hpPct: number) {
  const m = s.party[i]!;
  m.name = name;
  m.hpPct = hpPct;
  m.maxHp = 100;
  m.flags28 = 0;
}

describe('healing this character (0x412b10)', () => {
  it('casts the main heal at itself below HpHealAtt%', () => {
    const { s, out } = fighter([spell('heal', 0x20)]);
    s.Spells_HealCmd = 'heal';
    s.hp = 50;
    expect(selfHeal(s)).toBe(1);
    expect(out.sent).toEqual(['heal Skinny\r']);
  });

  it('casts the minor heal between the two thresholds', () => {
    const { s, out } = fighter([spell('heal', 0x20), spell('mend', 0x10)]);
    s.Spells_HealCmd = 'heal';
    s.Spells_HealCmd2 = 'mend';
    s.hp = 70;
    expect(selfHeal(s)).toBe(1);
    expect(out.sent).toEqual(['mend\r']);
  });

  it('waits out HpHealPeriod between heals', () => {
    const { s } = fighter([spell('heal', 0x20)]);
    s.Spells_HealCmd = 'heal';
    s.hp = 50;
    s.Health_HpHealPeriod = 10;
    s.f_32318 = s.now - 5;
    expect(selfHeal(s)).toBe(0);
  });

  it('drains a monster with a heal flagged as a room attack', () => {
    const { s, out } = fighter([spell('drai', 0x24)]);
    s.Spells_HealCmd = 'drai';
    s.Spells_HealCasts = 2;
    s.hp = 50;
    monster(s, 'giant rat');
    expect(selfHeal(s)).toBe(1);
    expect(out.sent).toEqual(['drai giant rat\r']);
    expect(s.state).toBe(0xe);
    expect(s.f_e364).toBe(1);
    expect(out.activity).toContain('Casting drain on giant rat');
  });
});

describe('healing the party (0x412120)', () => {
  it('heals the weakest member below PartyHeal2%', () => {
    const { s, out } = fighter([spell('ph2', 0x20)]);
    s.Party_PartyHeal2 = 'ph2';
    s.Party_PartyHeal2Pct = 65;
    s.partySize = 2;
    member(s, 0, 'Skinny', 100);
    member(s, 1, 'Fatty', 40);
    expect(partyHeal(s)).toBe(1);
    expect(out.sent).toEqual(['ph2 Fatty\r']);
    expect(s.party[1]!.flags28 & 2).toBe(2);
  });

  it('casts the area heal when enough are low', () => {
    const { s, out } = fighter([spell('pha', 0x10)]);
    s.Party_PartyHealArea = 'pha';
    s.Party_PartyHealAreaPct = 80;
    s.Party_PartyHealAreaAt = 2;
    s.partySize = 3;
    member(s, 0, 'Skinny', 100);
    member(s, 1, 'Fatty', 50);
    member(s, 2, 'Healbot', 60);
    expect(partyHeal(s)).toBe(1);
    expect(out.sent).toEqual(['pha\r']);
    expect(out.activity).toContain('Casting Area Heal (2 members)');
  });
});

describe('the combat step (0x4120b0)', () => {
  it('asks the party for a heal when it has none to cast', () => {
    const { s } = fighter([]);
    s.Party_PartyAskHealPct = 50;
    s.partySize = 2;
    member(s, 0, 'Skinny', 40);
    member(s, 1, 'Fatty', 100);
    s.hp = 40;
    expect(combatStep(s)).toBe(0);
    expect(s.pending.map((p) => p.text)).toEqual(['/Fatty @heal\r']);
  });
});

describe('attack spells (0x40f510)', () => {
  it('casts the main attack spell at the monster', () => {
    const { s, out } = fighter([spell('mmis', 0x20)]);
    s.Combat_AttackSpl = 'mmis';
    s.Combat_MaxCastCnt = 3;
    s.Combat_AttMaxDmg = 1000;
    const rat = monster(s, 'giant rat');
    expect(attack(s, 0xd, rat)).toBe(1);
    expect(out.sent).toEqual(['mmis giant rat\r']);
    expect(s.state).toBe(0xd);
    expect(s.target).toBe('giant rat');
  });

  it('stops at the cast cap', () => {
    const { s, out } = fighter([spell('mmis', 0x20)]);
    s.Combat_AttackSpl = 'mmis';
    s.Combat_MaxCastCnt = 3;
    s.Combat_AttMaxDmg = 1000;
    s.f_a3f4 = 3;
    expect(attack(s, 0xd, monster(s, 'giant rat'))).toBe(0);
    expect(out.sent).toEqual([]);
  });

  it("uses the monster's own attack spell", () => {
    const { s, out } = fighter([spell('mmis', 0x20), spell('fbol', 0x20)]);
    s.Combat_AttackSpl = 'mmis';
    s.Combat_MaxCastCnt = 3;
    s.Combat_AttMaxDmg = 1000;
    const orc = monster(s, 'orc');
    orc.mon = {
      layer: 0,
      name: 'orc',
      id: 1,
      flags: 0,
      relationship: 4,
      exp: 10,
      maxHp: 20,
      preSpell: '',
      attackSpell: 'fbol',
      preMax: 0,
      attackMax: 2
    };
    expect(attack(s, 0xd, orc)).toBe(1);
    expect(out.sent).toEqual(['fbol orc\r']);
  });

  it('needs AutoPreAttack for the pre-attack', () => {
    const { s } = fighter([spell('stun', 0x20)]);
    s.Combat_PreAttack = 'stun';
    s.Combat_PreCastCnt = 1;
    s.Combat_PreMaxDmg = 1000;
    s.MegaMud_AutoPreAttack = 0;
    expect(attack(s, 0xb, monster(s, 'orc'))).toBe(0);
    s.MegaMud_AutoPreAttack = 1;
    expect(attack(s, 0xb, monster(s, 'orc'))).toBe(1);
  });
});

describe('running and attacking (0x40e190)', () => {
  it('attacks the monster with the attack command', () => {
    const { s, out } = fighter([]);
    monster(s, 'giant rat');
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['a giant rat\r']);
    expect(s.state).toBe(0x11);
    expect(s.target).toBe('giant rat');
    expect(out.activity).toContain('Attacking giant rat');
  });

  it('opens with the attack spell before the attack command', () => {
    const { s, out } = fighter([spell('mmis', 0x20)]);
    s.Combat_AttackSpl = 'mmis';
    s.Combat_MaxCastCnt = 3;
    s.Combat_AttMaxDmg = 1000;
    monster(s, 'giant rat');
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['mmis giant rat\r']);
  });

  it('backstabs while sneaking', () => {
    const { s, out } = fighter([]);
    s.sneaking = 1;
    s.Combat_CanBackStab = 1;
    monster(s, 'giant rat');
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['bs giant rat\r']);
    expect(s.state).toBe(0x12);
  });

  it('runs when HP fall below HpRun% while walking', () => {
    const { s, out } = fighter([]);
    s.walking = 1;
    s.Health_HpRunPct = 30;
    s.Combat_RunRooms = 2;
    s.hp = 20;
    monster(s, 'giant rat');
    expect(runCheck(s)).toBe(0);
    expect(s.runCount).toBe(2);
    expect(out.sent).toEqual([]);
    expect(out.activity).toContain('Running: HP is too low');
  });

  it('runs from too many monsters', () => {
    const { s, out } = fighter([]);
    s.walking = 1;
    s.Combat_MaxMstrs = 2;
    monster(s, 'giant rat');
    monster(s, 'giant rat');
    monster(s, 'orc');
    expect(runCheck(s)).toBe(0);
    expect(s.runCount).toBe(1);
    expect(out.activity).toContain('Running: too many monsters');
  });

  it('does nothing with no monster here', () => {
    const { s, out } = fighter([]);
    expect(runCheck(s)).toBe(0);
    expect(out.sent).toEqual([]);
  });
});

describe("the MUD op's escape (0x40dc20)", () => {
  function op() {
    const r = fighter([]);
    const { s } = r;
    s.BBS_IsMudop = 1;
    s.BBS_SysGoto = '1/1';
    s.active = 1;
    s.Health_HpLogoffPct = 20;
    s.hp = 10;
    return r;
  }

  it('sys gotos away and rests when HP are critical', () => {
    const { s, out } = op();
    expect(escapeCheck(s, 'incoming attack')).toBe(1);
    expect(out.sent).toEqual(['break\r', 'sys goto ', '1/1', '\r', 'rest\r']);
    expect(s.state).toBe(0x2a);
    expect(s.restHpToFull).toBe(1);
    expect(out.trace).toContain('[HPs critical; mudop escape: incoming attack]');
  });

  it('waits before trying again', () => {
    const { s, out } = op();
    escapeCheck(s, '');
    expect(escapeCheck(s, '')).toBe(0);
    expect(out.activity).toContain('Waiting to retry low-HP MudOp escape');
  });

  it('is only for a MUD op', () => {
    const { s, out } = op();
    s.BBS_IsMudop = 0;
    expect(escapeCheck(s, '')).toBe(0);
    expect(out.sent).toEqual([]);
  });
});
