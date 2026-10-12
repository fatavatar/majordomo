/**
 * MegaMUD's databases as its code holds them in memory: the records the
 * loaders build from each `.md` file (read 2026-10-12), with the field each
 * one copies and from where. The file layout is `shared/megamudDb.ts`'s
 * `readMdb2`; the offsets below are into a record's body, which is where the
 * loaders start reading ("B" in docs/megamud/megamud-exe.md).
 *
 * MegaMUD reads each file from up to four directories (`0x43bfa0`), the
 * highest layer first; a record from a lower layer replaces one already read
 * unless that one's flags have their top bit set. A character here has one
 * MegaMUD data folder, read as layer 0.
 */
import { readMdb2 } from '../../shared/megamudDb';

/** `0x46c690`: one monster, 0x48 bytes. */
export interface MonsterRec {
  /** +0x00: the directory layer it came from. */
  layer: number;
  /** +0x01, 31 bytes (B+0x02). */
  name: string;
  /** +0x20 (B+0x00). */
  id: number;
  /** +0x24 (B+0x21, `& 0x3fffffff`). */
  flags: number;
  /** +0x28 (B+0x25): 0 unknown, 2 friend, 3 avoid, 4 enemy, 5 flee, 6 hang up. */
  relationship: number;
  /** +0x2c: B+0x94, or B+0x37 when that is 0 and B+0x37 is not. */
  exp: number;
  /** +0x30 (B+0x39). */
  maxHp: number;
  /** +0x34, 5 bytes (B+0x26). */
  preSpell: string;
  /** +0x39, 5 bytes (B+0x2b). */
  attackSpell: string;
  /** +0x40 (B+0x30). */
  preMax: number;
  /** +0x44 (B+0x32). */
  attackMax: number;
}

/** `0x459860`: one item, 0x78 bytes. */
export interface ItemRec {
  /** +0x00 (B+0x00). */
  id: number;
  /** +0x02. */
  layer: number;
  /** +0x03, 31 bytes (B+0x02). */
  name: string;
  /** +0x22, 41 bytes (B+0x20). */
  shop: string;
  /** +0x4b, 14 bytes (B+0x49): the "if needed" path. */
  ifNeeded: string;
  /** +0x5c (B+0x63, `& 0x38ffffff`); `0x20000` (loyal) also when any of B+0x79's ten words is 100. */
  flags: number;
  /** +0x60 (B+0x5b). */
  type: number;
  /** +0x61 (B+0xa3). */
  location: number;
  /** +0x64 (B+0x57). */
  min: number;
  /** +0x68 (B+0x59). */
  max: number;
  /** +0x6c (B+0x5d). */
  weight: number;
  /** +0x70 (B+0x5f). */
  price: number;
}

/** `0x4a2990`: one spell, 100 bytes. */
export interface SpellRec {
  /** +0x00. */
  layer: number;
  /** +0x02 (B+0x00). */
  id: number;
  /** +0x04, 7 bytes (B+0x20): what is typed to cast it. */
  short: string;
  /** +0x0b, 31 bytes (B+0x02). */
  name: string;
  /** +0x2a, 41 bytes (B+0x2b): the item it needs worn. */
  item: string;
  /** +0x54 (B+0x27, `& 0x3fffefff`). */
  flags: number;
  /** +0x58 (B+0x63): which magic it is (1–3 mage, 4–6 priest, 7–9 druid, 0xb kai, 10/12/13 the rest). */
  magic: number;
  /** +0x5c (B+0x54): the level it needs. */
  level: number;
  /** +0x60 (B+0x56): the mana it costs. */
  cost: number;
}

/** The five coins `0x459860` adds ahead of the file, flag `0x8000000`, layer 99. */
export const COIN_NAMES = [
  'copper farthing',
  'silver noble',
  'gold crown',
  'platinum piece'
] as const;

