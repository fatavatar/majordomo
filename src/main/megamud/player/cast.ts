/**
 * Lines about this character's own casting (`0x47c280`): `You cast …`, `You
 * attempt to cast …`, `You have already cast …`, and the refusals (`You may
 * not cast that`, `Your spell has no effect`, `There are no more uses`).
 * Read 2026-10-12.
 *
 * This is where an attack spell's count moves. A line counts for the attack
 * mode the fight is engaged in (`a448`) only when it is that mode's spell:
 * the line names the spell being cast (`castName`), or it is a refusal or an
 * "already cast" for the spell last sent (`lastCast`, the same as `castShort`).
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
import {
  CAST_COUNTER,
  countCast,
  inAttackCast,
  resetNoMessage,
  spellTakesTarget
} from '../combat/casts';
import { breakOff, clearCastMode, endAltHeal } from '../combat/engaged';
import { hitLine } from '../combat/hits';
import { indexOf, indexOfNoCase, stricmp, strcmp } from '../cstr';
import type { SpellRec } from '../data';
import { markImmuneTo, spellKey } from '../combat/immunity';
import { enemiesHere, findEntity } from '../room/entities';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { isCastState, State } from '../states';
import { castForgotten, castStamp, roundEvent, RoundEvent, spellLocked } from '../combat/timer';
import { LineFlag, EntityFlag, EntityType } from '../flags';
import { castTook } from '../stats/window';

const CAST_OPENINGS = [
  'You cast ',
  'You invoke ',
  'You sing ',
  'You attempt to cast ',
  'You attempt to invoke ',
  'You attempt to sing '
];

/** The spell a mode is configured to cast (`0x47c280`'s fallback). */
function configuredSpell(s: Session, mode: number): SpellRec | null {
  const short: Record<number, string> = {
    [State.CastPreMulti]: s.Combat_PreMultAttack,
    [State.CastMulti]: s.Combat_MultAttack,
    [State.CastPre]: s.Combat_PreAttack,
    [State.CastAux]: s.Combat_AttackSpl2,
    [State.CastMain]: s.Combat_AttackSpl,
    [State.CastAlt]: s.altSpell,
    [State.CastUser]: s.userSpell
  };
  const name = short[mode] ?? '';
  return name !== '' ? findSpell(s, name) : null;
}

function within(s: Session, seconds: number): boolean {
  return s.now - s.movedAt <= seconds;
}

