/**
 * The attack casts: the modes, their counters and the tests on them
 * (`0x425b60`–`0x426b00`). See docs/megamud/megamud-exe.md, *Attack casts*.
 */
import type { SpellRec } from '../data';
import { allAttackable, currentTarget, enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { isCastState } from '../states';

/**
 * `0x426ab0`: whether the state (`which` 0) or the attack mode the fight is
 * engaged in (`a448`, any other `which`) is one of the attack casts, 9 to 15.
 */
export function f_426ab0(s: Session, which: number): number {
  const mode = which === 0 ? s.state : s.f_a448;
  return isCastState(mode) ? 1 : 0;
}

/** `0x425f70`: how many casts the mode has counted this fight (`0x15`: the plain cast's). */
export function castCount(s: Session, mode: number): number {
  switch (mode) {
    case 9:
      return s.f_a3e8;
    case 0xa:
      return s.f_a3ec;
    case 0xb:
      return s.f_a3f0;
    case 0xc:
      return s.f_a3f8;
    case 0xd:
      return s.f_a3f4;
    case 0xe:
      return s.f_a3fc;
    case 0xf:
      return s.f_a400;
    case 0x15:
      return s.f_a3e4;
    default:
      return 0;
  }
}

/** The cast counter of each attack mode (`0x425b60`'s table). */
const COUNTER: Record<number, keyof Session> = {
  9: 'f_a3e8',
  0xa: 'f_a3ec',
  0xb: 'f_a3f0',
  0xc: 'f_a3f8',
  0xd: 'f_a3f4',
  0xe: 'f_a3fc',
  0xf: 'f_a400'
};

/** The no-message round counter of each attack mode (`0x426560`'s table). */
export const NO_MESSAGE: Record<number, keyof Session> = {
  9: 'f_a50c',
  0xa: 'f_a510',
  0xb: 'f_a514',
  0xc: 'f_a51c',
  0xd: 'f_a518',
  0xe: 'f_a520',
  0xf: 'f_a524'
};

/** The log label of each attack mode. */
export const MODE_LABEL: Record<number, string> = {
  9: 'pre-multi-attack',
  0xa: 'multi-attack',
  0xb: 'pre-attack',
  0xc: 'aux-attack',
  0xd: 'main-attack',
  0xe: 'alt-attack',
  0xf: 'user-attack'
};

function get(s: Session, field: keyof Session): number {
  return s[field] as number;
}

function put(s: Session, field: keyof Session, value: number): void {
  (s as unknown as Record<string, number>)[field as string] = value;
}

/**
 * `0x425b60`: one cast counted for `mode`. With `all`, a pre-multi, pre,
 * alt or user spell whose record has `+0x54 & 2` is spent at once: its
 * counter rises to the cap.
 */
export function countCast(s: Session, mode: number, all: number): void {
  const field = COUNTER[mode];
  if (!field) return;
  if (s.f_e364 !== 0 && mode === 0xe) s.f_a62c += 1;
  if (all !== 0 && (mode === 9 || mode === 0xb || mode === 0xe || mode === 0xf)) {
    const spell = castSpellFor(s, mode, 0);
    if (spell && (spell.flags & 2) !== 0) {
      const cap = castCap(s, mode);
      if (get(s, field) < cap) put(s, field, cap);
      return;
    }
  }
  put(s, field, get(s, field) + 1);
}

/** `0x42c000`: the mode's no-message rounds go back to 0. */
export function resetNoMessage(s: Session, mode: number): void {
  const field = NO_MESSAGE[mode];
  if (field) put(s, field, 0);
}

/**
 * `0x425d90`: the spell `mode` casts. Unless `fresh`, the spell already being
 * cast (`castShort`) wins. The pre-attack and main attack take the target's
 * own spells from its monster record when it has them; a pre-attack on a
 * player takes the PvP spells it has not yet been spent on.
 */
export function castSpellFor(s: Session, mode: number, fresh: number): SpellRec | null {
  if (fresh === 0 && s.castShort !== '') {
    const spell = findSpell(s, s.castShort);
    if (spell) return spell;
  }
  let short = '';
  switch (mode) {
    case 9:
      short = s.Combat_PreMultAttack;
      break;
    case 0xa:
      short = s.Combat_MultAttack;
      break;
    case 0xb: {
      const e = currentTarget(s);
      if (e) {
        if (e.type === 1) {
          if (s.PvP_PvpSpell1 !== '' && (e.flags & 0x20) === 0)
            return findSpell(s, s.PvP_PvpSpell1);
          if (s.PvP_PvpSpell2 !== '' && (e.flags & 0x40) === 0)
            return findSpell(s, s.PvP_PvpSpell2);
        }
        if (e.mon && e.mon.preSpell !== '') return findSpell(s, e.mon.preSpell);
      }
      short = s.Combat_PreAttack;
      break;
    }
    case 0xc:
      short = s.Combat_AttackSpl2;
      break;
    case 0xd: {
      const e = currentTarget(s);
      if (e?.mon && e.mon.attackSpell !== '') return findSpell(s, e.mon.attackSpell);
      short = s.Combat_AttackSpl;
      break;
    }
    case 0xe:
      short = s.altSpell;
      break;
    case 0xf:
      short = s.userSpell;
      break;
    default:
      return null;
  }
  return short !== '' ? findSpell(s, short) : null;
}

/** `0x426030`: the damage the mode is weighed against (multi-attacks: the room's; others: the fight's). */
export function damageFor(s: Session, mode: number): number {
  return mode !== 9 && mode !== 0xa ? s.f_32618 : s.f_a57c;
}

/**
 * `0x426060`: how many casts `mode` gets, at least 1. The pre-attack takes
 * the target's own count from its monster record when that is set.
 */
function castCap(s: Session, mode: number): number {
  let cap = 1;
  switch (mode) {
    case 9:
      return Math.max(1, s.Combat_PreMultCastCnt);
    case 0xa:
      return Math.max(1, s.Combat_MultCastCnt);
    case 0xb: {
      cap = s.Combat_PreCastCnt;
      const e = currentTarget(s);
      if (e?.mon && e.mon.preMax !== 0) return Math.max(1, e.mon.preMax);
      break;
    }
    case 0xc:
      return Math.max(1, s.Combat_MaxCastCnt2);
    case 0xd:
      return Math.max(1, s.Combat_MaxCastCnt);
    case 0xe:
      cap = s.f_a410;
      break;
    case 0xf:
      return 0xf;
    default:
      return cap;
  }
  return Math.max(1, cap);
}

/**
 * `0x4241d0`: the fight now casts `mode`, with `spell` (or none). Its count
 * so far is noted, so a round without a message can be told apart.
 */
export function beginCast(s: Session, mode: number, spell: SpellRec | null): void {
  s.f_a448 = mode;
  s.f_a44c = 0;
  s.f_a450 = 1;
  s.f_a454 = castCount(s, mode);
  if (!spell) {
    s.castShort = '';
    s.castName = '';
    s.f_a460 = 0;
    s.f_a464 = 0;
  } else {
    s.castShort = spell.short.slice(0, 0x50);
    s.castName = spell.name.slice(0, 0x50);
    s.f_a460 = spellTakesTarget(spell) === 0 ? 1 : 0;
    s.f_a464 = (spell.flags >> 7) & 1;
  }
  if (s.debug !== 0) s.host.trace(`{cc-${s.castShort}${s.castName}}`);
}

/** `0x42c6a0`: a spell flagged `4` without `2` (an area spell that is not a one-message kill). */
export function spellTakesTarget(spell: SpellRec | null): number {
  if (spell && (spell.flags & 4) !== 0) return ~(spell.flags >> 1) & 1;
  return 0;
}

/**
 * `0x42c700`: whether to open on a room spell. Auto-combat and AutoNuke on,
 * hostile monsters here, and (unless `anyway`) everyone here attackable
 * (`0x4749d0`); then the pre-multi-attack when its monster count is reached
 * and it has casts and damage left (or is already engaged), else the
 * multi-attack on the same terms.
 */
export function wantsRoomSpell(s: Session, anyway: number): number {
  if (s.f_a32c !== 0 || s.MegaMud_AutoCombat === 0 || s.MegaMud_AutoNuke === 0) return 0;
  const n = enemiesHere(s, s.Combat_AttackNeutral);
  if (n === 0) return 0;
  if (anyway === 0 && allAttackable(s) === 0) return 0;
  if (
    s.MegaMud_AutoPreAttack !== 0 &&
    s.Combat_PreMultAttack !== '' &&
    s.Combat_PreMultMstrCnt <= n
  ) {
    if (s.f_a3e8 < s.Combat_PreMultCastCnt && s.f_a57c < s.Combat_PreMultMaxDmg) return 1;
    if (s.engagedMode === 9) return 1;
  }
  if (
    s.Combat_MultAttack !== '' &&
    s.Combat_MultMstrCnt <= n &&
    ((s.f_a3ec < s.Combat_MultCastCnt && s.f_a57c < s.Combat_MultMaxDmg) || s.engagedMode === 0xa)
  ) {
    return 1;
  }
  return 0;
}

/** `0x426d70`: a multi-attack under way still has its reasons (monsters, casts, damage). */
export function multiStillWanted(s: Session): boolean {
  if (s.f_a580 === 0) return false;
  const n = enemiesHere(s, 0);
  if (n < 1) return false;
  const st = s.state;
  if (st === 0xf) {
    const spell = s.userSpell !== '' ? findSpell(s, s.userSpell) : null;
    return spellTakesTarget(spell) !== 0;
  }
  if (st === 9) {
    let spell = s.castShort !== '' ? findSpell(s, s.castShort) : null;
    if (!spell && s.Combat_PreMultAttack !== '') spell = findSpell(s, s.Combat_PreMultAttack);
    return (
      spellTakesTarget(spell) !== 0 &&
      s.Combat_PreMultMstrCnt <= n &&
      s.f_a3e8 < s.Combat_PreMultCastCnt &&
      s.f_a57c < s.Combat_PreMultMaxDmg
    );
  }
  if (st !== 0xa) return false;
  return (
    n >= s.Combat_MultMstrCnt && s.f_a3ec < s.Combat_MultCastCnt && s.f_a57c < s.Combat_MultMaxDmg
  );
}
