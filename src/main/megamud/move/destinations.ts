/**
 * Where MegaMUD is headed, read 2026-10-13: the destinations queued
 * (`0x8174`, ten, the first under way: a shop "for" an item, the bank "for
 * cash", the trainer, and back), and the way to the first (`0x43d2a0`). The
 * way is a path known whose start is here (`0x43fd90`, the host's route over
 * our world graph); a path's end that is the destination ends it, and with
 * nothing queued the loop is taken up again.
 */
import { dueOn } from '../abilities/monitors';
import { reEngage, modeDefaults } from '../script/modes';
import { fetchCash } from '../script/cash';
import { stamp } from '../script/events';
import { wake } from '../script/send';
import { setState } from '../script/state';
import { hideStep } from '../script/stealth';
import { setTask } from '../script/task';
import { findItem } from '../room/checkNames';
import type { RoomRec } from '../data';
import type { PathRec, Session } from '../Session';
import {
  clearPath,
  copyPath,
  findPath,
  freeSteps,
  loadPath,
  resync,
  showPath,
  stepsLeft
} from './path';

/** `0x4983d0`: the room Rooms.md has with this signature. */
export function roomBySignature(s: Session, sig: number): RoomRec | null {
  return s.data.rooms?.find((r) => r.signature === sig) ?? null;
}

/** `0x498470`: the room Rooms.md has by this name (exactly). */
export function roomByName(s: Session, name: string): RoomRec | null {
  return s.data.rooms?.find((r) => r.name === name) ?? null;
}

/** `0x43cb90`: this room is one Rooms.md has. */
export function roomKnownHere(s: Session): number {
  return (s.data.rooms ?? []).some((r) => r.signature === s.f_8130) ? 1 : 0;
}

/** `0x43cec0`: the destination's name: the loop's, else the room's (`0x80fb`). */
function showDestination(s: Session): void {
  if (s.looping !== 0) {
    s.destination = s.MegaMud_CurPath.slice(0, 0x34);
    return;
  }
  const room = roomBySignature(s, s.detours[0]!.room);
  s.destination = room ? room.name.slice(0, 0x34) : 'Unknown Room!';
}

/** `0x43ccd0`: detour `i` is done: the rest move up; the first done, the next is shown. */
export function detourDone(s: Session, i: number): number {
  if (s.detours[0]!.room === 0) return 0;
  s.detours.splice(i, 1);
  s.detours.push({ room: 0, path: '', why: '' });
  if (i === 0) showDestination(s);
  return 1;
}

/** `0x43cc70`: every destination dropped. */
export function clearDetours(s: Session): void {
  for (const d of s.detours) {
    d.room = 0;
    d.path = '';
    d.why = '';
  }
}

/**
 * `0x43fc60`: a destination put first (a room, or a path's start, by the
 * path's name), unless it is queued already or ten are. 1 when it was.
 */
export function goTo(s: Session, room: number, path: PathRec | null): number {
  const to = path ? path.start : room;
  if (to === 0) return 0;
  if (!path && s.detours.some((d) => d.room === to)) return 0;
  if (s.detours[9]!.room !== 0) return 0;
  s.detours.pop();
  s.detours.unshift({ room: to, path: path ? path.name.slice(0, 0xd) : '', why: '' });
  showDestination(s);
  return 1;
}

/** `0x4b4590`: walking (the path-start monitors due when it was not). */
export function startWalking(s: Session): void {
  if (s.walking === 0) dueOn(s, 0x10);
  s.walking = 1;
  s.roaming = 0;
  s.lost = 0;
  s.hidden = 0;
  s.f_e398 = 0;
}

/** The activity timers (`0x326a0`, `0x32700`: twelve start stamps and totals) cleared. */
function clearTimers(s: Session): void {
  const raw = s as unknown as Record<string, number>;
  for (let k = 0; k < 12; k += 1) {
    raw[`f_${(0x326a0 + k * 8).toString(16)}`] = 0;
    raw[`f_${(0x32700 + k * 8).toString(16)}`] = 0;
  }
}

/** Auto-combat and auto-heal back on for a loop (`AutoAutoCombat`, `AutoAutoHeal`). */
function loopEngage(s: Session): void {
  if (s.MegaMud_AutoCombat === 0 && s.Other_AutoAutoCombat !== 0) {
    s.MegaMud_AutoCombat = 1;
    s.host.show('[Auto-combat re-engaged]');
  }
  if (s.MegaMud_AutoHeal === 0 && s.Other_AutoAutoHeal !== 0) {
    s.MegaMud_AutoHeal = 1;
    s.host.show('[Auto-rest/heal re-engaged]');
  }
}

