/**
 * Everything else that happens in a fight (`0x427120`): death, an attack the
 * server would not take, a weapon or fists with no effect, someone moving to
 * attack or cast, experience gained (a kill), someone dropping, someone
 * protecting the target. Read 2026-10-12.
 */
import { abbrev, indexFrom, indexOf, indexOfNoCase, stricmp, trimSpaces } from '../cstr';
import { countCast, f_426ab0, multiStillWanted, spellTakesTarget } from './casts';
import { findSpell } from '../spells/lookup';
import {
  clearAlignment,
  clearCastMode,
  clearMainCounts,
  clearTargetCasts,
  combatOff,
  endAltHeal,
  sawWeapons
} from './engaged';
import { weaponKinds } from './hits';
import { combatRoundEnd } from './rounds';
import { removeMember } from '../party/members';
import { prioritize } from '../room/alsoHere';
import {
  checkNames,
  findMonster,
  findPlayer,
  hangupAllowed,
  looksLikeName,
  markMonsters,
  partyIndex
} from '../room/checkNames';
import {
  addEntity,
  dropUnkeptCreatures,
  enemiesHere,
  findEntity,
  removeEntity,
  stopToKill,
  unkeepAll
} from '../room/entities';
import { hangUp } from '../script/game';
import { queue, send } from '../script/send';
import { forgetAwaited, setState } from '../script/state';
import { setTask } from '../script/task';
import { automated, type RoomEntity, type Session } from '../Session';
import { isCastState } from '../states';
import { immunityText } from '../player/cast';
import { newMonster, newPlayer } from '../data';
import { castForgotten, roundEvent, RoundEvent } from './timer';
import { goTo, headFor, roomByName } from '../move/destinations';
import { stamp } from '../script/events';

/** The weapons (`0x53eb48`): bit, letter. */
const WEAPONS: [number, string][] = [
  [1, 'N'],
  [2, 'A'],
  [4, 'B']
];

