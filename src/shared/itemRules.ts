/**
 * What a player has said about particular items — MegaMUD's *Game Item
 * Details* (dialog 316, read 2026-10-13), the choices half of `Items.md`.
 *
 * The facts that dialog also shows (weight, price, item type, body location,
 * loyal) are the realm's, and come from its own data. What is left is what a
 * player decides, and it composes as the monster table does
 * (`shared/monsterRules.ts`): a realm's table imported once from MegaMUD's
 * `Items.md` (`servers/<id>/items.yaml`, `RealmTableStore`) that every
 * character playing there gets, and a character's own rows
 * (`automation.loot.items`) laid over it **field by field**.
 *
 * The fields, with the dialog's words and the record's flag (`0x459860`):
 *
 * - **collect** — *Auto-collect* (`0x2`): picked up when seen.
 * - **discard** — *Auto-discard* (`0x800`): dropped when carried.
 * - **equip** — *Auto-equip* (`0x10`): worn or wielded when carried.
 * - **find** — *Auto-find* (`0x20`): searched for where it is hidden.
 * - **open** — *Auto-open* (`0x1000`).
 * - **buy** — *Auto-buy* (`0x4`), up to `keep`, at `shop`.
 * - **sell** — *Auto-sell (or stash)* (`0x8`), at `shop`.
 * - **cannotTake** — *Cannot be taken* (`0x40`): never tried.
 * - **backstab** — *Can use to backstab* (`0x200`).
 * - **mustHaveMin** — *Must have minimum* (`0x400`): `keep` is needed to go on.
 * - **keep** — *Min. to keep*; **most** — *Max to get*.
 * - **ifNeeded** — *If needed, do*: the path walked to get it.
 * - **shop** — *Bought/sold*: the shop it is bought at or sold to.
 */
import { isRecord } from './values';

export const ITEM_FLAGS = [
  'collect',
  'discard',
  'equip',
  'find',
  'open',
  'buy',
  'sell',
  'cannotTake',
  'backstab',
  'mustHaveMin'
] as const;
export type ItemFlag = (typeof ITEM_FLAGS)[number];

/** Each choice's bit in MegaMUD's item record (`0x459860`). */
export const ITEM_FLAG_BITS: Readonly<Record<ItemFlag, number>> = {
  collect: 0x2,
  buy: 0x4,
  sell: 0x8,
  equip: 0x10,
  find: 0x20,
  cannotTake: 0x40,
  backstab: 0x200,
  mustHaveMin: 0x400,
  discard: 0x800,
  open: 0x1000
};

export interface ItemRule extends Partial<Record<ItemFlag, boolean>> {
  /** The item, keyed the way `itemKey` keys a name. */
  item: string;
  /** *Min. to keep*. */
  keep?: number;
  /** *Max to get*. */
  most?: number;
  /** *If needed, do*: the path that gets it. */
  ifNeeded?: string;
  /** *Bought/sold*: the shop. */
  shop?: string;
}

/** A realm's imported table, as `servers/<id>/items.yaml` holds it. */
export interface ItemTable {
  source: { file: string; importedAt: string } | null;
  items: ItemRule[];
}

export const EMPTY_ITEM_TABLE: ItemTable = { source: null, items: [] };

/** What an import read, or why it wrote nothing. */
export type ItemImport = { ok: true; count: number } | { ok: false; error: string };

/** An item's name as rows are keyed: MegaMUD finds items without regard to case. */
export function itemKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ------------------------------------------------------------ reading */

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * One row from whatever the file or the wire held, or null for one with no
 * item. Forgiving per field: a field of the wrong kind is dropped, not the row.
 */
export function asItemRule(value: unknown): ItemRule | null {
  if (!isRecord(value)) return null;
  const item = typeof value['item'] === 'string' ? itemKey(value['item']) : '';
  if (item.length === 0) return null;
  const rule: ItemRule = { item };
  for (const flag of ITEM_FLAGS) {
    const on = value[flag];
    if (typeof on === 'boolean') rule[flag] = on;
  }
  const keep = count(value['keep']);
  if (keep !== undefined) rule.keep = keep;
  const most = count(value['most']);
  if (most !== undefined) rule.most = most;
  const ifNeeded = text(value['ifNeeded']);
  if (ifNeeded !== undefined) rule.ifNeeded = ifNeeded;
  const shop = text(value['shop']);
  if (shop !== undefined) rule.shop = shop;
  return rule;
}

/** A list of rows, one per item: a later row for the same item is dropped. */
export function asItemRules(value: unknown): ItemRule[] {
  if (!Array.isArray(value)) return [];
  const out: ItemRule[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const rule = asItemRule(entry);
    if (rule === null || seen.has(rule.item)) continue;
    seen.add(rule.item);
    out.push(rule);
  }
  return out;
}

export function asItemTable(value: unknown): ItemTable {
  if (!isRecord(value)) return EMPTY_ITEM_TABLE;
  const rawSource = value['source'];
  const source =
    isRecord(rawSource) &&
    typeof rawSource['file'] === 'string' &&
    typeof rawSource['importedAt'] === 'string'
      ? { file: rawSource['file'], importedAt: rawSource['importedAt'] }
      : null;
  return { source, items: asItemRules(value['items']) };
}

/** Whether a row says anything at all beyond naming an item. */
export function itemSaysAnything(rule: ItemRule): boolean {
  return Object.keys(rule).some((key) => key !== 'item');
}

/** A row as the file holds it: the fields in a fixed order. */
export function itemRuleForFile(rule: ItemRule): Record<string, unknown> {
  const row: Record<string, unknown> = { item: rule.item };
  for (const flag of ITEM_FLAGS) if (rule[flag] !== undefined) row[flag] = rule[flag];
  if (rule.keep !== undefined) row['keep'] = rule.keep;
  if (rule.most !== undefined) row['most'] = rule.most;
  if (rule.ifNeeded !== undefined) row['ifNeeded'] = rule.ifNeeded;
  if (rule.shop !== undefined) row['shop'] = rule.shop;
  return row;
}

/* ------------------------------------------------------------ merging */

/**
 * Rows from broadest scope to narrowest, laid over each other field by field,
 * as `mergeMonsterRules` does: a character's row that only says *sell* keeps
 * the realm's shop.
 */
export function mergeItemRules(...scopes: readonly (readonly ItemRule[])[]): ItemRule[] {
  const merged = new Map<string, ItemRule>();
  for (const scope of scopes) {
    for (const row of scope) {
      const item = itemKey(row.item);
      if (item.length === 0) continue;
      merged.set(item, { ...merged.get(item), ...row, item });
    }
  }
  return [...merged.values()];
}
