/**
 * The scheduler's cash steps, read 2026-10-12: unwanted coins dropped (D18),
 * cash shared with the party (D37), deposited and withdrawn in the bank
 * (`Cash.Bank`, D40, D41), and items and coins stashed (D46). A coin is an
 * item with `0x8000000`.
 */
import type { ItemRec } from '../data';
import { findCarried, sameItemName } from '../items/inventory';
import { automated, type Session } from '../Session';
import { goTo, headFor, roomByName } from '../move/destinations';
import { queue, send } from './send';
import { setState } from './state';
import { State } from '../states';
import { ItemFlag } from '../flags';

/** `0x4bfef0`: the word a command uses for an item (the realm's own name for runic coins). */
export function itemWord(s: Session, item: ItemRec | null): string {
  if (!item) return '';
  return item.name === 'runic coin' ? s.runicName : item.name;
}

/** In the bank (`Cash.Bank`, the room's record's name). */
function inBank(s: Session): boolean {
  return s.Cash_Bank !== '' && s.roomRecord !== null && s.roomRecord.name === s.Cash_Bank;
}

/** `0x410780` (D18): a coin not wanted (its `Cash.WantX` -1) dropped. */
export function discardCash(s: Session): number {
  if (s.hp <= 0 || s.weightMax <= 0 || s.allOff !== 0 || s.cashNeeded !== 0) return 0;
  let unwanted = false;
  for (const c of s.inventory) {
    const item = c.item;
    if (!item || (item.flags & ItemFlag.Coin) === 0) continue;
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
      s.weightMax = 0;
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
  if (all !== 0 && s.shareAsked === 0 && s.leaderName === s.Player_Name) {
    queue(s, `${s.speechPrefix}@share\r`);
    s.shareCashDue = 1;
    s.shareAsked = 1;
  }
  if (s.shareCashDue === 0) return 0;
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
  if (shared !== 0) s.weightMax = 0;
  s.shareCashDue = 0;
  return shared;
}

/** `0x406d90` (D40): in the bank, what is asked (`depositAsked`; -1 all over `Cash.MinWealth`) deposited. */
export function depositCash(s: Session): number {
  if (!automated(s) || s.allOff !== 0 || !inBank(s) || s.bankedHere !== 0) return 0;
  let amount = s.depositAsked;
  if (amount === -1) {
    if (s.wealth >>> 0 <= s.Cash_MinWealth >>> 0) {
      s.depositAsked = 0;
      return 0;
    }
    amount = s.wealth - s.Cash_MinWealth;
    s.depositAsked = amount;
  }
  if (amount === 0) return 0;
  s.sneaking = 0;
  s.hidden = 0;
  s.waitLines = 2;
  s.weightMax = 0;
  setState(s, State.Depositing);
  s.host.activity('Depositing cash');
  send(s, `deposit ${amount >>> 0}\r`);
  s.depositAsked = 0;
  s.wealth -= amount;
  return 1;
}

/** `0x40d8a0` (D41): in the bank, enough withdrawn for what is wanted (`cashNeeded`) over `Cash.MinWealth`. */
export function withdrawCash(s: Session): number {
  if (!automated(s) || s.allOff !== 0 || !inBank(s) || s.cashNeeded === 0) return 0;
  const want = (s.Cash_MinWealth + s.cashNeeded) >>> 0;
  const have = s.wealth >>> 0;
  if (have >= want) return 0;
  s.sneaking = 0;
  s.hidden = 0;
  s.waitLines = 2;
  s.weightMax = 0;
  setState(s, State.Withdrawing);
  s.host.activity('Withdrawing cash');
  send(s, `withdraw ${want - have}\r`);
  s.cashNeeded = 0;
  return 1;
}

/**
 * `0x40ce50` (D46): while stashing (`stashing`), an item to stash (`8`) beyond
 * the number to keep, or a coin (all of them without `Cash.StashCoin`, else
 * copper and those up to `Cash.StashCoinType`: 1 silver, 2 gold, 3 platinum;
 * runic never).
 */
export function stashItems(s: Session): number {
  if (s.inCombat !== 0 || s.hp < 1 || s.unknown_30e18 !== 0 || s.stashing === 0) return 0;
  for (const c of s.inventory) {
    const item = c.item;
    if (!item || (item.flags & (ItemFlag.Coin | ItemFlag.Sell)) === 0) continue;
    let stash: boolean;
    let word = '';
    if ((item.flags & ItemFlag.Coin) === 0) {
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
    setState(s, State.Stashing);
    s.host.activity('Stashing items/cash');
    send(
      s,
      (item.flags & ItemFlag.Coin) === 0 ? `stash ${item.name}\r` : `stash ${c.count} ${word}\r`
    );
    return 1;
  }
  s.stashing = 0;
  return 0;
}

/**
 * `0x43cf30`: a detour to the bank (`Cash.Bank`) to bring the wealth up to
 * `amount` copper (`cashNeeded`, the most asked). 0 on the way or there
 * already; 8 no bank to go to; 0x20 cancelled (`how`: asked whether to go
 * on without).
 */
export function fetchCash(s: Session, how: number, amount: number): number {
  let result = 8;
  s.cashNeeded = Math.max(amount >>> 0, s.cashNeeded >>> 0);
  const bank = s.Cash_Bank !== '' ? roomByName(s, s.Cash_Bank) : null;
  if (bank) {
    if (s.roomSignature === bank.signature) return 0;
    if (goTo(s, bank.signature, null) !== 0) {
      s.detours[0]!.why = 'for cash';
      result = headFor(s, how);
      if (result === 0) return 0;
      if (result === 0x20) return 0x20;
      if (how === 0) return 0;
    }
  }
  if (s.goAnywayAccepted === 1) return 0;
  if (how === 0) return result;
  s.goAnywayAccepted = 1;
  const yes = s.host.ask?.(
    `You require ${Math.trunc((amount >>> 0) / 100)} gold to go here.\nDo you wish to continue?`
  );
  return yes ? 0 : 0x20;
}

/** `0x40db90`: more cash than `Cash.MaxWealth` or `Cash.MaxCoins` allow, where `Cash.LimitWealth` or `Cash.LimitCoins` is on, and more than is kept. */
export function overCash(s: Session): number {
  const kept = s.Cash_MinWealth >>> 0 < s.wealth >>> 0 ? 1 : 0;
  if (s.Cash_LimitWealth !== 0 && s.Cash_MaxWealth >>> 0 < s.wealth >>> 0) return kept;
  if (s.Cash_LimitCoins !== 0) {
    let coins = 0;
    for (const c of s.inventory)
      if (c.item && (c.item.flags & ItemFlag.Coin) !== 0) coins += c.count;
    if (s.Cash_MaxCoins >>> 0 < coins >>> 0) return kept;
  }
  return 0;
}