export function combatEventLine(s: Session, line: string): number {
  if (s.state === 0x20) return 0;
  if (
    indexOf(line, 'You have been killed!') !== -1 ||
    indexOf(line, 'But, due to a miracle, you have been saved') !== -1
  ) {
    return killed(s);
  }
  let echo: string;
  if (f_426ab0(s, 0) !== 0 && f_426ab0(s, 1) !== 0) {
    echo = `You say "${s.castShort}${s.target === '' ? '' : ' '}${s.target}`;
  } else if (s.target === '') {
    echo = '\x01\x01';
  } else {
    echo = `You say "${s.Combat_AttackCmd} ${s.target}`;
  }
  const refused =
    indexOf(line, 'Your command had no effect') !== -1 ||
    indexOf(line, 'You need a weapon ') !== -1 ||
    indexOf(line, echo) !== -1 ||
    (s.target !== '' &&
      (indexOf(line, 'You say "bs ') !== -1 || indexOf(line, 'You say "backstab ') !== -1) &&
      indexOf(line, s.target) !== -1);
  if (refused) return attackRefused(s);

  if (
    indexOf(line, 'To do this action, ') !== -1 ||
    indexOf(line, 'You are overcome with a feeling of guilt') !== -1
  ) {
    notAnEnemy(s);
    s.inCombat = 0;
    s.f_e2b8 = 0;
    clearTargetCasts(s);
    clearCastMode(s);
    setState(s, 0);
    return 1;
  }
  if (
    indexOf(line, 'Your weapon has no effect') === 0 ||
    indexOf(line, 'Your fists have no effect') === 0
  ) {
    return noEffect(s, line);
  }
  if (indexOf(line, 'You cannot backstab with') !== -1) {
    if (s.Combat_RunIfBsFails === 0 && s.held === 0 && stopToKill(s) === 0)
      s.runCount = s.Combat_RunRooms;
    s.sneaking = 0;
    s.hidden = 0;
    s.f_e1b8 = 1;
    return 1;
  }
  const breaks = indexOf(line, ' breaks off combat');
  if (breaks !== -1) {
    s.f_e2b8 = 0;
    const who = line.slice(0, Math.min(breaks, 0x13));
    if (s.f_8130 !== 0x67110001 || s.f_a32c !== 0 || stricmp(s.target, who) !== 0) return 1;
    send(s, 'break\r');
    unkeepAll(s);
    s.f_e290 = 1;
    return 1;
  }
  const attackYou = indexOf(line, ' moves to attack you!');
  if (attackYou !== -1) return pvp(s, line.slice(0, Math.min(attackYou, 0x13)));
  const castAt = indexOf(line, ' moves to cast ');
  if (castAt !== -1 && (indexOf(line, ' on you.') !== -1 || indexOf(line, ' on you!') !== -1)) {
    return pvp(s, line.slice(0, Math.min(castAt, 0x13)));
  }
  const everyone = indexOf(line, ' moves to attack everyone in the room');
  if (everyone !== -1) return attackEveryone(s, line, everyone);
  const attackOther = indexOf(line, ' moves to attack ');
  if (attackOther !== -1) return memberEngages(s, line, attackOther, attackOther + 0x11, 1);
  if (castAt !== -1) {
    let at = indexFrom(line, castAt, ' on ');
    if (at !== -1) at += 4;
    else {
      at = indexFrom(line, castAt, ' at ');
      if (at !== -1) at += 4;
      else {
        at = indexFrom(line, castAt, ' upon ');
        if (at !== -1) at += 6;
      }
    }
    if (at !== -1) return memberEngages(s, line, castAt, at, 0);
  }
  const rob = indexOf(line, ' tries to rob you');
  const bumps = indexOf(line, ' bumps');
  if (rob !== -1 && bumps !== -1) return pvp(s, line.slice(0, Math.min(bumps, 0x13)));
  const gain = indexOf(line, 'You gain ');
  if (gain !== -1 && indexFrom(line, gain, ' experience') !== -1) {
    const exp = Number(/^\s*-?\d+/.exec(line.slice(gain + 9))?.[0] ?? 0);
    s.exp += exp;
    if (s.expToLevel !== -1) s.expToLevel = exp < s.expToLevel ? s.expToLevel - exp : 0;
    if (exp >= 0) return killedSomething(s);
  } else if (indexOf(line, 'You have progressed too far without training') !== -1) {
    return killedSomething(s);
  }
  const drops = indexOf(line, ' drops to the ground!');
  if (drops !== -1) return dropped(s, trimSpaces(line.slice(0, Math.min(drops, 0x13))));
  if (indexOf(line, ' is dead.') !== -1) {
    unkeepAll(s);
    s.f_e290 = 1;
    setState(s, 0);
    return 1;
  }
  const protect = indexOf(line, ' moves to protect ');
  if (protect === -1) return 0;
  let protectee = line.slice(protect + 0x12, protect + 0x12 + 99);
  while (protectee.length > 0 && '.! '.includes(protectee[protectee.length - 1]!))
    protectee = protectee.slice(0, -1);
  protectee = trimSpaces(protectee);
  if (s.inCombat === 0 || s.target === '') return 1;
  const guarded = findEntity(s, protectee, 0);
  const target = findEntity(s, s.target, 0);
  if (guarded && target && guarded !== target) {
    if (s.debug !== 0) s.host.trace('{W-prot-x}');
    return 1;
  }
  s.s_dd14 = '';
  s.f_ddf0 = 1;
  s.f_dd10 = 0;
  if (s.debug !== 0) s.host.trace('{W-prot}');
  return 1;
}

/** "You have been killed!": the party and the path end; hang up when allowed. */
function killed(s: Session): number {
  s.partySize = 0;
  s.following = 0;
  clearAlignment(s);
  s.f_8558 = 0;
  s.f_e1e4 = 0;
  if (s.f_8130 !== 0x67110001) {
    s.f_e398 = 1;
    s.walking = 0;
    s.rescueCount = 0;
    setTask(s, 0xb);
    if (hangupAllowed(s) !== 0) {
      s.f_30de4 = 1;
      s.f_30de8 = 1;
      s.f_30dec = 1;
      hangUp(s, 0);
      s.host.alert?.('hangup');
    }
    s.f_8468 = 0;
    return 1;
  }
  if (automated(s) && s.f_a32c === 0) return 1;
  goTo(s, 0x67110001, null);
  headFor(s, 0);
  return 1;
}

