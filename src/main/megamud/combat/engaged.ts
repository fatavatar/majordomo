/**
 * Combat on and off: `*Combat Engaged*` and `*Combat Off*` (`0x428ab0`),
 * leaving a fight (`0x42c150`), and the small resets around them
 * (`0x42bef0`–`0x42c6c0`, `0x416060`). Read 2026-10-12.
 */
import { stricmp } from '../cstr';
import { escapeCheck } from '../script/escape';
import { send } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import { enemiesHere, findEntity } from '../room/entities';
import type { RoomEntity, Session } from '../Session';
import { isCastState, State } from '../states';
import { inAttackCast, beginCast, castSpellFor } from './casts';
import { EntityFlag, WeaponKind, EntityType, Stance } from '../flags';

/** `0x428ab0`: the two combat frames. 1 when the line was one of them. */
export function combatEngaged(s: Session, line: string): number {
  if (line.indexOf('*Combat Engaged*') === 0) {
    s.combatChanges += 1;
    if (s.debug !== 0 && s.inCombat === 0) s.host.trace(`{C+${s.combatChanges}}`);
    s.inCombat = 1;
    s.combatOnAt = s.now;
    s.partyAttackJoinedAt = 0;
    s.membersOnNewTargets = 0;
    s.memberAttackAt = s.host.tickMs();
    s.attacksRefused = 0;
    if (
      s.state === State.PendingCmd &&
      inAttackCast(s, 1) === 0 &&
      s.engagedMode === State.Nothing
    ) {
      clearCastMode(s);
      if (s.debug !== 0) s.host.trace('{pend1}');
      s.engagedMode = State.Attacking;
      setState(s, State.Attacking);
      s.multiAttacking = 0;
    } else {
      resumeCastMode(s);
    }
    s.multiAttacking =
      (inAttackCast(s, 0) === 0 && inAttackCast(s, 1) === 0) ||
      s.castArea === 0 ||
      s.castUntargeted !== 0
        ? 0
        : 1;
    s.hpFullAt = 0;
    s.manaFullAt = 0;
    s.probablyRoundFought = -1;
    s.roundBlowSeen = 0;
    s.attackDue = 0;
    s.combatOffExpected = 0;
    s.attackSentAt = s.now;
    escapeCheck(s, 'combat engaged');
    return 1;
  }
  if (line.indexOf('*Combat Off*') !== 0) return 0;
  s.combatChanges += 1;
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace(`{C-${s.combatChanges}}`);
  s.inCombat = 0;
  s.combatOffAt = s.now;
  s.roundBlowSeen = 0;
  if (inAttackCast(s, 0) !== 0) resumeCastMode(s);
  if (s.combatOffExpected !== 0 && enemiesHere(s, 0) > 0) {
    if (s.debug !== 0) s.host.trace('{I0-}');
    s.combatOffExpected = 0;
    return 1;
  }
  if (enemiesHere(s, 0) === 0) {
    endAltHeal(s);
    clearAlignment(s);
  } else {
    s.attackDue = 1;
  }
  if (inAttackCast(s, 0) === 0) clearCastMode(s);
  s.probablyRoundFought = 0;
  s.sneaking = 0;
  s.hidden = 0;
  s.engagedMode = State.Nothing;
  clearNoMessageRounds(s);
  if (s.state !== State.Moving) {
    forgetAwaited(s, s.state);
    setState(s, State.Nothing);
  }
  return 1;
}

/**
 * Another spell cast between rounds ends the attack spell the fight was
 * engaged in, as the realm does; it is kept to be picked up again
 * (`Session.resumeMode`).
 */
export function breakOff(s: Session): void {
  if (
    isCastState(s.engagedMode) &&
    s.engagedMode !== State.CastAlt &&
    s.engagedMode !== State.CastUser
  )
    s.resumeMode = s.engagedMode;
  s.engagedMode = State.Nothing;
}

