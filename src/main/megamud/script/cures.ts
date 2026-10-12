import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x410130`: cures (D26 in a fight, D34 out of one). Not ported yet. */
export function cureStep(_s: Session, _fighting: number): number {
  return unported('410130');
}
