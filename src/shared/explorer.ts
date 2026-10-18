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
export type ExplorerKind = 'weapons' | 'armour' | 'spells' | 'shops';

export const EXPLORER_KINDS: readonly ExplorerKind[] = ['weapons', 'armour', 'spells', 'shops'];

/**
 * The Explorer's tabs: the lists, and the Rooms walker, which is a map and not
 * a list (`ExplorerRoomView`). What a reference opens (`ExplorerSegment.tab`).
 */
export type ExplorerTab = ExplorerKind | 'rooms';

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

/**
 * What the Spells filter bar reads of a spell (`spellPasses`, mudtool's
 * `mmud/details.js`), 2026-10-18: the realm's own numbers, and the two
 * answers that turn on the character, worked out in main where its class is.
 */
export interface ExplorerSpellFacts {
  /** `Magery`, 0 none to 5 Kai, and `MageryLVL`. */
  magery: number;
  mageryLevel: number;
  /** `Targets`, `AttType` and `Learnable`, as the realm numbers them. */
  targets: number;
  attType: number;
  learnable: number;
  /**
   * A learnable spell of no magery this character's class may learn, which
   * any magery's filter keeps (`skipMagery`, NMR 1.7 on).
   */
  anyMagery: boolean;
  /** `spellUsableBy` with *Learnable Only*: by the learning method's classes too. */
  usableLearnable: boolean;
  /** The realm has not switched Kai off (`engine.disableKai`), which *Learnable Only* asks. */
  kaiLearns: boolean;
  /** For the detail's heading: `smit`, `Priest-1`, its level, its mana, `Monster`. */
  short: string;
  mageryName: string;
  level: number;
  mana: number;
  target: string;
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
  /** The character wears it now; for a spell, its spellbook holds it. */
  worn: boolean;
  /** Each column's value, by its `id`, which it sorts by. */
  cells: Record<string, ExplorerCell>;
  /** What a cell shows, where that is not its value (`AC/DR` `6/0.1`). */
  shown?: Record<string, string>;
  facts: ExplorerFacts;
  /** A spell's own facts, on the Spells list. */
  spell?: ExplorerSpellFacts;
  /** A shop's, on the Shops list. */
  shop?: ExplorerShopFacts;
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

/**
 * The Weapons tab's Calc. Combat and the Spells tab's *Calc vs MR*, which
 * change the figures and so are asked of main.
 */
export interface ExplorerOptions {
  calc: boolean;
  attack: ExplorerAttack;
  /** 85% speed. */
  fast: boolean;
  /** The target's AC, DR and dodge. */
  vsAC: number;
  vsDR: number;
  vsDodge: number;
  /** Spells: worked out against a target's magic resistance (`chkSpellOptions(0)`). */
  mrCalc: boolean;
  /** The target's MR (`char.spellVsMR`), MME's 50 to start with. */
  vsMR: number;
  /** The target has anti-magic (`chkSpellOptions(2)`). */
  antiMagic: boolean;
  /** Shops: prices after charm, and the price it pays (`chkShopShowCharm(0)`, `(1)`). */
  shopCharm: boolean;
  shopSell: boolean;
  /** The charm they are worked out for; null for the character's own. */
  charm: number | null;
}

export const DEFAULT_EXPLORER_OPTIONS: ExplorerOptions = {
  calc: false,
  attack: 'normal',
  fast: false,
  vsAC: 0,
  vsDR: 0,
  vsDodge: 0,
  mrCalc: false,
  vsMR: 50,
  antiMagic: false,
  shopCharm: false,
  shopSell: false,
  charm: null
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
    vsDodge: n(o['vsDodge']),
    mrCalc: o['mrCalc'] === true,
    vsMR: o['vsMR'] === undefined ? DEFAULT_EXPLORER_OPTIONS.vsMR : n(o['vsMR']),
    antiMagic: o['antiMagic'] === true,
    shopCharm: o['shopCharm'] === true,
    shopSell: o['shopSell'] === true,
    charm: typeof o['charm'] === 'number' ? Math.max(0, n(o['charm'])) : null
  };
}

/**
 * A run of detail text: plain, or a reference to something the realm names,
 * and the tab that shows it (2026-10-18): an item's list by its type, a
 * spell's, a shop's, a room's (`n` its `map/room`). Null for one no tab here
 * shows yet — a monster, a textblock, a class — which reads as plain text.
 */
export type ExplorerSegment =
  { text: string } | { kind: string; n: number | string; text: string; tab: ExplorerTab | null };

