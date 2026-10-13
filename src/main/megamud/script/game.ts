/**
 * Coming online and entering the game, hanging up, and the connection lost
 * (read 2026-10-13): `0x42de00` (online or not), the first prompt's set-up
 * (`0x47b070`'s tail), `0x42d510` (hang up), `0x4b6fe0` (the socket
 * closed), `0x42c910`'s end (the socket gone) and `0x42d3f0` (given up on).
 *
 * The socket is the host's: `connected` and `connectionClosed` are called by
 * it, and the engine's closing of it is `host.hangUp`. Left out, as the
 * window's or the network thread's own: the status bar and menus (`0x460d50`,
 * `0x418280`, `0x4ab7e0`, `0x481d40`), the send and receive buffers, the
 * capture file (`0x41ee90`) and the Session window's counts (`0x49e150`).
 */
import { resetMonitors } from '../abilities/monitors';
import { freeSteps, loadPath, copyPath } from '../move/path';
import { goTo, headFor } from '../move/destinations';
import { clearRoom, unkeepAll } from '../room/entities';
import type { Session } from '../Session';
import { recheckStats } from '../stats/exp';
import { nextEvent, stamp } from './events';
import { modeDefaults } from './modes';
import { expandMacros, queue, send } from './send';
import { setState } from './state';
import { setTask } from './task';

/** `0x4b66f0`: the room's map numbers and the `@where` replies waiting on them forgotten. */
function forgetWhere(s: Session): void {
  s.f_8168 = 0;
  s.f_816c = 0;
  s.f_8170 = 0;
  s.f_32380 = 0;
  s.whereAsked = [];
  s.whereAskedAt = 0;
}

/** `0x42de00`: online (`on` 1, from the first prompt) or not. Returns `on`. */
export function goOnline(s: Session, on: number): number {
  if (on === 0) {
    if (s.online !== 0) {
      // The time online, added to the total.
      s.f_32508 = s.now;
      s.f_32510 += s.now - s.f_32500;
      s.online = 0;
      s.inGame = 0;
      resetMonitors(s);
      forgetWhere(s);
    }
    return 0;
  }
  if (s.now === 0) s.now = s.host.clock();
  if (s.online === 0) {
    s.f_32500 = s.now;
    s.f_db20 = s.MegaMud_StartTask;
    if (s.MegaMud_StartTask === 1 && s.MegaMud_DefaultLoop !== '') {
      freeSteps(s.loopPath);
      s.MegaMud_SelPath = s.MegaMud_DefaultLoop.slice(0, 13);
      loadPath(s, s.loopPath);
    }
    s.online = 1;
    s.f_e160 = 1;
    s.f_31020 = 0;
  }
  return on;
}

/** A command from the BBS set-up, macros put in and ended with a return. */
function bbsCommand(s: Session, text: string): string {
  const out = expandMacros(s, text).slice(0, 99);
  return out.endsWith('\r') ? out : `${out}\r`;
}

/** Whether `leader` is someone other than this character. */
function ledByOther(s: Session): boolean {
  return s.leaderName !== s.Player_Name;
}

