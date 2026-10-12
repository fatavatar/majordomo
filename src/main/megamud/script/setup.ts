import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x40b200`: the game options MegaMUD needs (D13). Not ported yet. */
export function gameSetup(_s: Session): number {
  return unported('40b200');
}

/** `0x40d0e0`: exp, spells and stats when stale (D14). Not ported yet. */
export function refreshStats(_s: Session): number {
  return unported('40d0e0');
}

/** `0x407e40`: the inventory when stale (D15). Not ported yet. */
export function refreshInventory(_s: Session): number {
  return unported('407e40');
}

/** `0x40d820`: who is online (D16). Not ported yet. */
export function refreshWho(_s: Session): number {
  return unported('40d820');
}

/** `0x40aae0`: an inventory listing given up on ("Bueller?"). Not ported yet. */
export function listingTimedOut(_s: Session): number {
  return unported('40aae0');
}

/** `0x495590`: exp, stats and spells to be asked for again (the spells' learned marks cleared). */
export function statsWanted(s: Session): void {
  s.f_e29c = 1;
  for (const spell of s.data.spells) spell.flags &= ~0x1000;
}
