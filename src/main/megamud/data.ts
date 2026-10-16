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
import { MonsterFlag, ItemFlag, PlayerFlag, Stance } from './flags';

/** `0x46c690`: one monster, 0x48 bytes. */
export interface MonsterRec {
  /** +0x00: the directory layer it came from. */
  layer: number;
  /** +0x01, 31 bytes (B+0x02). */
  name: string;
  /** +0x20 (B+0x00). */
  id: number;
  /** +0x24 (B+0x21, `& 0x3fffffff`): `MonsterFlag` bits. */
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
  /** B+0x51 and B+0x4f, as `sys stat room` takes them: where it lives (read from the file, `0x46c5e0`). */
  home?: [number, number];
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
  /** +0x5c (B+0x63, `& 0x38ffffff`): `ItemFlag` bits; `Loyal` also when any of B+0x79's ten words is 100. */
  flags: number;
  /** +0x60 (B+0x5b). */
  type: number;
  /** +0x61 (B+0xa3). */
  location: number;
  /** +0x64 (B+0x57). */
  min: number;
  /** +0x68 (B+0x59). */
  max: number;
  /** +0x6c (B+0x5d); -1 on an item learned in play. */
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
  /**
   * +0x2a, 41 bytes (B+0x2b): the command that casts it, when it is not cast
   * by its short name (an item's `use`, say); macros are expanded and the
   * target added (`0x40c8a0`).
   */
  item: string;
  /** +0x54 (B+0x27, `& 0x3fffefff`): `SpellFlag` bits. */
  flags: number;
  /** +0x58 (B+0x63): which magic it is (1–3 mage, 4–6 priest, 7–9 druid, 0xb kai, 10/12/13 the rest). */
  magic: number;
  /** +0x5c (B+0x54): the level it needs. */
  level: number;
  /** +0x60 (B+0x56): the mana it costs. */
  cost: number;
}

/** The five coins `0x459860` adds ahead of the file, flag `0x8000000`, layer 99. */
const COIN_NAMES = ['copper farthing', 'silver noble', 'gold crown', 'platinum piece'] as const;

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
function monsterFrom(body: Uint8Array, layer: number): MonsterRec {
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
    attackMax: i16(body, 0x32),
    home: [u16(body, 0x51), u16(body, 0x4f)]
  };
}

