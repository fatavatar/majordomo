import type { Carried, Session } from '../Session';
import { unported } from '../unported';

/** `0x455230`: not ported yet. */
export function inventoryLine(_s: Session, _line: string, _flag: number): number {
  return unported('455230');
}

/** `0x4ad760`: every `quote` dropped (one after another, the second is kept). */
function dropChar(text: string, quote: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === quote) {
      if (i + 1 < text.length) out += text[i + 1];
      i += 1;
      continue;
    }
    out += text[i];
  }
  return out;
}

/**
 * `0x45a100`: two item names are the same, apostrophes aside, or one is the
 * other with an `s` added.
 */
export function sameItemName(a: string, b: string): boolean {
  const x = dropChar(a.slice(0, 99), "'");
  const y = dropChar(b.slice(0, 99), "'");
  if (x === y) return true;
  if (x.length === y.length + 1 && x.endsWith('s') && x.startsWith(y)) return true;
  return x.length + 1 === y.length && y.endsWith('s') && y.startsWith(x);
}

const BOATS = ['log raft', 'silverbark canoe'];

/** `0x4530c0`: the inventory line for `name` (asking for a wooden skiff, any boat will do). */
export function findCarried(s: Session, name: string): Carried | null {
  for (const c of s.inventory) {
    if (!c.item) continue;
    if (sameItemName(c.item.name, name)) return c;
    if (name === 'wooden skiff' && BOATS.some((b) => sameItemName(c.item!.name, b))) return c;
  }
  return null;
}