function str(body: Uint8Array, offset: number, size: number): string {
  let s = '';
  for (let i = offset; i < offset + size - 1 && i < body.length; i += 1) {
    const c = body[i]!;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function view(body: Uint8Array): DataView {
  return new DataView(body.buffer, body.byteOffset, body.byteLength);
}

function u16(body: Uint8Array, at: number): number {
  return at + 2 <= body.length ? view(body).getUint16(at, true) : 0;
}

function i16(body: Uint8Array, at: number): number {
  return at + 2 <= body.length ? view(body).getInt16(at, true) : 0;
}

function u32(body: Uint8Array, at: number): number {
  return at + 4 <= body.length ? view(body).getUint32(at, true) : 0;
}

function u8(body: Uint8Array, at: number): number {
  return at < body.length ? body[at]! : 0;
}

/** `0x46c690`'s copy of one record. */
export function monsterFrom(body: Uint8Array, layer: number): MonsterRec {
  const exp32 = u32(body, 0x94);
  const exp16 = u16(body, 0x37);
  return {
    layer,
    name: str(body, 0x02, 0x1f),
    id: u16(body, 0x00),
    flags: u32(body, 0x21) & 0x3fffffff,
    relationship: u8(body, 0x25),
    exp: exp16 !== 0 && exp32 === 0 ? exp16 : exp32,
    maxHp: i16(body, 0x39),
    preSpell: str(body, 0x26, 5),
    attackSpell: str(body, 0x2b, 5),
    preMax: i16(body, 0x30),
    attackMax: i16(body, 0x32)
  };
}

/** `0x459860`'s copy of one record. */
export function itemFrom(body: Uint8Array, layer: number): ItemRec {
  let flags = u32(body, 0x63) & 0x38ffffff;
  for (let i = 0; i < 10; i += 1) {
    if (i16(body, 0x79 + i * 2) === 100) flags |= 0x20000;
  }
  return {
    id: u16(body, 0x00),
    layer,
    name: str(body, 0x02, 0x1f),
    shop: str(body, 0x20, 0x29),
    ifNeeded: str(body, 0x49, 0xe),
    flags,
    type: u8(body, 0x5b),
    location: u8(body, 0xa3),
    min: i16(body, 0x57),
    max: i16(body, 0x59),
    weight: i16(body, 0x5d),
    price: u32(body, 0x5f)
  };
}

/** `0x4a2990`'s copy of one record. */
export function spellFrom(body: Uint8Array, layer: number): SpellRec {
  return {
    layer,
    id: u16(body, 0x00),
    short: str(body, 0x20, 7),
    name: str(body, 0x02, 0x1f),
    item: str(body, 0x2b, 0x29),
    flags: u32(body, 0x27) & 0x3fffefff,
    magic: u8(body, 0x63),
    level: u8(body, 0x54),
    cost: i16(body, 0x56)
  };
}

/** The coin pseudo-items, then the file's items. */
export function coinItems(runic: string): ItemRec[] {
  return [...COIN_NAMES, runic].map((name) => ({
    id: 0,
    layer: 99,
    name: name.slice(0, 30),
    shop: '',
    ifNeeded: '',
    flags: 0x8000000,
    type: 0,
    location: 0,
    min: 0,
    max: 0,
    weight: 0,
    price: 0
  }));
}

/** `0x422790`: one class (Classes.md). */
export interface ClassRec {
  /** +0x00 (B+0x00). */
  id: number;
  /** +0x02. */
  layer: number;
  /** +0x08, 31 bytes (B+0x02). */
  name: string;
  /** +0x28 (B+0x20). */
  f28: number;
  /** +0x2a–0x2e (B+0x22–0x26). */
  bytes: [number, number, number, number, number];
  /** +0x30 (B+0x27): magic, the type in the high byte (5 is kai) and the level in the low. */
  magic: number;
  /** +0x32, ten words (B+0x29). */
  abilities: number[];
  /** +0x46, ten words (B+0x3d). */
  values: number[];
}

/** `0x422790`'s copy of one record. */
export function classFrom(body: Uint8Array, layer: number): ClassRec {
  const abilities: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    abilities.push(i16(body, 0x29 + i * 2));
    values.push(i16(body, 0x3d + i * 2));
  }
  return {
    id: i16(body, 0x00),
    layer,
    name: str(body, 0x02, 0x1f),
    f28: i16(body, 0x20),
    bytes: [u8(body, 0x22), u8(body, 0x23), u8(body, 0x24), u8(body, 0x25), u8(body, 0x26)],
    magic: u16(body, 0x27),
    abilities,
    values
  };
}

/** MegaMUD's databases for one character. */
export interface MegaData {
  monsters: MonsterRec[];
  items: ItemRec[];
  spells: SpellRec[];
  classes?: ClassRec[];
}

/** Reads the `.md` files a loader would, from their bytes; a missing file is empty. */
export function readData(files: {
  monsters?: Uint8Array;
  items?: Uint8Array;
  spells?: Uint8Array;
  classes?: Uint8Array;
  runic?: string;
}): MegaData {
  return {
    classes: files.classes ? readMdb2(files.classes).map((r) => classFrom(r.body, 0)) : [],
    monsters: files.monsters ? readMdb2(files.monsters).map((r) => monsterFrom(r.body, 0)) : [],
    items: [
      ...coinItems(files.runic ?? 'runic coin'),
      ...(files.items ? readMdb2(files.items).map((r) => itemFrom(r.body, 0)) : [])
    ],
    spells: files.spells ? readMdb2(files.spells).map((r) => spellFrom(r.body, 0)) : []
  };
}

/** `0x422640`: the class with this id, if Classes.md has it. */
export function findClass(data: MegaData, id: number): ClassRec | null {
  return data.classes?.find((c) => c.id === (id << 16) >> 16) ?? null;
}

/** A class's magic type, the high byte of `+0x30` (5 is kai), or null for an unknown class. */
export function classMagic(data: MegaData, id: number): number | null {
  const rec = findClass(data, id);
  return rec ? rec.magic >> 8 : null;
}
