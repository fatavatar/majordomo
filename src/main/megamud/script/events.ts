/**
 * The timed events (MegaMUD's "Schedule"), read 2026-10-12: logging on,
 * off or relogging, a detour to a room, a command, or a change of loop, each
 * due daily at an hour and minute or every so many seconds, minutes or
 * hours. The next one due (`0x4375f0`) is run by the scheduler (D29, or D32
 * with `NoEventsInCombat`; `0x407390`) once its time comes, and then the
 * next worked out (`0x435ba0`). Their settings are the character's
 * `[Schedule]` (`0x437870`).
 */
import { rowField } from '../cstr';
import { enemiesHere } from '../room/entities';
import type { Session, TimedEvent } from '../Session';
import { leaveGame } from './exit';
import { expandMacros, noteCommands, send } from './send';
import { setState } from './state';
import { setTask, Task } from './task';
import { clearDetours, goTo, headFor, roomByName } from '../move/destinations';
import { copyPath, findPath, freeSteps } from '../move/path';
import { State } from '../states';
import { LineFlag } from '../flags';
import { WindowCommand } from '../../../shared/megamud/toggles';

/** `0x4aa6c0`: the local time, `2026-10-12 14:05:00`. */
export function stamp(s: Session): string {
  const d = new Date(s.host.clock() * 1000);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** `mktime` of today at `hour`:`minute` (local time). */
function todayAt(now: number, hour: number, minute: number): number {
  const d = new Date(now * 1000);
  d.setHours(hour, minute, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** The event can run now (its kind's conditions). */
function eligible(s: Session, e: TimedEvent): boolean {
  if (e.type === 1)
    return s.online === 0 && s.noRedial === 0 && (s.task === Task.Idle || s.task === Task.InGame);
  if (e.type === 2 || e.type === 3) {
    return (
      s.online !== 0 &&
      s.state !== State.Hanging &&
      s.state !== State.Relogging &&
      (e.type !== 3 || s.inGame !== 0)
    );
  }
  if (e.type === 4 || e.type === 5 || e.type === 6) return s.online !== 0 && s.inGame !== 0;
  return true;
}

/**
 * `0x4375f0`: when each event is next due worked out (a repeating one reset
 * by connecting or disconnecting), and the earliest that can run now; -1
 * for none (or `MegaMud.DisableEvents`).
 */
export function nextEvent(s: Session): number {
  if (s.MegaMud_DisableEvents !== 0) return -1;
  let best = -1;
  let bestAt = 0;
  s.events.forEach((e, i) => {
    if (e.type < 0) return;
    if (e.hour < 0) {
      if ((e.type === 1 && s.online !== 0) || ((e.type === 2 || e.type === 3) && s.online === 0))
        e.dueAt = 0;
      if (e.dueAt === 0) {
        s.now = s.host.clock();
        const n = e.minute;
        e.dueAt = s.now + (e.hour === -3 ? n * 0xe10 : e.hour === -2 ? n : n * 0x3c);
      }
    } else if (e.dueAt === 0) {
      s.now = s.host.clock();
      e.dueAt = todayAt(s.now, e.hour, e.minute);
      if (e.dueAt < s.now) e.dueAt += 0x15180;
    }
    if (!eligible(s, e)) return;
    if (best === -1 || e.dueAt < bestAt) {
      best = i;
      bestAt = e.dueAt;
    }
  });
  return best;
}

/**
 * `0x435ba0`: the event just run is rescheduled (a repeating one worked out
 * afresh, a daily one a day on); logging on resets the other repeating
 * events, logging off or relogging the repeating log-ons; the next found.
 */
function eventDone(s: Session): number {
  const i = s.eventNext;
  if (i < 0 || i >= s.events.length) return 0;
  const e = s.events[i]!;
  if (e.hour < 0) e.dueAt = 0;
  else e.dueAt += 0x15180;
  for (const x of s.events) {
    if (x.hour >= 0) continue;
    if (e.type === 1 && x.type !== 1) x.dueAt = 0;
    if ((e.type === 2 || e.type === 3) && x.type === 1) x.dueAt = 0;
  }
  s.eventNext = nextEvent(s);
  setTask(s, s.task);
  return 1;
}

/** D29/D32 (`0x407390`): the next event, once due. */
export function eventsStep(s: Session): number {
  if (s.MegaMud_DisableEvents === 1 || s.eventNext === -1) return 0;
  if (s.active === 0 && s.MegaMud_EventsAfkOnly !== 0) return 0;
  if (s.allOff !== 0) return 0;
  const e = s.events[s.eventNext];
  if (!e || e.dueAt > s.now) return 0;
  if (s.MegaMud_AutoCombat !== 0 && s.attackDue !== 0 && enemiesHere(s, 0) > 0) {
    if (s.now < s.stateSince || s.now - s.stateSince < 3) return 0;
  }
  switch (e.type) {
    case 1:
      if (s.online !== 0 || s.noRedial !== 0 || (s.task !== Task.Idle && s.task !== Task.InGame))
        return 0;
      s.host.trace(`[${stamp(s)} event: Logon (${e.text})]`);
      s.task = Task.InGame;
      // `0x460b90`: the Connect button (`0x7d4`, the app's).
      s.host.post?.(WindowCommand.Connect);
      return eventDone(s);
    case 2:
      if (s.online === 0 || s.exitForLogoff !== 0) return 0;
      s.host.trace(`[${stamp(s)} event: Logoff (${e.text})]`);
      s.exitForLogoff = 1;
      eventDone(s);
      if (s.inCombat === 0) {
        s.host.activity('Exiting game due to logoff event');
        leaveGame(s);
      }
      return 1;
    case 3:
      if (
        s.online === 0 ||
        s.inGame === 0 ||
        s.state === State.Hanging ||
        s.state === State.Relogging ||
        s.task === Task.Exiting
      )
        return 0;
      if (s.relogCmd === '' || s.exitForRelog === 1) return 0;
      s.host.trace(`[${stamp(s)} event: Re-log (${e.text})]`);
      s.exitForRelog = 1;
      eventDone(s);
      if (s.inCombat === 0) {
        s.host.activity('Exiting game due to re-log event');
        leaveGame(s);
      }
      s.lineFlags |= LineFlag.Prompted;
      s.dialState = 4;
      return 1;
    case 4:
      if (s.online === 0 || s.inGame === 0) return 0;
      {
        const room = roomByName(s, e.text);
        if (room && goTo(s, room.signature, null) !== 0) {
          s.detours[0]!.why = 'timed event';
          s.host.trace(`[${stamp(s)} event: Detour (${e.text})]`);
          headFor(s, 0);
        }
      }
      return eventDone(s);
    case 6:
      if (s.online === 0 || s.inGame === 0) return 0;
      {
        const p = findPath(s, e.text);
        if (p) {
          clearDetours(s);
          if (goTo(s, 0, p) !== 0) {
            s.host.trace(`[${stamp(s)} event: Loop Path Change (${e.text})]`);
            s.detours[0]!.why = 'timed event';
            freeSteps(s.loopPath);
            copyPath(s, s.loopPath, p, 0);
            headFor(s, 0);
          }
        }
      }
      return eventDone(s);
    case 5: {
      if (s.online === 0 || s.inGame === 0) return 0;
      if (e.hour >= 0) s.host.show(`[Timed event: Command (${e.text})]`);
      s.waitLines = 2;
      noteCommands(s, e.text);
      const text = expandMacros(s, e.text);
      setState(s, State.Other);
      s.host.activity(`Issuing command "${e.text}" from timed event`);
      send(s, text);
      if (!text.endsWith('\r')) send(s, '\r');
      return eventDone(s);
    }
    default:
      return 0;
  }
}

/** `0x437870`: the events from the character's `[Schedule]`: `EventN` is `type:hour:minute:text`. */
export function loadEvents(s: Session, read: (key: string) => string): void {
  s.events = [];
  for (let n = 0; ; n += 1) {
    let text = read(`Event${n}`).slice(0, 0xff);
    if (text === '') break;
    let type: number;
    let hour: number;
    let minute: number;
    [type, text] = rowField(text);
    [hour, text] = rowField(text);
    [minute, text] = rowField(text);
    s.events.push({ type, hour, minute, text: text.slice(0, 0x50), dueAt: 0 });
  }
  s.eventsChanged = 0;
}
