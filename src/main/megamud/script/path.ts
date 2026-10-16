/**
 * The scheduler's walking steps, read 2026-10-13: an imported path's
 * commands (D44, `0x407c90`), roaming and the way back when lost (D47,
 * `0x408270`), and walking the path (D48, `0x409170`).
 *
 * A step is taken from the room the path has for it (its signature,
 * `roomSignature`): walking checks that is the room here, moves the step on or back
 * a step when a move went further or not at all, tries a step twice when
 * the room is uncertain, and resyncs to the path (or the loop) after that.
 * In the dark (`darkness` 2 and over) rooms are not checked. Before the
 * move: a door, the post-rest command, stashing, resting to full at the
 * path's start, sneaking. A step that is not a direction is typed as it is
 * (`rest`, `meditate`, `look <dir>`, `@party <cmd>`, a remote command).
 *
 * Detours at a path's start or end: a shop to sell or buy (`0x406f20`), the
 * bank with cash over the limit, and the trainer (`0x40d540`).
 */
import { trainingCost } from '../player/train';
import { dueOn, monitorsWaiting } from '../abilities/monitors';
import { combatOff } from '../combat/engaged';
import { abbrev, stricmp, strnicmp, typedDirection } from '../cstr';
import { postMeditate, postRest } from '../health/prepost';
import { healthStep } from '../health/rest';
import { findCarried } from '../items/inventory';
import {
  clearDetours,
  detourDone,
  goTo,
  headFor,
  roomByName,
  roomBySignature,
  roomKnownHere
} from '../move/destinations';
import { doors, holdForHp, leaving, move, roamExit, runBack, spendRun } from '../move/go';
import {
  atStep,
  clearPath,
  copyPath,
  findPath,
  freeSteps,
  loadPath,
  nextRoom,
  resync,
  saveSteps,
  seekStep,
  showPath,
  stepsLeft
} from '../move/path';
import { enemiesHere, findEntity, unkeepAll } from '../room/entities';
import { ANY_ROOM, type PathStep, type Session } from '../Session';
import { refreshStatus } from '../status';
import { remoteCommand } from '../talk/remote';
import { fetchCash, overCash, shareCash, stashItems } from './cash';
import { stamp } from './events';
import { hangUp } from './game';
import { modeDefaults, reEngage } from './modes';
import { queue, send, wake } from './send';
import { setState } from './state';
import { sneakStep } from './stealth';
import { setTask, Task } from './task';
import { State } from '../states';
import {
  LineFlag,
  CarriedFlag,
  ItemFlag,
  StepFlag,
  RouteFlag,
  MonitorWhen,
  Darkness,
  Exit
} from '../flags';

/**
 * `0x4451e0`: the next command of an imported path (`importText`, in one of
 * five clients' formats). The text comes from MegaMUD's Import Path dialog,
 * which the app does not have — our paths are its planner's — so there is
 * never one, and the import ends.
 */
function importNext(s: Session): string {
  s.importFrom = s.importAt;
  s.importing = 0;
  s.importText = '';
  return '';
}

/**
 * `0x407c90` (D44): an imported path's next command: a move (its door
 * first), or typed. The first pass only re-reads the room.
 */
export function pathCommands(s: Session): number {
  if (s.state !== State.Nothing || s.hp < 1 || s.held !== 0 || s.blind !== 0 || s.confused !== 0)
    return 0;
  if (s.importing === 0) return 0;
  s.stepTries += 1;
  if (s.stepTries === 1) return tryAgain(s);
  if (s.partyWait !== 0 && s.runCount === 0 && s.rescueCount === 0) return 0;
  const cmd = importNext(s);
  if (cmd === '') return 1;
  const dir = typedDirection(cmd);
  if ((dir === -1 || (holdForHp(s) === 0 && doors(s, dir, 0, cmd) === 0)) && sneakStep(s) === 0) {
    // The command shown in the window (`0x4a9`).
    if (move(s, dir, 1) !== 0) return 1;
    s.waitLines = 2;
    setState(s, State.Other);
    s.host.activity(`Importing path command "${cmd}"`);
    send(s, cmd);
    send(s, '\r');
    return 1;
  }
  s.importAt = s.importFrom;
  return 1;
}

