/**
 * The scheduler's party and player steps, read 2026-10-12: the party's
 * status and members' health asked for (D17), players invited (D27), looked
 * at (D35) and tracked (D36).
 */
import { addMember } from '../party/members';
import { findPlayer, partyIndex } from '../room/checkNames';
import { enemiesHere } from '../room/entities';
import { automated, type Session } from '../Session';
import { send } from './send';
import { sneakStep } from './stealth';
import { setState } from './state';
import { awayExit, doors, move } from '../move/go';
import { State } from '../states';
import { LineFlag, PROMPT_SEEN, PartyFlag, PlayerFlag, EntityFlag, EntityType } from '../flags';

/** Ask for the party (`par`). */
function askParty(s: Session, why: string): number {
  s.waitLines = 2;
  s.parAt = s.now;
  s.parDue = 0;
  setState(s, State.Other);
  s.host.activity(why);
  send(s, 'par\r');
  return 1;
}

/**
 * `0x408e40` (D17): in a party, `par` when a member is unknown (`2`), or
 * timed (`Party.ParPeriod`; twice as long out of a fight, or when asked,
 * `parDue`); a member whose numbers are unknown asked for `@health`
 * (`Party.AskHealth`, unless they do not run MegaMUD, player flag 8).
 */
export function partyStatus(s: Session): number {
  if (s.partySize < 2 && s.parDue === 0) {
    s.partyWait = 0;
    s.partyStepPending = 0;
    return 0;
  }
  if (s.hp < 1) return 0;
  if (s.inCombat === 0 && s.MegaMud_AutoCombat === 1 && enemiesHere(s, 0) > 0) return 0;
  const fighting = s.inCombat !== 0 && s.MegaMud_AutoCombat !== 0;
  if (!fighting && s.now - s.parAt > s.Comms_LagWait + 3) {
    for (let i = 0; i < s.partySize; i += 1) {
      const m = s.party[i]!;
      if ((m.flags28 & PartyFlag.ChangedSinceListing) !== 0)
        return askParty(s, `Getting party status (member ${m.name} unknown)`);
    }
  }
  for (let i = 0; i < s.partySize; i += 1) {
    const m = s.party[i]!;
    if (m.name === s.Player_Name) {
      if ((m.flags28 & PartyFlag.HealthUnknown) !== 0) {
        m.hp = s.hp;
        m.maxHp = s.Player_MaxHP;
      }
      continue;
    }
    if (
      (m.flags28 &
        (PartyFlag.HealthUnknown | PartyFlag.Invited | PartyFlag.Unlisted | PartyFlag.Offline)) !==
      PartyFlag.HealthUnknown
    )
      continue;
    m.flags28 &= ~PartyFlag.HealthUnknown;
    if (s.Party_AskHealth === 0) continue;
    const p = findPlayer(s, m.name);
    if (p && (p.flags & PlayerFlag.NoMegaMud) !== 0) continue;
    s.waitLines = 2;
    setState(s, State.Other);
    s.host.activity(`Getting party member health from ${m.name}`);
    send(s, `/${m.name} @health\r`);
    return 1;
  }
  const elapsed = s.now - s.parAt;
  if (elapsed <= s.Comms_LagWait + 3) return 0;
  if (s.parDue === 0 && elapsed < s.Party_ParPeriod * 2) {
    if (elapsed < s.Party_ParPeriod || enemiesHere(s, 0) < 1) return 0;
  }
  return askParty(s, 'Getting party status (timed)');
}

/**
 * `0x407ee0` (D27): a player here invited: one to invite if seen (player
 * flag `0x10`), or a member gone from the party (`0x188`) when this
 * character leads; one already invited (`4`) asked to `@join` instead, once
 * (`0x200`).
 */