/** `0x42c150`: leave the fight: forget everything about it, and `break` if a multi-attack was on. */
export function combatOff(s: Session): void {
  const multi = s.multiAttacking;
  s.resumeMode = State.Nothing;
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C6}');
  s.inCombat = 0;
  s.attackDue = 0;
  s.combatOffExpected = 0;
  s.probablyRoundFought = 0;
  s.roundBlowSeen = 0;
  s.areaWarned = 0;
  s.multiAttacking = 0;
  s.runCount = 0;
  s.runByChoice = 0;
  s.engagedHere = 0;
  s.attackSentAt = 0;
  s.partyAttackJoinedAt = 0;
  s.stateAwaited = State.Nothing;
  endAltHeal(s);
  clearAlignment(s);
  clearTargetCasts(s);
  clearCastMode(s);
  clearMultiCounts(s);
  if (multi !== 0 && s.BBS_GreaterMUD === 0) {
    s.combatOffExpected = 0;
    s.waitLines = 2;
    send(s, 'break\r');
  }
}

/** `0x42c5b0`: pick the cast mode back up from the state (or the state awaited). */
function resumeCastMode(s: Session): number {
  const mode = inAttackCast(s, 0) !== 0 ? s.state : s.stateAwaited;
  if (isCastState(mode)) {
    const spell = castSpellFor(s, mode, 1);
    if (spell) {
      beginCast(s, mode, spell);
      if (s.inCombat !== 0 && s.now <= s.combatOnAt + 1 && s.state === mode && s.castArea === 1) {
        for (const e of s.room) {
          if (e.type === EntityType.Monster) {
            if (e.kind === Stance.Friend || e.kind === Stance.Unknown) e.kind = Stance.Enemy;
            e.flags |= EntityFlag.Kept | EntityFlag.Fought;
          }
        }
      }
      return 1;
    }
  } else {
    clearCastMode(s);
  }
  return 0;
}

/** `0x42c270`: no spell is being cast in the fight. */
export function clearCastMode(s: Session): void {
  if (s.debug !== 0 && s.castMode !== State.Nothing) s.host.trace('{cc}');
  s.castShort = '';
  s.castName = '';
  s.castMode = State.Nothing;
  s.castMessageSeen = 0;
  s.castJustBegun = 0;
  s.castCountBefore = 0;
  s.castUntargeted = 0;
  s.castArea = 0;
  s.altHeal = 0;
  if (isCastState(s.engagedMode)) s.engagedMode = State.Nothing;
}

/** `0x42c0a0`: the no-message round counters, all modes. */
export function clearNoMessageRounds(s: Session): void {
  s.silentPreMulti = 0;
  s.silentMulti = 0;
  s.silentPre = 0;
  s.silentMain = 0;
  s.silentAux = 0;
  s.silentAlt = 0;
  s.silentUser = 0;
  s.castWatchdogAt = 0;
}

/** `0x42bef0`: the party's "attacking alone" marks and their timers. */
export function clearAlignment(s: Session): void {
  s.membersOnNewTargets = 0;
  s.memberAttackAt = 0;
  s.attackLateAt = 0;
  for (const member of s.party) member.target = '';
}

/** `0x42c110`: the counts, the casts and the target. */
export function clearTargetCasts(s: Session): void {
  clearNoMessageRounds(s);
  clearMainCounts(s);
  s.target = '';
  s.waitingSpellTargeted = 0;
}

/** `0x42c310`: the multi-attack counts. */
export function clearMultiCounts(s: Session): void {
  s.castsPreMulti = 0;
  s.castsMulti = 0;
  s.silentPreMulti = 0;
  s.silentMulti = 0;
  s.multiDamage = 0;
  s.fightDamage = 0;
  s.areaWarned = 0;
}

/** `0x42c360`: the single-target counts and the target's marks. */
export function clearMainCounts(s: Session): void {
  s.castsPre = 0;
  s.castsMain = 0;
  s.castsAux = 0;
  s.castsAlt = 0;
  s.castsUser = 0;
  s.drainCasts = 0;
  s.silentPre = 0;
  s.silentMain = 0;
  s.silentAux = 0;
  s.silentAlt = 0;
  s.silentUser = 0;
  s.partyAttackJoinedAt = 0;
  s.normalWeaponWorked = 0;
  s.altWeaponWorked = 0;
  s.backstabWeaponWorked = 0;
  s.weaponsExhausted = 0;
  s.weaponNoEffect = 0;
  s.noEffectCount = 0;
  s.noEffectTarget = '';
  s.targetProtected = 0;
  s.lastTarget = '';
  s.lastTargetRoom = 0;
  s.weaponsInHand = 0;
  s.weaponsProbing = 0;
  s.weaponsSuspect = 0;
  s.fightDamage = s.multiDamage;
  s.countedTarget = '';
  s.waitingSpellTargeted = 0;
}

