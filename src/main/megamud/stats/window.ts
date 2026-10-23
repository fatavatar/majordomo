/**
 * What MegaMUD's statistics window counts that the stream cannot tell apart,
 * read 2026-10-19 off its fill (`0x4a8a10`) and the places that move it:
 * which attack rung a cast and a blow were (`0x426ef0`, `0x426f70`), a
 * round's damage (`0x425c40`), and the items and copper collected, sold,
 * deposited and stashed (`0x4532d0`, `0x453900`, `0x406d90`, `0x4bc190`).
 *
 * The port keeps no window, so each is handed to the host as it is counted
 * (`SessionHost.counted`), which adds it to the character's tally beside
 * what the stream counts. The rows the stream already counts — hit, miss,
 * crit, backstab, sneak, dodge and the coins picked up — are not counted
 * twice.
 */
import type { MegaMode } from '../../../shared/tally';
import type { Session } from '../Session';
import { State } from '../states';

/** The rung an attack-cast state is, as `0x426ef0` and `0x426f70` switch on it; null for any other. */
export function megaMode(state: number): MegaMode | null {
  switch (state) {
    case State.CastPreMulti:
      return 'preMulti';
    case State.CastMulti:
      return 'multi';
    case State.CastPre:
      return 'pre';
    case State.CastAux:
      return 'second';
    case State.CastMain:
      return 'main';
    default:
      return null;
  }
}

/** The command the window names a rung's row by (`0x4a8a10`). */
function commandOf(s: Session, mode: MegaMode): string {
  switch (mode) {
    case 'pre':
      return s.Combat_PreAttack;
    case 'preMulti':
      return s.Combat_PreMultAttack;
    case 'multi':
      return s.Combat_MultAttack;
    case 'main':
      return s.Combat_AttackSpl;
    case 'second':
      return s.Combat_AttackSpl2;
  }
}

/** `0x426ef0`: a rung's cast answered (`took` 1) or given up (0). */
export function castTook(s: Session, state: number, took: number): void {
  const mode = megaMode(state);
  if (mode === null) return;
  s.host.counted?.({ kind: 'cast', mode, took: took !== 0, command: commandOf(s, mode) });
}

/** `0x426f70`: a rung's blow landed for `damage`. */
export function rungBlow(s: Session, state: number, damage: number): void {
  const mode = megaMode(state);
  if (mode === null) return;
  s.host.counted?.({ kind: 'blow', mode, damage, command: commandOf(s, mode) });
}

/** `0x425c40`: the round just ended dealt `damage`. */
export function roundDealt(s: Session, damage: number): void {
  s.host.counted?.({ kind: 'round', damage });
}

/** `0x4532d0`: items that are not coins put in the pack. */
export function itemsCollected(s: Session, count: number): void {
  s.host.counted?.({ kind: 'items', how: 'collected', count });
}

/**
 * `0x453900`: what left the pack, by the state it left in: stashed (0x1e)
 * or sold (0x29). Coins stashed count as copper. Coins dropped or paid
 * come off the window's `Collected:` copper, which this client reads as the
 * coins picked up and leaves as it is.
 */
export function carriedOff(
  s: Session,
  how: number,
  coin: boolean,
  count: number,
  value: number
): void {
  if (how === State.Stashing) {
    if (coin) s.host.counted?.({ kind: 'copper', how: 'stashed', copper: value * count });
    else s.host.counted?.({ kind: 'items', how: 'stashed', count });
  } else if (how === State.Selling && !coin) {
    s.host.counted?.({ kind: 'items', how: 'sold', count });
  }
}

/** `0x406d90` and `0x4bc190`: copper deposited. */
export function deposited(s: Session, copper: number): void {
  s.host.counted?.({ kind: 'copper', how: 'deposited', copper });
}
