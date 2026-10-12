/** The party list (`0x8918`, six records). Read 2026-10-12. */
import type { Session } from '../Session';
import { newPlayer } from '../data';
import { findPlayer, looksLikeName } from '../room/checkNames';
import { queueCommand } from '../script/send';
import { newMember } from '../Session';

/** `0x47dbf0`: member `i` leaves; a party of one is no party. */
export function removeMember(s: Session, i: number): number {
  if (i < 0 || i >= s.partySize) return 0;
  s.party.splice(i, 1);
  s.party.push(newMember());
  s.f_324a8 = 0;
  s.partySize -= 1;
  if (s.partySize === 1) s.partySize = 0;
  return 1;
}

/** `0x47de60`: the members in step (none of `0x88` set). */
export function membersInStep(s: Session): number {
  let n = 0;
  for (let i = 0; i < s.partySize; i += 1) if ((s.party[i]!.flags28 & 0x88) === 0) n += 1;
  return n;
}

/** `0x47ddd0`: the one other member in step, when there is exactly one. */
export function onlyOtherMember(s: Session): string | null {
  let found: string | null = null;
  for (let i = 0; i < s.partySize; i += 1) {
    const m = s.party[i]!;
    if (m.name === s.Player_Name || (m.flags28 & 0x88) !== 0) continue;
    if (found !== null) return null;
    found = m.name;
  }
  return found;
}

/**
 * `0x47dd20`: the member with the lowest HP (percent) that can be healed:
 * in step, and not a known player flagged `skip` (`0x491a50`'s `+0x54`).
 * This character too, unless `withSelf` is 0. -1 when none.
 */
export function weakestMember(s: Session, withSelf: number, skip: number): number {
  let best = -1;
  let lowest = 99999;
  for (let i = 0; i < s.partySize; i += 1) {
    const m = s.party[i]!;
    if (withSelf === 0 && m.name === s.Player_Name) continue;
    if ((m.flags28 & 0x8f) !== 0) continue;
    const known = findPlayer(s, m.name);
    if (known && (known.flags & skip) !== 0) continue;
    if (m.hpPct < lowest) {
      lowest = m.hpPct;
      best = i;
    }
  }
  return best;
}

/**
 * `0x4161d0`: ask the party for something (`@heal`, `@held`, …) by telepath
 * to the one other member, else by `s_7d21` (the party's say prefix); once
 * until the answer (`0xe360`).
 */
export function askParty(s: Session, what: string): number {
  if (s.f_e360 !== 0) return 0;
  s.f_e360 = 1;
  s.waitLines = 2;
  s.f_32398 = s.now;
  const other = onlyOtherMember(s);
  queueCommand(s, other !== null ? `/${other} @${what}\r` : `${s.s_7d21}@${what}\r`, 0, 0, 1);
  return 1;
}

/**
 * `0x47d9a0`: a member joins the list (when not on it): learned as a known
 * player if new, and with `leader`, the party's leader (and friendly).
 */
export function addMember(s: Session, name: string, leader: number): number {
  if (looksLikeName(name) === 0) {
    s.f_e2ac = 1;
    return 0;
  }
  let p = findPlayer(s, name);
  if (!p) {
    p = newPlayer(s.data, s.now);
    p.name = name.slice(0, 10);
    s.f_e24c = 1;
    s.host.show(`[${name} added to known players]`);
  }
  if (leader !== 0) {
    s.leaderName = name.slice(0, 10);
    if (p.kind === 0) {
      p.kind = 2;
      s.f_e24c = 1;
      if (name !== s.Player_Name) s.host.show(`[${name} upgraded to friendly]`);
    }
  }
  for (let i = 0; i < s.partySize; i += 1) if (s.party[i]!.name === name) return 1;
  if (s.partySize >= 6) return 0;
  s.party[s.partySize] = {
    ...newMember(),
    name: name.slice(0, 10),
    hpPct: -1,
    maxHp: -1,
    manaPct: -1,
    maxMana: -1,
    cls: p.cls,
    flags28: 2
  };
  s.partySize += 1;
  s.f_324a8 = 0;
  return 1;
}
