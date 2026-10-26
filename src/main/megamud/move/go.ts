/**
 * Moving, read 2026-10-13: a step out of the room (`0x408540`), and what
 * comes before it at a door or trap (`0x408870`): searching for and
 * disarming a trap, opening a door, a step's `[key]` text (`use key`, or
 * `fail` to give the path up), picking the lock or bashing it. Running back
 * along the path (`0x40ae00`), a roaming exit (`0x437b50`), and the HP too
 * low to move at all (`0x40da90`).
 */
import {
  clearAlignment,
  clearCastMode,
  clearMultiCounts,
  clearTargetCasts
} from '../combat/engaged';
import { directionShort, directionWord, strnicmp, stricmp, typedDirection } from '../cstr';
import { belowLogoff } from '../health/flux';
import { postMeditate, postRest } from '../health/prepost';
import { unkeepAll } from '../room/entities';
import { reEngage, modeDefaults } from '../script/modes';
import { queue, rand, send } from '../script/send';
import { setState } from '../script/state';
import { sneakStep } from '../script/stealth';
import { setTask, Task } from '../script/task';
import type { Session } from '../Session';
import { goTo, headFor } from './destinations';
import { findPath, showPath } from './path';
import { State } from '../states';
import { PlayerFlag, CarriedFlag, StepFlag, Exit } from '../flags';
import { WindowCommand } from '../../../shared/megamud/toggles';

/** `0x4c0500`: the opposite direction (-1 for none). */
export function reverse(dir: number): number {
  return [1, 0, 3, 2, 7, 6, 5, 4, 9, 8][dir] ?? -1;
}

/** `0x40da90`: HP under `HpLogoff%`: movement held, resting to full. */
export function holdForHp(s: Session): number {
  if (belowLogoff(s, s.hp) === 0) return 0;
  s.restHpToFull = 1;
  s.healthFirst = 1;
  s.mustRest = 1;
  s.runCount = 0;
  s.rescueCount = 0;
  s.hpFullAt = 0;
  if (s.restReason === '') s.restReason = "resting HP's to full";
  s.host.activity("Holding movement; HP's critically low");
  return 1;
}

/** `0x474910`: the players seen here forgotten (`0x8000`; with `all`, their counts too). */
function forgetSeen(s: Session, all: number): void {
  for (const p of s.data.players ?? []) {
    p.flags &= ~PlayerFlag.SeenThisSession;
    if (all !== 0) p.seen = 0;
  }
}

/** What leaving a room resets, `0x408540`'s and `0x409170`'s alike. */
export function leaving(s: Session): void {
  s.movedAt = s.now;
  s.restAskedAt = 0;
  s.runDirection = -1;
  s.hidden = 0;
  s.sneaking = 0;
  s.waitLines = 2;
  s.dontAttackHere = 0;
  s.arrivedWhileWalking = 0;
  s.lowHpArmed = 1;
  s.openDoorNext = 0;
  s.trapFound = 0;
  s.trapDisarmed = 0;
  s.partyAskPending = 0;
  s.partyLost = 0;
  s.lightRemovedToTest = 0;
  s.dontRestHere = 0;
  s.bankedHere = 0;
  s.areaWarned = 0;
  s.cannotDropHere = 0;
  s.corpseTried = 0;
  s.recoveringCorpse = 0;
  s.engagedHere = 0;
  clearAlignment(s);
  s.searchesLeft = s.Other_SearchMax;
  s.stealthRefused = 0;
  s.stealthFails = 0;
  s.stepTries = 0;
  s.bashTries = 0;
  s.pickTries = 0;
  s.knockTries = 0;
  s.disarmTries = 0;
  s.hpFullAt = 0;
  s.manaFullAt = 0;
  s.attacksRefused = 0;
  clearTargetCasts(s);
  clearMultiCounts(s);
  if (s.multiAttacking === 0) clearCastMode(s);
  unkeepAll(s);
  forgetSeen(s, 0);
  setState(s, State.Moving);
}