export function invitePlayers(s: Session): number {
  if (s.following === 1 || !automated(s) || s.allOff !== 0 || s.hp <= 0) return 0;
  for (const e of s.room) {
    if (e.type !== EntityType.Player) continue;
    let invite = e.player !== null && (e.player.flags & PlayerFlag.InviteIfSeen) !== 0;
    let join = false;
    const i = s.leaderName !== '' && s.Player_Name === s.leaderName ? partyIndex(s, e.name) : -1;
    if (i !== -1) {
      const f = s.party[i]!.flags28;
      invite = (f & (PartyFlag.Unlisted | PartyFlag.Offline | PartyFlag.LeftBehind)) !== 0;
      if ((f & PartyFlag.Invited) !== 0) {
        if ((f & PartyFlag.JoinAsked) !== 0) continue;
        join = true;
        invite = true;
      }
    }
    if (!invite) continue;
    s.rescueCount = 0;
    s.waitLines = 2;
    setState(s, State.Other);
    s.host.activity(`Inviting player ${e.name}`);
    send(s, join ? `/${e.name} @join\r` : `invite ${e.name}\r`);
    addMember(s, e.name, 0);
    const j = partyIndex(s, e.name);
    if (j === -1) continue;
    const m = s.party[j]!;
    m.flags28 =
      (m.flags28 | PartyFlag.Invited | (join ? 0x200 : 0)) &
      ~(PartyFlag.Unlisted | PartyFlag.Offline | PartyFlag.LeftBehind);
    return 1;
  }
  return 0;
}

/**
 * `0x408100` (D35): with `Talk.LookPlayers`, a player here not looked at
 * yet (entry flag 2) whose race or class is unknown (or not greeted),
 * looked at, at most every `LagWait` + 3 seconds; not while hidden.
 */
export function lookAtPlayer(s: Session): number {
  if (s.hp <= 0 || s.Talk_LookPlayers === 0) return 0;
  if (s.state === State.Looking) return 1;
  if (s.now - s.lookedAtPlayerAt <= s.Comms_LagWait + 3 || s.hidden !== 0 || s.allOff !== 0)
    return 0;
  for (let i = 0; i < s.room.length; i += 1) {
    const e = s.room[i]!;
    const p = e.player;
    if (
      e.type !== EntityType.Player ||
      !p ||
      (e.flags & EntityFlag.Shadowy) !== 0 ||
      (p.flags & PlayerFlag.DontLook) !== 0
    )
      continue;
    if (p.race !== 0 && p.cls !== 0 && (p.flags & PlayerFlag.LookedAt) !== 0) continue;
    s.roomSelected = i;
    s.waitLines = 2;
    s.lineFlags = (s.lineFlags & ~(PROMPT_SEEN | LineFlag.LookDescribed)) | LineFlag.Looking;
    s.lookedAtPlayerAt = s.now;
    setState(s, State.Looking);
    s.host.activity(`Looking at player ${e.name}`);
    send(s, `l ${e.name}\r`);
    return 1;
  }
  return 0;
}

/**
 * `0x40d2e0` (D36): following a track (`runDirection`, or the last `track`'s
 * direction, `0x437ae0`) while walking; else with `MegaMud.AutoTrack` and
 * `PvP.TrackEnemies`, an enemy online (or the one being chased) tracked,
 * each at most every `PvP.TrackDelay` seconds. The move itself (`0x408870`,
 * `0x408540`) is the walker's, not ported yet.
 */
export function trackPlayer(s: Session): number {
  if (s.allOff !== 0 || s.hp < 1) return 0;
  if (s.walking !== 0 && s.chaseTarget !== '') {
    const w = s.whoList.find((x) => x.name === s.chaseTarget);
    if (w && w.kind === 5) {
      s.chaseTarget = '';
      s.runDirection = -1;
    }
  }
  let follow = s.runDirection !== -1;
  if (!follow && s.tracking !== 0) {
    s.runDirection = awayExit(s);
    if (s.runDirection === -1) s.tracking = 0;
    else follow = true;
  }
  if (follow && s.walking !== 0) {
    if (doors(s, s.runDirection, 0, null) !== 0 || sneakStep(s) !== 0) return 1;
    if (move(s, s.runDirection, 1) !== 0) return 1;
  }
  if (s.Player_Tracking === 0 || s.MegaMud_AutoTrack === 0 || s.PvP_TrackEnemies === 0) {
    s.runDirection = -1;
    return 0;
  }
  for (const entry of s.whoList) {
    let w = s.chaseTarget !== '' ? (s.whoList.find((x) => x.name === s.chaseTarget) ?? null) : null;
    if (!w) w = entry.kind === 4 ? entry : null;
    if (!w) continue;
    if (s.now - (w.trackedAt ?? 0) < s.PvP_TrackDelay) continue;
    w.trackedAt = s.now;
    s.waitLines = 2;
    s.tracking = 1;
    setState(s, State.Tracking);
    s.host.activity(`Tracking player ${w.name}`);
    send(s, `track ${w.name}\r`);
    return 1;
  }
  return 0;
}
