/**
 * Lines about this character's own casting (`0x47c280`): `You cast …`, `You
 * attempt to cast …`, `You have already cast …`, and the refusals (`You may
 * not cast that`, `Your spell has no effect`, `There are no more uses`).
 * Read 2026-10-12.
 *
 * This is where an attack spell's count moves. A line counts for the attack
 * mode the fight is engaged in (`a448`) only when it is that mode's spell:
 * the line names the spell being cast (`castName`), or it is a refusal or an
 * "already cast" for the spell last sent (`0xa588`, the same as `castShort`).
 * Then:
 * - `You cast` counts one, or the whole cap for a spell spent in one message
 *   (`countCast` with `all`), unless the damage line handler reads it as a
 *   hit;
 * - `You attempt to cast` (a fizzle) counts one;
 * - a refusal spends the mode for the fight (+9999) and, for `no effect`,
 *   marks the monster immune to that spell (`0x471060`);
 * - `already cast` drops combat so the scheduler picks again.
 * A spell that is not the fight's (a heal, a blessing) only settles the
 * casting or blessing state, and forgets a regen or full latch when the
 * spell was that one.
 */
import { countCast, f_426ab0, resetNoMessage, spellTakesTarget } from '../combat/casts';
import { clearCastMode, endAltHeal } from '../combat/engaged';
import { hitLine } from '../combat/hits';
import { indexOf, indexOfNoCase, stricmp, strcmp } from '../cstr';
import type { SpellRec } from '../data';
import { markMonsters } from '../room/checkNames';
import { enemiesHere, findEntity } from '../room/entities';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { isCastState } from '../states';
import { castForgotten, castStamp, roundEvent, RoundEvent, spellLocked } from '../combat/timer';

const CAST_OPENINGS = [
  'You cast ',
  'You invoke ',
  'You sing ',
  'You attempt to cast ',
  'You attempt to invoke ',
  'You attempt to sing '
];

/** The counter of each attack mode, for the 9999 a refusal adds. */
const COUNTER: Record<number, string> = {
  9: 'f_a3e8',
  0xa: 'f_a3ec',
  0xb: 'f_a3f0',
  0xc: 'f_a3f8',
  0xd: 'f_a3f4',
  0xe: 'f_a3fc',
  0xf: 'f_a400'
};

/** The spell a mode is configured to cast (`0x47c280`'s fallback). */
function configuredSpell(s: Session, mode: number): SpellRec | null {
  const short: Record<number, string> = {
    9: s.Combat_PreMultAttack,
    0xa: s.Combat_MultAttack,
    0xb: s.Combat_PreAttack,
    0xc: s.Combat_AttackSpl2,
    0xd: s.Combat_AttackSpl,
    0xe: s.altSpell,
    0xf: s.userSpell
  };
  const name = short[mode] ?? '';
  return name !== '' ? findSpell(s, name) : null;
}

function within(s: Session, seconds: number): boolean {
  return s.now - s.f_32320 <= seconds;
}

