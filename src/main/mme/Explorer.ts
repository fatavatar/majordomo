/**
 * MMUD Explorer's lists and details for the character being played
 * (2026-10-18): MME's own logic, as mudtool ports it (`vendor/`, copied by
 * `npm run sync:mme`), run on the realm's own database and on the live
 * character in place of MME's hand-built one.
 *
 * mudtool keeps the realm and the character in module singletons — `db`,
 * `engine`, `char`, `settings` — and computes from them synchronously. So
 * this loads the character's realm and the character into them before each
 * answer, and only that: one realm stays loaded until another is asked for.
 * This file is the one reader of `vendor/`.
 *
 * Stock MajorMUD only, as mudtool is (`engine.greater`, from `Info.Legit`):
 * a GreaterMUD realm is answered unsupported rather than computed wrong.
 */
import fs from 'node:fs';

import { by, db, loadDB, roomKey } from './vendor/js/db.js';
import { detectEngine, engine } from './vendor/js/mmud/engine.js';
import { blankChar, char, EQ_SLOTS, roster, switchChar } from './vendor/js/char.js';
import { setSetting, setView, settings } from './vendor/js/state.js';
import { isInGame, itemUsableBy, spellUsableBy } from './vendor/js/mmud/usable.js';
import {
  abilityList,
  armourCols,
  bestShopPrice,
  truncate,
  hasAbil,
  hooks,
  itemDetail,
  itemValue,
  plain,
  segments,
  shopDetail,
  lairInfoFor,
  classAbilities,
  classCols,
  raceAbilities,
  raceColours,
  raceStat,
  lairAverages,
  monsterAttackSummary,
  monsterDetail,
  monsterExp,
  monsterPossy,
  monsterSpellAttackCol,
  expPerDmgHP,
  fmtComma,
  spellCols,
  spellDetail,
  spellListed,
  weaponCols,
  type HookColumn
} from './vendor/js/mmud/details.js';
import {
  eqSlotLists,
  equipItem,
  equipSlotFor,
  calcCharStats,
  calcCharSummary,
  encumLevel,
  encumThresholds,
  equipCommands,
  findBest,
  STAT_LABELS,
  statDisplay,
  type CharStatsPanel,
  findBestValue,
  FIND_BEST,
  type FindBestRule
} from './vendor/js/mmud/charstats.js';
import {
  attkStat,
  charIllumination,
  currentAttackName,
  lairDamageLine,
  monsterDamageIn,
  spellColumns as spellFigures,
  weaponAttack,
  setSpellOpts,
  setWeaponOpts,
  weaponMax,
  weaponMin,
  weaponSpeed
} from './vendor/js/hooks/combat.js';
import { ATTACK, MUD } from './vendor/js/mmud/combat.js';
import {
  armourType,
  itemType,
  magery,
  shopType,
  spellTargets,
  weaponType,
  wornType
} from './vendor/js/mmud/enums.js';
import {
  buildMap,
  CELL,
  DIR_NAMES,
  DIRS,
  EXIT,
  findRoomByName,
  getRoom,
  leadsHere,
  MAP_SIZES,
  roomExits,
  roomRefs,
  roomTooltip,
  searchRooms,
  type MapCell
} from './vendor/js/mmud/roommap.js';
import { roomTeleports } from './vendor/js/mmud/textblocks.js';
import { chestContents } from './vendor/js/mmud/chest.js';
import {
  attackConfig,
  expHrCharacter,
  expHrProfile,
  expPerHourCell,
  EXPHR_DEFAULTS,
  monsterExpPerHour,
  normaliseExpHrConfig,
  scriptingRows,
  type ExpHrResult
} from './vendor/js/mmud/exphr.js';
import { profileFromChar } from './vendor/js/mmud/profile.js';
import { buildClassRace } from './vendor/js/mmud/builder.js';
import type { Row } from './vendor/js/db.js';
import { t } from '../app/i18n';
import { openRealm } from '../world/RealmSource';
import { ownAlignment, type CharacterState } from '../../shared/character';
import type { Alignment } from '../../shared/alignment';
import type {
  ExplorerBuyPlan,
  ExplorerCell,
  ExplorerColumn,
  ExplorerDetail,
  ExplorerFacts,
  ExplorerKind,
  ExplorerList,
  ExplorerMonsterFacts,
  ExplorerOptions,
  ExplorerRow,
  ExplorerPlace,
  ExplorerRoomView,
  ExplorerSegment,
  ExplorerShopFacts,
  ExplorerSpellFacts,
  ExplorerTab,
  RoomCell,
  RoomLine,
  RoomSearch,
  RoomSearchResult,
  RoomViewRequest,
  GearBoard,
  GearOptions,
  GearPick,
  EqAttack,
  EqFind,
  EqFound,
  EqPlan,
  EqStat,
  EqView,
  CompareKind,
  CompareList,
  CompareRow,
  ItemFacts
} from '../../shared/explorer';
import { DEFAULT_EQ_PLAN, EQ_SLOT_COUNT, NO_EQ_VIEW } from '../../shared/explorer';

/** The tables mudtool reads, as the realm database names them. */
const TABLES = [
  'Classes',
  'Info',
  'Items',
  'Lairs',
  'Monsters',
  'Races',
  'Rooms',
  'Shops',
  'Spells',
  'TBInfo'
] as const;

/** `Items.ItemType`: what the Armour and Weapons lists hold. */
const ITEM_TYPE = { armour: 0, weapon: 1 } as const;

/**
 * MME's alignment filter (`cmbGlobalAlignment`: 0 any, 1 good, 2 neutral,
 * 3 evil) for the realm's word for this character's standing. Seedy is
 * PROBABLY neutral for an item's `GoodOnly` / `EvilOnly` (MajorMUD's evil
 * starts at Outlaw); a character nobody has seen on `who` is any.
 */
const ALIGNMENT_INDEX: Record<Alignment, number> = {
  Saint: 1,
  Good: 1,
  Lawful: 2,
  Neutral: 2,
  Seedy: 2,
  Outlaw: 3,
  Criminal: 3,
  Villain: 3,
  FIEND: 3
};

/**
 * Where a realm's tables come from: `key` says which realm and which version
 * of it, so a realm already loaded is not read again; `read` hands over each
 * table as mudtool's export has it (`{ cols, rows }`), or null for one the
 * realm lacks.
 */
export interface MmeRealm {
  key: string;
  read(name: string): Promise<{ cols: string[]; rows: unknown[][] } | null>;
  /** Done reading: whatever `read` opened is let go. */
  close?(): void;
}

/** The realm database a character plays on, read with the realm layer's own reader. */
export function realmFile(file: string): MmeRealm {
  const key = `${file}@${fs.statSync(file).mtimeMs}`;
  let source: ReturnType<typeof openRealm> | null = null;
  return {
    key,
    async read(name) {
      source ??= openRealm(file);
      const table = source.table(name);
      if (table === null) return null;
      const cols = table.columns;
      return { cols, rows: table.rows.map((row) => cols.map((col) => row[col] ?? null)) };
    },
    close() {
      source?.close();
      source = null;
    }
  };
}

/** The realm loaded into mudtool's `db`. */
let loaded: string | null = null;

/** The realm loaded into mudtool, unless it already is. Throws when it cannot be read. */
export async function useRealm(realm: MmeRealm): Promise<void> {
  if (loaded === realm.key) return;
  // `loadDB`'s own reading, from here: a manifest naming each table.
  const manifest = { tables: Object.fromEntries(TABLES.map((name) => [name, { file: name }])) };
  try {
    await loadDB('', async (name: string) =>
      name === 'manifest.json' ? manifest : ((await realm.read(name)) ?? { cols: [], rows: [] })
    );
  } finally {
    realm.close?.();
  }
  detectEngine(db.info);
  loaded = realm.key;
  // Every cache mudtool keeps was the last realm's.
  setSetting('globalFilter', true);
}

/** Whether mudtool computes this realm: stock MajorMUD, not GreaterMUD. */
export function supported(): boolean {
  return engine.greater !== true;
}

/** A class or race row's number by its name, as the realm spells it; 0 for none. */
function numberNamed(rows: Array<Record<string, unknown>>, name: string | null): number {
  if (name === null) return 0;
  const key = name.trim().toLowerCase();
  const row = rows.find((entry) => String(entry['Name'] ?? '').toLowerCase() === key);
  return typeof row?.['Number'] === 'number' ? row['Number'] : 0;
}

/**
 * The character being played, as MME's character (`char.js`): its class,
 * race, level, standing and stats off the tracker, and what it wears placed
 * in MME's slots by MME's own rule (`equipItem`). Made the active one.
 */
function useCharacter(state: CharacterState, options?: ExplorerOptions): void {
  const c = blankChar();
  c.name = state.name ?? '';
  c.cls = numberNamed(db.Classes, state.className);
  c.race = numberNamed(db.Races, state.race);
  c.level = state.progress.level ?? 1;
  const standing = ownAlignment(state);
  c.alignment = standing === null ? 0 : ALIGNMENT_INDEX[standing];
  const p = state.progress;
  c.stats = {
    str: p.strength ?? 0,
    int: p.intellect ?? 0,
    wis: p.willpower ?? 0,
    agi: p.agility ?? 0,
    hea: p.health ?? 0,
    cha: p.charm ?? 0
  };
  for (const held of state.inventory.items) {
    if (!held.equipped) continue;
    const id = held.row?.id ?? held.id;
    if (id !== undefined && by.item.has(id)) equipItem(c, id, { toggle: false });
  }
  // The book names its spells; MME numbers them.
  c.learnedSpells = (state.spellbook ?? []).flatMap((spell) => {
    const n = numberNamed(db.Spells, spell.name);
    return n > 0 ? [n] : [];
  });
  // Calc. Combat's target (`txtWeaponExtras(2..4)`), which MME keeps on the character.
  if (options !== undefined) {
    c.weaponVsChar = { ac: options.vsAC, dr: options.vsDR, dodge: options.vsDodge };
    c.spellVsMR = options.vsMR;
  }
  roster.chars = [{ id: 'live', char: c }];
  switchChar('live');
}

/**
 * One of a list's columns as mudtool defines it: what it reads off an item,
 * and what it shows where that is not the value (its `fmt`).
 */
interface Column extends ExplorerColumn {
  get(item: Row): ExplorerCell;
  show?(value: ExplorerCell, item: Row): string;
}

/**
 * MME's tag for an `AC/DR` cell, which its list sorts by: AC, then DR
 * (`AC * 100000 + DR`, mudtool's `tabs/armour.js`). The text `6/0.1` sorted
 * as text put `18/3` before `6/0.1` (2026-10-18).
 */
const acThenDr = (item: Row): number =>
  (item['ArmourClass'] as number) * 100000 + (item['DamageResist'] as number);

/** The realm's number and the item's name, which every item list opens with. */
function leading(): Column[] {
  return [
    { id: 'Number', label: '#', numeric: true, width: '3.5em', get: (i) => i['Number'] as number },
    {
      id: 'Name',
      label: t('explorer.columns.name'),
      width: 'minmax(9em, 2fr)',
      get: (i) => String(i['Name'])
    }
  ];
}

/**
 * The Weapons list's columns, mudtool's `tabs/weapons.js` `BASE_COLS` in its
 * order, and after them the combat columns `hooks/combat.js` adds (Dmg/Spd,
 * #Swings, xSwings, Extra, Dmg/Rnd, Dmg/1st), the character's own.
 */
