/**
 * `0x40dc20`: the low-HP escape for a MUD op (`sys goto`) and the related
 * waits. Scheduler step D30, also called on `*Combat Engaged*`. Not ported yet.
 */
import type { Session } from '../Session';
import { unported } from '../unported';

export function escapeCheck(_s: Session, _why: string): number {
  return unported('40dc20');
}
