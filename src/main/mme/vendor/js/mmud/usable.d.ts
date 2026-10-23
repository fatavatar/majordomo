/** `mmud/usable.js`: `ItemIsUsableByChar`, `SpellIsUsable`, `IsInGame`. Ours, beside mudtool's copy. */
import type { Row } from '../db';
import type { MmeChar } from '../char';
export function itemUsableBy(
  item: Row | number,
  ch: MmeChar,
  opts?: Record<string, unknown>
): boolean;
export function isInGame(row: Row): boolean;
export function spellUsableBy(
  spell: Row | number,
  cls: number,
  level?: number,
  alignment?: number,
  andLearnable?: boolean
): boolean;
