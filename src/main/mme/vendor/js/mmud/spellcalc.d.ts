/** `mmud/spellcalc.js`: MME's spell arithmetic. Ours, beside mudtool's copy; only what the facade reads. */
export const ROUND_SECS: number;
/** A heal- or damage-over-time spell ticks every this many seconds. */
export const SPELL_ROUND_SECS: number;
export interface SpellCast {
  nAvgCast: number;
  nAvgRoundHeals: number;
  nDuration: number;
  nManaCost: number;
  bDoesHeal: boolean;
  bDoesDamage: boolean;
  sSpellName: string;
}
export function calculateSpellCast(
  profile: unknown,
  spell: number,
  castLevel?: number,
  opts?: Record<string, unknown>
): SpellCast;
