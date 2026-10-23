/**
 * MMUD Explorer's filter bars and list order, as mudtool's tabs apply them
 * (`../mudtool/js/tabs/weapons.js` and `armour.js` `passes`, `mmud/details.js`
 * `spellPasses`, `ui/table.js` `sortView`), over the rows main sends
 * (`@shared/explorer`), 2026-10-18.
 */
import type { ExplorerCell, ExplorerKind, ExplorerRow } from '@shared/explorer';

/** MME's ability filter (`abilityFilter`): an ability, `<=` or `>=`, a value; `-1` negates spell #. */
export interface AbilityFilter {
  abil: number;
  op: 'le' | 'ge';
  value: number;
}

/** Every filter on both bars; each list reads its own. */
export interface ExplorerFilters {
  /** The character can use it (mudtool's global filter). */
  usableOnly: boolean;
  /** The realm has it in the game (`onlyInGame`). */
  inGameOnly: boolean;
  query: string;
  /** Weapon or armour type by name; empty for any. */
  type: string;
  /** Armour: where it is worn; empty for anywhere. */
  slot: string;
  /** Weapons: `Speed <=`, `Str <=`; null for no limit. */
  maxSpeed: number | null;
  maxStrength: number | null;
  /** Weapons: `Magic >=`; 0 for any. */
  magic: number;
  nonMagic: boolean;
  /** Weapons: only what can backstab. */
  backstabs: boolean;
  /** Weapons: limited items shown (MME's `Limiteds`, on by default). */
  limiteds: boolean;
  /** Armour: only unlimited items (`No Limit`). */
  noLimit: boolean;
  ability: AbilityFilter;
  /** Weapons under Calc. Combat: `Dmg >=`; 0 for any. */
  minDamage: number;
  /** Spells (`FilterSpells`): Magery 0 any to 5 Kai, its Level 0 any to 3. */
  magery: number;
  mageryLevel: number;
  /** Spells: Target 0 any, 1 self to 5 room (`TARGET_GROUPS`); Attack 0 any, else `AttType` + 1. */
  target: number;
  attType: number;
  /** Spells: *Has ability*, 0 for any. */
  hasAbility: number;
  /** Spells: *Learnable Only*. */
  learnableOnly: boolean;
  /** Shops: *Show Trainers* (`LoadShops(bTrainersOnly)`). */
  trainersOnly: boolean;
  /** Monsters: the bar (`txtMonster*`, `cmbMonsterRegen`, `chkMonMagic`). */
  monster: MonsterBar;
  /** Monsters: *Extra filters* (`frmMonsterFilters`); a limit of 9999 is off. */
  extra: MonsterExtra;
}

/** The Monsters bar, mudtool's `f`. */
export interface MonsterBar {
  /** Regen `<=` (0) or `>=` (1) hours. */
  regenOp: number;
  regen: number;
  maxDamage: number;
  maxHP: number;
  minExp: number;
  magicOn: boolean;
  maxMagic: number;
}

/** `frmMonsterFilters`, mudtool's `x`: 9999 is no limit. */
export interface MonsterExtra {
  enabled: boolean;
  /** Show every monster, greying the ones that do not match. */
  showAll: boolean;
  /** 0 none, 1 copper+, 2 silver+, 3 gold+, 4 platinum+, 5 runic. */
  drops: number;
  ac: number;
  dr: number;
  mr: number;
  bsDef: number;
  gameLimit: number;
  lairExp: number;
  numLairs: number;
  mobsLTE: number;
  mobsGTE: number;
  dodge: number;
  accMaj: number;
  accMax: number;
  undead: boolean;
  nonHostileEvil: boolean;
  nonHostileNG: boolean;
  noPoison: boolean;
  noConfusion: boolean;
  noFear: boolean;
  /** Three ability filters, AND'ed: `[ability, 0 <= or 1 >=, value]`. */
  abils: Array<[number, number, number]>;
}

/** No limit, in `frmMonsterFilters`' own number. */
export const NO_LIMIT = 9999;

export const DEFAULT_MONSTER_BAR: MonsterBar = {
  regenOp: 0,
  regen: 999,
  maxDamage: 99999,
  maxHP: 99999,
  minExp: 0,
  magicOn: false,
  maxMagic: 999
};

export const DEFAULT_MONSTER_EXTRA: MonsterExtra = {
  enabled: false,
  showAll: false,
  drops: 0,
  ac: NO_LIMIT,
  dr: NO_LIMIT,
  mr: NO_LIMIT,
  bsDef: NO_LIMIT,
  gameLimit: NO_LIMIT,
  lairExp: 0,
  numLairs: 0,
  mobsLTE: NO_LIMIT,
  mobsGTE: 0,
  dodge: NO_LIMIT,
  accMaj: NO_LIMIT,
  accMax: NO_LIMIT,
  undead: false,
  nonHostileEvil: false,
  nonHostileNG: false,
  noPoison: false,
  noConfusion: false,
  noFear: false,
  abils: [
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0]
  ]
};

