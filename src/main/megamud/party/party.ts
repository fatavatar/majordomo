/**
 * `0x47ec60`: the party (`par`), read 2026-10-12:
 *
 *   The following people are in your travel party:
 *     Fatty Fatterson                (Skald)      [M:100%] [H:100%]   - Frontrank
 *
 * Each member's class, HP and mana (percent, worked back into points from
 * the last known maximum), and poison; `[Invited]` for one asked who has not
 * joined (the leader asks them to `@join`). Members not listed again are
 * dropped (a follower's list), and a follower whose leader is not here asks
 * them to `@comeback`. Also `You are following …` and `You are not in a
 * party`. The listing is `lineFlags` `0x2000`.
 */
import { atoi, splitWord } from '../cstr';
import { findClassByName } from '../data';
import { findPlayer, partyIndex } from '../room/checkNames';
import { findEntity } from '../room/entities';
import { queue } from '../script/send';
import type { PartyMember, Session } from '../Session';
import { addMember, removeMember } from './members';

function moving(s: Session): boolean {
  return s.f_e184 !== 0 || s.f_e18c !== 0 || s.f_e178 !== 0;
}

/** `0x4c1150`: the player is on the last `who`. */
function online(s: Session, name: string): boolean {
  return s.whoList.some((w) => w.name === name);
}

/** Points from a percent: the fewest that show as that percent of `max`. */
function fromPercent(pct: number, max: number): number {
  let n = Math.trunc((pct * max) / 100);
  if (n > 0) {
    while (n < max && Math.trunc((n * 100) / max) !== pct) n += 1;
  }
  return n;
}

/** Not in a party (any more). */
function noParty(s: Session, line: string): number {
  if (s.following === 0) {
    if ((s.active === 0 && !moving(s)) || s.f_a32c !== 0) s.partySize = 0;
    for (let i = s.partySize - 1; i >= 0; i -= 1) {
      const m = s.party[i]!;
      m.flags28 &= ~0x29c;
      if (m.name !== s.Player_Name) m.flags28 |= online(s, m.name) ? 8 : 0x80;
    }
  } else {
    s.partySize = 0;
    if (s.active !== 0 && s.f_e188 === 0 && s.f_e18c === 0) s.host.alert?.('idle');
  }
  for (let i = 0; i < s.partySize; i += 1) s.party[i]!.flags28 &= ~2;
  if (line.indexOf('Your party has been disbanded') === -1) {
    s.lineFlags &= ~0x2000;
    s.f_32328 = s.now;
    s.f_e298 = 0;
  }
  s.following = 0;
  return 1;
}

/** The listing ended (a prompt): drop who was not listed, and call the leader back. */
function listingEnd(s: Session): number {
  for (let i = s.partySize - 1; i >= 0; i -= 1) {
    const m = s.party[i]!;
    if ((m.flags28 & 0x188) !== 8) continue;
    if (s.f_e2ec !== 0 && m.name === s.leaderName) continue;
    if (s.Player_Name === s.leaderName) continue;
    if ((m.flags28 & 0x10) === 0) m.flags28 |= 0x10;
    else removeMember(s, i);
  }
  for (let i = 0; i < s.partySize; i += 1) s.party[i]!.flags28 &= ~2;
  for (let i = 0; i < s.partySize; i += 1) {
    if (s.party[i]!.maxHp < 1) s.party[i]!.flags28 |= 1;
  }
  s.lineFlags &= ~0x2000;
  s.f_e298 = 0;
  if (s.f_e2ec === 0 || s.leaderName === '') return 0;
  if (s.Player_Name === s.leaderName) {
    s.holdingLeader = 0;
    s.f_e2ec = 0;
    return 0;
  }
  if (findEntity(s, s.leaderName, 0)) return 0;
  queue(s, `/${s.leaderName} @comeback\r`);
  return 1;
}