/** Where a reference leads: a tab, and the record on it (`map/room` for a room). */
export interface ExplorerPlace {
  tab: ExplorerTab;
  n: number | string;
}

/** One item's detail as MME writes it. */
export interface ExplorerDetail {
  number: number;
  name: string;
  text: ExplorerSegment[];
  /** Where it comes from and what it does, a line each; `pct` a drop chance. */
  refs: Array<{ text: ExplorerSegment[]; pct?: number }>;
  /** What the references are, where MME heads them otherwise (a shop's `Located in`). */
  refsTitle?: string;
  /** A shop's charm line (`charmModText`). */
  note?: string;
  /** A shop's stock, or a trainer's cost by level (`PullShopDetail`). */
  stock?: ExplorerStock;
}

/** A shop's shelf, or a trainer's table, as `shopDetail` gives it. */
export interface ExplorerStock {
  trainer: boolean;
  rows: Array<{
    /** The item, its name and the tab that shows it; absent on a trainer's row. */
    item?: number;
    name?: string;
    tab?: ExplorerTab | null;
    max?: number;
    regen?: string;
    /** A trainer's level. */
    level?: number;
    /** `35 gold` as MME writes it, and the copper it sorts by. */
    cost: string;
    copper: number;
  }>;
}

/** What the Shops filter reads of a shop (`LoadShops(bTrainersOnly)`). */
export interface ExplorerShopFacts {
  /** `ShopType`, 8 a trainer. */
  type: number;
  /** A trainer that takes this character, by class and level, as MME's global filter asks. */
  trainerFits: boolean;
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
  /** The vault the shortfall is drawn from first, and its balance by the record; null never asked. */
  bank?: { name: string; roomName: string; withdraw: number; balance: number | null };
  /** Why it cannot be bought now; absent where it can. */
  refusal?: string;
  /** Buy + Wear: whether it is worn at all, and what comes off for it. */
  wear: { wearable: boolean; remove: string[] };
}

/**
 * The Gear card's question (2026-10-18): MME's Find Best (`findBest`, its
 * `frmMain.InvenFindBest`) for the character as it is, by one of MME's
 * criteria, each slot's best set against what is worn there.
 */
export interface GearOptions {
  /** Which of `GearBoard.criteria`, by its place in the list. */
  criterion: number;
  /** MME's `No Limiteds`. */
  noLimited: boolean;
  /** Only what some counter in the realm stocks, so Buy can buy it. */
  soldOnly: boolean;
}

export const DEFAULT_GEAR_OPTIONS: GearOptions = { criterion: 0, noLimited: false, soldOnly: true };

/** Options that crossed the wire, parsed: anything unreadable is the default. */
export function asGearOptions(value: unknown): GearOptions {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const criterion = o['criterion'];
  return {
    criterion:
      typeof criterion === 'number' && Number.isInteger(criterion) && criterion >= 0
        ? criterion
        : 0,
    noLimited: o['noLimited'] === true,
    soldOnly: o['soldOnly'] !== false
  };
}

/** One item in a slot, and what the criterion makes of it. */
export interface GearPick {
  number: number;
  name: string;
  value: number;
}

/** One of MME's slots (`EQ_SLOTS`): what is worn, and Find Best's choice. */
export interface GearSlot {
  slot: number;
  label: string;
  worn: GearPick | null;
  /** The same item as `worn` where nothing beats it; null where the slot is best left empty. */
  best: GearPick | null;
}

export interface GearBoard {
  supported: boolean;
  reason?: string;
  /** MME's Find Best menu, `[group, label]`, in its order. */
  criteria: Array<[string, string]>;
  slots: GearSlot[];
}

/**
 * The Rooms tab's map options (`MAP_OPTIONS`, frmMap's `chkMapOptions` and
 * `optAlsoMark`), 2026-10-18. MegaMUD's own rooms (`alsoMark` 3) wait on the
 * pathing pane, which is not here yet.
 */
export interface RoomMapOptions {
  followMap: boolean;
  noHidden: boolean;
  noLairs: boolean;
  noNPC: boolean;
  noCMD: boolean;
  dupes: boolean;
  overwrite: boolean;
  noRestricted: boolean;
  /** 0 nothing more, 1 shops, 2 room spells. */
  alsoMark: number;
}

export const DEFAULT_ROOM_MAP_OPTIONS: RoomMapOptions = {
  followMap: false,
  noHidden: false,
  noLairs: false,
  noNPC: false,
  noCMD: false,
  dupes: false,
  overwrite: false,
  noRestricted: false,
  alsoMark: 0
};

