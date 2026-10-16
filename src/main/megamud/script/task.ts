/**
 * MegaMUD's task (`db24`): what it is doing at the top level, as the window
 * caption names it (`0x4aac80`, read 2026-10-12). The path tasks are where
 * our own walker stands in for MegaMUD's (docs/megamud/engine-port.md).
 */
import type { Session } from '../Session';

export const Task = {
  /** "Waiting for instructions ...", before the game. */
  Idle: 0,
  Connecting: 1,
  Connecting2: 2,
  Connecting7: 7,
  /** "Verifying user name/password ..." */
  Verifying: 8,
  /** "Reconnecting in %d seconds" */
  Redial: 9,
  /** "Logging on ..." */
  LoggingOn: 10,
  /** "Waiting for instructions ...", in the game. */
  InGame: 0xb,
  /** "Recording new path ..." / "Importing new path ..." */
  Recording: 0xc,
  /** "Thinking ..." */
  Thinking: 0xd,
  /** "Walking to %s" / "Running to %s" */
  Walking: 0xe,
  /** "Looping ... (Lap %d)" */
  Looping: 0xf,
  /** "Auto-roaming area ..." */
  Roaming: 0x10,
  /** "Currently lost ... Looking for a known room" */
  Lost: 0x11,
  /** "Entering game ..." */
  Entering: 0x12,
  /** "Exiting game ..." */
  Exiting: 0x13,
  /** "Connection terminated." */
  Terminated: 0x14,
  /** "Connection initialization failed." */
  InitFailed: 0x15,
  /** "Unable to connect." */
  Unreachable: -1
} as const;

/** `0x4aac80`: the task becomes `task` (the caption is the host's). */
export function setTask(s: Session, task: number): void {
  if (s.task !== task) {
    s.task = task;
    s.host.task?.(task);
  }
}

/** "1 second", "5 seconds": MegaMUD's own plural, an `s` appended. */
function counted(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * `0x4aac80`'s caption for the task, as MegaMUD's title bar shows it (read
 * 2026-10-16), for `@status` and the stats board. Before the in-game wait,
 * MegaMUD names the next scheduled event's time (`Waiting to logon at …`),
 * which is the Events tab's and left out here.
 */
export function caption(s: Session): string {
  switch (s.task) {
    case Task.Idle:
    case Task.InGame: {
      const mode =
        s.online === 0
          ? 'OFFLINE: '
          : s.inGame === 0
            ? 'ONLINE: '
            : s.active !== 0
              ? 'ACTIVE: '
              : 'MANUAL: ';
      return `${mode}Waiting for instructions ...`;
    }
    case Task.Connecting:
    case Task.Connecting2:
    case Task.Connecting7:
      return 'Connecting ...';
    case Task.Verifying:
      return 'Verifying user name/password ...';
    case Task.Redial: {
      const left = s.redialAt - s.now;
      let text = `Reconnecting in ${counted(left, 'second')}`;
      if (left !== 1 && left > 60) text += ` (${counted(Math.trunc(left / 60), 'min')})`;
      return `${text} ...`;
    }
    case Task.LoggingOn:
      return 'Logging on ...';
    case Task.Recording:
      return `${s.importing === 0 ? 'Recording' : 'Importing'} new path ... (${counted(s.path.count, 'step')} recorded)`;
    case Task.Thinking:
      return 'Thinking ...';
    case Task.Walking: {
      let text = `${s.MegaMud_AutoCombat === 0 ? 'Running' : 'Walking'} to ${s.destination}`;
      if (s.detours[1]!.room !== 0) text += ` (${s.detours[0]!.why})`;
      return text;
    }
    case Task.Looping:
      return s.laps === -1 ? 'Completing current loop ...' : `Looping ... (Lap ${s.laps + 1})`;
    case Task.Roaming:
      return 'Auto-roaming area ...';
    case Task.Lost:
      return 'Currently lost ... Looking for a known room';
    case Task.Entering:
      return 'Entering game ...';
    case Task.Exiting:
      return 'Exiting game ...';
    case Task.Terminated:
      return 'Connection terminated.';
    case Task.InitFailed:
      return 'Connection initialization failed.';
    case Task.Unreachable:
      return 'Unable to connect.';
    default:
      return `Unknown task ${s.task}`;
  }
}
