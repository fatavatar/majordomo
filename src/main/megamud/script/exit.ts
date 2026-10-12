import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x4118f0`: exiting: BBS shutdown, timed logoff, relog (D31). Not ported yet. */
export function exitStep(_s: Session): number {
  return unported('4118f0');
}
