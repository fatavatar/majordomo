/** `mmud/usable.js`: `ItemIsUsableByChar`, `IsInGame`. Ours, beside mudtool's copy. */
import type { Row } from '../db';
import type { MmeChar } from '../char';
export function itemUsableBy(
  item: Row | number,
  ch: MmeChar,
  opts?: Record<string, unknown>
): boolean;
export function isInGame(row: Row): boolean;
