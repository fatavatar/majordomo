/**
 * Arriving in a room: `Obvious exits: north, closed door east` (`0x4386d0`),
 * `You found an exit to the east!`, and `You can't seem to move anywhere`.
 * Read 2026-10-12.
 *
 * The exits are kept per direction (`0x813c`): 1 an exit, 2 a closed door,
 * 3 an open one, 4 one found by searching or of another kind. With the room's
 * name they make MegaMUD's signature for the room (`0x8130`): the name's hash
 * in the top twelve bits, two bits an exit below (a found exit counts as
 * none, an open door as a closed one). A different signature is a different
 * room: the creatures kept from the last one are let go and the path step
 * moves on.
 */
import { indexFrom, indexOf, insertAt, strnicmp } from '../cstr';
import { dropUnkeptCreatures, dropUnkeptItems, unkeepAll } from '../room/entities';
import { forgetLastTarget } from '../room/roomName';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { unported } from '../unported';

/** `0x4c01e0`: the direction a word starts with (0 north … 9 down), else -1. */
export function directionOf(text: string): number {
  if (text.startsWith('northeast')) return 4;
  if (text.startsWith('northwest')) return 5;
  if (text.startsWith('southeast')) return 6;
  if (text.startsWith('southwest')) return 7;
  if (text.startsWith('north')) return 0;
  if (text.startsWith('south')) return 1;
  if (text.startsWith('east')) return 2;
  if (text.startsWith('west')) return 3;
  if (text.startsWith('up')) return 8;
  return text.startsWith('down') ? 9 : -1;
}

/** The direction an exit's word names, as `0x4386d0` reads it (case aside); -1 for none. */
function exitDirection(word: string): number {
  let dir = strnicmp(word, 'north', 5) !== 0 ? -1 : 0;
  if (strnicmp(word, 'south', 5) === 0) dir = 1;
  if (strnicmp(word, 'east', 4) === 0) dir = 2;
  if (strnicmp(word, 'west', 4) === 0) dir = 3;
  if (strnicmp(word, 'northeast', 9) === 0) dir = 4;
  if (strnicmp(word, 'northwest', 9) === 0) dir = 5;
  if (strnicmp(word, 'southeast', 9) === 0) dir = 6;
  if (strnicmp(word, 'southwest', 9) === 0) dir = 7;
  if (strnicmp(word, 'up', 2) === 0) dir = 8;
  if (strnicmp(word, 'down', 4) === 0) dir = 9;
  if (strnicmp(word, 'above', 5) === 0) dir = 8;
  if (strnicmp(word, 'below', 5) === 0) dir = 9;
  return dir;
}