/** One member's line. */
function memberLine(s: Session, line: string): number {
  let rest = line.replace(/^ +/, '');
  let name: string;
  let surname: string;
  let cls: string;
  [name, rest] = splitWord(rest, ' ', 0xb);
  [surname, rest] = splitWord(rest, ' ', 0x13);
  if (rest.startsWith('[')) {
    cls = surname.slice(0, 14);
    surname = '';
  } else {
    [cls, rest] = splitWord(rest, ' ', 0xf);
  }
  rest = rest.replace(/^ +/, '');
  let manaTag = '';
  if (rest === '') {
    s.lineFlags &= ~0x2000;
    s.f_e2ac = 1;
    return 1;
  }
  if (rest.startsWith('[M:') || rest.startsWith('[K:')) {
    const close = rest.indexOf(']');
    if (close !== -1) manaTag = rest.slice(0, 9);
    rest = rest.slice(close + 1).replace(/^ +/, '');
    if (rest === '') {
      s.lineFlags &= ~0x2000;
      s.f_e2ac = 1;
      return 1;
    }
  }
  const hpTag = rest.slice(0, 10);
  cls = cls.slice(1);
  if (cls !== '') cls = cls.slice(0, -1);
  const classRec = findClassByName(s.data, cls);
  if (!classRec || hpTag[0] !== '[') return 0;
  const known = findPlayer(s, name);
  if (!known) {
    s.f_32328 = 0;
    s.f_e2ac = 1;
    s.f_e2a4 = 1;
    return 1;
  }
  if (known.surname !== surname) {
    known.surname = surname.slice(0, 18);
    s.f_e24c = 1;
    s.host.show(`[${name}'s surname updated]`);
  }
  if (known.cls !== classRec.id) {
    known.cls = classRec.id;
    s.f_e24c = 1;
    s.host.show(`[${name}'s class updated]`);
  }
  addMember(s, name, 0);
  const i = partyIndex(s, name);
  if (i === -1) return 0;
  const m = s.party[i]!;
  const was = m.flags28;
  m.flags28 = was & ~0x82;
  if (hpTag === '[Invited]') {
    m.hpPct = -1;
    m.maxHp = -1;
    m.flags28 |= 8;
    if (s.leaderName === s.Player_Name && findEntity(s, name, 0)) {
      s.rescueCount = 0;
      m.flags28 |= 0x200;
      queue(s, `/${name} @join\r`);
    }
  } else {
    m.flags28 = was & ~0x29e;
    m.hpPct = atoi(hpTag.slice(3).replace(/^ +/, ''));
    if (manaTag !== '') m.manaPct = atoi(manaTag.slice(3).replace(/^ +/, ''));
    if (m.maxHp > 0) m.hp = fromPercent(m.hpPct, m.maxHp);
    if (m.maxMana > 0) m.mana = fromPercent(m.manaPct, m.maxMana);
  }
  ownNumbers(s, m);
  const close = hpTag.indexOf(']');
  if (close !== -1) {
    const after = hpTag.slice(close + 1).replace(/^ +/, '');
    if (after.startsWith('P')) m.flags28 |= 0x1000;
    else if (hpTag.startsWith('[H:')) m.flags28 &= ~0x1000;
  }
  return 1;
}

/** This character's own line takes its own numbers; anyone else near full is not hurt. */
function ownNumbers(s: Session, m: PartyMember): void {
  if (m.name === s.Player_Name) {
    m.hp = s.hp;
    m.maxHp = s.Player_MaxHP;
    m.mana = s.mana;
    m.maxMana = s.Player_MaxMana;
  } else if (m.hpPct > 0x62) {
    m.flags28 &= ~0x20000;
  }
}

export function partyLine(s: Session, line: string): number {
  if (
    line.indexOf('You are not in a party') !== -1 ||
    line.indexOf('Your party has been disbanded') !== -1
  ) {
    return noParty(s, line);
  }
  if (line.indexOf('The following people are in your') !== -1) {
    s.lineFlags |= 0x2000;
    s.f_32328 = s.now;
    s.f_e2ac = 0;
    for (let i = 0; i < s.partySize; i += 1) s.party[i]!.flags28 |= 8;
    return 1;
  }
  const following = line.indexOf('You are following ');
  if (following !== -1) {
    const who = line.slice(following + 0x12);
    if (!who.startsWith('a ') && !who.startsWith('an ')) {
      s.leaderName = who.slice(0, 10).split('.')[0]!;
      s.following = 1;
      return 1;
    }
  }
  if ((s.lineFlags & 0x2000) === 0) return 0;
  if ((s.lineFlags & 1) !== 0) return listingEnd(s);
  return memberLine(s, line);
}