export function castLine(s: Session, line: string): number {
  let mode = s.state;
  let fightSpell: SpellRec | null = null;
  if (f_426ab0(s, 1) !== 0 && s.castShort !== '') fightSpell = findSpell(s, s.castShort);

  let castMessage = false;
  let namesIt = false;
  for (const opening of CAST_OPENINGS) {
    if (line.startsWith(opening)) {
      castMessage = true;
      if (f_426ab0(s, 1) !== 0 && s.castName !== '' && indexOfNoCase(line, s.castName) !== -1)
        namesIt = true;
      break;
    }
  }
  const refused =
    indexOf(line, 'You may not cast that') !== -1 ||
    indexOf(line, 'Why would you want to cast') !== -1 ||
    indexOf(line, 'Your spell has no effect') !== -1 ||
    indexOf(line, 'There are no more uses') !== -1;
  const already =
    indexOf(line, 'You have already cast ') !== -1 ||
    indexOf(line, 'You have already invoked ') !== -1;
  const lastWasFights =
    f_426ab0(s, 1) !== 0 &&
    s.castShort !== '' &&
    s.lastCast !== '' &&
    stricmp(s.lastCast, s.castShort) === 0;
  const refusedOurs = !castMessage && lastWasFights && (refused || already);
  if (namesIt || refusedOurs) mode = s.f_a448;

  let spell: SpellRec | null = null;
  let area = 0;
  if (isCastState(mode) && s.castShort !== '') {
    spell = fightSpell ?? findSpell(s, s.castShort);
  }
  if (!spell) spell = configuredSpell(s, mode);
  area = spellTakesTarget(spell);
  const counted =
    spell !== null &&
    isCastState(mode) &&
    f_426ab0(s, 1) !== 0 &&
    s.f_a448 === mode &&
    s.castShort !== '' &&
    (namesIt || refusedOurs) &&
    strcmp(spell.short, s.castShort) === 0;

  if (!refused) return castOrAttempt(s, line, mode, counted, area, already);
  return refusal(s, line, mode, counted);
}

/** The success, attempt and "already" half of `0x47c280`. */
function castOrAttempt(
  s: Session,
  line: string,
  mode: number,
  counted: boolean,
  area: number,
  already: boolean
): number {
  if (
    indexOf(line, 'You attempt to cast ') !== -1 ||
    indexOf(line, 'You attempt to invoke ') !== -1 ||
    indexOf(line, 'You attempt to sing ') !== -1
  ) {
    s.spellLocks = 0;
    s.f_322e8 = s.now;
    castStamp(s);
    s.f_e1c4 = 0;
    s.hidden = 0;
    s.engagedMode = 0;
    if (!counted) {
      const st = s.state;
      if (st !== 0x15 && st !== 0x10 && s.stateBefore !== 0x15 && s.stateBefore !== 0x10) return 1;
      if (s.lastCast === s.Spells_RegenCmd) s.hpRegen = 0;
      if (s.lastCast === s.Spells_FluxCmd) s.manaRegen = 0;
      if (s.lastCast === s.Spells_HpFullCmd) s.hpFullCast = 0;
      if (s.lastCast === s.Spells_MaFullCmd) s.manaFullCast = 0;
      s.f_a3e0 += 1;
      if (st === 0x16 && within(s, s.Comms_LagWait + 4)) return 1;
      setState(s, 0);
      return 1;
    }
    if (area !== 0) {
      castForgotten(s);
      s.skipTick = 1;
    }
    if (s.debug !== 0) s.host.trace(`{${s.castShort}^}`);
    s.lineFlags |= 0x20;
    s.f_e1d8 = 0;
    if (area !== 0) {
      s.f_32600 = 1;
      s.f_32604 = 1;
      s.f_3260c = 1;
    }
    countCast(s, mode, 0);
    resetNoMessage(s, mode);
    s.f_a44c = 1;
    return settle(s, area);
  }
  const cast =
    indexOf(line, 'You cast ') !== -1 ||
    indexOf(line, 'You invoke ') !== -1 ||
    indexOf(line, 'You sing ') !== -1;
  if (!cast) {
    if (!already) return 0;
    spellLocked(s);
    s.f_322e8 = s.now;
    s.f_e1c4 = 0;
    s.hidden = 0;
    if (counted) {
      if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C13}');
      s.inCombat = 0;
      s.f_e1d8 = 0;
      s.f_e2b8 = enemiesHere(s, 0) > 0 ? 1 : 0;
      resetNoMessage(s, mode);
      clearCastMode(s);
      setState(s, 0);
      return 1;
    }
    if (s.state === 0x10) {
      const blessing = findSpell(s, s.lastCast);
      if (blessing && blessing.cost === 0 && s.BBS_GreaterMUD === 0) {
        for (let i = 0; i < 10; i += 1) {
          const cmd = blessCommand(s, i);
          if (cmd !== '' && stricmp(s.lastCast, cmd) === 0) {
            s.host.show(`[${s.lastCast} may be misconfigured with 0 mana cost!]`);
            s.blessCastAt[i] = s.now;
            s.blessSeenAt[i] = s.now;
            break;
          }
        }
      }
      s.f_a3e0 += 1;
      setState(s, 0);
      return 1;
    }
    if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C14}');
    s.inCombat = 0;
    if (!(s.state === 0x16 && within(s, s.Comms_LagWait + 4))) setState(s, 0);
    s.f_a3e0 += 1;
    return 1;
  }
  if (s.spellLockStuck !== 0 && s.spellLocks > 2) roundEvent(s, RoundEvent.Probe);
  s.spellLocks = 0;
  s.spellLockStuck = 0;
  if (s.state === 0x10 && !counted) {
    s.f_a3e0 += 1;
    s.f_a3e4 += 1;
    if (s.blessSlot < 0xe && s.blessSlot >= 0) {
      s.blessCastAt[s.blessSlot] = s.now;
      s.blessSeenAt[s.blessSlot] = s.now;
      forgetAwaited(s, 0x10);
      setState(s, 0);
      return 1;
    }
  }
  pvpMarks(s, mode);
  if (!counted) {
    s.f_a3e0 += 1;
    s.f_a3e4 += 1;
    s.f_e1c4 = 0;
    s.hidden = 0;
    s.engagedMode = 0;
    setState(s, 0);
    return 1;
  }
  if (area !== 0) {
    castForgotten(s);
    s.skipTick = 1;
  }
  if (hitLine(s, line) === 0) {
    countCast(s, mode, 1);
    if (s.debug !== 0) s.host.trace(`{${s.castShort}^}`);
    s.lineFlags |= 0x20;
    s.f_322e8 = s.now;
    s.f_e1c4 = 0;
    s.hidden = 0;
    s.f_e1d8 = 0;
    s.f_a44c = 1;
    if (area !== 0) {
      s.f_32600 = 1;
      s.f_32604 = 1;
      s.f_3260c = 1;
      resetNoMessage(s, mode);
      return 1;
    }
    s.f_e2b8 = enemiesHere(s, 0) > 0 ? 1 : 0;
    clearCastMode(s);
    setState(s, 0);
    resetNoMessage(s, mode);
    return 1;
  }
  return settle(s, area);
}