/**
 * `0x408270` (D47): roaming (or lost): chasing someone still here holds it;
 * a command for this room of `Auto-roam.AutoRoom0`–`9` (its `AutoCmd`);
 * lost, a known room or a step of the path found again ends it; else an
 * allowed exit at random, or `[No allowed exits]` and it stops.
 */
export function noAllowedExits(s: Session): number {
  if (s.chaseTarget !== '' && findEntity(s, s.chaseTarget, 0) !== null) return 1;
  if (s.walking === 0 || (s.lost === 0 && s.roaming === 0)) return 0;
  if (s.importing !== 0 || s.following !== 0 || s.allOff !== 0 || s.state !== State.Nothing)
    return 0;
  if (s.hp < 1 || s.held !== 0 || s.blind !== 0) return 0;
  if (s.partyWait !== 0 && s.runCount === 0 && s.rescueCount === 0) return 0;
  if (s.roaming !== 0) {
    for (let i = 0; i < 10; i += 1) {
      const room = roomByName(s, s[`Auto_roam_AutoRoom${i}` as 'Auto_roam_AutoRoom0']);
      if (room && room.signature === s.roomSignature) {
        s.moveDir = -1;
        queue(s, `${s[`Auto_roam_AutoCmd${i}` as 'Auto_roam_AutoCmd0']}\r`);
        wake(s);
        return 1;
      }
    }
  }
  if (
    s.lost !== 0 &&
    (s.lostNeedsKnownRoom === 0 || roomKnownHere(s) === 0) &&
    (roomKnownHere(s) !== 0 || resync(s, s.path) !== 0)
  ) {
    s.lost = 0;
    headFor(s, 0);
    s.lineFlags |= LineFlag.Prompted;
    s.statPagerUp = 0;
    refreshStatus(s);
    return 2;
  }
  const dir = roamExit(s);
  if (dir === -1) {
    s.host.show('[No allowed exits]');
    s.walking = 0;
    s.roaming = 0;
    setTask(s, Task.InGame);
    s.host.alert?.('idle');
    return 0;
  }
  if (s.task === Task.Idle || s.task === Task.InGame)
    setTask(s, s.lost !== 0 ? Task.Lost : Task.Roaming);
  if (doors(s, dir, 0, null) !== 0 || sneakStep(s) !== 0) return 1;
  if (s.partyStepPending !== 0) return 0;
  move(s, dir, 1);
  return 1;
}

/** `0x48b240`: a pending command not queued by an ability monitor. */
function pendingHeld(s: Session): number {
  return s.pending.some((p) => p.tag === 0) ? 1 : 0;
}

/** `0x453710`: a light source (item type 6) is equipped. */
function wearingLight(s: Session): number {
  return s.inventory.some((c) => c.item?.type === 6 && (c.flags & CarriedFlag.Equipped) !== 0)
    ? 1
    : 0;
}

/** `0x456120`: the light source equipped taken off. */
function removeLight(s: Session): number {
  for (const c of s.inventory) {
    if (c.item?.type !== 6 || (c.flags & CarriedFlag.Equipped) === 0) continue;
    c.flags &= ~CarriedFlag.Equipped;
    s.waitLines = 2;
    setState(s, State.Other);
    send(s, `remove ${c.item.name}\r`);
    return 1;
  }
  return 0;
}

/**
 * `0x406f20`: a detour from the loop's start (`atStart`): to the shop with an
 * item to sell over its maximum (or over its minimum, carrying 67% and
 * more), or one to buy under its minimum (by the bank, when short); to the
 * bank with cash over the limit.
 */