export function castLine(s: Session, line: string): number {
  let mode = s.state;
  let fightSpell: SpellRec | null = null;
  if (inAttackCast(s, 1) !== 0 && s.castShort !== '') fightSpell = findSpell(s, s.castShort);

  let castMessage = false;
  let namesIt = false;
  for (const opening of CAST_OPENINGS) {
    if (line.startsWith(opening)) {
      castMessage = true;
      if (inAttackCast(s, 1) !== 0 && s.castName !== '' && indexOfNoCase(line, s.castName) !== -1)
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
    inAttackCast(s, 1) !== 0 &&
    s.castShort !== '' &&
    s.lastCast !== '' &&
    stricmp(s.lastCast, s.castShort) === 0;
  const refusedOurs = !castMessage && lastWasFights && (refused || already);
  if (namesIt || refusedOurs) mode = s.castMode;

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
    inAttackCast(s, 1) !== 0 &&
    s.castMode === mode &&
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
    s.lastHitAt = s.now;
    castStamp(s);
    s.sneaking = 0;
    s.hidden = 0;
    breakOff(s);
    if (!counted) {
      const st = s.state;
      if (
        st !== State.Casting &&
        st !== State.Blessing &&
        s.stateBefore !== State.Casting &&
        s.stateBefore !== State.Blessing
      )
        return 1;
      if (s.lastCast === s.Spells_RegenCmd) s.hpRegen = 0;
      if (s.lastCast === s.Spells_FluxCmd) s.manaRegen = 0;
      if (s.lastCast === s.Spells_HpFullCmd) s.hpFullCast = 0;
      if (s.lastCast === s.Spells_MaFullCmd) s.manaFullCast = 0;
      s.castAnswered += 1;
      if (st === State.Moving && within(s, s.Comms_LagWait + 4)) return 1;
      setState(s, State.Nothing);
      return 1;
    }
    if (area !== 0) {
      castForgotten(s);
      s.skipTick = 1;
    }
    if (s.debug !== 0) s.host.trace(`{${s.castShort}^}`);
    s.lineFlags |= LineFlag.FightLineSeen;
    s.combatOffExpected = 0;
    if (area !== 0) {
      s.probablyRoundFought = 1;
      s.roundBlowSeen = 1;
      s.probablyRoundCounted = 1;
    }
    castTook(s, mode, 0);
    countCast(s, mode, 0);
    resetNoMessage(s, mode);
    s.castMessageSeen = 1;
    return settle(s, area);
  }
  const cast =
    indexOf(line, 'You cast ') !== -1 ||
    indexOf(line, 'You invoke ') !== -1 ||
    indexOf(line, 'You sing ') !== -1;
  if (!cast) {
    if (!already) return 0;
    spellLocked(s);
    s.lastHitAt = s.now;
    s.sneaking = 0;
    s.hidden = 0;
    if (counted) {
      if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C13}');
      s.inCombat = 0;
      s.combatOffExpected = 0;
      s.attackDue = enemiesHere(s, 0) > 0 ? 1 : 0;
      resetNoMessage(s, mode);
      clearCastMode(s);
      setState(s, State.Nothing);
      return 1;
    }
    if (s.state === State.Blessing) {
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
      s.castAnswered += 1;
      setState(s, State.Nothing);
      return 1;
    }
    if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C14}');
    s.inCombat = 0;
    if (!(s.state === State.Moving && within(s, s.Comms_LagWait + 4))) setState(s, State.Nothing);
    s.castAnswered += 1;
    return 1;
  }
  if (s.spellLockStuck !== 0 && s.spellLocks > 2) roundEvent(s, RoundEvent.Probe);
  s.spellLocks = 0;
  s.spellLockStuck = 0;
  if (s.state === State.Blessing && !counted) {
    s.castAnswered += 1;
    s.castTook += 1;
    if (s.blessSlot < 0xe && s.blessSlot >= 0) {
      s.blessCastAt[s.blessSlot] = s.now;
      s.blessSeenAt[s.blessSlot] = s.now;
      forgetAwaited(s, State.Blessing);
      setState(s, State.Nothing);
      return 1;
    }
  }
  pvpMarks(s, mode);
  if (!counted) {
    s.castAnswered += 1;
    s.castTook += 1;
    s.sneaking = 0;
    s.hidden = 0;
    breakOff(s);
    setState(s, State.Nothing);
    return 1;
  }
  if (area !== 0) {
    castForgotten(s);
    s.skipTick = 1;
  }
  if (hitLine(s, line) === 0) {
    castTook(s, mode, 1);
    countCast(s, mode, 1);
    if (s.debug !== 0) s.host.trace(`{${s.castShort}^}`);
    s.lineFlags |= LineFlag.FightLineSeen;
    s.lastHitAt = s.now;
    s.sneaking = 0;
    s.hidden = 0;
    s.combatOffExpected = 0;
    s.castMessageSeen = 1;
    if (area !== 0) {
      s.probablyRoundFought = 1;
      s.roundBlowSeen = 1;
      s.probablyRoundCounted = 1;
      resetNoMessage(s, mode);
      return 1;
    }
    s.attackDue = enemiesHere(s, 0) > 0 ? 1 : 0;
    clearCastMode(s);
    setState(s, State.Nothing);
    resetNoMessage(s, mode);
    return 1;
  }
  return settle(s, area);
}

/** `LAB_0047d3dd`: an area spell keeps the cast going; any other ends it. */
function settle(s: Session, area: number): number {
  if (area !== 0) return 1;
  s.attackDue = enemiesHere(s, 0) > 0 ? 1 : 0;
  clearCastMode(s);
  setState(s, State.Nothing);
  return 1;
}

/**
 * A cast of a PvP spell marks the player it was cast at: `0x20` for the
 * first, `0x40` for the second (by the pre-attack's spell, or the last sent).
 */
function pvpMarks(s: Session, mode: number): void {
  const isPvp = (short: string): boolean => short === s.PvP_PvpSpell1 || short === s.PvP_PvpSpell2;
  const pre = mode === State.CastPre && s.castShort !== '' && isPvp(s.castShort);
  if (!pre && !isPvp(s.lastCast)) return;
  const e = findEntity(s, s.target, 0);
  if (!e || e.type !== EntityType.Player) return;
  const used = (spell: string): boolean =>
    (mode === State.CastPre && s.castShort !== '' && s.castShort === spell) || s.lastCast === spell;
  if (used(s.PvP_PvpSpell1)) e.flags |= EntityFlag.PvpSpell1Cast;
  if (used(s.PvP_PvpSpell2)) e.flags |= EntityFlag.PvpSpell2Cast;
}