/** The loop taken up again from its start (`0x43d2a0` with no destination). */
function resumeLoop(s: Session): number {
  if (s.looping !== 0) s.f_db44 += 1;
  freeSteps(s.path);
  copyPath(s, s.path, s.loopPath, 1);
  s.MegaMud_CurPathStep = 0;
  s.path.prev = 0;
  s.path.step = 0;
  s.walking = 1;
  s.looping = 1;
  s.stepsToGo = s.path.count;
  goTo(s, 0, s.path);
  setTask(s, 0xf);
  setState(s, 0);
  showPath(s);
  loopEngage(s);
  dueOn(s, 0x10);
  wake(s);
  return 0;
}

/** `0x43d030`: the item a way needs fetched by its "if needed" path. */
function itemByPath(s: Session, how: number, item: string): number {
  let result = 0x10;
  s.s_8474 = item.slice(0, 0x1e);
  const rec = findItem(s, s.s_8474);
  if (rec && (rec.flags & 0x20) !== 0 && rec.ifNeeded !== '') {
    const p = findPath(s, rec.ifNeeded);
    if (p && goTo(s, 0, p) !== 0) {
      s.detours[0]!.why = `for ${item}`.slice(0, 0x31);
      result = headFor(s, how);
      if (result === 0) return 0;
      if (result === 0x20) return 0x20;
      if (how === 0) return 0;
    }
  }
  if (s.f_e36c === 1) return 0;
  if (how !== 0) {
    s.f_e36c = 1;
    if (!s.host.ask?.(`You need a ${s.s_8474} to go here.\nDo you wish to continue?`))
      result = 0x20;
  }
  return result;
}

/** `0x43d130`: the item a way needs bought at its shop (the bank first, when short). */
function itemByShop(s: Session, how: number, item: string): number {
  let result = 0x10;
  s.s_8474 = item.slice(0, 0x1e);
  const rec = findItem(s, s.s_8474);
  if (rec && (rec.flags & 4) !== 0 && rec.shop !== '') {
    const shop = roomByName(s, rec.shop);
    if (shop) {
      let price = rec.price;
      if (s.Player_Charm < 0x32) price += Math.trunc(((0x32 - s.Player_Charm) * price * 2) / 100);
      if (s.f_8428 >>> 0 < price >>> 0) return fetchCash(s, 0, price);
      if (s.f_8130 !== shop.signature && goTo(s, shop.signature, null) !== 0) {
        s.detours[0]!.why = `for ${item}`.slice(0, 0x31);
        result = headFor(s, how);
        if (result === 0) return 0;
        if (result === 0x20) return 0x20;
        if (how === 0) return 0;
      }
    }
  }
  if (s.f_e36c === 1) return 0;
  if (how === 0) return result;
  s.f_e36c = 1;
  return s.host.ask?.(`You need a ${s.s_8474} to go here.\nDo you wish to continue?`) ? 0 : 0x20;
}

/** `ABCDWXYZ.MP` → `WXYZABCD.MP`: the path back, its file's two room codes swapped (C strings: a short name stops short). */
function backName(cur: string): string {
  const a = cur.slice(4, 8);
  if (a.length < 4) return a;
  const b = cur.slice(0, 4);
  return b.length < 4 ? a + b : `${a}${b}.MP`;
}

/**
 * `0x43d2a0`: on to the first destination. `how` 0 from the walk, 1 the Go
 * To dialog (the app's: taken as chosen), anything else a fresh start; a
 * fresh start ends at a destination that is here. 0 on the way, 0x20
 * cancelled, else why not (`0x43fd90`'s flags).
 */
