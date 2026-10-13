/**
 * Picking locks (`0x438f90`): unlocked, not locked, or the skill failing
 * (tried again up to `Other.PickMax` when not automated; at `PickMax` the
 * exit is taken as unpickable, at twice that as a closed door). Read
 * 2026-10-12.
 */
import { directionShort, indexOf } from '../cstr';
import { queue } from '../script/send';
import { setState } from '../script/state';
import type { Session } from '../Session';

export function unlockLine(s: Session, line: string): number {
  const opened =
    indexOf(line, 'You successfully unlocked the ') !== -1 ||
    indexOf(line, 'The door was not locked') !== -1 ||
    indexOf(line, 'The gate was not locked') !== -1 ||
    indexOf(line, 'There is no benefit to picking') !== -1;
  if (opened) {
    if (s.state === 0x18) {
      if (s.moveDir !== -1) {
        s.roomExits[s.moveDir] = 5;
        s.lineFlags |= 4;
      }
    } else if (s.state === 0x2e || s.state === 0x2d || s.state === 0x1a) {
      s.f_e2dc = 1;
    }
    s.f_db50 = 0;
    s.f_e290 = 0;
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, 'Your skill fails you ') === -1) return 0;
  s.f_db50 += 1;
  const tries = s.f_db50;
  const dir = s.moveDir;
  if (s.state === 0x18 && dir !== -1) {
    if (tries < s.Other_PickMax * 2) {
      if (tries === s.Other_PickMax) {
        s.roomExits[dir] = 5;
        s.lineFlags |= 4;
      } else {
        s.f_e2dc = 0;
      }
    } else {
      s.f_db48 = 0;
      s.roomExits[dir] = 2;
      s.lineFlags |= 4;
    }
  }
  const automated =
    s.active !== 0 || s.walking !== 0 || s.roaming !== 0 || s.importing !== 0 || s.f_a32c !== 0;
  if (!automated && s.state === 0x18 && s.moveDir !== -1) {
    if (s.f_db50 < s.Other_PickMax) queue(s, `pick ${directionShort(s.moveDir)}\r`);
    else s.f_db50 = 0;
  }
  s.f_e290 = 0;
  setState(s, 0);
  return 1;
}
