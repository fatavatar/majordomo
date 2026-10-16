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
import { clearRoom, dropUnkeptCreatures, enemiesHere, unkeepAll } from '../room/entities';
import {
  clearAlignment,
  clearCastMode,
  clearMainCounts,
  clearMultiCounts,
  clearTargetCasts
} from '../combat/engaged';
import type { Session } from '../Session';
import { recheckStats } from '../stats/exp';
import { nextEvent, stamp } from './events';
import { modeDefaults } from './modes';
import { expandMacros, queue, send } from './send';
import { setState } from './state';
import { setTask, Task } from './task';
import { INVENTORY_LISTING, LineFlag, WHO_LISTING, MessageFlag, PlayerFlag } from '../flags';
import { State } from '../states';

/** `0x4b66f0`: the room's map numbers and the `@where` replies waiting on them forgotten. */
function forgetWhere(s: Session): void {
  s.locationMap = 0;
  s.locationRoom = 0;
  s.locationSignature = 0;
  s.locationAt = 0;
  s.whereAsked = [];
  s.whereAskedAt = 0;
}

/** `0x42de00`: online (`on` 1, from the first prompt) or not. Returns `on`. */
export function goOnline(s: Session, on: number): number {
  if (on === 0) {
    if (s.online !== 0) {
      s.online = 0;
      s.inGame = 0;
      resetMonitors(s);
      forgetWhere(s);
    }
    return 0;
  }
  if (s.now === 0) s.now = s.host.clock();
  if (s.online === 0) {
    s.startTask = s.MegaMud_StartTask;
    if (s.MegaMud_StartTask === 1 && s.MegaMud_DefaultLoop !== '') {
      freeSteps(s.loopPath);
      s.MegaMud_SelPath = s.MegaMud_DefaultLoop.slice(0, 13);
      loadPath(s, s.loopPath);
    }
    s.online = 1;
    s.connectionLive = 1;
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
  s.expMeterStart = s.now;
  s.expMeterEnd = s.now;
  s.lineFlags &= ~(LineFlag.TopListing | WHO_LISTING | INVENTORY_LISTING);
  s.inGame = 1;
  s.lowHpArmed = 0;
  s.expBefore = s.exp - s.expBaseline;
  s.expBaseline = s.exp;
  s.whoDue = 1;
  s.expDue = 1;
  s.inventoryAskedAt = 0;
  s.skipRedialOnce = 0;
  s.fleeingPlayer = 0;
  s.inCombat = 0;
  s.recoveringCorpse = 0;
  s.corpseTried = 0;
  s.lastTickAt = 0;
  s.inventoryQuietAt = 0;
  forgetWhere(s);
  recheckStats(s);
  s.statDue = -1;
  s.statAskedAt = 0;
  s.modeApplied = -1;
  s.eventNext = nextEvent(s);
  s.stateBefore = State.Nothing;
  s.stateAwaited = State.Nothing;
  setTask(s, Task.InGame);
  setState(s, State.Nothing);
  let start = s.startTask;
  if (start < 0 || start > 2) {
    start = s.MegaMud_StartTask;
    s.startTask = start;
  }
  // Out of a party this character was not leading, unless it was following.
  const leaveParty = (): void => {
    if (s.partySize === 1 || ledByOther(s)) s.partySize = 0;
  };
  // MegaMud.StartTask: 0 nothing, 1 the loop, 2 roaming.
  let idle = start === 0;
  if (start === 1) {
    s.partyLost = s.following !== 0 ? 1 : 0;
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
      s.lowHpArmed = 1;
      setTask(s, Task.Looping);
      goTo(s, 0, s.loopPath);
      headFor(s, 0);
    }
  } else if (start === 2) {
    s.looping = 0;
    s.walking = 1;
    s.roaming = 1;
    s.lowHpArmed = 1;
    s.partyLost = s.following !== 0 ? 1 : 0;
    s.following = 0;
    leaveParty();
    setTask(s, Task.Roaming);
  }
  if (idle) {
    if (s.following === 0) {
      // A party this character leads is kept.
      if (!(s.partySize > 1 && !ledByOther(s))) {
        s.partySize = 0;
        s.partyLost = 0;
      }
    } else if (ledByOther(s)) {
      queue(s, `/${s.leaderName} @comeback\r`);
      s.following = 0;
      s.partyLost = 1;
      s.host.alert?.('idle');
    } else {
      s.following = 0;
      s.partyLost = 0;
    }
  }
  s.startTask = -1;
  modeDefaults(s);
  // `0x4c1230`: who is online is asked afresh.
  s.whoList = [];
  if (s.Other_EntryCmd !== '') send(s, bbsCommand(s, s.Other_EntryCmd));
  s.lookDue = 0;
  if (s.blind === 0) {
    s.redisplayDue = 1;
    s.roomLookedAt = s.now;
  }
  send(s, '\r');
}

