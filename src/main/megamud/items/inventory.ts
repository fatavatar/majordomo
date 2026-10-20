/**
 * The inventory (`0x455230`), read 2026-10-12: `You are carrying …` (and
 * `You have …` for coins alone), item by item to the line's end, then the
 * keys, `Wealth:` and `Encumbrance:`. Each item is counted into the
 * inventory list (`0x8420`), learned when unknown, and marked equipped when
 * it names a wear slot (`(Head)`, `(Weapon Hand)`); the weapon wielded
 * becomes the normal weapon when none is set. An item flagged to drop is
 * dropped. The listing state is `State.Inventory`; `LineFlag.InventoryItems`,
 * `InventoryKeys` and `InventoryTotals` say which part is being read.
 */
import { atoi, indexFrom, indexOf, leadingNumber, trimSpaces } from '../cstr';
import { findClass, newItem } from '../data';
import { coinValue, findItem } from '../room/checkNames';
import { corpseOrLootbox } from '../room/notice';
import { hangUp } from '../script/game';
import { queueCommand } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import type { Carried, Session } from '../Session';
import { State } from '../states';
import { LineFlag, INVENTORY_LISTING, PROMPT_SEEN, ItemFlag, CarriedFlag } from '../flags';
import { carriedOff, itemsCollected } from '../stats/window';

/** The wear slots an item's `(…)` names (the table at `0x562580`), from 2 up. */
const SLOTS: [number, string][] = [
  [2, 'Head'],
  [3, 'Hands'],
  [4, 'Finger'],
  [5, 'Feet'],
  [6, 'Arms'],
  [7, 'Back'],
  [8, 'Neck'],
  [9, 'Legs'],
  [10, 'Waist'],
  [11, 'Torso'],
  [12, 'Shield'],
  [14, 'Wrist'],
  [15, 'Ears'],
  [16, 'Worn'],
  [17, 'Eyes'],
  [18, 'Face']
];

/** `0x4ad760`: every `quote` dropped (one after another, the second is kept). */
function dropChar(text: string, quote: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === quote) {
      if (i + 1 < text.length) out += text[i + 1];
      i += 1;
      continue;
    }
    out += text[i];
  }
  return out;
}

/**
 * `0x45a100`: two item names are the same, apostrophes aside, or one is the
 * other with an `s` added.
 */
export function sameItemName(a: string, b: string): boolean {
  const x = dropChar(a.slice(0, 99), "'");
  const y = dropChar(b.slice(0, 99), "'");
  if (x === y) return true;
  if (x.length === y.length + 1 && x.endsWith('s') && x.startsWith(y)) return true;
  return x.length + 1 === y.length && y.endsWith('s') && y.startsWith(x);
}

const BOATS = ['log raft', 'silverbark canoe'];

/** `0x4530c0`: the inventory line for `name` (asking for a wooden skiff, any boat will do). */
export function findCarried(s: Session, name: string): Carried | null {
  for (const c of s.inventory) {
    const item = c.item;
    if (!item) continue;
    if (sameItemName(item.name, name)) return c;
    if (name === 'wooden skiff' && BOATS.some((b) => sameItemName(item.name, b))) return c;
  }
  return null;
}

/** `0x4534b0`/`0x453500`: the coins' weight (three to the pound; GreaterMUD counts them all together). */
export function coinWeight(s: Session): number {
  let all = 0;
  let each = 0;
  for (const c of s.inventory) {
    if (c.item && (c.item.flags & ItemFlag.Coin) !== 0) {
      all += c.count;
      each += Math.trunc(c.count / 3);
    }
  }
  return s.BBS_GreaterMUD !== 0 ? Math.trunc(all / 3) : each;
}

/**
 * `0x453600`: what the inventory weighs as far as is known (the coins, and
 * every item of known weight), and the first item of unknown weight and how
 * many such are carried. Null when a line has no item record.
 */
function weighInventory(
  s: Session
): { weight: number; unknown: Carried | null; unknownCount: number } | null {
  let known = 0;
  let unknown: Carried | null = null;
  let unknownCount = 0;
  for (const c of s.inventory) {
    const item = c.item;
    if (!item) return null;
    if ((item.flags & ItemFlag.Coin) !== 0) continue;
    if (item.weight < 0) {
      unknownCount += c.count;
      unknown ??= c;
    } else {
      known += item.weight * c.count;
    }
  }
  return { weight: coinWeight(s) + known, unknown, unknownCount };
}

