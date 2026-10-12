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
import { isCastState } from '../states';
import { f_426ab0, beginCast, castSpellFor } from './casts';

/** `0x428ab0`: the two combat frames. 1 when the line was one of them. */
export function combatEngaged(s: Session, line: string): number {
  if (line.indexOf('*Combat Engaged*') === 0) {
    s.f_324c0 += 1;
    if (s.debug !== 0 && s.inCombat === 0) s.host.trace(`{C+${s.f_324c0}}`);
    s.inCombat = 1;
    s.f_32490 = s.now;
    s.f_324a0 = 0;
    s.f_324a8 = 0;
    s.f_324b0 = s.host.tickMs();
    s.f_dd0c = 0;
    if (s.state === 0x2d && f_426ab0(s, 1) === 0 && s.engagedMode === 0) {
      clearCastMode(s);
      if (s.debug !== 0) s.host.trace('{pend1}');
      s.engagedMode = 0x11;
      setState(s, 0x11);
      s.f_a580 = 0;
    } else {
      resumeCastMode(s);
    }
    s.f_a580 =
      (f_426ab0(s, 0) === 0 && f_426ab0(s, 1) === 0) || s.f_a464 === 0 || s.f_a460 !== 0 ? 0 : 1;
    s.hpFullAt = 0;
    s.manaFullAt = 0;
    s.f_32600 = -1;
    s.f_32604 = 0;
    s.f_e2b8 = 0;
    s.f_e1d8 = 0;
    s.f_322d8 = s.now;
    escapeCheck(s, 'combat engaged');
    return 1;
  }
  if (line.indexOf('*Combat Off*') !== 0) return 0;
  s.f_324c0 += 1;
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace(`{C-${s.f_324c0}}`);
  s.inCombat = 0;
  s.f_32498 = s.now;
  s.f_32604 = 0;
  if (f_426ab0(s, 0) !== 0) resumeCastMode(s);
  if (s.f_e1d8 !== 0 && enemiesHere(s, 0) > 0) {
    if (s.debug !== 0) s.host.trace('{I0-}');
    s.f_e1d8 = 0;
    return 1;
  }
  if (enemiesHere(s, 0) === 0) {
    endAltHeal(s);
    clearAlignment(s);
  } else {
    s.f_e2b8 = 1;
  }
  if (f_426ab0(s, 0) === 0) clearCastMode(s);
  s.f_32600 = 0;
  s.sneaking = 0;
  s.hidden = 0;
  s.engagedMode = 0;
  clearNoMessageRounds(s);
  if (s.state !== 0x16) {
    forgetAwaited(s, s.state);
    setState(s, 0);
  }
  return 1;
}

/** `0x42c150`: leave the fight: forget everything about it, and `break` if a multi-attack was on. */
export function combatOff(s: Session): void {
  const multi = s.f_a580;
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C6}');
  s.inCombat = 0;
  s.f_e2b8 = 0;
  s.f_e1d8 = 0;
  s.f_32600 = 0;
  s.f_32604 = 0;
  s.f_e220 = 0;
  s.f_a580 = 0;
  s.runCount = 0;
  s.f_907c = 0;
  s.f_8be4 = 0;
  s.f_322d8 = 0;
  s.f_324a0 = 0;
  s.stateAwaited = 0;
  endAltHeal(s);
  clearAlignment(s);
  clearTargetCasts(s);
  clearCastMode(s);
  clearMultiCounts(s);
  if (multi !== 0 && s.BBS_GreaterMUD === 0) {
    s.f_e1d8 = 0;
    s.waitLines = 2;
    send(s, 'break\r');
  }
}

