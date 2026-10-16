/**
 * Arriving in a room: `Obvious exits: north, closed door east` (`0x4386d0`),
 * `You found an exit to the east!`, and `You can't seem to move anywhere`.
 * Read 2026-10-12.
 *
 * The exits are kept per direction (`roomExits`): 1 an exit, 2 a closed door,
 * 3 an open one, 4 one found by searching or of another kind. With the room's
 * name they make MegaMUD's signature for the room (`roomSignature`): the name's hash
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
import { heldRows } from '../messages/messages';
import { stepBack } from './moves';
import { State } from '../states';
import { LineFlag, Exit, Darkness } from '../flags';

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
  const before = s.roomSignature;
  const found = indexOf(text, 'You found an exit ');
  if (found !== -1) {
    const dir = directionOf(text.slice(found + 0x12));
    if (dir === -1) {
      s.roomLookedAt = 0;
      s.lookDue = 1;
    } else {
      s.roomExits[dir] = Exit.ProbablyHidden;
    }
    setState(s, State.Nothing);
    return 1;
  }
  if (indexOf(text, "You can't seem to move anywhere") !== -1 && s.held === 0) {
    heldRows(s, 1);
    s.held = 1;
    s.statDue = 1;
  }
  if (s.state === State.Moving && s.held !== 0) {
    if (s.recording !== 0) stepBack(s);
    s.lookDue = 1;
    setState(s, State.Nothing);
    return 1;
  }
  let line = text;
  let at = indexOf(line, 'Obvious exits: ');
  if (at === -1) {
    if ((s.lineFlags & LineFlag.ExitsContinue) === 0) return 0;
  } else {
    const colour = s.line.attr[at];
    if (colour !== 2 && colour !== 3) {
      if (at === 0) {
        s.setupDue = 1;
        setState(s, State.Nothing);
      }
      return 1;
    }
    if (s.inGame === 0) {
      s.inGame = 1;
      s.setupDue = 1;
    }
  }
  if (s.state === State.Looking) return 1;
  if ((s.lineFlags & LineFlag.ExitsContinue) === 0) {
    if (s.inCombat === 0 && s.roomNameSeen !== s.roomName) unkeepAll(s);
    if ((s.lineFlags & LineFlag.CreaturesListed) === 0) dropUnkeptCreatures(s);
    else s.lineFlags &= ~LineFlag.CreaturesListed;
    if ((s.lineFlags & LineFlag.ItemsListed) === 0) dropUnkeptItems(s);
    else s.lineFlags &= ~LineFlag.ItemsListed;
  }
  if ((s.lineFlags & LineFlag.ExitsContinue) === 0) {
    at += 0xf;
    s.roomExits = Array.from({ length: 10 }, () => 0);
  } else {
    if ((s.lineFlags & LineFlag.Prompted) !== 0) {
      s.lineFlags &= ~LineFlag.ExitsContinue;
      return 0;
    }
    if (s.listingRest !== '') {
      line = insertAt(insertAt(line, 0, ' '), 0, s.listingRest);
      s.listingRest = '';
    }
    s.lineFlags &= ~LineFlag.ExitsContinue;
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
        s.lineFlags &= ~LineFlag.ExitsContinue;
        return 0;
      }
      continued(s, line.slice(at));
      return finish(s, before);
    }
    if (isOpen) s.roomExits[dir] = Exit.OpenDoor;
    else if (isClosed) s.roomExits[dir] = Exit.ClosedDoor;
    else s.roomExits[dir] = wordAt === word ? Exit.Open : Exit.ProbablyHidden;
    if (line[end] !== ',') return finish(s, before);
    at = end + 1;
    while (line[at] === ' ') at += 1;
  }
}

/** The exits line went on to the next line: keep what is left (`listingRest`). */
function continued(s: Session, rest: string): void {
  s.listingRest = rest.slice(0, 0x1ff);
  s.lineFlags |= LineFlag.ExitsContinue;
}

/** The room is read: its signature, and what a new room means. */
function finish(s: Session, before: number): number {
  s.roomName = s.roomNameSeen.slice(0, 0x34);
  let code = 0;
  for (let dir = 0; dir < 10; dir += 1) {
    let v = s.roomExits[dir] === Exit.ProbablyHidden ? 0 : (s.roomExits[dir] ?? 0);
    if (v === Exit.OpenDoor) v = Exit.ClosedDoor;
    code |= v << (dir * 2);
  }
  let sig = ((s.roomNameHash & 0xfff00000) | code) >>> 0;
  if (sig === 0xb7200050) sig = 0xb7200055;
  s.roomSignature = sig | 0;
  if (s.inCombat === 0 && s.roomSignature !== before) unkeepAll(s);
  if (s.roomSignature !== before) {
    s.lostNeedsKnownRoom = 0;
    forgetLastTarget(s);
  }
  s.roomRecord = s.data.rooms?.find((r) => r.signature === s.roomSignature) ?? null;
  s.lineFlags = (s.lineFlags | LineFlag.DoorAnswered) & ~LineFlag.Prompted;
  if (s.state === State.Moving) {
    s.lastMoveDir = -1;
    if (s.moveDir !== -1) s.host.arrived?.(s.moveDir);
  }
  if (s.state === State.Moving || s.state === State.GetExits) setState(s, State.Nothing);
  s.darkness = Darkness.Lit;
  s.blind = 0;
  s.lookDue = 0;
  s.redisplayDue = 0;
  s.expectedRoom = 0;
  s.darkMisses = 0;
  s.darkTries = 0;
  s.darkEscapeShown = 0;
  return 1;
}
