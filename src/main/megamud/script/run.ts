/** `0x40e190`: the run check (PvP hang-up, polite attacks, low HP or mana). Not ported yet. */
import type { Session } from '../Session';
import { unported } from '../unported';

export function runCheck(_s: Session): number {
  return unported('40e190');
}
