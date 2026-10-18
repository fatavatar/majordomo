/**
 * MMUD Explorer's lists, as main answers them for one character on its realm
 * (`src/main/mme/Explorer.ts`, 2026-10-18).
 *
 * A list carries its own columns, MME's whole set for the kind as mudtool
 * draws them (`../mudtool/js/tabs/*.js`), and each row a cell per column, so a
 * kind is added in main and the window draws whatever it is sent. What the
 * filter bar reads is beside the cells, as the facts mudtool's `passes` reads.
 */

/** Which of MME's lists. */
export type ExplorerKind = 'weapons' | 'armour';

export const EXPLORER_KINDS: readonly ExplorerKind[] = ['weapons', 'armour'];

/** One column: its heading and how wide, and whether it holds figures. */
export interface ExplorerColumn {
  id: string;
  label: string;
  /** A CSS grid track, mudtool's own width for it. */
  width: string;
  /** Right-aligned and sorted as figures, largest first on its first press. */
  numeric?: boolean;
}

/** What a cell sorts by: a figure, or a word. */
export type ExplorerCell = number | string;

/** What mudtool's filter bars read of an item, beside its cells. */
export interface ExplorerFacts {
  /** Weapon type (`1H Sharp`) or armour type (`Leather`), by MME's name. */
  type: string;
  /** Armour only: where it is worn (`Finger`). */
  slot?: string;
  /** The `Magical` ability's value; 0 for none. */
  magical: number;
  /** Whether it states `Magical` at all, which armour's Non-magic asks. */
  hasMagical: boolean;
  /** `HitMagic` and `Magical` together, as stock MajorMUD reads them. */
  hitMagic: number;
  limit: number;
  /** `StrReq`. */
  strength: number;
  /** The realm's own `Speed`, which mudtool's `Speed <=` reads. */
  speed: number;
  /** Weapons only: whether it backstabs (`BSAccu` stated). */
  backstabs?: boolean;
  /** Every ability slot, `[ability, value]`, in the realm's order. */
  abilities: Array<[number, number]>;
  /** The spells it negates. */
  negates: number[];
  /** Weapons only: damage a round, for `Dmg >=`. */
  roundTotal?: number;
}

/** One row of a list. */
export interface ExplorerRow {
  /** `Items.Number`. */
  number: number;
  name: string;
  /** `ItemIsUsableByChar` for this character: class, level, standing. */
  usable: boolean;
  /** The realm has it in the game (`In Game`). */
  inGame: boolean;
  /** The character wears it now. */
  worn: boolean;
  /** Each column's value, by its `id`, which it sorts by. */
  cells: Record<string, ExplorerCell>;
  /** What a cell shows, where that is not its value (`AC/DR` `6/0.1`). */
  shown?: Record<string, string>;
  facts: ExplorerFacts;
}

/**
 * A list, or that there is none for this character: a realm mudtool does not
 * compute (GreaterMUD), or one with no database file to read, and why.
 */
export interface ExplorerList {
  supported: boolean;
  columns: ExplorerColumn[];
  rows: ExplorerRow[];
  /** The abilities the filter offers, `[number, name]`, as MME lists them. */
  abilities: Array<[number, string]>;
  reason?: string;
}

/** The attack Calc. Combat works a weapon's columns out for (MME's `cmbWeaponCombos(1)`). */
export type ExplorerAttack = 'normal' | 'surprise' | 'bash' | 'smash';

export const EXPLORER_ATTACKS: readonly ExplorerAttack[] = ['normal', 'surprise', 'bash', 'smash'];

/** The Weapons tab's Calc. Combat, which changes the figures and so is asked of main. */
export interface ExplorerOptions {
  calc: boolean;
  attack: ExplorerAttack;
  /** 85% speed. */
  fast: boolean;
  /** The target's AC, DR and dodge. */
  vsAC: number;
  vsDR: number;
  vsDodge: number;
}

export const DEFAULT_EXPLORER_OPTIONS: ExplorerOptions = {
  calc: false,
  attack: 'normal',
  fast: false,
  vsAC: 0,
  vsDR: 0,
  vsDodge: 0
};

/** Options that crossed the wire, parsed: anything unreadable is the default. */
export function asExplorerOptions(value: unknown): ExplorerOptions {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const n = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(-9999, Math.min(9999, Math.trunc(v)))
      : 0;
  return {
    calc: o['calc'] === true,
    attack: EXPLORER_ATTACKS.includes(o['attack'] as ExplorerAttack)
      ? (o['attack'] as ExplorerAttack)
      : 'normal',
    fast: o['fast'] === true,
    vsAC: n(o['vsAC']),
    vsDR: n(o['vsDR']),
    vsDodge: n(o['vsDodge'])
  };
}

/** A run of detail text: plain, or a reference to something the realm names. */
export type ExplorerSegment = { text: string } | { kind: string; n: number | string; text: string };

/** One item's detail as MME writes it. */
export interface ExplorerDetail {
  number: number;
  name: string;
  text: ExplorerSegment[];
  /** Where it comes from and what it does, a line each; `pct` a drop chance. */
  refs: Array<{ text: ExplorerSegment[]; pct?: number }>;
}

/**
 * What pressing Buy would do for this character now (2026-10-18): the
 * counter it would walk to and what it charges this character, the purse, the
 * vault it would draw the shortfall from first, and why not where it cannot.
 * The same answer the purchase itself acts on (`SessionManager.purchaseFor`),
 * so the pane and the errand agree.
 */
export interface ExplorerBuyPlan {
  item: number;
  name: string;
  /** The counter, the nearest by the way there; absent where none is reachable. */
  shop?: { name: string; roomName: string; map: number; room: number; moves: number };
  /** What it charges this character for one, copper, after charm; null where unstated. */
  price: number | null;
  /** The purse, copper; null where no listing has said. */
  purse: number | null;
  /** The vault the shortfall is drawn from first, and its balance by the record. */
  bank?: { name: string; roomName: string; withdraw: number; balance: number };
  /** Why it cannot be bought now; absent where it can. */
  refusal?: string;
  /** Buy + Wear: whether it is worn at all, and what comes off for it. */
  wear: { wearable: boolean; remove: string[] };
}