function pathDetours(s: Session, atStart: number): number {
  if (s.allOff !== 0) return 0;
  const loopStart = s.path.end !== 0 && s.path.start === s.path.end ? atStart : 0;
  if (s.weightMax !== 0 && s.sellDetourTaken === 0) {
    for (const c of s.inventory) {
      const item = c.item;
      if (!item || (item.flags & ItemFlag.Sell) === 0) continue;
      let heavy = false;
      if (Math.trunc((s.weightCarried * 100) / s.weightMax) < 0x43 || c.count <= item.min) {
        if (c.count <= item.min) continue;
      } else {
        heavy = true;
      }
      if (!((item.max > 0 && item.max <= c.count) || heavy) || loopStart === 0) continue;
      const shop = roomByName(s, item.shop);
      if (shop && goTo(s, shop.signature, null) !== 0) {
        s.detours[0]!.why = 'to sell items';
        s.host.show('[Detouring to Shop]');
        headFor(s, 0);
        s.sellDetourTaken = 1;
        return 1;
      }
    }
  }
  if (s.following === 0) {
    for (const item of s.data.items) {
      if (s.following !== 0) break;
      if (
        (item.flags & (ItemFlag.Buy | ItemFlag.MustHaveMin | ItemFlag.OutOfStock)) !==
        (ItemFlag.Buy | ItemFlag.MustHaveMin)
      )
        continue;
      const have = findCarried(s, item.name)?.count ?? 0;
      if (have >= item.min || loopStart === 0) continue;
      const shop = roomByName(s, item.shop);
      if (!shop || goTo(s, shop.signature, null) === 0) continue;
      s.detours[0]!.why = 'to buy items';
      let price = item.price >>> 0;
      if (s.Player_Charm < 0x32) price += Math.trunc(((0x32 - s.Player_Charm) * price * 2) / 100);
      if (price >>> 0 <= s.wealth >>> 0) {
        s.host.show('[Detouring to Shop]');
        headFor(s, 0);
        return 1;
      }
      s.host.show('[Detouring to Bank, then Shop]');
      fetchCash(s, 0, s.cashNeeded + price);
      return 1;
    }
  }
  if (overCash(s) === 0) return 0;
  if (s.following !== 0) {
    s.depositAsked = -1;
    return 0;
  }
  if (loopStart === 0) return 0;
  const bank = s.Cash_Bank !== '' ? roomByName(s, s.Cash_Bank) : null;
  if (!bank) {
    if (s.noBankWarned === 0) {
      s.noBankWarned = 1;
      if (s.Cash_Bank === '') {
        s.host.show('[Cash limit exceeded but no bank is set (see Loot settings)]');
        return 0;
      }
      s.host.show(`[Cash limit exceeded but bank '${s.Cash_Bank}' is not a known room]`);
    }
    return 0;
  }
  s.depositAsked = -1;
  if (s.roomSignature !== bank.signature && goTo(s, bank.signature, null) !== 0) {
    s.detours[0]!.why = 'to deposit cash';
    s.host.show('[Detouring to Bank]');
    headFor(s, 0);
    s.lineFlags |= LineFlag.Prompted;
    s.statPagerUp = 0;
    refreshStatus(s);
    wake(s);
    return 1;
  }
  return 0;
}

/**
 * `0x40d540`: at the loop's start with the experience to level
 * (`Other.AutoTrain`), a detour to the nearest trainer for this class and
 * level (a Rooms.md room with `0x08` and not `0x20`), the bank first when
 * short of the cost; there, `train` once rested to full.
 */
