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