/** `0x42d7d0`: a connection is up. */
function connectedNow(s: Session): boolean {
  return s.socketUp !== 0 && s.sessionOpen !== -1;
}

/**
 * `0x42d510`: hang up (`how` 1: relog instead, with `Other.RelogInstead`).
 * Out of combat, then the BBS's log-off command and the socket closed, or
 * the relog command and the log-on again.
 */
export function hangUp(s: Session, how: number): number {
  if (s.state === State.Hanging) return 1;
  if (s.hangingUp !== 0) return 1;
  s.hangingUp = 1;
  s.connectionLive = 0;
  if (!connectedNow(s)) return 1;
  if (s.inCombat !== 0 || s.target !== '') {
    send(s, 'break\r');
    s.inCombat = 0;
  }
  s.target = '';
  s.chaseTarget = '';
  clearRoom(s);
  if (s.Other_RelogInstead === 0 || how === 0) {
    setState(s, State.Hanging);
    if (s.logoffCmd !== '') send(s, bbsCommand(s, s.logoffCmd));
    sessionEnded(s);
    setState(s, State.Nothing);
    s.inGame = 0;
    s.stateBefore = State.Nothing;
    s.stateAwaited = State.Nothing;
  } else {
    s.exitForRelog = 0;
    s.inGame = 0;
    s.stateBefore = State.Nothing;
    s.stateAwaited = State.Nothing;
    setState(s, State.Relogging);
    setTask(s, Task.Connecting);
    send(s, bbsCommand(s, s.relogCmd));
  }
  return 1;
}

/** `0x4b6fe0`: the socket closed by this side. */
export function sessionEnded(s: Session): number {
  if (s.sessionOpen !== -1) {
    s.sessionOpen = -1;
    s.host.hangUp?.();
    s.host.trace(`[Session ended (${stamp(s)})]`);
    if (s.task !== Task.Redial) setTask(s, Task.InGame);
    setState(s, State.Nothing);
  }
  return 1;
}

/**
 * The host's socket is up (`0x4b7300`): a hang-up can close it again.
 *
 * And the dialling and the logon handed back. MegaMUD's own thread
 * (`0x45a6b0`) and logon (`0x45ad00`) take the task from dialling into the
 * game; here the host dials and the realm's login script logs on
 * (`input/connect.ts`), so a dial the engine asked for (its redial, task 2)
 * is left where a first connect starts, waiting for instructions before the
 * game (2026-10-14). Left in task 2, every line went to the connection and
 * none to the game: Skinny, redialled after a drop, logged on and stood for
 * five hours without a command.
 */
export function connected(s: Session): void {
  s.socketUp = -1;
  s.sessionOpen = 1;
  if (s.task >= Task.Connecting && s.task <= Task.LoggingOn) setTask(s, Task.Idle);
}

/**
 * `0x42c910`'s end: the socket is gone. Offline; then, when it went without
 * a hang-up, "Unexpected disconnection.", out of the game, and redialled
 * after `Comms.RedialPause` with `Comms.RedialCarrier` (unless leaving for
 * low HP); after a BBS shutdown with `Comms.RedialCleanup`, redialled after
 * `Comms.CleanupPeriod` minutes.
 */