/** `0x426940`: the monster that cannot be fought becomes a non-enemy, or MegaMUD runs a room. */
function notAnEnemy(s: Session): number {
  const e = s.room[0];
  if (!e || e.type === 3) return 0;
  if (e.player) return 1;
  let mon = e.mon;
  if (!mon) {
    mon = findMonster(s, e.name);
    e.mon = mon;
    if (!mon) {
      mon = newMonster(s.data);
      e.mon = mon;
      mon.name = e.name.slice(0, 30);
      s.host.show(`[${e.name} added to known monsters]`);
    }
  }
  if ((mon.flags & 2) !== 0 || stopToKill(s) !== 0) {
    mon.flags |= 2;
    mon.relationship = 3;
    s.f_e254 = 1;
    s.host.show(`[${mon.name} marked as non-enemy]`);
    e.kind = 3;
    prioritize(s);
    return 1;
  }
  s.runCount = 1;
  return 1;
}

/**
 * `Your weapon has no effect` (or fists): the weapon is marked as possibly
 * useless against this monster (`0x20000`… by weapon), and the second time
 * as useless for good; with no weapon to blame, twice in a row escapes the
 * fight ("[melee ineffective vs …]").
 */
function noEffect(s: Session, line: string): number {
  if (
    s.lastTyped !== '' &&
    stricmp(s.lastTyped, line) === 0 &&
    s.host.tickMs() - s.typedAt < 5000
  ) {
    s.lastTyped = '';
    if (s.debug !== 0) s.host.trace('{W-echo}');
    return 1;
  }
  const bareHands =
    s.f_b0fc === 0 &&
    (abbrev(s.Combat_AttackCmd, 'punch', 2) !== 0 ||
      abbrev(s.Combat_AttackCmd, 'jumpkick', 2) !== 0 ||
      abbrev(s.Combat_AttackCmd, 'kick', 3) !== 0);
  const weapons = s.s_b060 === '' || bareHands ? 0 : weaponKinds(s, s.s_b060);
  const [why, target] = blameTarget(s);
  if (why === 0) {
    s.f_dd80 = s.f_dd78;
    s.f_dd84 = s.f_dd7c;
  }
  let newlyImmune = false;
  if (weapons === 0) {
    if (why === 0) {
      if (s.s_dd14 !== s.target) {
        s.s_dd14 = s.target.slice(0, 99);
        s.f_dd10 = 0;
      }
      s.f_dd10 += 1;
      if (s.debug !== 0) s.host.trace(`{W-noeff:${s.f_dd10}}`);
    }
    if (s.target !== '' && s.f_8bec === 0 && s.f_dd10 > 1) {
      if (s.debug !== 0) s.host.trace('{W-esc}');
      s.host.show(`[melee ineffective vs ${s.target}]`);
      s.f_8bec = 1;
      s.sneaking = 0;
      s.hidden = 0;
      s.inCombat = 0;
      s.f_e2b8 = enemiesHere(s, 0) > 0 ? 1 : 0;
      setState(s, 0);
      return 1;
    }
  } else {
    for (const [bit, letter] of WEAPONS) {
      if ((weapons & bit) === 0 || why === 3 || why === 6) continue;
      if (why === 0 && target?.mon && target.mon.name !== '') {
        const sure = bit === 1 ? 0x200 : bit === 2 ? 0x400 : 0x4000;
        const maybe = bit === 1 ? 0x20000 : bit === 2 ? 0x40000 : 0x80000;
        if ((target.flags & sure) !== 0) {
          sawWeapons(s, bit);
          continue;
        }
        if ((target.flags & maybe) === 0) {
          if (markMonsters(s, target.mon.name, maybe) < 1) {
            sawWeapons(s, bit);
            continue;
          }
          s.f_df08 |= bit;
          if (s.debug !== 0) s.host.trace(`{W-pend:${letter}}`);
        } else if ((bit & s.f_df08) === 0) {
          s.f_df08 |= bit;
          if (s.debug !== 0) s.host.trace(`{W-hold:${letter}}`);
        } else if ((s.f_df00 & bit) !== 0) {
          markMonsters(s, target.mon.name, sure);
          if (s.debug !== 0) s.host.trace(`{W-${letter}}`);
          sawWeapons(s, bit);
          newlyImmune = true;
        } else if ((s.f_df04 & bit) !== 0) {
          if (s.debug !== 0) s.host.trace(`{W-noconf:${letter}}`);
          sawWeapons(s, bit);
        }
      } else {
        sawWeapons(s, bit);
      }
    }
    if (newlyImmune && target)
      s.host.show(`[${target.name} now immune to: ${immunityText(target.flags)}]`);
  }
  if (s.target !== '' && s.f_8bec === 0) {
    s.sneaking = 0;
    s.hidden = 0;
    s.inCombat = 0;
    s.f_b0fc = 1;
    s.f_e2b8 = enemiesHere(s, 0) > 0 ? 1 : 0;
    setState(s, 0);
    return 1;
  }
  s.sneaking = 0;
  s.hidden = 0;
  const e = s.target === '' ? null : findEntity(s, s.target, 0);
  clearTargetCasts(s);
  clearCastMode(s);
  if (e) e.kind = 5;
  s.inCombat = 0;
  setState(s, 0);
  return 1;
}

