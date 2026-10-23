/**
 * `You notice a lantern, 3 silver nobles here.` (`0x473a80`): the room's
 * items, in cyan. The listing may wrap; what is left is kept (`listingRest`).
 * Each item is added by `0x473dd0`. Read 2026-10-12.
 */
import { indexFrom, indexOf, leadingNumber, strnicmp, trimSpaces } from '../cstr';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { prioritize } from './alsoHere';
import { checkNames } from './checkNames';
import { addEntity, dropUnkeptItems } from './entities';
import { State } from '../states';
import { LineFlag, EntityFlag, EntityType, Stance } from '../flags';

export function noticeLine(s: Session, line: string): number {
  let at: number;
  if ((s.lineFlags & LineFlag.NoticeContinue) === 0) {
    const found = indexOf(line, 'You notice ');
    if (found === -1 || s.line.attr[found] !== 6) return 0;
    if (indexFrom(line, found, 'nothing different') !== -1) {
      s.lookDue = 1;
      setState(s, State.Nothing);
      return 1;
    }
    if (s.state === State.Looking) return 1;
    dropUnkeptItems(s);
    at = found + 0xb;
  } else {
    at = 0;
  }
  while (!line.startsWith('here.', at)) {
    if (line.startsWith(' here.', at)) break;
    let end = indexFrom(line, at, ',');
    if (end === -1) end = indexFrom(line, at, ' here.');
    if (end === -1) {
      s.listingRest = trimSpaces(line.slice(at, at + 0x1ff));
      s.lineFlags |= LineFlag.NoticeContinue;
      checkNames(s);
      prioritize(s);
      return 1;
    }
    if (end === at) {
      if (line.startsWith(' here.', at) || line.startsWith('here.', at)) return done(s);
      end = at + 1;
    } else {
      let name = line.slice(at, at + Math.min(Math.max(end - at, 0), 199));
      if ((s.lineFlags & LineFlag.NoticeContinue) !== 0) {
        s.lineFlags &= ~LineFlag.NoticeContinue;
        if (s.listingRest !== '') {
          name = `${s.listingRest} ${name}`.slice(0, 199);
          s.listingRest = '';
        }
      }
      addNoticed(s, name);
      if (line[end] === ',') end += 1;
      if (line[end] === ' ') end += 1;
    }
    at = end;
  }
  if ((s.lineFlags & LineFlag.NoticeContinue) !== 0 && s.listingRest !== '') {
    addNoticed(s, s.listingRest);
    s.listingRest = '';
    s.lineFlags &= ~LineFlag.NoticeContinue;
  }
  return done(s);
}

function done(s: Session): number {
  checkNames(s);
  prioritize(s);
  s.listingRest = '';
  s.lineFlags = (s.lineFlags & ~LineFlag.NoticeContinue) | LineFlag.ItemsListed;
  if (s.state === State.Searching) setState(s, State.Nothing);
  return 1;
}

/** `0x497a30`: 1 a corpse, 2 a lootbox (after an optional "the "), else 0. */
export function corpseOrLootbox(name: string): number {
  const n = strnicmp(name, 'the ', 4) === 0 ? name.slice(4) : name;
  const longer = (len: number): boolean => n.length > len;
  if (
    (strnicmp(n, 'corpse of ', 10) === 0 && longer(10)) ||
    (strnicmp(n, 'corpses of ', 11) === 0 && longer(11))
  ) {
    return 1;
  }
  if (strnicmp(n, 'lootbox for ', 12) === 0 && longer(12)) return 2;
  if (strnicmp(n, 'lootboxes for ', 14) !== 0) return 0;
  return longer(14) ? 2 : 0;
}

/**
 * `0x473dd0`: one noticed item, a stack when it starts with a number. A
 * corpse or a lootbox is flagged (`0x8000`, `0x10000`); a whirling vortex or
 * an obsidian obelisk changes the room's hash.
 */
function addNoticed(s: Session, text: string): number {
  const name = trimSpaces(text.slice(0, 199));
  if (name === '') return 0;
  const e = addEntity(s);
  e.name = name.slice(0, 0x1e);
  e.type = EntityType.Item;
  e.kind = Stance.Friend;
  e.count = 1;
  if (s.state === State.Searching) e.flags |= EntityFlag.Kept;
  if (/^[0-9]/.test(e.name)) {
    const [count, after] = leadingNumber(e.name);
    e.count = count;
    let start = after;
    while (e.name[start] === ' ') start += 1;
    e.name = e.name.slice(start);
  }
  const kind = corpseOrLootbox(e.name);
  if (kind === 1) e.flags |= EntityFlag.Corpse;
  else if (kind === 2) e.flags |= EntityFlag.Lootbox;
  if (e.name === 'whirling vortex') s.roomNameHash += 0x100000;
  if (e.name === 'obsidian obelisk') s.roomNameHash += 0x200000;
  return 1;
}
