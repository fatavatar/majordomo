/** `mmud/coins.js`: `frmCoinConvert`. Ours, beside mudtool's copy. */
export function convertCoin(n: number, from: number, to: number): number;
export function coinWeight(n: number): number | null;
export function charmModifier(charm: number, filterOn?: boolean): { pct: number; label: string };
export function applyCharm(amount: number, coin: number, pct: number): number | null;