/** `LAB_0047d3dd`: an area spell keeps the cast going; any other ends it. */
function settle(s: Session, area: number): number {
  if (area !== 0) return 1;
  s.f_e2b8 = enemiesHere(s, 0) > 0 ? 1 : 0;
  clearCastMode(s);
  setState(s, 0);
  return 1;
}

/**
 * A cast of a PvP spell marks the player it was cast at: `0x20` for the
 * first, `0x40` for the second (by the pre-attack's spell, or the last sent).
 */
function pvpMarks(s: Session, mode: number): void {
  const isPvp = (short: string): boolean => short === s.PvP_PvpSpell1 || short === s.PvP_PvpSpell2;
  const pre = mode === 0xb && s.castShort !== '' && isPvp(s.castShort);
  if (!pre && !isPvp(s.lastCast)) return;
  const e = findEntity(s, s.target, 0);
  if (!e || e.type !== 1) return;
  const used = (spell: string): boolean =>
    (mode === 0xb && s.castShort !== '' && s.castShort === spell) || s.lastCast === spell;
  if (used(s.PvP_PvpSpell1)) e.flags |= 0x20;
  if (used(s.PvP_PvpSpell2)) e.flags |= 0x40;
}

/** The refusal half of `0x47c280`. */
function refusal(s: Session, line: string, mode: number, counted: boolean): number {
  if (
    !counted &&
    indexOf(line, 'Your spell has no effect') !== -1 &&
    s.state !== 0x15 &&
    s.state !== 0x10 &&
    s.stateBefore !== 0x15 &&
    s.stateBefore !== 0x10
  ) {
    return 0;
  }
  s.f_322e8 = s.now;
  let spent = counted;
  if (s.state === 0x10 && !counted) {
    s.f_a3e0 += 1;
    if (indexOf(line, 'There are no more uses') !== -1 && s.blessSlot >= 0 && s.blessSlot < 0xe) {
      s.blessCastAt[s.blessSlot] = s.now;
      s.blessSeenAt[s.blessSlot] = s.now;
      forgetAwaited(s, 0x10);
      setState(s, 0);
      return 1;
    }
    spent = false;
  }
  if (spent) {
    s.engagedMode = 0;
    const field = COUNTER[mode];
    if (field) {
      const fields = s as unknown as Record<string, number>;
      fields[field] = (fields[field] ?? 0) + 9999;
      if (mode === 0xe && s.f_e364 !== 0) s.f_a62c = s.Spells_HealCasts;
    }
    if (indexOf(line, 'Your spell has no effect') !== -1) markImmune(s, mode);
    if (s.f_e364 !== 0) endAltHeal(s);
    if (s.debug !== 0) s.host.trace(`{${s.castShort}^}`);
    clearCastMode(s);
    resetNoMessage(s, mode);
    s.inCombat = 0;
    forgetAwaited(s, mode);
  } else if (!isCastState(mode)) {
    forgetAwaited(s, mode);
  }
  setState(s, 0);
  s.f_e2b8 = enemiesHere(s, 0) > 0 ? 1 : 0;
  if (mode === 9 || mode === 0xa) {
    s.f_32390 = 0;
    s.f_e290 = 1;
  }
  return 1;
}

