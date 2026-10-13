/**
 * MegaMUD's clocks, read 2026-10-13.
 *
 * - **Once a second** (`WM_TIMER` 100, `0x4653d0`): the clock stamped, the
 *   experience baseline kept, the next timed event found, the ability
 *   monitors' and `@where`'s timeouts, the redial pause, AFK switched on
 *   after `MegaMud.AfkTimeout` minutes idle, the statline set after a
 *   `Comms.LagWait` grace, a log-on event run, and the lag re-prompts (a
 *   bare return after `LagWait` + 15 seconds with nothing back, the
 *   thirty-second wait after `LagWait` + 30 in one state).
 * - **Silence** (`0x49c`, `0x464910`): the waits given up after 2, 6, 10, 30
 *   and 60 seconds.
 * - **The network thread** (`0x42c910`): with nothing received, the data
 *   message once a second (the scheduler runs on it), and the silences
 *   after `LagWait` + 2, + 6 and + 10 seconds (the last only while walking
 *   or the like); three of those make a thirty, two thirties a sixty, and
 *   three thirties `[No BBS response]`, dropping the connection.
 *
 * Left out, as the window's: the clipboard and toolbar, the status bar's
 * clock, rate and round timer (`0x4aba30`, `0x4ab870`), the Stats and
 * Session windows (`0x4a8a10`, `0x49e150`, `0x4b8480`), the experience graph
 * (`0x441ca0`), the external interface (`0x490b90`, `0x48fdf0`), and the
 * typed lines waiting to go (`0x416f80`, the app's input box).
 */
import { monitorTimer } from '../abilities/monitors';
import { parseData, type TerminalState } from '../input/ParseData';
import { whereTimeout } from '../room/where';
import type { Session } from '../Session';
import { eventsStep, nextEvent, stamp } from './events';
import { dropConnection } from './game';
import { modeDefaults } from './modes';
import { send, wake } from './send';
import { setTask } from './task';
import { listingTimedOut, sixtySeconds, tenSeconds, thirtySeconds, twoSeconds } from './waits';

/**
 * `0x4c09a0`: AFK on (`active` 1) or off. On, the messages received are
 * counted afresh and `NoHangup` is let go; off, the player is told how many
 * came while away (`Display.PopupAfkMsgs`).
 */
export function setActive(s: Session, active: number): void {
  if (s.active === active) return;
  s.active = active;
  if (active !== 0) {
    s.f_dc98 = 0;
    if (s.MegaMud_NoHangup !== 0) {
      s.MegaMud_NoHangup = 0;
      s.host.show('[Assuming hangup should be re-allowed]');
    }
    return;
  }
  if (s.f_dc98 > 0 && s.Display_PopupAfkMsgs !== 0) {
    // The Talk window shown (`0x4b45e0`, the app's).
    s.host.message?.(`While AFK, you received ${s.f_dc98} message${s.f_dc98 > 1 ? 's' : ''}.`);
  }
}

/** `0x464910`: a silence of `secs` seconds (2, 5, 10, 30 or 60). */
export function silence(s: Session, secs: number): void {
  if (secs < 3) twoSeconds(s);
  else if (secs < 6) listingTimedOut(s);
  else if (secs < 0xb) tenSeconds(s);
  else if (secs < 0x1f) thirtySeconds(s);
  else sixtySeconds(s);
}

/** `0x4ab5b0`'s part that is not the status bar: the experience baseline, and the time online. */
function expBaseline(s: Session): void {
  if (s.f_e180 === 0 && (s.online === 0 || s.inGame === 0)) return;
  if (s.f_324c8 === 0 || s.exp < s.f_324c8) {
    s.f_324c8 = s.exp;
    s.f_322b0 = s.now;
    s.f_322b8 = s.now;
  }
  if (s.online !== 0 && s.inGame !== 0) s.f_322b8 = s.now;
  // `0x4a7250`, the experience meter, does the same, and keeps the end from going before the start.
  if (s.f_322b8 < s.f_322b0) s.f_322b8 = s.f_322b0;
}

