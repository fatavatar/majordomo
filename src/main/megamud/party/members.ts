/** The party list (`0x8918`, six records). Read 2026-10-12. */
import type { Session } from '../Session';
import { newPlayer } from '../data';
import { findPlayer, looksLikeName } from '../room/checkNames';
import { queueCommand } from '../script/send';
import { newMember } from '../Session';
import { stamp } from '../script/events';

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

/**
 * `0x4816b0`, run by the party window's refresh (`0x481d40`) wherever the
 * party or this character's health changes: this character's own line kept
 * in step; with `recompute`, every member's health and mana percent worked
 * out again, and a member in step below `Party.PartyWait%` noted. Leading,
 * a member hurt (`0xac`) makes the party wait (`partyWait`); with nobody
 * below the mark that wait gives up after `Party.PartyWaitMax` minutes, the
 * members out of step dropped. With `Party.ShareDamage`, a member able to
 * take less than this character has left has this character join the fight
 * (`0xe2b8`), at most every three seconds. The window itself is drawn by our
 * party card.
 */
export function partyRefresh(s: Session, recompute: number): void {
  let below = false;
  let hurt = 0;
  for (let i = 0; i < s.partySize; i += 1) {
    const m = s.party[i]!;
    const self = m.name === s.Player_Name;
    if (self) {
      m.hp = s.hp;
      m.maxHp = s.Player_MaxHP;
      m.mana = s.mana;
      m.maxMana = s.Player_MaxMana;
    }
    if (recompute !== 0) {
      if (m.maxHp > 0) {
        const pct = Math.trunc((m.hp * 100) / m.maxHp);
        m.hpPct = pct;
        if (!self && pct > 0x62) m.flags28 &= ~0x20000;
        if ((m.flags28 & 0x8c) === 0 && pct < s.Party_PartyWaitPct) below = true;
      }
      if (m.maxMana > 0) m.manaPct = Math.trunc((m.mana * 100) / m.maxMana);
    }
    if ((m.flags28 & 0xac) !== 0) hurt = 1;
  }
  const wait = s.leaderName === s.Player_Name ? hurt : 0;
  let timing = true;
  if (s.partyWait === 0 && wait !== 0) {
    s.f_32330 = s.now;
    s.partyWait = wait;
  } else {
    s.partyWait = wait;
    if (wait === 0) timing = false;
  }
  if (timing && !below && s.now - s.f_32330 >= s.Party_PartyWaitMax * 60) {
    s.host.show(`[Waiting timed out (${stamp(s)})]`);
    s.partyWait = 0;
    s.f_32330 = s.now;
    for (let i = s.partySize - 1; i >= 0; i -= 1) {
      const m = s.party[i]!;
      if ((m.flags28 & 0x8c) === 0) m.flags28 &= ~0x20;
      else removeMember(s, i);
    }
  }
  if (s.Party_ShareDamage !== 0 && s.partySize > 0) {
    let most = 0;
    for (let i = 0; i < s.partySize; i += 1) {
      const m = s.party[i]!;
      if (m.name !== s.Player_Name && m.maxHp > 0 && most <= m.maxHp) most = m.maxHp;
    }
    if (most !== 0 && most < s.hp && s.now - s.f_322e0 > 3) {
      s.f_e2b8 = 1;
      s.f_322e0 = s.now;
    }
  }
}
