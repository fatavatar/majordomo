/**
 * The room's contents: the list `0x471190` grows and the functions around it
 * (`0x4726a0`, `0x472270`, `0x472830`, …) read and prune. Read 2026-10-12.
 */
import { newEntity, type RoomEntity, type Session } from '../Session';

/** The record's `+0x24` bit for "not hostile" (Monsters.md). */
export const MON_NOT_HOSTILE = 0x200;

/**
 * `0x472830`: how many hostile monsters are here. An entry counts when it is
 * not an item and its kind is 4, 5 or 6. Unless `alsoNeutral`, a monster
 * whose record says "not hostile" is left out until it has attacked
 * (entity flag `0x10`).
 */
export function enemiesHere(s: Session, alsoNeutral: number): number {
  let count = 0;
  for (const e of s.room) {
    if (e.type === 3 || (e.kind !== 4 && e.kind !== 5 && e.kind !== 6)) continue;
    if (
      alsoNeutral === 0 &&
      e.mon &&
      (e.mon.flags & MON_NOT_HOSTILE) !== 0 &&
      (e.flags & 0x10) === 0
    ) {
      continue;
    }
    count += 1;
  }
  return count;
}

/**
 * `0x471190`: a new, empty entry. It goes to the end, or to the front when
 * in a party with `Party.AttackReverse` on.
 */
export function addEntity(s: Session): RoomEntity {
  const e = newEntity();
  if (s.partySize > 0 && s.Party_AttackReverse !== 0) s.room.unshift(e);
  else s.room.push(e);
  return e;
}

/** `0x472270`: remove entry `i`; 1 when there was one. */
export function removeEntity(s: Session, i: number): number {
  if (i < 0 || i >= s.room.length) return 0;
  s.room.splice(i, 1);
  return 1;
}

/** `0x4726a0`: drop every entry that is neither kept (flag 1) nor an item. */
export function dropUnkeptCreatures(s: Session): void {
  for (let i = s.room.length - 1; i >= 0; i -= 1) {
    const e = s.room[i]!;
    if ((e.flags & 1) === 0 && e.type !== 3) removeEntity(s, i);
  }
  s.roomSelected = -1;
}

/** `0x4725d0`: drop every item that is not kept. */
export function dropUnkeptItems(s: Session): void {
  for (let i = s.room.length - 1; i >= 0; i -= 1) {
    const e = s.room[i]!;
    if ((e.flags & 1) === 0 && e.type === 3) removeEntity(s, i);
  }
  s.roomSelected = -1;
}

/** `0x4748e0`: nothing is kept any more. */
export function unkeepAll(s: Session): void {
  for (const e of s.room) e.flags &= ~1;
}

/** `0x472620`: the room is empty. */
export function clearRoom(s: Session): void {
  s.room = [];
  s.roomSelected = -1;
}

/** `0x474970`: the first known monster flagged "stop to kill" becomes hostile (kind 4). */
export function stopToKill(s: Session): number {
  for (const e of s.room) {
    if (e.type === 2 && e.mon && (e.mon.flags & 0x800) !== 0) {
      e.kind = 4;
      return 1;
    }
  }
  return 0;
}
