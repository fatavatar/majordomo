/**
 * `0x47dfb0`: following and the party's ranks, read 2026-10-12:
 *
 * - `You are in the front rank of your group` (leading a party of one) and
 *   `… back rank …` (following);
 * - `<name> has invited you to follow` (a player allowed to, `0x20`: join,
 *   take the rank `Party.PartyRank` asks for, and if held, ask to wait);
 * - `You have invited <name> to follow you`, `<name> started to follow you`,
 *   `<name> has been removed from your followers`, `<name> just moved to the
 *   … of your group`;
 * - `You are now following <name>` (no own paths any more), `You are no
 *   longer following …` (call the leader back, or let go);
 * - `<name> stops to rest.` / `kneels to meditate.` (the leader resting: rest
 *   too);
 * - `-- Following your Party leader <dir> --`: moved with the party, a new
 *   room (everything of the last one forgotten), state `0x16`.
 */
import {
  clearAlignment,
  clearCastMode,
  clearMultiCounts,
  clearTargetCasts
} from '../combat/engaged';
import { askForHelp } from '../combat/heal';
import { heldRows } from '../messages/messages';
import { healthStep } from '../health/rest';
import { directionOf } from '../move/exits';
import { findPlayer, partyIndex } from '../room/checkNames';
import { enemiesHere, findEntity, unkeepAll } from '../room/entities';
import { queue, send } from '../script/send';
import { setState } from '../script/state';
import type { Session } from '../Session';
import { unported } from '../unported';
import { addMember, askParty, removeMember } from './members';

/** The name before `at` (up to 10 characters). */
function nameBefore(line: string, at: number): string {
  return line.slice(0, Math.min(at, 10));
}

/** Not waiting on the leader any more, unless still for a reason. */
function stopHolding(s: Session): void {
  if (s.holdingLeader !== 0 && s.restReason !== '') return;
  s.holdingLeader = 0;
  s.restReason = '';
  s.lastWaitSent = '';
  s.f_32338 = 0;
}

/** Ask the leader to wait, for a reason. */
function holdLeader(s: Session, reason: string): void {
  s.f_32338 = s.now;
  s.holdingLeader = 1;
  if (s.restReason === '') s.restReason = reason;
}

function invited(s: Session, line: string, at: number): number {
  const p = findPlayer(s, nameBefore(line, at));
  if (!p || (p.flags & 0x20) === 0 || s.f_a32c !== 0) return 1;
  if (s.following !== 0 && partyIndex(s, p.name) === -1) {
    s.host.show('[Already following]');
    return 1;
  }
  if (s.task === 0xe || s.task === 0xf) {
    if (s.MegaMud_AutoCombat === 0 && s.active !== 0 && s.Other_AutoAutoCombat !== 0) {
      s.host.show('[Auto-combat re-engaged]');
      s.MegaMud_AutoCombat = 1;
    }
    if (s.MegaMud_AutoHeal === 0 && s.active !== 0 && s.Other_AutoAutoHeal !== 0) {
      s.host.show('[Auto-rest/heal re-engaged]');
      s.MegaMud_AutoHeal = 1;
    }
  }
  s.chaseTarget = '';
  s.leaderName = p.name.slice(0, 10);
  queue(s, `join ${p.name}\r`);
  if (s.held === 0) {
    askForHelp(s);
  } else {
    holdLeader(s, "can't move");
    queue(s, `/${s.leaderName} ${s.Party_PartyWaitCmd || '@wait'} (can't move)\r`);
    s.f_e360 = 0;
    askParty(s, 'held');
  }
  if (s.Party_PartyRank === 0) queue(s, 'frontrank\r');
  else if (s.Party_PartyRank === 2) queue(s, 'backrank\r');
  s.f_e2ac = 1;
  return 1;
}

function noLongerFollowing(s: Session): number {
  if (s.held === 0) {
    if (s.holdingLeader !== 0 && s.restReason === '') {
      s.holdingLeader = 0;
      s.lastWaitSent = '';
      s.f_32338 = 0;
    }
  } else {
    queue(s, `/${s.leaderName} @comeback\r`);
    holdLeader(s, "can't move");
  }
  s.following = 0;
  s.f_e2ec = 1;
  s.partySize = 0;
  if (s.active !== 0 && s.f_e188 === 0 && s.f_e18c === 0) s.host.alert?.('idle');
  return 1;
}

/** The leader rests: so does a follower with auto-heal. */
function leaderRests(s: Session, name: string): number {
  if (
    name === s.leaderName &&
    s.Player_Name !== s.leaderName &&
    s.resting === 0 &&
    s.meditating === 0 &&
    s.f_a32c === 0 &&
    s.MegaMud_AutoHeal !== 0 &&
    enemiesHere(s, 0) === 0
  ) {
    s.f_e1c0 = 1;
    healthStep(s);
  }
  if (!findEntity(s, name, 0)) s.f_e290 = 1;
  return 1;
}

