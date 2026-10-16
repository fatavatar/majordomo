/**
 * `0x40bab0`: one pass of MegaMUD's scheduler, run when a chunk ends on a
 * prompt (`0x479630`). It does at most one thing a pass: the first step that
 * sends ends it. Read 2026-10-12; docs/megamud/engine-port.md has the table.
 *
 * Before the steps:
 * - an action state (above 0x14) not answered within `LagWait + 9` seconds,
 *   with nothing heard for ten, is given up ("[Bueller?]");
 * - after a room spell, while a room refresh is awaited, or idle with the
 *   room asked for, the room is looked at again (a bare Enter);
 * - with no hostile monster here, anything left of a fight is cleared;
 * - one pending command is sent (at most five passes running).
 */
import { abilityMonitors } from '../abilities/monitors';
import { recoverCorpse } from '../player/corpse';
import { combatOff } from '../combat/engaged';
import { healStep } from '../health/heal';
import { healthStep } from '../health/rest';
import { enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { refreshStatus } from '../status';
import { blessStep } from './bless';
import { depositCash, discardCash, shareCash, stashItems, withdrawCash } from './cash';
import { combatStep } from '../combat/heal';
import { cureStep, selfCures } from './cures';
import { escapeCheck } from './escape';
import { eventsStep } from './events';
import { exitStep } from './exit';
import { goOnline } from './game';
import { autoEquip, buyItems, collectItems, sellItems } from './items';
import { roomCheck, searchRoom } from './misc';
import { rulesStep } from './rules';
import { invitePlayers, lookAtPlayer, partyStatus, trackPlayer } from './party';
import { noAllowedExits, pathCommands, walkPath } from './path';
import { runCheck } from './run';
import { pendingPump, send } from './send';
import { gameSetup, refreshInventory, refreshStats, refreshWho } from './setup';
import { listingTimedOut } from './waits';
import { forgetAwaited, setState } from './state';
import { hideStep, sneakStep } from './stealth';
import { State } from '../states';
import { LineFlag, PROMPT_SEEN, Darkness } from '../flags';
import { Task } from './task';

/** Nothing of a fight is left (`0x40c07d`'s long test). */
function fightClear(s: Session): boolean {
  return (
    s.castsPreMulti === 0 &&
    s.castsMulti === 0 &&
    s.castsPre === 0 &&
    s.castsAlt === 0 &&
    s.castsMain === 0 &&
    s.castsUser === 0 &&
    s.silentPreMulti === 0 &&
    s.silentMulti === 0 &&
    s.silentPre === 0 &&
    s.silentAlt === 0 &&
    s.silentMain === 0 &&
    s.silentUser === 0 &&
    s.castMode === State.Nothing &&
    s.countedTarget === '' &&
    s.target === '' &&
    s.weaponNoEffect === 0 &&
    s.areaWarned === 0 &&
    s.normalWeaponWorked === 0 &&
    s.altWeaponWorked === 0 &&
    s.backstabWeaponWorked === 0 &&
    s.multiAttacking === 0 &&
    s.castUntargeted === 0 &&
    s.castArea === 0 &&
    s.weaponsExhausted === 0 &&
    s.weaponsProbing === 0 &&
    s.weaponsSuspect === 0
  );
}

/** Look at the room again: a bare Enter, then two lines to wait for. */
function lookAgain(s: Session, step: number, what: string, setLooking: boolean): boolean {
  s.roomLookedAt = s.now;
  s.lookDue = 0;
  if (step === 6) s.redisplayDue = 1;
  s.waitLines = 2;
  s.lineFlags &= ~PROMPT_SEEN;
  if (setLooking && step === 8) setState(s, State.GetExits);
  if (setLooking && step === 7) setState(s, State.GetExits);
  s.host.activity(what);
  if (s.debug !== 0) s.host.trace(`{D${step}}`);
  send(s, '\r');
  return true;
}

export function schedule(s: Session): boolean {
  s.lineRunChecked = 0;
  if (s.inGame === 0) return false;
  if (s.online === 0) goOnline(s, 1);
  if ((s.lineFlags & LineFlag.Prompted) === 0) return false;
  if (s.unknown_e57c !== 0) return false;
  if (s.state === State.Moving && s.held !== 0) {
    forgetAwaited(s, State.Moving);
    setState(s, State.Nothing);
  }
  if (s.state > State.Unknown_14) {
    if (s.now - s.stateSince < s.Comms_LagWait + 9) return false;
    if (s.allOff !== 0) return false;
    if (s.now - s.probablyLastTypedAt < 10) return false;
    if (listingTimedOut(s) !== 0) return true;
    s.host.trace('[Bueller?]');
    s.inCombat = 0;
    s.target = '';
    forgetAwaited(s, s.state);
    setState(s, State.Nothing);
    s.lookDue = 1;
    return true;
  }
  if (s.task === Task.Exiting) return false;
  let sent = 0;
  let step = 5;
  if (s.setupDue !== 0 && s.setupDone === 0) s.pendingStreak = 0;
  if (s.pendingStreak < 5) sent = pendingPump(s);
  if (sent === 0) {
    s.pendingStreak = 0;
  } else {
    s.pendingStreak += 1;
    if (s.debug !== 0) s.host.trace(`{D5:${s.pendingStreak}}`);
  }
  const lit = s.blind === 0 && s.darkness < Darkness.Dark;
  if (
    s.lookDue === 1 &&
    lit &&
    s.allOff === 0 &&
    s.task !== Task.Exiting &&
    (s.multiAttacking === 1 || (s.stateAwaited !== State.Nothing && s.state === s.stateAwaited))
  ) {
    if (s.inCombat === 0 || s.now - s.roomLookedAt > s.Comms_LagWait + 1) {
      return lookAgain(s, 6, 'Refreshing room after room spell', false);
    }
  }
  if (s.redisplayDue === 1 && lit) {
    if (s.now - s.roomLookedAt < s.Comms_LagWait + 3) return true;
    return lookAgain(s, 7, 'Re-displaying room', true);
  }
  if (
    s.lookDue === 1 &&
    lit &&
    s.allOff === 0 &&
    s.task !== Task.Exiting &&
    (s.state === State.Nothing ||
      s.state === State.Resting ||
      s.state === State.Meditating ||
      s.state === State.Poisoned ||
      s.state === State.Hiding)
  ) {
    if (s.now - s.roomLookedAt < s.Comms_LagWait + 2) return true;
    return lookAgain(s, 8, 'Re-displaying room', true);
  }
  if (enemiesHere(s, s.Combat_AttackNeutral) === 0 && !fightClear(s)) combatOff(s);
  if (s.equipsPending > 0) return false;
  if (s.healthFirst !== 0 && enemiesHere(s, 0) === 0) {
    step = 10;
    if (healthStep(s) !== 0) return true;
  }
  if (s.allOff === 0) {
    if (sent === 0) {
      const chain: [number, () => number][] = [];
      if (s.sneakAsked !== 0) chain.push([12, () => sneakStep(s)]);
      chain.push(
        [13, () => gameSetup(s)],
        [14, () => refreshStats(s)],
        [15, () => refreshInventory(s)],
        [16, () => refreshWho(s)],
        [17, () => partyStatus(s)],
        [18, () => discardCash(s)],
        [51, () => recoverCorpse(s)],
        [19, () => collectItems(s)],
        [20, () => autoEquip(s)],
        [21, () => rulesStep(s)],
        [22, () => blessStep(s, 1)],
        [23, () => combatStep(s)],
        [24, () => selfCures(s, 1)],
        [25, () => blessStep(s, 0)],
        [26, () => cureStep(s, 1)],
        [27, () => invitePlayers(s)],
        [28, () => healStep(s)]
      );
      if (s.MegaMud_NoEventsInCombat === 0) chain.push([29, () => eventsStep(s)]);
      chain.push([50, () => abilityMonitors(s)]);
      for (const [d, run] of chain) {
        step = d;
        sent = run();
        if (sent !== 0) break;
      }
      if (sent === 0) {
        step = 30;
        if (enemiesHere(s, 0) > 0) sent = escapeCheck(s, 'scheduler combat');
        if (sent === 0) sent = runCheck(s);
        if (sent === 0) sent = afterRun(s, (d) => (step = d));
      }
    }
  } else {
    step = 11;
    roomCheck(s);
    sent = 1;
  }
  if (s.debug !== 0 && sent !== 0 && step !== 5) s.host.trace(`{D${step}}`);
  if (sent === 1 && s.state !== State.Nothing && s.state !== State.Looking) refreshStatus(s);
  if (sent !== 0) s.loginQuietTens = 0;
  return sent !== 0;
}

/** The steps after the run check: D31 to D49. */
function afterRun(s: Session, at: (step: number) => void): number {
  const chain: [number, () => number][] = [[31, () => exitStep(s)]];
  if (s.MegaMud_NoEventsInCombat !== 0) chain.push([32, () => eventsStep(s)]);
  chain.push(
    [33, () => selfCures(s, 0)],
    [34, () => cureStep(s, 0)],
    [35, () => lookAtPlayer(s)],
    [36, () => trackPlayer(s)],
    [37, () => shareCash(s, 0)],
    [38, () => roomCheck(s)],
    [39, () => healthStep(s)],
    [40, () => depositCash(s)],
    [41, () => withdrawCash(s)],
    [42, () => buyItems(s)],
    [43, () => sellItems(s)],
    [44, () => pathCommands(s)],
    [45, () => searchRoom(s)],
    [46, () => stashItems(s)],
    [47, () => noAllowedExits(s)],
    [48, () => walkPath(s)]
  );
  for (const [d, run] of chain) {
    at(d);
    const sent = run();
    if (sent !== 0) return sent;
  }
  at(49);
  if ((s.walking === 0 && s.importing === 0 && s.roaming === 0) || s.following !== 0) {
    let sent = 0;
    if (s.following === 0 && s.partyLost === 0) sent = hideStep(s);
    if (sent === 0) sent = sneakStep(s);
    return sent;
  }
  return 0;
}
