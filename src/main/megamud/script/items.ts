import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x40e080`: getting what is collected (D19). Not ported yet. */
export function collectItems(_s: Session): number {
  return unported('40e080');
}

/** `0x410d00`: auto-equipping (D20). Not ported yet. */
export function autoEquip(_s: Session): number {
  return unported('410d00');
}

/** `0x406b60`: buying (D42). Not ported yet. */
export function buyItems(_s: Session): number {
  return unported('406b60');
}

/** `0x40b0b0`: selling (D43). Not ported yet. */
export function sellItems(_s: Session): number {
  return unported('40b0b0');
}
