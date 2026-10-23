/**
 * MegaMUD 2.1's binary databases — `Monsters.md`, `Items.md` and the rest —
 * read (roadmap step 3, 2026-09-23).
 *
 * The layout was read out of `megamud.exe` itself: the monster loader at
 * 0x46c690, the item loader at 0x459860, and the edit dialogs (324, 316 in
 * `MegaRes.dll`) that say which offset is which field. Nothing here was
 * guessed from the bytes alone; every offset below is one the loader copies.
 *
 * **The container.** The file opens `MDB2` and is a B+tree of 1 KB pages;
 * page 0 is the header and is skipped. Every other page opens with a 12-byte
 * header — level (0 is a leaf), record count, and links this reader has no
 * use for — and then holds its records back to back: a length byte (the
 * record occupies that many bytes *plus one*, which is what an earlier read
 * of it as a 16-bit word got wrong), a type byte, the key as a decimal id
 * string ending in NUL, and the body. The body opens with four zero bytes and
 * `0x80`; what the loader reads starts after them.
 *
 * Only the leaves are read. The index pages above them repeat keys and point
 * at pages, and a file whose tree is damaged still has every record on a leaf.
 */
import type { MobPriorityBand } from './config';
import { ITEM_FLAG_BITS, ITEM_FLAGS, itemKey, itemSaysAnything, type ItemRule } from './itemRules';
import { saysAnything, type MonsterRule, type Relationship } from './monsterRules';
import { mobKey } from './world';

const PAGE = 1024;
const PAGE_HEADER = 12;
/** The four zero bytes and the `0x80` before the loader's own record. */
const BODY_LEAD = 5;

/** One record as a leaf holds it: its key and the loader's bytes. */
export interface MdbRecord {
  key: string;
  body: Uint8Array;
}

/** Whether these bytes are an MDB2 file at all. */
export function isMdb2(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PAGE * 2 &&
    bytes[0] === 0x4d &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x42 &&
    bytes[3] === 0x32
  );
}

/**
 * Every leaf record, in file order. A record that would run past its page
 * ends that page's reading rather than the file's.
 */
