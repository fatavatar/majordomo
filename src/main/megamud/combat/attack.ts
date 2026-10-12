/**
 * `0x40f510`: open or keep up an attack spell, read 2026-10-12 (its switch,
 * which Ghidra could not follow, taught from the table at `0x410108`).
 *
 * The modes are the attack spells of the Combat tab: 9 pre-multi-attack, 10
 * multi-attack, 11 pre-attack, 12 the second (aux) attack spell, 13 the main
 * attack spell, 14 the alt attack (the drain heal), 15 the user's attack. Each
 * has its spell, its cast cap, the damage it stops at, the mana it needs, and
 * (multi-attacks) how many monsters it wants; a monster's own record can name
 * the pre-attack and attack spells and their casts, and a player in PvP the
 * PvP spells. A mode already engaged casts on, up to 15 times, regardless.
 *
 * Returns 1 when a spell was sent (or is still awaited), 0 otherwise.
 */
import { idiv } from '../cstr';
import { castSpell, equipForSpell } from '../health/cast';
import { allAttackable, currentTarget, enemiesHere } from '../room/entities';
import { forgetAwaited, setState } from '../script/state';
import type { RoomEntity, Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { unported } from '../unported';
import { beginCast, countCast, damageFor, spellTakesTarget } from './casts';
import { attackLateMark, targetChanged } from './engaged';
import { castAllowed } from './timer';

const UNLIMITED = 99999;

interface Plan {
  spell: string;
  label: string;
  monsters: number;
  maxDamage: number;
  cap: number;
  done: number;
  minExp: number;
  manaPct: number;
}

/** The mode is not set up: an attack already under way in it is dropped. */
function notSetUp(s: Session, mode: number): number {
  if (s.state !== mode) return 0;
  if (enemiesHere(s, 0) > 0) s.f_e2b8 = 1;
  forgetAwaited(s, s.state);
  setState(s, 0);
  return 0;
}

/** The mode's settings (`0x40f67d`'s switch), or null when it has no spell. */
function planFor(s: Session, mode: number, e: RoomEntity): Plan | null {
  const ignore = s.Other_IgnoreSpellImmunity;
  const engaged = s.engagedMode === mode;
  const base = { monsters: 0, minExp: 0, manaPct: 0, maxDamage: UNLIMITED };
  switch (mode) {
    case 9:
      if (s.Combat_PreMultAttack === '') return null;
      return {
        spell: s.Combat_PreMultAttack,
        label: 'pre-multi-attack',
        monsters: s.Combat_PreMultMstrCnt,
        maxDamage: s.Combat_PreMultMaxDmg,
        cap: s.Combat_PreMultCastCnt,
        done: s.f_a3e8,
        minExp: 0,
        manaPct: s.Combat_ManaPreMultAttPct
      };
    case 10:
      if (s.Combat_MultAttack === '') return null;
      return {
        spell: s.Combat_MultAttack,
        label: 'multi-attack',
        monsters: s.Combat_MultMstrCnt,
        maxDamage: s.Combat_MultMaxDmg,
        cap: s.Combat_MultCastCnt,
        done: s.f_a3ec,
        minExp: 0,
        manaPct: s.Combat_ManaMultAttPct
      };
    case 0xb:
      if (ignore === 0 && (e.flags & 0x800) !== 0 && !engaged) return null;
      return {
        spell: s.Combat_PreAttack,
        label: 'pre-attack',
        monsters: 0,
        maxDamage: s.Combat_PreMaxDmg,
        cap: s.Combat_PreCastCnt,
        done: s.f_a3f0,
        minExp: s.Combat_PreMinExp,
        manaPct: s.Combat_ManaPreAttPct
      };
    case 0xc: {
      if (ignore === 0 && (e.flags & 0x2000) !== 0 && !engaged) return null;
      const plan = {
        ...base,
        spell: s.Combat_AttackSpl2,
        label: 'aux-spell-attack',
        cap: 999,
        done: s.f_a3f8
      };
      if (s.f_8bec === 0 || ignore !== 0 || (e.flags & 0x1000) === 0) {
        if (
          s.Combat_FailoverSpellAttacks === 0 ||
          ignore !== 0 ||
          (e.flags & 0x1000) === 0 ||
          s.engagedMode === 0xd
        ) {
          plan.minExp = s.Combat_AttMinExp2;
          plan.maxDamage = s.Combat_AttMaxDmg2;
          plan.cap = s.Combat_MaxCastCnt2;
          plan.manaPct = s.Combat_ManaAttack2Pct;
        } else {
          plan.maxDamage = Math.max(s.Combat_AttMaxDmg, s.Combat_AttMaxDmg2);
          plan.cap = Math.max(s.Combat_MaxCastCnt, s.Combat_MaxCastCnt2);
          plan.manaPct = Math.min(s.Combat_ManaAttackPct, s.Combat_ManaAttack2Pct);
        }
      }
      return plan;
    }
    case 0xd: {
      if (ignore === 0 && (e.flags & 0x1000) !== 0 && !engaged) return null;
      const plan = {
        ...base,
        spell: s.Combat_AttackSpl,
        label: 'main-spell-attack',
        cap: 999,
        done: s.f_a3f4
      };
      if (
        s.f_8bec === 0 ||
        (s.Combat_FailoverSpellAttacks !== 0 && (ignore !== 0 || (e.flags & 0x2000) === 0))
      ) {
        plan.maxDamage = s.Combat_AttMaxDmg;
        plan.manaPct = s.Combat_ManaAttackPct;
        plan.cap = s.Combat_MaxCastCnt;
      }
      return plan;
    }
    case 0xe:
      if (s.altSpell === '') return null;
      return { ...base, spell: s.altSpell, label: 'alt-attack', cap: s.f_a410, done: s.f_a3fc };
    default:
      if (s.userSpell === '') return null;
      return { ...base, spell: s.userSpell, label: 'user-attack', cap: 0xf, done: s.f_a400 };
  }
}

/**
 * The spell the target itself calls for: the PvP spells against a player
 * (`0x40f9ae`), else the monster's own pre-attack or attack spell
 * (`0x40faa9`). False when the monster is not worth the attack.
 */
function tailor(s: Session, mode: number, e: RoomEntity, plan: Plan): boolean {
  if (mode === 0xb && e.type === 1) {
    const one = s.PvP_PvpSpell1;
    const two = s.PvP_PvpSpell2;
    if (one !== '' || two !== '') {
      let chosen = '';
      let rec = null;
      if ((e.flags & 0x20) === 0 && one !== '') {
        rec = findSpell(s, one);
        if (rec) chosen = one;
      }
      if (chosen === '' && (e.flags & 0x40) === 0 && two !== '') {
        rec = findSpell(s, two);
        if (rec) chosen = two;
      }
      if (chosen !== '' && rec) {
        plan.spell = chosen.slice(0, 10);
        plan.manaPct = 0;
        plan.monsters = 0;
        plan.cap = ((rec.flags & 2) !== 0 ? 1 : 0) + 1;
        plan.maxDamage = UNLIMITED;
      }
      return true;
    }
  }
  const mon = e.mon;
  if (!mon) return true;
  if (plan.minExp > 0 && mon.exp > 0 && mon.exp < plan.minExp) return false;
  if (mode === 0xb) {
    if (mon.preSpell !== '') {
      plan.spell = mon.preSpell.slice(0, 10);
      if (mon.preMax !== 0) {
        plan.cap = mon.preMax;
        plan.maxDamage = UNLIMITED;
      }
    }
  } else if (mode === 0xc) {
    if (
      mon.attackSpell !== '' &&
      (s.Other_IgnoreSpellImmunity !== 0 || (e.flags & 0x1000) === 0) &&
      s.engagedMode !== 0xc
    ) {
      // The monster's own attack spell goes first; the aux spell waits for its casts.
      if (mon.attackMax < 1) {
        if (s.Combat_MaxCastCnt < 1 || s.f_a3f4 < s.Combat_MaxCastCnt) return false;
      } else if (s.f_a3f4 < mon.attackMax) {
        return false;
      }
    }
  } else if (mode === 0xd) {
    if (mon.attackSpell !== '') {
      plan.spell = mon.attackSpell.slice(0, 10);
      if (mon.attackMax !== 0) {
        plan.cap = mon.attackMax;
        plan.maxDamage = UNLIMITED;
      }
    }
  }
  return true;
}

export function attack(s: Session, mode: number, target: RoomEntity | null): number {
  if (mode < 9 || mode > 0xf) return 0;
  if (s.engagedMode > 0 && s.engagedMode !== mode) return 0;
  if (s.f_a32c !== 0) return 0;
  const casting = s.f_a448;
  if (casting !== 0 && mode !== casting && s.f_a460 !== 0 && s.stateAwaited === casting) {
    if (s.now - s.f_322d8 < s.Comms_LagWait + 4 && s.f_324c0 === s.f_324c4) return 0;
  }
  const e = target ?? currentTarget(s);
  if (!e) return 0;
  const engaged = s.engagedMode === mode;
  if (!engaged) {
    if ((mode === 9 || mode === 10) && e.type === 1) return 0;
    if (mode === 9 && (s.MegaMud_AutoPreAttack === 0 || s.MegaMud_AutoNuke === 0)) {
      return notSetUp(s, mode);
    }
    if (mode === 10 && s.MegaMud_AutoNuke === 0) return notSetUp(s, mode);
    if (mode === 0xb && s.MegaMud_AutoPreAttack === 0) return notSetUp(s, mode);
  }
  const plan = planFor(s, mode, e);
  if (!plan) return 0;
  plan.spell = plan.spell.slice(0, 10);
  if (engaged) {
    plan.cap = 0xf;
    plan.monsters = 0;
    plan.manaPct = 0;
    plan.maxDamage = UNLIMITED;
  } else if (!tailor(s, mode, e, plan)) {
    return 0;
  }
  if (plan.spell === '') return 0;
  if (
    (plan.monsters < 1 || plan.monsters <= enemiesHere(s, s.Combat_AttackNeutral)) &&
    plan.maxDamage !== 0 &&
    plan.cap !== 0 &&
    plan.done < plan.cap &&
    damageFor(s, mode) < plan.maxDamage &&
    (plan.manaPct < 1 || idiv(s.Player_MaxMana * plan.manaPct, 100) <= s.mana)
  ) {
    const sent = cast(s, mode, e, plan);
    if (sent !== null) return sent;
  }
  if (s.state === mode && s.castShort !== '' && plan.spell === s.castShort) {
    if (enemiesHere(s, 0) > 0) s.f_e2b8 = 1;
    forgetAwaited(s, mode);
    setState(s, 0);
  }
  return 0;
}

/** The cast itself, once the mode is due one. Null to fall through to dropping it. */
function cast(s: Session, mode: number, e: RoomEntity, plan: Plan): number | null {
  const rec = findSpell(s, plan.spell);
  if (!rec) {
    s.host.activity(`${plan.label} spell not found`);
    return null;
  }
  if (rec.cost >= 1 && rec.cost > s.mana) return null;
  const twoMessages = (rec.flags & 2) !== 0;
  const same = s.f_a448 === mode && s.castShort !== '' && plan.spell === s.castShort;
  const justSent =
    s.inCombat === 0 && s.now - s.f_322d8 < s.Comms_LagWait + 4 && s.f_324c0 === s.f_324c4;
  let timed: boolean;
  if (s.state === mode) {
    if (s.f_e2b8 !== 0 && (!twoMessages || !same)) {
      timed = twoMessages || !(s.spellLock === 0 || spellTakesTarget(rec) !== 0);
    } else {
      if (s.inCombat !== 0) return 1;
      if (twoMessages) {
        if (s.f_322d8 === 0 || s.now - s.f_322d8 <= s.Comms_LagWait + 3) return 1;
        s.host.show(`[${plan.label}: spell message not seen]`);
        countCast(s, mode, 0);
        return 0;
      }
      if (justSent) return 1;
      timed = !(s.spellLock === 0 || spellTakesTarget(rec) !== 0);
    }
  } else {
    timed = twoMessages || !(s.spellLock === 0 || spellTakesTarget(rec) !== 0);
  }
  if (timed && !castAllowed(s, 0)) return 0;
  if ((rec.flags & 0x80) !== 0) {
    if (s.MegaMud_AutoNuke === 0 && s.engagedMode !== mode) return 0;
    if (allAttackable(s) === 0) {
      if (s.f_e220 === 0) {
        const players = s.PvP_PvpAction === 5 ? '/players' : '';
        s.host.activity(`Area spell not cast because friends${players} in room`);
        s.host.show(`[WARNING: Friends${players} in room - Area spells not used!]`);
      }
      s.f_e220 = 1;
      return 0;
    }
    s.f_e220 = 0;
  }
  if (mode !== 0xf && mode !== 0xe) {
    const equipped = equipForSpell(s, plan.spell);
    if (equipped === 0) {
      if (s.Combat_UseNrmWeapForSpells !== 0 && unported('410f50') !== 0) return 1;
    } else if (equipped === 1) {
      return 1;
    }
  }
  const at = (rec.flags & 0x80) === 0 ? e.name.slice(0, 30) : '';
  if (castSpell(s, plan.spell, at) === 0) return 0;
  s.target = at;
  if ((rec.flags & 0x80) === 0) targetChanged(s, e);
  if (s.f_a448 === 0 || s.inCombat === 0 || spellTakesTarget(rec) === 0) beginCast(s, mode, rec);
  s.f_32604 = 0;
  if (s.f_32600 !== -1 && s.f_e2b8 === 0) s.f_32600 = 0;
  s.f_322d8 = s.now;
  s.f_3260c = 0;
  s.f_e2b8 = 0;
  s.f_8be4 = 1;
  s.f_324c4 = s.f_324c0;
  attackLateMark(s, e);
  setState(s, mode);
  return 1;
}
