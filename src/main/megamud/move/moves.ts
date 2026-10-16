/**
 * `0x437ff0`: a move refused, read 2026-10-12 (while moving, state `0x16`, or
 * opening, `0x1a`): `There is no exit in that direction` (in the dark, a
 * path walker counts these: lost, it tries every exit, then stops); a door
 * `is closed!` / `is locked` / `is now open` / `was already open` (the exit
 * marked: 2 closed, 3 open); and the refusals that block a path (it stops:
 * `[Path blocked - Unable to continue]`). A path step not taken is taken
 * back (`0x482de0`).
 */
import { modeDefaults, reEngage } from '../script/modes';
import { setState } from '../script/state';
import { setTask, Task } from '../script/task';
import type { Session } from '../Session';
import { State } from '../states';
import { LineFlag, Darkness, Exit } from '../flags';

const BLOCKED = [
  'You may not enter that room ',
  'You are not healthy enough ',
  'You are too heavy to move',
  'You do not have enough to ',
  'You do not have the appropriate',
  'You are not permitted in ',
  'You may not go through this ',
  'You have progressed too far',
  'You have not progressed far',
  'You are too good to go',
  'You are too evil to go',
  'You do not have a room ticket',
  'You walk into a shimmering wall',
  'The heat is too intense'
];

/** `0x482de0`: a path step not taken: taken back. */
export function stepBack(s: Session): number {
  if (s.path.count > 0 && s.path.prev !== s.path.step) {
    s.path.step = s.path.prev;
    s.path.count -= 1;
    setTask(s, Task.Recording);
    return 1;
  }
  return 0;
}

/** Walking stops (`0x4aa6c0` and the alert are the user's to see). */
function stopWalking(s: Session, why: string): void {
  s.host.show(why);
  s.host.alert?.('idle');
}

/** `There is no exit in that direction`. */
function noExit(s: Session): number {
  if (s.recording !== 0) stepBack(s);
  s.roomLookedAt = 0;
  s.expectedRoom = 0;
  const lost =
    s.walking !== 0 &&
    s.roaming === 0 &&
    s.following === 0 &&
    s.path.steps !== null &&
    s.darkness > Darkness.Dim;
  if (!lost || ++s.darkMisses < 2) {
    s.lookDue = 1;
    setState(s, State.Nothing);
    return 1;
  }
  s.darkMisses = 0;
  const tries = s.darkTries;
  s.darkTries += 1;
  if (s.darkTries < 0x15) {
    if (tries === 0) {
      reEngage(s);
      stopWalking(s, '[Lost in the dark - trying to find the way back]');
    }
  } else {
    if (s.looping === 0) {
      s.darkTries = 0;
      s.lost = 1;
      s.walking = 0;
      s.roaming = 0;
      s.looping = 0;
      modeDefaults(s);
      reEngage(s);
      setTask(s, Task.Lost);
      setState(s, State.Nothing);
      stopWalking(s, "[Lost in the dark - couldn't find the way back, stopped]");
      return 1;
    }
    if (s.darkEscapeShown === 0) {
      s.darkEscapeShown = 1;
      stopWalking(s, '[Lost in the dark - trying every direction to escape]');
    }
    s.roomExits.fill(1);
    s.darkTries = 0;
  }
  s.roomSignature = 0;
  s.roomNameHash = 0;
  s.roomRecord = null;
  s.lost = 1;
  s.lostNeedsKnownRoom = 1;
  setState(s, State.Nothing);
  return 1;
}

export function moveLine(s: Session, line: string): number {
  if (line.includes(' to the ') && line.includes(' just locked!')) {
    s.lookDue = 1;
    return 1;
  }
  if (s.state !== State.Moving && s.state !== State.Opening) return 0;
  if (line.includes('There is no exit in that')) return noExit(s);
  const door = line.indexOf('The ');
  if (door === 0 && (line.includes(' is closed!') || line.includes(' is Closed!'))) {
    if (s.recording !== 0) stepBack(s);
    if (s.importing !== 0) s.importAt = s.importFrom;
    if (s.state === State.Moving && s.darkness > Darkness.Dim && s.moveDir !== -1) {
      s.MegaMud_CurPathStep -= 1;
      s.path.step = s.path.prev;
      if (s.task === Task.Walking) s.stepsToGo += 1;
      s.roomExits[s.moveDir] = Exit.ClosedDoor;
    } else {
      s.lookDue = 1;
    }
    s.expectedRoom = 0;
    setState(s, State.Nothing);
    return 1;
  }
  if (door !== -1 && line.includes(' is locked')) {
    if (s.state === State.Opening && s.moveDir !== -1) {
      s.roomExits[s.moveDir] = Exit.ClosedDoor;
      s.lineFlags |= LineFlag.DoorAnswered;
      setState(s, State.Nothing);
      return 1;
    }
    if (s.recording !== 0) stepBack(s);
    if (s.importing !== 0) s.importAt = s.importFrom;
    setState(s, State.Nothing);
    return 1;
  }
  if (door !== -1 && line.includes(' is now open')) {
    if (s.state === State.Opening && s.moveDir !== -1) {
      s.roomExits[s.moveDir] = Exit.OpenDoor;
      s.lineFlags |= LineFlag.DoorAnswered;
      s.lookDue = 0;
    } else {
      s.lookDue = 1;
    }
    s.openDoorNext = 0;
    s.sneaking = 0;
    s.hidden = 0;
    setState(s, State.Nothing);
    return 1;
  }
  if (door !== -1 && line.includes(' was already open')) {
    s.lookDue = 1;
    s.openDoorNext = 0;
    return 1;
  }
  if (!BLOCKED.some((b) => line.includes(b))) return 0;
  if (s.recording !== 0) stepBack(s);
  s.lastMoveDir = s.moveDir;
  setState(s, State.Nothing);
  if (s.walking !== 0 && s.lost === 0 && s.roaming === 0) {
    s.walking = 0;
    modeDefaults(s);
    reEngage(s);
    setTask(s, Task.InGame);
    stopWalking(s, '[Path blocked - Unable to continue]');
  }
  return 1;
}
