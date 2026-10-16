/**
 * The scheduler's item steps, read 2026-10-12: what is collected picked up
 * (D19, `0x411ab0` for each), items marked to wear equipped (D20), and
 * buying and selling in a shop (D42, D43). An item's flags: 2 collect, 4
 * buy, 8 sell (or stash), 0x10 equip, 0x1000 a container, 0x1000000 needed for a path,
 * 0x2000000 picked up for one, 0x8000000 a coin.
 */
import { classMagic, findClass, type ItemRec } from '../data';
import { postMeditate, postRest } from '../health/prepost';
import {
  coinCount,
  coinWeight,
  coinWeightAdded,
  findCarried,
  sameItemName
} from '../items/inventory';
import { coinValue, findItem } from '../room/checkNames';
import { enemiesHere } from '../room/entities';
import { automated, type Carried, type Session } from '../Session';
import { itemWord } from './cash';
import { queue, send } from './send';
import { setState } from './state';
import { State } from '../states';
import { ItemFlag, CarriedFlag, Darkness, EntityType } from '../flags';

/**
 * `0x410960`: room made for `count` of a coin worth more by dropping coins
 * worth less (`Cash.DropCoins`), `over` the weight to shed. 1 when some
 * were dropped.
 */
function dropForBigger(s: Session, coin: ItemRec, count: number, over: number): number {
  if (s.Cash_DropCoins === 0 || s.weightMax < 1) return 0;
  const worth = coinValue(s, coin.name);
  const greater = s.BBS_GreaterMUD !== 0;
  let lesser = 0;
  let coins = 0;
  let weight = 0;
  let room = 0;
  let toShed = over;
  if (greater) {
    const added = coinWeightAdded(s, null, count);
    const spare = added - over;
    const short = spare < 0 ? over - added : 0;
    coins = coinCount(s);
    weight = coinWeight(s);
    const fits = Math.max(0, Math.max(0, spare) * 3);
    if (count <= fits) return 0;
    for (let i = s.inventory.length - 1; i >= 0; i -= 1) {
      const item = s.inventory[i]!.item;
      if (item && (item.flags & ItemFlag.Coin) !== 0 && coinValue(s, item.name) < worth)
        lesser += s.inventory[i]!.count;
    }
    if (lesser < 1) return 0;
    const wanted = Math.trunc((count - fits + 2) / 3) + short;
    toShed = weight - Math.trunc((coins - lesser) / 3);
    if (toShed < short + 1) return 0;
    if (wanted <= toShed) toShed = wanted;
    room = coins - 2 + (toShed - weight) * 3;
    if (room < 1 || lesser < room) return 0;
  }
  const want = toShed;
  let left = toShed;
  let dropped = 0;
  let remaining = count;
  let any = false;
  if (left <= 0) return 0;
  for (;;) {
    let pick = -1;
    let pickWorth = 0;
    for (let i = s.inventory.length - 1; i >= 0; i -= 1) {
      const item = s.inventory[i]!.item;
      if (!item || (item.flags & ItemFlag.Coin) === 0) continue;
      const w = coinValue(s, item.name);
      if (w < worth && (pick === -1 || w < pickWorth)) {
        pick = i;
        pickWorth = w;
      }
    }
    if (pick === -1) break;
    const c = s.inventory[pick]!;
    let n: number;
    if (!greater) {
      n = Math.min(c.count, left * 3, remaining);
    } else {
      const still = room - dropped;
      if (still < 1) break;
      n = Math.min(c.count, still);
    }
    if (n < 1) {
      s.host.trace(
        `DoDropCoins having issues; escaping infinite loop.  Trying to drop ${n} ${itemWord(s, c.item)}.  We should have ${c.count} of them.  We want ${count} ${itemWord(s, coin)}`
      );
      return 0;
    }
    s.host.activity('Dropping coins to get bigger currency');
    send(s, `drop ${n} ${itemWord(s, c.item)}\r`);
    if (!greater) {
      left += Math.trunc((c.count - n) / 3) - Math.trunc(c.count / 3);
    } else {
      dropped += n;
      left = Math.max(0, Math.trunc((coins - dropped) / 3) - weight + want);
    }
    c.item = null;
    any = true;
    if (left < 1) break;
    if (!greater) remaining -= n;
  }
  if (!any) return 0;
  s.weightMax = 0;
  return 1;
}

