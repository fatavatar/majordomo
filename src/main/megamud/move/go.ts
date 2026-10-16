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
import { setTask } from '../script/task';
import type { Session } from '../Session';
import { goTo, headFor } from './destinations';
import { findPath, showPath } from './path';

/** `0x4c0500`: the opposite direction (-1 for none). */
export function reverse(dir: number): number {
  return [1, 0, 3, 2, 7, 6, 5, 4, 9, 8][dir] ?? -1;
}

/** `0x40da90`: HP under `HpLogoff%`: movement held, resting to full. */
export function holdForHp(s: Session): number {
  if (belowLogoff(s, s.hp) === 0) return 0;
  s.restHpToFull = 1;
  s.f_e23c = 1;
  s.mustRest = 1;
  s.runCount = 0;
  s.rescueCount = 0;
  s.hpFullAt = 0;
  if (s.restReason === '') s.restReason = "resting HP's to full";
  s.host.activity("Holding movement; HP's critically low");
  return 1;
}

/** `0x4b7ed0`: the time spent still (`0x326a8` → `0x32708`) tallied, the time moving (`0x326a0`) started. */
export function movingClock(s: Session): void {
  if (s.f_326a8 !== 0) {
    s.f_32708 += s.now - s.f_326a8;
    s.f_326a8 = 0;
  }
  // `0x4b7f10`: the times shown (the window's).
  if (s.f_326a0 === 0) s.f_326a0 = s.now;
}

/** `0x474910`: the players seen here forgotten (`0x8000`; with `all`, their counts too). */
function forgetSeen(s: Session, all: number): void {
  if (all !== 0) s.f_32528 = 0;
  for (const p of s.data.players ?? []) {
    p.flags &= ~0x8000;
    if (all !== 0) p.seen = 0;
  }
}

/** What leaving a room resets, `0x408540`'s and `0x409170`'s alike. */
export function leaving(s: Session): void {
  s.f_32320 = s.now;
  s.f_32310 = 0;
  s.runDirection = -1;
  s.hidden = 0;
  s.sneaking = 0;
  s.waitLines = 2;
  s.f_e21c = 0;
  s.f_e2d8 = 0;
  s.f_e170 = 1;
  s.f_e2dc = 0;
  s.f_e2e0 = 0;
  s.f_e2e4 = 0;
  s.f_e360 = 0;
  s.f_e2ec = 0;
  s.f_e1e8 = 0;
  s.f_e2b4 = 0;
  s.f_845c = 0;
  s.f_e220 = 0;
  s.f_e1e0 = 0;
  s.f_e1e4 = 0;
  s.f_8558 = 0;
  s.f_8be4 = 0;
  clearAlignment(s);
  s.f_db60 = s.Other_SearchMax;
  s.f_db68 = 0;
  s.f_db6c = 0;
  s.stepTries = 0;
  s.f_db48 = 0;
  s.f_db50 = 0;
  s.f_db58 = 0;
  s.hpFullAt = 0;
  s.manaFullAt = 0;
  s.f_dd0c = 0;
  clearTargetCasts(s);
  clearMultiCounts(s);
  if (s.f_a580 === 0) clearCastMode(s);
  s.f_3268c += 1;
  unkeepAll(s);
  forgetSeen(s, 0);
  setState(s, 0x16);
}

