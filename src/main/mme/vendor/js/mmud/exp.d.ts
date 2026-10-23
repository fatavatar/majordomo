/** `mmud/exp.js`: the exp charts. Ours, beside mudtool's copy. */
export function expChart(clsNum: number, raceNum: number): number;
export function expRows(
  start: number,
  end: number,
  exptable: number
): { start: number; end: number; rows: Array<{ level: number; exp: number; needed: number }> };
export function getMaxLevel(): number;
