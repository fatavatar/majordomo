/**
 * `0x4785b0`: the inventory, who and top listings MegaMUD asked for, given up
 * on when they take too long. Not ported yet.
 */
import type { Session } from '../Session';
import { unported } from '../unported';

export function listingTimeouts(_s: Session): void {
  unported('4785b0');
}
