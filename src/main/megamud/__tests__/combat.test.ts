import { describe, expect, it } from 'vitest';

import { attack } from '../combat/attack';
import { applyImmunity } from '../combat/immunity';
import { breakOff, combatEngaged } from '../combat/engaged';
import { combatRoundEnd } from '../combat/rounds';
import { blowStruck } from '../combat/timer';
import { newItem } from '../data';
import { setState } from '../script/state';
import { combatStep, partyHeal, selfHeal } from '../combat/heal';
import type { SpellRec } from '../data';
import { addEntity } from '../room/entities';
import type { Session } from '../Session';
import { escapeCheck } from '../script/escape';
import { runCheck } from '../script/run';
import { schedule } from '../script/scheduler';
import { session } from './fixture';
import { State } from '../states';
import { PartyFlag, EntityType, LineFlag, Stance } from '../flags';

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
  e.type = EntityType.Monster;
  e.kind = Stance.Enemy;
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
    s.healCastAt = s.now - 5;
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
    expect(s.altHeal).toBe(1);
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
    expect(s.party[1]!.flags28 & PartyFlag.ChangedSinceListing).toBe(2);
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
    expect(attack(s, State.CastMain, rat)).toBe(1);
    expect(out.sent).toEqual(['mmis giant rat\r']);
    expect(s.state).toBe(0xd);
    expect(s.target).toBe('giant rat');
  });

  it('stops at the cast cap', () => {
    const { s, out } = fighter([spell('mmis', 0x20)]);
    s.Combat_AttackSpl = 'mmis';
    s.Combat_MaxCastCnt = 3;
    s.Combat_AttMaxDmg = 1000;
    s.castsMain = 3;
    expect(attack(s, State.CastMain, monster(s, 'giant rat'))).toBe(0);
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
    expect(attack(s, State.CastMain, orc)).toBe(1);
    expect(out.sent).toEqual(['fbol orc\r']);
  });

  it('needs AutoPreAttack for the pre-attack', () => {
    const { s } = fighter([spell('stun', 0x20)]);
    s.Combat_PreAttack = 'stun';
    s.Combat_PreCastCnt = 1;
    s.Combat_PreMaxDmg = 1000;
    s.MegaMud_AutoPreAttack = 0;
    expect(attack(s, State.CastPre, monster(s, 'orc'))).toBe(0);
    s.MegaMud_AutoPreAttack = 1;
    expect(attack(s, State.CastPre, monster(s, 'orc'))).toBe(1);
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

  /*
   * The main spell before the second (asked for 2026-10-21), where MegaMUD
   * tries the second first: the second waits for the main to have no effect.
   */
  it('casts the main attack spell before the second, and the second where the main has no effect', () => {
    const { s, out } = fighter([spell('lite', 0x20), spell('dfur', 0x20)]);
    s.Combat_AttackSpl = 'lite';
    s.Combat_MaxCastCnt = 3;
    s.Combat_AttMaxDmg = 1000;
    s.Combat_AttackSpl2 = 'dfur';
    s.Combat_MaxCastCnt2 = 3;
    s.Combat_AttMaxDmg2 = 1000;
    monster(s, 'giant rat');
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['lite giant rat\r']);
    const { s: again, out: told } = fighter([spell('lite', 0x20), spell('dfur', 0x20)]);
    Object.assign(again, {
      Combat_AttackSpl: 'lite',
      Combat_MaxCastCnt: 3,
      Combat_AttMaxDmg: 1000,
      Combat_AttackSpl2: 'dfur',
      Combat_MaxCastCnt2: 3,
      Combat_AttMaxDmg2: 1000
    });
    again.monsterMarks = [{ name: 'giant rat', flags: 0, spells: ['lite'] }];
    const rat = monster(again, 'giant rat');
    applyImmunity(again, rat);
    expect(runCheck(again)).toBe(1);
    expect(told.sent).toEqual(['dfur giant rat\r']);
  });

  /*
   * Skinny (2026-10-21): one `intr` a fight, engaged, and a heal between
   * rounds ended it; the main spell went out next. Broken off, it is picked
   * up again.
   */
  it('picks a multi-attack a heal broke off up again, past its cast count', () => {
    const { s, out } = fighter([spell('intr', 0x84), spell('lite', 0x64)]);
    Object.assign(s, {
      MegaMud_AutoNuke: 1,
      Combat_MultAttack: 'intr',
      Combat_MultMstrCnt: 2,
      Combat_MultCastCnt: 1,
      Combat_MultMaxDmg: 99999,
      Combat_AttackSpl: 'lite',
      Combat_MaxCastCnt: 3,
      Combat_AttMaxDmg: 1000
    });
    monster(s, 'giant ogre zombie');
    monster(s, 'unholy wraith');
    s.castsMulti = 1;
    s.engagedMode = State.CastMulti;
    breakOff(s);
    expect(s.resumeMode).toBe(State.CastMulti);
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['intr\r']);
    expect(s.resumeMode).toBe(State.Nothing);
  });

  /*
   * Ours (asked for 2026-10-22): the first attack at a monster made with
   * `Combat.OpenCmd` and `Combat.OpenWeapon`, the fight going on with
   * `AttackCmd` and the normal weapon once the round it opened ends.
   */
  it('opens on a monster with the opening attack, and bashes once its round ends', () => {
    const { s, out } = fighter([]);
    s.Combat_AttackCmd = 'bash';
    s.Combat_OpenCmd = 'a';
    monster(s, 'giant rat');
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['a giant rat\r']);
    combatEngaged(s, '*Combat Engaged*');
    blowStruck(s);
    combatRoundEnd(s);
    expect(s.attackDue).toBe(1);
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['a giant rat\r', 'bash giant rat\r']);
  });

  it('waits for the opening round to be fought before going on', () => {
    const { s, out } = fighter([]);
    s.Combat_AttackCmd = 'bash';
    s.Combat_OpenCmd = 'a';
    monster(s, 'giant rat');
    runCheck(s);
    combatEngaged(s, '*Combat Engaged*');
    combatRoundEnd(s);
    expect(s.opening).toBe(1);
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['a giant rat\r']);
  });

  it('opens each monster in turn', () => {
    const { s, out } = fighter([]);
    s.Combat_AttackCmd = 'bash';
    s.Combat_OpenCmd = 'a';
    const rat = monster(s, 'giant rat');
    monster(s, 'cave bear');
    runCheck(s);
    combatEngaged(s, '*Combat Engaged*');
    blowStruck(s);
    combatRoundEnd(s);
    runCheck(s);
    s.room.splice(s.room.indexOf(rat), 1);
    s.target = '';
    combatEngaged(s, '*Combat Off*');
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['a giant rat\r', 'bash giant rat\r', 'a cave bear\r']);
  });

  it('wields the opening weapon to open, and the normal weapon after', () => {
    const { s, out } = fighter([]);
    s.Combat_OpenWeapon = 'rusty dagger';
    s.Combat_NrmWeapon = 'broadsword';
    const dagger = newItem(s.data);
    dagger.name = 'rusty dagger';
    const sword = newItem(s.data);
    sword.name = 'broadsword';
    s.inventory = [
      { count: 1, flags: 0, item: dagger },
      { count: 1, flags: 0, item: sword }
    ];
    s.weaponWielded = 'broadsword';
    monster(s, 'giant rat');
    expect(runCheck(s)).toBe(1);
    expect(out.sent).toEqual(['equip rusty dagger\r']);
    setState(s, State.Nothing);
    expect(runCheck(s)).toBe(1);
    expect(out.sent.at(-1)).toBe('a giant rat\r');
    combatEngaged(s, '*Combat Engaged*');
    blowStruck(s);
    combatRoundEnd(s);
    expect(runCheck(s)).toBe(1);
    expect(out.sent.at(-1)).toBe('equip broadsword\r');
  });

  it('is MegaMUD’s own fight with no opening set', () => {
    const { s, out } = fighter([]);
    s.Combat_AttackCmd = 'bash';
    monster(s, 'giant rat');
    runCheck(s);
    combatEngaged(s, '*Combat Engaged*');
    blowStruck(s);
    combatRoundEnd(s);
    expect(s.attackDue).toBe(0);
    expect(out.sent).toEqual(['bash giant rat\r']);
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

  /* Skinny after his `sys goto` (2026-10-21): only `rsto`, never `pghe`. */
  it('heals before it rests, once there', () => {
    const { s, out } = op();
    s.Spells_HealCmd = 'ltch';
    s.Spells_HealCmd2 = 'pghe';
    s.Spells_RegenCmd = 'rsto';
    s.Health_HpHealPct = 90;
    s.data.spells = [spell('ltch', 0x4 | 0x40), spell('pghe', 0x20), spell('rsto', 0x10)];
    escapeCheck(s, '');
    out.sent.length = 0;
    s.state = State.Nothing;
    s.lookDue = 0;
    s.lineFlags |= LineFlag.Prompted;
    expect(schedule(s)).toBe(true);
    expect(out.sent).toEqual(['pghe Skinny\r']);
  });

  /* Fatty after his (2026-10-21): no heal spell, his songs unsung. */
  it('blesses before it rests, once there', () => {
    const { s, out } = op();
    s.MegaMud_AutoBless = 1;
    s.Other_BlessResting = 1;
    s.Spells_BlessCmd1 = 'soot';
    s.data.spells = [spell('soot', 0x10 | 0x2)];
    escapeCheck(s, '');
    out.sent.length = 0;
    s.state = State.Nothing;
    s.lookDue = 0;
    s.lineFlags |= LineFlag.Prompted;
    expect(schedule(s)).toBe(true);
    expect(out.sent).toEqual(['soot\r']);
  });
});