/**
 * `FilterMonsters` (mudtool's `tabs/monsters.js` `passes`) over a Monsters
 * row: the bar, and the extra filters where they are on. `byLair` is the mode
 * the list was asked in, which the facts were worked out for.
 */
export function passesMonster(row: ExplorerRow, f: ExplorerFilters, byLair: boolean): boolean {
  const m = row.monster;
  if (m === undefined) return false;
  const x = f.extra;
  const bar = f.monster;
  const on = x.enabled;
  if (on) {
    const [c, s, g, p, r] = m.coins;
    if (x.drops === 1 && c + s + g + p + r === 0) return false;
    if (x.drops === 5 && r < 1) return false;
    if (x.drops === 4 && p + r < 1) return false;
    if (x.drops === 3 && g + p + r < 1) return false;
    if (x.drops === 2 && s + g + p + r < 1) return false;
    if (x.ac !== NO_LIMIT && m.ac > x.ac) return false;
    if (x.dr !== NO_LIMIT && m.dr > x.dr) return false;
    if (x.mr !== NO_LIMIT && m.mr > x.mr) return false;
    if (m.bsDefense !== null && x.bsDef !== NO_LIMIT && m.bsDefense > x.bsDef) return false;
    if (x.undead && !m.undead) return false;
    if (x.nonHostileEvil && ![6, 0, 4, 3].includes(m.align)) return false;
    if (x.nonHostileNG && ![0, 4, 3].includes(m.align)) return false;
  }
  if (bar.regenOp === 0 ? m.regen > bar.regen : m.regen < bar.regen) return false;
  if (m.hp > bar.maxHP) return false;
  if (on) {
    if (m.gameLimit !== null && x.gameLimit !== NO_LIMIT && m.gameLimit > x.gameLimit) return false;
    if (m.lairExp !== null && x.lairExp > 0 && m.lairExp < x.lairExp) return false;
    if (x.numLairs > 0 && m.lairs < x.numLairs) return false;
    if (x.mobsLTE !== NO_LIMIT && (m.possy > x.mobsLTE || m.maxRegen > x.mobsLTE)) return false;
    if (x.mobsGTE > 0 && m.mobs < x.mobsGTE) return false;
    if (x.noPoison && m.poison) return false;
    if (x.noConfusion && m.confusion) return false;
    if (x.noFear && m.fear) return false;
    if (x.accMaj !== NO_LIMIT && m.accMajority > x.accMaj) return false;
    if (x.accMax !== NO_LIMIT && m.accMax > x.accMax) return false;
    for (const [abil, op, val] of x.abils) {
      if (!(abil > 0)) continue;
      const held = m.abilities.find(([a]) => a === abil);
      // `<= n` passes a monster without the ability, as MME's does.
      const ok =
        held === undefined ? op === 0 && val > 0 : op === 0 ? held[1] <= val : held[1] >= val;
      if (!ok) return false;
    }
  }
  if (bar.magicOn && m.magic > bar.maxMagic) return false;
  if (on && x.dodge !== NO_LIMIT && m.dodge > x.dodge) return false;
  if (bar.minExp > 0 && m.exp < bar.minExp) return false;
  if (bar.maxDamage > 0 && !byLair && m.damage > bar.maxDamage) return false;
  return true;
}

export const DEFAULT_FILTERS: ExplorerFilters = {
  usableOnly: true,
  inGameOnly: true,
  query: '',
  type: '',
  slot: '',
  maxSpeed: null,
  maxStrength: null,
  magic: 0,
  nonMagic: false,
  backstabs: false,
  limiteds: true,
  noLimit: false,
  ability: { abil: 0, op: 'ge', value: 0 },
  minDamage: 0,
  magery: 0,
  mageryLevel: 0,
  target: 0,
  attType: 0,
  hasAbility: 0,
  learnableOnly: false,
  trainersOnly: false,
  monster: DEFAULT_MONSTER_BAR,
  extra: DEFAULT_MONSTER_EXTRA
};

/** MME's trainer type (`ShopType` 8). */
const TRAINER = 8;

/**
 * `LoadShops(bTrainersOnly)` (mudtool's `tabs/shops.js` `passes`): every shop,
 * or only the trainers, and with the global filter only those that take the
 * character by class and level, which main has read.
 */
export function passesShop(row: ExplorerRow, f: ExplorerFilters): boolean {
  if (!f.trainersOnly) return true;
  const shop = row.shop;
  if (shop === undefined || shop.type !== TRAINER) return false;
  return !f.usableOnly || shop.trainerFits;
}

/** `spellPasses`' Target choices, each the `Targets` it keeps. */
const TARGET_GROUPS: Record<number, readonly number[]> = {
  1: [1, 2],
  2: [0, 2, 8],
  3: [4, 6, 8],
  4: [5, 10, 13],
  5: [11, 12, 9, 3]
};