function weaponColumns(): Column[] {
  const num = (
    id: string,
    label: string,
    width: string,
    get: (i: Row) => ExplorerCell
  ): Column => ({
    id,
    label,
    width,
    numeric: true,
    get
  });
  return [
    ...leading(),
    {
      id: 'WeaponType',
      label: t('explorer.columns.weaponType'),
      width: '5.5em',
      get: (i) => weaponType(i['WeaponType'])
    },
    num('Min', t('explorer.columns.min'), '2.5em', weaponMin),
    num('Max', t('explorer.columns.max'), '2.5em', weaponMax),
    num('Speed', t('explorer.columns.speed'), '3.5em', weaponSpeed),
    num('level', t('explorer.columns.level'), '3.5em', (i) => weaponCols(i).level),
    num('StrReq', t('explorer.columns.strength'), '2.5em', (i) => i['StrReq'] as number),
    num('Encum', t('explorer.columns.encumbrance'), '3em', (i) => i['Encum'] as number),
    {
      ...num('ac', t('explorer.columns.ac'), '3.5em', acThenDr),
      show: (_v, i) => weaponCols(i).ac
    },
    num('acc', t('explorer.columns.accuracy'), '2.5em', (i) => weaponCols(i).acc),
    num('bs', t('explorer.columns.backstab'), '3.5em', (i) => weaponCols(i).bs),
    num('crits', t('explorer.columns.crits'), '3.5em', (i) => weaponCols(i).crits),
    num('Limit', t('explorer.columns.limit'), '3.5em', (i) => i['Limit'] as number),
    ...hooked(hooks.columns.weapons)
  ];
}

/** The Armour list's columns, mudtool's `tabs/armour.js` `BASE_COLS` in its order. */
function armourColumns(): Column[] {
  const num = (
    id: string,
    label: string,
    width: string,
    get: (i: Row) => ExplorerCell
  ): Column => ({
    id,
    label,
    width,
    numeric: true,
    get
  });
  return [
    ...leading(),
    {
      id: 'Worn',
      label: t('explorer.columns.slot'),
      width: '5.5em',
      get: (i) => wornType(i['Worn'])
    },
    {
      id: 'ArmourType',
      label: t('explorer.columns.armourType'),
      width: '6.5em',
      get: (i) => armourType(i['ArmourType'])
    },
    num('level', t('explorer.columns.level'), '3.5em', (i) => armourCols(i).level),
    num('Encum', t('explorer.columns.encumbrance'), '3em', (i) => i['Encum'] as number),
    {
      ...num('acdr', t('explorer.columns.ac'), '5em', acThenDr),
      show: (_v, i) => armourCols(i).ac
    },
    num('acc', t('explorer.columns.accuracy'), '3.5em', (i) => armourCols(i).acc),
    num('crits', t('explorer.columns.crits'), '4em', (i) => armourCols(i).crits),
    num('Limit', t('explorer.columns.limit'), '3.5em', (i) => i['Limit'] as number),
    num('acenc', t('explorer.columns.acPerEncumbrance'), '5em', (i) => armourCols(i).acEnc),
    ...hooked(hooks.columns.armour)
  ];
}

/** The columns mudtool's hooks add to a list, as they define themselves. */
function hooked(columns: readonly HookColumn[]): Column[] {
  return columns.map((column) => ({
    id: column.key,
    label: column.label,
    width: column.width ?? '4em',
    ...(column.num === true ? { numeric: true } : {}),
    get: (item) => column.get(item),
    ...(column.fmt === undefined
      ? {}
      : { show: (value: ExplorerCell, item: Row) => String(column.fmt!(value, item)) })
  }));
}

/** Every `[ability, value]` slot an item states, in the realm's order. */
function abilitySlots(item: Row): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; `Abil-${i}` in item; i += 1) {
    const abil = item[`Abil-${i}`] as number;
    if (abil) out.push([abil, (item[`AbilVal-${i}`] as number) || 0]);
  }
  return out;
}

/** What mudtool's filter bars read of an item (`passes` in `tabs/weapons.js`, `tabs/armour.js`). */
function factsOf(
  item: Row,
  kind: ExplorerKind,
  cells: Record<string, ExplorerCell>
): ExplorerFacts {
  const magical = hasAbil(item, 28, 0);
  const negates: number[] = [];
  for (let x = 0; x < 10; x += 1) {
    const spell = item[`NegateSpell-${x}`];
    if (typeof spell === 'number' && spell > 0) negates.push(spell);
  }
  return {
    type: kind === 'weapons' ? weaponType(item['WeaponType']) : armourType(item['ArmourType']),
    ...(kind === 'armour' ? { slot: wornType(item['Worn']) } : {}),
    magical,
    hasMagical: hasAbil(item, 28) !== -32768,
    // Stock MajorMUD: hit-magic and magic stack (GreaterMUD's is not ported).
    hitMagic: hasAbil(item, 142, 0) + magical,
    limit: item['Limit'] as number,
    strength: item['StrReq'] as number,
    speed: item['Speed'] as number,
    ...(kind === 'weapons'
      ? {
          backstabs: hasAbil(item, 116) !== -32768,
          roundTotal: typeof cells['dmgrnd'] === 'number' ? cells['dmgrnd'] : 0
        }
      : {}),
    abilities: abilitySlots(item),
    negates
  };
}

/**
 * MME's context for a detail or a row (mudtool's `tabs/exhelp.js` `ctx`): the
 * character's, with the global filter on, which is what this client always
 * answers for.
 */
function mmeContext(): Record<string, unknown> {
  return {
    useChar: true,
    level: char.level,
    cls: char.cls,
    race: char.race,
    alignment: char.alignment,
    charm: char.stats.cha,
    shopsFirst: false,
    equipped: char.equipped
  };
}

/**
 * The Spells list's columns, mudtool's `tabs/spells.js` in its order: its own
 * (`spellCols`, at the character's level), the combat hook's Dmg, Dmg/M, Heal
 * and Heal/M, and the quick detail last. `Cast` and not `Diff`: the chance is
 * the character's own, as MME's is with the global filter on.
 */
function spellColumns(): Column[] {
  const context = mmeContext();
  const cols = new Map<number, ReturnType<typeof spellCols>>();
  const of = (spell: Row): ReturnType<typeof spellCols> => {
    const n = spell['Number'] as number;
    let found = cols.get(n);
    if (found === undefined) {
      found = spellCols(spell, context);
      cols.set(n, found);
    }
    return found;
  };
  return [
    ...leading(),
    {
      id: 'Short',
      label: t('explorer.columns.short'),
      width: '4.5em',
      get: (s) => String(s['Short'] ?? '')
    },
    {
      id: 'Magery',
      label: t('explorer.columns.magery'),
      width: '6.5em',
      get: (s) => magery(s['Magery'], s['MageryLVL'])
    },
    {
      id: 'ReqLevel',
      label: t('explorer.columns.level'),
      numeric: true,
      width: '4em',
      get: (s) => s['ReqLevel'] as number
    },
    {
      id: 'mana',
      label: t('explorer.columns.mana'),
      numeric: true,
      width: '4em',
      get: (s) => of(s).mana
    },
    {
      id: 'diff',
      label: t('explorer.columns.cast'),
      numeric: true,
      width: '4em',
      // `47%` as MME shows it, sorted as the figure.
      get: (s) => Number.parseInt(String(of(s).diff), 10) || 0,
      show: (_value, s) => String(of(s).diff)
    },
    ...hooked(hooks.columns.spells),
    {
      id: 'detail',
      label: t('explorer.columns.detail'),
      width: 'minmax(14em, 3fr)',
      get: (s) => plain(of(s).detail)
    }
  ];
}

/** What the Spells filter bar and the detail's heading read of a spell. */
function spellFactsOf(spell: Row): ExplorerSpellFacts {
  const classes = String(spell['Classes'] ?? '');
  const learnable = (spell['Learnable'] as number) || 0;
  const mageryNumber = (spell['Magery'] as number) || 0;
  return {
    magery: mageryNumber,
    mageryLevel: (spell['MageryLVL'] as number) || 0,
    targets: (spell['Targets'] as number) || 0,
    attType: (spell['AttType'] as number) || 0,
    learnable,
    // `spellPasses`' own test, the character's class read here.
    anyMagery:
      learnable > 0 &&
      mageryNumber === 0 &&
      engine.nmrVersion >= 1.7 &&
      (!char.cls || classes === '(*)' || classes.includes(`(${char.cls})`)),
    usableLearnable: spellUsableBy(
      spell,
      char.cls || 0,
      char.level || 0,
      char.alignment || 0,
      true
    ),
    kaiLearns: !engine.disableKai,
    short: String(spell['Short'] ?? ''),
    mageryName: magery(spell['Magery'], spell['MageryLVL']),
    level: (spell['ReqLevel'] as number) || 0,
    mana: (spell['ManaCost'] as number) || 0,
    target: spellTargets(spell['Targets'])
  };
}

/** One Spells row: as an item's, with the spell's own facts, and in the book where the character knows it. */
function spellRowOf(spell: Row, columns: readonly Column[]): ExplorerRow {
  const n = spell['Number'] as number;
  const cells: Record<string, ExplorerCell> = {};
  const shown: Record<string, string> = {};
  for (const column of columns) {
    const value = column.get(spell);
    cells[column.id] = value;
    if (column.show !== undefined) shown[column.id] = column.show(value, spell);
  }
  return {
    number: n,
    name: String(spell['Name']),
    usable: spellUsableBy(spell, char.cls || 0, char.level || 0, char.alignment || 0),
    inGame: isInGame(spell),
    worn: char.learnedSpells.includes(n),
    cells,
    ...(Object.keys(shown).length > 0 ? { shown } : {}),
    // The item bar's facts, neutral: only *Has ability* reads them here.
    facts: {
      type: '',
      magical: 0,
      hasMagical: false,
      hitMagic: 0,
      limit: 0,
      strength: 0,
      speed: 0,
      abilities: abilitySlots(spell),
      negates: []
    },
    spell: spellFactsOf(spell)
  };
}

/** Sundry's rows (`lvOtherItems`): armour worn nowhere, and every item type past a weapon. */
const sundryListed = (item: Row): boolean =>
  (item['ItemType'] === ITEM_TYPE.armour && !item['Worn']) || (item['ItemType'] as number) > 1;

/** The Sundry list's columns, mudtool's `tabs/sundry.js`: number, name, type, encumbrance, limit. */
function sundryColumns(): Column[] {
  return [
    ...leading(),
    {
      id: 'ItemType',
      label: t('explorer.columns.itemType'),
      width: '7em',
      get: (i) => itemType(i['ItemType'])
    },
    {
      id: 'Encum',
      label: t('explorer.columns.encumbrance'),
      numeric: true,
      width: '4em',
      get: (i) => (i['Encum'] as number) || 0
    },
    {
      id: 'Limit',
      label: t('explorer.columns.limit'),
      numeric: true,
      width: '4em',
      get: (i) => (i['Limit'] as number) || 0
    }
  ];
}

/** The shops `AddShop2LV` lists: named, and not the realm's `sdf` or `Leave this blank` rows. */
const shopListed = (shop: Row): boolean => {
  const name = String(shop['Name'] ?? '');
  return name !== '' && name.slice(0, 3).toLowerCase() !== 'sdf' && name !== 'Leave this blank';
};

/** The Shops list's columns, mudtool's `tabs/shops.js`: number, name, type. */
function shopColumns(): Column[] {
  return [
    ...leading(),
    {
      id: 'ShopType',
      label: t('explorer.columns.shopType'),
      width: '8em',
      get: (s) => shopType(s['ShopType'])
    }
  ];
}

/** `LoadShops(bTrainersOnly)`'s test of a trainer against the character: its class and level. */
function shopFactsOf(shop: Row): ExplorerShopFacts {
  const type = (shop['ShopType'] as number) || 0;
  const classRest = (shop['ClassRest'] as number) || 0;
  const level = char.level;
  const fits =
    !(char.cls && classRest !== 0 && classRest !== char.cls) &&
    !(
      level > 0 &&
      (((shop['MinLVL'] as number) || 0) > level + 1 || ((shop['MaxLVL'] as number) || 0) <= level)
    );
  return { type, trainerFits: type === 8 && fits };
}