/**
 * `0x416060`: a heal cast as the alt attack is over. The alt spell is
 * forgotten, and if it was the spell being cast the cast mode ends too.
 */
export function endAltHeal(s: Session): void {
  if (s.altHeal === 0) return;
  s.altHeal = 0;
  if (s.altSpell === '') return;
  const isHeal =
    (s.Spells_HealCmd2 !== '' && s.altSpell === s.Spells_HealCmd2) ||
    (s.Spells_HealCmd !== '' && s.altSpell === s.Spells_HealCmd);
  if (!isHeal) return;
  if (s.altSpell !== '' && s.castShort !== '' && s.altSpell === s.castShort) {
    clearCastMode(s);
    if (s.state === State.CastAlt) {
      forgetAwaited(s, State.CastAlt);
      setState(s, State.Nothing);
    }
  }
  s.castsAlt = s.altCastCap;
  s.altSpell = '';
}

/** `0x42c490`: the monster being fought is now `name`. */
export function setTarget(s: Session, name: string): void {
  if (name === '') return;
  const e = findEntity(s, name, 1);
  if (!e) {
    if (
      (s.countedTarget === '' || stricmp(s.countedTarget, name) !== 0) &&
      (s.target === '' || stricmp(s.target, name) !== 0)
    ) {
      clearMainCounts(s);
    }
    attackLateMark(s, null);
    s.target = name.slice(0, 99);
    return;
  }
  targetChanged(s, e);
  s.target = e.name.slice(0, 99);
  attackLateMark(s, e);
}

/** `0x427050`: a new target entity resets the counts unless it is the one already marked. */
export function targetChanged(s: Session, e: RoomEntity | null): void {
  if (!e || e.type === EntityType.Item) {
    clearMainCounts(s);
    return;
  }
  if (s.countedTarget !== '' && stricmp(s.countedTarget, e.name) === 0) return;
  clearMainCounts(s);
  s.countedTarget = e.name.slice(0, 0x50);
}

/** `0x4270b0`: with `Party.AttackLate`, note what this character is attacking for the party. */
export function attackLateMark(s: Session, e: RoomEntity | null): void {
  if (s.Party_AttackLate === 0) return;
  s.membersOnNewTargets = 0;
  s.memberAttackAt = s.host.tickMs();
  if (e) {
    const me = s.party.findIndex((m) => stricmp(m.name, s.Player_Name) === 0);
    if (me !== -1) s.party[me]!.target = e.name.slice(0, 30);
  }
}

/** `0x42c6c0`: remember this target as the one last fought, in this room. */
export function rememberTarget(s: Session): void {
  s.lastTarget = s.target.slice(0, 99);
  s.targetCount += 1;
  s.lastTargetRoom = s.roomSignature;
}

/** `0x42c570`: the weapons (`WeaponKind` bits) seen to work on the target. */
export function sawWeapons(s: Session, which: number): void {
  if ((which & WeaponKind.Normal) !== 0) s.normalWeaponWorked = 1;
  if ((which & WeaponKind.Alt) !== 0) s.altWeaponWorked = 1;
  if ((which & WeaponKind.Backstab) !== 0) s.backstabWeaponWorked = 1;
}

/**
 * `0x472ed0`: the monster being fought left. With no hostile monster here the
 * fight is over; otherwise combat drops so the scheduler picks the next one.
 */
export function targetLeft(s: Session): void {
  if (enemiesHere(s, 0) === 0) {
    combatOff(s);
    setState(s, State.Nothing);
    return;
  }
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C10}');
  s.inCombat = 0;
  s.combatOffExpected = 0;
  clearTargetCasts(s);
  clearCastMode(s);
  setState(s, State.Nothing);
}
