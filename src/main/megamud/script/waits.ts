/**
 * MegaMUD's waits given up on, read 2026-10-12: after two seconds with
 * nothing (`0x40a7e0`), six (`0x40aae0`: a listing or action unanswered),
 * ten (`0x40a6c0`: the room looked at again), thirty (`0x40a9c0`: at full
 * health, the conditions taken as gone) and sixty (`0x40ad70`: not held any
 * more). The timer runs them (`0x464910`), and the same command sent twenty
 * and forty times over runs the ten- and sixty-second ones.
 */
import { abilTimedOut } from '../abilities/monitors';
import { inAttackCast } from '../combat/casts';
import { clearCastMode, clearMultiCounts, clearTargetCasts, combatOff } from '../combat/engaged';
import { heldRows } from '../messages/messages';
import { enemiesHere, findEntity } from '../room/entities';
import { automated, type Session } from '../Session';
import { recheckStats } from '../stats/exp';
import { send } from './send';
import { forgetAwaited, setState } from './state';
import { State } from '../states';
import { LineFlag, WHO_LISTING, INVENTORY_LISTING } from '../flags';

/** The states `0x40aae0` gives up. */
const GIVE_UP = [
  2, 4, 0x15, 0x10, 0x16, 0x20, 0x21, 0x18, 0x19, 0x23, 0x24, 0x25, 0x2b, 0x2c, 0x2d, 0x2e
];

/** `0x40a7e0`: two seconds: a fight's target gone, a finished wait ended. */
export function twoSeconds(s: Session): number {
  if (
    s.inCombat !== 0 ||
    inAttackCast(s, 0) !== 0 ||
    s.state === State.Backstabbing ||
    s.state === State.Attacking
  ) {
    if (s.target !== '' && !findEntity(s, s.target, 0)) {
      if (enemiesHere(s, 0) === 0) {
        combatOff(s);
      } else {
        if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C1}');
        s.inCombat = 0;
        if (s.debug !== 0 && s.combatOffExpected !== 0) s.host.trace('{I1-}');
        s.combatOffExpected = 0;
        clearTargetCasts(s);
        clearCastMode(s);
      }
      if (s.debug !== 0) s.host.trace('{2s1}');
      setState(s, State.Nothing);
    }
  }
  if (s.waitLines > 1 || s.waitPrompt !== 0 || s.equipsPending !== 0) return 0;
  const st = s.state;
  if (st === State.Nothing) {
    if ((s.lineFlags & LineFlag.Prompted) !== 0) return 0;
  } else {
    if (
      st !== State.Blessing &&
      (st < 0x14 || st === State.Moving || st === State.Looking || st === State.Who)
    )
      return 0;
    if (
      st === State.Top ||
      st === State.Inventory ||
      st === State.GetExits ||
      st === State.Training
    )
      return 0;
  }
  s.waitLines = 0;
  s.statPagerUp = 0;
  abilTimedOut(s);
  if (s.state !== State.Nothing) setState(s, State.Nothing);
  if (s.inCombat === 0 || enemiesHere(s, 0) === 0) s.lineFlags |= LineFlag.Prompted;
  if (s.debug !== 0) s.host.trace('{2s2}');
  return 1;
}

/** `0x40aae0`: six seconds: a listing or an action that was never answered. */
export function listingTimedOut(s: Session): number {
  if (s.debug !== 0) s.host.trace('{6s}');
  twoSeconds(s);
  s.equipsPending = 0;
  s.waitPrompt = 0;
  s.statPagerUp = 0;
  abilTimedOut(s);
  if (s.recoveringCorpse !== 0) {
    s.recoveringCorpse = 0;
    s.corpseTried = 1;
    s.weightMax = 0;
    if (s.debug !== 0) s.host.trace('{rc-x}');
  }
  if (!GIVE_UP.includes(s.state)) return 0;
  s.waitLines = 0;
  if (s.state === State.Inventory) {
    s.host.show('[Inventory listing timed out]');
    if ((s.lineFlags & INVENTORY_LISTING) !== 0) {
      s.weightMax = 0;
      s.lineFlags &= ~INVENTORY_LISTING;
    }
    s.inventoryQuietAt = 0;
    s.inventoryStartedAt = 0;
  }
  if (s.state === State.Who) {
    if ((s.lineFlags & WHO_LISTING) !== 0) {
      s.lineFlags &= ~WHO_LISTING;
      // `0x4c2600`: the who window redrawn (left out). A `who` asked again, at most once a minute.
      const t = s.host.tickMs();
      if (s.whoTimedOutAt === 0 || t - s.whoTimedOutAt > 60000) {
        s.whoTimedOutAt = t;
        s.whoDue = -1;
      }
    }
    s.whoQuietAt = 0;
  }
  if (s.state === State.Top) {
    s.lineFlags &= ~LineFlag.TopListing;
    s.topQuietAt = 0;
  }
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C2}');
  s.inCombat = 0;
  s.target = '';
  forgetAwaited(s, s.state);
  setState(s, State.Nothing);
  if (s.inCombat === 0 || enemiesHere(s, 0) === 0) s.lineFlags |= LineFlag.Prompted;
  return 1;
}

/** `0x40a6c0`: ten seconds: everything of a fight dropped, and the room looked at again. */
export function tenSeconds(s: Session): number {
  if (s.debug !== 0) s.host.trace('{10s}');
  twoSeconds(s);
  listingTimedOut(s);
  clearTargetCasts(s);
  clearCastMode(s);
  clearMultiCounts(s);
  s.stealthRefused = 0;
  s.stealthFails = 0;
  s.stepTries = 0;
  s.runDirection = -1;
  s.hideAgain = 0;
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C3}');
  s.inCombat = 0;
  s.partyStepPending = 0;
  s.waitLines = 0;
  s.chaseTarget = '';
  if (s.state !== State.Resting && s.state !== State.Meditating) {
    forgetAwaited(s, s.state);
    setState(s, State.Nothing);
  }
  if (s.allOff === 0) {
    s.host.activity('10-second room refresh');
    send(s, '\r');
  }
  return 1;
}

/** `0x40a9c0`: thirty seconds: at full health, every condition taken as gone. */
export function thirtySeconds(s: Session): number {
  if (s.debug !== 0) s.host.trace('{30s}');
  twoSeconds(s);
  listingTimedOut(s);
  if (s.hp < s.Player_MaxHP || (s.Player_MaxMana >= 1 && s.mana < s.Player_MaxMana)) return 0;
  if (s.allOff === 0 && automated(s)) s.host.alert?.('idle');
  s.blind = 0;
  s.confused = 0;
  s.poisoned = 0;
  s.tooSickToRest = 0;
  s.diseased = 0;
  s.losingHp = 0;
  s.hpRegen = 0;
  s.manaRegen = 0;
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C4}');
  s.inCombat = 0;
  return 1;
}

/** `0x40ad70`: sixty seconds: at full health, not held any more, the stats asked for again. */
export function sixtySeconds(s: Session): number {
  if (s.debug !== 0) s.host.trace('{60s}');
  twoSeconds(s);
  listingTimedOut(s);
  thirtySeconds(s);
  if (s.hp < s.Player_MaxHP || (s.Player_MaxMana >= 1 && s.mana < s.Player_MaxMana)) return 0;
  s.held = 0;
  heldRows(s, 0);
  s.attackPrevented = 0;
  recheckStats(s);
  return 1;
}

/** `0x48b180`: the pending list emptied. */
export function clearPending(s: Session): void {
  s.pending = [];
  s.silentSends = 0;
}
