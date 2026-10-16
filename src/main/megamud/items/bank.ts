/** `You deposit …` / `You withdrew …` (`0x4539f0`): the banking is done. Read 2026-10-12. */
import { indexOf } from '../cstr';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { State } from '../states';

export function bankLine(s: Session, line: string): number {
  if (indexOf(line, 'You deposit ') === -1 && indexOf(line, 'You withdrew ') === -1) return 0;
  s.weightMax = 0;
  s.bankedHere = 1;
  forgetAwaited(s, s.state);
  setState(s, State.Nothing);
  return 1;
}
