/**
 * The room's contents: the list `0x471190` grows and the functions around it
 * (`0x4726a0`, `0x472270`, `0x472830`, …) read and prune. Read 2026-10-12.
 */
import { indexOfNoCase, stricmp, strnicmp } from '../cstr';
import { findMonster as findMonsterNamed, stripAdjective as stripAdjectiveOf } from './checkNames';
import { newEntity, type RoomEntity, type Session } from '../Session';
import { EntityFlag, MonsterFlag, PartyFlag, EntityType, Stance } from '../flags';
import { Task } from '../script/task';

/** The record's `+0x24` bit for "not hostile" (Monsters.md). */

/**
 * `0x472830`: how many hostile monsters are here. An entry counts when it is
 * not an item and its kind is 4, 5 or 6. Unless `alsoNeutral`, a monster
 * whose record says "not hostile" is left out until it has attacked
 * (entity flag `0x10`).
 */
export function enemiesHere(s: Session, alsoNeutral: number): number {
  let count = 0;
  for (const e of s.room) {
    if (
      e.type === EntityType.Item ||
      (e.kind !== Stance.Enemy && e.kind !== Stance.Flee && e.kind !== Stance.Hangup)
    )
      continue;
    if (
      alsoNeutral === 0 &&
      e.mon &&
      (e.mon.flags & MonsterFlag.NotHostile) !== 0 &&
      (e.flags & EntityFlag.Fought) === 0
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
    if ((e.flags & EntityFlag.Kept) === 0 && e.type !== EntityType.Item) removeEntity(s, i);
  }
  s.roomSelected = -1;
}

/** `0x4725d0`: drop every item that is not kept. */
export function dropUnkeptItems(s: Session): void {
  for (let i = s.room.length - 1; i >= 0; i -= 1) {
    const e = s.room[i]!;
    if ((e.flags & EntityFlag.Kept) === 0 && e.type === EntityType.Item) removeEntity(s, i);
  }
  s.roomSelected = -1;
}

/** `0x4748e0`: nothing is kept any more. */
export function unkeepAll(s: Session): void {
  for (const e of s.room) e.flags &= ~EntityFlag.Kept;
}

/** `0x472620`: the room is empty. */
export function clearRoom(s: Session): void {
  s.room = [];
  s.roomSelected = -1;
}

/** `0x474970`: the first known monster flagged "stop to kill" becomes hostile (kind 4). */
export function stopToKill(s: Session): number {
  for (const e of s.room) {
    if (e.type === EntityType.Monster && e.mon && (e.mon.flags & MonsterFlag.StopToKill) !== 0) {
      e.kind = Stance.Enemy;
      return 1;
    }
  }
  return 0;
}

/**
 * `0x472490`: the room entry named `name`. A name matches when it is the
 * entry's whole name, or its start followed by a space, `.` or `,` (so "rat"
 * finds "rat", and the server's "rat." finds it too). While exiting the game
 * (task `0x13`), leading dots are skipped. With `loose`, any entry whose name
 * contains `name` does, failing that.
 */
export function findEntity(s: Session, name: string, loose: number): RoomEntity | null {
  let n = name;
  for (const e of s.room) {
    if (e.type === EntityType.Item) continue;
    if (s.task === Task.Exiting) n = n.replace(/^\.+/, '');
    const len = e.name.length;
    if (strnicmp(e.name, n, len) === 0) {
      const after = n[len];
      if (after === undefined || after === ' ' || after === '.' || after === ',') return e;
    }
  }
  if (loose !== 0) {
    for (const e of s.room) {
      if (e.type === EntityType.Item) continue;
      if (s.task === Task.Exiting) n = n.replace(/^\.+/, '');
      if (n !== '' && indexOfNoCase(e.name, n) !== -1) return e;
    }
  }
  return null;
}

/**
 * `0x4726f0`: the entry being fought. The target by name; else the cast's
 * target; else, in a fight, the target by a looser name when it is hostile or
 * has attacked; else the first entry when that is hostile. One the realm says
 * to flee (kind 5) gives way to the first monster flagged "stop to kill",
 * which becomes hostile.
 */
export function currentTarget(s: Session): RoomEntity | null {
  let found: RoomEntity | null = null;
  const hostile = (e: RoomEntity): boolean =>
    e.kind === Stance.Enemy ||
    e.kind === Stance.Flee ||
    e.kind === Stance.Hangup ||
    e.kind === Stance.Avoid ||
    (e.flags & EntityFlag.Fought) !== 0;
  if (s.target !== '') found = findEntity(s, s.target, 0);
  if (!found && s.countedTarget !== '') found = findEntity(s, s.countedTarget, 0);
  if (!found) {
    let picked: RoomEntity | null = null;
    if (s.inCombat !== 0 && s.target !== '') {
      const e = findEntity(s, s.target, 1);
      if (e && hostile(e)) picked = e;
    }
    if (!picked) {
      const first = s.room[0];
      if (first && first.type !== EntityType.Item && hostile(first)) picked = first;
    }
    found = picked;
  }
  if (found && found.kind !== Stance.Flee) return found;
  for (const e of s.room) {
    if (e.type === EntityType.Monster && e.mon && (e.mon.flags & MonsterFlag.StopToKill) !== 0) {
      e.kind = Stance.Enemy;
      return e;
    }
  }
  return found;
}

/**
 * `0x4749d0`: everyone here may be hit by a room spell. Items, hostile
 * entries and attackers aside: a player only when PvP is "attack all" (5) or
 * when it is a party member not flagged `4`; a monster only when it is not a
 * friend (kind 2); anything else, never.
 */
export function allAttackable(s: Session): number {
  for (const e of s.room) {
    if (
      e.type === EntityType.Item ||
      e.kind === Stance.Enemy ||
      (e.flags & EntityFlag.Fought) !== 0
    )
      continue;
    if (e.type === EntityType.Player) {
      if (s.PvP_PvpAction !== 5) {
        if (s.partySize < 1) return 0;
        const i = s.party
          .slice(0, s.partySize)
          .findIndex((m) => (m.flags28 & PartyFlag.Invited) === 0 && stricmp(e.name, m.name) === 0);
        if (i === -1) return 0;
      }
    } else if (e.type !== EntityType.Monster || e.kind === Stance.Friend) {
      return 0;
    }
  }
  return 1;
}

/**
 * `0x423e60`: an attacker the room has not listed (the character is blind or
 * it is dark), added when its name (or that name without an adjective) is a
 * known monster: hostile, attacking.
 */
export function newMonsterEntity(s: Session, text: string): RoomEntity | null {
  const name = text.slice(0, 99).trim();
  if (name === '' || name.length >= 0x1f) return null;
  let mon = findMonsterNamed(s, name);
  if (!mon) {
    const bare = stripAdjectiveOf(name);
    if (bare === name) return null;
    mon = findMonsterNamed(s, bare);
    if (!mon) return null;
  }
  const e = addEntity(s);
  e.name = name.slice(0, 0x1e);
  e.type = EntityType.Monster;
  e.kind =
    mon.relationship === Stance.Enemy ||
    mon.relationship === Stance.Flee ||
    mon.relationship === Stance.Hangup
      ? mon.relationship
      : Stance.Enemy;
  e.flags |= EntityFlag.Kept | EntityFlag.Fought;
  e.mon = mon;
  return e;
}