/** A run or rescue step spent. */
export function spendRun(s: Session): void {
  if (s.runCount > 0) {
    s.runByChoice = 0;
    s.runCount -= 1;
  }
  if (s.rescueCount > 0) s.rescueCount -= 1;
}

/**
 * `0x408540`: a step out by `dir`, sent when `go`: the post-rest and
 * post-meditate commands first, everything about this room let go. 0 when
 * no move is made.
 */
export function move(s: Session, dir: number, go: number): number {
  if (dir >>> 0 > 9 || (s.allOff !== 0 && go === 1) || s.movementHalted !== 0) return 0;
  if (go === 1 && holdForHp(s) !== 0) return 0;
  s.expectedRoom = 0;
  if (s.allOff === 0) {
    const rested = postRest(s, 6, 0);
    const meditated = postMeditate(s, 0);
    if (go !== 0 && (rested !== 0 || meditated !== 0)) return 1;
  }
  if (s.autoCombatForWait !== 0) {
    s.autoCombatForWait = 0;
    s.MegaMud_AutoCombat = 0;
  }
  s.moveDir = dir;
  s.hideAgain = 0;
  s.lostNeedsKnownRoom = 0;
  leaving(s);
  s.host.activity(`Moving: ${directionShort(dir)}`);
  spendRun(s);
  if (go !== 0) send(s, `${directionShort(dir)}\r`);
  if (s.cannotDropHere !== 0) {
    s.weightMax = 0;
    s.cannotDropHere = 0;
  }
  return 1;
}

/**
 * `0x4072b0`: whether a door's `eq <item>` is worth sending: not when the
 * item is a weapon, or worn armour, already equipped.
 */
function worthEquipping(s: Session, text: string): number {
  if (strnicmp(text, 'eq', 2) !== 0) return 1;
  const sp = text.indexOf(' ');
  if (sp === -1 || s.hp <= 0) return 1;
  let at = sp;
  while (text[at] === ' ') at += 1;
  const name = text.slice(at);
  for (const c of s.inventory) {
    const item = c.item;
    if (!item || strnicmp(name, item.name, item.name.length) !== 0) continue;
    c.flags &= ~CarriedFlag.EquipAsked;
    if (item.type !== 1 && (item.type !== 0 || item.location === 0)) return 1;
    return (c.flags & CarriedFlag.Equipped) === 0 ? 1 : 0;
  }
  return 1;
}

/** `0x407a00`: a door the path cannot pass: its retry path taken, else walking stops. */
function retryPath(s: Session): number {
  if (s.roaming === 0) {
    const p = s.path.retry !== '' ? findPath(s, s.path.retry) : null;
    if (p && goTo(s, 0, p) !== 0) {
      s.stepsToGo += p.count;
      s.detours[0]!.why = 'retrying';
      headFor(s, 0);
      return 1;
    }
    if (s.roaming === 0) {
      s.walking = 0;
      modeDefaults(s);
      reEngage(s);
      setTask(s, Task.InGame);
      return 0;
    }
  }
  s.moveDir = -1;
  return 0;
}

/** Stealth off before working at a door. */
function atDoor(s: Session): void {
  s.sneaking = 0;
  s.hidden = 0;
  s.waitLines = 2;
}

/**
 * `0x408870`: what a step by `dir` needs first (its path `flags` and
 * `command`): a trap searched for and disarmed (`0x200`), a door opened,
 * the `[key]` text, the lock picked or bashed. 1 when something was sent.
 */