function trainDetour(s: Session): number {
  if (
    s.allOff !== 0 ||
    s.loopPath.start === 0 ||
    s.loopPath.start !== s.loopPath.end ||
    s.expToLevel !== 0
  )
    return 0;
  if (s.Other_AutoTrain === 0) {
    if (s.trainDealtWith === 0) {
      s.host.alert?.('train');
      s.trainDealtWith = 1;
    }
    return 0;
  }
  if (s.trainDealtWith === 1) return 0;
  const rooms = s.data.rooms ?? [];
  let best = -1;
  let bestSteps = 0x7fffffff;
  for (let i = 0; i < rooms.length; i += 1) {
    const r = rooms[i]!;
    if (((r.flags ?? 0) & 0x28) !== 8) continue;
    if (!((r.minLevel ?? 0) <= s.Player_Level && s.Player_Level <= (r.maxLevel ?? 0))) continue;
    if ((r.cls ?? 0) !== 0 && s.Player_Class !== r.cls) continue;
    if (s.roomSignature === r.signature) {
      best = i;
      break;
    }
    const way = s.host.route?.(s.roomSignature, r.signature);
    if (
      way &&
      (way.flags === 0 ||
        way.flags === RouteFlag.ShortOfGold ||
        way.flags === RouteFlag.ItemNeeded) &&
      way.steps < bestSteps
    ) {
      best = i;
      bestSteps = way.steps;
    }
  }
  if (best === -1) return 0;
  const trainer = rooms[best]!;
  if (s.roomSignature === trainer.signature) {
    if (
      Math.trunc((s.Player_MaxHP * s.Health_HpFullPct) / 100) <= s.hp &&
      Math.trunc((s.Player_MaxMana * s.Health_ManaFullPct) / 100) <= s.mana
    ) {
      setState(s, State.Training);
      s.host.activity('Auto-training character');
      send(s, 'train\r');
      return 1;
    }
    s.restHpToFull = 1;
    s.restManaToFull = 1;
    s.hpFullAt = 0;
    s.manaFullAt = 0;
    return 0;
  }
  if (goTo(s, trainer.signature, null) === 0) return 0;
  s.detours[0]!.why = 'to train';
  if (headFor(s, 0) === 0) {
    const cost = trainingCost(s.Player_Level);
    if (s.wealth >>> 0 < cost >>> 0) fetchCash(s, 0, s.cashNeeded + cost);
    s.host.alert?.('train');
    return 1;
  }
  detourDone(s, 0);
  s.trainDealtWith = 1;
  s.host.show("[Can't get to trainer!]");
  return 0;
}

/** A MUD op's `sys goto` for a path's end that is one of the realm's towns (`0x409170`). */
const SYS_GOTO: [number, string][] = [
  [0xabc10002 | 0, 'newhaven'],
  [0x11e00004, 'lostcity'],
  [0x85400000 | 0, 'support'],
  [0xa6e00055 | 0, 'khazarad'],
  [0xd9c10000 | 0, 'silvermere'],
  [0xebf00006 | 0, 'rhudaur']
];

/** The step's flags that act on arriving in its room. */
function stepFlags(s: Session, st: PathStep): void {
  if ((st.flags & StepFlag.RestUpHere) !== 0) {
    s.restHpToFull = 1;
    s.restManaToFull = 1;
    s.hpFullAt = 0;
    s.manaFullAt = 0;
  }
  if ((st.flags & StepFlag.DontAttackHere) !== 0) s.dontAttackHere = 1;
  if ((st.flags & StepFlag.DontRestHere) !== 0) s.dontRestHere = 1;
  if ((st.flags & StepFlag.PitchBlack) !== 0) s.darkness = Darkness.PitchBlack;
}

/** The room re-read wanted: the step tried again on the next prompt. */
function tryAgain(s: Session): number {
  s.lookDue = 1;
  return 1;
}

let askingRelearn = 0;

