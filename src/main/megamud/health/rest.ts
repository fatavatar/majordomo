import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x414300`: health: full spells, regen, rest, meditate (D10, D39). Not ported yet. */
export function healthStep(_s: Session): number {
  return unported('414300');
}
