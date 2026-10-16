/**
 * MegaMUD's round timer (`0x49a000`–`0x49c200`), read and disassembled
 * 2026-10-12. The game's combat rounds come every five seconds; MegaMUD learns
 * where in those five seconds a round begins from the events that only happen
 * on one (a blow struck, experience gained), and from that decides when a
 * spell may be cast: one a round, and not just after a round has begun, when
 * the game would refuse it ("You have already cast a spell this round!").
 *
 * Until it has synced (three events at least, and enough confidence), it falls
 * back on time: `secs + 5` seconds between casts.
 *
 * Ticks are milliseconds (`GetTickCount64`, here the host's `tickMs`).
 */
import { dueOn } from '../abilities/monitors';
import type { Session } from '../Session';

const ROUND = 5000;
/** The confidence the cast gate wants before it trusts the round. */
const TRUSTED = 0x4b;

export const enum RoundEvent {
  Combat = 1,
  Experience = 2,
  SpellLock = 3,
  Probe = 4
}

/** `0x49b700`: where in a round `t` falls, ms. */
function phaseOf(t: number): number {
  return t % ROUND;
}

/** `0x49b770`: how far phase `a` comes after phase `b`, ms (0–4999). */
function phaseSince(a: number, b: number): number {
  const d = a - b;
  return d < 0 ? d + ROUND : d;
}

/** `0x49b530`: which round `t` is in. */
function roundOf(s: Session, t: number): number {
  return Math.floor((t - s.roundAnchor) / ROUND);
}

/** `0x49b5d0`: when the round `t` is in began. */
function roundStart(s: Session, t: number): number {
  return t - phaseSince(phaseOf(t), s.roundAnchor);
}

/** `0x49b890`: rounds are synced, sampled three times, and trusted to `need`. */
function synced(s: Session, need: number): boolean {
  return s.roundSynced === 1 && s.roundSamples > 2 && need <= s.roundConfidence;
}

/** `0x49b870`. */
function trusted(s: Session): boolean {
  return synced(s, TRUSTED);
}

/** `0x49bfd0`: a round has begun since `from` (and rounds are trusted). */
function roundSince(s: Session, from: number, t: number, need: number): boolean {
  if (!synced(s, need) || from === 0) return false;
  return roundOf(s, from) < roundOf(s, t);
}

/** `0x49b4d0`: rounds now begin at phase `anchor`. */
function resync(s: Session, anchor: number): void {
  s.roundAnchor = anchor;
  s.roundJumps = 0;
  s.roundJumpPhase = 0;
  s.roundSlips = 0;
  s.roundSlipPhase = 0;
  s.roundOffCount = 0;
}

/**
 * `0x49b220`: a round event at phase `phase`. On the round (within 150 ms) it
 * confirms it; three slipping events that agree, or two far-off ones, move it.
 */
function sample(s: Session, phase: number): void {
  const samples = s.roundSamples;
  if (s.roundSynced !== 1) {
    s.roundAnchor = phase;
    s.roundSynced = 1;
    s.roundDrift = 0;
    s.roundOffCount = 0;
    s.roundJumps = 0;
    s.roundJumpPhase = 0;
    s.roundSlips = 0;
    s.roundSlipPhase = 0;
    if (samples < 0x20) s.roundSamples = samples + 1;
    return;
  }
  const drift = phaseSince(phase, s.roundAnchor);
  s.roundDrift = drift;
  if (samples < 0x20) s.roundSamples = samples + 1;
  if (drift <= 0x96) {
    s.roundOffCount = 0;
    s.roundJumps = 0;
    s.roundSlips = 0;
    return;
  }
  let anchor: number;
  if (drift <= 0x9c4) {
    if (s.roundOffCount < 0x20) s.roundOffCount += 1;
    s.roundJumps = 0;
    if (s.roundSlips === 0) {
      s.roundSlipPhase = phase;
      s.roundSlips = 1;
      return;
    }
    anchor = s.roundSlipPhase;
    if (phaseSince(phase, anchor) > 0x9c4) {
      s.roundSlipPhase = phase;
      anchor = phase;
    }
    s.roundSlips += 1;
    if (s.roundSlips < 3) return;
  } else {
    s.roundSlips = 0;
    if (s.roundJumps === 0) {
      s.roundJumpPhase = phase;
      s.roundJumps = 1;
      return;
    }
    anchor = s.roundJumpPhase;
    const apart = phaseSince(phase, anchor);
    if (apart > 0x9c4) {
      s.roundJumpPhase = phase;
      anchor = phase;
    } else if (apart > 0x96) {
      s.roundJumpPhase = phase;
      s.roundJumps = 1;
      return;
    }
    s.roundJumps += 1;
    if (s.roundJumps < 2) return;
  }
  resync(s, anchor);
  s.roundDrift = phaseSince(phase, s.roundAnchor);
}

/**
 * `0x49be90`: how far the round's timing is trusted: ten points a sample (from
 * 40), less five for each event off the round (up to 25), no more than the
 * event's own kind is worth, and no more than 60 under three samples.
 */
function confidence(s: Session): void {
  let c = Math.min((s.roundSamples + 4) * 10, 100);
  if (s.roundOffCount > 0) c -= Math.min(s.roundOffCount * 5, 25);
  if (s.roundEventKind === RoundEvent.Combat || s.roundEventKind === RoundEvent.Probe) {
    const worth = s.roundEventKind === RoundEvent.Combat ? 0x5a : 0x5f;
    c = Math.min(c, worth + 5);
  }
  c = Math.min(c, s.roundSamples < 3 ? 0x3c : 100);
  s.roundConfidence = Math.max(c, 0);
}

