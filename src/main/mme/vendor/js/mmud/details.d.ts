/** `mmud/details.js`: item columns and `PullItemDetail`. Ours, beside mudtool's copy. */
import type { Row } from '../db';
export function hasAbil(row: Row, abil: number, none?: number): number;
export function weaponCols(
  item: Row,
  abilFilter?: number
): { level: number; acc: number; bs: number | string; crits: number; ac: string; abilVal: number };
export function armourCols(
  item: Row,
  abilFilter?: number
): { level: number; acc: number; crits: number; abilVal: number; ac: string; acEnc: number };
export function itemDetail(
  item: Row | number,
  ctx?: { equipped?: number[] } & Record<string, unknown>
): { text: string; refs: Array<{ text: string; pct?: number | string }> };
export function segments(
  text: string
): Array<{ text: string } | { kind: string; n: number | string; text: string }>;
/** A column a hook adds to a list (`hooks.columns.<list>`), as mudtool's table reads it. */
export interface HookColumn {
  key: string;
  label: string;
  num?: boolean;
  width?: string;
  get(item: Row): number | string;
  fmt?(value: number | string, item: Row): string | number;
}
export const hooks: {
  columns: {
    weapons: HookColumn[];
    armour: HookColumn[];
    spells: HookColumn[];
    monsters: HookColumn[];
  };
  monsterExtraRows: Array<(monster: Row, ctx: Record<string, unknown>) => MonsterRow[]>;
  monsterDamageIn?: (n: number) => { damage: number; calculated: boolean };
};
/** MME's ability filter's choices, `[number, name]`. */
export function abilityList(): Array<[number, string]>;
/** `AddSpell2LV`'s own columns for a spell, at the character's level where `ctx.useChar`. */
export function spellCols(
  spell: Row,
  ctx?: Record<string, unknown>
): { magery: string; mana: number; diff: number | string; detail: string; area: boolean };
/** The rows `AddSpell2LV` lists. */
export function spellListed(spell: Row): boolean;
/** `PullSpellDetail`. */
export function spellDetail(
  spell: Row | number,
  ctx?: Record<string, unknown>
): { text: string; refs: Array<{ text: string; pct?: number | string }> };
/** A run of marked-up text as plain text. */
export function plain(text: string): string;
/** `PullShopDetail`: a shop's line, its stock or a trainer's table, its charm line, where it is. */
export function shopDetail(
  shop: Row | number,
  charm?: number,
  showSell?: boolean
): {
  text: string;
  trainer: boolean;
  rows: Array<{
    item?: number;
    name?: string;
    max?: number;
    regen?: string;
    level?: number;
    cost: string;
    copper: number;
  }>;
  charmMod: string;
  refs: Array<{ text: string; pct?: number | string }>;
};
/** `GetLairInfo`. */
export function lairInfoFor(groupIndex: unknown, maxRegen?: number): unknown;
/** `GetItemValue`: what an item costs, and its friendly price. */
export function itemValue(
  item: Row | number,
  charm?: number,
  markup?: number
): { nCopperBuy: number; sFriendlyBuy: string };
/** A row of `PullMonsterDetail`'s table: its label and text, marked up, and a class. */
export interface MonsterRow {
  label: string;
  text: string;
  cls?: string;
}
export function monsterDetail(monster: Row | number, ctx?: Record<string, unknown>): MonsterRow[];
export function monsterExp(monster: Row): number;
export function fmtComma(n: number): string;
/** A lair's averages over its spawns (`GetLairInfo`). */
export function lairAverages(
  summonedBy: string,
  ctx?: Record<string, unknown>
): {
  nTotalLairs: number;
  nAvgHP: number;
  nAvgDmgLair: number;
  nMaxRegen: number;
};
export function monsterPossy(n: number): { possy: number; spawnChance: number };
export function monsterAttackSummary(
  monster: Row,
  spellTypes?: boolean,
  specials?: boolean
): {
  nAccMax: number;
  nAccMajority: number;
  bAtkPoison?: boolean;
  bAtkConfusion?: boolean;
  bAtkFear?: boolean;
};
export function monsterSpellAttackCol(monster: Row): string;
export function expPerDmgHP(exp: number, avgDmg: number, hp: number): number;
export function classCols(c: Row): {
  exp: string;
  weapon: string;
  armour: string;
  magic: string;
  combat: number;
  hp: string;
};
export function classAbilities(c: Row): string;
export function raceAbilities(r: Row): string;
export function raceStat(r: Row, key: string): string;
/** `RaceColorCode`: per race, each stat `lo` or `hi` where it is twenty off the average. */
export function raceColours(races: Row[]): Map<number, Record<string, 'lo' | 'hi'>>;
/** `AddListViewRowsForItem`'s Value and Shop: the cheapest counter and its buy / sell, at a charm. */
export function bestShopPrice(
  item: Row | number,
  charm?: number
): { shop: number; more: number; value: string; sellOnly: boolean; copperSell: number };
/** `Fix` to `places` decimals. */
export function truncate(v: number, places?: number): number;