/** `0x409170` (D48): the next step of the path. */
export function walkPath(s: Session): number {
  if (s.allOff !== 0) return 0;
  if (s.walking === 0 || s.following === 1 || s.roaming === 1) {
    pathDetours(s, 0);
    return 0;
  }
  if (pendingHeld(s) !== 0) {
    if (s.debug !== 0) s.host.trace('{mv-p}');
    return 0;
  }
  if (s.runCount === 0 && s.rescueCount === 0 && monitorsWaiting(s) !== 0) {
    if (s.debug !== 0) s.host.trace('{mv-h}');
    return 0;
  }
  if (s.hp < 1 || s.held !== 0) return 0;
  if (s.blind !== 0 && s.Other_IgnoreBlind === 0) return 0;
  if (s.partyWait !== 0 && s.runCount === 0 && s.rescueCount === 0) return 0;
  if (holdForHp(s) !== 0) return 0;
  const path = s.path;
  if (s.BBS_IsMudop !== 0 && path.steps === null && s.roomSignature !== path.end) {
    const town = SYS_GOTO.find(([sig]) => sig === path.end);
    if (town) {
      send(s, `sys goto ${town[1]}\r`);
      freeSteps(path);
      s.MegaMud_CurPath = '';
      s.roomNameHash = town[0];
      s.roomSignature = town[0];
      unkeepAll(s);
      s.stepTries = 0;
      s.roomLookedAt = 0;
      s.redisplayDue = 1;
      combatOff(s);
      s.lookDue = 1;
      return 2;
    }
  }
  if (s.MegaMud_CurPath === '') headFor(s, 0);
  if (path.steps === null && loadPath(s, path) === 0) {
    if (s.MegaMud_CurPath === '') return 0;
    s.host.show(`[Dropping path '${s.MegaMud_CurPath}' (steps could not be loaded)]`);
    if (stricmp(s.MegaMud_SelPath, s.MegaMud_CurPath) === 0 && s.unknown_e524 === 0)
      clearPath(s.loopPath);
    clearPath(path);
    return 0;
  }
  if (s.MegaMud_CurPathStep === 0) {
    s.shareAsked = 0;
    if (s.cashNeeded === 0 && trainDetour(s) !== 0) return 2;
    if (pathDetours(s, 1) !== 0) return 2;
  }
  if (
    path.start === path.end &&
    s.looping !== 0 &&
    s.MegaMud_NoHangup === 0 &&
    s.Comms_LogoffLowExp !== 0 &&
    s.lapExpRate !== -1 &&
    s.lapExpRate < s.Comms_MinExpRate
  ) {
    s.host.trace(`[Experience rate too low! (${stamp(s)})]`);
    s.skipRedialOnce = 1;
    s.noRedial = 1;
    s.walking = 0;
    hangUp(s, 0);
    s.host.alert?.('hangup');
    return 1;
  }
  if (path.count <= s.MegaMud_CurPathStep) return pathDone(s);
  if ((path.steps?.length ?? 0) <= path.step) seekStep(path);
  const st = path.steps?.[path.step];
  if (!st) return 0;
  // Ours: a command queued for the room ahead goes first (`SessionHost.beforeStep`).
  if (s.host.beforeStep !== undefined) {
    s.host.beforeStep();
    if (pendingHeld(s) !== 0) return 0;
  }
  return walkStep(s, st);
}

/** The path's end: the path after it, sharing, the trainer, a detour, else the next destination. */
function pathDone(s: Session): number {
  const path = s.path;
  if (path.next !== '') {
    const next = findPath(s, path.next);
    if (next && goTo(s, 0, next) !== 0) {
      s.stepsToGo += next.count;
      s.detours[0]!.why = '';
      headFor(s, 0);
      return 1;
    }
  }
  if (path.start === path.end && shareCash(s, 1) !== 0) return 2;
  if (s.cashNeeded === 0 && trainDetour(s) !== 0) return 2;
  if (pathDetours(s, 1) !== 0) return 2;
  headFor(s, 0);
  s.lineFlags |= LineFlag.Prompted;
  s.statPagerUp = 0;
  refreshStatus(s);
  return 2;
}

