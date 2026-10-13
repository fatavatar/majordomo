/**
 * The scheduler's cash steps, read 2026-10-12: unwanted coins dropped (D18),
 * cash shared with the party (D37), deposited and withdrawn in the bank
 * (`Cash.Bank`, D40, D41), and items and coins stashed (D46). A coin is an
 * item with `0x8000000`.
 */
import type { ItemRec } from '../data';
import { findCarried, sameItemName } from '../items/inventory';
import type { Session } from '../Session';
import { unported } from '../unported';
import { queue, send } from './send';
import { setState } from './state';

const COIN = 0x8000000;

/** `0x4bfef0`: the word a command uses for an item (the realm's own name for runic coins). */
export function itemWord(s: Session, item: ItemRec | null): string {
  if (!item) return '';
  return item.name === 'runic coin' ? s.runicName : item.name;
}

function moving(s: Session): boolean {
  return s.active !== 0 || s.f_e184 !== 0 || s.f_e18c !== 0 || s.f_e178 !== 0;
}

/** In the bank (`Cash.Bank`, the room's record's name). */
function inBank(s: Session): boolean {
  return s.Cash_Bank !== '' && s.roomRecord !== null && s.roomRecord.name === s.Cash_Bank;
}

/** `0x410780` (D18): a coin not wanted (its `Cash.WantX` -1) dropped. */
export function discardCash(s: Session): number {
  if (s.hp <= 0 || s.f_8468 <= 0 || s.f_a32c !== 0 || s.f_8430 !== 0) return 0;
  let unwanted = false;
  for (const c of s.inventory) {
    const item = c.item;
    if (!item || (item.flags & COIN) === 0) continue;
    const is = (name: string): boolean => sameItemName(item.name, name);
    if (s.Cash_WantCopper === -1 && is('copper farthing')) unwanted = true;
    if (s.Cash_WantSilver === -1 && is('silver noble')) unwanted = true;
    if (s.Cash_WantGold === -1 && is('gold crown')) unwanted = true;
    if (s.Cash_WantPlat === -1 && is('platinum piece')) unwanted = true;
    const runic = s.Cash_WantRunic === -1 && (is('runic coin') || is(s.runicName));
    if (runic || unwanted) {
      s.host.activity('Discarding cash');
      send(s, `drop ${c.count} ${itemWord(s, item)}\r`);
      c.item = null;
      s.f_8468 = 0;
      return 1;
    }
  }
  return 0;
}

/**
 * `0x40b300` (D37): the coins shared with the party (`Party.ShareCash`), a
 * kind when there is at least one each; the leader asks the party to share
 * too (`all`, once).
 */
export function shareCash(s: Session, all: number): number {
  if (s.partySize === 0 || s.Party_ShareCash === 0) return 0;
  if (all !== 0 && s.f_8874 === 0 && s.leaderName === s.Player_Name) {
    queue(s, `${s.s_7d21}@share\r`);
    s.f_8870 = 1;
    s.f_8874 = 1;
  }
  if (s.f_8870 === 0) return 0;
  let shared = 0;
  for (const [name, word] of [
    ['copper farthing', 'copper'],
    ['silver noble', 'silver'],
    ['gold crown', 'gold'],
    ['platinum piece', 'platinum'],
    ['runic coin', 'runic']
  ] as const) {
    const c = findCarried(s, name);
    if (c && c.count >= s.partySize) {
      queue(s, `share ${c.count} ${word} with party\r`);
      shared = 1;
    }
  }
  if (shared !== 0) s.f_8468 = 0;
  s.f_8870 = 0;
  return shared;
}

/** `0x406d90` (D40): in the bank, what is asked (`0x842c`; -1 all over `0x850c`) deposited. */
export function depositCash(s: Session): number {
  if (!moving(s) || s.f_a32c !== 0 || !inBank(s) || s.f_845c !== 0) return 0;
  let amount = s.f_842c;
  if (amount === -1) {
    if (s.f_8428 >>> 0 <= s.f_850c >>> 0) {
      s.f_842c = 0;
      return 0;
    }
    amount = s.f_8428 - s.f_850c;
    s.f_842c = amount;
  }
  if (amount === 0) return 0;
  s.sneaking = 0;
  s.hidden = 0;
  s.waitLines = 2;
  s.f_8468 = 0;
  setState(s, 0x26);
  s.host.activity('Depositing cash');
  send(s, `deposit ${amount >>> 0}\r`);
  s.f_8440 += amount;
  s.f_842c = 0;
  s.f_8428 -= amount;
  return 1;
}

/** `0x40d8a0` (D41): in the bank, enough withdrawn for what is wanted (`0x8430`) over `0x850c`. */
export function withdrawCash(s: Session): number {
  if (!moving(s) || s.f_a32c !== 0 || !inBank(s) || s.f_8430 === 0) return 0;
  const want = (s.f_850c + s.f_8430) >>> 0;
  const have = s.f_8428 >>> 0;
  if (have >= want) return 0;
  s.sneaking = 0;
  s.hidden = 0;
  s.waitLines = 2;
  s.f_8468 = 0;
  setState(s, 0x27);
  s.host.activity('Withdrawing cash');
  send(s, `withdraw ${want - have}\r`);
  s.f_8430 = 0;
  return 1;
}

/**
 * `0x40ce50` (D46): while stashing (`0xe2c0`), an item to stash (`8`) beyond
 * the number to keep, or a coin (all of them without `Cash.StashCoin`, else
 * copper and those up to `Cash.StashCoinType`: 1 silver, 2 gold, 3 platinum;
 * runic never).
 */
export function stashItems(s: Session): number {
  if (s.inCombat !== 0 || s.hp < 1 || s.f_30e18 !== 0 || s.f_e2c0 === 0) return 0;
  for (const c of s.inventory) {
    const item = c.item;
    if (!item || (item.flags & (COIN | 8)) === 0) continue;
    let stash: boolean;
    let word = '';
    if ((item.flags & COIN) === 0) {
      stash = item.min < c.count;
    } else {
      word = itemWord(s, item).slice(0, 99);
      if (word === '' || s.Cash_StashCoin === 0) stash = true;
      else if (word.startsWith('copper')) stash = true;
      else if (word.startsWith('silver')) stash = s.Cash_StashCoinType > 0;
      else if (word.startsWith('gold')) stash = s.Cash_StashCoinType > 1;
      else if (word.startsWith('platinum')) stash = s.Cash_StashCoinType > 2;
      else stash = !word.startsWith('runic') && !word.startsWith(s.runicName);
    }
    if (!stash) continue;
    s.waitLines = 2;
    setState(s, 0x1e);
    s.host.activity('Stashing items/cash');
    send(s, (item.flags & COIN) === 0 ? `stash ${item.name}\r` : `stash ${c.count} ${word}\r`);
    return 1;
  }
  s.f_e2c0 = 0;
  return 0;
}

/** `0x43cf30`: a detour to the bank to bring the wealth up to `amount` copper. Not ported yet. */
export function fetchCash(_s: Session, _how: number, _amount: number): number {
  return unported('43cf30');
}
