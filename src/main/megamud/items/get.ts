/**
 * `0x454b90`: picking up, read 2026-10-12: `You picked up …`, `You took …`,
 * `… gave you …` (carried, the room's item counted down, and a detour "for"
 * it done); `You do not see …` / `You don't see …` (the item, or the target,
 * gone from the room, and the room looked at again); `You cannot carry that
 * much` (the encumbrance limit forgotten).
 */
import { indexOf, leadingNumber, splitWord } from '../cstr';
import { castForgotten } from '../combat/timer';
import { f_426ab0 } from '../combat/casts';
import { sameItem } from '../room/checkNames';
import { removeEntity, unkeepAll } from '../room/entities';
import { queue } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import { setTask } from '../script/task';
import type { RoomEntity, Session } from '../Session';
import { detourDone } from '../move/destinations';
import { carryMore, wealthCarried } from './inventory';

/** `0x472420`: the item here of this name. */
function itemHere(s: Session, name: string): RoomEntity | null {
  return s.room.find((e) => e.type === 3 && sameItem(e.name, name)) ?? null;
}

/** A count before a name (`3 iron keys`), when one is there. */
function counted(text: string): [number | null, string] {
  if (!/^[0-9]/.test(text)) return [null, text];
  const [n, end] = leadingNumber(text);
  const rest = text.slice(end);
  const name = rest.replace(/^ +/, '');
  if (rest[0] === ' ' && name !== rest && name !== '') return [n, name];
  return [null, text];
}

function dropTarget(s: Session): void {
  const i = s.room.findIndex((e) => e.name === s.target);
  if (i !== -1) removeEntity(s, i);
}

/** Got it. */
function gotIt(s: Session, line: string): number {
  let count = 0;
  let at = indexOf(line, 'You picked up ');
  let rest: string;
  if (at !== -1) {
    const [n, end] = leadingNumber(line.slice(at + 0xe));
    count = n;
    rest = line.slice(at + 0xe + end);
  } else if ((at = indexOf(line, 'You took ')) !== -1) {
    count = 1;
    rest = line.slice(at + 9);
  } else if ((at = indexOf(line, ' gave you ')) !== -1) {
    const [n, end] = leadingNumber(line.slice(at + 10));
    count = n;
    rest = line.slice(at + 10 + end);
  } else {
    return 0;
  }
  s.hidden = 0;
  forgetAwaited(s, s.state);
  setState(s, 0);
  let [name] = splitWord(rest.replace(/^ +/, ''), '.', 100);
  const [n, bare] = counted(name);
  if (n !== null) {
    count = n;
    name = bare;
  }
  const e = itemHere(s, name);
  if (e) {
    if (e.item) e.item.flags &= ~0x2000000;
    if (count === 0) {
      // How many is unknown: look at the inventory.
      queue(s, 'i\r');
      return 1;
    }
    e.count -= count;
    if (e.count === 0) removeEntity(s, s.room.indexOf(e));
    if (s.s_8474 === name) s.s_8474 = '';
    const why = `for ${name}`;
    const detour = s.detours.findIndex((d) => d.why === why);
    if (detour !== -1) {
      detourDone(s, detour);
      setTask(s, s.task);
    }
  }
  if (count < 1) return 1;
  if (carryMore(s, name, count) === 0) return 0;
  wealthCarried(s);
  return 1;
}

/** Not there (any more). */
function notThere(s: Session, line: string): number {
  if (s.target !== '' && indexOf(line, s.target) !== -1) dropTarget(s);
  s.target = '';
  let at = indexOf(line, "You don't see ");
  if (at !== -1) at += 0xe;
  else if ((at = indexOf(line, 'You do not see ')) !== -1) at += 0xf;
  let gone: RoomEntity | null = null;
  if (at !== -1) {
    let text = line.slice(at);
    const [n, bare] = counted(text);
    if (n !== null) text = bare;
    const here = indexOf(text, ' here.');
    const name = here === -1 ? splitWord(text, '.', 100)[0] : text.slice(0, Math.min(here, 99));
    gone = itemHere(s, name);
  }
  if (!gone && s.state === 0x1c) {
    const picked = s.room[s.roomSelected];
    if (picked && picked.type === 3) gone = picked;
  }
  if (gone) {
    if (gone.item) gone.item.flags &= ~0x2000000;
    const i = s.room.indexOf(gone);
    if (i !== -1) removeEntity(s, i);
    s.roomSelected = -1;
  }
  unkeepAll(s);
  s.f_e290 = 1;
  s.f_32390 = 0;
  forgetAwaited(s, s.state);
  setState(s, 0);
  s.lineFlags |= 1;
  s.f_e544 = 4;
  return 1;
}

export function getLine(s: Session, line: string): number {
  if (indexOf(line, 'You do not see ') !== -1) {
    s.lineFlags &= ~0x84000;
    if (s.state === 0x12 || s.state === 0x11 || f_426ab0(s, 0) !== 0) {
      dropTarget(s);
      s.target = '';
      if (f_426ab0(s, 0) !== 0) castForgotten(s);
      forgetAwaited(s, s.state);
    }
    unkeepAll(s);
    s.f_e290 = 1;
    if (s.state === 0x20) return 0;
  }
  if (
    indexOf(line, "You don't see ") !== -1 ||
    indexOf(line, 'You do not see ') !== -1 ||
    indexOf(line, 'Syntax: GET') !== -1
  ) {
    return notThere(s, line);
  }
  if (indexOf(line, 'You cannot carry that much') !== -1) {
    s.f_8468 = 0;
    forgetAwaited(s, s.state);
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, ' damage') !== -1) return 0;
  return gotIt(s, line);
}
