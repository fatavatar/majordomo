/**
 * MegaMUD's path records, read 2026-10-13: the path walked (`0xe39c`), the
 * loop (`loopPath`) and the paths known (`0x7f20`). A path is MegaMUD's `.mp`
 * file: the room each step is taken from (its signature, `roomSignature`), the
 * step's flags and what is typed. Loading and saving the steps, and the way
 * between two rooms (`0x43fd90`), are the host's: our world graph and loops
 * stand in for MegaMUD's path files.
 */
import { stricmp } from '../cstr';
import { ANY_ROOM, newPath, type PathRec, type PathStep, type Session } from '../Session';
import { StepFlag, RouteFlag } from '../flags';

/** `0x482e30` and the `memset` after it: the path let go, every field cleared. */
export function clearPath(p: PathRec): void {
  Object.assign(p, newPath());
}

/** `0x482e30` alone: the title, author and steps let go; the name, rooms and paths after kept. */
export function freeSteps(p: PathRec): void {
  p.title = '';
  p.author = '';
  p.count = 0;
  p.at = 0;
  p.step = 0;
  p.prev = 0;
  p.steps = null;
}

/**
 * `0x482fc0`: a path read from its file (by its name): its header (title,
 * author, rooms, steps, retry and next paths) and its steps, and the step
 * reached found again. The file is the host's (`readPath`), else the known
 * path of that name. 0 when there is none.
 */
export function loadPath(s: Session, p: PathRec): number {
  if (p.name === '') return 0;
  const file = s.host.readPath?.(p.name) ?? findPath(s, p.name);
  if (!file || !file.steps) return 0;
  p.title = file.title;
  p.author = file.author;
  p.start = file.start;
  p.end = file.end;
  p.retry = file.retry;
  p.next = file.next;
  p.count = file.count;
  p.steps = file.steps.map((st) => ({ ...st }));
  seekStep(p);
  return 1;
}

/** `0x4888e0`: a step relearned, the path written back; nonzero when it was. */
export function saveSteps(s: Session, p: PathRec): number {
  return s.host.saveSteps?.(p) ?? 0;
}

/** `0x482600`: `from` copied into `to` (its own steps, `load` loading them), at its start. */
export function copyPath(s: Session, to: PathRec, from: PathRec, load: number): number {
  to.title = from.title;
  to.author = from.author;
  to.name = from.name;
  to.retry = from.retry;
  to.next = from.next;
  to.start = from.start;
  to.end = from.end;
  to.count = from.count;
  to.at = from.at;
  to.step = from.step;
  to.prev = from.prev;
  to.steps = null;
  if (load !== 0 && loadPath(s, to) === 0) return 0;
  to.at = 0;
  to.step = 0;
  to.prev = 0;
  return 1;
}

/** `0x482bd0`: a known path by its file name. */
export function findPath(s: Session, name: string): PathRec | null {
  return s.paths.find((p) => stricmp(name, p.name) === 0) ?? null;
}

/** `0x4821f0`: the step record for the step reached found again (the start, when it is past the end). */
export function seekStep(p: PathRec): void {
  p.step = 0;
  p.prev = 0;
  if (p.steps === null || p.steps.length === 0) {
    p.at = 0;
    return;
  }
  if (p.at < 0) p.at = 0;
  if (p.count < p.at) p.at = p.count;
  for (let i = 0; i < p.at; i += 1) {
    if (p.steps.length < i + 1) {
      p.at = 0;
      p.step = 0;
      p.prev = 0;
      return;
    }
    p.prev = i;
    p.step = i + 1;
  }
}

/**
 * `0x40da00`: the room a step leads to, when it is not the step's own: the
 * next step's, or at the last the path's end. 0 for none (and for an
 * any-room step).
 */
export function nextRoom(p: PathRec, st: PathStep, any: number): number {
  if (any !== 0 || st.room === 0 || st.room === ANY_ROOM || st.room === -1) return 0;
  if (p.at < p.count - 1) {
    const next = p.steps?.[p.step + 1];
    if (next && next.room !== ANY_ROOM && next.room !== -1 && next.room !== st.room)
      return next.room;
  } else if (p.end !== 0 && p.end !== ANY_ROOM && p.end !== -1 && p.end !== st.room) {
    return p.end;
  }
  return 0;
}

/**
 * `0x43e510`: the path resynced to this room: the first step taken from here
 * on from the one before the step reached, round past the end (a step
 * resynced to already, `0x8000`, is passed over once), else the first
 * anywhere. 0 when this room is the path's start or end, or not on it.
 */
export function resync(s: Session, p: PathRec): number {
  if (s.roomSignature === p.start || s.roomSignature === p.end) return 0;
  if (p.steps === null && loadPath(s, p) === 0) return 0;
  const steps = p.steps!;
  let from = p.at - 1;
  if (from < 0) from = p.count - 1;
  const first = from < p.count ? from : 0;
  let wrapped = false;
  let i = first;
  for (;;) {
    const at = i < p.count ? i : 0;
    if (at === first) {
      if (wrapped) {
        for (let j = 0; j < p.count; j += 1) {
          if (steps[j]?.room === s.roomSignature) {
            p.at = j;
            p.step = j;
            return 1;
          }
        }
        return 0;
      }
      wrapped = true;
    }
    const st = steps[at];
    if (st && st.room === s.roomSignature) {
      if ((st.flags & StepFlag.Resynced) === 0) {
        p.at = at;
        p.step = at;
        return 1;
      }
      st.flags &= ~StepFlag.Resynced;
    }
    i = at + 1;
  }
}

/**
 * `0x43e410`: the steps to go: what is left of this path, and from its end
 * to the destination (`0x43fd90`); -1 not known.
 */
export function stepsLeft(s: Session): number {
  const dest = s.detours[0]!.room;
  if (dest === 0 || s.MegaMud_CurPath === '' || s.path.count <= 0 || s.path.end === 0) return -1;
  const left = Math.max(s.path.count - s.MegaMud_CurPathStep, 0);
  if (dest === s.path.end) return left;
  const way = s.host.route?.(s.path.end, dest);
  if (way && (way.flags & RouteFlag.NoWay) === 0 && way.steps >= 0 && way.steps < 2000)
    return way.steps + left;
  return -1;
}

/** `0x4aa600`: the steps to go as shown (to the lap's end, looping); -1 not known. */
export function stepsShown(s: Session): number {
  if (s.looping !== 0) return Math.max(s.path.count - s.MegaMud_CurPathStep, 0);
  let n = s.stepsToGo;
  if (n < 0) {
    if (s.detours[0]!.room !== s.path.end || s.detours[1]!.room !== 0) return -1;
    n = s.path.count - s.MegaMud_CurPathStep;
    if (n < 0) return -1;
  }
  return n >>> 0 > 1999 ? -1 : n;
}

/** `0x4ab450`: the path shown on the status bar; the steps to go worked out when unknown. */
export function showPath(s: Session): void {
  if (s.stepsToGo < 0 && s.looping === 0) s.stepsToGo = stepsShown(s);
}
