/** Traps found and disarmed (`0x437f40`). Read 2026-10-12. */
import { indexOf } from '../cstr';
import { setState } from '../script/state';
import type { Session } from '../Session';

export function trapLine(s: Session, line: string): number {
  if (indexOf(line, 'You found a trap') !== -1) {
    s.f_e2e0 = 1;
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, 'You successfully disarmed the') !== -1) {
    s.f_e2e4 = 1;
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, 'You failed to disarm any trap') !== -1) {
    setState(s, 0);
    return 1;
  }
  return 0;
}
