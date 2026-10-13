/**
 * `Also here: a giant rat, Naji.` (`0x473f80`), the room's creatures, and the
 * attack order MegaMUD keeps them in (`0x474a90`). Read 2026-10-12.
 *
 * The line counts only in magenta (5 or 13) or green (2), the colours the
 * server draws it in; a name drawn white (7) is a player, cyan (6) one that
 * is not to be attacked. The listing may run over several lines: what is left
 * without a closing `.` is kept (`0xd910`) and joined to the next line.
 */
import { clearMultiCounts, targetLeft } from '../combat/engaged';
import { indexFrom, indexOf, stricmp, trimSpaces } from '../cstr';
import type { Session } from '../Session';
import { checkNames, coinValue } from './checkNames';
import { addEntity, enemiesHere, findEntity, removeEntity } from './entities';

/** The class spirits a "spirit" summon adds to the room's signature (`0x8130`), by its order. */
const SPIRITS = [
  'warrior',
  'witchunter',
  'mystic',
  'ranger',
  'priest',
  'cleric',
  'paladin',
  'missionary',
  'ninja',
  'thief',
  'bard',
  'gypsy',
  'warlock',
  'mage',
  'druid'
];

/** `0x473f80`. 1 when the line was a room listing (or its continuation). */
export function alsoHereLine(s: Session, line: string): number {
  let before = 0;
  let at: number;
  if ((s.lineFlags & 0x20000) === 0) {
    const found = indexOf(line, 'Also here: ');
    if (found === -1) return 0;
    const colour = s.line.attr[found];
    if (colour !== 5 && colour !== 0xd && colour !== 2) return 0;
    if (s.state === 0x20) return 1;
    before = enemiesHere(s, s.Combat_AttackNeutral);
    for (const e of s.room) if (e.type !== 3) e.flags |= 4;
    dropUnkept(s);
    at = found + 0xb;
  } else {
    at = 0;
  }
  while (line[at] !== '.') {
    let end = indexFrom(line, at, ',');
    if (end === -1) end = indexFrom(line, at, '.');
    if (end === -1) {
      s.s_d910 = trimSpaces(line.slice(at, at + 0x1ff));
      s.lineFlags |= 0x20000;
      checkNames(s);
      prioritize(s);
      return 1;
    }
    let name = line.slice(at, end);
    if ((s.lineFlags & 0x20000) !== 0) {
      s.lineFlags &= ~0x20000;
      if (s.s_d910 !== '') name = `${s.s_d910} ${name}`;
    }
    let charmed = false;
    const paren = name.indexOf('(');
    if (paren !== -1) {
      charmed = stricmp(name.slice(paren), '(Charmed)') === 0;
      name = name.slice(0, paren);
    }
    name = trimSpaces(name);
    let e = s.room.find((x) => {
      if (x.type === 3 || (x.flags & 4) === 0) return false;
      const len = x.name.length;
      if (x.name.toLowerCase() !== name.slice(0, len).toLowerCase()) return false;
      const after = name[len];
      return after === undefined || after === '*' || len === 0x1e;
    });
    if (!e) e = addEntity(s);
    e.flags &= ~4;
    if ((e.flags & 1) === 0) {
      e.name = name.slice(0, 0x1e);
      e.type = 0;
      e.kind = 0;
      const colour = s.line.attr[at];
      if (colour === 7) e.kind = 2;
      else if (colour === 6) e.kind = 3;
    }
    SPIRITS.forEach((cls, i) => {
      if (name === `${cls} spirit`) s.f_8130 += (i + 1) * 0x100000;
    });
    if (charmed) {
      e.flags |= 8;
      e.kind = 2;
    }
    at = end;
    if (line[at] === ',') at += 1;
    while (line[at] === ' ') at += 1;
  }
  for (let i = s.room.length - 1; i >= 0; i -= 1) {
    if ((s.room[i]!.flags & 4) !== 0) removeEntity(s, i);
  }
  checkNames(s);
  prioritize(s);
  if (
    s.Combat_ResetMultiOnMobEntry !== 0 &&
    before > 0 &&
    before < enemiesHere(s, s.Combat_AttackNeutral)
  ) {
    clearMultiCounts(s);
  }
  s.lineFlags |= 8;
  if (s.target !== '' && !findEntity(s, s.target, 0)) targetLeft(s);
  return 1;
}

/** `0x4726a0` as `0x473f80` calls it: drop the creatures that are not kept. */
function dropUnkept(s: Session): void {
  for (let i = s.room.length - 1; i >= 0; i -= 1) {
    const e = s.room[i]!;
    if ((e.flags & 1) === 0 && e.type !== 3) removeEntity(s, i);
  }
  s.roomSelected = -1;
}

/**
 * `0x474a90`: each entry's attack priority, then the room sorted by it,
 * highest first (a bubble sort, so equal priorities keep their order).
 *
 * Items rank 4, coins by worth (copper 0 … platinum 3). Monsters to hang up
 * on rank 0x10; to flee from, 0xf while pathing or roaming, else 9. Players
 * rank 0xe when hostile. Hostile monsters rank by their record's priority
 * (first 0xd, high 0xc, normal 0xb, low 0xa, last 9), one lower to avoid,
 * one lower again when not hostile and not yet attacking. Anything else is 6
 * (unknown or cyan) or 5. Priorities of 999 and -999 are pinned.
 */
export function prioritize(s: Session): void {
  for (const e of s.room) {
    if (e.priority === 999 || e.priority === -999) continue;
    if (e.item) {
      e.priority = 4;
      if ((e.item.flags & 0x8000000) !== 0) {
        const worth = coinValue(s, e.name);
        if (worth === 100) e.priority = 2;
        else if (worth === 1) e.priority = 0;
        else if (worth === 10) e.priority = 1;
        else if (worth === 10000) e.priority = 3;
      }
      continue;
    }
    if (e.kind === 6) {
      e.priority = 0x10;
    } else if (e.kind === 5) {
      e.priority = s.walking !== 0 || s.importing !== 0 || s.roaming !== 0 ? 0xf : 9;
    } else if (!e.player) {
      if (e.kind === 4) {
        e.priority = 0xb;
        if (e.mon) {
          let p = 0xb;
          switch (e.mon.flags & 0xf0) {
            case 0x10:
              p = 9;
              break;
            case 0x20:
              p = 10;
              break;
            case 0x40:
              p = 0xc;
              break;
            case 0x80:
              p = 0xd;
              break;
          }
          e.priority = p;
          if (e.mon.relationship === 3) {
            p -= 1;
            e.priority = p;
          }
          if ((e.mon.flags & 0x200) !== 0 && (e.flags & 0x10) === 0) e.priority = p - 1;
        }
      } else if (e.kind === 3 || e.kind === 0) {
        e.priority = 6;
      } else {
        e.priority = 5;
      }
    } else if (e.kind === 4) {
      e.priority = 0xe;
    }
  }
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i < s.room.length - 1; i += 1) {
      if (s.room[i]!.priority < s.room[i + 1]!.priority) {
        const a = s.room[i]!;
        s.room[i] = s.room[i + 1]!;
        s.room[i + 1] = a;
        swapped = true;
      }
    }
  }
}