function shopRowOf(shop: Row, columns: readonly Column[]): ExplorerRow {
  const cells: Record<string, ExplorerCell> = {};
  for (const column of columns) cells[column.id] = column.get(shop);
  return {
    number: shop['Number'] as number,
    name: String(shop['Name']),
    usable: true,
    inGame: isInGame(shop),
    worn: false,
    cells,
    facts: {
      type: '',
      magical: 0,
      hasMagical: false,
      hitMagic: 0,
      limit: 0,
      strength: 0,
      speed: 0,
      abilities: [],
      negates: []
    },
    shop: shopFactsOf(shop)
  };
}

/**
 * `PullShopDetail`: its line, its stock at the character's charm (or the
 * charm asked) bought or sold, a trainer's cost by level, and the rooms it
 * is in, each a link.
 */
function shopDetailOf(number: number, options?: ExplorerOptions): ExplorerDetail | null {
  const shop = by.shop.get(number);
  if (shop === undefined) return null;
  const charm = options?.charm ?? char.stats.cha;
  const priced = options?.shopCharm === true || options?.shopSell === true;
  const detail = shopDetail(shop, priced ? charm : 0, options?.shopSell === true);
  return {
    number,
    name: String(shop['Name']),
    text: runs(detail.text),
    refs: detail.refs.map((ref) => ({
      text: runs(ref.text),
      ...(typeof ref.pct === 'number' ? { pct: ref.pct } : {})
    })),
    refsTitle: t('explorer.shops.locatedIn'),
    ...(detail.charmMod ? { note: detail.charmMod } : {}),
    stock: {
      trainer: detail.trainer,
      rows: detail.rows.map((row) =>
        row.item === undefined ? row : { ...row, tab: tabOf('item', row.item) }
      )
    }
  };
}

/** One list row: every column's cell, what it shows where that differs, and the filters' facts. */
function rowOf(item: Row, kind: ExplorerKind, columns: readonly Column[]): ExplorerRow {
  const n = item['Number'] as number;
  const cells: Record<string, ExplorerCell> = {};
  const shown: Record<string, string> = {};
  for (const column of columns) {
    const value = column.get(item);
    cells[column.id] = value;
    if (column.show !== undefined) shown[column.id] = column.show(value, item);
  }
  return {
    number: n,
    name: String(item['Name']),
    usable: itemUsableBy(item, char),
    inGame: isInGame(item),
    worn: char.equipped.includes(n),
    cells,
    ...(Object.keys(shown).length > 0 ? { shown } : {}),
    facts: factsOf(item, kind, cells)
  };
}

/** Calc. Combat's attack, as MME's attack numbers (`MUD`). */
const ATTACK_TYPE = {
  normal: MUD.normal,
  surprise: MUD.surprise,
  bash: MUD.bash,
  smash: MUD.smash
};

/**
 * The Weapons or Armour list for this character on this realm: every item of
 * the kind, with MME's columns, whether the character can use it and whether
 * the realm has it in the game, which the window filters on.
 */
export async function explorerList(
  realm: MmeRealm,
  state: CharacterState,
  kind: ExplorerKind,
  options?: ExplorerOptions
): Promise<ExplorerList> {
  await useRealm(realm);
  if (!supported()) return { supported: false, columns: [], rows: [], abilities: [] };
  useCharacter(state, options);
  // The Weapons tab's Calc. Combat, set after the character so its figures are the character's.
  setWeaponOpts({
    calc: options?.calc === true,
    attack: ATTACK_TYPE[options?.attack ?? 'normal'],
    fast: options?.fast === true,
    minDmg: 0
  });
  // The Spells tab's vs MR, after the character for the same reason.
  setSpellOpts({ calc: options?.mrCalc === true, antiMagic: options?.antiMagic === true });
  let columns: Column[];
  let rows: ExplorerRow[];
  if (kind === 'spells') {
    columns = spellColumns();
    rows = db.Spells.filter(spellListed).map((spell) => spellRowOf(spell, columns));
  } else if (kind === 'sundry') {
    columns = sundryColumns();
    rows = db.Items.filter(sundryListed).map((item) => ({
      ...rowOf(item, kind, columns),
      // MME does not apply the global filter to Sundry (`FilterSundry`).
      usable: true
    }));
  } else if (kind === 'monsters') {
    const byLair = options?.byLair === true && engine.nmrVersion >= LAIR_NMR;
    setView('monstersByLair', byLair);
    columns = monsterColumns(byLair);
    rows = db.Monsters.filter((m) => monsterListed(m, byLair)).map((m) =>
      monsterRowOf(m, columns, byLair)
    );
  } else if (kind === 'classes' || kind === 'races') {
    const table = kind === 'classes' ? db.Classes : db.Races;
    columns = kind === 'classes' ? classColumns() : raceColumns();
    const tones = kind === 'races' ? raceColours(db.Races.filter((r) => r['Name'])) : null;
    rows = table
      .filter((r) => r['Name'])
      .map((r) => classRaceRowOf(r, columns, tones?.get(r['Number'] as number)));
  } else if (kind === 'shops') {
    columns = shopColumns();
    rows = db.Shops.filter(shopListed).map((shop) => shopRowOf(shop, columns));
  } else {
    const type = kind === 'weapons' ? ITEM_TYPE.weapon : ITEM_TYPE.armour;
    columns = kind === 'weapons' ? weaponColumns() : armourColumns();
    rows = db.Items.filter((item) => item['ItemType'] === type).map((item) =>
      rowOf(item, kind, columns)
    );
  }
  return {
    supported: true,
    columns: columns.map(({ id, label, width, numeric }) => ({
      id,
      label,
      width,
      ...(numeric === true ? { numeric: true } : {})
    })),
    rows,
    abilities: abilityList(),
    ...(kind === 'monsters' ? { lairs: engine.nmrVersion >= LAIR_NMR } : {})
  };
}

/**
 * The tab a reference opens (mudtool's `ui/nav.js` `KIND`), or null for one
 * no tab here shows yet.
 */
function tabOf(kind: string, n: number | string): ExplorerTab | null {
  switch (kind) {
    case 'item': {
      // mudtool's `itemTab`: a weapon, a worn armour row, and everything else on Sundry.
      const item = by.item.get(Number(n));
      if (item === undefined) return null;
      if (item['ItemType'] === ITEM_TYPE.weapon) return 'weapons';
      if (item['ItemType'] === ITEM_TYPE.armour && item['Worn']) return 'armour';
      return 'sundry';
    }
    case 'spell':
      return 'spells';
    case 'monster':
      return 'monsters';
    case 'class':
      return 'classes';
    case 'race':
      return 'races';
    case 'shop':
      return 'shops';
    case 'room':
      return 'rooms';
    default:
      return null;
  }
}

/** Where a whole line of references leads, or null where no tab shows it. */
function placeOf(ref: { kind: string; n: number | string } | null): ExplorerPlace | null {
  if (ref === null) return null;
  const tab = tabOf(ref.kind, ref.n);
  return tab === null ? null : { tab, n: ref.n };
}

/** mudtool's marked-up text as runs, its references kept (`segments`) with the tab each opens. */
function runs(text: string): ExplorerSegment[] {
  return segments(text).map((run) =>
    'kind' in run ? { ...run, tab: tabOf(run.kind, run.n) } : run
  );
}

/** One item's detail as MME writes it, compared against what is worn in its slot. */
export async function explorerDetail(
  realm: MmeRealm,
  state: CharacterState,
  kind: ExplorerKind,
  number: number,
  options?: ExplorerOptions
): Promise<ExplorerDetail | null> {
  await useRealm(realm);
  if (!supported()) return null;
  useCharacter(state, options);
  setSpellOpts({ calc: options?.mrCalc === true, antiMagic: options?.antiMagic === true });
  if (kind === 'shops') return shopDetailOf(number, options);
  if (kind === 'monsters') return monsterDetailOf(number, options);
  if (kind === 'classes') return classDetailOf(number, options);
  if (kind === 'races') return raceDetailOf(number);
  const item = kind === 'spells' ? by.spell.get(number) : by.item.get(number);
  if (item === undefined) return null;
  const detail =
    kind === 'spells'
      ? spellDetail(item, mmeContext())
      : kind === 'sundry'
        ? itemDetail(item, { ...mmeContext(), onSundry: true })
        : itemDetail(item, { equipped: char.equipped });
  const chest = kind === 'sundry' ? chestContents(item) : null;
  return {
    number,
    name: String(item['Name']),
    text: runs(detail.text),
    refs: detail.refs.map((ref: { text: string; pct?: number | string }) => ({
      text: runs(ref.text),
      ...(typeof ref.pct === 'number' ? { pct: ref.pct } : {})
    })),
    ...(kind === 'sundry'
      ? { sub: `#${number} · ${itemType(item['ItemType'])} · ${itemValue(item).sFriendlyBuy}` }
      : {}),
    ...(chest === null || chest.length === 0
      ? {}
      : {
          chest: chest.map((entry) => ({
            item: entry.item,
            name: String(by.item.get(entry.item)?.['Name'] ?? `item ${entry.item}`),
            pct: entry.pct,
            tab: tabOf('item', entry.item)
          }))
        })
  };
}

/** `char.EQ_SLOTS`: the weapon and the off hand, which a two-handed weapon holds both of. */
const WEAPON_SLOT = 16;
const OFFHAND_SLOT = 15;

/** Two-handed (`WeaponType` 1 and 3, 2H blunt and sharp), as MME's optimiser reads it. */
const twoHanded = (item: Row | undefined): boolean =>
  item !== undefined &&
  item['ItemType'] === ITEM_TYPE.weapon &&
  (item['WeaponType'] === 1 || item['WeaponType'] === 3);

/**
 * Buy + Wear's other half (2026-10-18): whether the item is worn at all, and
 * what the character takes off first to put it on. The slot is MME's own
 * choice (`equipSlotFor`, its `InvenEquipItem`): whatever it holds comes
 * off, and a two-handed weapon and an off-hand item do not stay together
 * (MME's optimiser), so the one gives way to the other. By the realm's names,
 * which the game takes.
 */
export async function explorerWear(
  realm: MmeRealm,
  state: CharacterState,
  number: number
): Promise<ExplorerBuyPlan['wear']> {
  await useRealm(realm);
  if (!supported()) return { wearable: false, remove: [] };
  useCharacter(state);
  const eq = char.equipped;
  const choice = equipSlotFor(eq, number);
  if (choice.already !== undefined) return { wearable: true, remove: [] };
  if (choice.slot === undefined) return { wearable: false, remove: [] };
  // MME's rule answers a weapon its slot whatever is in it, this one too.
  if (eq[choice.slot] === number) return { wearable: true, remove: [] };
  const off = new Set<number>();
  if (eq[choice.slot]! > 0) off.add(eq[choice.slot]!);
  if (choice.slot === WEAPON_SLOT && twoHanded(by.item.get(number)) && eq[OFFHAND_SLOT]! > 0)
    off.add(eq[OFFHAND_SLOT]!);
  if (choice.slot === OFFHAND_SLOT && twoHanded(by.item.get(eq[WEAPON_SLOT]!)))
    off.add(eq[WEAPON_SLOT]!);
  return {
    wearable: true,
    remove: [...off].map((n) => String(by.item.get(n)?.['Name'] ?? n))
  };
}

/**
 * MME's Find Best menu as stock MajorMUD offers it: GreaterMUD's own
 * abilities (VileWard) left out, which `findBest` finds nothing for here.
 */