/**
 * `spellPasses` (`mmud/details.js`), MME's `FilterSpells`, over a Spells row:
 * `usableOnly` is its character, whose class main has read into the facts.
 */
export function passesSpell(row: ExplorerRow, f: ExplorerFilters): boolean {
  const spell = row.spell;
  if (spell === undefined) return false;
  let skipMagery = false;
  if (f.magery > 0 && f.magery !== spell.magery) {
    if (f.usableOnly && spell.anyMagery) skipMagery = true;
    else return false;
  }
  if (!skipMagery) {
    if (f.mageryLevel > 0 && f.mageryLevel < spell.mageryLevel) return false;
    if (f.learnableOnly && spell.learnable === 0 && (f.magery !== 5 || !spell.kaiLearns))
      return false;
  }
  if (f.attType > 0 && spell.attType !== f.attType - 1) return false;
  if (f.target > 0 && !(TARGET_GROUPS[f.target] ?? []).includes(spell.targets)) return false;
  if (f.usableOnly && !(f.learnableOnly ? spell.usableLearnable : row.usable)) return false;
  if (f.hasAbility > 0 && !row.facts.abilities.some(([abil]) => abil === f.hasAbility))
    return false;
  return true;
}

/** `ItemPassesAbility` (`mmud/details.js`): the ability filter on one row. */
export function passesAbility(row: ExplorerRow, f: AbilityFilter): boolean {
  if (f.abil === 0) return true;
  if (f.abil === -1) return !(f.value > 0) || row.facts.negates.includes(f.value);
  return row.facts.abilities.some(
    ([abil, value]) => abil === f.abil && (f.op === 'le' ? value <= f.value : value >= f.value)
  );
}

/**
 * The value the Ability column shows for the filtered ability: the last slot
 * stating it, as `weaponCols` and `armourCols` read it; 0 where none does.
 */
export function abilityValue(row: ExplorerRow, abil: number): number {
  let value = 0;
  for (const [a, v] of row.facts.abilities) if (a === abil) value = v;
  return value;
}

/**
 * Whether a row stays on the list: mudtool's global filters, then the tab's
 * own `passes`. `backstabForced` is Calc. Combat's backstab attack, which
 * keeps to weapons that can.
 */
export function passes(
  row: ExplorerRow,
  kind: ExplorerKind,
  f: ExplorerFilters,
  backstabForced = false,
  /** Monsters: listed by lair, which the facts were worked out for. */
  byLair = false
): boolean {
  if (f.inGameOnly && !row.inGame) return false;
  const needle = f.query.trim().toLowerCase();
  // A spell is found by its short name too (`${Name} ${Short}`).
  const searched = row.spell === undefined ? row.name : `${row.name} ${row.spell.short}`;
  if (needle !== '' && !searched.toLowerCase().includes(needle)) return false;
  // The spell's own test reads usability itself, *Learnable Only* and all.
  if (kind === 'spells') return passesSpell(row, f);
  if (kind === 'shops') return passesShop(row, f);
  if (kind === 'monsters') return passesMonster(row, f, byLair);
  if (f.usableOnly && !row.usable) return false;
  const facts = row.facts;
  if (f.type !== '' && facts.type !== f.type) return false;
  if (!passesAbility(row, f.ability)) return false;
  // Sundry's whole bar is the ability filter (`FilterSundry`).
  if (kind === 'sundry') return true;
  if (kind === 'armour') {
    if (f.noLimit && facts.limit !== 0) return false;
    if (f.slot !== '' && facts.slot !== f.slot) return false;
    if (f.nonMagic && facts.hasMagical) return false;
    return true;
  }
  if (!f.limiteds && facts.limit !== 0) return false;
  if (f.maxSpeed !== null && f.maxSpeed < facts.speed) return false;
  if (f.maxStrength !== null && facts.strength > f.maxStrength) return false;
  if (f.magic > facts.magical && f.magic > facts.hitMagic) return false;
  if (f.nonMagic && facts.magical > 0) return false;
  if ((f.backstabs || backstabForced) && facts.backstabs !== true) return false;
  if (f.minDamage > 0 && (facts.roundTotal ?? 0) < f.minDamage) return false;
  return true;
}

/**
 * Rows in a column's order, as mudtool's list orders them (`ui/table.js`):
 * figures as figures, words in numeric collation, an empty cell last
 * whichever way round, and the realm's number between two that tie.
 */
export function orderRows(
  rows: ExplorerRow[],
  key: (row: ExplorerRow) => ExplorerCell | undefined,
  dir: 1 | -1
): ExplorerRow[] {
  return rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === y) return a.number - b.number;
    if (x === undefined || x === '') return 1;
    if (y === undefined || y === '') return -1;
    const order =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true });
    return order * dir;
  });
}