/** The refusal half of `0x47c280`. */
function refusal(s: Session, line: string, mode: number, counted: boolean): number {
  if (
    !counted &&
    indexOf(line, 'Your spell has no effect') !== -1 &&
    s.state !== State.Casting &&
    s.state !== State.Blessing &&
    s.stateBefore !== State.Casting &&
    s.stateBefore !== State.Blessing
  ) {
    return 0;
  }
  s.lastHitAt = s.now;
  let spent = counted;
  if (s.state === State.Blessing && !counted) {
    s.castAnswered += 1;
    if (indexOf(line, 'There are no more uses') !== -1 && s.blessSlot >= 0 && s.blessSlot < 0xe) {
      s.blessCastAt[s.blessSlot] = s.now;
      s.blessSeenAt[s.blessSlot] = s.now;
      forgetAwaited(s, State.Blessing);
      setState(s, State.Nothing);
      return 1;
    }
    spent = false;
  }
  if (spent) {
    s.engagedMode = State.Nothing;
    const field = CAST_COUNTER[mode];
    if (field) {
      const fields = s as unknown as Record<string, number>;
      fields[field] = (fields[field] ?? 0) + 9999;
      if (mode === State.CastAlt && s.altHeal !== 0) s.drainCasts = s.Spells_HealCasts;
    }
    if (indexOf(line, 'Your spell has no effect') !== -1) markImmune(s, mode);
    if (s.altHeal !== 0) endAltHeal(s);
    if (s.debug !== 0) s.host.trace(`{${s.castShort}^}`);
    clearCastMode(s);
    resetNoMessage(s, mode);
    s.inCombat = 0;
    forgetAwaited(s, mode);
  } else if (!isCastState(mode)) {
    forgetAwaited(s, mode);
  }
  setState(s, State.Nothing);
  s.attackDue = enemiesHere(s, 0) > 0 ? 1 : 0;
  if (mode === State.CastPreMulti || mode === State.CastMulti) {
    s.roomLookedAt = 0;
    s.lookDue = 1;
  }
  return 1;
}

/**
 * `Your spell has no effect` on the fight's own spell: the target's monster
 * is marked immune to it, remembered by name. MegaMUD marks the rung (pre-
 * attack 0x800, aux 0x2000, main 0x1000, the heals cast as alt attacks 0x80
 * and 0x100); the mark here is the spell itself, and the rung bits follow
 * from it (`combat/immunity.ts`, 2026-10-21).
 */
function markImmune(s: Session, mode: number): void {
  const e = findEntity(s, s.target, 0);
  if (!e?.mon || e.mon.name === '' || mode !== s.castMode || s.castShort === '') return;
  const rung =
    mode === State.CastPre ||
    mode === State.CastAux ||
    mode === State.CastMain ||
    (mode === State.CastAlt &&
      (spellKey(s, s.Spells_HealCmd) === spellKey(s, s.castShort) ||
        spellKey(s, s.Spells_HealCmd2) === spellKey(s, s.castShort)));
  if (rung && markImmuneTo(s, e.mon.name, s.castShort)) {
    s.host.show(`[${e.mon.name} now immune to ${s.castName || s.castShort}]`);
  }
}

/** `0x471660`: an entity's immunity flags as MegaMUD names them. */
export function immunityText(flags: number): string {
  const parts: string[] = [];
  if ((flags & EntityFlag.ImmuneMainDrain) !== 0) parts.push('OffHealMaj');
  if ((flags & EntityFlag.ImmuneMinorDrain) !== 0) parts.push('OffHealMin');
  if ((flags & EntityFlag.ImmuneNormalWeapon) !== 0) parts.push('WeapNorm');
  if ((flags & EntityFlag.ImmuneAltWeapon) !== 0) parts.push('WeapAlt');
  if ((flags & EntityFlag.ImmuneBackstabWeapon) !== 0) parts.push('WeapBS');
  if (
    (flags & (EntityFlag.ImmuneNormalWeapon | EntityFlag.MaybeImmuneNormalWeapon)) ===
    EntityFlag.MaybeImmuneNormalWeapon
  )
    parts.push('WeapNormX');
  if (
    (flags & (EntityFlag.ImmuneAltWeapon | EntityFlag.MaybeImmuneAltWeapon)) ===
    EntityFlag.MaybeImmuneAltWeapon
  )
    parts.push('WeapAltX');
  if (
    (flags & (EntityFlag.ImmuneBackstabWeapon | EntityFlag.MaybeImmuneBackstabWeapon)) ===
    EntityFlag.MaybeImmuneBackstabWeapon
  )
    parts.push('WeapBSX');
  if ((flags & EntityFlag.ImmunePreCast) !== 0) parts.push('CastPre');
  if ((flags & EntityFlag.ImmuneMainCast) !== 0) parts.push('CastMain');
  if ((flags & EntityFlag.ImmuneAuxCast) !== 0) parts.push('CastAux');
  return parts.length === 0 ? 'none' : parts.join(', ');
}

/** `Spells.BlessCmd<n>`, 1 to 10, by index 0 to 9. */
export function blessCommand(s: Session, i: number): string {
  const fields = s as unknown as Record<string, string>;
  return fields[`Spells_BlessCmd${i + 1}`] ?? '';
}