/** `0x47b070`'s tail: the first prompt in the game. */
export function enterGame(s: Session): void {
  goOnline(s, 1);
  s.f_322b0 = s.now;
  s.f_322b8 = s.now;
  s.lineFlags &= 0xffffe03f;
  s.inGame = 1;
  s.f_e170 = 0;
  s.f_324d0 = s.exp - s.f_324c8;
  s.f_324c8 = s.exp;
  s.f_e2a4 = 1;
  s.f_e2a8 = 1;
  s.f_32348 = 0;
  s.f_30de4 = 0;
  s.f_30dec = 0;
  s.f_e1a0 = 0;
  s.inCombat = 0;
  s.f_8558 = 0;
  s.f_e1e4 = 0;
  s.lastTickAt = 0;
  s.f_d82c = 0;
  s.f_d820 = 0;
  s.f_d824 = 0;
  s.f_32350 = 0;
  forgetWhere(s);
  recheckStats(s);
  s.f_e29c = -1;
  s.f_32378 = 0;
  s.modeApplied = -1;
  s.eventNext = nextEvent(s);
  s.stateBefore = 0;
  s.stateAwaited = 0;
  setTask(s, 0xb);
  setState(s, 0);
  let start = s.f_db20;
  if (start < 0 || start > 2) {
    start = s.MegaMud_StartTask;
    s.f_db20 = start;
  }
  // Out of a party this character was not leading, unless it was following.
  const leaveParty = (): void => {
    if (s.partySize === 1 || ledByOther(s)) s.partySize = 0;
  };
  // MegaMud.StartTask: 0 nothing, 1 the loop, 2 roaming.
  let idle = start === 0;
  if (start === 1) {
    s.f_e2ec = s.following !== 0 ? 1 : 0;
    s.following = 0;
    leaveParty();
    if (s.loopPath.start === 0) {
      freeSteps(s.loopPath);
      copyPath(s, s.loopPath, s.path, 1);
    }
    if (s.loopPath.start !== s.loopPath.end) {
      idle = true;
    } else {
      s.walking = 1;
      s.looping = 1;
      s.roaming = 0;
      s.f_e170 = 1;
      setTask(s, 0xf);
      goTo(s, 0, s.loopPath);
      headFor(s, 0);
    }
  } else if (start === 2) {
    s.looping = 0;
    s.walking = 1;
    s.roaming = 1;
    s.f_e170 = 1;
    s.f_e2ec = s.following !== 0 ? 1 : 0;
    s.following = 0;
    leaveParty();
    setTask(s, 0x10);
  }
  if (idle) {
    if (s.following === 0) {
      // A party this character leads is kept.
      if (!(s.partySize > 1 && !ledByOther(s))) {
        s.partySize = 0;
        s.f_e2ec = 0;
      }
    } else if (ledByOther(s)) {
      queue(s, `/${s.leaderName} @comeback\r`);
      s.following = 0;
      s.f_e2ec = 1;
      s.host.alert?.('idle');
    } else {
      s.following = 0;
      s.f_e2ec = 0;
    }
  }
  s.f_db20 = -1;
  modeDefaults(s);
  // `0x4c1230`: who is online is asked afresh.
  s.whoList = [];
  if (s.Other_EntryCmd !== '') send(s, bbsCommand(s, s.Other_EntryCmd));
  s.f_e290 = 0;
  if (s.blind === 0) {
    s.f_e294 = 1;
    s.f_32390 = s.now;
  }
  send(s, '\r');
}

/** `0x42d7d0`: a connection is up. */
function connectedNow(s: Session): boolean {
  return s.f_e540 !== 0 && s.f_31914 !== -1;
}

/**
 * `0x42d510`: hang up (`how` 1: relog instead, with `Other.RelogInstead`).
 * Out of combat, then the BBS's log-off command and the socket closed, or
 * the relog command and the log-on again.
 */
export function hangUp(s: Session, how: number): number {
  if (s.state === 7) return 1;
  if (s.f_e158 !== 0) return 1;
  s.f_e158 = 1;
  s.f_e160 = 0;
  if (s.f_31020 === 0) s.f_31020 = 1;
  if (!connectedNow(s)) return 1;
  if (s.inCombat !== 0 || s.target !== '') {
    send(s, 'break\r');
    s.inCombat = 0;
  }
  s.target = '';
  s.chaseTarget = '';
  clearRoom(s);
  if (s.Other_RelogInstead === 0 || how === 0) {
    setState(s, 7);
    if (s.logoffCmd !== '') send(s, bbsCommand(s, s.logoffCmd));
    sessionEnded(s);
    setState(s, 0);
    s.inGame = 0;
    s.stateBefore = 0;
    s.stateAwaited = 0;
  } else {
    s.f_31020 = 3;
    s.f_30dec = 1;
    s.f_e28c = 0;
    s.inGame = 0;
    s.stateBefore = 0;
    s.stateAwaited = 0;
    setState(s, 8);
    setTask(s, 1);
    send(s, bbsCommand(s, s.s_7cf7));
  }
  return 1;
}

/** `0x4b6fe0`: the socket closed by this side. */
export function sessionEnded(s: Session): number {
  if (s.f_31914 !== -1) {
    s.f_31914 = -1;
    s.host.hangUp?.();
    s.host.trace(`[Session ended (${stamp(s)})]`);
    if (s.task !== 9) setTask(s, 0xb);
    setState(s, 0);
    s.f_7ed4 = 0;
    s.f_db10 = 0;
  }
  return 1;
}

