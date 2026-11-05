import type { CarriedItem } from '@shared/character';
import { bareName, type ItemKind } from '@shared/items';

/**
 * The pack by what it is and what it weighs (2026-11-01): the Inventory
 * card's groups, each drawn as a share of the load meter so what is heavy is
 * seen before a row is read.
 *
 * Worn is its own group whatever its kind -- the question there is what is
 * *on* -- and the rest go by what the realm says a thing is: kit that can be
 * worn or wielded, supplies that are used up or lit, and everything else.
 */
export const PACK_GROUPS = ['worn', 'kit', 'supplies', 'other'] as const;
export type PackGroup = (typeof PACK_GROUPS)[number];

const GROUP_OF_KIND: Record<ItemKind, PackGroup> = {
  armour: 'kit',
  weapon: 'kit',
  trap: 'kit',
  food: 'supplies',
  drink: 'supplies',
  light: 'supplies',
  scroll: 'supplies',
  container: 'supplies',
  key: 'other',
  sign: 'other',
  misc: 'other'
};

export function packGroupOf(item: CarriedItem): PackGroup {
  if (item.equipped) return 'worn';
  return item.kind === undefined ? 'other' : GROUP_OF_KIND[item.kind];
}

/** One row of the card: a worn thing, or every spare of one name in the pack. */
export interface PackRow {
  key: string;
  group: PackGroup;
  /** The first instance, as the listing spelled it: what a button names. */
  item: CarriedItem;
  count: number;
  /** What the row weighs together, or null where the realm cannot say. */
  weight: number | null;
}

/**
 * The rows, heaviest first within each group, unweighed last.
 *
 * A worn thing is a row of its own -- two rings on two fingers are two
 * slots -- and the spares of one name are one row with a count, which is how
 * the listing says it (`3 cudgel`) and what a single Drop acts on.
 */
export function packRows(
  items: readonly CarriedItem[],
  unitWeight: (item: CarriedItem) => number | null
): PackRow[] {
  const rows: PackRow[] = [];
  const spares = new Map<string, PackRow>();
  items.forEach((item, at) => {
    const group = packGroupOf(item);
    const count = Math.max(1, item.count ?? 1);
    const unit = unitWeight(item);
    const weight = unit === null ? null : unit * count;
    if (group === 'worn') {
      rows.push({ key: `worn:${at}`, group, item, count, weight });
      return;
    }
    const name = `${group}:${bareName(item.name)}`;
    const row = spares.get(name);
    if (row === undefined) {
      const fresh = { key: name, group, item, count, weight };
      spares.set(name, fresh);
      rows.push(fresh);
      return;
    }
    row.count += count;
    row.weight =
      row.weight === null || weight === null ? (row.weight ?? weight) : row.weight + weight;
  });
  const order = (row: PackRow): number => PACK_GROUPS.indexOf(row.group);
  return rows.sort(
    (a, b) =>
      order(a) - order(b) ||
      (b.weight ?? -1) - (a.weight ?? -1) ||
      a.item.name.localeCompare(b.item.name)
  );
}

/** What each group weighs, over the rows the realm can weigh. */
export function groupWeights(rows: readonly PackRow[]): Record<PackGroup, number> {
  const weights: Record<PackGroup, number> = { worn: 0, kit: 0, supplies: 0, other: 0 };
  for (const row of rows) weights[row.group] += row.weight ?? 0;
  return weights;
}
