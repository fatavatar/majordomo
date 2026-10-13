/**
 * MegaMUD's waits given up on, read 2026-10-12: after two seconds with
 * nothing (`0x40a7e0`), six (`0x40aae0`: a listing or action unanswered),
 * ten (`0x40a6c0`: the room looked at again), thirty (`0x40a9c0`: at full
 * health, the conditions taken as gone) and sixty (`0x40ad70`: not held any
 * more). The timer runs them (`0x464910`), and the same command sent twenty
 * and forty times over runs the ten- and sixty-second ones.
 */
import { abilTimedOut } from '../abilities/monitors';
import { f_426ab0 } from '../combat/casts';
import { clearCastMode, clearMultiCounts, clearTargetCasts, combatOff } from '../combat/engaged';
import { heldRows } from '../messages/messages';
import { enemiesHere, findEntity } from '../room/entities';
import type { Session } from '../Session';
import { recheckStats } from '../stats/exp';
import { send } from './send';
import { forgetAwaited, setState } from './state';

/** The states `0x40aae0` gives up. */
const GIVE_UP = [
  2, 4, 0x15, 0x10, 0x16, 0x20, 0x21, 0x18, 0x19, 0x23, 0x24, 0x25, 0x2b, 0x2c, 0x2d, 0x2e
];

/** `0x40a7e0`: two seconds: a fight's target gone, a finished wait ended. */
export function twoSeconds(s: Session): number {
  if (s.inCombat !== 0 || f_426ab0(s, 0) !== 0 || s.state === 0x12 || s.state === 0x11) {
    if (s.target !== '' && !findEntity(s, s.target, 0)) {
      if (enemiesHere(s, 0) === 0) {
        combatOff(s);
      } else {
        if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C1}');
        s.inCombat = 0;
        if (s.debug !== 0 && s.f_e1d8 !== 0) s.host.trace('{I1-}');
        s.f_e1d8 = 0;
        clearTargetCasts(s);
        clearCastMode(s);
      }
      if (s.debug !== 0) s.host.trace('{2s1}');
      setState(s, 0);
    }
  }
  if (s.waitLines > 1 || s.waitPrompt !== 0 || s.f_a5f8 !== 0) return 0;
  const st = s.state;
  if (st === 0) {
    if ((s.lineFlags & 1) !== 0) return 0;
  } else {
    if (st !== 0x10 && (st < 0x14 || st === 0x16 || st === 0x20 || st === 0x23)) return 0;
    if (st === 0x24 || st === 0x25 || st === 0x2b || st === 0x2c) return 0;
  }
  s.waitLines = 0;
  s.f_e2a0 = 0;
  abilTimedOut(s);
  if (s.state !== 0) setState(s, 0);
  if (s.inCombat === 0 || enemiesHere(s, 0) === 0) s.lineFlags |= 1;
  if (s.debug !== 0) s.host.trace('{2s2}');
  return 1;
}

/** `0x40aae0`: six seconds: a listing or an action that was never answered. */
export function listingTimedOut(s: Session): number {
  if (s.debug !== 0) s.host.trace('{6s}');
  twoSeconds(s);
  s.f_a5f8 = 0;
  s.waitPrompt = 0;
  s.f_e2a0 = 0;
  abilTimedOut(s);
  if (s.f_8558 !== 0) {
    s.f_8558 = 0;
    s.f_e1e4 = 1;
    s.f_8468 = 0;
    if (s.debug !== 0) s.host.trace('{rc-x}');
  }
  if (!GIVE_UP.includes(s.state)) return 0;
  s.waitLines = 0;
  if (s.state === 0x25) {
    s.host.show('[Inventory listing timed out]');
    if ((s.lineFlags & 0x1c00) !== 0) {
      s.f_8468 = 0;
      s.lineFlags &= ~0x1c00;
    }
    s.f_32350 = 0;
    s.f_32358 = 0;
  }
  if (s.state === 0x23) {
    if ((s.lineFlags & 0x380) !== 0) {
      s.lineFlags &= ~0x380;
      // `0x4c2600`: the who window redrawn (left out). A `who` asked again, at most once a minute.
      const t = s.host.tickMs();
      if (s.f_32370 === 0 || t - s.f_32370 > 60000) {
        s.f_32370 = t;
        s.f_e2a4 = -1;
      }
    }
    s.f_32360 = 0;
  }
  if (s.state === 0x24) {
    s.lineFlags &= ~0x40;
    s.f_32368 = 0;
  }
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C2}');
  s.inCombat = 0;
  s.target = '';
  forgetAwaited(s, s.state);
  setState(s, 0);
  if (s.inCombat === 0 || enemiesHere(s, 0) === 0) s.lineFlags |= 1;
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
  s.f_db68 = 0;
  s.f_db6c = 0;
  s.f_db70 = 0;
  s.runDirection = -1;
  s.f_e1d0 = 0;
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C3}');
  s.inCombat = 0;
  s.f_e298 = 0;
  s.waitLines = 0;
  s.chaseTarget = '';
  if (s.state !== 3 && s.state !== 5) {
    forgetAwaited(s, s.state);
    setState(s, 0);
  }
  if (s.f_a32c === 0) {
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
  if (s.f_a32c === 0 && (s.active !== 0 || s.f_e184 !== 0 || s.f_e18c !== 0 || s.f_e178 !== 0))
    s.host.alert?.('idle');
  s.blind = 0;
  s.confused = 0;
  s.poisoned = 0;
  s.f_e1f8 = 0;
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
  s.f_e218 = 0;
  recheckStats(s);
  return 1;
}

/** `0x48b180`: the pending list emptied. */
export function clearPending(s: Session): void {
  s.pending = [];
  s.f_30e14 = 0;
}