/** `0x49b610`: a round has passed since the last event: the cast and lock are spent. */
function roundPassed(s: Session, last: number, t: number, kind: number): void {
  if (s.roundSynced !== 1 || last === 0) return;
  if (roundOf(s, last) >= roundOf(s, t)) return;
  if (s.debug !== 0) s.host.trace(`{rnd:${kind}}`);
  // `0x402f60`: the monitors checked after a combat round.
  if (s.inCombat !== 0) dueOn(s, 8);
  s.spellLock = 0;
  s.spellLockAt = 0;
  s.spellLockLifted = 0;
  s.castStamped = 0;
  s.castTick = 0;
}

/**
 * `0x49b9a0` (and `0x49bb00`, which only adds a no-op before it): something
 * that happens on a round. Events closer than 1.5 s are one event. A blow or a
 * probe tunes the round's timing; a probe also counts as a cast.
 */
export function roundEvent(s: Session, kind: RoundEvent): void {
  if (kind === RoundEvent.SpellLock) {
    spellLocked(s);
    return;
  }
  const t = s.host.tickMs();
  const last = s.roundEventAt;
  if (last !== 0 && t - last < 0x5dc) {
    s.roundEventAt = t;
    return;
  }
  s.roundEvents += 1;
  s.roundEventAt = t;
  s.roundEventKind = kind;
  roundPassed(s, last, t, kind);
  if (kind === RoundEvent.Combat || kind === RoundEvent.Probe) sample(s, phaseOf(t));
  confidence(s);
  if (kind === RoundEvent.Probe) {
    clearStamps(s);
    castStamp(s);
  }
  s.spellLocks = 0;
  s.spellLockStuck = 0;
}

/** `0x49bb30`: the game refused a spell, one was already cast this round. */
export function spellLocked(s: Session): void {
  s.spellLock = 1;
  s.spellLockAt = s.host.tickMs();
  s.spellLocks += 1;
  if (s.spellLocks > 2) s.spellLockStuck = 1;
}

/** `0x49b080`: a spell was cast now. */
export function castStamp(s: Session): void {
  s.castAt = s.now;
  s.castStamped = 1;
  s.castTick = s.host.tickMs();
  s.spellLock = 0;
  s.spellLockAt = 0;
  s.spellLockLifted = 0;
}

/** `0x49ade0`. */
function clearStamps(s: Session): void {
  s.castStamped = 0;
  s.spellLock = 0;
  s.spellLockAt = 0;
  s.spellLockLifted = 0;
}

/** `0x49ad90`: the cast is over (it failed, or the fight ended): forget it. */
export function castForgotten(s: Session): void {
  s.castAt = 0;
  if (!trusted(s)) {
    clearStamps(s);
    s.castTick = 0;
  }
}

/**
 * `0x49bb90`: let the stamps lapse. A spell lock lapses after five seconds, or
 * when a trusted round begins (once half a second into it); a cast stamp when
 * the next trusted round begins, or after five seconds untrusted.
 */
function lapse(s: Session): void {
  const t = s.host.tickMs();
  const sure = trusted(s);
  if (s.spellLock !== 0) {
    if (s.spellLockAt === 0) s.spellLockAt = t;
    const at = s.spellLockAt;
    if (
      sure &&
      s.spellLockLifted === 0 &&
      roundSince(s, at, t, TRUSTED) &&
      t - roundStart(s, t) >= 500
    ) {
      s.spellLock = 0;
      s.spellLockAt = 0;
      s.spellLockLifted = 1;
    }
    let over = false;
    if (t - at >= ROUND) {
      over = true;
      if (sure && roundSince(s, at, t, TRUSTED) && t - roundStart(s, t) < 500) over = false;
    }
    if (s.spellLock !== 0 && over) {
      s.spellLock = 0;
      s.spellLockAt = 0;
      s.spellLockLifted = 0;
    }
  }
  if (s.castStamped !== 0) {
    if (s.castTick === 0) s.castTick = t;
    if (!sure) {
      if (t - s.castTick < ROUND) return;
      s.castStamped = 0;
      s.castTick = 0;
      return;
    }
    if (!roundSince(s, s.castTick, t, TRUSTED)) return;
    s.castStamped = 0;
  } else if (!sure) {
    return;
  }
  if (s.castTick !== 0 && t - roundStart(s, t) >= 500 && roundSince(s, s.castTick, t, TRUSTED)) {
    s.castTick = 0;
  }
}

/**
 * `0x49af70`: too soon to cast. Locked out, or (trusted) already cast this
 * round, in the first half of the round with `CastEndOfRound`, or in its first
 * half second just after a cast; untrusted, under `secs + 5` seconds since
 * the last cast.
 */
export function tooSoon(s: Session, secs: number): boolean {
  lapse(s);
  if (s.spellLock !== 0) return true;
  if (trusted(s)) {
    if (s.castStamped !== 0) return true;
    const t = s.host.tickMs();
    const into = t - roundStart(s, t);
    if (s.Other_CastEndOfRound !== 0 && into < 0x9c4) return true;
    return s.castTick !== 0 && into < 500;
  }
  const wait = Math.max(secs, 0) + 5;
  if (s.castTick !== 0) return s.host.tickMs() - s.castTick < wait * 1000;
  if (s.castAt !== 0) return s.now - s.castAt < wait;
  return false;
}

/** `0x49af50`. */
export function castAllowed(s: Session, secs: number): boolean {
  return !tooSoon(s, secs);
}

/** `0x426eb0`: a blow struck this round (by anyone): a combat round event. */
export function blowStruck(s: Session): void {
  s.f_32600 = 1;
  s.f_32604 = 1;
  s.f_3260c = 1;
  roundEvent(s, RoundEvent.Combat);
}