/** `0x459860`'s copy of one record. */
function itemFrom(body: Uint8Array, layer: number): ItemRec {
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
function spellFrom(body: Uint8Array, layer: number): SpellRec {
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
  /** +0x28 (B+0x20): its experience percentage, with the race's the level chart (`0x4a7250`). */
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
function classFrom(body: Uint8Array, layer: number): ClassRec {
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

/** `0x495990`: one race (Races.md), 0x60 bytes in memory; its id, name and experience. */
export interface RaceRec {
  /** +0x00 (B+0x00). */
  id: number;
  /** +0x02. */
  layer: number;
  /** +0x08, 31 bytes (B+0x02). */
  name: string;
  /** +0x34 (B+0x2d): its experience percentage, added to the class's for the level chart (`0x4a7250`). */
  exp: number;
}

/** `0x495990`'s copy of one record. */
function raceFrom(body: Uint8Array, layer: number): RaceRec {
  return {
    id: i16(body, 0x00),
    layer,
    name: str(body, 0x02, 0x1f),
    exp: body.length > 0x2e ? i16(body, 0x2d) : 0
  };
}

/** `0x495880`: the race of this name (exactly), if Races.md has it. */
export function findRaceByName(data: MegaData, name: string): RaceRec | null {
  return data.races?.find((r) => r.name === name) ?? null;
}

/** `0x422680`: the class of this name (exactly), if Classes.md has it. */
export function findClassByName(data: MegaData, name: string): ClassRec | null {
  return data.classes?.find((c) => c.name === name) ?? null;
}

/** `0x491870`: one known player, 0xe0 bytes (Players.md). */
export interface PlayerRec {
  /** +0x00: the layer (2 for one learned in play). */
  layer: number;
  /** +0x01, 11 bytes. */
  name: string;
  /** +0x0c, 19 bytes: the surname. */
  surname: string;
  /** +0x1f, 31 bytes: the BBS user ID (who pages come from). */
  userId: string;
  /** +0x3e, 21 bytes: the gang. */
  gang: string;
  /** +0x54: `PlayerFlag` bits. */
  flags: number;
  /** +0x58: the race. */
  race: number;
  /** +0x5c: the class. */
  cls: number;
  /** +0x60: the alignment `who` shows (1 Lawful, 2 Saint, 3 Good, 4 neutral, 5 Seedy … 9 FIEND). */
  alignment: number;
  /** +0x64: what it is to us, as a room entry's kind (3 unknown). */
  kind: number;
  /** +0x68: its level (1 until known). */
  level: number;
  /** +0x6c: the remote control it is allowed (`0x4ae4a0`): `RemoteFlag` bits (`QueryVersion` also `@home`). */
  remote: number;
  /** +0x70: its experience. */
  exp: number;
  /** +0x74: the character's own `0xd874` (its experience's high half, when it is this character). */
  f74: number;
  /** +0x78: how many sessions it has been seen in. */
  seen: number;
  /** +0x80: when it was last greeted or seen afresh. */
  greetedAt: number;
  /** +0x88: when it was last seen. */
  seenAt: number;
  /** +0x90, 0x50 bytes: where it was last seen ("Room (Exits: n, s)"). */
  where: string;
  /**
   * What a `look` at it suggested (Players.md's own record: health,
   * strength, agility, intellect, wisdom, charm), each the level a word in
   * its description stands for.
   */
  traits?: {
    health: number;
    strength: number;
    agility: number;
    intellect: number;
    wisdom: number;
    charm: number;
  };
}

/** `0x467b60`: one Messages.md row (0x128 bytes in memory). */
export interface MessageRec {
  /** +0x00 */
  layer: number;
  /** +0x01, 31 bytes: the row's name (a spell's name for a spell's message). */
  name: string;
  /** +0x20, 81 bytes: the line that starts it. */
  msg: string;
  /** +0x71, 81 bytes: the line that ends it (empty for a message with no duration). */
  endMsg: string;
  /** +0xc2, 82 bytes: the command it sends. */
  action: string;
  /** +0x114: `MessageEffect` bits. */
  effects: number;
  /** +0x116: `MessageFlag` bits. */
  flags: number;
  /** +0x118: what it makes MegaMUD do (1 look, 2 rest it off, 3 rest HP full, 4 mana full, 5 run, 6 hang up). */
  number: number;
  /** +0x120: when it started. */
  firedAt: number;
}

/** Two hex digits, as `0x4ad190` reads them (a missing digit reads as 0). */
function hexByte(text: string, at: number): [number, number] {
  let value = 0;
  let i = at;
  for (let n = 0; n < 2 && i < text.length && /[0-9A-Fa-f]/.test(text[i]!); n += 1, i += 1) {
    value = value * 16 + Number.parseInt(text[i]!, 16);
  }
  return [value, i];
}

/**
 * `0x467b60`: Messages.md, three lines a row: `name:EFFECTS:number:action`,
 * the start, the end. A row whose name and start are already known
 * replaces it.
 */
export function messagesFrom(text: string, layer = 0): MessageRec[] {
  const lines = text.split(/\r?\n/);
  const out: MessageRec[] = [];
  for (let i = 0; i < lines.length; i += 3) {
    const head = lines[i] ?? '';
    const colon = head.indexOf(':');
    const name = (colon === -1 ? head : head.slice(0, colon)).slice(0, 30).trim();
    if (name === '') break;
    let rest = colon === -1 ? '' : head.slice(colon + 1);
    let [effects, at] = hexByte(rest, 0);
    if (at < rest.length && /[0-9A-Fa-f]/.test(rest[at]!)) {
      const [low, next] = hexByte(rest, at);
      effects = ((effects << 8) | low) & 0xffff;
      at = next;
    }
    rest = rest.slice(at);
    if (rest.startsWith(':')) rest = rest.slice(1);
    const num = /^\s*(-?\d+)/.exec(rest);
    const number = num ? Number(num[1]) : 0;
    rest = rest.slice(num ? num[0].length : 0);
    if (rest.startsWith(':')) rest = rest.slice(1);
    const action = rest.split('\n')[0]!.slice(0, 0x50);
    const msg = (lines[i + 1] ?? '').slice(0, 0x50).trim();
    const endMsg = (lines[i + 2] ?? '').slice(0, 0x50).trim();
    // A row cut short is "Invalid data in MESSAGES.MD.", and reading stops.
    if (lines[i + 1] === undefined || lines[i + 2] === undefined) break;
    if (msg === '') break;
    let flags = 0;
    if (msg.includes('{')) flags |= 4;
    if (endMsg.includes('{')) flags |= 8;
    const rec: MessageRec = {
      layer,
      name,
      msg,
      endMsg,
      action,
      effects,
      flags,
      number,
      firedAt: 0
    };
    const known = out.findIndex(
      (m) => m.name.toLowerCase() === name.toLowerCase() && m.msg === msg
    );
    if (known === -1) out.push(rec);
    else out[known] = rec;
  }
  return out;
}

/** One room from Rooms.md, found by its signature (`0x4983d0`). Not read yet. */
export interface RoomRec {
  /** +0x01, 4 characters: the room's code. */
  code?: string;
  /** +0x44: the room's signature (`roomSignature`). */
  signature: number;
  /** +0x06 */
  name: string;
  /** +0x48: `RoomFlag` bits. */
  flags?: number;
  /** +0x4c, +0x50: a trainer's levels. */
  minLevel?: number;
  maxLevel?: number;
  /** +0x54: a trainer's class (0 any). */
  cls?: number;
}

/** MegaMUD's databases for one character. Records learned in play are added to them. */
export interface MegaData {
  monsters: MonsterRec[];
  items: ItemRec[];
  spells: SpellRec[];
  classes?: ClassRec[];
  races?: RaceRec[];
  players?: PlayerRec[];
  rooms?: RoomRec[];
  messages?: MessageRec[];
}

/** `0x46c220`: a new, empty monster record, added: flag 2, and `0x40000000`, which has it saved. */
export function newMonster(data: MegaData): MonsterRec {
  const rec: MonsterRec = {
    layer: 0,
    name: '',
    id: 0,
    flags: MonsterFlag.AutoLearned | MonsterFlag.Changed,
    relationship: Stance.Unknown,
    exp: 0,
    maxHp: 0,
    preSpell: '',
    attackSpell: '',
    preMax: 0,
    attackMax: 0
  };
  data.monsters.push(rec);
  return rec;
}

/** `0x4565c0`: a new, empty item record, added: flag 1, and `0x40000000`, which has it saved. */
export function newItem(data: MegaData): ItemRec {
  const rec: ItemRec = {
    id: 0,
    layer: 0,
    name: '',
    shop: '',
    ifNeeded: '',
    flags: ItemFlag.AutoLearned | ItemFlag.Changed,
    type: 0,
    location: 0,
    min: 0,
    max: 0,
    weight: 0,
    price: 0
  };
  data.items.push(rec);
  return rec;
}

/** `0x491870`: a new player record, added, as MegaMUD fills it in. */
export function newPlayer(data: MegaData, now: number): PlayerRec {
  const rec: PlayerRec = {
    layer: 2,
    name: '',
    surname: '',
    userId: '',
    gang: '',
    flags: PlayerFlag.DetailsUnknown,
    race: 0,
    cls: 0,
    alignment: 0,
    kind: Stance.Avoid,
    level: 1,
    remote: 0,
    exp: 0,
    f74: 0,
    seen: 0,
    greetedAt: 0,
    seenAt: now,
    where: ''
  };
  (data.players ??= []).push(rec);
  return rec;
}

/** Reads the `.md` files a loader would, from their bytes; a missing file is empty. */
export function readData(files: {
  monsters?: Uint8Array;
  items?: Uint8Array;
  spells?: Uint8Array;
  classes?: Uint8Array;
  races?: Uint8Array;
  runic?: string;
}): MegaData {
  return {
    classes: files.classes ? readMdb2(files.classes).map((r) => classFrom(r.body, 0)) : [],
    races: files.races ? readMdb2(files.races).map((r) => raceFrom(r.body, 0)) : [],
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

/** `0x495840`: the race with this id, if Races.md has it. */
export function findRace(data: MegaData, id: number): RaceRec | null {
  return data.races?.find((r) => r.id === (id << 16) >> 16) ?? null;
}
