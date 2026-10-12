/**
 * The detours queued (`0x8174`: a shop trip "for" an item, and back), read
 * 2026-10-12.
 */
import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x43ccd0`: detour `i` is done: the rest move up; the first done, the next starts (`0x43cec0`). */
export function detourDone(s: Session, i: number): number {
  if (s.detours[0]!.room === 0) return 0;
  s.detours.splice(i, 1);
  s.detours.push({ room: 0, path: '', why: '' });
  if (i === 0) unported('43cec0');
  return 1;
}
