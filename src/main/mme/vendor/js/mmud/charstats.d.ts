/** `mmud/charstats.js`: `equipItem`, `equipSlotFor`, Find Best. Ours, beside mudtool's copy. */
import type { MmeChar } from '../char';
export function equipItem(
  c: Pick<MmeChar, 'equipped'>,
  n: number,
  opts?: { use2ndWrist?: boolean; toggle?: boolean }
): { slot?: number; unequipped?: boolean; error?: string };
export function equipSlotFor(
  equipped: readonly number[],
  item: number,
  opts?: { use2ndWrist?: boolean }
): { slot?: number; already?: number; nowhere?: boolean };
/** One of the Find Best menu's rules: abilities summed, a field, or AC and DR together. */
export interface FindBestRule {
  abils?: number[];
  field?: string;
  acdr?: boolean;
  greater?: boolean;
}
export const FIND_BEST: Array<[string, Array<[string, FindBestRule]>]>;
export function eqSlotLists(
  c: Pick<MmeChar, 'equipped'>,
  opts?: { globalFilter?: boolean; onlyInGame?: boolean }
): number[][];
export function findBestValue(item: Record<string, unknown>, rule: FindBestRule): number;
export function findBest(
  equipped: readonly number[],
  lists: number[][],
  rule: FindBestRule,
  opts?: { next?: boolean; holds?: boolean[]; noLimited?: boolean; use2ndWrist?: boolean }
): { equipped: number[]; found: boolean };
export function calcCharStats(c: MmeChar, opt?: Record<string, unknown>): unknown;
export function calcCharSummary(c: MmeChar, panel: unknown): unknown;