/**
 * `0x452e00`: with a weight check asked for, the one item of unknown weight
 * carried singly is weighed: the encumbrance less the rest.
 */
function weighUnknown(s: Session): void {
  if (s.weighPending === 0) return;
  s.weighPending = 0;
  const w = weighInventory(s);
  if (!w || !w.unknown || w.unknownCount !== 1 || w.unknown.count === 0 || !w.unknown.item) return;
  const weight = s.weightCarried - w.weight;
  if (weight < 0) return;
  w.unknown.item.weight = weight;
  w.unknown.item.flags |= ItemFlag.Changed;
  s.itemsChanged = 1;
  s.host.show(`[${w.unknown.item.name} weight calculated as ${weight}]`);
}

/** `0x4534b0`: how many coins are carried. */
export function coinCount(s: Session): number {
  return s.inventory.reduce(
    (n, x) => (x.item && (x.item.flags & ItemFlag.Coin) !== 0 ? n + x.count : n),
    0
  );
}

/** `0x453580`: the weight `count` more of a coin stack adds (three coins to the pound). */
export function coinWeightAdded(s: Session, c: Carried | null, count: number): number {
  if (count < 0 && c && c.count < -count) count = -c.count;
  const before = s.BBS_GreaterMUD !== 0 ? coinCount(s) : (c?.count ?? 0);
  const after = Math.max(0, before + count);
  return Math.trunc(after / 3) - Math.trunc(before / 3);
}

/**
 * `0x4532d0`: `count` of `name` picked up (or given): carried, learned if
 * unknown, and the encumbrance and wealth adjusted. When the weights were
 * all known and added up before, and one unknown is now carried singly,
 * the next inventory weighs it (`0x4561e0`).
 */
export function carryMore(s: Session, name: string, count: number): number {
  const before = weighInventory(s);
  const exact = !!before && before.unknownCount === 0 && before.weight === s.weightCarried;
  if (corpseOrLootbox(name) !== 0) return 1;
  let item = findItem(s, name);
  if (!item) {
    item = newItem(s.data);
    item.name = name.slice(0, 30);
    item.flags |= ItemFlag.Changed | ItemFlag.AutoLearned;
    item.weight = -1;
    s.itemsChanged = 1;
    s.host.show(`[${name} added to known items]`);
  }
  let c = findCarried(s, name);
  if (!c) {
    c = { count: 0, flags: 0, item };
    s.inventory.push(c);
  }
  if ((item.flags & ItemFlag.Coin) === 0) {
    s.weightCarried += item.weight * count;
    itemsCollected(s, count);
  } else {
    s.weightCarried += coinWeightAdded(s, c, count);
  }
  c.count += count;
  const after = weighInventory(s);
  if (!after || after.unknownCount !== 1) {
    s.weighPending = 0;
  } else if (exact) {
    s.weighPending = 1;
    s.weightMax = 0;
  }
  return 1;
}

/** `0x452cb0`: the wealth carried, in copper. */
export function wealthCarried(s: Session): void {
  s.wealth = 0;
  for (const c of s.inventory) {
    if (c.item && (c.item.flags & ItemFlag.Coin) !== 0)
      s.wealth += coinValue(s, c.item.name) * c.count;
  }
}

/** `0x452d40`: carrying nothing but coins and keepsakes (and no wealth): died, with `HangupNaked`. */
function nakedCheck(s: Session): number {
  if (s.wealth !== 0) return 0;
  for (const c of s.inventory) if (c.item && (c.item.flags & ItemFlag.Loyal) === 0) return 0;
  if (s.walking !== 0 && s.allOff === 0 && s.Other_HangupNaked !== 0 && s.MegaMud_NoHangup === 0) {
    s.lineFlags &= ~(LineFlag.Prompted | LineFlag.InventoryKeys | LineFlag.InventoryTotals);
    s.host.trace('[Naked! - Must have died!]');
    s.skipRedialOnce = 1;
    s.noRedial = 1;
    s.walking = 0;
    hangUp(s, 1);
  }
  return 1;
}

/** The listing is over: weigh, settle the state, check for nakedness. */
function listingDone(s: Session): void {
  s.lineFlags &= ~INVENTORY_LISTING;
  weighUnknown(s);
  forgetAwaited(s, State.Inventory);
  setState(s, State.Nothing);
}

