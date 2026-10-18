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

import { by, db, loadDB } from './vendor/js/db.js';
import { detectEngine, engine } from './vendor/js/mmud/engine.js';
import { blankChar, char, EQ_SLOTS, roster, switchChar } from './vendor/js/char.js';
import { setSetting } from './vendor/js/state.js';
import { isInGame, itemUsableBy } from './vendor/js/mmud/usable.js';
import {
  abilityList,
  armourCols,
  hasAbil,
  hooks,
  itemDetail,
  segments,
  weaponCols,
  type HookColumn
} from './vendor/js/mmud/details.js';
import {
  eqSlotLists,
  equipItem,
  equipSlotFor,
  findBest,
  findBestValue,
  FIND_BEST,
  type FindBestRule
} from './vendor/js/mmud/charstats.js';
import { setWeaponOpts, weaponMax, weaponMin, weaponSpeed } from './vendor/js/hooks/combat.js';
import { MUD } from './vendor/js/mmud/combat.js';
import { armourType, weaponType, wornType } from './vendor/js/mmud/enums.js';
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
  ExplorerOptions,
  ExplorerRow,
  ExplorerSegment,
  GearBoard,
  GearOptions,
  GearPick
} from '../../shared/explorer';

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
async function useRealm(realm: MmeRealm): Promise<void> {
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
function supported(): boolean {
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
  if (options !== undefined)
    c.weaponVsChar = { ac: options.vsAC, dr: options.vsDR, dodge: options.vsDodge };
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
  const type = kind === 'weapons' ? ITEM_TYPE.weapon : ITEM_TYPE.armour;
  const columns = kind === 'weapons' ? weaponColumns() : armourColumns();
  const rows = db.Items.filter((item) => item['ItemType'] === type).map((item) =>
    rowOf(item, kind, columns)
  );
  return {
    supported: true,
    columns: columns.map(({ id, label, width, numeric }) => ({
      id,
      label,
      width,
      ...(numeric === true ? { numeric: true } : {})
    })),
    rows,
    abilities: abilityList()
  };
}

/** mudtool's marked-up text as runs, its references kept (`segments`). */
function runs(text: string): ExplorerSegment[] {
  return segments(text) as ExplorerSegment[];
}

/** One item's detail as MME writes it, compared against what is worn in its slot. */
export async function explorerDetail(
  realm: MmeRealm,
  state: CharacterState,
  number: number
): Promise<ExplorerDetail | null> {
  await useRealm(realm);
  if (!supported()) return null;
  useCharacter(state);
  const item = by.item.get(number);
  if (item === undefined) return null;
  const detail = itemDetail(item, { equipped: char.equipped });
  return {
    number,
    name: String(item['Name']),
    text: runs(detail.text),
    refs: detail.refs.map((ref: { text: string; pct?: number | string }) => ({
      text: runs(ref.text),
      ...(typeof ref.pct === 'number' ? { pct: ref.pct } : {})
    }))
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