/** `0x4653d0`: the once-a-second timer (100). */
export function secondTick(s: Session): void {
  s.now = s.host.clock();
  if (s.f_322b0 === 0) s.f_322b0 = s.now;
  if (s.f_322b8 === 0) s.f_322b8 = s.now;
  if (s.f_322e8 === 0) s.f_322e8 = s.now;
  if (s.f_322d0 === 0) s.f_322d0 = s.now;
  if (s.f_322c0 === 0) s.f_322c0 = s.now;
  expBaseline(s);
  if (s.eventNext === -1) {
    s.eventNext = nextEvent(s);
    if (s.eventNext !== -1) {
      setTask(s, s.task);
      wake(s);
    }
  }
  monitorTimer(s);
  whereTimeout(s);
  if (s.f_e544 === 3 && s.task === 9) {
    // Waiting out `Comms.RedialPause` before dialling again.
    if (s.now < s.f_32298) {
      setTask(s, 9);
    } else {
      s.f_318e4 = 0;
      setTask(s, 2);
      s.f_e544 = 4;
      s.host.dial?.();
    }
  }
  const idleSince = (s.now - s.f_322d0) >>> 0 < (s.now - s.f_322c0) >>> 0 ? s.f_322d0 : s.f_322c0;
  if (
    (s.MegaMud_AfkTimeout * 0x3c) >>> 0 < (s.now - idleSince) >>> 0 &&
    s.online !== 0 &&
    s.active === 0 &&
    s.MegaMud_AutoAfk !== 0
  ) {
    setActive(s, 1);
    modeDefaults(s);
    s.host.show('[AFK now ON]');
  }
  if (s.task === 0x12 && s.now - s.f_323a0 >= s.Comms_LagWait + 10) {
    send(s, `set statline ${s.MegaMud_StatLine}\r`);
    setTask(s, 0xb);
  }
  if (s.eventNext !== -1 && s.f_a32c === 0 && s.events[s.eventNext]?.type === 1) eventsStep(s);
  if (s.online !== 0 && s.inGame !== 0 && s.f_a32c === 0) {
    if (s.f_322a0 !== 0 && s.now - s.f_322a0 >= s.Comms_LagWait + 0xf) send(s, '\r');
    if (s.stateSince !== 0 && s.now - s.stateSince >= s.Comms_LagWait + 0x1e) {
      // Posted (`0x49c`, 30): run once this message is done.
      silence(s, 0x1e);
      s.stateSince = s.now;
    }
  }
}

/** The network thread's stamps (`GetTickCount64`), reset whenever data arrives. */
export interface QuietClock {
  /** The last data message posted (once a second). */
  pulse: number;
  /** The last 2-, 6- and 10-second silence. */
  two: number;
  six: number;
  ten: number;
  /** Since when the log-on has made no progress. */
  login: number;
}

export function newQuietClock(ms: number): QuietClock {
  return { pulse: ms, two: ms, six: ms, ten: ms, login: ms };
}

/** `0x42c910`: data arrived: every silence starts again. */
export function dataArrived(q: QuietClock, ms: number): void {
  q.two = ms;
  q.six = ms;
  q.ten = ms;
  q.login = ms;
  q.pulse = ms;
}

/**
 * `0x42c910`'s loop with nothing received: the data message once a second
 * (`0x499`, the scheduler runs on it), and the silences (`0x49c`). Called
 * by the host as often as it likes; it keeps its own time.
 */
export function quietTick(s: Session, t: TerminalState, q: QuietClock): void {
  const ms = s.host.tickMs();
  if (s.online === 0) {
    q.login = ms;
    return;
  }
  if (ms - q.pulse > 999) {
    q.pulse = ms;
    parseData(s, t, '');
  }
  if (ms - q.two >= (s.Comms_LagWait + 2) * 1000) {
    q.two = ms;
    silence(s, 2);
  }
  if (ms - q.six >= (s.Comms_LagWait + 6) * 1000) {
    q.six = ms;
    silence(s, 5);
  }
  if (s.task > 9 && s.task !== 0xb && ms - q.ten >= (s.Comms_LagWait + 10) * 1000) {
    silence(s, 10);
    s.f_db88 += 1;
    if (s.f_db88 === 3) {
      s.f_db8c += 1;
      silence(s, 0x1e);
    }
    q.ten = ms;
    if (s.f_db8c === 2) silence(s, 0x3c);
  }
  if (s.task < 10) {
    s.f_db8c = 0;
  } else if (s.f_db8c === 3) {
    s.f_db88 = 0;
    s.f_db8c = 0;
    if (s.f_a32c === 0) {
      s.host.trace(`[No BBS response (${stamp(s)})]`);
      dropConnection(s);
    }
  }
  if (
    s.inGame === 0 &&
    s.f_a32c === 0 &&
    s.f_e158 === 0 &&
    s.task > 9 &&
    s.task !== 0xb &&
    ms - q.login > 119999
  ) {
    s.host.trace(`[No login progress - forcing reconnect (${stamp(s)})]`);
    s.f_db88 = 0;
    s.f_db8c = 0;
    dropConnection(s);
    q.login = ms;
  }
}
