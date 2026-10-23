/** `state.js`: MME's settings. Ours, beside mudtool's copy. */
export const settings: Record<string, unknown>;
export function setSetting(key: string, value: unknown): void;
/** Session view state other modules read (`monstersByLair`). */
export const view: { monstersByLair: boolean };
export function setView(key: string, value: unknown): void;