export function headFor(s: Session, how: number): number {
  const wasWalking = s.walking;
  if (how !== 0) {
    if (how === 1) {
      // `0x4bf670`: the Go To dialog (the app's).
      s.f_e36c = 0;
      s.f_a32c = 0;
    }
    s.stepsToGo = 0;
    s.f_db44 = 0;
    how = -1;
    if (s.detours[0]!.room === s.f_8130 && s.detours[1]!.room === 0 && s.detours[0]!.path === '') {
      detourDone(s, 0);
      clearPath(s.path);
      clearPath(s.loopPath);
      s.walking = 0;
      s.looping = 0;
      s.lost = 0;
      s.roaming = 0;
      if (s.detourCombat !== -1) s.MegaMud_AutoCombat = s.idleCombat;
      if (s.f_e21c !== 0) {
        s.f_e21c = 0;
        s.host.show("[Don't attack flag cleared from room.]");
      }
      modeDefaults(s);
      reEngage(s);
      setTask(s, 0xb);
      showPath(s);
      return 0x20;
    }
    // `0x43ce40`: the Go To dialog's recent rooms (the app's).
    s.walking = 1;
    s.looping = 0;
    s.roaming = 0;
    s.lost = 0;
    s.f_e194 = 0;
    s.f_e198 = 0;
    s.f_e2dc = 0;
    s.f_8b64 = 0;
    s.held = 0;
    s.partyWait = 0;
    s.f_8430 = 0;
    s.s_8474 = '';
    s.f_324d0 = s.exp - s.f_324c8;
    s.f_322b0 = s.now;
    s.f_322b8 = s.now;
    s.stepsToGo = 0;
    s.f_324c8 = s.exp;
    clearTimers(s);
    s.hidden = 0;
  }
  if (s.detours[0]!.room !== 0 && resync(s, s.path) === 0) {
    const want = s.detours[0]!.path;
    if (want !== '' && want !== s.MegaMud_CurPath) {
      freeSteps(s.path);
      s.MegaMud_CurPath = want.slice(0, 0xd);
      if (loadPath(s, s.path) === 0) {
        clearPath(s.path);
        detourDone(s, 0);
        return 0x20;
      }
    }
  }
  if (s.f_9104 !== 0 && s.f_8130 === s.f_9104) {
    s.f_e1a0 = 0;
    s.f_9104 = 0;
  }
  let dest = s.detours[0]!.room;
  if (s.f_8130 === dest) {
    for (;;) {
      if (s.detours[0]!.path !== '' && s.MegaMud_SelPath !== s.MegaMud_CurPath) {
        // At a detour's path's start: on to its end.
        s.detours[0]!.room = s.path.end;
        s.detours[0]!.path = '';
        dest = s.detours[0]!.room;
        if (s.f_8130 === dest) {
          s.MegaMud_CurPathStep = 0;
          s.path.prev = 0;
          s.path.step = 0;
          s.walking = 1;
          dueOn(s, 0x10);
          showDestination(s);
          setTask(s, 0xe);
          showPath(s);
          modeDefaults(s);
          return 0;
        }
        break;
      }
      detourDone(s, 0);
      dest = s.detours[0]!.room;
      if (dest === 0) {
        s.detourCombat = -1;
        break;
      }
      if (s.f_8130 !== dest) break;
    }
  }
  if (dest === 0) {
    if (s.loopPath.start !== 0 && s.loopPath.start === s.loopPath.end) return resumeLoop(s);
    s.walking = 0;
    modeDefaults(s);
    reEngage(s);
    setTask(s, 0xb);
    hideStep(s);
    s.host.alert?.('idle');
    return 0;
  }
  if (roomKnownHere(s) === 0) {
    s.stepsToGo = -1;
    if (resync(s, s.path) === 0) {
      if (resync(s, s.loopPath) === 0) {
        s.lost = 1;
        s.walking = 1;
        s.looping = 0;
      } else {
        freeSteps(s.path);
        copyPath(s, s.path, s.loopPath, 1);
      }
      return arrive(s, 0, 0);
    }
    if (s.detours[0]!.room !== s.path.start) return arrive(s, 1, 0);
    const back = backName(s.MegaMud_CurPath);
    if (!findPath(s, back)) {
      if (s.path.start === s.path.end && s.path.start === s.loopPath.end) {
        s.f_db44 = -1;
        s.looping = 1;
        setTask(s, 0xf);
        setState(s, 0);
        showPath(s);
        loopEngage(s);
        wake(s);
        return 0;
      }
      return arrive(s, 1, 0);
    }
    freeSteps(s.path);
    s.MegaMud_CurPath = back.slice(0, 0xd);
    loadPath(s, s.path);
    return arrive(s, 0, 0);
  }
  const task = s.task;
  setTask(s, 0xd);
  const way = s.host.route?.(s.f_8130, dest) ?? { flags: 1, path: null, steps: -1 };
  setTask(s, task);
  s.lost = 0;
  s.walking = 0;
  s.looping = 0;
  s.stepsToGo = way.steps;
  let flags = way.flags;
  if (flags !== 0 && flags !== 0x20) {
    if (flags === 1) {
      if (s.detours[0]!.room === s.f_8130) {
        detourDone(s, 0);
        return headFor(s, 0);
      }
      if (s.f_e194 === 0) {
        if (how === 0) s.host.alert?.('idle');
        const room = roomBySignature(s, s.detours[0]!.room);
        const text = room
          ? `There are no paths defined to get from the current room to "${room.name}"`
          : `There are no paths defined to get from the current room to room ${hex8(s.detours[0]!.room)}.`;
        s.host.show(`[${text} (${stamp(s)})]`);
        s.host.message?.(text);
        s.f_e194 = 1;
      }
      if (how === 0) {
        s.lost = 1;
        s.f_e198 = 1;
        s.walking = 1;
        s.looping = 0;
      }
      return arrive(s, 0, flags);
    }
    if ((flags & 8) !== 0) {
      const got = fetchCash(s, how, (way.gold ?? 0) * 100);
      if (got === 0x20) {
        clearDetours(s);
        return arrive(s, 0, 0x20);
      }
      if (got === 0) flags &= ~8;
      else if ((got & 0x10) !== 0) flags |= 0x10;
    }
    if ((flags & 0x10) !== 0) {
      let got = itemByPath(s, how, way.item ?? '');
      if (got === 0x10) got = itemByShop(s, 0, way.item ?? '');
      if (got === 0x20) {
        clearDetours(s);
        return arrive(s, 0, 0x20);
      }
      if (got === 0) flags &= ~0x10;
    }
    if ((flags & 6) !== 0) {
      if (how === 0 && s.f_e36c !== 0) {
        flags &= ~6;
      } else {
        if (how === 0) s.host.alert?.('idle');
        const min = way.minLevel ?? 0;
        const max = way.maxLevel ?? 999;
        let text =
          (flags & 6) === 6
            ? `You must be between levels ${min} and ${max} to go here`
            : (flags & 2) !== 0
              ? `You must be at least level ${min} to go here`
              : `You cannot go here now that you are past level ${max}`;
        if (way.via !== undefined && way.via !== s.detours[0]!.room) {
          const room = roomBySignature(s, way.via);
          text += ` (because\nyou would need to go via "${room ? room.name : '*Unknown*'}")`;
        }
        text += '.';
        if (how === 0) {
          s.host.message?.(text);
        } else {
          const yes = s.host.ask?.(`${text}\n\nContinue Anyway?`) ?? false;
          s.f_e36c = yes ? 1 : 0;
          if (yes) flags &= ~6;
        }
      }
    }
  }
  if ((flags === 8 || flags === 0x10 || flags === 0x18) && how === 0) {
    flags = 0;
  } else if (flags !== 0) {
    if (flags === 0x20) clearDetours(s);
    return arrive(s, 0, flags);
  }
  s.f_e194 = 0;
  s.f_e198 = 0;
  freeSteps(s.path);
  if (way.special !== undefined && way.special < 0) {
    const end = SYS_GOTO[way.special];
    if (end !== undefined) s.path.end = end;
  } else if (!way.path || copyPath(s, s.path, way.path, 1) === 0) {
    return 0x20;
  }
  s.MegaMud_CurPathStep = 0;
  s.path.prev = 0;
  s.path.step = 0;
  s.walking = 1;
  if (how !== 0 || wasWalking === 0) dueOn(s, 0x10);
  s.f_32300 = 0;
  s.resting = 0;
  s.meditating = 0;
  s.restHpToFull = 0;
  s.restManaToFull = 0;
  s.hpFullAt = 0;
  s.manaFullAt = 0;
  return arrive(s, 0, flags);
}

/** A MUD op's `sys goto` destinations (`0x43fd90`'s -3 to -8), as the rooms they reach. */
const SYS_GOTO: Record<number, number> = {
  [-8]: 0x11e00004,
  [-7]: 0x85400000 | 0,
  [-6]: 0xa6e00055 | 0,
  [-5]: 0xebf00006 | 0,
  [-4]: 0xd9c10000 | 0,
  [-3]: 0xabc10002 | 0
};

function hex8(n: number): string {
  return (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/** The end of `0x43d2a0`: the destination shown, the task set, hidden or woken. */
function arrive(s: Session, resynced: number, result: number): number {
  if (s.walking !== 0) showDestination(s);
  let task: number;
  if (s.lost === 0) {
    if (s.stepsToGo < 0 && resynced !== 0) s.stepsToGo = stepsLeft(s);
    task = s.walking !== 0 ? 0xe : 0xb;
  } else {
    s.stepsToGo = -1;
    task = 0x11;
  }
  setTask(s, task);
  showPath(s);
  modeDefaults(s);
  if (s.walking === 0) hideStep(s);
  else wake(s);
  return result;
}
