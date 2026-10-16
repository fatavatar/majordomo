/**
 * `0x4785b0`: the inventory, who and top listings, given up on when they
 * stall (read 2026-10-12): `LagWait + 8` seconds since the last line of one
 * (the inventory also after `LagWait + 30` in all). Its state ends, and its
 * `lineFlags` with it.
 */
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { State } from '../states';
import { LineFlag, WHO_LISTING, INVENTORY_LISTING } from '../flags';

/** End a listing's state (`state` itself only when it is the current one). */
function giveUp(s: Session, state: number): void {
  forgetAwaited(s, state);
  if (s.state === state) setState(s, State.Nothing);
}

export function listingTimeouts(s: Session): void {
  if (s.inGame === 0 || s.online === 0) return;
  const inv = s.lineFlags & INVENTORY_LISTING;
  const who = s.lineFlags & WHO_LISTING;
  const top = s.lineFlags & LineFlag.TopListing;
  if (
    s.state !== State.Inventory &&
    s.state !== State.Who &&
    s.state !== State.Top &&
    inv === 0 &&
    who === 0 &&
    top === 0
  ) {
    return;
  }
  const t = s.host.tickMs();
  const lag = Math.max(s.Comms_LagWait, 0);
  const quiet = (lag + 8) * 1000;
  const whole = (lag + 0x1e) * 1000;
  if (s.state === State.Inventory || inv !== 0) {
    if (s.inventoryQuietAt === 0) {
      s.inventoryQuietAt = t;
      if (inv !== 0 && s.inventoryStartedAt === 0) s.inventoryStartedAt = t;
    } else {
      if (inv !== 0 && s.inventoryStartedAt === 0) s.inventoryStartedAt = t;
      const tooLong = inv !== 0 && s.inventoryStartedAt !== 0 && t - s.inventoryStartedAt > whole;
      if (t - s.inventoryQuietAt > quiet || tooLong) {
        s.host.show('[Inventory listing timed out]');
        if (s.debug !== 0) s.host.trace('{inv-to}');
        if (inv !== 0) {
          s.lineFlags &= ~INVENTORY_LISTING;
          s.weightMax = 0;
        }
        giveUp(s, State.Inventory);
        s.inventoryQuietAt = 0;
        s.inventoryStartedAt = 0;
      }
    }
  }
  if (s.state === State.Who || who !== 0) {
    if (s.whoQuietAt === 0) {
      s.whoQuietAt = t;
    } else if (t - s.whoQuietAt > quiet) {
      s.host.show('[Who listing timed out]');
      if (s.debug !== 0) s.host.trace('{who-to}');
      if (who !== 0) {
        s.lineFlags &= ~WHO_LISTING;
        if (s.whoTimedOutAt === 0 || t - s.whoTimedOutAt > 60000) {
          s.whoTimedOutAt = t;
          s.whoDue = -1;
        }
      }
      giveUp(s, State.Who);
      s.whoQuietAt = 0;
    }
  }
  if (s.state === State.Top || top !== 0) {
    if (s.topQuietAt === 0) {
      s.topQuietAt = t;
      return;
    }
    if (t - s.topQuietAt > quiet) {
      s.host.show('[Top50 listing timed out]');
      if (s.debug !== 0) s.host.trace('{top-to}');
      if (top !== 0) s.lineFlags &= ~LineFlag.TopListing;
      giveUp(s, State.Top);
      s.topQuietAt = 0;
    }
  }
}
