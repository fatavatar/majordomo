/**
 * Being ill and effects wearing off (`0x47af20`). Read 2026-10-12.
 */
import { indexOf } from '../cstr';
import { messageEnded } from '../messages/messages';
import { setState } from '../script/state';
import type { Session } from '../Session';

/** `0x46bb10`: every active Messages.md row's ending tried against the line. */
function anyMessageEnded(s: Session, line: string): number {
  let ended = 0;
  for (const rec of s.data.messages ?? []) {
    if ((rec.effects & 0x8000) === 0 && messageEnded(s, line, rec) !== 0) ended = 1;
  }
  return ended;
}

export function illLine(s: Session, line: string): number {
  if (indexOf(line, 'You feel ill') !== -1 || indexOf(line, 'You feel sick') !== -1) {
    s.poisoned = 1;
    return 1;
  }
  if (indexOf(line, 'You are too sick to rest') !== -1) {
    s.resting = 0;
    s.meditating = 0;
    s.poisoned = 1;
    s.f_e1f8 = 1;
    if (s.state === 2 || s.state === 4) setState(s, 0);
    return 1;
  }
  if (
    indexOf(line, 'The effects of') !== -1 ||
    indexOf(line, 'You are no longer') !== -1 ||
    indexOf(line, 'Your are no longer') !== -1 ||
    indexOf(line, 'returns to') !== -1 ||
    indexOf(line, 'wear off') !== -1 ||
    indexOf(line, 'wears off') !== -1
  ) {
    return anyMessageEnded(s, line);
  }
  return 0;
}