/**
 * `0x426160`: why a no-effect can or cannot be laid on the target: 0 it can
 * (the same monster, fought again in the same room, nothing in the way); 1
 * no target; 2 another monster or room; 3 a mass equip; 4 protected; 5 no
 * attack allowed; 6 the room has changed since.
 */
function blameTarget(s: Session): [number, RoomEntity | null] {
  const e = s.target === '' ? null : findEntity(s, s.target, 0);
  let why: number;
  if (s.target === '' || !e) why = 1;
  else if (s.f_e218 !== 0) why = 5;
  else if (s.f_ddf0 !== 0) why = 4;
  else if (s.f_a5f8 >= 1) why = 3;
  else if (s.lastTarget === '' || stricmp(s.lastTarget, s.target) !== 0 || s.f_ddec !== s.f_8130)
    why = 2;
  else if ((s.f_dd80 === 0 && s.f_dd84 === 0) || s.f_dd80 !== s.f_dd78 || s.f_dd84 !== s.f_dd7c)
    return [0, e];
  else why = 6;
  if (s.debug !== 0 && !(why === 1 && s.target === '' && s.inCombat === 0))
    s.host.trace(`{W-drop:${why}}`);
  return [why, e];
}

/** A player moving against this character: no longer hidden or sneaking (`0x427120`), then `0x42b8f0`. */
export function pvp(s: Session, name: string): number {
  s.hidden = 0;
  s.sneaking = 0;
  pvpAttack(s, name, 1);
  return 1;
}

/** The arena, where nobody is attacked for real (`0x67110001`, as `breaks off combat` reads it). */
const ARENA = 0x67110001;

/**
 * `0x472d10`: a name that is a player's — in the room and not a monster,
 * on the `who` list, or known — rather than a monster's.
 */
export function knownPlayer(s: Session, name: string): number {
  if (looksLikeName(name) === 0) return 0;
  for (const e of s.room) {
    if (e.name !== name || e.type === 3) continue;
    if (e.type === 2) return 0;
    return e.mon === null ? 1 : 0;
  }
  if (s.whoList.some((w) => w.name === name)) return 1;
  return s.data.players?.some((p) => p.name === name) ? 1 : 0;
}

/**
 * `0x42b8f0`: a player attacked this character. `PvP.PvpAction` decides
 * what follows — 0 hang up, 1 run (hanging up when held or not walking),
 * 2 run, 3 fight, 4 fight and chase, 5 ignore it. A party member's blow is
 * forgiven (`@OI!` and `forgive`) unless they have left the listing; the
 * gang is told (`PvP.NotifyGang`), and the party asked to `@kill` them
 * (`tell`). They are marked an enemy (or one to flee), their remote
 * control taken away, and kept in the known players. Not in the arena.
 */
