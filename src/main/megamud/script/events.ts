import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x407390`: logon, logoff, relog and timed events (D29, D32). Not ported yet. */
export function eventsStep(_s: Session): number {
  return unported('407390');
}

/** `0x4375f0`: the next timed event due (its index), or -1. Not ported yet. */
export function nextEvent(_s: Session): number {
  unported('4375f0');
  return -1;
}