/** `0x409170` from the step reached on. */
function walkStep(s: Session, first: PathStep): number {
  const path = s.path;
  const steps = path.steps!;
  let st = first;
  if ((st.flags & StepFlag.PitchBlack) !== 0) s.darkness = Darkness.PitchBlack;
  if ((st.flags & StepFlag.DontAttackHere) !== 0) s.dontAttackHere = 1;
  if ((st.flags & StepFlag.DontRestHere) !== 0) s.dontRestHere = 1;
  let dark = s.darkness;
  if (dark < 2 && (st.room === -1 || (st.flags & StepFlag.ReLearnRoom) !== 0)) {
    s.stepTries += 1;
    if (s.stepTries === 1) {
      s.roomLookedAt = 0;
      return tryAgain(s);
    }
    if ((st.flags & StepFlag.ReLearnRoom) !== 0) {
      st.flags &= ~StepFlag.ReLearnRoom;
      st.room = s.roomSignature;
      saveSteps(s, path);
      s.host.show('[Path step updated]');
      dark = s.darkness;
      s.stepTries = 0;
    }
  }
  const room = st.room;
  const any = room === ANY_ROOM;
  if (
    dark < 2 &&
    !atStep(s, path, path.step) &&
    !any &&
    s.stepTries > 0 &&
    s.MegaMud_CurPathStep < path.count - 1
  ) {
    // The move went a step further than the path thought: on a step.
    const next = steps[path.step + 1];
    if (next && atStep(s, path, path.step + 1)) {
      s.MegaMud_CurPathStep += 1;
      st = next;
      path.step += 1;
      if (s.task === Task.Walking) s.stepsToGo -= 1;
    }
  }
  if (s.darkness < Darkness.Dark) {
    if (
      !atStep(s, path, path.step) &&
      !any &&
      s.stepTries > 0 &&
      s.MegaMud_CurPathStep > 0 &&
      atStep(s, path, path.prev)
    ) {
      // The move did not happen: back a step.
      s.MegaMud_CurPathStep -= 1;
      path.step = path.prev;
      st = steps[path.prev]!;
      if (s.task === Task.Walking) s.stepsToGo += 1;
    }
    if (s.darkness < Darkness.Dark && !atStep(s, path, path.step) && !any) {
      s.stepTries += 1;
      if (s.stepTries === 1) return tryAgain(s);
      let tries = s.stepTries;
      if (s.MegaMud_FixSteps !== 0) {
        if (askingRelearn !== 0) return 1;
        askingRelearn = 1;
        if (s.host.ask?.('This path step appears to require re-learning.\nUpdate it now?')) {
          st.room = s.roomSignature;
          saveSteps(s, path);
          s.host.show('[Path step updated]');
          s.stepTries = 0;
          tries = 0;
        } else {
          tries = s.stepTries;
        }
        askingRelearn = 0;
      }
      if (tries === 2) {
        const dir = typedDirection(st.command);
        // An exit that is not there (`0x813c[-1]` is `expectedRoom` for a command).
        if ((dir === -1 ? s.expectedRoom : s.roomExits[dir]) === 0) {
          s.stepTries = 3;
        } else {
          st.flags |= StepFlag.RoomUncertain;
          s.host.show(
            `[Uncertain room (Path ${s.MegaMud_CurPath}, step ${s.MegaMud_CurPathStep}): Trying step anyway]`
          );
        }
      }
      if (s.stepTries > 2) {
        const was = s.MegaMud_CurPathStep;
        if (resync(s, path) === 0) {
          if (resync(s, s.loopPath) === 0) {
            s.lost = 1;
            setTask(s, Task.Lost);
            return 1;
          }
          freeSteps(path);
          copyPath(s, path, s.loopPath, 1);
          showPath(s);
          st = path.steps![path.step]!;
          s.stepsToGo = -1;
        } else {
          st = steps[path.step]!;
          if (was === -1) {
            s.stepsToGo = -1;
          } else {
            if (was !== s.MegaMud_CurPathStep) {
              s.host.show(
                `[Resynced from path step ${was} to ${s.MegaMud_CurPathStep} (${s.MegaMud_CurPath})]`
              );
              st.flags |= StepFlag.Resynced;
            }
            s.stepsToGo = stepsLeft(s);
          }
        }
      }
    }
  }
  if (
    s.darkness < Darkness.Dark &&
    atStep(s, path, path.step) &&
    (st.flags & StepFlag.RoomUncertain) !== 0
  )
    st.flags &= ~StepFlag.RoomUncertain;
  if (s.darkness < Darkness.Dark || any) {
    if ((st.flags & StepFlag.DarkRoom) === 0 && !any && wearingLight(s) !== 0) {
      if (s.lightRemovedToTest !== 0) {
        st.flags |= StepFlag.DarkRoom;
        if (saveSteps(s, path) !== 0) s.host.show('[Room light updated]');
      } else if (removeLight(s) !== 0) {
        s.lookDue = 1;
        s.lightRemovedToTest = 1;
        return 1;
      }
    }
  } else if ((st.flags & StepFlag.DarkRoom) === 0 && s.lost === 0 && s.darkMisses === 0) {
    st.flags |= StepFlag.DarkRoom;
    if (saveSteps(s, path) !== 0) s.host.show('[Room light updated]');
  }
  if (s.rescueCount !== 0 && !any && runBack(s, 0) !== 0) return 1;
  if (
    s.runCount !== 0 &&
    s.looping !== 0 &&
    s.Other_RunBackwards !== 0 &&
    s.runByChoice === 0 &&
    !any &&
    runBack(s, 0) !== 0
  )
    return 1;
  if (
    path.start !== path.end &&
    s.detours[0]!.room === path.end &&
    s.detours[1]!.room === 0 &&
    s.MegaMud_CurPathStep === path.count - 1
  ) {
    const end = roomBySignature(s, path.end);
    if (end && ((end.flags ?? 0) & 0x10) !== 0) return stopBefore(s, end.name);
  }
  return takeStep(s, st, any);
}