/** `0x452ec0`'s use in `0x4531b0`: the coins are listed again. */
function dropCoins(s: Session): void {
  s.inventory = s.inventory.filter((c) => !(c.item && (c.item.flags & ItemFlag.Coin) !== 0));
}

/** Where an item's `(…)` puts it: a wear slot, 12 the off hand, -2 the weapon hand, -1 none. */
function slotOf(tail: string): number {
  let slot = SLOTS.find(([, name]) => tail.startsWith(name))?.[0] ?? -1;
  if (tail.startsWith('Offhand') || tail.startsWith('Off-Hand')) slot = 12;
  if (tail.startsWith('Weapon')) slot = -2;
  return slot;
}

/** The weapon in hand: remembered, and the normal weapon when none is set (not for a kai fighting bare). */
function wielding(s: Session, name: string): void {
  s.weaponWielded = name.slice(0, 30);
  if (s.Combat_NrmWeapon !== '') return;
  const cls = findClass(s.data, s.Player_Class);
  if (cls && cls.magic >> 8 === 5 && cls.bytes[3] === 9) return;
  s.Combat_NrmWeapon = name.slice(0, 30);
}

/** One item of the listing, counted in. 1 to stop the line here. */
function carry(s: Session, piece: string): number {
  let slot = -1;
  const paren = indexOf(piece, ' (');
  if (paren !== -1) {
    slot = slotOf(piece.slice(paren + 2));
    piece = trimSpaces(piece.slice(0, paren));
  }
  let count = 1;
  let name = piece;
  if (/[0-9]/.test(piece[0] ?? '')) {
    const [n, end] = leadingNumber(piece);
    count = n;
    name = piece.slice(end).replace(/^ +/, '');
  }
  if (
    name.startsWith('i ') ||
    name.startsWith('who ') ||
    name.startsWith('stat ') ||
    name.startsWith('exp ') ||
    !/[A-Za-z]/.test(name[0] ?? '')
  ) {
    s.host.show('[Inventory interrupted]');
    listingDone(s);
    s.weightMax = 0;
    return 1;
  }
  if (corpseOrLootbox(name) !== 0) return 0;
  let c = findCarried(s, name);
  if (!c) {
    c = { count: 0, flags: 0, item: null };
    s.inventory.push(c);
  }
  if (!c.item) {
    c.item = findItem(s, name);
    if (!c.item) {
      const item = newItem(s.data);
      let learned = name;
      if (count > 1 && learned.length > 1 && learned.endsWith('s')) learned = learned.slice(0, -1);
      item.name = learned.slice(0, 30);
      item.flags |= ItemFlag.Changed | ItemFlag.AutoLearned;
      item.weight = -1;
      c.item = item;
      s.itemsChanged = 1;
      s.host.show(`[${item.name} added to known items]`);
    }
  }
  const item = c.item;
  c.count += count;
  if (item.name === s.itemPickingUp) s.itemPickingUp = '';
  if (slot !== -1) {
    c.flags |= CarriedFlag.Equipped;
    if (item.location === 0) {
      if (slot === -2) {
        item.type = 1;
        item.flags |= ItemFlag.Changed;
        s.itemsChanged = 1;
        wielding(s, item.name);
      } else {
        item.location = slot;
        item.type = 0;
        item.flags |= ItemFlag.Changed;
        s.itemsChanged = 1;
      }
    } else if (slot === -2) {
      wielding(s, item.name);
    }
  }
  if ((item.flags & ItemFlag.Discard) !== 0 && s.allOff === 0) {
    queueCommand(s, `drop ${item.name}\r`, 1, 0, 0);
  }
  return 0;
}

/**
 * `0x455230`. `last`: the line is the listing's last (the keys or totals
 * follow), so a piece without a separator is an item, not the start of one.
 */
