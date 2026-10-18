/**
 * MMUD Explorer's filter bars and list order, as mudtool's tabs apply them
 * (`../mudtool/js/tabs/weapons.js` and `armour.js` `passes`, `ui/table.js`
 * `sortView`), over the rows main sends (`@shared/explorer`), 2026-10-18.
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
  minDamage: 0
};

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
  backstabForced = false
): boolean {
  if (f.usableOnly && !row.usable) return false;
  if (f.inGameOnly && !row.inGame) return false;
  const needle = f.query.trim().toLowerCase();
  if (needle !== '' && !row.name.toLowerCase().includes(needle)) return false;
  const facts = row.facts;
  if (f.type !== '' && facts.type !== f.type) return false;
  if (!passesAbility(row, f.ability)) return false;
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