function gearCriteria(): Array<{ group: string; label: string; rule: FindBestRule }> {
  return FIND_BEST.flatMap(([group, rules]) =>
    rules
      .filter(([, rule]) => rule.greater !== true)
      .map(([label, rule]) => ({ group, label, rule }))
  );
}

/**
 * The Gear card (2026-10-18): MME's Find Best for the character as it is,
 * by the criterion asked, each slot's choice beside what is worn there.
 * MME's own lists (`eqSlotLists`, its dropdowns with the global filter on:
 * what this character can use, in the game, and what it wears), narrowed to
 * what some counter stocks where `soldOnly`, so Buy has somewhere to go.
 */
export async function explorerGear(
  realm: MmeRealm,
  state: CharacterState,
  options: GearOptions,
  sold: (item: number) => boolean
): Promise<GearBoard> {
  await useRealm(realm);
  if (!supported()) return { supported: false, criteria: [], slots: [] };
  const criteria = gearCriteria();
  const rule = (criteria[options.criterion] ?? criteria[0]!).rule;
  useCharacter(state);
  const worn = char.equipped;
  const lists = eqSlotLists(char, { globalFilter: true, onlyInGame: true }).map((list, x) =>
    options.soldOnly ? list.filter((n) => n === worn[x] || sold(n)) : list
  );
  const best = findBest(worn, lists, rule, { noLimited: options.noLimited }).equipped;
  const pick = (n: number | undefined): GearPick | null => {
    const item = n === undefined || n < 1 ? undefined : by.item.get(n);
    if (item === undefined) return null;
    return { number: n!, name: String(item['Name']), value: findBestValue(item, rule) };
  };
  return {
    supported: true,
    criteria: criteria.map(({ group, label }) => [group, label]),
    slots: EQ_SLOTS.flatMap((label, slot) => {
      const now = pick(worn[slot]);
      const choice = pick(best[slot]);
      return now === null && choice === null ? [] : [{ slot, label, worn: now, best: choice }];
    })
  };
}

/** The EQ tab's slot names (mudtool's `tabs/eq.js`), by `EQ_SLOTS` index. */
const SLOT_LABEL = [
  'Head',
  'Ears',
  'Neck',
  'Back',
  'Torso',
  'Arms',
  'Wrist',
  'Wrist',
  'Hands',
  'Finger',
  'Finger',
  'Waist',
  'Legs',
  'Feet',
  'Worn',
  'Off-Hand',
  'Weapon',
  'Eyes',
  'Face',
  'Everywhere'
];
/** The stat panel's two columns, as the labels sit on MME's picture (`tabs/eq.js`). */
const EQ_LEFT = [5, 6, 7, 8, 9, 10, 11, 30, 12, 13, 14, 15, 33, 31, 4];
const EQ_RIGHT = [16, 17, 18, 19, 20, 32, 21, 22, 23, 24, 25, 26, 27, 28, 29];
/** The martial arts grid's rows (DMG, Skill, Accy), each its first figure, punch then kick then jumpkick. */
const EQ_MARTIAL: Array<[string, number]> = [
  ['DMG', 34],
  ['Skill', 37],
  ['Accy', 40]
];
const SECOND_WRIST = 7;

/** `char.attack` for the EQ tab's attack, at the character's level. */
function attackOf(attack: EqAttack, level: number): Record<string, unknown> {
  const type = {
    weapon: ATTACK.weapon,
    bash: ATTACK.bash,
    smash: ATTACK.smash,
    spell: attack.spell > 0 ? ATTACK.spell : ATTACK.oneshot,
    martial: ATTACK.martial,
    oneshot: ATTACK.oneshot
  }[attack.type];
  return {
    ...blankChar().attack,
    type,
    spellNum: attack.spell,
    spellLvl: level,
    ma: attack.ma,
    backstab: attack.backstab
  };
}

/** MME's attack spells (`ui/attack.js` `RefreshSpells`) this character has learned. */
function learnedAttackSpells(): Array<[number, string]> {
  const damaging = (spell: Row): boolean =>
    String(spell['Short'] ?? '').length > 0 &&
    Array.from({ length: 10 }, (_, x) => spell[`Abil-${x}`]).some((abil) =>
      [1, 8, 17].includes(abil as number)
    );
  return (db.Spells as Row[])
    .filter((spell) => damaging(spell) && char.learnedSpells.includes(spell['Number'] as number))
    .map((spell) => [spell['Number'] as number, `${String(spell['Name'])} (${spell['Number']})`]);
}

/**
 * The character as the EQ tab plans it (2026-10-19): what it wears, or the
 * plan's loadout; the pack, read off the inventory, as MME's carried items
 * (everything held the loadout does not put on); the rest of what it
 * carries, by the encumbrance the game reports, as MME's additional weight;
 * the blessings up as its bless spells; and the plan's adjustments and
 * attack. What the pack weighs beyond the loadout, or null unreported.
 */
export function useEqCharacter(state: CharacterState, plan: EqPlan): number | null {
  useCharacter(state);
  const worn = char.equipped.slice();
  const equipped = plan.equipped ?? worn;
  char.equipped = equipped.slice();
  const encum = (n: number): number => (by.item.get(n)?.['Encum'] as number | undefined) ?? 0;
  // The pack: everything held, less one of each the loadout puts on.
  const held = new Map<number, number>();
  for (const item of state.inventory.items) {
    const id = item.row?.id ?? item.id;
    if (id === undefined || !by.item.has(id)) continue;
    held.set(id, (held.get(id) ?? 0) + Math.max(1, item.count ?? 1));
  }
  for (const n of equipped) if (n > 0 && held.has(n)) held.set(n, held.get(n)! - 1);
  char.itemManager = [...held]
    .filter(([, qty]) => qty > 0)
    .map(([item, qty]) => ({ item, flag: 'CARRIED', qty, fieldQty: qty, source: 'Inventory' }));
  // The rest of the pack, as `cmdEquipButtons(2)` works it out from the reported figure.
  const reported = state.inventory.encumbrance;
  let packWeight: number | null = null;
  if (reported !== null) {
    let known = 0;
    for (const n of worn) if (n > 0) known += encum(n);
    for (const item of state.inventory.items) {
      const id = item.row?.id ?? item.id;
      if (id !== undefined && !item.equipped) known += encum(id) * Math.max(1, item.count ?? 1);
    }
    packWeight = Math.max(0, reported - known);
    char.addWeight = packWeight;
    char.useAddWeight = packWeight > 0;
  }
  char.bless = Array.from({ length: 10 }, (_, i) => {
    const buff = state.buffs[i];
    return buff === undefined ? 0 : numberNamed(db.Spells, buff.spell);
  });
  char.statAdjustments = plan.adjustments.slice();
  char.attack = attackOf(plan.attack, char.level);
  return packWeight;
}

/** One figure of the panel, as MME shows it. */
function eqStat(panel: CharStatsPanel, i: number, label = STAT_LABELS[i]!): EqStat {
  const value = panel.stats[i] ?? 0;
  const shown = statDisplay(i, value);
  return {
    i,
    label,
    text: shown.text,
    tone: shown.cls !== '' ? shown.cls : value === 0 ? 'zero' : '',
    tips: panel.tips[i] ?? [],
    adjusted: (char.statAdjustments[i] ?? 0) !== 0
  };
}

/** `InvenCopytoClipboard` (not the equip-commands form), mudtool's `eqText`. */
function eqCopyText(panel: CharStatsPanel): string {
  const c = char;
  const out: string[] = [];
  const named = (rows: Row[], n: number): string =>
    String(rows.find((row) => row['Number'] === n)?.['Name'] ?? '');
  if (c.cls) out.push(`Class: ${named(db.Classes as Row[], c.cls)}`);
  if (c.race) out.push(`Race: ${named(db.Races as Row[], c.race)}`);
  if (c.level > 0) out.push(`Level: ${c.level}`);
  if ((panel.eff['str'] ?? 0) > 0) out.push(`Strength: ${panel.eff['str']}`);
  if (out.length > 0) out.push('');
  const st = panel.stats;
  if (st[2] || st[3]) out.push(`Armour Class: ${st[2]}/${st[3]}`);
  const enc = encumLevel(st[0] ?? 0, st[1] ?? 0);
  out.push(
    `Encumberance: ${st[0]}/${st[1]} - ${enc.name} (${enc.pct}%)`,
    '',
    'They are equipped with:',
    ''
  );
  const line = (x: number): void => {
    const item = by.item.get(c.equipped[x]!);
    if (item !== undefined) out.push(String(item['Name']).padEnd(31) + `(${SLOT_LABEL[x]})`);
  };
  for (let x = 0; x < EQ_SLOT_COUNT; x++) if (x !== OFFHAND_SLOT && x !== WEAPON_SLOT) line(x);
  line(OFFHAND_SLOT);
  line(WEAPON_SLOT);
  const stats: string[] = [];
  for (let x = 4; x <= 42; x++) {
    if (!st[x]) continue;
    stats.push(`${STAT_LABELS[x]} ${statDisplay(x, st[x]!).text}`);
  }
  if (stats.length > 0) out.push('', `Stats: ${stats.join(', ')}`);
  return out.join('\r\n');
}

/**
 * MMUD Explorer's EQ tab (2026-10-19), mudtool's `tabs/eq.js`: the twenty
 * slots with MME's lists, the stat panel `CalcCharacterStats` works out for
 * the loadout planned, with what adds to every figure, and the commands
 * that put it on — for the character as the game reports it
 * (`useEqCharacter`).
 */