export function inventoryLine(s: Session, line: string, last: number): number {
  if (s.inGame === 0) return 0;
  let at: number;
  let joining = false;
  if ((s.lineFlags & INVENTORY_LISTING) === 0) {
    let skip = 0x11;
    at = indexOf(line, 'You are carrying ');
    if (at === -1) {
      at = indexOf(line, 'You have ');
      if (at === -1 || indexFrom(line, at, ' lives ') !== -1) return 0;
      const rest = line.slice(at + 9);
      if (rest !== 'No money!' && !(rest[0]! >= '1' && rest[0]! <= '9')) return 0;
      skip = 9;
    }
    s.lineFlags =
      (s.lineFlags & ~(PROMPT_SEEN | LineFlag.InventoryKeys | LineFlag.InventoryTotals)) |
      LineFlag.InventoryItems;
    setState(s, State.Inventory);
    s.inventoryStartedAt = s.host.tickMs();
    s.listingRest = '';
    if (skip === 0x11) {
      s.weaponWielded = '';
      s.inventory = [];
    } else {
      dropCoins(s);
    }
    at += skip;
  } else {
    s.inventoryQuietAt = s.host.tickMs();
    if ((s.lineFlags & PROMPT_SEEN) !== 0) {
      listingDone(s);
      nakedCheck(s);
      return 0;
    }
    at = 0;
    joining = true;
    if ((s.lineFlags & LineFlag.InventoryItems) !== 0) {
      if (indexOf(line, 'You have no keys.') !== -1) {
        inventoryLine(s, '', 1);
        s.lineFlags =
          (s.lineFlags & ~(LineFlag.InventoryItems | LineFlag.InventoryKeys)) |
          LineFlag.InventoryTotals;
        setState(s, State.Inventory);
        return 1;
      }
      const keys = indexOf(line, 'You have the following keys: ');
      if (keys !== -1) {
        inventoryLine(s, '', 1);
        s.lineFlags =
          (s.lineFlags & ~(LineFlag.InventoryItems | LineFlag.InventoryTotals)) |
          LineFlag.InventoryKeys;
        setState(s, State.Inventory);
        at = keys + 0x1d;
        s.listingRest = '';
      }
    }
    const wealth = indexOf(line, 'Wealth: ');
    if (wealth !== -1) {
      s.wealth = atoi(
        line
          .slice(wealth + 8)
          .replace(/^ +/, '')
          .replace(/[^0-9].*$/, '')
      );
      s.lineFlags =
        (s.lineFlags & ~(LineFlag.InventoryItems | LineFlag.InventoryKeys)) |
        LineFlag.InventoryTotals;
      return 1;
    }
    let enc = indexOf(line, 'Encumberance: ');
    if (enc === -1) enc = indexOf(line, 'Encumbrance: ');
    if (enc !== -1) {
      const after = line.slice(line.indexOf(':', enc) + 1);
      const [now, end] = leadingNumber(after);
      s.weightCarried = now;
      let rest = after.slice(end);
      if (rest.startsWith('/')) {
        const [max, end2] = leadingNumber(rest.slice(1));
        s.weightMax = max;
        rest = rest.slice(1 + end2);
      }
      s.encumbranceLevel = 0;
      if (indexOf(rest, '- Light') !== -1) s.encumbranceLevel = 1;
      if (indexOf(rest, '- Medium') !== -1) s.encumbranceLevel = 2;
      if (indexOf(rest, '- Heavy') !== -1) s.encumbranceLevel = 3;
      listingDone(s);
      if (s.weightsReportAsked !== 0) weightsReport(s);
      nakedCheck(s);
      return 1;
    }
  }

  for (;;) {
    const colour = s.line.attr[at] ?? 0;
    if (colour !== 0 && colour !== 7) return 1;
    if (indexFrom(line, at, 'Nothing!') !== -1 || indexFrom(line, at, 'No money!') !== -1) return 1;
    let end = indexFrom(line, at, ',');
    if (end === -1) end = indexFrom(line, at, '.');
    if (end === -1) {
      if (last === 0 && s.listingRest === '') {
        s.listingRest = line.slice(at, at + 0x1ff);
        return 1;
      }
      end = line.length;
    }
    let piece = trimSpaces(line.slice(at, Math.min(end, at + 0x31)));
    if (joining) {
      piece = trimSpaces(s.listingRest !== '' ? `${s.listingRest} ${piece}` : piece);
      s.listingRest = '';
      joining = false;
    }
    if (piece === '') return 1;
    if (carry(s, piece) !== 0) return 1;
    at = line[end] === ',' || line[end] === '.' ? end + 1 : end;
    if (line[at] === ' ') at += 1;
  }
}

/**
 * `0x453900`: `count` of `name` no longer carried (dropped, hidden, sold or
 * bought with): the encumbrance adjusted, and the line gone when none are
 * left. `how` is the state it went in, for the statistics window.
 */