/** The destination is a room to stop before entering (`0x10`): stopped. */
function stopBefore(s: Session, name: string): number {
  if (enemiesHere(s, 0) === 0) {
    s.restHpToFull = 1;
    s.restManaToFull = 1;
    s.hpFullAt = 0;
    s.manaFullAt = 0;
  }
  s.walking = 0;
  s.looping = 0;
  s.roaming = 0;
  clearPath(s.loopPath);
  clearDetours(s);
  modeDefaults(s);
  reEngage(s);
  s.host.show(`[Stopped Before Entering (${name})]`);
  wake(s);
  s.roomLookedAt = 0;
  s.lookDue = 1;
  setTask(s, Task.InGame);
  setState(s, State.Nothing);
  return 0;
}

/** The step taken: its door, the post-rest, stashing, resting, sneaking, then the move or command. */
function takeStep(s: Session, st: PathStep, any: boolean): number {
  const path = s.path;
  let dir = typedDirection(st.command);
  const leadsTo = nextRoom(path, st, any ? 1 : 0);
  // A command that moves (it leads somewhere), unless it is `@party` with a party.
  const moves =
    dir === -1 && leadsTo !== 0 && !(strnicmp(st.command, '@party ', 7) === 0 && s.partySize > 1);
  if (any && dir !== -1 && s.roomExits[dir] === Exit.None) dir = roamExit(s);
  if (!any && dir !== -1 && s.host.clearWay?.(path, path.step, dir) === 1) return 1;
  if (dir !== -1 && doors(s, dir, st.flags, st.command) !== 0) return 1;
  if (s.allOff !== 0 || s.movementHalted !== 0) return 0;
  const rested = postRest(s, 5, 0);
  const meditated = postMeditate(s, 0);
  if (rested !== 0 || meditated !== 0) return 1;
  if (s.looping !== 0 && s.cannotDropHere === 0 && (st.flags & StepFlag.StashPoint) !== 0) {
    s.stashing = 1;
    if (stashItems(s) !== 0) return 1;
    s.stashing = 0;
  }
  if (s.MegaMud_CurPathStep === 0 && (st.flags & StepFlag.RestUpHere) !== 0) {
    s.restHpToFull = 1;
    s.restManaToFull = 1;
    if (healthStep(s) !== 0) return 1;
  }
  if (sneakStep(s) !== 0) return 1;
  if (s.partyStepPending !== 0) return 0;
  if (move(s, dir, 1) === 0) {
    const out = typeCommand(s, st, moves, leadsTo);
    if (out !== '') {
      if (out.startsWith('@') && strnicmp(out, '@party ', 7) !== 0) {
        remoteCommand(s, st.command, 0);
      } else {
        s.host.activity(`${moves ? 'Moving' : 'Issuing path command'}: ${st.command}`);
        s.waitLines = 2;
        send(s, out);
      }
    }
  } else {
    if (s.state !== State.Moving) return 1;
    s.expectedRoom = leadsTo;
    if (leadsTo !== 0) s.roomNameHash = leadsTo;
  }
  if (s.task === Task.Idle || s.task === Task.InGame)
    s.task = s.looping !== 0 ? Task.Looping : Task.Walking;
  if (s.task === Task.Walking && !any) s.stepsToGo -= 1;
  showPath(s);
  setTask(s, s.task);
  if ((st.flags & StepFlag.DontAttackNext) !== 0) s.dontAttackHere = 1;
  if (s.debug !== 0) s.host.trace(`{mv:${s.MegaMud_CurPathStep}/${path.count}}`);
  if (!any) {
    path.prev = path.step;
    s.MegaMud_CurPathStep += 1;
    path.step += 1;
  }
  let flags: number;
  if (s.MegaMud_CurPathStep < path.count) {
    const next = path.steps![path.step];
    if (next) stepFlags(s, next);
    if (s.looping === 0) return chased(s);
    flags = next?.flags ?? 0;
  } else {
    if (path.start !== path.end || s.looping === 0) return chased(s);
    if (s.now - s.inventoryAskedAt > 299) s.weightMax = 0;
    dueOn(s, MonitorWhen.PathStart);
    const start = path.steps![0];
    if (start) stepFlags(s, start);
    flags = start?.flags ?? 0;
  }
  if ((flags & StepFlag.StashPoint) !== 0) s.stashing = 1;
  return chased(s);
}