export function doors(s: Session, dir: number, flags: number, command: string | null): number {
  if (s.allOff !== 0 || dir >>> 0 > 9 || s.hp < 1) return 0;
  const rested = postRest(s, 4, 0);
  const meditated = postMeditate(s, 0);
  if (rested !== 0 || meditated !== 0) return 1;
  s.moveDir = dir;
  let key: string | null = null;
  if (command !== null) {
    const open = command.indexOf('[');
    if (open !== -1) {
      key = command.slice(open + 1, open + 200);
      const close = key.indexOf(']');
      if (close !== -1) key = key.slice(0, close);
    }
  }
  if ((flags & StepFlag.DisarmTrap) !== 0 && s.Other_CanDisarmTraps !== 0) {
    if (s.trapFound === 0) {
      atDoor(s);
      setState(s, State.Searching);
      s.host.activity('Searching for trap');
      send(s, `search ${directionShort(dir)}\r`);
      return 1;
    }
    if (s.trapDisarmed === 0 && s.disarmTries < s.Other_DisarmMax) {
      atDoor(s);
      s.disarmTries += 1;
      setState(s, State.Disarming);
      s.host.activity('Disarming trap');
      send(s, `disarm trap ${directionShort(dir)}\r`);
      return 1;
    }
  }
  let opening = s.openDoorNext;
  if (opening !== 0 && s.roomExits[dir] !== Exit.ClosedDoor && s.roomExits[dir] !== Exit.Unlocked) {
    s.openDoorNext = 0;
    opening = 0;
  }
  const exit = s.roomExits[dir];
  if (exit === Exit.Unlocked || opening !== 0) {
    s.openDoorNext = 0;
    s.moveDir = dir;
    atDoor(s);
    setState(s, State.Opening);
    s.host.activity('Opening door');
    send(s, `open ${directionShort(dir)}\r`);
    return 1;
  }
  if ((exit === Exit.ClosedDoor || exit === Exit.None) && key !== null) {
    // A `use <key>` the character can pick past instead, when it has no such key.
    let useKey = s.Other_CanPickLocks === 0 || strnicmp(key, 'use ', 4) !== 0;
    if (!useKey) {
      const wanted = key.slice(4);
      useKey = s.inventory.some(
        (c) => c.item !== null && strnicmp(wanted, c.item.name, c.item.name.length) === 0
      );
    }
    if (useKey) {
      if (key === '' || stricmp(key, 'fail') === 0) return retryPath(s);
      const parts = key.split(',');
      setState(s, State.Opening);
      s.moveDir = dir;
      s.sneaking = 0;
      s.hidden = 0;
      if (worthEquipping(s, parts[0]!) !== 0) {
        s.host.activity('Re-showing room exits');
        s.lookDue = 1;
        s.waitLines = 2;
        send(s, parts[0]!);
        send(s, '\r');
      }
      for (const part of parts.slice(1)) queue(s, `${part.slice(0, 99)}\r`);
      return 1;
    }
  }
  if (s.roomExits[dir] !== Exit.ClosedDoor) return 0;
  if (s.walking !== 0 && s.runCount !== 0 && s.Other_BashMax <= s.bashTries) {
    s.bashTries = 0;
    s.pickTries = 0;
    s.knockTries = 0;
    if (runBack(s, 0) !== 0) return 1;
  }
  // Ours: a lock the realm says no skill opens, or none the character has,
  // is not picked or bashed at; the walk takes its retry path or stops.
  const may = s.host.forcible?.(dir) ?? { pick: true, bash: true };
  const pick = may.pick && s.Other_CanPickLocks !== 0 && s.pickTries < s.Other_PickMax * 2;
  // Ours: a lock it does not pick is knocked open where the book holds the
  // spell, before a bash, then opened; a lock still shut is knocked again.
  const knock = !pick && s.knockTries < s.Other_PickMax ? (may.knock ?? null) : null;
  if (!pick && knock === null && !may.bash) {
    s.host.show(`[The ${directionWord(dir)} exit is locked: it needs its key]`);
    s.pickTries = 0;
    s.knockTries = 0;
    return retryPath(s);
  }
  atDoor(s);
  if (knock !== null) {
    s.knockTries += 1;
    setState(s, State.Opening);
    s.host.activity('Knocking door open');
    send(s, `${knock} ${directionWord(dir)}\r`);
    queue(s, `open ${directionShort(dir)}\r`);
  } else if (!pick) {
    setState(s, State.Bashing);
    s.host.activity('Bashing door');
    send(s, `bash ${directionWord(dir)}\r`);
  } else {
    setState(s, State.Picking);
    s.host.activity('Picking door lock');
    send(s, `pi ${directionShort(dir)}\r`);
  }
  return 1;
}