export function pvpAttack(s: Session, name: string, tell: number): void {
  if (s.PvP_PvpAction === 5) return;
  if (looksLikeName(name) === 0) {
    if (s.f_a32c === 0) s.host.show('[Ignoring malformed PvP attacker name]');
    s.f_e2a4 = 1;
    s.f_e290 = 1;
    return;
  }
  if (s.data.monsters.some((m) => stricmp(m.name, name) === 0)) {
    s.f_e290 = 1;
    return;
  }
  if (knownPlayer(s, name) === 0) {
    if (s.f_a32c === 0) s.host.show('[Ignoring unknown PvP attacker name]');
    s.f_e2a4 = 1;
    s.f_e290 = 1;
    return;
  }
  if (s.target === name) return;
  s.target = '';
  s.f_e2b8 = 1;
  s.inCombat = 0;
  let arena = false;
  if (s.f_8130 === ARENA) {
    arena = true;
  } else {
    if (s.f_a32c === 0) s.host.trace(`[PVP detected! (${stamp(s)})]`);
    s.f_3252c += 1;
    s.f_322f8 = s.now;
    if (s.f_a32c === 0) {
      const member = partyIndex(s, name);
      if (member !== -1) {
        const p = findPlayer(s, name);
        let listed = (s.party[member]!.flags28 & 8) === 0;
        if (p && stricmp(name, s.leaderName) === 0) listed = ((p.flags >> 5) & 1) !== 0;
        if (!p || p.kind > 2 || listed) {
          send(s, '@OI!\r');
          send(s, s.s_7d21 !== '' ? s.s_7d21 : '.');
          send(s, 'forgive ');
          send(s, name);
          send(s, '\r');
          return;
        }
        removeMember(s, member);
      }
      if (s.PvP_NotifyGang !== 0 && s.Player_Gang !== '') {
        send(s, 'gb {Being attacked by ');
        send(s, name);
        send(s, '}\r');
      }
      if (tell !== 0 && s.partySize > 0) {
        send(s, s.s_7d21);
        send(s, '@kill ');
        send(s, name);
        send(s, '\r');
      }
    }
    if (s.f_a32c === 0 || s.Other_HangupAllOff !== 0) {
      const action = s.PvP_PvpAction;
      const hang =
        action === 0 || (action === 1 && (s.held !== 0 || (s.walking === 0 && s.roaming === 0)));
      if (s.MegaMud_NoHangup === 0 && hang) {
        s.f_30de4 = 1;
        s.f_30de8 = 1;
        s.f_30dec = 1;
        hangUp(s, 1);
      }
      s.host.alert?.('hangup');
    } else {
      s.host.alert?.('playerEntered');
    }
    if (s.f_a32c === 0) {
      if (s.PvP_PvpAction === 2 || s.PvP_PvpAction === 1) {
        s.f_e1a0 = 1;
        s.runCount = s.PvP_FleeRooms;
        const room = s.PvP_PvpFleeRoom !== '' ? roomByName(s, s.PvP_PvpFleeRoom) : null;
        if (room) {
          s.f_9104 = room.signature;
          if (goTo(s, room.signature, null) !== 0) {
            s.detours[0]!.why = 'fleeing';
            headFor(s, 0);
          }
        }
      }
      if (s.PvP_PvpAction === 4) s.chaseTarget = name.slice(0, 10);
    }
  }

  let e = findEntity(s, name, 0);
  if (!e) {
    e = addEntity(s);
    e.name = name.slice(0, 30);
    e.type = 1;
    e.kind = 4;
  }
  if (e.player === null) {
    const p = findPlayer(s, name);
    if (p === null) {
      const made = newPlayer(s.data, s.now);
      made.name = name.slice(0, 10);
      made.flags = 1;
      made.kind = 4;
      e.player = made;
      s.f_e24c = 1;
      s.host.show(`[Adding ${name} to known players]`);
    } else {
      e.player = p;
      e.kind = p.kind;
    }
  }
  e.flags &= ~0x60;
  const p = e.player;
  if (!arena) p.flags |= 0x4000;
  p.greetedAt = s.now;
  if ((p.flags & 0x8000) === 0) {
    if (p.seen === 0) s.f_32528 += 1;
    p.seen += 1;
    p.flags |= 0x8000;
  }
  if (e.kind === 4 || e.kind === 5 || e.kind === 6 || s.f_a32c !== 0) {
    if (arena) e.flags |= 1;
  } else {
    e.kind = 4;
    if (!arena) {
      if (s.PvP_PvpAction === 2 || s.PvP_PvpAction === 1) {
        e.kind = 5;
        s.host.trace(`[Player ${name} marked as flee!]`);
      } else {
        s.host.trace(`[Player ${name} marked as enemy!]`);
      }
      p.kind = e.kind;
      if (p.remote !== 0) {
        p.remote = 0;
        s.host.trace(`[Player ${name} remote control _access removed!]`);
      }
      s.f_e24c = 1;
    } else {
      e.flags |= 1;
    }
  }
  checkNames(s);
  prioritize(s);
}