/**
 * `Your spell has no effect` on the fight's own spell: the target's monster
 * is marked immune to it (pre-attack 0x800, aux 0x2000, main 0x1000, the
 * heals cast as alt attacks 0x80 and 0x100), remembered by name.
 */
function markImmune(s: Session, mode: number): void {
  const e = findEntity(s, s.target, 0);
  if (!e?.mon || e.mon.name === '' || mode !== s.f_a448) return;
  let flag = 0;
  if (mode === 0xb && s.Combat_PreAttack === s.castShort) flag = 0x800;
  else if (mode === 0xc && s.Combat_AttackSpl2 === s.castShort) flag = 0x2000;
  else if (mode === 0xd && s.Combat_AttackSpl === s.castShort) flag = 0x1000;
  else if (mode === 0xe) {
    if (s.Spells_HealCmd === s.castShort) flag = 0x80;
    else if (s.Spells_HealCmd2 === s.castShort) flag = 0x100;
  }
  if (flag !== 0 && (e.flags & flag) !== flag) {
    markMonsters(s, e.mon.name, flag);
    s.host.show(`[${e.mon.name} now immune to ${immunityText(e.flags | flag)}]`);
  }
}

/** `0x471660`: an entity's immunity flags as MegaMUD names them. */
export function immunityText(flags: number): string {
  const parts: string[] = [];
  if ((flags & 0x80) !== 0) parts.push('OffHealMaj');
  if ((flags & 0x100) !== 0) parts.push('OffHealMin');
  if ((flags & 0x200) !== 0) parts.push('WeapNorm');
  if ((flags & 0x400) !== 0) parts.push('WeapAlt');
  if ((flags & 0x4000) !== 0) parts.push('WeapBS');
  if ((flags & 0x20200) === 0x20000) parts.push('WeapNormX');
  if ((flags & 0x40400) === 0x40000) parts.push('WeapAltX');
  if ((flags & 0x84000) === 0x80000) parts.push('WeapBSX');
  if ((flags & 0x800) !== 0) parts.push('CastPre');
  if ((flags & 0x1000) !== 0) parts.push('CastMain');
  if ((flags & 0x2000) !== 0) parts.push('CastAux');
  return parts.length === 0 ? 'none' : parts.join(', ');
}

/** `Spells.BlessCmd<n>`, 1 to 10, by index 0 to 9. */
export function blessCommand(s: Session, i: number): string {
  const fields = s as unknown as Record<string, string>;
  return fields[`Spells_BlessCmd${i + 1}`] ?? '';
}