/** A run or rescue step spent. */
export function spendRun(s: Session): void {
  if (s.runCount > 0) {
    s.f_907c = 0;
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
  if (dir >>> 0 > 9 || (s.f_a32c !== 0 && go === 1) || s.f_e398 !== 0) return 0;
  if (go === 1 && holdForHp(s) !== 0) return 0;
  s.f_8138 = 0;
  if (s.f_a32c === 0) {
    const rested = postRest(s, 6, 0);
    const meditated = postMeditate(s, 0);
    if (go !== 0 && (rested !== 0 || meditated !== 0)) return 1;
  }
  if (s.f_a328 !== 0) {
    s.f_a328 = 0;
    s.MegaMud_AutoCombat = 0;
  }
  movingClock(s);
  s.moveDir = dir;
  s.f_e1d0 = 0;
  s.f_e198 = 0;
  leaving(s);
  s.host.activity(`Moving: ${directionShort(dir)}`);
  spendRun(s);
  if (go !== 0) send(s, `${directionShort(dir)}\r`);
  if (s.f_e1e0 !== 0) {
    s.f_8468 = 0;
    s.f_e1e0 = 0;
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
    c.flags &= ~0x200;
    if (item.type !== 1 && (item.type !== 0 || item.location === 0)) return 1;
    return (c.flags & 1) === 0 ? 1 : 0;
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
      setTask(s, 0xb);
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
  if (s.f_a32c !== 0 || dir >>> 0 > 9 || s.hp < 1) return 0;
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
  if ((flags & 0x200) !== 0 && s.Other_CanDisarmTraps !== 0) {
    if (s.f_e2e0 === 0) {
      atDoor(s);
      setState(s, 0x21);
      s.host.activity('Searching for trap');
      send(s, `search ${directionShort(dir)}\r`);
      return 1;
    }
    if (s.f_e2e4 === 0 && s.f_db58 < s.Other_DisarmMax) {
      atDoor(s);
      s.f_db58 += 1;
      setState(s, 0x19);
      s.host.activity('Disarming trap');
      send(s, `disarm trap ${directionShort(dir)}\r`);
      return 1;
    }
  }
  let opening = s.f_e2dc;
  if (opening !== 0 && s.roomExits[dir] !== 2 && s.roomExits[dir] !== 5) {
    s.f_e2dc = 0;
    opening = 0;
  }
  const exit = s.roomExits[dir];
  if (exit === 5 || opening !== 0) {
    s.f_e2dc = 0;
    s.moveDir = dir;
    atDoor(s);
    setState(s, 0x1a);
    s.host.activity('Opening door');
    send(s, `open ${directionShort(dir)}\r`);
    return 1;
  }
  if ((exit === 2 || exit === 0) && key !== null) {
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
      setState(s, 0x1a);
      s.moveDir = dir;
      s.sneaking = 0;
      s.hidden = 0;
      if (worthEquipping(s, parts[0]!) !== 0) {
        s.host.activity('Re-showing room exits');
        s.f_e290 = 1;
        s.waitLines = 2;
        send(s, parts[0]!);
        send(s, '\r');
      }
      for (const part of parts.slice(1)) queue(s, `${part.slice(0, 99)}\r`);
      return 1;
    }
  }
  if (s.roomExits[dir] !== 2) return 0;
  if (s.walking !== 0 && s.runCount !== 0 && s.Other_BashMax <= s.f_db48) {
    s.f_db48 = 0;
    s.f_db50 = 0;
    if (runBack(s, 0) !== 0) return 1;
  }
  atDoor(s);
  if (s.Other_CanPickLocks === 0 || s.Other_PickMax * 2 <= s.f_db50) {
    setState(s, 0x17);
    s.host.activity('Bashing door');
    send(s, `bash ${directionWord(dir)}\r`);
  } else {
    setState(s, 0x18);
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
      s.f_a32c === 0 &&
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
        s.host.post?.(0x869);
        return 1;
      }
      if (s.f_e298 !== 0) return 0;
      if (move(s, back, 1) === 0) return 0;
      if (s.task === 0xe) s.stepsToGo += s.MegaMud_CurPathStep - i;
      showPath(s);
      setTask(s, s.task);
      if ((st.flags & 0x40) !== 0) s.f_e21c = 1;
      if ((st.flags & 0x20) !== 0) s.f_e21c = 1;
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
    if (exit !== 0) {
      if (s.roaming === 0) allowed = true;
      else if ((s.f_db34 === -1 || s.f_db34 !== dir) && (bit & s.Auto_roam_AutoMove) !== 0) {
        allowed = exit === 1 || (bit & s.Auto_roam_AutoDoor) !== 0;
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
    if (s.f_db34 === s.moveDir || dir !== reverse(s.moveDir)) return dir;
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
    if (s.roomExits[dir] === 0) continue;
    if (found !== -1) return -1;
    found = dir;
  }
  return found === -1 ? back : found;
}