/**
 * `0x40ae00`: back along the path, by the latest step before this one that
 * is a direction, reversed (running, or rescuing; `force` for the Step Back
 * command). 1 when something was sent.
 */
export function runBack(s: Session, force: number): number {
  if (
    force === 0 &&
    !(
      (s.sneaking === 0 || s.rescueCount !== 0) &&
      s.allOff === 0 &&
      (s.MegaMud_AutoCombat !== 0 || s.rescueCount !== 0)
    )
  )
    return 0;
  const steps = s.path.steps;
  if (steps !== null) {
    let i = s.MegaMud_CurPathStep;
    for (;;) {
      i -= 1;
      if (i < 0) i = s.path.count - 1;
      if (i === s.MegaMud_CurPathStep) break;
      const st = steps[i];
      if (!st) continue;
      const dir = typedDirection(st.command);
      if (dir === -1) continue;
      const back = reverse(dir);
      if (doors(s, back, st.flags, st.command) !== 0) return 1;
      if (sneakStep(s) !== 0) {
        // `0x460b90`: Step Back (`0x869`) again once the sneak is sent.
        s.host.post?.(WindowCommand.StepBack);
        return 1;
      }
      if (s.partyStepPending !== 0) return 0;
      if (move(s, back, 1) === 0) return 0;
      if (s.task === Task.Walking) s.stepsToGo += s.MegaMud_CurPathStep - i;
      showPath(s);
      setTask(s, s.task);
      if ((st.flags & StepFlag.DontAttackNext) !== 0) s.dontAttackHere = 1;
      if ((st.flags & StepFlag.DontAttackHere) !== 0) s.dontAttackHere = 1;
      s.path.prev = s.path.step;
      s.MegaMud_CurPathStep = i;
      s.path.step = i;
      if (s.debug !== 0) s.host.trace(`{mvb:${i}/${s.path.count}}`);
      s.chaseTarget = '';
      return 1;
    }
  }
  s.rescueCount = 0;
  return 0;
}

/**
 * `0x437b50`: an exit to roam by, at random: any exit; or while roaming,
 * one not back the way just come, in `Auto-roam.AutoMove`'s directions and,
 * for one not a plain exit, `AutoDoor`'s.
 * -1 for none.
 */
export function roamExit(s: Session): number {
  const ok: boolean[] = [];
  let count = 0;
  let last = -1;
  for (let dir = 0; dir < 10; dir += 1) {
    const exit = s.roomExits[dir] ?? 0;
    const bit = 1 << dir;
    let allowed = false;
    if (exit !== Exit.None) {
      if (s.roaming === 0) allowed = true;
      else if (
        (s.lastMoveDir === -1 || s.lastMoveDir !== dir) &&
        (bit & s.Auto_roam_AutoMove) !== 0
      ) {
        allowed = exit === Exit.Open || (bit & s.Auto_roam_AutoDoor) !== 0;
      }
    }
    ok.push(allowed);
    if (allowed) {
      count += 1;
      last = dir;
    }
  }
  if (count === 0) return -1;
  if (count === 1) return last;
  for (;;) {
    const dir = rand(s) % 10;
    if (!ok[dir]) continue;
    if (s.lastMoveDir === s.moveDir || dir !== reverse(s.moveDir)) return dir;
  }
}

/**
 * `0x437ae0`: the one exit (north to up; down is not looked at) other than
 * back the way just come; with none, back that way (exit or not); -1 when
 * there are two or more.
 */
export function awayExit(s: Session): number {
  let found = -1;
  let back = -1;
  for (let dir = 0; dir < 9; dir += 1) {
    if (dir === reverse(s.moveDir)) {
      back = dir;
      continue;
    }
    if (s.roomExits[dir] === Exit.None) continue;
    if (found !== -1) return -1;
    found = dir;
  }
  return found === -1 ? back : found;
}
