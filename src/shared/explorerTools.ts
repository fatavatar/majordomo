/**
 * MMUD Explorer's Tools tab (2026-10-19), mudtool's `tabs/tools.js` and
 * `js/tools/*.js`: the Swing, Hit and Backstab calculators, the Exp
 * calculator, the coin converter, the spell book and the monster attack
 * simulator, each worked out in main on the character's realm
 * (`src/main/mme/ExplorerTools.ts`) and opened on the character as the game
 * reports it. One request and its answer per tool, on one channel.
 */

export type ToolName =
  'swing' | 'hit' | 'backstab' | 'exp' | 'coin' | 'spellbook' | 'attacksim' | 'notepad';

export const TOOL_NAMES: readonly ToolName[] = [
  'swing',
  'hit',
  'backstab',
  'exp',
  'coin',
  'spellbook',
  'attacksim',
  'notepad'
];

/** The character's figures every calculator opens on (`profileFromChar`). */
export interface ToolProfile {
  cls: number;
  race: number;
  level: number;
  combat: number;
  str: number;
  agi: number;
  charm: number;
  encum: number;
  maxEncum: number;
  /** The weapon in the hand, 0 none. */
  weapon: number;
  stealth: number;
  classStealth: boolean;
  plusMaxDamage: number;
  bsMin: number;
  bsMax: number;
  accuracy: number;
  /** Backstab accuracy, with the weapon in the hand. */
  bsAccuracy: number;
  ac: number;
  dr: number;
  dodge: number;
  protEvil: number;
  mr: number;
  antiMagic: boolean;
  /** The class and race's exp chart, %. */
  chart: number;
}

/** What the tab opens with: the pickers' records, and the character. */
export interface ToolsStart {
  supported: boolean;
  reason?: string;
  weapons: Array<[number, string]>;
  /** Weapons that backstab (ability 116). */
  bsWeapons: Array<[number, string]>;
  monsters: Array<[number, string]>;
  classes: Array<[number, string]>;
  races: Array<[number, string]>;
  alignments: string[];
  /** The highest level the realm's races reach (`getMaxLevel`). */
  maxLevel: number;
  profile: ToolProfile;
}

export interface SwingInput {
  weapon: number;
  combat: number;
  level: number;
  agi: number;
  str: number;
  encum: number;
  maxEncum: number;
  /** 0 fast (85), 1 normal, 2 slow (125), 3 custom. */
  speed: number;
  customSpeed: number;
  slow: boolean;
  bash: boolean;
  /** The true average's figures, MegaMUD's Hit, Extra and Crit, and the swings. */
  tru: { hitP: number; hitA: number; extraP: number; extraA: number; critP: number; critA: number };
  swings: number | null;
}

export interface SwingOutput {
  found: boolean;
  energy: number;
  encPct: number;
  rawSwings: number;
  qnd: number;
  strengthShort: number | null;
  rounds: Array<{ swings: number; energyLeft: number }>;
  roundTotal: number;
  trueAverage: number;
}

export interface HitInput {
  backstab: boolean;
  accy: number;
  ac: number;
  dodge: number;
  protEv: number;
  vileWard: number;
  perception: number;
  /** 0 none, 1 criminal, 2 fiend (GreaterMUD only). */
  evil: number;
  shadow: boolean;
  seeHidden: boolean;
  /** The defender is a player (the character, or another). */
  vsPlayer: boolean;
  /** The character's class, where it is the defender. */
  cls: number;
}

export interface HitOutput {
  hit: number;
  dodge: number;
  overall: number;
  minHit: number;
  baseMinHit: number;
  maxHit: number;
  dodgeCap: number;
  dodgeSoftCap: number | null;
  greater: boolean;
}

/** A monster's figures the Hit calculator fills in (`GetMonsterData`). */
export interface ToolMonster {
  accy: number;
  ac: number;
  dodge: number;
  bsDefense: number;
  seeHidden: boolean;
  evil: boolean;
}

export interface BackstabInput {
  weapon: number;
  level: number;
  stealth: number;
  maxDmg: number;
  bsMin: number;
  bsMax: number;
  str: number;
  classStealth: boolean;
}

export interface BackstabOutput {
  noBS: boolean;
  min: number;
  max: number;
  avg: number;
  adj: { maxDmg: number; bsMin: number; bsMax: number; stealth: number };
  weaponMin: number;
  weaponMax: number;
}

export interface SpellBookRow {
  number: number;
  name: string;
  short: string;
  magery: string;
  level: number;
  mana: number | string;
  diff: number | string;
  dmg: string;
  dmgPerMana: number | string;
  heal: string;
  healPerMana: number | string;
  detail: string;
  learned: boolean;
}

export interface AttackSimInput {
  monster: number;
  rounds: number;
  dynamic: boolean;
  maxRoundOnly: boolean;
  hideEnergy: boolean;
  def: Record<
    'ac' | 'dr' | 'mr' | 'dodge' | 'protEvil' | 'rsto' | 'rcol' | 'rwat' | 'rfir' | 'rlit',
    number
  >;
  antiMagic: boolean;
  megaDodge: boolean;
}

export interface AttackSimOutput {
  ran: boolean;
  average: number;
  max: number;
  maxSeen: number;
  physical: number;
  spell: number;
  rounds: number;
  attacks: Array<{
    name: string;
    trueChance: number;
    avgHit: number;
    hitPct: number;
    dmgResistPct: number;
    resistDodgePct: number;
  } | null>;
  log: string;
}