/**
 * `0x411ab0`: room entry `i` picked up, if it is wanted: needed for a path
 * (`0x1000000`, or the item asked for, `itemPickingUp`), cash while short of funds,
 * a coin collected (`Cash.WantX`, with `MegaMud.AutoCash`), or with
 * `MegaMud.AutoGet` an item up to its maximum. Only as much as the
 * encumbrance allows (`Cash.DontBeHeavy`/`DontBeMedium`), coins dropped to
 * make room for better ones.
 */
export function getItem(s: Session, i: number): number {
  if (s.room.length < 1) return 0;
  const e = s.room[i]!;
  const item = e.item;
  if (!item || s.darkness === Darkness.Dark) return 0;
  let needed = (item.flags & ItemFlag.NeededForPath) !== 0;
  if (needed) {
    item.flags &= ~ItemFlag.NeededForPath;
    s.host.activity(`Getting ${e.name} because it is needed for a path`);
  }
  if (s.wealth >>> 0 < s.cashNeeded >>> 0 && (item.flags & ItemFlag.Coin) !== 0) {
    needed = true;
    s.host.activity('Getting cash because we require funds');
  }
  if (e.name === s.itemPickingUp) {
    needed = true;
    s.host.activity(`Getting ${e.name} because it is needed for a path`);
  }
  let coin = false;
  const coinRule = (name: string, want: number, label: string): boolean => {
    if (!sameItemName(e.name, name)) return true;
    needed = want !== -1 && needed;
    if (!needed) {
      if (want < 1) return false;
      s.host.activity(`Getting cash because we collect ${label}`);
    }
    coin = true;
    return true;
  };
  if (!coinRule('copper farthing', s.Cash_WantCopper, 'copper farthings')) return 0;
  if (!coinRule('silver noble', s.Cash_WantSilver, 'silver nobles')) return 0;
  if (!coinRule('gold crown', s.Cash_WantGold, 'gold coins')) return 0;
  if (!coinRule('platinum piece', s.Cash_WantPlat, 'platinum pieces')) return 0;
  const runic = sameItemName(e.name, 'runic coin') || sameItemName(e.name, s.runicName);
  let carried: Carried | null;
  let count: number;
  let weight: number;
  if (runic) {
    if (s.Cash_WantRunic === -1) return 0;
    if (!needed) {
      if (s.Cash_WantRunic < 1) return 0;
      s.host.activity('Getting cash because we collect runic coins');
      if (s.MegaMud_AutoCash === 0) return 0;
    }
    coin = true;
  } else if (!needed && coin && s.MegaMud_AutoCash === 0) {
    return 0;
  } else if (!needed && !coin && s.MegaMud_AutoGet === 0) {
    return 0;
  }
  carried = findCarried(s, e.name);
  if (!coin && !needed && item.max !== 0) {
    if (item.max <= (carried?.count ?? 0)) return 0;
    count = 1;
    weight = item.weight;
  } else {
    count = e.count;
    if (coin) {
      weight =
        s.BBS_GreaterMUD === 0 ? Math.trunc((count + 2) / 3) : coinWeightAdded(s, carried, count);
    } else {
      count = 1;
      weight = item.weight;
    }
  }
  let limit = s.weightMax;
  if (s.Cash_DontBeHeavy !== 0 && !needed) limit = Math.trunc((s.weightMax * 0x43) / 100);
  if (s.Cash_DontBeMedium !== 0 && !needed) limit = Math.trunc((s.weightMax * 0x21) / 100);
  if (coin) {
    if (s.BBS_GreaterMUD !== 0) {
      const spare = limit - s.weightCarried;
      if (spare < 1 && weight === 0) {
        if (dropForBigger(s, item, count, -spare) !== 0) return 1;
        count = 0;
      } else if (spare >= 0 && weight === spare) {
        count = Math.min(count, spare * 3);
        weight = coinWeightAdded(s, carried, count);
      }
    }
    if (limit < s.weightCarried + weight) {
      if (dropForBigger(s, item, count, s.weightCarried - limit + weight) !== 0) return 1;
      const spare = limit - s.weightCarried;
      if (s.BBS_GreaterMUD === 0) {
        count = Math.min(count, spare * 3);
        weight = Math.trunc(count / 3);
      } else {
        count = spare < 1 ? 0 : Math.min(count, spare * 3);
        weight = coinWeightAdded(s, carried, count);
      }
    }
  }
  if (count <= 0) return 0;
  if (weight + s.weightCarried > limit || (s.weightCarried === limit && coin && weight === 0)) {
    s.host.activity(`Not getting ${e.name} because it would take us past our maximum encumberance`);
    return 0;
  }
  if (needed && !coin) item.flags |= ItemFlag.PickedUpForPath;
  s.roomSelected = i;
  s.waitLines = 2;
  setState(s, State.Getting);
  s.host.activity(`Getting item/cash ${e.name}`);
  send(s, coin ? `g ${count} ${itemWord(s, item)}\r` : `g ${item.name}\r`);
  if ((item.flags & ItemFlag.Open) !== 0) {
    queue(s, `open ${item.name}\r`);
    queue(s, 'i\r');
  }
  return 1;
}

