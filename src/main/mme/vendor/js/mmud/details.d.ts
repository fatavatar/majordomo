/** `mmud/details.js`: item columns and `PullItemDetail`. Ours, beside mudtool's copy. */
import type { Row } from '../db';
export function hasAbil(row: Row, abil: number, none?: number): number;
export function weaponCols(
  item: Row,
  abilFilter?: number
): { level: number; acc: number; bs: number | string; crits: number; ac: string; abilVal: number };
export function armourCols(
  item: Row,
  abilFilter?: number
): { level: number; acc: number; crits: number; abilVal: number; ac: string; acEnc: number };
export function itemDetail(
  item: Row | number,
  ctx?: { equipped?: number[] }
): { text: string; refs: Array<{ text: string; pct?: number | string }> };
export function segments(
  text: string
): Array<{ text: string } | { kind: string; n: number | string; text: string }>;
/** A column a hook adds to a list (`hooks.columns.<list>`), as mudtool's table reads it. */
export interface HookColumn {
  key: string;
  label: string;
  num?: boolean;
  width?: string;
  get(item: Row): number | string;
  fmt?(value: number | string, item: Row): string | number;
}
export const hooks: { columns: { weapons: HookColumn[]; armour: HookColumn[] } };
/** MME's ability filter's choices, `[number, name]`. */
export function abilityList(): Array<[number, string]>;
