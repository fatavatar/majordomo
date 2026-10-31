/** `mmud/exphr.js`: MME's exp/hour estimate. Ours, beside mudtool's copy. */
import type { Row } from '../db';
import type { MmeChar } from '../char';
export const EXPHR_DEFAULTS: Record<string, unknown>;
export function normaliseExpHrConfig(c?: Record<string, unknown>): Record<string, unknown> & {
  recoveryOnly?: boolean;
  showAll?: boolean;
};
export function attackConfig(attack?: unknown, equipped?: number[]): unknown;
export function expHrCharacter(
  c: MmeChar,
  opts: { useChar?: boolean; profile?: unknown; panel?: unknown; summary?: unknown }
): { spellOverhead?: number } & Record<string, unknown>;
/**
 * `RefreshCombatHealingValues`: the heal a round MME counts against the blows,
 * and its mana a round, for the heal settings in `attack` (its every-N-rounds
 * in `healRounds`).
 */
export function healingValues(
  attack?: Record<string, unknown>,
  profile?: unknown,
  useChar?: boolean
): { value: number; cost: number };
export function expHrProfile(profile: unknown, useChar: boolean, spellOverhead?: number): unknown;
export interface ExpHrResult {
  kind: string;
  info: {
    nExpPerHour: number;
    nTimeRecovering: number;
    nAttackTime: number;
    nMove: number;
    nRTC: number;
  } | null;
  args?: Record<string, number>;
  /** `GetLairInfo`'s averages, where the monster spawns in lairs. */
  lair?: Record<string, number>;
  exp?: number;
}
export function monsterExpPerHour(monster: Row, env: Record<string, unknown>): ExpHrResult;
/** `CalcExpPerHour`: MME's models over a lair's or a monster's figures. */
export function calcExpPerHour(
  args: Record<string, number>,
  config?: Record<string, unknown>
): NonNullable<ExpHrResult['info']>;
/** `GetDamageOutput` against a lair's averages: damage a round to one monster, and the spell's cost. */
export function lairDamageOutput(
  info: Record<string, number>,
  profile: unknown,
  attack: unknown
): { damageOut: number; spell: { nManaCost: number } | null };
export function expPerHourCell(n: number): string;
export function scriptingRows(
  monster: Row,
  result: ExpHrResult,
  opts: { useChar?: boolean; showAll?: boolean }
): Array<{ label: string; text: string; cls?: string }>;
