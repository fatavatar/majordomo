/**
 * The remote item errands (`@get-all`, `@drop-all`, `@equip-all`,
 * `@deposit-all`), read 2026-10-12. Each first sends what the player has
 * typed but not sent (`0x4bb920`, the app's typed line: left out), and ends
 * waking the scheduler (`0x42e0e0`). An item's `0x8000000` is a coin.
 */
import { queue, wake } from '../script/send';
import type { Session } from '../Session';
import { ItemFlag, CarriedFlag } from '../flags';

/**
 * `0x4bc390`: everything here not marked never to take (`0x40`) marked to
 * take (`0x1000000`), coins left out when there is anything else.
 */
export function getAll(s: Session): void {
  const things = s.room.some((e) => e.item && (e.item.flags & ItemFlag.Coin) === 0);
  for (const e of s.room) {
    const item = e.item;
    if (!item || (item.flags & ItemFlag.CannotTake) !== 0) continue;
    if (things && (item.flags & ItemFlag.Coin) !== 0) continue;
    item.flags |= ItemFlag.NeededForPath;
  }
  wake(s);
}

/**
 * `0x4bc210`: drop what is carried: first what is not equipped (`0x200`),
 * and only if there is none of that, everything; a stack of coins in one
 * command, anything else one at a time. (The button asks "Are you sure"
 * first; the remote command does not.)
 */
export function dropAll(s: Session): void {
  for (let pass = 1; pass < 3; pass += 1) {
    let dropped = 0;
    for (const c of s.inventory) {
      const item = c.item;
      if (!item || (pass === 1 && (c.flags & CarriedFlag.EquipAsked) !== 0)) continue;
      if ((item.flags & ItemFlag.Coin) === 0) {
        for (let i = 0; i < c.count; i += 1) {
          queue(s, `drop ${item.name}\r`);
          dropped += 1;
        }
      } else {
        queue(s, `drop ${c.count} ${item.name}\r`);
        dropped += 1;
      }
    }
    if (s.inventory.length > 0 && dropped > 0) break;
  }
  wake(s);
}

/** `0x4bc340`: everything carried marked to be equipped (`0x200`). */
export function equipAll(s: Session): void {
  for (const c of s.inventory) c.flags |= CarriedFlag.EquipAsked;
  wake(s);
}

/** `0x4bc190`: the wealth over what is kept (`Cash.MinWealth`) deposited. */
export function depositAll(s: Session): void {
  const over = s.wealth - s.Cash_MinWealth;
  if (over <= 0) return;
  queue(s, `dep ${over}\r`);
  wake(s);
  s.depositAsked = 0;
  s.wealth -= over;
}
