import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x4066f0`: blessings (D22 in a fight, D25 out of one). Not ported yet. */
export function blessStep(_s: Session, _fighting: number): number {
  return unported('4066f0');
}