export function readMdb2(bytes: Uint8Array): MdbRecord[] {
  if (!isMdb2(bytes)) return [];
  const out: MdbRecord[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages = Math.floor(bytes.length / PAGE);
  for (let page = 1; page < pages; page += 1) {
    const start = page * PAGE;
    const level = view.getUint16(start, true);
    const count = view.getUint16(start + 2, true);
    if (level !== 0 || count === 0) continue;
    let at = start + PAGE_HEADER;
    const end = start + PAGE;
    for (let i = 0; i < count; i += 1) {
      if (at + 2 > end) break;
      const length = bytes[at]!;
      const next = at + length + 1;
      if (length < 2 || next > end) break;
      // `at + 1` is the type byte; the key starts after it.
      const keyStart = at + 2;
      let keyEnd = keyStart;
      while (keyEnd < next && bytes[keyEnd] !== 0) keyEnd += 1;
      const key = latin1(bytes.subarray(keyStart, keyEnd));
      const body = bytes.subarray(keyEnd + 1 + BODY_LEAD, next);
      out.push({ key, body });
      at = next;
    }
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return s;
}

/** A NUL-terminated string in a fixed field. */
function field(body: Uint8Array, offset: number, size: number): string {
  const end = Math.min(body.length, offset + size);
  let stop = offset;
  while (stop < end && body[stop] !== 0) stop += 1;
  return latin1(body.subarray(offset, stop)).trim();
}

/* ------------------------------------------------------------ monsters */

/*
 * Offsets into the loader's record (0x46c690 copies each into the struct the
 * dialog edits). 211 bytes in all; everything past 0x3a is the realm's own
 * statistics, which this client already has from the realm data.
 */
const MON = {
  id: 0x00,
  name: 0x02,
  nameSize: 31,
  flags: 0x21,
  relationship: 0x25,
  preSpell: 0x26,
  attackSpell: 0x2b,
  spellSize: 5,
  preMax: 0x30,
  attackMax: 0x32
} as const;

const FIND_FIRST = 0x08;
const NO_BACKSTAB = 0x100;
const NOT_HOSTILE = 0x200;
const STOP_TO_KILL = 0x800;

/** The relationship byte, from the value table at 0x562410. */
const RELATIONSHIP: Readonly<Record<number, Relationship>> = {
  2: 'friend',
  3: 'avoid',
  4: 'enemy',
  5: 'escape',
  6: 'hangup'
};

/** The priority nibble: 0x80 First … 0x10 Last, and none for Normal. */
const PRIORITY: Readonly<Record<number, MobPriorityBand>> = {
  0x80: 'first',
  0x40: 'high',
  0x20: 'low',
  0x10: 'last'
};

/** One monster as MegaMUD's database holds it. */
export interface MegaMudMonster {
  id: number;
  name: string;
  rule: MonsterRule;
  findFirst: boolean;
}

/**
 * Every monster in a `Monsters.md`, and what MegaMUD says about each.
 *
 * `rule` states only what differs from an unlisted monster: `enemy` and
 * MegaMUD's *Unknown* are both left out, as is the Normal band.
 */
export function readMegaMudMonsters(bytes: Uint8Array): MegaMudMonster[] {
  const out: MegaMudMonster[] = [];
  for (const record of readMdb2(bytes)) {
    const body = record.body;
    if (body.length < MON.attackMax + 2) continue;
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const name = field(body, MON.name, MON.nameSize);
    const mob = mobKey(name);
    if (mob.length === 0) continue;
    const flags = view.getUint32(MON.flags, true) & 0x3fffffff;
    const rule: MonsterRule = { mob };
    const relationship = RELATIONSHIP[body[MON.relationship]!];
    if (relationship !== undefined && relationship !== 'enemy') rule.relationship = relationship;
    const priority = PRIORITY[flags & 0xf0];
    if (priority !== undefined) rule.priority = priority;
    if (flags & NOT_HOSTILE) rule.notHostile = true;
    if (flags & NO_BACKSTAB) rule.noBackstab = true;
    if (flags & STOP_TO_KILL) rule.stopToKill = true;
    const pre = field(body, MON.preSpell, MON.spellSize);
    if (pre.length > 0) rule.preAttack = { spell: pre, max: castCount(view, MON.preMax) };
    const attack = field(body, MON.attackSpell, MON.spellSize);
    if (attack.length > 0) rule.attack = { spell: attack, max: castCount(view, MON.attackMax) };
    out.push({
      id: view.getUint16(MON.id, true),
      name,
      rule,
      findFirst: (flags & FIND_FIRST) !== 0
    });
  }
  return out;
}

function castCount(view: DataView, offset: number): number {
  const value = view.getInt16(offset, true);
  return value > 0 ? value : 0;
}

/* ------------------------------------------------------------ items */

/*
 * Offsets into the loader's record (0x459860), as dialog 316 edits them. The
 * rest of the record — type, weight, price, body location, the abilities that
 * make an item loyal — is the realm's own data, which this client has.
 */
const ITEM = {
  id: 0x00,
  name: 0x02,
  nameSize: 31,
  shop: 0x20,
  shopSize: 41,
  ifNeeded: 0x49,
  ifNeededSize: 14,
  min: 0x57,
  max: 0x59,
  flags: 0x63
} as const;

/** One item as MegaMUD's database holds it: its id, name and what was chosen for it. */
export interface MegaMudItem {
  id: number;
  name: string;
  rule: ItemRule;
}

/**
 * Every item in an `Items.md`, and what MegaMUD was told about each. `rule`
 * states only the choices that are on and the fields that are filled.
 */
export function readMegaMudItems(bytes: Uint8Array): MegaMudItem[] {
  const out: MegaMudItem[] = [];
  for (const record of readMdb2(bytes)) {
    const body = record.body;
    if (body.length < ITEM.flags + 4) continue;
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const name = field(body, ITEM.name, ITEM.nameSize);
    const item = itemKey(name);
    if (item.length === 0) continue;
    const flags = view.getUint32(ITEM.flags, true) & 0x38ffffff;
    const rule: ItemRule = { item };
    for (const flag of ITEM_FLAGS) if (flags & ITEM_FLAG_BITS[flag]) rule[flag] = true;
    const keep = view.getInt16(ITEM.min, true);
    if (keep > 0) rule.keep = keep;
    const most = view.getInt16(ITEM.max, true);
    if (most > 0) rule.most = most;
    const ifNeeded = field(body, ITEM.ifNeeded, ITEM.ifNeededSize);
    if (ifNeeded.length > 0) rule.ifNeeded = ifNeeded;
    const shop = field(body, ITEM.shop, ITEM.shopSize);
    if (shop.length > 0) rule.shop = shop;
    out.push({ id: view.getUint16(ITEM.id, true), name, rule });
  }
  return out;
}

/* ------------------------------------------------------------ table rows */

/** What a MegaMUD database yields for a realm's table: its rows, and how many records it named. */
export interface DatabaseRows<Row> {
  rows: Row[];
  read: number;
}

/**
 * The rows a decoded database gives a realm's table: one per name, the first
 * kept, and only those that say something. MegaMUD's own database holds
 * several records of one name (`dark priest` twice, `Nahr` five times) and a
 * row is keyed by the name.
 */
function distinctRows<Row>(
  records: readonly { rule: Row }[],
  key: (row: Row) => string,
  says: (row: Row) => boolean
): DatabaseRows<Row> {
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const { rule } of records) {
    if (!says(rule) || seen.has(key(rule))) continue;
    seen.add(key(rule));
    rows.push(rule);
  }
  return { rows, read: records.length };
}

/** A `Monsters.md`'s rows for a realm's monster table. */
export function monsterTableRows(bytes: Uint8Array): DatabaseRows<MonsterRule> {
  return distinctRows(readMegaMudMonsters(bytes), (row) => row.mob, saysAnything);
}

/**
 * An `Items.md`'s rows for a realm's item table, without *Bought/sold*: what
 * MegaMUD holds there is a room of its own room list (`General Store
 * (Giovanni)`), which names one of the realm's shops for 203 of the 1,493
 * items Skinny's file filled (2026-10-13). An item is sold at the realm's
 * own shop for it unless the player names another.
 */
export function itemTableRows(bytes: Uint8Array): DatabaseRows<ItemRule> {
  const records = readMegaMudItems(bytes).map((record) => {
    const { shop: _shop, ...rule } = record.rule;
    return { rule };
  });
  return distinctRows(records, (row) => row.item, itemSaysAnything);
}