/** The step done: no one is being chased. */
function chased(s: Session): number {
  s.chaseTarget = '';
  return 1;
}

/**
 * A step that is not a direction, typed: `rest` and `meditate` (resting
 * and meditating), `look <dir>` (awaiting the room), `@party <cmd>` (the
 * command, `par`, and the `@party` line said); the rest await their answer,
 * and one that moves (`moves`) is taken as the move to `leadsTo`.
 */
function typeCommand(s: Session, st: PathStep, moves: boolean, leadsTo: number): string {
  const cmd = st.command;
  let out = `${cmd}\r`;
  if (stricmp(cmd, 'rest') === 0) {
    setState(s, State.RestAsked);
    return out;
  }
  if ((cmd.length - 3) >>> 0 < 6 && abbrev(cmd, 'meditate', cmd.length) !== 0) {
    setState(s, State.MeditateAsked);
    return out;
  }
  if (abbrev(cmd, 'look', 1) !== 0) {
    let n = 0;
    while (n < 4 && cmd[n] !== undefined && cmd[n]!.toLowerCase() === 'look'[n]) n += 1;
    if (cmd[n] === ' ' && (cmd[n + 1] ?? '') !== '') {
      const word = cmd.slice(n + 1).toLowerCase();
      if (typedDirection(word) >>> 0 < 10) {
        s.waitLines = 2;
        s.waitPrompt = 1;
        setState(s, State.Looking);
        return out;
      }
    }
    s.roomLookedAt = 0;
    s.redisplayDue = 1;
    s.lookDue = 1;
    setState(s, State.Other);
    return out;
  }
  if (strnicmp(cmd, '@party ', 7) === 0) {
    if (s.partySize < 2) {
      out = `${cmd.slice(7)}\r`;
    } else {
      queue(s, `${cmd.slice(7)}\r`);
      queue(s, 'par\r');
      out = `${s.speechPrefix}${cmd}\r`;
      s.partyStepPending = 1;
      s.parAt = s.now;
    }
  }
  s.roomLookedAt = 0;
  s.redisplayDue = 1;
  s.lookDue = 1;
  if (!moves) {
    setState(s, State.Other);
    return out;
  }
  s.roomNameHash = leadsTo;
  s.expectedRoom = leadsTo;
  s.moveDir = -1;
  leaving(s);
  spendRun(s);
  return out;
}