export async function explorerEq(
  realm: MmeRealm,
  state: CharacterState,
  plan: EqPlan
): Promise<EqView> {
  await useRealm(realm);
  if (!supported()) return NO_EQ_VIEW;
  useCharacter(state);
  const worn = char.equipped.slice();
  const packWeight = useEqCharacter(state, plan);
  const use2ndWrist = (settings['use2ndWrist'] as boolean | undefined) ?? true;
  const panel = calcCharStats(char, { hideCharStats: plan.itemsOnly, globalFilter: true });
  const lists = eqSlotLists(char, { globalFilter: true });
  const held = new Set(
    state.inventory.items.flatMap((item) => {
      const id = item.row?.id ?? item.id;
      return id === undefined ? [] : [id];
    })
  );
  const named = (n: number): string => String(by.item.get(n)?.['Name'] ?? n);
  const st = panel.stats;
  const enc = encumLevel(st[0] ?? 0, st[1] ?? 0);
  const attk = attkStat();
  const notes: string[] = [];
  if (panel.critEffective !== st[7])
    notes.push(t('explorer.eq.critEffective', { crit: panel.critEffective }));
  if (panel.attackAccyAdj)
    notes.push(t('explorer.eq.attackAccuracy', { accuracy: (st[10] ?? 0) + panel.attackAccyAdj }));
  const className = String(
    (db.Classes as Row[]).find((row) => row['Number'] === char.cls)?.['Name'] ?? ''
  );
  const raceName = String(
    (db.Races as Row[]).find((row) => row['Number'] === char.race)?.['Name'] ?? ''
  );
  return {
    supported: true,
    who: [
      char.name || null,
      className || null,
      raceName || null,
      char.level ? t('explorer.eq.level', { level: char.level }) : null
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
    slots: EQ_SLOTS.map((_, x) => {
      const chosen = char.equipped[x] ?? 0;
      const slot = panel.slots[x] ?? { tip: [], warn: '' };
      return {
        slot: x,
        label: SLOT_LABEL[x]!,
        options: lists[x]!.map((n): [number, string] => [n, `${named(n)} (${n})`]),
        chosen,
        worn: worn[x] ?? 0,
        carried: chosen === 0 || held.has(chosen),
        tip: slot.tip.join(', '),
        warn: slot.warn,
        ...(x === SECOND_WRIST && !use2ndWrist ? { disabled: true } : {})
      };
    }),
    left: EQ_LEFT.map((i) => eqStat(panel, i, i === 4 ? 'Encumbrance %' : STAT_LABELS[i])),
    right: EQ_RIGHT.map((i) => eqStat(panel, i)),
    martial: EQ_MARTIAL.map(([row, first]) =>
      [0, 1, 2].map((k) => eqStat(panel, first + k, `${['Punch', 'Kick', 'Jumpkick'][k]} ${row}`))
    ),
    attk: {
      i: 46,
      label: 'Attk',
      text: attk.text,
      tone: attk.cls !== '' ? attk.cls : attk.text === '0' ? 'zero' : '',
      tips: attk.tip === '' ? [] : [attk.tip],
      adjusted: false
    },
    encumbrance: {
      now: st[0] ?? 0,
      max: st[1] ?? 0,
      level: enc.name,
      percent: enc.pct,
      tips: [
        ...(panel.tips[0] ?? []),
        '',
        ...encumThresholds(st[1] ?? 0).map(([level, weight]) => `${level} @ ${weight}`)
      ]
    },
    armour: {
      text: `${panel.acInt}/${panel.drInt}`,
      ac: panel.tips[2] ?? [],
      dr: panel.tips[3] ?? []
    },
    packWeight,
    notes,
    attackName: currentAttackName(false),
    attackSpells: learnedAttackSpells(),
    criteria: gearCriteria().map(({ group, label }) => [group, label]),
    copyText: eqCopyText(panel),
    commands: equipCommands(char.equipped, worn)
  };
}

/**
 * Putting the plan on (2026-10-19): MME's commands for it
 * (`equipCommands`, what comes off and then what goes on) for the slots
 * whose item the pack holds, less what is worn already; and the items it
 * does not hold, which are bought and worn (`ExplorerBuy`).
 */
export async function explorerEqWear(
  realm: MmeRealm,
  state: CharacterState,
  plan: EqPlan
): Promise<{ commands: string[]; buy: Array<{ number: number; name: string }> }> {
  await useRealm(realm);
  if (!supported() || plan.equipped === null) return { commands: [], buy: [] };
  useCharacter(state);
  const worn = char.equipped.slice();
  const held = new Set(
    state.inventory.items.flatMap((item) => {
      const id = item.row?.id ?? item.id;
      return id === undefined ? [] : [id];
    })
  );
  const planned = plan.equipped.map((n, x) => (n > 0 && !held.has(n) ? (worn[x] ?? 0) : n));
  const wearing = new Set(worn.filter((n) => n > 0).map((n) => String(by.item.get(n)?.['Name'])));
  const commands = equipCommands(planned, worn)
    .split('\r\n')
    .filter((line) => line !== '' && !(line.startsWith('eq ') && wearing.has(line.slice(3))));
  const buy = [...new Set(plan.equipped.filter((n) => n > 0 && !held.has(n)))].map((n) => ({
    number: n,
    name: String(by.item.get(n)?.['Name'] ?? n)
  }));
  return { commands, buy };
}

/** AC and DR as MME writes them in a list, tenths. */
const acdrOf = (row: Row): string =>
  `${(row['ArmourClass'] as number) / 10}/${(row['DamageResist'] as number) / 10}`;

/** A compare list's column: mudtool's `COLS` entry, its heading, and what it reads. */
interface CompareColumn {
  id: string;
  label: string;
  numeric?: boolean;
  get(row: Row): ExplorerCell;
}

/** mudtool's `tabs/lists.js` `COLS`, kind by kind, after the number. */
function compareColumns(kind: CompareKind): CompareColumn[] {
  const name: CompareColumn = {
    id: 'Name',
    label: t('explorer.columns.name'),
    get: (r) => String(r['Name'])
  };
  switch (kind) {
    case 'weapons':
      return [
        name,
        {
          id: 'type',
          label: t('explorer.columns.itemType'),
          get: (r) => weaponType(r['WeaponType'])
        },
        {
          id: 'minmax',
          label: t('explorer.columns.minMax'),
          numeric: true,
          get: (r) => `${r['Min']}-${r['Max']}`
        },
        {
          id: 'Speed',
          label: t('explorer.columns.speed'),
          numeric: true,
          get: (r) => r['Speed'] as number
        },
        {
          id: 'Accy',
          label: t('explorer.columns.accy'),
          numeric: true,
          get: (r) => r['Accy'] as number
        },
        {
          id: 'StrReq',
          label: t('explorer.columns.str'),
          numeric: true,
          get: (r) => r['StrReq'] as number
        },
        {
          id: 'Encum',
          label: t('explorer.columns.encumbrance'),
          numeric: true,
          get: (r) => r['Encum'] as number
        },
        { id: 'acdr', label: t('explorer.columns.ac'), numeric: true, get: acdrOf },
        {
          id: 'swings',
          label: t('explorer.columns.swings'),
          numeric: true,
          get: (r) => truncate(weaponAttack(r)?.swings ?? 0, 2)
        },
        {
          id: 'round',
          label: t('explorer.columns.roundDamage'),
          numeric: true,
          get: (r) => weaponAttack(r)?.roundTotal ?? 0
        }
      ];
    case 'armour':
      return [
        name,
        { id: 'worn', label: t('explorer.columns.slot'), get: (r) => wornType(r['Worn']) },
        {
          id: 'type',
          label: t('explorer.columns.itemType'),
          get: (r) => armourType(r['ArmourType'])
        },
        { id: 'acdr', label: t('explorer.columns.ac'), numeric: true, get: acdrOf },
        {
          id: 'Accy',
          label: t('explorer.columns.accy'),
          numeric: true,
          get: (r) => r['Accy'] as number
        },
        {
          id: 'Encum',
          label: t('explorer.columns.encumbrance'),
          numeric: true,
          get: (r) => r['Encum'] as number
        }
      ];
    case 'spells':
      return [
        name,
        { id: 'Short', label: t('explorer.columns.short'), get: (r) => String(r['Short'] ?? '') },
        {
          id: 'ReqLevel',
          label: t('explorer.columns.level'),
          numeric: true,
          get: (r) => r['ReqLevel'] as number
        },
        {
          id: 'ManaCost',
          label: t('explorer.columns.mana'),
          numeric: true,
          get: (r) => r['ManaCost'] as number
        },
        {
          id: 'magery',
          label: t('explorer.columns.magery'),
          get: (r) => magery(r['Magery'], r['MageryLVL'])
        },
        {
          id: 'minmax',
          label: t('explorer.columns.minMax'),
          numeric: true,
          get: (r) => `${r['MinBase']}-${r['MaxBase']}`
        },
        {
          id: 'Dur',
          label: t('explorer.columns.duration'),
          numeric: true,
          get: (r) => r['Dur'] as number
        },
        {
          id: 'dmg',
          label: t('explorer.columns.dmg'),
          numeric: true,
          get: (r) => spellFigures(r).dmgText
        },
        {
          id: 'heal',
          label: t('explorer.columns.heal'),
          numeric: true,
          get: (r) => spellFigures(r).healText
        }
      ];
    case 'monsters':
      return [
        name,
        {
          id: 'EXP',
          label: t('explorer.columns.exp'),
          numeric: true,
          get: (r) => ((r['EXP'] as number | undefined) ?? 0).toLocaleString('en-US')
        },
        { id: 'HP', label: t('explorer.columns.hp'), numeric: true, get: (r) => r['HP'] as number },
        {
          id: 'acdr',
          label: t('explorer.columns.ac'),
          numeric: true,
          get: (r) => `${r['ArmourClass']}/${r['DamageResist']}`
        },
        {
          id: 'MagicRes',
          label: t('explorer.columns.mr'),
          numeric: true,
          get: (r) => r['MagicRes'] as number
        },
        {
          id: 'damage',
          label: t('explorer.columns.damage'),
          numeric: true,
          get: (r) => monsterDamageIn(r['Number'] as number).damage
        }
      ];
  }
}

/** Each compare list's records, by number. */
function recordsOf(kind: CompareKind): Map<number, Row> {
  return (kind === 'spells' ? by.spell : kind === 'monsters' ? by.monster : by.item) as Map<
    number,
    Row
  >;
}

/**
 * MMUD Explorer's compare lists (2026-10-19), mudtool's `compareList`: the
 * records asked for, in the order given, with the list's own columns, for
 * the character as the game reports it.
 */
export async function explorerCompare(
  realm: MmeRealm,
  state: CharacterState,
  kind: CompareKind,
  numbers: readonly number[]
): Promise<CompareList> {
  await useRealm(realm);
  if (!supported()) return { supported: false, columns: [], rows: [] };
  useCharacter(state);
  const columns = compareColumns(kind);
  const records = recordsOf(kind);
  const rows = numbers.flatMap((n): CompareRow[] => {
    const row = records.get(n);
    if (row === undefined) return [];
    const usable =
      kind === 'weapons' || kind === 'armour'
        ? !char.cls || itemUsableBy(row, char, { ignoreMinItemLevel: true })
        : true;
    return [
      {
        number: n,
        name: String(row['Name']),
        usable,
        cells: Object.fromEntries(columns.map((column) => [column.id, column.get(row)])),
        ...(kind === 'monsters' && monsterDamageIn(n).calculated ? { worked: true } : {})
      }
    ];
  });
  return {
    supported: true,
    columns: [
      { id: 'Number', label: '#', numeric: true, width: '3.5em' },
      ...columns.map((column) => ({
        id: column.id,
        label: column.label,
        width: column.id === 'Name' ? 'minmax(10em, 2fr)' : '6em',
        ...(column.numeric === true ? { numeric: true } : {})
      }))
    ],
    rows
  };
}

/**
 * The records a compare list's picker offers for what is typed: a number,
 * or names holding it, the realm's order, at most `limit`. Weapons and
 * armour are items of their type (`ItemType` 1 and 0); `items` is any item.
 */
export async function explorerFind(
  realm: MmeRealm,
  kind: CompareKind | 'items',
  text: string,
  limit = 25
): Promise<Array<[number, string]>> {
  await useRealm(realm);
  if (!supported()) return [];
  const records = kind === 'items' ? (by.item as Map<number, Row>) : recordsOf(kind);
  const typed = text.trim().toLowerCase();
  if (typed === '') return [];
  const fits = (row: Row): boolean =>
    kind === 'weapons' ? row['ItemType'] === 1 : kind === 'armour' ? row['ItemType'] === 0 : true;
  const found: Array<[number, string]> = [];
  const asNumber = /^\d+$/.test(typed) ? Number(typed) : null;
  if (asNumber !== null) {
    const row = records.get(asNumber);
    if (row !== undefined && fits(row)) found.push([asNumber, String(row['Name'])]);
  }
  for (const [n, row] of records) {
    if (found.length >= limit) break;
    if (n === asNumber || !fits(row)) continue;
    if (String(row['Name']).toLowerCase().includes(typed)) found.push([n, String(row['Name'])]);
  }
  return found;
}

/**
 * The Item Manager's columns for items (2026-10-19), mudtool's
 * `itemManager`: weight, type, where worn, whether usable, and the cheapest
 * counter's buy and sell at the character's charm (its items' bonuses in).
 */
export async function explorerItems(
  realm: MmeRealm,
  state: CharacterState,
  numbers: readonly number[],
  /** Items an item rule names, by name as `itemKey` keys one. */
  names: readonly string[] = []
): Promise<ItemFacts[]> {
  await useRealm(realm);
  if (!supported()) return [];
  const key = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');
  const wanted = new Set(names.map(key));
  const named: number[] = [];
  if (wanted.size > 0)
    for (const [n, item] of by.item as Map<number, Row>) {
      const k = key(String(item['Name']));
      if (!wanted.has(k)) continue;
      wanted.delete(k);
      named.push(n);
    }
  useEqCharacter(state, DEFAULT_EQ_PLAN);
  const charm = calcCharStats(char, { globalFilter: true }).eff['cha'] ?? 0;
  const shopName = (n: number): string | null =>
    n > 0 ? String((by.shop.get(n) as Row | undefined)?.['Name'] ?? `#${n}`) : null;
  return [...new Set([...numbers, ...named])].flatMap((n): ItemFacts[] => {
    const item = by.item.get(n) as Row | undefined;
    if (item === undefined) return [];
    const price = bestShopPrice(item, charm);
    const type = item['ItemType'];
    return [
      {
        number: n,
        name: String(item['Name']),
        enc: (item['Encum'] as number | undefined) ?? 0,
        type: itemType(type),
        worn:
          type === 0
            ? wornType(item['Worn'])
            : type === 1
              ? weaponType(item['WeaponType'])
              : 'Nowhere',
        usable: itemUsableBy(item, char, { ignoreMinItemLevel: true }),
        value: price.value,
        shop: shopName(price.shop),
        more: price.more
      }
    ];
  });
}

/** Next Best's place in its search, per character and criterion (`InvenFindBest`'s `state`). */
const nextBest = new Map<string, Record<string, unknown>>();

/** The EQ tab's Find Best and Next Best (`InvenFindBest`), over the slots not held. */
export async function explorerEqBest(
  realm: MmeRealm,
  state: CharacterState,
  plan: EqPlan,
  find: EqFind
): Promise<EqFound> {
  await useRealm(realm);
  if (!supported()) return { equipped: plan.equipped ?? [], found: false };
  useEqCharacter(state, plan);
  const criteria = gearCriteria();
  const rule = (criteria[find.criterion] ?? criteria[0]!).rule;
  const key = `${state.name ?? ''}|${find.criterion}`;
  if (!find.next || !nextBest.has(key)) nextBest.set(key, {});
  const lists = eqSlotLists(char, { globalFilter: true });
  const found = findBest(char.equipped, lists, rule, {
    next: find.next,
    holds: plan.holds,
    noLimited: find.noLimited,
    use2ndWrist: (settings['use2ndWrist'] as boolean | undefined) ?? true,
    state: nextBest.get(key)
  } as Parameters<typeof findBest>[3]);
  return { equipped: found.equipped, found: found.found };
}

/** The character's room as MME keys one, or null where it is not placed. */
function hereOf(state: CharacterState): string | null {
  const { map, number } = state.room;
  return map === null || number === null ? null : roomKey(map, number);
}

/** A room's text with the character's own part: its illumination and a lair's damage to it. */
function tooltipOf(row: Row, options: Record<string, unknown>): string {
  return roomTooltip(row, {
    ...options,
    illu: charIllumination(),
    lairDamage: (group: unknown, regen: number) => lairDamageLine(lairInfoFor(group, regen))
  });
}

/** A ref as a line: its text with its links, and where the whole line leads. */
function lineOf(entry: {
  text: string;
  ref: { kind: string; n: number | string } | null;
}): RoomLine {
  return { text: runs(entry.text), place: placeOf(entry.ref) };
}

/** Each of MME's directions as a step on its grid, and as the client's own word. */
const GRID_STEP: Record<string, { dx: number; dy: number; word: string }> = {
  N: { dx: 0, dy: -1, word: 'n' },
  S: { dx: 0, dy: 1, word: 's' },
  E: { dx: 1, dy: 0, word: 'e' },
  W: { dx: -1, dy: 0, word: 'w' },
  NE: { dx: 1, dy: -1, word: 'ne' },
  NW: { dx: -1, dy: -1, word: 'nw' },
  SE: { dx: 1, dy: 1, word: 'se' },
  SW: { dx: -1, dy: 1, word: 'sw' }
};

/** The way back along each direction, so a corridor is drawn once. */
const BACK: Record<string, string> = {
  N: 'S',
  S: 'N',
  E: 'W',
  W: 'E',
  NE: 'SW',
  SW: 'NE',
  NW: 'SE',
  SE: 'NW'
};

/** The directions a corridor is drawn from, the other half drawn from the room at the far end. */
const DRAWN_FROM = new Set(['E', 'S', 'SE', 'SW']);

/**
 * What stands in an exit, MME's `nExitType` as the tone the client's maps
 * draw it in (`MapGlyphs.toneOf`'s): a key, a door or gate, a toll, a trap,
 * a level, class, race, standing or ability, a spell cast on the way, and
 * everything that wants a word, an item, a wait or a ticket hidden.
 */
function toneOfExit(code: number | undefined): string | undefined {
  switch (code) {
    case EXIT['KEY']:
      return 'key';
    case EXIT['DOOR']:
    case EXIT['GATE']:
      return 'door';
    case EXIT['TOLL']:
      return 'toll';
    case EXIT['TRAP']:
    case EXIT['SPELLTRAP']:
      return 'trap';
    case EXIT['CLASS']:
    case EXIT['RACE']:
    case EXIT['LEVEL']:
    case EXIT['ALIGN']:
    case EXIT['ABILITY']:
    case EXIT['MAX']:
      return 'gate';
    case EXIT['CAST']:
      return 'cast';
    case EXIT['HIDDEN']:
    case EXIT['ITEM']:
    case EXIT['TEXT']:
    case EXIT['TIMED']:
    case EXIT['TICKET']:
    case EXIT['BLOCKED']:
    case EXIT['DELAY']:
      return 'hidden';
    default:
      return undefined;
  }
}

/** `SHOP_TYPE`'s hospital, tavern, training and inn as mudmaps letters them. */
const SHOP_LETTERS: Record<number, string> = { 5: 'T', 6: 'P', 8: 'G', 9: 'I' };
/** `SHOP_TYPE`'s bank. */
const BANK = 7;

/** A room's name and number, as a way's title names where it leads. */
function placeName(map: number, room: number): string {
  const row = getRoom(map, room);
  return `${row === null ? '?' : String(row['Name'])} (${map}/${room})`;
}

/**
 * One charted cell, in the client's drawing (2026-10-18): what the room is
 * in mudmaps' order (a shop or bank, somebody living there, a command, a
 * lair, a way up or down), its corridors to the cells beside it that hold the
 * rooms they reach, and arrows, chevrons and portals for the ways a straight
 * line cannot draw. The map options' *don't mark lairs, NPCs, commands* say
 * what is not shown.
 */
function cellOf(
  cell: MapCell,
  i: number,
  grid: { cols: number; rows: number; cells: Array<MapCell | null> },
  shown: ReadonlySet<string>,
  options: Record<string, unknown>
): RoomCell {
  const self = roomKey(cell.map, cell.room);
  const row = cell.row;
  const exits = row === null ? [] : roomExits(row);
  const follow = (dir: 'U' | 'D'): string | null => {
    const exit = exits[DIRS.indexOf(dir)];
    return exit && !exit.action && exit.map && exit.room ? roomKey(exit.map, exit.room) : null;
  };
  const shopRow = row === null ? undefined : by.shop.get((row['Shop'] as number) || 0);
  const lair = options['noLairs'] !== true && String(row?.['Lair'] ?? '').length > 1;
  const npc = options['noNPC'] !== true && ((row?.['NPC'] as number) || 0) > 0;
  const command = options['noCMD'] !== true && ((row?.['CMD'] as number) || 0) > 0;
  const shopType = shopRow === undefined ? null : (shopRow['ShopType'] as number) || 0;
  const kind: RoomCell['kind'] =
    shopType === BANK
      ? 'bank'
      : shopType !== null
        ? 'shop'
        : npc
          ? 'npc'
          : command
            ? 'cmd'
            : lair
              ? 'lair'
              : follow('U') !== null || follow('D') !== null
                ? 'stairs'
                : 'room';
  const letter = shopType === null ? undefined : SHOP_LETTERS[shopType];
  const col = i % grid.cols;
  const line = Math.floor(i / grid.cols);
  const beside = (dir: string): MapCell | null => {
    const step = GRID_STEP[dir]!;
    const c = col + step.dx;
    const r = line + step.dy;
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null;
    return grid.cells[r * grid.cols + c] ?? null;
  };
  const links: RoomCell['links'] = [];
  const arrows: RoomCell['arrows'] = [];
  for (const exit of exits) {
    if (exit === null || exit.action || !exit.map || !exit.room) continue;
    const step = GRID_STEP[exit.dir];
    if (step === undefined) continue;
    const to = roomKey(exit.map, exit.room);
    const next = beside(exit.dir);
    const tone = toneOfExit(exit.code);
    const title = exit.type !== undefined && exit.type.length > 2 ? exit.type : undefined;
    if (next !== null && next.map === exit.map && next.room === exit.room) {
      // Once per corridor: from this end, or from here where the far end has no way back.
      const back = next.row === null ? null : roomExits(next.row)[DIRS.indexOf(BACK[exit.dir]!)];
      const backHere = back && !back.action && back.map === cell.map && back.room === cell.room;
      if (DRAWN_FROM.has(exit.dir) || !backHere)
        links.push({ dir: step.word, ...(tone ? { tone } : {}), ...(title ? { title } : {}) });
      continue;
    }
    /*
     * An exit into an empty square to a room the map does not hold is only
     * past the grid's edge, and is not drawn; one to another map is, as
     * mudmaps marks a way to another area.
     */
    if (next === null && !shown.has(to) && exit.map === cell.map) continue;
    arrows.push({
      dir: step.word,
      to,
      local: shown.has(to),
      title: `${DIR_NAMES[exit.dir] ?? exit.dir}: ${placeName(exit.map, exit.room)}${title ? ` ${title}` : ''}`,
      gated: tone !== undefined
    });
  }
  const away: RoomCell['away'] = [];
  for (const dir of ['U', 'D'] as const) {
    const exit = exits[DIRS.indexOf(dir)];
    if (!exit || exit.action || !exit.map || !exit.room) continue;
    away.push({
      kind: dir === 'U' ? 'up' : 'down',
      to: roomKey(exit.map, exit.room),
      title: `${DIR_NAMES[dir]}: ${placeName(exit.map, exit.room)}${exit.type && exit.type.length > 2 ? ` ${exit.type}` : ''}`,
      gated: toneOfExit(exit.code) !== undefined
    });
  }
  if (command && row !== null)
    for (const tp of roomTeleports(row['CMD'] as number, cell.map))
      away.push({
        kind: 'teleport',
        to: roomKey(tp.map, tp.room),
        title: `${tp.command}: ${placeName(tp.map, tp.room)}`,
        gated: false
      });
  const base = {
    map: cell.map,
    room: cell.room,
    kind,
    ...(letter !== undefined && kind === 'shop' ? { letter } : {}),
    ...(lair && kind !== 'lair' ? { lairBadge: true } : {}),
    links,
    arrows,
    away
  };
  if (row === null) return { ...base, target: null };
  if (cell.color === CELL.UP) return { ...base, target: follow('U') };
  if (cell.color === CELL.DOWN) return { ...base, target: follow('D') };
  if (cell.color === CELL.BOTH)
    return { ...base, target: self, upDown: { up: follow('U'), down: follow('D') } };
  return { ...base, target: self };
}

/**
 * The Rooms tab for one room (2026-10-18): MME's map laid out from it
 * (`buildMap`, `MapStartMapping`), the compass, its references and its full
 * text (`MapGetRoomLoc`), and the character's room, which the map marks.
 */
export async function explorerRoomView(
  realm: MmeRealm,
  state: CharacterState,
  request: RoomViewRequest
): Promise<ExplorerRoomView> {
  const { map, room } = request;
  const empty = { found: false, map, room, name: '', grid: null, compass: [], refs: [], info: '' };
  await useRealm(realm);
  if (!supported()) return { ...empty, supported: false, here: null };
  useCharacter(state);
  const here = hereOf(state);
  const row = getRoom(map, room);
  if (row === null) return { ...empty, supported: true, here };
  const size = MAP_SIZES.find((s) => s.id === request.size) ?? MAP_SIZES[0]!;
  const options = { ...request.options };
  const grid = buildMap(map, room, size, options, request.center, null);
  const shownRooms = new Set(
    grid.cells.flatMap((cell) => (cell === null ? [] : [roomKey(cell.map, cell.room)]))
  );
  const exits = roomExits(row);
  return {
    supported: true,
    found: true,
    map,
    room,
    name: String(row['Name']),
    grid: {
      cols: grid.cols,
      rows: grid.rows,
      zoom: grid.zoom,
      center: grid.center,
      cells: grid.cells.map((cell, i) =>
        cell === null ? null : cellOf(cell, i, grid, shownRooms, options)
      )
    },
    compass: DIRS.map((dir, i) => {
      const exit = exits[i];
      const leads = exit && !exit.action && exit.map && exit.room;
      return {
        dir,
        target: leads ? roomKey(exit.map!, exit.room!) : null,
        title: exit ? `${DIR_NAMES[dir] ?? dir}: ${exit.raw}` : '',
        mapChange: leads ? exit.map !== map : false
      };
    }),
    refs: roomRefs(map, room, options).map(lineOf),
    info: tooltipOf(row, { ...options, showAllExits: true }),
    here
  };
}

/** A cell's tooltip, asked on the hover: the room's text, or its number where the realm has none. */
export async function explorerRoomTip(
  realm: MmeRealm,
  state: CharacterState,
  map: number,
  room: number,
  options: RoomViewRequest['options']
): Promise<string> {
  await useRealm(realm);
  if (!supported()) return '';
  useCharacter(state);
  const row = getRoom(map, room);
  return row === null ? `Map ${map} Room ${room}` : tooltipOf(row, { ...options });
}

/** MME's room finders: Find Next by name, List by name (its first 500), Leads here. */
export async function explorerRoomSearch(
  realm: MmeRealm,
  state: CharacterState,
  search: RoomSearch
): Promise<RoomSearchResult> {
  await useRealm(realm);
  if (!supported()) return {};
  useCharacter(state);
  if ('find' in search) {
    const found = findRoomByName(search.find, search.after);
    return {
      room:
        found === null
          ? null
          : roomKey(found['Map Number'] as number, found['Room Number'] as number)
    };
  }
  if ('list' in search) {
    const found = searchRooms(search.list);
    return {
      capped: found.length >= ROOM_LIST_LIMIT,
      lines: found.map((row) => {
        const key = roomKey(row['Map Number'] as number, row['Room Number'] as number);
        return {
          text: [{ text: `${String(row['Name'])} (${key})` }],
          place: { tab: 'rooms', n: key }
        };
      })
    };
  }
  const [map, room] = search.leads.split('/').map(Number);
  return { lines: leadsHere(map ?? 0, room ?? 0, { onlyInGame: true }).map(lineOf) };
}

/** `searchRooms`' own limit, which MME's list stops at. */
const ROOM_LIST_LIMIT = 500;

/** NMR 1.83, from which the realm states lairs, game limits and BS defence (`engine.nmrVersion`). */
const LAIR_NMR = 1.83;

/** The three monsters `FilterMonsters` leaves out by lair, by number and name. */
const NOT_BY_LAIR: ReadonlyArray<[number, string]> = [
  [1086, 'cloaked figure'],
  [1087, 'disenchanter'],
  [597, 'Dao Lord']
];

/** The monsters `AddMonster2LV` lists: named, not `sdf`, and by lair not the three MME leaves out. */
function monsterListed(m: Row, byLair: boolean): boolean {
  const name = String(m['Name'] ?? '');
  if (name === '' || name.slice(0, 3) === 'sdf') return false;
  return !(byLair && NOT_BY_LAIR.some(([n, named]) => m['Number'] === n && name === named));
}

/** A monster's lair averages, kept for the list it was asked for. */
const lairCache = new Map<number, ReturnType<typeof lairAverages>>();
function lairOf(m: Row): ReturnType<typeof lairAverages> {
  const n = m['Number'] as number;
  let found = lairCache.get(n);
  if (found === undefined) {
    found = lairAverages(String(m['Summoned By'] ?? ''), mmeContext());
    lairCache.set(n, found);
  }
  return found;
}

/** `GetPreCalculatedMonsterDamage`: the realm's figure until it is worked out against the character. */
function damageIn(m: Row): number {
  return hooks.monsterDamageIn?.(m['Number'] as number).damage ?? ((m['AvgDmg'] as number) || 0);
}

/** The Damage column's figure: a lair's average by lair for a monster that only spawns there. */
function avgDamage(m: Row, byLair: boolean): number {
  const lair = byLair ? lairOf(m) : null;
  return lair !== null && lair.nTotalLairs > 0 && m['RegenTime'] === 0
    ? lair.nAvgDmgLair
    : damageIn(m);
}

/** How many lairs `Summoned By` names. */
const lairCount = (m: Row): number =>
  String(m['Summoned By'] ?? '').match(/\(lair\)/gi)?.length ?? 0;

/**
 * The Monsters list's columns, mudtool's `tabs/monsters.js` in its order,
 * the exp/hour hook's beside them; the Damage column a lair's average by lair
 * (`*`).
 */
function monsterColumns(byLair: boolean): Column[] {
  lairCache.clear();
  const nmr = engine.nmrVersion;
  const num = (
    id: string,
    label: string,
    width: string,
    get: (m: Row) => ExplorerCell,
    show?: (value: ExplorerCell, m: Row) => string
  ): Column => ({ id, label, width, numeric: true, get, ...(show === undefined ? {} : { show }) });
  const comma = (v: ExplorerCell): string => ((v as number) > 0 ? fmtComma(v as number) : '0');
  return [
    ...leading(),
    num('RegenTime', t('explorer.columns.regen'), '3.5em', (m) => (m['RegenTime'] as number) || 0),
    num('exp', t('explorer.columns.exp'), '6em', (m) => monsterExp(m), comma),
    num('HP', t('explorer.columns.hp'), '4.5em', (m) => (m['HP'] as number) || 0, comma),
    num(
      'acdr',
      t('explorer.columns.ac'),
      '4.5em',
      (m) => ((m['ArmourClass'] as number) || 0) + ((m['DamageResist'] as number) || 0),
      (_v, m) => `${m['ArmourClass']}/${m['DamageResist']}`
    ),
    num('dodge', t('explorer.columns.dodge'), '4em', (m) => Math.max(0, hasAbil(m, 34, 0))),
    num('MagicRes', t('explorer.columns.mr'), '3.5em', (m) => (m['MagicRes'] as number) || 0),
    num(
      'acc',
      t('explorer.columns.attackAcc'),
      '6em',
      (m) => monsterAttackSummary(m).nAccMax,
      (_v, m) => {
        const a = monsterAttackSummary(m);
        return a.nAccMajority !== a.nAccMax ? `${a.nAccMajority}/${a.nAccMax}` : String(a.nAccMax);
      }
    ),
    num(
      'dmg',
      t('explorer.columns.damage'),
      '5em',
      (m) => avgDamage(m, byLair),
      (v, m) =>
        ((v as number) > 0 ? fmtComma(v as number) : v === 0 ? '0' : '?') +
        (byLair && lairOf(m).nTotalLairs > 0 && m['RegenTime'] === 0 ? '*' : '')
    ),
    num(
      'edh',
      t('explorer.columns.expPerDamage'),
      '6.5em',
      (m) => expPerDmgHP(monsterExp(m), avgDamage(m, byLair), (m['HP'] as number) || 0),
      comma
    ),
    ...hooked(hooks.columns.monsters),
    num(
      'AvgLairExp',
      t('explorer.columns.lairExp'),
      '5.5em',
      (m) => (m['AvgLairExp'] as number) || 0,
      (v) => (v ? Number(v).toLocaleString('en-US') : '0')
    ),
    num('lairs', t('explorer.columns.lairs'), '4em', lairCount, (v) => (v ? String(v) : '')),
    num(
      'mobs',
      nmr >= LAIR_NMR ? t('explorer.columns.mobsSpawn') : t('explorer.columns.mobs'),
      '6.5em',
      (m) => {
        const p = monsterPossy(m['Number'] as number);
        return p.spawnChance > 0 ? p.spawnChance * 100 * p.possy : p.possy;
      },
      (_v, m) => {
        const p = monsterPossy(m['Number'] as number);
        return !p.possy
          ? ''
          : p.spawnChance > 0
            ? `${p.possy} / ${Math.round(p.spawnChance * 100)}%`
            : String(p.possy);
      }
    ),
    num(
      'mag',
      t('explorer.columns.magic'),
      '3.5em',
      (m) => Math.max(0, hasAbil(m, 28, 0)),
      (v) => (v ? String(v) : '')
    ),
    ...(nmr >= LAIR_NMR
      ? [
          num(
            'BSDefense',
            t('explorer.columns.bsDefense'),
            '5.5em',
            (m) => (m['BSDefense'] as number) || 0,
            (v) => (v ? String(v) : '')
          )
        ]
      : []),
    {
      id: 'Undead',
      label: t('explorer.columns.undead'),
      width: '4.5em',
      get: (m) => ((m['Undead'] as number) > 0 ? 'X' : '')
    },
    {
      id: 'spatk',
      label: t('explorer.columns.spellAttack'),
      width: '5.5em',
      get: (m) => monsterSpellAttackCol(m)
    }
  ];
}

/** What `FilterMonsters` reads of a monster, for the mode asked. */
function monsterFactsOf(m: Row, byLair: boolean): ExplorerMonsterFacts {
  const nmr = engine.nmrVersion;
  const lair = nmr >= LAIR_NMR ? lairOf(m) : null;
  const possy = monsterPossy(m['Number'] as number);
  const attack = monsterAttackSummary(m, false, true);
  const n = (key: string): number => (m[key] as number) || 0;
  return {
    regen: n('RegenTime'),
    hp: byLair && lair !== null && lair.nTotalLairs > 0 ? lair.nAvgHP : n('HP'),
    damage: avgDamage(m, byLair),
    exp: monsterExp(m),
    magic: Math.max(0, hasAbil(m, 28, 0)),
    dodge: hasAbil(m, 34, 0) > 0 ? hasAbil(m, 34) : -1,
    coins: [n('C'), n('S'), n('G'), n('P'), n('R')],
    ac: n('ArmourClass'),
    dr: n('DamageResist'),
    mr: n('MagicRes'),
    bsDefense: nmr >= LAIR_NMR ? n('BSDefense') : null,
    undead: n('Undead') !== 0,
    align: n('Align'),
    gameLimit: nmr >= LAIR_NMR ? n('GameLimit') : null,
    lairExp: nmr >= LAIR_NMR ? n('AvgLairExp') : null,
    lairs: lair !== null ? lair.nTotalLairs : lairCount(m),
    maxRegen: lair?.nMaxRegen ?? 0,
    possy: possy.possy,
    mobs: nmr >= LAIR_NMR ? (lair?.nMaxRegen ?? 0) : possy.possy,
    poison: attack.bAtkPoison === true,
    confusion: attack.bAtkConfusion === true,
    fear: attack.bAtkFear === true,
    accMajority: attack.nAccMajority,
    accMax: attack.nAccMax,
    abilities: abilitySlots(m)
  };
}

function monsterRowOf(m: Row, columns: readonly Column[], byLair: boolean): ExplorerRow {
  const cells: Record<string, ExplorerCell> = {};
  const shown: Record<string, string> = {};
  for (const column of columns) {
    const value = column.get(m);
    cells[column.id] = value;
    if (column.show !== undefined) shown[column.id] = column.show(value, m);
  }
  return {
    number: m['Number'] as number,
    name: String(m['Name']),
    usable: true,
    inGame: isInGame(m),
    worn: false,
    cells,
    ...(Object.keys(shown).length > 0 ? { shown } : {}),
    facts: {
      type: '',
      magical: 0,
      hasMagical: false,
      hitMagic: 0,
      limit: 0,
      strength: 0,
      speed: 0,
      abilities: abilitySlots(m),
      negates: []
    },
    monster: monsterFactsOf(m, byLair)
  };
}

/** `PullMonsterDetail`: MME's labelled rows, each marked up with its links. */
function monsterDetailOf(number: number, options?: ExplorerOptions): ExplorerDetail | null {
  const m = by.monster.get(number);
  if (m === undefined) return null;
  const byLair = options?.byLair === true && engine.nmrVersion >= LAIR_NMR;
  setView('monstersByLair', byLair);
  const rows = monsterDetail(m, { ...mmeContext(), lairMode: byLair });
  return {
    number,
    name: String(m['Name']),
    // mudtool's heading: the number alone.
    sub: `#${number}`,
    text: [],
    refs: [],
    table: rows.slice(1).map((row) => ({
      label: runs(row.label),
      text: runs(row.text),
      ...(row.cls ? { cls: row.cls } : {})
    }))
  };
}

/*
 * Exp/hour on the Monsters list and in its detail, mudtool's `hooks/exphr.js`
 * glue on the vendored estimate (`mmud/exphr.js`): the character's inputs
 * gathered once per character, each monster's result kept until the
 * character changes. The settings are MME's defaults until the Tools tab
 * offers them.
 */
interface ExpHrEnv {
  key: string;
  env: Record<string, unknown>;
  list: Map<number, ExpHrResult>;
  detail: Map<number, ExpHrResult>;
}
let expHr: ExpHrEnv | null = null;

/** The estimate's inputs for the character now (`getEnv`), gathered once per character. */
function expHrEnv(): ExpHrEnv {
  const key = JSON.stringify([
    char.cls,
    char.race,
    char.level,
    char.stats,
    char.equipped,
    char.attack,
    settings['exphr']
  ]);
  if (expHr?.key === key) return expHr;
  const useChar = settings['globalFilter'] === true;
  const panel = calcCharStats(char, { globalFilter: useChar });
  const summary = calcCharSummary(char, panel);
  const cp = profileFromChar(char, { globalFilter: useChar });
  const ch = expHrCharacter(char, {
    useChar,
    profile: useChar ? cp : expHrProfile(cp, false),
    panel,
    summary
  });
  const profile = expHrProfile(cp, useChar, ch.spellOverhead);
  const lairs = new Map<string, unknown>();
  const env = {
    ch,
    profile,
    attack: attackConfig(char.attack, char.equipped),
    config: normaliseExpHrConfig((settings['exphr'] as Record<string, unknown>) ?? EXPHR_DEFAULTS),
    lair: (summonedBy: string) => {
      if (!lairs.has(summonedBy)) lairs.set(summonedBy, lairAverages(summonedBy));
      return lairs.get(summonedBy);
    },
    monsterDamage: (m: Row) => {
      const d = hooks.monsterDamageIn?.(m['Number'] as number);
      return d?.calculated === true ? d.damage : m['AvgDmg'];
    },
    useChar
  };
  expHr = { key, env, list: new Map(), detail: new Map() };
  return expHr;
}

function expHrFor(m: Row, list: boolean): ExpHrResult {
  const at = expHrEnv();
  const cache = list ? at.list : at.detail;
  const n = m['Number'] as number;
  let found = cache.get(n);
  if (found === undefined) {
    try {
      found = monsterExpPerHour(m, { ...at.env, list });
    } catch {
      found = { kind: 'none', info: null };
    }
    cache.set(n, found);
  }
  return found;
}

hooks.columns.monsters.push(
  {
    key: 'exphr',
    label: 'Exp/hr',
    num: true,
    width: '6.5em',
    get: (m) => expHrFor(m, true).info?.nExpPerHour ?? '',
    fmt: (v, m) =>
      v === '' ? '' : expPerHourCell(v as number) + (expHrFor(m, true).kind === 'lair' ? '' : ' *')
  },
  {
    key: 'recover',
    label: 'Recover',
    num: true,
    width: '4.5em',
    get: (m) => {
      const r = expHrFor(m, true);
      const recoveryOnly =
        (expHrEnv().env['config'] as { recoveryOnly?: boolean }).recoveryOnly === true;
      return r.info !== null && !recoveryOnly ? Math.round(r.info.nTimeRecovering * 100) : '';
    },
    fmt: (v) => (v === '' ? '' : `${v}%`)
  }
);

hooks.monsterExtraRows.push((m) => {
  const r = expHrFor(m, false);
  const at = expHrEnv().env;
  return scriptingRows(m, r, {
    useChar: at['useChar'] === true,
    showAll: (at['config'] as { showAll?: boolean }).showAll === true
  });
});

/** The Class/Race tab's classes (`AddClass2LV`), mudtool's `tabs/classes.js` columns. */
function classColumns(): Column[] {
  return [
    ...leading(),
    {
      id: 'ExpTable',
      label: t('explorer.columns.expPct'),
      numeric: true,
      width: '4.5em',
      get: (c) => (c['ExpTable'] as number) || 0,
      show: (_v, c) => classCols(c).exp
    },
    {
      id: 'weapon',
      label: t('explorer.columns.weapon'),
      width: '7em',
      get: (c) => classCols(c).weapon
    },
    {
      id: 'ArmourType',
      label: t('explorer.columns.armour'),
      numeric: true,
      width: '6.5em',
      get: (c) => (c['ArmourType'] as number) || 0,
      show: (_v, c) => classCols(c).armour
    },
    {
      id: 'magic',
      label: t('explorer.columns.magic'),
      width: '6.5em',
      get: (c) => classCols(c).magic
    },
    {
      id: 'CombatLVL',
      label: t('explorer.columns.combat'),
      numeric: true,
      width: '3.5em',
      get: (c) => ((c['CombatLVL'] as number) || 0) - 2
    },
    { id: 'hp', label: t('explorer.columns.hp'), width: '4em', get: (c) => classCols(c).hp },
    {
      id: 'abilities',
      label: t('explorer.columns.abilities'),
      width: 'minmax(12em, 2fr)',
      get: (c) => plain(classAbilities(c))
    }
  ];
}

/** A race's stats, MME's keys and the client's column words, in `AddRace2LV`'s order. */
const RACE_STATS: ReadonlyArray<[string, () => string]> = [
  ['STR', () => t('explorer.columns.str')],
  ['INT', () => t('explorer.columns.int')],
  ['WIL', () => t('explorer.columns.wis')],
  ['AGL', () => t('explorer.columns.agi')],
  ['HEA', () => t('explorer.columns.hea')],
  ['CHM', () => t('explorer.columns.cha')]
];

/** The Class/Race tab's races (`AddRace2LV`), each stat its range, sorted by its sum. */
function raceColumns(): Column[] {
  return [
    ...leading(),
    {
      id: 'ExpTable',
      label: t('explorer.columns.expPct'),
      numeric: true,
      width: '4.5em',
      get: (r) => (r['ExpTable'] as number) || 0,
      show: (v) => `${v}%`
    },
    {
      id: 'HPPerLVL',
      label: t('explorer.columns.hp'),
      numeric: true,
      width: '3.5em',
      get: (r) => (r['HPPerLVL'] as number) || 0
    },
    ...RACE_STATS.map(([key, label]): Column => ({
      id: `x${key}`,
      label: label(),
      numeric: true,
      width: '4.5em',
      get: (r) => ((r[`m${key}`] as number) || 0) + ((r[`x${key}`] as number) || 0),
      show: (_v, r) => raceStat(r, key)
    })),
    {
      id: 'abilities',
      label: t('explorer.columns.abilities'),
      width: 'minmax(12em, 2fr)',
      get: (r) => plain(raceAbilities(r))
    }
  ];
}

/** A class's or race's row; a race's stats toned `hi` or `lo` as `RaceColorCode` colours them. */
function classRaceRowOf(
  r: Row,
  columns: readonly Column[],
  tones: Record<string, 'lo' | 'hi'> | undefined
): ExplorerRow {
  const cells: Record<string, ExplorerCell> = {};
  const shown: Record<string, string> = {};
  for (const column of columns) {
    const value = column.get(r);
    cells[column.id] = value;
    if (column.show !== undefined) shown[column.id] = column.show(value, r);
  }
  const toned =
    tones === undefined
      ? {}
      : Object.fromEntries(Object.entries(tones).map(([key, tone]) => [`x${key}`, tone]));
  return {
    number: r['Number'] as number,
    name: String(r['Name']),
    usable: true,
    inGame: true,
    worn: false,
    cells,
    ...(Object.keys(shown).length > 0 ? { shown } : {}),
    ...(Object.keys(toned).length > 0 ? { tones: toned } : {}),
    facts: {
      type: '',
      magical: 0,
      hasMagical: false,
      hitMagic: 0,
      limit: 0,
      strength: 0,
      speed: 0,
      abilities: [],
      negates: []
    }
  };
}

/** A fact of a class's or race's detail, as a row of the detail's table. */
const fact = (label: string, text: string, cls?: string) => ({
  label: [{ text: label }],
  text: runs(text),
  ...(cls === undefined ? {} : { cls })
});

/**
 * `PullClassDetail`, or the builder (`RefreshClassRaceBuilder`): the class's
 * exp, HP and sample swings at five levels, with the race asked.
 */
function classDetailOf(number: number, options?: ExplorerOptions): ExplorerDetail | null {
  const c = by.cls.get(number);
  if (c === undefined) return null;
  const name = String(c['Name']);
  if (options?.builder === true) {
    return {
      number,
      name: t('explorer.classes.builderOf', { name }),
      sub: t('explorer.classes.builderSub'),
      text: [{ text: buildClassRace(number, options.builderRace).join('\n') }],
      refs: [],
      races: db.Races.filter((r) => r['Name'])
        .map((r): [number, string] => [r['Number'] as number, String(r['Name'])])
        .sort((a, b) => a[1].localeCompare(b[1]))
    };
  }
  const k = classCols(c);
  return {
    number,
    name,
    sub: t('explorer.classes.classSub', { number }),
    text: [],
    refs: [],
    table: [
      fact(t('explorer.classes.exp'), k.exp),
      fact(t('explorer.classes.weapon'), k.weapon),
      fact(t('explorer.classes.armour'), k.armour),
      fact(t('explorer.classes.magic'), k.magic),
      fact(t('explorer.classes.combat'), String(k.combat)),
      fact(t('explorer.classes.hpPerLevel'), k.hp),
      fact(t('explorer.classes.abilities'), classAbilities(c) || t('explorer.classes.none'))
    ]
  };
}

/** `PullRaceDetail`: its exp, HP bonus, CP, stats toned as MME colours them, and abilities. */
function raceDetailOf(number: number): ExplorerDetail | null {
  const r = by.race.get(number);
  if (r === undefined) return null;
  const tones = raceColours(db.Races.filter((race) => race['Name'])).get(number) ?? {};
  return {
    number,
    name: String(r['Name']),
    sub: t('explorer.classes.raceSub', { number }),
    text: [],
    refs: [],
    table: [
      fact(t('explorer.classes.exp'), `${r['ExpTable']}%`),
      fact(t('explorer.classes.hpBonus'), String(r['HPPerLVL'])),
      fact(t('explorer.classes.baseCP'), String(r['BaseCP'])),
      ...RACE_STATS.map(([key, label]) =>
        fact(label(), raceStat(r, key), tones[key] === undefined ? undefined : `stat-${tones[key]}`)
      ),
      fact(t('explorer.classes.abilities'), raceAbilities(r) || t('explorer.classes.none'))
    ]
  };
}
