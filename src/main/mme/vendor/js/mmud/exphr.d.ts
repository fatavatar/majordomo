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
export function expHrProfile(profile: unknown, useChar: boolean, spellOverhead?: number): unknown;
export interface ExpHrResult {
  kind: string;
  info: { nExpPerHour: number; nTimeRecovering: number } | null;
  args?: Record<string, number>;
}
export function monsterExpPerHour(monster: Row, env: Record<string, unknown>): ExpHrResult;
export function expPerHourCell(n: number): string;
export function scriptingRows(
  monster: Row,
  result: ExpHrResult,
  opts: { useChar?: boolean; showAll?: boolean }
): Array<{ label: string; text: string; cls?: string }>;