/** `X moves to attack everyone in the room`: a party member (or a player) attacking the room. */
function attackEveryone(s: Session, line: string, at: number): number {
  if (indexOf(line, 'with either') !== -1) return 0;
  if (line.startsWith('Leo the Quick')) return 0;
  // `(unsigned)(at - 1) > 9`: a name of 1 to 10 characters, as C's wrap has it.
  if (at < 1 || at - 1 > 9 || at > 0x13) {
    s.host.trace('{area-pvp-malformed}');
    return 1;
  }
  const name = trimSpaces(line.slice(0, at));
  const member = partyIndex(s, name);
  if (member !== -1) {
    if (s.MegaMud_AutoCombat !== 0) {
      if (name === s.leaderName) s.f_e1c0 = 0;
      if (name !== s.Player_Name && s.Party_AttackLast !== 0) {
        if (s.now - s.f_324a0 > 1 || s.f_324a0 < s.f_32490) {
          s.f_e2b8 = 1;
          s.f_324a0 = s.now;
        }
      }
    }
    if (s.Party_AttackLate === 0 || s.partySize < 3) return 1;
    attackLate(s, member, name, '*room*', 0);
    return 1;
  }
  if (knownPlayer(s, name) === 0) {
    if (s.f_a32c === 0) s.host.show('[Ignoring unknown PvP attacker name]');
    s.f_e2a4 = 1;
    s.f_e290 = 1;
    return 1;
  }
  const p = findPlayer(s, name);
  if (p && p.level > 1) {
    const other = (p.flags & 2) !== 0 ? (p.level === 2 ? 4 : p.level + 4) : p.level;
    if (
      Math.abs(s.Player_Level - p.level) > s.pvpLevel &&
      Math.abs(s.Player_Level - other) > s.pvpLevel
    ) {
      s.host.show('[Pvp out of range - assumed to be safe]');
      return 1;
    }
  }
  return pvp(s, name);
}

/**
 * `X moves to attack Y` or `X moves to cast … on Y` by a party member: with
 * `Party.AttLeaderMstr` the leader's target becomes this character's (pinned
 * first); with `Party.AttackLast` this character attacks once the leader has.
 */
