import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x407c90`: path commands (D44). Not ported yet. */
export function pathCommands(_s: Session): number {
  return unported('407c90');
}

/** `0x408270`: no allowed exits (D47). Not ported yet. */
export function noAllowedExits(_s: Session): number {
  return unported('408270');
}

/** `0x409170`: walking the path (D48): our walker's. Not ported yet. */
export function walkPath(_s: Session): number {
  return unported('409170');
}
