import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x49c570`: scheduler step D21 (not read yet). Not ported yet. */
export function step21(_s: Session): number {
  return unported('49c570');
}

/** `0x46fee0`: the MUD op room check (D38, D11). Not ported yet. */
export function roomCheck(_s: Session): number {
  return unported('46fee0');
}

/** `0x40aff0`: searching (D45). Not ported yet. */
export function searchRoom(_s: Session): number {
  return unported('40aff0');
}
