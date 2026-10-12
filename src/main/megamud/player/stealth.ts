/**
 * Sneaking and hiding (`0x47d5a0`). Read 2026-10-12. `e1c4` is sneaking,
 * `db6c` the failures in a row, `db68` the refusals.
 */
import { indexOf } from '../cstr';
import { setState } from '../script/state';
import type { Session } from '../Session';

export function stealthLine(s: Session, line: string): number {
  if (indexOf(line, 'You are no longer sneaking') !== -1) {
    s.f_e1c4 = 0;
    s.hidden = 0;
    return 1;
  }
  const hiding = indexOf(line, 'Attempting to hide...') !== -1;
  const sneaking = !hiding && indexOf(line, 'Attempting to sneak...') !== -1;
  if (!hiding && !sneaking) {
    if (indexOf(line, 'Sneaking...') !== -1) {
      s.f_e1c4 = 1;
      s.f_e1c8 = 1;
      s.f_db6c = 0;
      if (s.f_a32c === 0) s.f_32690 += 1;
      return 1;
    }
    if (indexOf(line, 'You make a sound as you enter') !== -1) {
      s.f_e1c4 = 0;
      s.hidden = 0;
      if (s.f_a32c === 0) s.f_32690 -= 1;
      return 1;
    }
    if (
      indexOf(line, 'You may not sneak right now') === -1 &&
      indexOf(line, 'You may not hide while') === -1
    )
      return 0;
    s.f_db68 += 1;
    s.f_db6c += 1;
    s.f_e1c4 = 0;
    s.hidden = 0;
    s.f_32390 = 0;
    s.f_e290 = 1;
    setState(s, 0);
    return 1;
  }
  const failed = indexOf(line, "You don't think") !== -1;
  if (hiding) {
    if (!failed) {
      s.f_db6c = 0;
      s.hidden = 1;
    } else {
      s.f_db6c += 1;
      s.f_e1d0 = 1;
      s.hidden = 0;
    }
  } else {
    if (!failed) s.f_db6c = 0;
    else {
      s.f_db6c += 1;
      s.f_e1c8 = 0;
    }
    s.f_e1c4 = failed ? 0 : 1;
  }
  if (s.state !== 0x16 && s.state !== 0x20 && s.state !== 0x10) setState(s, 0);
  return 1;
}
