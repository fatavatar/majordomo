import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x410780`: dropping unwanted coins (D18). Not ported yet. */
export function discardCash(_s: Session): number {
  return unported('410780');
}

/** `0x40b300`: sharing cash with the party (D37). Not ported yet. */
export function shareCash(_s: Session, _all: number): number {
  return unported('40b300');
}

/** `0x406d90`: depositing (D40). Not ported yet. */
export function depositCash(_s: Session): number {
  return unported('406d90');
}

/** `0x40d8a0`: withdrawing (D41). Not ported yet. */
export function withdrawCash(_s: Session): number {
  return unported('40d8a0');
}

/** `0x40ce50`: stashing (D46). Not ported yet. */
export function stashItems(_s: Session): number {
  return unported('40ce50');
}
