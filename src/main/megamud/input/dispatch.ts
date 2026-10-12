/**
 * `0x479b20`: one line, whole (`complete` 1) or the partial line a prompt
 * leaves (`complete` 0), handed to the line handlers in MegaMUD's order. Not
 * ported yet.
 */
import type { Session } from '../Session';
import { unported } from '../unported';

export function dispatchLine(
  _s: Session,
  _line: string,
  _complete: number,
  _nested: number
): number {
  return unported('479b20');
}