export function connectionClosed(s: Session): void {
  s.sessionOpen = -1;
  s.socketUp = 0;
  if (s.online !== 0) {
    goOnline(s, 0);
  }
  const redial = (at: number): void => {
    s.now = s.host.clock();
    s.redialAt = s.now + at;
    s.dialState = 3;
    s.redials = 0;
    s.skipRedialOnce = 0;
  };
  if (s.exitForShutdown !== 0 && s.Comms_RedialCleanup !== 0 && s.noRedial === 0) {
    redial(s.Comms_CleanupPeriod * 60);
    s.exitForShutdown = 0;
    s.exitForLogoff = 0;
    s.connectionLive = 0;
    s.exitForRelog = 0;
    goOnline(s, 0);
    setTask(s, Task.Redial);
    s.eventNext = nextEvent(s);
    return;
  }
  if (s.hangingUp === 0 && s.connectionLive !== 0) {
    s.host.show('Unexpected disconnection.');
    s.inGame = 0;
    s.stateBefore = State.Nothing;
    s.stateAwaited = State.Nothing;
    s.connectionLive = 0;
    goOnline(s, 0);
    setState(s, State.Nothing);
    s.inCombat = 0;
    s.target = '';
    s.chaseTarget = '';
    unkeepAll(s);
    clearRoom(s);
    let task: number = Task.Terminated;
    if (s.Comms_RedialCarrier !== 0 && s.noRedial === 0) {
      if (s.skipRedialOnce === 0) {
        redial(s.Comms_RedialPause);
        setTask(s, Task.Redial);
        s.eventNext = nextEvent(s);
        return;
      }
      task = Task.InGame;
    }
    setTask(s, task);
    s.eventNext = nextEvent(s);
    return;
  }
  if (s.hangingUp !== 0 && s.connectionLive !== 0) s.host.show('Disconnected.');
  s.inGame = 0;
  s.exitForShutdown = 0;
  s.exitForLogoff = 0;
  s.stateBefore = State.Nothing;
  s.stateAwaited = State.Nothing;
  if (s.task >= Task.Recording && s.task <= Task.Exiting) setTask(s, Task.InGame);
  setState(s, State.Nothing);
  if (s.hangingUp !== 0 || s.connectionLive !== 0) {
    s.hangingUp = 0;
    s.connectionLive = 0;
    s.eventNext = nextEvent(s);
  }
}

/**
 * `0x4b71d0`: a dial that failed. With `Comms.RedialConnect` it is counted
 * and dialled again after `Comms.RedialPause`, until `Comms.RedialMax`
 * failures, when redialling is given up ("[Re-dial maximum exceeded]") and
 * stays prevented. 1 when it was taken up.
 */
export function connectFailed(s: Session): number {
  if (s.Comms_RedialConnect === 0) return 0;
  s.redials += 1;
  if (s.Comms_RedialMax <= s.redials) {
    s.noRedial = 1;
    s.host.show(`[Re-dial maximum exceeded (${s.redials})]`);
    setTask(s, Task.InGame);
    return 1;
  }
  if (s.noRedial !== 0) {
    s.host.show('[Re-dial prevented]');
    setTask(s, Task.InGame);
    return 1;
  }
  s.now = s.host.clock();
  s.dialState = 3;
  s.redialAt = s.now + s.Comms_RedialPause;
  s.skipRedialOnce = 0;
  goOnline(s, 0);
  setTask(s, Task.Redial);
  return 1;
}

/**
 * `0x42d3f0`: the connection given up on (no BBS response, no log-on
 * progress): hung up, out of the game, and redialled after
 * `Comms.RedialPause` with `Comms.RedialNoResponse`.
 */
export function dropConnection(s: Session): void {
  s.skipRedialOnce = 1;
  hangUp(s, 0);
  s.host.alert?.('hangup');
  s.inGame = 0;
  s.inCombat = 0;
  s.lastTickAt = 0;
  goOnline(s, 0);
  setTask(s, Task.Terminated);
  setState(s, State.Nothing);
  s.eventNext = nextEvent(s);
  if (s.Comms_RedialNoResponse !== 0 && s.noRedial === 0) {
    s.now = s.host.clock();
    s.dialState = 3;
    s.redialAt = s.now + s.Comms_RedialPause;
    s.redials = 0;
    s.skipRedialOnce = 0;
    goOnline(s, 0);
    setTask(s, Task.Redial);
    s.eventNext = nextEvent(s);
  }
}