/** `0x4386d0`. */
export function exitsLine(s: Session, text: string): number {
  const before = s.f_8130;
  const found = indexOf(text, 'You found an exit ');
  if (found !== -1) {
    const dir = directionOf(text.slice(found + 0x12));
    if (dir === -1) {
      s.f_32390 = 0;
      s.f_e290 = 1;
    } else {
      s.roomExits[dir] = 4;
    }
    setState(s, 0);
    return 1;
  }
  if (indexOf(text, "You can't seem to move anywhere") !== -1 && s.held === 0) {
    unported('46c0f0');
    s.held = 1;
    s.f_e29c = 1;
  }
  if (s.state === 0x16 && s.held !== 0) {
    if (s.f_e174 !== 0) unported('482de0');
    s.f_e290 = 1;
    setState(s, 0);
    return 1;
  }
  let line = text;
  let at = indexOf(line, 'Obvious exits: ');
  if (at === -1) {
    if ((s.lineFlags & 0x10000) === 0) return 0;
  } else {
    const colour = s.line.attr[at];
    if (colour !== 2 && colour !== 3) {
      if (at === 0) {
        s.f_e2c8 = 1;
        setState(s, 0);
      }
      return 1;
    }
    if (s.inGame === 0) {
      s.inGame = 1;
      s.f_e2c8 = 1;
    }
  }
  if (s.state === 0x20) return 1;
  if ((s.lineFlags & 0x10000) === 0) {
    if (s.inCombat === 0 && s.roomNameSeen !== s.roomName) unkeepAll(s);
    if ((s.lineFlags & 8) === 0) dropUnkeptCreatures(s);
    else s.lineFlags &= ~8;
    if ((s.lineFlags & 0x10) === 0) dropUnkeptItems(s);
    else s.lineFlags &= ~0x10;
  }
  if ((s.lineFlags & 0x10000) === 0) {
    at += 0xf;
    s.roomExits = Array.from({ length: 10 }, () => 0);
  } else {
    if ((s.lineFlags & 1) !== 0) {
      s.lineFlags &= ~0x10000;
      return 0;
    }
    if (s.s_d910 !== '') {
      line = insertAt(insertAt(line, 0, ' '), 0, s.s_d910);
      s.s_d910 = '';
    }
    s.lineFlags &= ~0x10000;
    at = 0;
  }
  for (;;) {
    const open = indexFrom(line, at, 'open ') === at;
    const afterOpen = open ? at + 5 : at;
    const closed = indexFrom(line, afterOpen, 'closed ') === afterOpen;
    const wordAt = closed ? afterOpen + 7 : afterOpen;
    let isOpen = open;
    let isClosed = closed;
    if (open || closed) {
      const kind = line.slice(wordAt);
      if (
        strnicmp(kind, 'door ', 5) !== 0 &&
        strnicmp(kind, 'gate ', 5) !== 0 &&
        strnicmp(kind, 'trap door ', 10) !== 0
      ) {
        isOpen = false;
        isClosed = false;
      }
    }
    let end = indexFrom(line, wordAt, ',');
    if (end === -1) end = line.length;
    let word = end;
    while (word > wordAt && line[word - 1] !== ' ') word -= 1;
    const rest = line.slice(word);
    if (rest.length === 0) {
      continued(s, line.slice(at));
      return finish(s, before);
    }
    if (rest.startsWith('NONE!') || rest.startsWith('None')) return finish(s, before);
    const dir = exitDirection(rest);
    if (dir === -1) {
      if (line.slice(at).length > 0x1ff) {
        s.lineFlags &= ~0x10000;
        return 0;
      }
      continued(s, line.slice(at));
      return finish(s, before);
    }
    if (isOpen) s.roomExits[dir] = 3;
    else if (isClosed) s.roomExits[dir] = 2;
    else s.roomExits[dir] = wordAt === word ? 1 : 4;
    if (line[end] !== ',') return finish(s, before);
    at = end + 1;
    while (line[at] === ' ') at += 1;
  }
}

/** The exits line went on to the next line: keep what is left (`0xd910`). */
function continued(s: Session, rest: string): void {
  s.s_d910 = rest.slice(0, 0x1ff);
  s.lineFlags |= 0x10000;
}

/** The room is read: its signature, and what a new room means. */
function finish(s: Session, before: number): number {
  s.roomName = s.roomNameSeen.slice(0, 0x34);
  let code = 0;
  for (let dir = 0; dir < 10; dir += 1) {
    let v = s.roomExits[dir] === 4 ? 0 : (s.roomExits[dir] ?? 0);
    if (v === 3) v = 2;
    code |= v << (dir * 2);
  }
  let sig = ((s.roomNameHash & 0xfff00000) | code) >>> 0;
  if (sig === 0xb7200050) sig = 0xb7200055;
  s.f_8130 = sig | 0;
  if (s.inCombat === 0 && s.f_8130 !== before) unkeepAll(s);
  if (s.f_8130 !== before) {
    s.f_e198 = 0;
    forgetLastTarget(s);
  }
  s.roomRecord = s.data.rooms?.find((r) => r.signature === s.f_8130) ?? null;
  s.lineFlags = (s.lineFlags | 4) & ~1;
  if (s.state === 0x16) {
    s.f_db34 = -1;
    if (s.f_db30 !== -1) s.host.arrived?.(s.f_db30);
  }
  if (s.state === 0x16 || s.state === 0x2b) setState(s, 0);
  s.darkness = 0;
  s.blind = 0;
  s.f_e290 = 0;
  s.f_e294 = 0;
  s.f_8138 = 0;
  s.f_db74 = 0;
  s.f_db78 = 0;
  s.f_e19c = 0;
  return 1;
}
