/** `mmud/engine.js`. Ours, beside mudtool's copy. */
export const engine: {
  greater: boolean;
  nmrVersion: number;
  datVersion: number;
  datLabel: string;
  disableKai: boolean;
  /** MME's: a fully-resistable spell's chance to be resisted outright comes off its damage too. */
  fullResistDamage: boolean;
};
export function detectEngine(info: unknown): unknown;
