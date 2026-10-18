/** `mmud/engine.js`. Ours, beside mudtool's copy. */
export const engine: {
  greater: boolean;
  nmrVersion: number;
  datVersion: number;
  datLabel: string;
  disableKai: boolean;
};
export function detectEngine(info: unknown): unknown;
