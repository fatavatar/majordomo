/** `mmud/chest.js`: MME's "View Chest Contents". Ours, beside mudtool's copy. */
import type { Row } from '../db';
/** What a container holds and its chance of each, highest first; null where it is no chest. */
export function chestContents(item: Row | number): Array<{ item: number; pct: number }> | null;