/**
 * `0x4b3f70` (`@reset`, and the menu's Reset): every flag, wait and
 * condition MegaMUD keeps cleared, the room's monsters and players
 * forgotten (`0x4721d0`, `0x472240`), the Messages.md rows rested on let go,
 * the session's statistics started again (`0x4a8850`, `0x4a8640`,
 * `0x4a88f0`) and the players seen this session unseen. The terminal's
 * own reset (`0x418280`) is ours.
 */
/** `0x4721d0`: the monsters marked in the room forgotten, and the creatures not kept dropped. */
export function forgetRoomMonsters(s: Session): void {
  s.monsterMarks = [];
  unkeepAll(s);
  dropUnkeptCreatures(s);
  clearMainCounts(s);
  s.roomLookedAt = 0;
  if (s.inGame !== 0) s.lookDue = 1;
}

/** `0x472240`: and the players marked. */
export function forgetRoomPlayers(s: Session): void {
  s.playerMarks = [];
}

export function resetAll(s: Session): void {
  s.stateAwaited = State.Nothing;
  forgetRoomMonsters(s);
  forgetRoomPlayers(s);
  clearTargetCasts(s);
  clearCastMode(s);
  clearMultiCounts(s);
  s.weightMax = 0;
  s.rescueCount = 0;
  s.waitLines = 0;
  s.equipsPending = 0;
  s.runDirection = -1;
  s.runCount = 0;
  s.runByChoice = 0;
  s.hpFullAt = 0;
  s.manaFullAt = 0;
  s.attacksRefused = 0;
  s.warnFewMonsters = 1;
  s.trainDealtWith = 0;
  s.fleeingPlayer = 0;
  s.hideAgain = 0;
  s.cannotDropHere = 0;
  s.corpseTried = 0;
  s.recoveringCorpse = 0;
  s.blind = 0;
  s.confused = 0;
  s.poisoned = 0;
  s.tooSickToRest = 0;
  s.diseased = 0;
  s.losingHp = 0;
  s.hpRegen = 0;
  s.manaRegen = 0;
  s.fluxRecast = 0;
  s.held = 0;
  s.attackPrevented = 0;
  s.dontAttackHere = 0;
  s.engagedHere = 0;
  clearAlignment(s);
  s.restHpToFull = 0;
  s.restManaToFull = 0;
  s.healthFirst = 0;
  s.exitForShutdown = 0;
  s.exitForLogoff = 0;
  s.exitForRelog = 0;
  s.lookDue = 1;
  s.statDue = 1;
  s.whoDue = 1;
  s.expDue = 1;
  s.parDue = 1;
  s.mustRest = 0;
  s.dontRestHere = 0;
  s.stashing = 0;
  s.sellDetourTaken = 0;
  s.setupDue = 0;
  s.spellsDue = 0;
  s.arrivedWhileWalking = 0;
  s.attackDue = enemiesHere(s, 0) > 0 ? 1 : 0;
  s.openDoorNext = 0;
  s.following = 0;
  s.partyLost = 0;
  s.partyWait = 0;
  s.holdingLeader = 0;
  s.unknown_e57c = 0;
  s.restUntilOff = 0;
  for (const row of s.data.messages ?? [])
    row.flags &= ~(MessageFlag.Active | MessageFlag.RestedOn);
  for (const p of s.data.players ?? []) {
    p.flags &= ~(PlayerFlag.AttackedUs | PlayerFlag.SeenThisSession);
    p.seen = 0;
  }
  s.itemPickingUp = '';
  s.chaseTarget = '';
  s.divertTo = '';
  s.debugTo = '';
  s.roomReply = '';
  forgetWhere(s);
  // 0x4a8850: the experience and activity clocks.
  s.expMeterStart = s.now;
  s.expMeterEnd = s.now;
  s.expBaseline = s.exp;
  s.expBefore = 0;
  // `0x4a8640` and `0x4a88f0` clear the session's combat and round
  // statistics, MegaMUD's statistics window's; the port keeps none.
}
