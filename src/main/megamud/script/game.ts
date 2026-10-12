/**
 * Entering and leaving the game: the first prompt's set-up (`0x47b070`'s
 * tail and `0x42de00` with 1), and hanging up (`0x42d510`). Not ported yet.
 */
import type { Session } from '../Session';
import { unported } from '../unported';

/** The first prompt in the game. Not ported yet: marks the session in the game. */
export function enterGame(s: Session): void {
  unported('42de00');
  s.inGame = 1;
}

/** `0x42d510`: drop the connection. */
export function hangUp(_s: Session, _how: number): void {
  unported('42d510');
}
