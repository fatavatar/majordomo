/**
 * The end of a combat round, read at the prompt that closes it: the round's
 * damage (`0x425c40`), the attack-cast watchdog (`0x426560`) and the combat
 * reset when nothing has been heard (`0x426420`). Read 2026-10-12.
 */
import type { Session } from '../Session';
import { enemiesHere } from '../room/entities';
import { setState } from '../script/state';
import {
  CAST_COUNTER,
  castCount,
  inAttackCast,
  MODE_LABEL,
  NO_MESSAGE,
  resetNoMessage
} from './casts';
import { clearCastMode, clearNoMessageRounds } from './engaged';
import { currentTarget } from '../room/entities';
import { castForgotten } from './timer';
import { State } from '../states';
import { EntityFlag, EntityType } from '../flags';
import { castTook, roundDealt } from '../stats/window';
import { openingRoundEnded } from './opening';

/**
 * `0x425c40`: a round's damage is shown (`Display.ShowRounds`) and cleared,
 * and with `Party.ParAfterRound` the next party status is due.
 *
 * **Ours, not MegaMUD's (2026-10-27): a leader always asks.** The listing is
 * the only place most members' health shows, and the leader's is the one
 * the Party card reads, so a party's leader asks after every round whatever
 * `ParAfterRound` says; a follower keeps MegaMUD's setting.
 */
export function combatRoundEnd(s: Session): void {
  openingRoundEnded(s, s.roundBlowSeen);
  const parAfter = s.Party_ParAfterRound !== 0 || (s.partySize > 0 && s.following === 0);
  if (s.probablyRoundFought === 0 || s.roundBlowSeen === 0 || s.probablyRoundCounted === 0) {
    s.roundDamage = 0;
    if (!parAfter || s.roundBlowSeen === 0) return;
    s.roundBlowSeen = 0;
    s.probablyRoundCounted = 0;
  } else {
    if (s.Display_ShowRounds !== 0) s.host.show(`(Dmg:${s.roundDamage} Tot:${s.fightDamage})`);
    roundDealt(s, s.roundDamage);
    s.roundDamage = 0;
    s.roundBlowSeen = 0;
    s.probablyRoundCounted = 0;
    if (!parAfter) return;
  }
  s.parAt = 0;
}

/**
 * `0x426560`: a round passed in an attack-cast state. When the count moved,
 * the watch restarts. Otherwise, at most once every 4 seconds, a round with
 * no spell message is counted: at 1 it is noted, at 2 the spell is retried,
 * and past that it is given up for the fight (its count gains 9999) and
 * combat is dropped so the scheduler chooses again.
 */
export function castWatchdog(s: Session): number {
  if (inAttackCast(s, 0) === 0) return 0;
  const mode = s.state;
  if (s.castMode !== mode) return 0;
  const count = castCount(s, mode);
  if (s.castMessageSeen !== 0 || s.castCountBefore < count) {
    resetNoMessage(s, mode);
    s.castMessageSeen = 0;
    s.castCountBefore = count;
    s.castWatchdogAt = 0;
    s.castJustBegun = 0;
    return 0;
  }
  if (s.castJustBegun !== 0) {
    s.castJustBegun = 0;
    return 0;
  }
  const label = MODE_LABEL[mode];
  const field = NO_MESSAGE[mode];
  if (!label || !field) return 0;
  const now = s.host.tickMs();
  if (s.castWatchdogAt !== 0 && now - s.castWatchdogAt < 4000) return 0;
  s.castWatchdogAt = now;
  const rounds = (s[field] as number) + 1;
  (s as unknown as Record<string, number>)[field as string] = rounds;
  if (rounds < 3) {
    if (rounds === 1 || s.state === State.CastUser) {
      s.host.activity(`${label} spell: no spell messages seen`);
      return 1;
    }
    s.host.activity(`Retrying ${label} spell: no spell messages seen`);
  } else {
    castTook(s, mode, 0);
    giveUpSpell(s, mode);
    (s as unknown as Record<string, number>)[field as string] = 0;
    s.host.activity(`Skipping ${label} spell: no spell message seen`);
    s.host.show(`[${s.castShort}: no spell msg seen after multiple rounds]`);
  }
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C7}');
  s.inCombat = 0;
  castForgotten(s);
  s.combatOffExpected = 0;
  clearCastMode(s);
  setState(s, State.Nothing);
  return 1;
}

/**
 * The part of `0x426560` that spends a spell that never answers. A pre-attack
 * on a player marks which PvP spell failed on them (`EntityFlag.PvpSpell1Cast`
 * and `PvpSpell2Cast`) rather than spending the mode.
 */
function giveUpSpell(s: Session, mode: number): void {
  const field = CAST_COUNTER[mode]!;
  const fields = s as unknown as Record<string, number>;
  if (mode === State.CastPre && s.castShort !== '') {
    const isPvp = s.castShort === s.PvP_PvpSpell1 || s.castShort === s.PvP_PvpSpell2;
    if (isPvp) {
      const e = currentTarget(s);
      if (e && e.type === EntityType.Player) {
        if (s.castShort === s.PvP_PvpSpell1) e.flags |= EntityFlag.PvpSpell1Cast;
        if (s.castShort === s.PvP_PvpSpell2) e.flags |= EntityFlag.PvpSpell2Cast;
      }
      return;
    }
  }
  fields[field] = (fields[field] ?? 0) + 9999;
  if (s.altHeal !== 0 && s.state === State.CastAlt) s.drainCasts = s.Spells_HealCasts;
}

/**
 * `0x426420`: in a fight with hostile monsters here, when for 15 seconds
 * there has been no combat message, no round and no move, combat is reset:
 * "Resetting Combat...".
 */
export function resetCombat(s: Session): number {
  if (s.inCombat === 0 || enemiesHere(s, 0) === 0) return 0;
  const quiet = (t: number): boolean => t !== 0 && s.now - t > 0xe;
  if (quiet(s.attackSentAt) && quiet(s.lastHitAt) && quiet(s.movedAt)) {
    s.host.activity('Resetting Combat...');
    s.host.show('[Reset Combat: No player combat messages seen after multiple rounds]');
    s.inCombat = 0;
    s.combatOffExpected = 0;
    s.multiAttacking = 0;
    s.attackDue = 1;
    clearNoMessageRounds(s);
    clearCastMode(s);
    setState(s, State.Nothing);
    s.lookDue = 1;
    return 1;
  }
  return 0;
}