/** Moved with the party: a new room. */
function movedWithParty(s: Session, line: string, at: number): number {
  if (s.following === 0) {
    s.f_e2ac = 1;
    addMember(s, s.Player_Name, 0);
  }
  s.sneaking = s.f_e1c8 !== 0 ? 1 : 0;
  heldRows(s, 0);
  s.held = 0;
  stopHolding(s);
  if (s.holdingLeader !== 0 && s.f_a32c === 0) {
    if (s.restReason !== "can't move" && s.now - s.f_32338 > s.Comms_LagWait + 3) {
      const msg = `/${s.leaderName} ${s.Party_PartyWaitCmd || '@wait'} (${s.restReason})\r`;
      s.lastWaitSent = msg.slice(0, 299);
      send(s, msg);
      s.f_32338 = s.now;
    }
    healthStep(s);
  }
  s.f_db30 = directionOf(line.slice(at + 0x1f));
  s.f_32320 = s.now;
  s.f_32378 = s.now;
  s.f_32310 = 0;
  s.runDirection = -1;
  s.f_e1c8 = 0;
  s.hidden = 0;
  s.f_e2d8 = 0;
  s.f_e170 = 1;
  s.following = 1;
  s.f_e21c = 0;
  s.f_8be4 = 0;
  clearAlignment(s);
  s.f_907c = 0;
  s.f_e2ec = 0;
  s.f_e1c0 = 0;
  s.f_845c = 0;
  s.f_e2dc = 0;
  s.f_e1e8 = 0;
  s.f_e2b4 = 0;
  s.f_e2e0 = 0;
  s.f_e2e4 = 0;
  s.f_e220 = 0;
  s.f_e1e4 = 0;
  s.f_8558 = 0;
  s.f_db60 = s.Other_SearchMax;
  s.f_db68 = 0;
  s.f_db6c = 0;
  s.f_db70 = 0;
  s.f_db48 = 0;
  s.f_db50 = 0;
  s.f_db58 = 0;
  s.manaFullAt = 0;
  s.hpFullAt = 0;
  s.f_dd0c = 0;
  clearTargetCasts(s);
  clearMultiCounts(s);
  if (s.f_a580 === 0) clearCastMode(s);
  s.f_3268c += 1;
  unkeepAll(s);
  // `0x474910`: the players seen in the last room are not "seen this room" any more.
  for (const p of s.data.players ?? []) p.flags &= ~0x8000;
  if (s.f_e1e0 !== 0) {
    s.f_8468 = 0;
    s.f_e1e0 = 0;
  }
  setState(s, 0x16);
  return 1;
}

export function rankLine(s: Session, line: string): number {
  if (line.indexOf('You are in the front rank of your group') !== -1 && s.partySize === 0) {
    if (s.state === 0x20) return 1;
    addMember(s, s.Player_Name, 1);
    s.f_e2ac = 1;
    return 1;
  }
  if (
    line.indexOf('You are in the back rank of your group') !== -1 &&
    (s.partySize === 0 || s.following === 0)
  ) {
    if (s.state === 0x20) return 1;
    s.following = 1;
    s.f_e2ac = 1;
    return 1;
  }
  let at = line.indexOf(' has invited you to follow');
  if (at !== -1) return invited(s, line, at);
  at = line.indexOf('You have invited ');
  if (at !== -1) {
    const to = line.indexOf(' to follow you', at + 0x11);
    if (to !== -1) {
      const name = line.slice(at + 0x11, at + 0x11 + Math.min(to - at - 0x11, 10));
      addMember(s, name, 0);
      addMember(s, s.Player_Name, 1);
      const i = partyIndex(s, name);
      if (i !== -1) s.party[i]!.flags28 |= 4;
      s.f_32330 = s.now;
      return 1;
    }
  }
  at = line.indexOf('You are now following ');
  if (at !== -1) {
    let name = line.slice(at + 0x16, at + 0x16 + 0xb);
    const cut = name.search(/[^A-Za-z]/);
    if (cut !== -1) name = name.slice(0, cut);
    addMember(s, name, 1);
    addMember(s, s.Player_Name, 0);
    s.following = 1;
    s.f_e2ec = 0;
    stopHolding(s);
    // `0x482e30` twice: this character's own paths are let go.
    unported('482e30');
    return 1;
  }
  if (line.indexOf('You are no longer following') !== -1) return noLongerFollowing(s);
  at = line.indexOf('-- Following your Party leader ');
  if (at !== -1) return movedWithParty(s, line, at);
  at = line.indexOf(' started to follow you');
  if (at !== -1) {
    addMember(s, s.Player_Name, 1);
    const name = nameBefore(line, at);
    addMember(s, name, 0);
    const i = partyIndex(s, name);
    if (i !== -1) s.party[i]!.flags28 &= ~0x2bc;
    s.f_e2ac = 1;
    return 1;
  }
  at = line.indexOf(' has been removed from your followers');
  if (at !== -1) {
    const i = partyIndex(s, nameBefore(line, at));
    if (i !== -1) removeMember(s, i);
    return 1;
  }
  at = line.indexOf(' just moved to the ');
  if (at !== -1 && line.indexOf('of your group') !== -1) {
    const name = nameBefore(line, at);
    addMember(s, name, 0);
    const i = partyIndex(s, name);
    if (i !== -1) s.party[i]!.flags28 &= ~0x29c;
    return 1;
  }
  at = line.indexOf(' stops to rest.');
  if (at === -1) at = line.indexOf(' kneels to meditate.');
  if (at === -1) return 0;
  return leaderRests(s, nameBefore(line, at));
}
