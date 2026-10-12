/**
 * `0x4ae4a0`: the remote commands (`@wait`, `@ok`, `@heal`, `@health`, …)
 * said, telepathed, paged or gangpathed to this character. Not ported yet.
 * `kind`: 1 said, 8 gangpath, 0x10 telepath, 0x20 page.
 */
import type { Session } from '../Session';
import { unported } from '../unported';

export function remoteCommand(_s: Session, _line: string, _kind: number): number {
  return unported('4ae4a0');
}
