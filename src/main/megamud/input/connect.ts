import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x45a6b0`: not ported yet. */
export function connectThreadLine(_s: Session): number {
  return unported('45a6b0');
}

/** `0x45ad00`: not ported yet. */
export function bbsLine(_s: Session, _line: string, _complete: number): number {
  return unported('45ad00');
}