/**
 * `0x40e080` (D19): with the inventory known, an item here picked up (not
 * after a fight with `Cash.GetAfterCombat`, only in one with
 * `Cash.GetOnlyInCombat`): one collected (`2`), a coin, one needed for a
 * path, or the item asked for.
 */
export function collectItems(s: Session): number {
  if (s.hp <= 0 || s.weightMax === 0) return 0;
  if (s.Cash_GetAfterCombat !== 0 && s.MegaMud_AutoCombat !== 0 && enemiesHere(s, 0) >= 1) return 0;
  if (s.Cash_GetOnlyInCombat !== 0 && s.inCombat === 0) return 0;
  for (let i = 0; i < s.room.length; i += 1) {
    const e = s.room[i]!;
    if (e.type !== EntityType.Item || !e.item) continue;
    if (
      (e.item.flags & (ItemFlag.Collect | ItemFlag.NeededForPath | ItemFlag.Coin)) === 0 &&
      e.name !== s.itemPickingUp
    )
      continue;
    if (getItem(s, i) !== 0) {
      s.host.activity(`Getting ${e.name} because we collect them`);
      return 1;
    }
  }
  return 0;
}

/** How many of a wear slot can be filled (the counts in the table at `0x562580`; 13 is none). */
function slotRoom(location: number): number | null {
  if (location === 4) return 2;
  if (location < 0 || location > 18 || location === 13) return null;
  return location === 0 ? 0 : 1;
}

/**
 * `0x410d00` (D20): an item marked to equip (`0x10`, or asked `0x200`) put
 * on when its slot has room (a weapon: one, and none for a kai class that
 * fights unarmed), after any post-rest or post-meditate command. Not while
 * sneaking or hidden from monsters here unless auto-combat is on.
 */
