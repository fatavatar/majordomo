/**
 * Who comes and goes (`0x473340`): greetings and rests that name someone not
 * listed, sneaks noticed, movement heard, departures (`X just left to the
 * north.`) and arrivals (`X walks into the room from the south.`). Read
 * 2026-10-12.
 *
 * An arrival asks for the room again (`0xe290`) unless it is a party member;
 * walking a path with auto-combat off, it starts running instead. A
 * departure takes the creature off the room's list, and a player being
 * chased is followed (`0x4730d0`).
 */
import { clearMultiCounts, targetLeft } from '../combat/engaged';
import { indexFrom, indexOf, stricmp, trimSpaces } from '../cstr';
import { removeMember } from '../party/members';
import type { Session } from '../Session';
import { unported } from '../unported';
import { prioritize } from './alsoHere';
import { checkNames, findPlayer, partyIndex } from './checkNames';
import { findEntity, removeEntity, stopToKill } from './entities';

const ARRIVALS = [
  ' in the room ',
  ' into the room ',
  ' into the room!',
  ' into the area',
  ' enters the room',
  ' room from ',
  ' in from ',
  ' enters from ',
  ' appears in a ',
  ' appears right beside you',
  ' appears in front of you',
  ' appears from ',
  ' appears out of ',
  ' arrives from ',
  ' rows up ',
  ' down from above',
  ' through the wall!',
  ' beside you!',
  ' next to you!'
];

export function comingsLine(s: Session, line: string): number {
  let at = indexOf(line, ' greets you.');
  if (at === -1) at = indexOf(line, ' stops to rest');
  if (at !== -1) {
    const who = trimSpaces(line.slice(0, Math.min(at, 10)));
    if (!findEntity(s, who, 0)) s.f_e290 = 1;
    return 0;
  }
  const notice = indexOf(line, 'You notice ');
  let sneak = -1;
  if (notice !== -1) {
    sneak = indexFrom(line, notice, ' sneaking out');
    if (sneak === -1) sneak = indexFrom(line, notice, ' sneak in');
  }
  if (sneak !== -1) {
    const who = line.slice(notice + 0xb, notice + 0xb + Math.min(sneak - notice - 0xb, 10));
    if (partyIndex(s, who) !== -1) return 1;
    if (!findEntity(s, who, 0)) s.f_e290 = 1;
    if (indexOf(line, ' sneaking out') !== -1) departed(s, line, who);
    return 1;
  }
  if (indexOf(line, 'You hear movement ') !== -1) {
    if (s.runCount !== 1 || s.f_907c !== 0) return 1;
    if (s.Combat_ClearOnceEngaged !== 0 && s.f_8be4 !== 0) return 1;
    s.runCount = 2;
    return 1;
  }
  let left = indexOf(line, ' just left ');
  if (left !== -1) {
    if (indexOf(line, 'the Realm') !== -1) return 0;
    if (indexOf(line, 'your group') !== -1 || indexOf(line, 'your channel') !== -1) return 1;
  } else {
    left = indexOf(line, 'rows out');
    if (left === -1) left = indexOf(line, 'rows a skiff');
    if (left === -1) left = indexOf(line, 'scales the ');
    if (left === -1) return arrival(s, line);
  }
  const who = line.slice(0, Math.min(left, 99));
  const member = partyIndex(s, who);
  if (member !== -1) {
    if (s.leaderName === s.Player_Name) removeMember(s, member);
    return 1;
  }
  departed(s, line, who);
  const e = findEntity(s, who, 0);
  if (!e) {
    s.f_e290 = 1;
    return 1;
  }
  const name = e.name;
  const i = s.room.findIndex((x) => stricmp(name, x.name) === 0);
  if (i !== -1) removeEntity(s, i);
  // MegaMUD compares the index it stopped at with the shortened count, so
  // taking the last entry off asks for the room again too.
  if (i === -1 || i === s.room.length) s.f_e290 = 1;
  const wasTarget = s.target !== '' && stricmp(s.target, name) === 0;
  checkNames(s);
  prioritize(s);
  if (wasTarget) targetLeft(s);
  return 1;
}

/** The arrivals half of `0x473340`. */
function arrival(s: Session, line: string): number {
  if (!ARRIVALS.some((phrase) => indexOf(line, phrase) !== -1)) return 0;
  for (let i = 0; i < s.partySize; i += 1) {
    const name = s.party[i]!.name;
    if (line.startsWith(name)) return 1;
  }
  if (s.f_e184 !== 0 && s.held === 0 && s.f_e18c === 0 && s.following === 0) {
    if (s.MegaMud_AutoCombat === 0) {
      if (s.runCount === 0 && stopToKill(s) === 0) s.runCount = s.Combat_RunRooms;
      s.f_e2d8 = 1;
      return 1;
    }
    if (s.runCount !== 0) {
      s.f_e2d8 = 1;
      return 1;
    }
  }
  if (s.Combat_ResetMultiOnMobEntry !== 0) clearMultiCounts(s);
  if (s.f_e21c !== 0) {
    if (s.whoList.length < 1) return 1;
    if (!s.whoList.some((name: string) => line.startsWith(name))) return 1;
  }
  s.f_32390 = 0;
  s.f_e290 = 1;
  return 1;
}

/**
 * `0x4730d0`: the direction someone left in. When it is the player being
 * chased (or one flagged "chase if seen") and not a party member in step,
 * it is followed.
 */
function departed(s: Session, line: string, who: string): number {
  const name = trimSpaces(who.slice(0, 99).split(' ')[0] ?? '');
  if (name === '') return 0;
  const p = findPlayer(s, name);
  if (!p) return 0;
  if (s.chaseTarget !== name && (p.flags & 0x40) === 0) return 0;
  const member = partyIndex(s, name);
  if (member !== -1 && (s.party[member]!.flags28 & 0x8c) === 0) return 0;
  let dir = indexOf(line, 'upwards') !== -1 ? 8 : -1;
  if (indexOf(line, 'downwards') !== -1) dir = 9;
  if (indexOf(line, 'to the north') !== -1) dir = 0;
  if (indexOf(line, 'to the south') !== -1) dir = 1;
  if (indexOf(line, 'to the east') !== -1) dir = 2;
  if (indexOf(line, 'to the west') !== -1) dir = 3;
  if (indexOf(line, 'to the northeast') !== -1) dir = 4;
  if (indexOf(line, 'to the northwest') !== -1) dir = 5;
  if (indexOf(line, 'to the southeast') !== -1) dir = 6;
  if (indexOf(line, 'to the southwest') !== -1) dir = 7;
  if (indexOf(line, 'and rows out into the river') !== -1) dir = s.roomExits[0] === 0 ? 1 : 0;
  if (indexOf(line, 'scales the ') !== -1) dir = s.roomExits[8] !== 0 ? 8 : 9;
  else if (dir === -1) return 0;
  s.f_db38 = dir;
  s.chaseTarget = name.slice(0, 10);
  if (unported('408540') !== 0) s.f_db38 = -1;
  return 1;
}