function memberEngages(
  s: Session,
  line: string,
  nameEnd: number,
  targetAt: number,
  melee: number
): number {
  const who = line.slice(0, Math.min(nameEnd, 0x13));
  const member = partyIndex(s, who);
  if (member === -1) return 1;
  const victimText = line.slice(targetAt);
  let victim = findEntity(s, victimText, 0);
  if (!victim) {
    victim = addEntity(s);
    victim.name = victimText.slice(0, 30).split('.')[0]!;
    victim.kind = 4;
    checkNames(s);
    prioritize(s);
  }
  let leaderOnOther = false;
  if (s.MegaMud_AutoCombat !== 0 && who === s.leaderName) {
    s.f_e1c0 = 0;
    if (who !== s.Player_Name && victim !== s.room[0]) leaderOnOther = s.Party_AttLeaderMstr !== 0;
  }
  if (s.Party_AttackLast !== 0 || leaderOnOther) {
    if (s.Party_AttLeaderMstr !== 0) {
      pin(s, victim, 1);
      s.target = victim.name.slice(0, 99);
    }
    const recent = s.now - s.f_324a0 < 2 && s.f_324a0 >= s.f_32490;
    if (leaderOnOther || !recent) {
      s.f_e2b8 = 1;
      s.f_324a0 = s.now;
    }
  }
  if (s.Party_AttackLate === 0 || s.partySize < 3) return 1;
  attackLate(s, member, who, victim.name, melee);
  return 1;
}

/**
 * `0x423f80` (`Party.AttackLate`): member `i` is attacking `target` —
 * `*room*` for everyone in it. Two or more members newly on something, or
 * one still on the same target in melee a lag-wait (plus two seconds) on,
 * and this character joins in (`0xe2b8`), at most every two seconds; not
 * while backstabbing or sneaking. Its own attack only notes the target.
 */
function attackLate(s: Session, i: number, who: string, target: string, melee: number): void {
  const t = s.host.tickMs();
  if (i > 5 || partyIndex(s, target) !== -1) return;
  const member = s.party[i]!;
  if (stricmp(who, s.Player_Name) === 0) {
    s.f_324a8 = 0;
    member.target = target.slice(0, 30);
    s.f_324b0 = t;
    return;
  }
  const same = stricmp(member.target, target) === 0;
  let still = false;
  if (
    same &&
    melee !== 0 &&
    s.f_8be4 !== 0 &&
    s.f_324b0 !== 0 &&
    t - s.f_324b0 >= (s.Comms_LagWait + 2) * 1000
  ) {
    still = true;
  } else if (!same) {
    s.f_324a8 |= 1 << i;
    if (s.debug !== 0) s.host.trace(`{al+${i}}`);
  }
  member.target = target.slice(0, 30);
  s.f_324b0 = t;
  let count = 0;
  for (let bit = 0; bit < 6; bit += 1) if ((s.f_324a8 & (1 << bit)) !== 0) count += 1;
  if (s.state === 0x12 || s.sneaking !== 0) {
    if (s.debug !== 0 && (count > 1 || still)) s.host.trace('{al-bs}');
  } else if ((count > 1 || still) && t - s.f_324b8 >= 2000) {
    s.f_e2b8 = 1;
    s.f_324b8 = t;
    s.f_324a8 = 0;
    if (s.debug !== 0) s.host.trace(still && count <= 1 ? '{al!s}' : '{al!}');
  }
}

/** `0x474790`: pin an entry first (999) or last (-999), unpinning the rest. */
export function pin(s: Session, e: RoomEntity, first: number): void {
  for (const x of s.room) if (x.priority === 999 || x.priority === -999) x.priority = 0;
  e.priority = first !== 0 ? 999 : -999;
  prioritize(s);
}

/**
 * A kill (`You gain N experience`): the round's damage closes, an alt heal
 * ends, the monster leaves the room, and either the multi-attack goes on
 * (it still has monsters, casts and damage left) or the fight is over.
 */
