/** `char.js`: MME's character. Ours, beside mudtool's copy. */
export interface MmeChar {
  name: string;
  cls: number;
  race: number;
  level: number;
  alignment: number;
  stats: { str: number; int: number; wis: number; agi: number; hea: number; cha: number };
  equipped: number[];
  learnedSpells: number[];
  weaponVsChar: { ac: number; dr: number; dodge: number };
  spellVsMR: number;
  attack: Record<string, unknown>;
  statAdjustments: number[];
  bless: number[];
  addWeight: number;
  useAddWeight: boolean;
  itemManager: Array<{ item: number; flag: string; qty: number; fieldQty: number; source: string }>;
  [field: string]: unknown;
}
export const EQ_SLOTS: string[];
/** `cmbGlobalAlignment`: Any, Good, Neutral, Evil. */
export const ALIGNMENTS: string[];
export function blankChar(): MmeChar;
export let char: MmeChar;
export const roster: { active: string | null; chars: Array<{ id: string; char: MmeChar }> };
export function switchChar(id: string): void;
