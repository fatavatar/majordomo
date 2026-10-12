import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x4120b0`: the fight: heals and attacks (D23). Not ported yet. */
export function combatStep(_s: Session): number {
  return unported('4120b0');
}