/** MME's map sizes (`MAP_SIZES`), by its id. */
export const ROOM_MAP_SIZES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'main', label: '30×23' },
  { id: '20', label: '20×20' },
  { id: '30', label: '30×30' },
  { id: '50x31', label: '50×31' },
  { id: '50', label: '50×50' },
  { id: 'z21', label: '21×21 zoom' },
  { id: 'z28', label: '28×28 zoom' }
];

/** A room map asked for: the room, the size, the options, and a re-centred cell. */
export interface RoomViewRequest {
  map: number;
  room: number;
  size: string;
  options: RoomMapOptions;
  /** Shift-click's re-centring; null for the size's own centre. */
  center: number | null;
}

/** Requests that crossed the wire, parsed: anything unreadable is the default. */
export function asRoomViewRequest(value: unknown): RoomViewRequest | null {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const int = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 32767 ? v : null;
  const map = int(o['map']);
  const room = int(o['room']);
  if (map === null || room === null) return null;
  const given = (
    typeof o['options'] === 'object' && o['options'] !== null ? o['options'] : {}
  ) as Record<string, unknown>;
  const options = { ...DEFAULT_ROOM_MAP_OPTIONS };
  for (const key of Object.keys(options) as Array<keyof RoomMapOptions>) {
    if (key === 'alsoMark') {
      const mark = given['alsoMark'];
      options.alsoMark = mark === 1 || mark === 2 ? mark : 0;
    } else options[key] = given[key] === true;
  }
  const size = ROOM_MAP_SIZES.some((s) => s.id === o['size']) ? String(o['size']) : 'main';
  return { map, room, size, options, center: int(o['center']) };
}

/**
 * One charted cell, as the client's maps draw a room (2026-10-18): MME lays
 * the map out (`buildMap`) and the drawing is the Map card's, mudmaps' style
 * (`MapGlyphs`). Its kind and letter, its corridors to the cells beside it
 * that hold the rooms they reach, and the ways a line cannot draw — up and
 * down, a room command that moves you, an exit to a room elsewhere.
 */
export interface RoomCell {
  map: number;
  room: number;
  kind: 'room' | 'stairs' | 'shop' | 'bank' | 'lair' | 'npc' | 'cmd';
  /** A temple's, tavern's, inn's or trainer's letter. */
  letter?: string;
  /** Somebody living in a lair, or a lettered lair: the diamond on its corner. */
  lairBadge?: boolean;
  /**
   * Corridors to the cells beside it, from this end only (east, south and the
   * two southern diagonals, or the way back where only that way is an exit):
   * `tone` what stands in it, `title` what the realm says it is.
   */
  links: Array<{ dir: string; tone?: string; title?: string }>;
  /** A way out to a room not in the cell it points at: `local` where that room is on the map. */
  arrows: Array<{ dir: string; to: string; local: boolean; title: string; gated: boolean }>;
  /** Up, down and the room's own commands that move you, each with where it leads. */
  away: Array<{ kind: 'up' | 'down' | 'teleport'; to: string; title: string; gated: boolean }>;
  /** The room a click walks the map to (`map/room`): an up- or down-only cell follows it. */
  target: string | null;
  /** Both up and down: MME asks which. */
  upDown?: { up: string | null; down: string | null };
}

/** One of the compass's ways out of the room the map is drawn from. */
export interface RoomExit {
  dir: string;
  /** Where it leads, `map/room`; null for none or an action. */
  target: string | null;
  title: string;
  mapChange: boolean;
}

/** A line of a room's references or a finder's results, and where it leads. */
export interface RoomLine {
  text: ExplorerSegment[];
  place: ExplorerPlace | null;
}

/**
 * The Rooms tab for one room: MME's map drawn from it, the compass, its
 * references and its full text (`MapGetRoomLoc`), and where the character
 * stands, which the map marks.
 */
export interface ExplorerRoomView {
  supported: boolean;
  reason?: string;
  found: boolean;
  map: number;
  room: number;
  name: string;
  grid: {
    cols: number;
    rows: number;
    zoom: boolean;
    center: number;
    cells: Array<RoomCell | null>;
  } | null;
  compass: RoomExit[];
  refs: RoomLine[];
  info: string;
  /** The character's room, `map/room`; null where it is not placed. */
  here: string | null;
}

/** The Rooms tab's finders: the next room by name, every room by name, what leads here. */
export type RoomSearch =
  { find: string; after: string | null } | { list: string } | { leads: string };

export interface RoomSearchResult {
  /** `find`'s room, `map/room`; null where none. */
  room?: string | null;
  lines?: RoomLine[];
  /** `list` stopped at MME's 500. */
  capped?: boolean;
}
