/**
 * Picking locks (`0x438f90`): unlocked, not locked, or the skill failing
 * (tried again up to `Other.PickMax` when not automated; at `PickMax` the
 * exit is taken as unpickable, at twice that as a closed door). Read
 * 2026-10-12.
 */
import { directionShort, indexOf } from '../cstr';
import { queue } from '../script/send';
import { setState } from '../script/state';
import { automated, type Session } from '../Session';
import { State } from '../states';
import { LineFlag, Exit } from '../flags';

export function unlockLine(s: Session, line: string): number {
  const opened =
    indexOf(line, 'You successfully unlocked the ') !== -1 ||
    indexOf(line, 'The door was not locked') !== -1 ||
    indexOf(line, 'The gate was not locked') !== -1 ||
    indexOf(line, 'There is no benefit to picking') !== -1;
  if (opened) {
    if (s.state === State.Picking) {
      if (s.moveDir !== -1) {
        s.roomExits[s.moveDir] = Exit.Unlocked;
        s.lineFlags |= LineFlag.DoorAnswered;
      }
    } else if (
      s.state === State.Other ||
      s.state === State.PendingCmd ||
      s.state === State.Opening
    ) {
      s.openDoorNext = 1;
    }
    s.pickTries = 0;
    s.lookDue = 0;
    setState(s, State.Nothing);
    return 1;
  }
  if (indexOf(line, 'Your skill fails you ') === -1) return 0;
  s.pickTries += 1;
  const tries = s.pickTries;
  const dir = s.moveDir;
  if (s.state === State.Picking && dir !== -1) {
    if (tries < s.Other_PickMax * 2) {
      if (tries === s.Other_PickMax) {
        s.roomExits[dir] = Exit.Unlocked;
        s.lineFlags |= LineFlag.DoorAnswered;
      } else {
        s.openDoorNext = 0;
      }
    } else {
      s.bashTries = 0;
      s.roomExits[dir] = Exit.ClosedDoor;
      s.lineFlags |= LineFlag.DoorAnswered;
    }
  }
  if (!automated(s) && s.allOff === 0 && s.state === State.Picking && s.moveDir !== -1) {
    if (s.pickTries < s.Other_PickMax) queue(s, `pick ${directionShort(s.moveDir)}\r`);
    else s.pickTries = 0;
  }
  s.lookDue = 0;
  setState(s, State.Nothing);
  return 1;
}
