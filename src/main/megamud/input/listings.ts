/**
 * `0x4785b0`: the inventory, who and top listings, given up on when they
 * stall (read 2026-10-12): `LagWait + 8` seconds since the last line of one
 * (the inventory also after `LagWait + 30` in all). Its state ends, and its
 * `lineFlags` with it.
 */
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';

/** End a listing's state (`state` itself only when it is the current one). */
function giveUp(s: Session, state: number): void {
  forgetAwaited(s, state);
  if (s.state === state) setState(s, 0);
}

export function listingTimeouts(s: Session): void {
  if (s.inGame === 0 || s.online === 0) return;
  const inv = s.lineFlags & 0x1c00;
  const who = s.lineFlags & 0x380;
  const top = s.lineFlags & 0x40;
  if (
    s.state !== 0x25 &&
    s.state !== 0x23 &&
    s.state !== 0x24 &&
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
  if (s.state === 0x25 || inv !== 0) {
    if (s.f_32350 === 0) {
      s.f_32350 = t;
      if (inv !== 0 && s.f_32358 === 0) s.f_32358 = t;
    } else {
      if (inv !== 0 && s.f_32358 === 0) s.f_32358 = t;
      const tooLong = inv !== 0 && s.f_32358 !== 0 && t - s.f_32358 > whole;
      if (t - s.f_32350 > quiet || tooLong) {
        s.host.show('[Inventory listing timed out]');
        if (s.debug !== 0) s.host.trace('{inv-to}');
        if (inv !== 0) {
          s.lineFlags &= ~0x1c00;
          s.f_8468 = 0;
        }
        giveUp(s, 0x25);
        s.f_32350 = 0;
        s.f_32358 = 0;
      }
    }
  }
  if (s.state === 0x23 || who !== 0) {
    if (s.f_32360 === 0) {
      s.f_32360 = t;
    } else if (t - s.f_32360 > quiet) {
      s.host.show('[Who listing timed out]');
      if (s.debug !== 0) s.host.trace('{who-to}');
      if (who !== 0) {
        s.lineFlags &= ~0x380;
        if (s.f_32370 === 0 || t - s.f_32370 > 60000) {
          s.f_32370 = t;
          s.f_e2a4 = -1;
        }
      }
      giveUp(s, 0x23);
      s.f_32360 = 0;
    }
  }
  if (s.state === 0x24 || top !== 0) {
    if (s.f_32368 === 0) {
      s.f_32368 = t;
      return;
    }
    if (t - s.f_32368 > quiet) {
      s.host.show('[Top50 listing timed out]');
      if (s.debug !== 0) s.host.trace('{top-to}');
      if (top !== 0) s.lineFlags &= ~0x40;
      giveUp(s, 0x24);
      s.f_32368 = 0;
    }
  }
}
