/**
 * `0x479010`: the prompts around the game, read 2026-10-12: a pager (`(C)ontinue?`,
 * `Press any key`: Enter, when MegaMUD is running things); `the game is
 * currently full` (redial after `RedialPause`); a GreaterMUD/Paradigm banner
 * (its version); the game menu (`[MAJORMUD]:`: out of the game, then hang
 * up, relog, or wait, as asked); and the lines of leaving it (`Your
 * character has been saved`, `You will exit after a period`, `Your
 * meditation has been interrupted`, `Point Cost Chart`: a new character).
 */
import { nextEvent } from '../script/events';
import { hangUp } from '../script/game';
import { expandMacros, send } from '../script/send';
import { setState } from '../script/state';
import { setTask } from '../script/task';
import type { Session } from '../Session';
import { recheckStats } from '../stats/exp';

function automated(s: Session): boolean {
  return s.active !== 0 || s.f_e184 !== 0 || s.f_e18c !== 0 || s.f_e178 !== 0;
}

/** `0x4ac960`: the version in a `P A R A D I G M` banner (`v1.2.3`), or null. */
function paradigmVersion(line: string): [number, number, number] | null {
  if (line.indexOf('P A R A D I G M') === -1) return null;
  const m = /v([0-9]+)(?:\.([0-9]+)(?:\.([0-9]+))?)?/.exec(line);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Out of the game, and what to do next. */
function leftGame(s: Session): void {
  if (s.partySize > 0) {
    s.following = 0;
    if (s.f_e284 === 0) s.partySize = 0;
  }
  s.inGame = 0;
  setTask(s, 0xb);
  setState(s, 0);
  if (s.f_e28c !== 0 || s.f_e284 !== 0 || s.f_e288 !== 0) setTask(s, 0x13);
}

/** The game menu: out of the game. */
function gameMenu(s: Session, line: string): number {
  if (line.indexOf('[PARADIGM]:') === -1) {
    s.BBS_GreaterMUD = 0;
    s.BBS_GreaterMUDver = 0;
    s.BBS_GreaterMUDverMinor = 0;
    s.BBS_GreaterMUDverRev = 0;
  } else {
    s.BBS_GreaterMUD = 1;
  }
  s.inGame = 0;
  if ((s.f_e284 !== 0 || s.f_e288 !== 0) && s.f_a32c === 0) {
    s.f_30de4 = 1;
    s.f_e28c = 0;
    hangUp(s, 0);
    return 1;
  }
  if (s.f_e28c !== 0 && s.f_a32c === 0) {
    s.f_e28c = 0;
    const relog = expandMacros(s, s.s_7cf7);
    send(s, relog);
    if (!relog.includes('\r')) send(s, '\r');
    setTask(s, 0x13);
    setState(s, 0);
    return 1;
  }
  if (s.task > 10 && s.task !== 0x12) {
    setTask(s, 0xb);
    return 1;
  }
  return 0;
}

export function pagerPrompts(s: Session, line: string, complete: number): number {
  if (
    complete === 0 &&
    (line.includes('or (C)ontinue?') ||
      line.includes('Press any key to continue') ||
      line.includes('Hit any key to continue'))
  ) {
    s.line.text = '';
    s.line.attr.length = 0;
    if (s.f_a32c !== 0) return 1;
    if (!automated(s) && (s.task < 1 || s.task > 10) && s.task !== 0x12 && s.inCombat === 0)
      return 1;
    send(s, '\r');
    return 1;
  }
  if (line.includes('but the game is currently full')) {
    s.host.show('[Retrying]');
    s.f_32298 = s.now + s.Comms_RedialPause;
    s.f_e544 = 3;
    s.f_30dc8 = 0;
    s.f_30de4 = 0;
    if (s.f_30de8 === 0) {
      setTask(s, 9);
    } else {
      hangUp(s, 0);
      setTask(s, 0x14);
    }
    s.f_2354 = nextEvent(s);
    return 1;
  }
  const version = paradigmVersion(line);
  if (version && version[0] > 0) {
    [s.BBS_GreaterMUDver, s.BBS_GreaterMUDverMinor, s.BBS_GreaterMUDverRev] = version;
    s.BBS_GreaterMUD = 1;
    return 1;
  }
  if (complete === 0) {
    if (
      (s.s_7cb9 !== '' && line.includes(s.s_7cb9)) ||
      line.includes('[MAJORMUD]:') ||
      line.includes('[PARADIGM]:')
    ) {
      return gameMenu(s, line);
    }
    return 0;
  }
  if (s.s_7d7d !== '' && line.includes(s.s_7d7d)) {
    s.f_e284 = 1;
    return 1;
  }
  if (line.includes('The gods have punished you appropriately')) {
    if (s.f_a32c !== 0) return 1;
    send(s, '\r');
    return 1;
  }
  if (line.includes('You will exit after a period')) {
    setTask(s, 0x13);
    setState(s, 0);
    return 1;
  }
  if (line.includes('Your meditation has been interrupted')) {
    setTask(s, 0xb);
    setState(s, 0);
    s.f_e290 = 1;
    return 1;
  }
  if (line.includes('Your character has been saved')) {
    leftGame(s);
    return 1;
  }
  if (!line.includes('Point Cost Chart')) return 0;
  // A character being made: nothing of a game is going on.
  s.inGame = 0;
  s.inCombat = 0;
  s.f_8b64 = 0;
  s.following = 0;
  s.sneaking = 0;
  s.f_e2d8 = 0;
  s.f_e1c8 = 0;
  s.f_db68 = 0;
  s.f_db6c = 0;
  s.lastTickAt = 0;
  s.f_d820 = 0;
  recheckStats(s);
  setTask(s, 0xb);
  setState(s, 0);
  return 1;
}