/** `0x42c5b0`: pick the cast mode back up from the state (or the state awaited). */
export function resumeCastMode(s: Session): number {
  const mode = f_426ab0(s, 0) !== 0 ? s.state : s.stateAwaited;
  if (isCastState(mode)) {
    const spell = castSpellFor(s, mode, 1);
    if (spell) {
      beginCast(s, mode, spell);
      if (s.inCombat !== 0 && s.now <= s.f_32490 + 1 && s.state === mode && s.f_a464 === 1) {
        for (const e of s.room) {
          if (e.type === 2) {
            if (e.kind === 2 || e.kind === 0) e.kind = 4;
            e.flags |= 0x11;
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
  if (s.debug !== 0 && s.f_a448 !== 0) s.host.trace('{cc}');
  s.castShort = '';
  s.castName = '';
  s.f_a448 = 0;
  s.f_a44c = 0;
  s.f_a450 = 0;
  s.f_a454 = 0;
  s.f_a460 = 0;
  s.f_a464 = 0;
  s.f_e364 = 0;
  if (isCastState(s.engagedMode)) s.engagedMode = 0;
}

/** `0x42c0a0`: the no-message round counters, all modes. */
export function clearNoMessageRounds(s: Session): void {
  s.f_a50c = 0;
  s.f_a510 = 0;
  s.f_a514 = 0;
  s.f_a518 = 0;
  s.f_a51c = 0;
  s.f_a520 = 0;
  s.f_a524 = 0;
  s.f_a458 = 0;
}

/** `0x42bef0`: the party's "attacking alone" marks and their timers. */
export function clearAlignment(s: Session): void {
  s.f_324a8 = 0;
  s.f_324b0 = 0;
  s.f_324b8 = 0;
  for (const member of s.party) member.target = '';
}

/** `0x42c110`: the counts, the casts and the target. */
export function clearTargetCasts(s: Session): void {
  clearNoMessageRounds(s);
  clearMainCounts(s);
  s.target = '';
  s.f_32608 = 0;
}

/** `0x42c310`: the multi-attack counts. */
export function clearMultiCounts(s: Session): void {
  s.f_a3e8 = 0;
  s.f_a3ec = 0;
  s.f_a50c = 0;
  s.f_a510 = 0;
  s.f_a57c = 0;
  s.f_32618 = 0;
  s.f_e220 = 0;
}

/** `0x42c360`: the single-target counts and the target's marks. */
export function clearMainCounts(s: Session): void {
  s.f_a3f0 = 0;
  s.f_a3f4 = 0;
  s.f_a3f8 = 0;
  s.f_a3fc = 0;
  s.f_a400 = 0;
  s.f_a62c = 0;
  s.f_a514 = 0;
  s.f_a518 = 0;
  s.f_a51c = 0;
  s.f_a520 = 0;
  s.f_a524 = 0;
  s.f_324a0 = 0;
  s.f_b100 = 0;
  s.f_b104 = 0;
  s.f_b108 = 0;
  s.f_8bec = 0;
  s.f_b0fc = 0;
  s.f_dd10 = 0;
  s.s_dd14 = '';
  s.f_ddf0 = 0;
  s.lastTarget = '';
  s.f_ddec = 0;
  s.f_df00 = 0;
  s.f_df04 = 0;
  s.f_df08 = 0;
  s.f_32618 = s.f_a57c;
  s.s_a528 = '';
  s.f_32608 = 0;
}

/**
 * `0x416060`: a heal cast as the alt attack is over. The alt spell is
 * forgotten, and if it was the spell being cast the cast mode ends too.
 */
export function endAltHeal(s: Session): void {
  if (s.f_e364 === 0) return;
  s.f_e364 = 0;
  if (s.altSpell === '') return;
  const isHeal =
    (s.Spells_HealCmd2 !== '' && s.altSpell === s.Spells_HealCmd2) ||
    (s.Spells_HealCmd !== '' && s.altSpell === s.Spells_HealCmd);
  if (!isHeal) return;
  if (s.altSpell !== '' && s.castShort !== '' && s.altSpell === s.castShort) {
    clearCastMode(s);
    if (s.state === 0xe) {
      forgetAwaited(s, 0xe);
      setState(s, 0);
    }
  }
  s.f_a3fc = s.f_a410;
  s.altSpell = '';
}

/** `0x42c490`: the monster being fought is now `name`. */
export function setTarget(s: Session, name: string): void {
  if (name === '') return;
  const e = findEntity(s, name, 1);
  if (!e) {
    if (
      (s.s_a528 === '' || stricmp(s.s_a528, name) !== 0) &&
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
  if (!e || e.type === 3) {
    clearMainCounts(s);
    return;
  }
  if (s.s_a528 !== '' && stricmp(s.s_a528, e.name) === 0) return;
  clearMainCounts(s);
  s.s_a528 = e.name.slice(0, 0x50);
}

/** `0x4270b0`: with `Party.AttackLate`, note what this character is attacking for the party. */
export function attackLateMark(s: Session, e: RoomEntity | null): void {
  if (s.Party_AttackLate === 0) return;
  s.f_324a8 = 0;
  s.f_324b0 = s.host.tickMs();
  if (e) {
    const me = s.party.findIndex((m) => stricmp(m.name, s.Player_Name) === 0);
    if (me !== -1) s.party[me]!.target = e.name.slice(0, 30);
  }
}

/** `0x42c6c0`: remember this target as the one last fought, in this room. */
export function rememberTarget(s: Session): void {
  s.lastTarget = s.target.slice(0, 99);
  s.f_dd78 += 1;
  s.f_ddec = s.f_8130;
}

/** `0x42c570`: which of the weapons the server has seen (1 normal, 2 alt, 4 backstab). */
export function sawWeapons(s: Session, which: number): void {
  if ((which & 1) !== 0) s.f_b100 = 1;
  if ((which & 2) !== 0) s.f_b104 = 1;
  if ((which & 4) !== 0) s.f_b108 = 1;
}

/**
 * `0x472ed0`: the monster being fought left. With no hostile monster here the
 * fight is over; otherwise combat drops so the scheduler picks the next one.
 */
export function targetLeft(s: Session): void {
  if (enemiesHere(s, 0) === 0) {
    combatOff(s);
    setState(s, 0);
    return;
  }
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C10}');
  s.inCombat = 0;
  s.f_e1d8 = 0;
  clearTargetCasts(s);
  clearCastMode(s);
  setState(s, 0);
}
