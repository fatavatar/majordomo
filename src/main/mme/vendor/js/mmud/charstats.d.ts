/** `mmud/charstats.js`: `equipItem`, `equipSlotFor`. Ours, beside mudtool's copy. */
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
