/**
 * Sneaking and hiding (`0x47d5a0`). Read 2026-10-12. `e1c4` is sneaking,
 * `db6c` the failures in a row, `db68` the refusals.
 */
import { indexOf } from '../cstr';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { State } from '../states';

export function stealthLine(s: Session, line: string): number {
  if (indexOf(line, 'You are no longer sneaking') !== -1) {
    s.sneaking = 0;
    s.hidden = 0;
    return 1;
  }
  const hiding = indexOf(line, 'Attempting to hide...') !== -1;
  const sneaking = !hiding && indexOf(line, 'Attempting to sneak...') !== -1;
  if (!hiding && !sneaking) {
    if (indexOf(line, 'Sneaking...') !== -1) {
      s.sneaking = 1;
      s.wasSneaking = 1;
      s.stealthFails = 0;
      return 1;
    }
    if (indexOf(line, 'You make a sound as you enter') !== -1) {
      s.sneaking = 0;
      s.hidden = 0;
      return 1;
    }
    if (
      indexOf(line, 'You may not sneak right now') === -1 &&
      indexOf(line, 'You may not hide while') === -1
    )
      return 0;
    s.stealthRefused += 1;
    s.stealthFails += 1;
    s.sneaking = 0;
    s.hidden = 0;
    s.roomLookedAt = 0;
    s.lookDue = 1;
    setState(s, State.Nothing);
    return 1;
  }
  const failed = indexOf(line, "You don't think") !== -1;
  if (hiding) {
    if (!failed) {
      s.stealthFails = 0;
      s.hidden = 1;
    } else {
      s.stealthFails += 1;
      s.hideAgain = 1;
      s.hidden = 0;
    }
  } else {
    if (!failed) s.stealthFails = 0;
    else {
      s.stealthFails += 1;
      s.wasSneaking = 0;
    }
    s.sneaking = failed ? 0 : 1;
  }
  if (s.state !== State.Moving && s.state !== State.Looking && s.state !== State.Blessing)
    setState(s, State.Nothing);
  return 1;
}