export function carryLess(s: Session, name: string, count: number, how: number): number {
  const c = findCarried(s, name);
  if (!c) return 0;
  const item = c.item;
  if (item) {
    const coin = (item.flags & ItemFlag.Coin) !== 0;
    if (!coin) {
      s.weightCarried -= item.weight * count;
    } else {
      s.weightCarried += coinWeightAdded(s, c, -count);
    }
    carriedOff(s, how, coin, count, coin ? coinValue(s, item.name) : 0);
  }
  c.count -= count;
  if (c.count < 1) {
    const i = s.inventory.indexOf(c);
    if (i !== -1) s.inventory.splice(i, 1);
  }
  return 1;
}

/** `0x452f50`: the coins carried made again from the wealth, in the fewest coins, and the weight adjusted. */
export function coinsFromWealth(s: Session): void {
  const before = coinWeight(s);
  let w = s.wealth;
  const runic = Math.trunc(w / 1000000);
  w %= 1000000;
  const platinum = Math.trunc(w / 10000);
  w %= 10000;
  const gold = Math.trunc(w / 100);
  w %= 100;
  const silver = Math.trunc(w / 10);
  const copper = w % 10;
  dropCoins(s);
  const add = (count: number, name: string): void => {
    if (count !== 0) s.inventory.push({ count, flags: 0, item: findItem(s, name) });
  };
  add(runic, s.runicName);
  add(platinum, 'platinum pieces');
  add(gold, 'gold crowns');
  add(silver, 'silver noble');
  add(copper, 'copper farthing');
  s.weightCarried += coinWeight(s) - before;
}

/** What a carried line weighs, as `0x456480` sorts by: -1 unknown, coins a third each. */
function lineWeight(c: Carried): number {
  if (!c.item || c.item.weight < 0) return -1;
  return (c.item.flags & ItemFlag.Coin) !== 0 ? Math.trunc(c.count / 3) : c.count * c.item.weight;
}

/**
 * `0x4562d0`: the inventory's weights, asked for from MegaMUD's menu
 * (`weightsReportAsked`) and shown once the next listing is read: the equipped and the
 * carried, each heaviest first (`0x456480`), a line each (`0x456220`), the
 * pooled coins on GreaterMUD (`0x4534b0`, `0x453500`), and the total.
 */
function weightsReport(s: Session): void {
  s.weightsReportAsked = 0;
  const heaviest = (list: Carried[]): Carried[] =>
    [...list].sort((a, b) => lineWeight(b) - lineWeight(a));
  const equipped = heaviest(s.inventory.filter((c) => (c.flags & CarriedFlag.Equipped) !== 0));
  const carried = heaviest(s.inventory.filter((c) => (c.flags & CarriedFlag.Equipped) === 0));
  let total = 0;
  const line = (c: Carried): void => {
    const item = c.item;
    if (!item) return;
    if ((item.flags & ItemFlag.Coin) !== 0) {
      if (s.BBS_GreaterMUD !== 0) {
        s.host.show(`  ${item.name} (x${c.count}): *`);
        return;
      }
      s.host.show(`  ${item.name} (x${c.count}): ${Math.trunc(c.count / 3)}`);
      total += Math.trunc(c.count / 3);
      return;
    }
    if (item.weight < 0) {
      s.host.show(`  ${item.name} (x${c.count}): unknown weight`);
      return;
    }
    s.host.show(`  ${item.name} (x${c.count}): ${item.weight * c.count}`);
    total += item.weight * c.count;
  };
  s.host.show('');
  s.host.show('Inventory Item Weights');
  s.host.show('--- Equipped ---------');
  for (const c of equipped) line(c);
  s.host.show('--- Carried ----------');
  for (const c of carried) line(c);
  if (s.BBS_GreaterMUD !== 0) {
    const coins = s.inventory.reduce(
      (n, c) => (c.item && (c.item.flags & ItemFlag.Coin) !== 0 ? n + c.count : n),
      0
    );
    if (coins > 0) {
      const weight = Math.trunc(coins / 3);
      total += weight;
      s.host.show(`  * pooled coin weight: ${weight}`);
    }
  }
  s.host.show('----------------------');
  s.host.show(`Total: ${total}   (Encum: ${s.weightCarried}/${s.weightMax})`);
  s.host.show('');
}
