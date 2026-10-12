import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x408e40`: party status and @health (D17). Not ported yet. */
export function partyStatus(_s: Session): number {
  return unported('408e40');
}

/** `0x407ee0`: inviting players (D27). Not ported yet. */
export function invitePlayers(_s: Session): number {
  return unported('407ee0');
}

/** `0x408100`: looking at a player (D35). Not ported yet. */
export function lookAtPlayer(_s: Session): number {
  return unported('408100');
}

/** `0x40d2e0`: tracking a player (D36). Not ported yet. */
export function trackPlayer(_s: Session): number {
  return unported('40d2e0');
}