/** One ask of a tool, and the answer it gets (`ToolAnswer`). */
export type ToolRequest =
  | { tool: 'start' }
  | { tool: 'swing'; input: SwingInput }
  | { tool: 'hit'; input: HitInput }
  | { tool: 'monster'; monster: number }
  | { tool: 'backstab'; input: BackstabInput }
  | { tool: 'expChart'; cls: number; race: number }
  | { tool: 'exp'; start: number; end: number; chart: number }
  | { tool: 'coin'; amount: number; from: number; to: number }
  | { tool: 'charm'; charm: number }
  | { tool: 'applyCharm'; amount: number; coin: number; pct: number }
  | { tool: 'spellbook'; cls: number; level: number; align: number }
  | { tool: 'attacksim'; input: AttackSimInput };

export type ToolAnswer<R extends ToolRequest> = R extends { tool: 'start' }
  ? ToolsStart
  : R extends { tool: 'swing' }
    ? SwingOutput
    : R extends { tool: 'hit' }
      ? HitOutput
      : R extends { tool: 'monster' }
        ? ToolMonster | null
        : R extends { tool: 'backstab' }
          ? BackstabOutput | null
          : R extends { tool: 'expChart' }
            ? number
            : R extends { tool: 'exp' }
              ? {
                  start: number;
                  end: number;
                  rows: Array<{ level: number; exp: number; needed: number }>;
                }
              : R extends { tool: 'coin' }
                ? { amount: number; weight: number | null }
                : R extends { tool: 'charm' }
                  ? { pct: number; label: string }
                  : R extends { tool: 'applyCharm' }
                    ? number | null
                    : R extends { tool: 'spellbook' }
                      ? SpellBookRow[]
                      : R extends { tool: 'attacksim' }
                        ? AttackSimOutput
                        : never;

/** MME's coins and their copper (`coins.js` `COINS`), copper first. */
export const TOOL_COINS: ReadonlyArray<[string, number]> = [
  ['copper', 1],
  ['silver', 10],
  ['gold', 100],
  ['platinum', 10000],
  ['runic', 1000000]
];

/** A request that crossed the wire, parsed: a tool by name, its figures numbers, else null. */
export function asToolRequest(value: unknown): ToolRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e9, Math.min(1e9, v)) : 0;
  const bool = (v: unknown): boolean => v === true;
  const record = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const nums = <K extends string>(v: unknown, keys: readonly K[]): Record<K, number> => {
    const r = record(v);
    return Object.fromEntries(keys.map((k) => [k, num(r[k])])) as Record<K, number>;
  };
  const input = record(o['input']);
  switch (o['tool']) {
    case 'start':
      return { tool: 'start' };
    case 'swing':
      return {
        tool: 'swing',
        input: {
          ...nums(input, [
            'weapon',
            'combat',
            'level',
            'agi',
            'str',
            'encum',
            'maxEncum',
            'speed',
            'customSpeed'
          ] as const),
          slow: bool(input['slow']),
          bash: bool(input['bash']),
          tru: nums(input['tru'], ['hitP', 'hitA', 'extraP', 'extraA', 'critP', 'critA'] as const),
          swings: input['swings'] === null ? null : num(input['swings'])
        }
      };
    case 'hit':
      return {
        tool: 'hit',
        input: {
          ...nums(input, [
            'accy',
            'ac',
            'dodge',
            'protEv',
            'vileWard',
            'perception',
            'evil',
            'cls'
          ] as const),
          backstab: bool(input['backstab']),
          shadow: bool(input['shadow']),
          seeHidden: bool(input['seeHidden']),
          vsPlayer: bool(input['vsPlayer'])
        }
      };
    case 'monster':
      return { tool: 'monster', monster: num(o['monster']) };
    case 'backstab':
      return {
        tool: 'backstab',
        input: {
          ...nums(input, [
            'weapon',
            'level',
            'stealth',
            'maxDmg',
            'bsMin',
            'bsMax',
            'str'
          ] as const),
          classStealth: bool(input['classStealth'])
        }
      };
    case 'expChart':
      return { tool: 'expChart', cls: num(o['cls']), race: num(o['race']) };
    case 'exp':
      return { tool: 'exp', start: num(o['start']), end: num(o['end']), chart: num(o['chart']) };
    case 'coin':
      return {
        tool: 'coin',
        amount: num(o['amount']),
        from: num(o['from']) || 1,
        to: num(o['to']) || 1
      };
    case 'charm':
      return { tool: 'charm', charm: num(o['charm']) };
    case 'applyCharm':
      return {
        tool: 'applyCharm',
        amount: num(o['amount']),
        coin: num(o['coin']) || 1,
        pct: num(o['pct'])
      };
    case 'spellbook':
      return {
        tool: 'spellbook',
        cls: num(o['cls']),
        level: num(o['level']),
        align: num(o['align'])
      };
    case 'attacksim':
      return {
        tool: 'attacksim',
        input: {
          monster: num(input['monster']),
          rounds: num(input['rounds']),
          dynamic: bool(input['dynamic']),
          maxRoundOnly: bool(input['maxRoundOnly']),
          hideEnergy: bool(input['hideEnergy']),
          def: nums(input['def'], [
            'ac',
            'dr',
            'mr',
            'dodge',
            'protEvil',
            'rsto',
            'rcol',
            'rwat',
            'rfir',
            'rlit'
          ] as const),
          antiMagic: bool(input['antiMagic']),
          megaDodge: bool(input['megaDodge'])
        }
      };
    default:
      return null;
  }
}