/** The host's socket is up (`0x4b7300`): a hang-up can close it again. */
export function connected(s: Session): void {
  s.f_e540 = -1;
  s.f_31914 = 1;
}

/**
 * `0x42c910`'s end: the socket is gone. Offline; then, when it went without
 * a hang-up, "Unexpected disconnection.", out of the game, and redialled
 * after `Comms.RedialPause` with `Comms.RedialCarrier` (unless leaving for
 * low HP); after a BBS shutdown with `Comms.RedialCleanup`, redialled after
 * `Comms.CleanupPeriod` minutes.
 */
export function connectionClosed(s: Session): void {
  s.f_31914 = -1;
  s.f_e540 = 0;
  if (s.online !== 0) {
    s.f_31020 = 2;
    goOnline(s, 0);
  }
  const redial = (at: number): void => {
    s.now = s.host.clock();
    s.f_32298 = s.now + at;
    s.f_e544 = 3;
    s.f_30dc8 = 0;
    s.f_30de4 = 0;
  };
  if (s.f_e284 !== 0 && s.Comms_RedialCleanup !== 0 && s.f_30de8 === 0) {
    redial(s.Comms_CleanupPeriod * 0x3c);
    s.f_e284 = 0;
    s.f_e288 = 0;
    s.f_e160 = 0;
    s.f_e28c = 0;
    goOnline(s, 0);
    setTask(s, 9);
    s.eventNext = nextEvent(s);
    return;
  }
  if (s.f_e158 === 0 && s.f_e160 !== 0) {
    s.host.show('Unexpected disconnection.');
    s.inGame = 0;
    s.stateBefore = 0;
    s.stateAwaited = 0;
    s.f_e160 = 0;
    goOnline(s, 0);
    setState(s, 0);
    s.inCombat = 0;
    s.target = '';
    s.chaseTarget = '';
    unkeepAll(s);
    clearRoom(s);
    let task = 0x14;
    if (s.Comms_RedialCarrier !== 0 && s.f_30de8 === 0) {
      if (s.f_30de4 === 0) {
        redial(s.Comms_RedialPause);
        setTask(s, 9);
        s.eventNext = nextEvent(s);
        return;
      }
      task = 0xb;
    }
    setTask(s, task);
    s.eventNext = nextEvent(s);
    return;
  }
  if (s.f_e158 !== 0 && s.f_e160 !== 0) s.host.show('Disconnected.');
  s.inGame = 0;
  s.f_e284 = 0;
  s.f_e288 = 0;
  s.stateBefore = 0;
  s.stateAwaited = 0;
  if (s.task - 0xc >= 0 && s.task - 0xc < 8) setTask(s, 0xb);
  setState(s, 0);
  if (s.f_e158 !== 0 || s.f_e160 !== 0) {
    s.f_e158 = 0;
    s.f_e160 = 0;
    s.eventNext = nextEvent(s);
  }
}

/**
 * `0x42d3f0`: the connection given up on (no BBS response, no log-on
 * progress): hung up, out of the game, and redialled after
 * `Comms.RedialPause` with `Comms.RedialNoResponse`.
 */
export function dropConnection(s: Session): void {
  s.f_30de4 = 1;
  hangUp(s, 0);
  s.host.alert?.('hangup');
  s.inGame = 0;
  s.inCombat = 0;
  s.lastTickAt = 0;
  s.f_d82c = 0;
  s.f_d820 = 0;
  s.f_d824 = 0;
  goOnline(s, 0);
  setTask(s, 0x14);
  setState(s, 0);
  s.eventNext = nextEvent(s);
  if (s.Comms_RedialNoResponse !== 0 && s.f_30de8 === 0) {
    s.now = s.host.clock();
    s.f_e544 = 3;
    s.f_32298 = s.now + s.Comms_RedialPause;
    s.f_30dc8 = 0;
    s.f_30de4 = 0;
    goOnline(s, 0);
    setTask(s, 9);
    s.eventNext = nextEvent(s);
  }
}
