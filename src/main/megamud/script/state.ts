/**
 * Setting the activity state (`0x4aa770`) and forgetting a state the
 * scheduler was waiting on (`0x4a9c00`). Read 2026-10-12.
 */
import { enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { isCastState, State } from '../states';
import { refreshStatus } from '../status';
import { idiv } from '../cstr';
import { LineFlag } from '../flags';

/** `0x4a9c00`: if the state before, or the one awaited, is `state`, forget it. */
export function forgetAwaited(s: Session, state: number): void {
  if (s.stateBefore === state) s.stateBefore = State.Nothing;
  if (s.stateAwaited === state) s.stateAwaited = State.Nothing;
}

/**
 * `0x4aa770`: the activity becomes `next`.
 *
 * Two things change what it becomes. Going idle while a fight is on (combat
 * engaged, or a hostile monster here) picks the fight back up: the state
 * before, when that was an attack or a cast, otherwise idle. And going idle
 * while still meditating below `ManaFull%`, or with a rest to full owed and HP
 * or mana short of full, goes back to meditating (5) or resting (3).
 *
 * The attacks and casts (0x11, 0x12, 9–15) are also the state awaited
 * (`a440`), which the scheduler holds on until the server answers.
 */
export function setState(s: Session, next: number): void {
  const old = s.state;
  let resumed = false;
  let quiet = false;
  if (s.debug !== 0) {
    if (old === 0) {
      quiet =
        (s.stateBefore === State.Resting && next === State.Resting) ||
        (s.stateBefore === State.Meditating && next === State.Meditating);
    } else if (
      (old === 3 || old === 5) &&
      s.stateBefore === State.Nothing &&
      next === State.Nothing
    ) {
      quiet = true;
    }
  }
  if (
    next === State.Nothing &&
    (s.inCombat !== 0 || enemiesHere(s, 0) > 0) &&
    s.inGame !== 0 &&
    s.online !== 0
  ) {
    const before = s.stateBefore;
    if (before === 0x11 || before === 0x12 || isCastState(before)) resumed = true;
    else s.stateBefore = State.Nothing;
    next = s.stateBefore;
    s.state = next;
  }
  if (next !== s.state) {
    s.stateBefore = s.state;
    s.stateSince = s.now;
  }
  let awaited = false;
  if (next === State.Nothing) {
    const manaFull = idiv(s.Player_MaxMana * s.Health_ManaFullPct, 100);
    let meditate = false;
    if (s.resting === 0 || s.inGame === 0) {
      meditate = true;
    } else if (s.hp < idiv(s.Player_MaxHP * s.Health_HpFullPct, 100)) {
      next = State.Resting;
      s.state = State.Resting;
    } else if (s.restManaToFull === 0 || manaFull <= s.mana) {
      meditate = true;
    } else {
      next = State.Resting;
      s.state = State.Resting;
    }
    if (meditate) {
      if (s.meditating === 0 || s.inGame === 0 || manaFull <= s.mana) {
        s.state = next;
      } else {
        next = State.Meditating;
        s.state = State.Meditating;
      }
    }
    awaited = isCastState(next);
  } else {
    s.state = next;
    if (next === State.Inventory) s.inventoryQuietAt = s.host.tickMs();
    else if (next === State.Who) s.whoQuietAt = s.host.tickMs();
    else if (next === State.Top) s.topQuietAt = s.host.tickMs();
    awaited = next === State.Attacking || next === State.Backstabbing || isCastState(next);
  }
  if (awaited) s.stateAwaited = next;
  if (s.debug !== 0 && s.online !== 0) {
    const prompt =
      s.waitLines === 0 && s.waitPrompt === 0
        ? `{P${s.lineFlags & LineFlag.Prompted}}`
        : `{P${s.waitLines}${s.waitPrompt}${s.lineFlags & LineFlag.Prompted}}`;
    if (prompt !== s.lastPromptTrace) s.host.trace(prompt);
    s.lastPromptTrace = prompt;
    if (!quiet && (resumed || old !== next) && old + next > 0) {
      s.host.trace(`{A${old}${resumed ? '*' : ''}>${next}}`);
    }
  }
  refreshStatus(s);
}