export function autoEquip(s: Session): number {
  if (s.hp <= 0 || s.allOff !== 0) return 0;
  if (s.state === State.Equipping) return 1;
  if (s.MegaMud_AutoCombat === 0 && (s.sneaking !== 0 || s.hidden !== 0) && enemiesHere(s, 0) >= 1)
    return 0;
  for (let i = 0; i < s.inventory.length; i += 1) {
    const c = s.inventory[i]!;
    const item = c.item;
    if (!item) continue;
    if ((c.flags & CarriedFlag.Equipped) !== 0) {
      c.flags &= ~CarriedFlag.EquipAsked;
      continue;
    }
    if ((item.flags & ItemFlag.Equip) === 0 && (c.flags & CarriedFlag.EquipAsked) === 0) continue;
    c.flags &= ~CarriedFlag.EquipAsked;
    let room: number;
    if (item.type === 1) {
      room = 1;
    } else {
      if (item.type !== 0 || item.location === 0) continue;
      const r = slotRoom(item.location);
      if (r === null) continue;
      room = r;
    }
    let worn = 0;
    s.inventory.forEach((x, j) => {
      if (
        j !== i &&
        x.item &&
        x.item.type === item.type &&
        x.item.location === item.location &&
        (x.flags & CarriedFlag.Equipped) !== 0
      )
        worn += 1;
    });
    const cls = findClass(s.data, s.Player_Class);
    if (item.type === 1 && cls && classMagic(s.data, s.Player_Class) === 5 && cls.bytes[3] === 9)
      worn = 0x7fffffff;
    if (worn >= room) continue;
    const rested = postRest(s, 3, 0);
    const meditated = postMeditate(s, 0);
    if (rested !== 0 || meditated !== 0) return 1;
    s.equipsPending += 1;
    s.waitLines = 2;
    setState(s, State.Equipping);
    s.host.activity(`Auto-equipping item ${item.name}`);
    s.equipping = item.name.slice(0, 30);
    send(s, `eq ${item.name}\r`);
    return 1;
  }
  return 0;
}

/** The shop is this room (the item's shop is the room's record's name). */
function shopHere(s: Session, item: ItemRec): boolean {
  return s.roomRecord !== null && item.shop === s.roomRecord.name;
}

/**
 * `0x406b60` (D42): in a shop (room flag 2), the item asked for (`itemPickingUp`)
 * bought; else an item to buy here (`4`, not `0x4000000`) short of its
 * number, when the wealth covers its price (more below 50 charm).
 */
export function buyItems(s: Session): number {
  if (!automated(s) || s.allOff !== 0 || !s.roomRecord || ((s.roomRecord.flags ?? 0) & 2) === 0)
    return 0;
  let buy: ItemRec | null = null;
  const asked = s.itemPickingUp !== '' ? findItem(s, s.itemPickingUp) : null;
  if (asked && shopHere(s, asked)) buy = asked;
  if (!buy) {
    for (const item of s.data.items) {
      if (
        (item.flags & (ItemFlag.Buy | ItemFlag.OutOfStock)) !== ItemFlag.Buy ||
        !shopHere(s, item)
      )
        continue;
      const have = findCarried(s, item.name)?.count ?? 0;
      const target = item.max > 0 && item.min <= item.max ? item.max : item.min;
      if (have >= target) continue;
      let price = item.price >>> 0;
      if (s.Player_Charm < 0x32) price += Math.trunc(((0x32 - s.Player_Charm) * price * 2) / 100);
      if (price > s.wealth >>> 0) continue;
      buy = item;
      break;
    }
  }
  if (!buy) return 0;
  s.sneaking = 0;
  s.hidden = 0;
  s.waitLines = 2;
  s.weightMax = 0;
  setState(s, State.Buying);
  s.host.activity(`Buying item ${buy.name}`);
  send(s, `buy ${buy.name}\r`);
  return 1;
}

/** `0x40b0b0` (D43): in a shop, an item to sell (`8`) here beyond the number to keep sold. */
export function sellItems(s: Session): number {
  if (!automated(s) || s.allOff !== 0 || !s.roomRecord || ((s.roomRecord.flags ?? 0) & 2) === 0)
    return 0;
  for (const c of s.inventory) {
    const item = c.item;
    if (!item || (item.flags & ItemFlag.Sell) === 0 || item.min >= c.count || !shopHere(s, item))
      continue;
    s.sellDetourTaken = 0;
    s.sneaking = 0;
    s.hidden = 0;
    s.waitLines = 2;
    s.weightMax = 0;
    setState(s, State.Selling);
    s.host.activity(`Selling item ${item.name}`);
    send(s, `sell ${item.name}\r`);
    return 1;
  }
  return 0;
}
