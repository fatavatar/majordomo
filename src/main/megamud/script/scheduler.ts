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
import { combatOff } from '../combat/engaged';
import { healStep } from '../health/heal';
import { healthStep } from '../health/rest';
import { enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { refreshStatus } from '../status';
import { blessStep } from './bless';
import { depositCash, discardCash, shareCash, stashItems, withdrawCash } from './cash';
import { combatStep } from './combat';
import { recoverCorpse } from './corpse';
import { cureStep } from './cures';
import { escapeCheck } from './escape';
import { eventsStep } from './events';
import { exitStep } from './exit';
import { enterGame } from './game';
import { autoEquip, buyItems, collectItems, sellItems } from './items';
import { roomCheck, searchRoom, step21 } from './misc';
import { invitePlayers, lookAtPlayer, partyStatus, trackPlayer } from './party';
import { noAllowedExits, pathCommands, walkPath } from './path';
import { runCheck } from './run';
import { pendingPump, send } from './send';
import { gameSetup, listingTimedOut, refreshInventory, refreshStats, refreshWho } from './setup';
import { forgetAwaited, setState } from './state';
import { hideStep, sneakStep, stayHidden } from './stealth';

/** Nothing of a fight is left (`0x40c07d`'s long test). */
function fightClear(s: Session): boolean {
  return (
    s.f_a3e8 === 0 &&
    s.f_a3ec === 0 &&
    s.f_a3f0 === 0 &&
    s.f_a3fc === 0 &&
    s.f_a3f4 === 0 &&
    s.f_a400 === 0 &&
    s.f_a50c === 0 &&
    s.f_a510 === 0 &&
    s.f_a514 === 0 &&
    s.f_a520 === 0 &&
    s.f_a518 === 0 &&
    s.f_a524 === 0 &&
    s.f_a448 === 0 &&
    s.s_a528 === '' &&
    s.target === '' &&
    s.f_b0fc === 0 &&
    s.f_e220 === 0 &&
    s.f_b100 === 0 &&
    s.f_b104 === 0 &&
    s.f_b108 === 0 &&
    s.f_a580 === 0 &&
    s.f_a460 === 0 &&
    s.f_a464 === 0 &&
    s.f_8bec === 0 &&
    s.f_df04 === 0 &&
    s.f_df08 === 0
  );
}

/** Look at the room again: a bare Enter, then two lines to wait for. */
function lookAgain(s: Session, step: number, what: string, setLooking: boolean): boolean {
  s.f_32390 = s.now;
  s.f_e290 = 0;
  if (step === 6) s.f_e294 = 1;
  s.waitLines = 2;
  s.lineFlags &= ~3;
  if (setLooking && step === 8) setState(s, 0x2b);
  if (setLooking && step === 7) setState(s, 0x2b);
  s.host.activity(what);
  if (s.debug !== 0) s.host.trace(`{D${step}}`);
  send(s, '\r');
  return true;
}

export function schedule(s: Session): boolean {
  s.f_68 = 0;
  if (s.inGame === 0) return false;
  if (s.online === 0) enterGame(s);
  if ((s.lineFlags & 1) === 0) return false;
  if (s.f_e57c !== 0) return false;
  if (s.state === 0x16 && s.held !== 0) {
    forgetAwaited(s, 0x16);
    setState(s, 0);
  }
  if (s.state > 0x14) {
    if (s.now - s.stateSince < s.Comms_LagWait + 9) return false;
    if (s.f_a32c !== 0) return false;
    if (s.now - s.f_322d0 < 10) return false;
    if (listingTimedOut(s) !== 0) return true;
    s.host.trace('[Bueller?]');
    s.inCombat = 0;
    s.target = '';
    forgetAwaited(s, s.state);
    setState(s, 0);
    s.f_e290 = 1;
    return true;
  }
  if (s.task === 0x13) return false;
  let sent = 0;
  let step = 5;
  if (s.f_e2c8 !== 0 && s.f_e2d4 === 0) s.f_2378 = 0;
  if (s.f_2378 < 5) sent = pendingPump(s);
  if (sent === 0) {
    s.f_2378 = 0;
  } else {
    s.f_2378 += 1;
    if (s.debug !== 0) s.host.trace(`{D5:${s.f_2378}}`);
  }
  const lit = s.blind === 0 && s.darkness < 2;
  if (
    s.f_e290 === 1 &&
    lit &&
    s.f_a32c === 0 &&
    s.task !== 0x13 &&
    (s.f_a580 === 1 || (s.stateAwaited !== 0 && s.state === s.stateAwaited))
  ) {
    if (s.inCombat === 0 || s.now - s.f_32390 > s.Comms_LagWait + 1) {
      return lookAgain(s, 6, 'Refreshing room after room spell', false);
    }
  }
  if (s.f_e294 === 1 && lit) {
    if (s.now - s.f_32390 < s.Comms_LagWait + 3) return true;
    return lookAgain(s, 7, 'Re-displaying room', true);
  }
  if (
    s.f_e290 === 1 &&
    lit &&
    s.f_a32c === 0 &&
    s.task !== 0x13 &&
    (s.state === 0 || s.state === 3 || s.state === 5 || s.state === 6 || s.state === 0x13)
  ) {
    if (s.now - s.f_32390 < s.Comms_LagWait + 2) return true;
    return lookAgain(s, 8, 'Re-displaying room', true);
  }
  if (enemiesHere(s, s.Combat_AttackNeutral) === 0 && !fightClear(s)) combatOff(s);
  if (s.f_a5f8 > 0) return false;
  if (s.f_e23c !== 0 && enemiesHere(s, 0) === 0) {
    step = 10;
    if (healthStep(s) !== 0) return true;
  }
  if (s.f_a32c === 0) {
    if (sent === 0) {
      const chain: [number, () => number][] = [];
      if (s.f_e2bc !== 0) chain.push([0xc, () => sneakStep(s)]);
      chain.push(
        [0xd, () => gameSetup(s)],
        [0xe, () => refreshStats(s)],
        [0xf, () => refreshInventory(s)],
        [0x10, () => refreshWho(s)],
        [0x11, () => partyStatus(s)],
        [0x12, () => discardCash(s)],
        [0x33, () => recoverCorpse(s)],
        [0x13, () => collectItems(s)],
        [0x14, () => autoEquip(s)],
        [0x15, () => step21(s)],
        [0x16, () => blessStep(s, 1)],
        [0x17, () => combatStep(s)],
        [0x18, () => stayHidden(s, 1)],
        [0x19, () => blessStep(s, 0)],
        [0x1a, () => cureStep(s, 1)],
        [0x1b, () => invitePlayers(s)],
        [0x1c, () => healStep(s)]
      );
      if (s.MegaMud_NoEventsInCombat === 0) chain.push([0x1d, () => eventsStep(s)]);
      chain.push([0x32, () => abilityMonitors(s)]);
      for (const [d, run] of chain) {
        step = d;
        sent = run();
        if (sent !== 0) break;
      }
      if (sent === 0) {
        step = 0x1e;
        if (enemiesHere(s, 0) > 0) sent = escapeCheck(s, 'scheduler combat');
        if (sent === 0) sent = runCheck(s);
        if (sent === 0) sent = afterRun(s, (d) => (step = d));
      }
    }
  } else {
    step = 0xb;
    roomCheck(s);
    sent = 1;
  }
  if (s.debug !== 0 && sent !== 0 && step !== 5) s.host.trace(`{D${step}}`);
  if (sent === 1 && s.state !== 0 && s.state !== 0x20) refreshStatus(s);
  if (sent !== 0) s.f_db88 = 0;
  return sent !== 0;
}

/** The steps after the run check: D31 to D49. */
function afterRun(s: Session, at: (step: number) => void): number {
  const chain: [number, () => number][] = [[0x1f, () => exitStep(s)]];
  if (s.MegaMud_NoEventsInCombat !== 0) chain.push([0x20, () => eventsStep(s)]);
  chain.push(
    [0x21, () => stayHidden(s, 0)],
    [0x22, () => cureStep(s, 0)],
    [0x23, () => lookAtPlayer(s)],
    [0x24, () => trackPlayer(s)],
    [0x25, () => shareCash(s, 0)],
    [0x26, () => roomCheck(s)],
    [0x27, () => healthStep(s)],
    [0x28, () => depositCash(s)],
    [0x29, () => withdrawCash(s)],
    [0x2a, () => buyItems(s)],
    [0x2b, () => sellItems(s)],
    [0x2c, () => pathCommands(s)],
    [0x2d, () => searchRoom(s)],
    [0x2e, () => stashItems(s)],
    [0x2f, () => noAllowedExits(s)],
    [0x30, () => walkPath(s)]
  );
  for (const [d, run] of chain) {
    at(d);
    const sent = run();
    if (sent !== 0) return sent;
  }
  at(0x31);
  if ((s.f_e184 === 0 && s.f_e178 === 0 && s.f_e18c === 0) || s.following !== 0) {
    let sent = 0;
    if (s.following === 0 && s.f_e2ec === 0) sent = hideStep(s);
    if (sent === 0) sent = sneakStep(s);
    return sent;
  }
  return 0;
}