function killedSomething(s: Session): number {
  roundEvent(s, RoundEvent.Experience);
  if (s.Party_ParAfterRound !== 0) s.f_32328 = 0;
  s.f_32530 += 1;
  combatRoundEnd(s);
  endAltHeal(s);
  if (s.state === 0xa) s.f_a580 = 1;
  else if (s.state === 9 && s.Combat_PreMultAttack !== '') {
    if (spellTakesTarget(findSpell(s, s.Combat_PreMultAttack)) !== 0) s.f_a580 = 1;
  }
  let index = -1;
  if (s.target !== '') {
    index = s.room.findIndex((e) => e.type !== 3 && stricmp(e.name, s.target) === 0);
    if (index === -1 && s.state === 0xf) {
      const loose = s.room.findIndex((e) => e.type !== 3 && indexOfNoCase(e.name, s.target) !== -1);
      if (loose !== -1) index = loose;
    }
  }
  removeEntity(s, Math.max(index, 0));
  castForgotten(s);
  if (multiStillWanted(s)) {
    if (s.debug !== 0 && s.f_e1d8 !== 0) s.host.trace('{I3-}');
    s.f_e1d8 = 0;
    s.f_e2b8 = 0;
    clearMainCounts(s);
    s.target = '';
    s.f_32390 = 0;
    s.f_e290 = 1;
    return 1;
  }
  if (s.debug !== 0 && s.inCombat !== 0) s.host.trace('{C8}');
  s.inCombat = 0;
  if (s.debug !== 0 && s.f_e1d8 !== 0) s.host.trace('{I4-}');
  s.f_e1d8 = 0;
  s.f_e2b8 = 0;
  if (s.state === 0xf || s.stateAwaited === 0xf) forgetAwaited(s, 0xf);
  if (s.engagedMode !== 0) forgetAwaited(s, s.engagedMode);
  clearTargetCasts(s);
  clearCastMode(s);
  setState(s, 0);
  if (enemiesHere(s, s.Combat_AttackNeutral) === 0) {
    combatOff(s);
    s.f_e290 = 1;
    return 1;
  }
  s.f_e290 = 1;
  return 1;
}

/**
 * `X drops to the ground!`: this character (fight over; hang up when
 * allowed), or another: a party member or friend is aided, and a member
 * leaves the party.
 */
function dropped(s: Session, name: string): number {
  unkeepAll(s);
  if (name === s.Player_Name) {
    forgetAwaited(s, s.state);
    setState(s, 0);
    s.inCombat = 0;
    if (s.f_8130 === 0x67110001 || hangupAllowed(s) === 0) return 1;
    s.f_30de4 = 1;
    s.f_30de8 = 1;
    s.f_30dec = 1;
    hangUp(s, 1);
    s.host.alert?.('hangup');
    return 1;
  }
  if (name !== s.target) {
    const p = findPlayer(s, name);
    if (!p) return 0;
    const member = partyIndex(s, name);
    if (member !== -1 || p.kind === 2) {
      if (s.f_a32c === 0) queue(s, `aid ${name}\r`);
      if (member !== -1) s.party[member]!.flags28 |= 0x2000a;
      s.inCombat = 0;
      setState(s, 0);
    }
  }
  const member = partyIndex(s, name);
  if (member === -1) return 1;
  removeMember(s, member);
  return 1;
}

/**
 * The attack was not taken (`Your command had no effect`, `You need a
 * weapon`, or the server echoing the attack command back as speech): the
 * cast counts, the room's creatures are let go after a few, and the fight is
 * dropped so the scheduler chooses again.
 */
function attackRefused(s: Session): number {
  if (f_426ab0(s, 0) !== 0 && f_426ab0(s, 1) !== 0) countCast(s, s.state, 0);
  if (s.target !== '' || s.state === 0x11 || isCastState(s.state)) {
    s.f_dd0c += 1;
    if (s.f_dd0c > 2) unkeepAll(s);
    if (s.f_dd0c > 1) dropUnkeptCreatures(s);
    if (s.f_dd0c > 2) s.f_dd0c = 0;
  }
  if (s.f_a5f8 !== 0) s.f_a5f8 = Math.max(0, s.f_a5f8 - 1);
  if (s.s_b060 !== '' && stricmp(s.lastSent, `remove ${s.s_b060}\r`) === 0) s.s_b060 = '';
  const st = s.state;
  s.inCombat = 0;
  s.f_e2b8 = 0;
  if (st === 0x10 || st === 0x15 || isCastState(st)) castForgotten(s);
  clearTargetCasts(s);
  clearCastMode(s);
  forgetAwaited(s, s.state);
  setState(s, 0);
  if (s.blind === 0) s.f_32390 = 0;
  s.f_e290 = 1;
  return 1;
}
