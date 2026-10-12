/**
 * `0x453ef0`: dropping, hiding and giving away, read 2026-10-12: `You
 * dropped …`, `You hid …`, `You gave … to …`, `You just gave … to …`. What
 * went is carried no more; a dropped item is now in the room. `You don't
 * have … to drop` (or hide, or sell) forgets the encumbrance limit; `There is
 * no room to …` ends a stash.
 */
import { indexFrom, indexOf, leadingNumber, splitWord } from '../cstr';
import { prioritize } from '../room/alsoHere';
import { findItem, sameItem } from '../room/checkNames';
import { addEntity } from '../room/entities';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { carryLess, wealthCarried } from './inventory';

export function dropLine(s: Session, line: string): number {
  if (
    indexOf(line, "You don't have ") !== -1 &&
    (indexOf(line, ' to drop') !== -1 ||
      indexOf(line, ' to hide') !== -1 ||
      indexOf(line, ' to sell') !== -1)
  ) {
    s.f_8468 = 0;
    forgetAwaited(s, s.state);
    setState(s, 0);
    return 1;
  }
  if (indexOf(line, 'There is no room to ') !== -1) {
    s.f_e2c0 = 0;
    s.f_e1e0 = 1;
    forgetAwaited(s, s.state);
    setState(s, 0);
    return 1;
  }
  let hid = false;
  let gave = false;
  let at: number;
  let end = line.length;
  if ((at = indexOf(line, 'You dropped ')) !== -1) {
    at += 0xc;
    s.hidden = 0;
  } else if ((at = indexOf(line, 'You hid ')) !== -1) {
    at += 8;
    hid = true;
  } else {
    let to = -1;
    at = indexOf(line, 'You gave ');
    if (at !== -1) to = indexFrom(line, at, ' to ');
    if (at !== -1 && to !== -1) {
      end = to;
      at += 9;
    } else {
      at = indexOf(line, 'You just gave ');
      if (at === -1) return 0;
      to = indexFrom(line, at, ' to ');
      if (to === -1) return 0;
      end = to;
      at += 0xe;
    }
    gave = true;
  }
  forgetAwaited(s, s.state);
  setState(s, 0);
  const what = line.slice(at, Math.min(end, at + 0x63));
  const [n, numEnd] = leadingNumber(what);
  let count = n;
  let [name] = splitWord(what.slice(numEnd).replace(/^ +/, ''), '.', 100);
  if (count === 0 && !/^[0-9]/.test(what)) count = 1;
  if (/^[0-9]/.test(name)) {
    const [m, mEnd] = leadingNumber(name);
    const rest = name.slice(mEnd);
    const bare = rest.replace(/^ +/, '');
    if (m > 0 && bare !== rest && bare !== '') {
      count = m;
      name = bare;
    }
  }
  if (count >= 1) {
    carryLess(s, name, count, hid ? 0x1e : 0x1d);
    const item = findItem(s, name);
    if (item) {
      if (!hid && !gave) {
        let e = s.room.find((x) => x.type === 3 && sameItem(x.name, name)) ?? null;
        if (!e) {
          e = addEntity(s);
          e.name = name.slice(0, 30);
          e.type = 3;
          e.item = item;
        }
        e.count += count;
      }
      prioritize(s);
    }
  }
  s.roomSelected = -1;
  wealthCarried(s);
  return 1;
}
