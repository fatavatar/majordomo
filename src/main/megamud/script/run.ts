/**
 * `0x40e190`: running away and attacking (D30, and at each prompt), read
 * 2026-10-12. First what may stop a fight: a PvP hang-up, staying hidden,
 * resting first; then whether to run (polite attacks, HP or mana below their
 * run percent, too few monsters to nuke, too many, too much experience here,
 * friends in the way of a room spell); and then the attack itself: a
 * backstab while sneaking, the attack spells (`0x40f510`) in their order, and
 * else the plain attack command.
 */
import { attack } from '../combat/attack';
import { normalWeapon } from '../combat/weapons';
import { inAttackCast, wantsRoomSpell } from '../combat/casts';
import { attackLateMark, clearCastMode, rememberTarget, targetChanged } from '../combat/engaged';
import { combatRoundEnd } from '../combat/rounds';
import { openingCommand, openingSent, opensOn } from '../combat/opening';
import { abbrev, idiv } from '../cstr';
import { postBackstab, postMeditate, postRest } from '../health/prepost';
import { healthStep } from '../health/rest';
import { hangupAllowed } from '../room/checkNames';
import { allAttackable, currentTarget, enemiesHere, stopToKill } from '../room/entities';
import { automated, moving, type RoomEntity, type Session } from '../Session';
import { hangUp } from './game';
import { send } from './send';
import { refreshWho } from './setup';
import { forgetAwaited, setState } from './state';
import { hideStep, sneakStep } from './stealth';
import { State } from '../states';
import { MonsterFlag, EntityFlag, PartyFlag, MONSTER_PRIORITY, EntityType, Stance } from '../flags';

/** A reason to run: counted, `Combat.RunRooms` (or one) rooms, the alert, and the message. */
export function startRun(s: Session, rooms: number, what: string, shown: string): void {
  s.runCount = rooms;
  s.host.activity(what);
  s.host.alert?.('lowHp');
  if (s.Display_ShowRunMsg !== 0 && s.held === 0 && s.partyWait === 0) s.host.show(shown);
}

/** `0x471590`: how tough a monster is, from its flags (0–4). */
function toughness(flags: number): number {
  switch (flags & MONSTER_PRIORITY) {
    case MonsterFlag.PriorityLast:
      return 0;
    case MonsterFlag.PriorityLow:
      return 1;
    case MonsterFlag.PriorityHigh:
      return 3;
    case MonsterFlag.PriorityFirst:
      return 4;
    default:
      return 2;
  }
}

/**
 * `0x4722f0`: another monster here to backstab instead: hostile, not of the
 * same kind, not immune to backstabs (`0x100`) nor the backstab weapon, and
 * at least as tough.
 */
function otherBackstab(s: Session, e: RoomEntity): RoomEntity | null {
  const name = e.mon?.name ?? '';
  const tough = e.mon ? toughness(e.mon.flags) : 0;
  for (const x of s.room) {
    if (x.type === EntityType.Item || x.kind !== Stance.Enemy || !x.mon) continue;
    if (name !== '' && x.mon.name === name) continue;
    if (
      (x.mon.flags & MonsterFlag.DontBackstab) === 0 &&
      (s.Other_IgnoreWeaponImmunity !== 0 || (x.flags & EntityFlag.ImmuneBackstabWeapon) === 0) &&
      tough <= toughness(x.mon.flags)
    ) {
      return x;
    }
  }
  return null;
}

/** `0x472ae0`: the experience of the hostile monsters here. */
function experienceHere(s: Session): number {
  let sum = 0;
  for (const e of s.room) {
    if (e.mon && (e.kind === Stance.Enemy || e.kind === Stance.Flee || e.kind === Stance.Hangup))
      sum += e.mon.exp;
  }
  return sum;
}

/** `0x472c00`: players here who are not in the party. */
function strangersHere(s: Session): number {
  let n = 0;
  for (const e of s.room) {
    if (e.type !== EntityType.Player) continue;
    const ours = s.party
      .slice(0, s.partySize)
      .some(
        (m) =>
          (m.flags28 & (PartyFlag.Invited | PartyFlag.Unlisted | PartyFlag.Offline)) === 0 &&
          m.name.toLowerCase() === e.name.toLowerCase()
      );
    if (!ours) n += 1;
  }
  return n;
}

/** Stop fighting to run: `break` first, with `BreakB4Running`. */
function breakOff(s: Session): number {
  if (s.Other_BreakB4Running !== 0) {
    s.inCombat = 0;
    send(s, 'break\r');
  }
  return 0;
}

/**
 * Whether to run (`0x40e34e`–`0x40e9a0`): reasons are weighed only while
 * moving on our own (not running, following or held by the user). `stop` is
 * `stopToKill`'s answer, cleared by a reason to run. Returns what the step
 * returns, or `{ stop }` to go on.
 */
function runChecks(s: Session, stop: number): { stop: number } | number {
  const polite = s.walking !== 0 && s.Combat_PoliteAttacks !== 0 && s.attackDue === 0;
  let fled = false;
  if (!polite || s.runCount === 0) {
    if (polite && s.following === 0 && s.partyWait === 0 && stop === 0 && strangersHere(s) > 0) {
      s.host.activity("Running to avoid other player's monsters");
      s.runCount = 1;
      s.runByChoice = 1;
      if (s.Display_ShowRunMsg !== 0 && s.held === 0 && s.partyWait === 0) {
        s.host.show('[Run 1: polite attacks]');
      }
    }
    if (s.runCount === 0 && s.following === 0 && s.allOff === 0 && moving(s)) {
      const result = reasonsToRun(s, stop);
      stop = result.stop;
      fled = result.fled;
    }
  }
  if (!fled && stop !== 0) {
    if (s.runCount > 0) {
      s.runCount = 0;
      s.runByChoice = 0;
    }
    autoAutoCombat(s, stop);
    return { stop };
  }
  if (s.runCount !== 0 && s.following === 0) {
    if (stop === 0) {
      if (moving(s) && s.held === 0 && s.partyWait === 0) {
        s.target = '';
        forgetAwaited(s, s.state);
        setState(s, State.Nothing);
        if (s.inCombat === 0) return 0;
        return breakOff(s);
      }
      if ((!automated(s) || s.allOff !== 0) && (s.sneaking !== 0 || s.hidden !== 0)) {
        forgetAwaited(s, s.state);
        setState(s, State.Nothing);
        s.host.activity('Unsafe attack conditions, so remaining hidden');
        return 1;
      }
    }
    autoAutoCombat(s, stop);
  }
  return { stop };
}

/** `0x40e4e5`–`0x40e8f9`: the reasons to run. `fled`: the last one (experience) fired. */
function reasonsToRun(s: Session, stop: number): { stop: number; fled: boolean } {
  if (s.Player_MaxHP > 0 && s.Combat_RunRooms > 0) {
    if (s.hp < idiv(s.Health_HpRunPct * s.Player_MaxHP, 100)) {
      stop = 0;
      const pct = idiv(s.hp * 100, s.Player_MaxHP);
      startRun(
        s,
        s.Combat_RunRooms,
        'Running: HP is too low',
        `[Run ${s.Combat_RunRooms}: HP's too low (${pct}%)]`
      );
    }
  }
  if (
    s.runCount === 0 &&
    s.Player_MaxMana > 0 &&
    s.Combat_RunRooms > 0 &&
    s.mana < idiv(s.Health_ManaRunPct * s.Player_MaxMana, 100)
  ) {
    stop = 0;
    const pct = idiv(s.mana * 100, s.Player_MaxMana);
    startRun(
      s,
      s.Combat_RunRooms,
      'Running: Mana/Kai is too low',
      `[Run ${s.Combat_RunRooms}: Mana/Kai too low (${pct}%)]`
    );
  }
  const n = enemiesHere(s, s.Combat_AttackNeutral);
  if (stop === 0 && s.runCount === 0 && s.MegaMud_AutoNuke !== 0 && s.Combat_MinMstrs > 0) {
    const once = s.Combat_ClearOnceEngaged === 0 || s.engagedHere === 0;
    if (n < s.Combat_MinMstrs && once) {
      s.runCount = 1;
      s.runByChoice = 1;
      s.host.activity(`Running: too few monsters to nuke (${n})`);
      if (s.warnFewMonsters !== 0 && s.held === 0 && s.partyWait === 0) {
        s.host.show('[Run: Too few monsters to nuke (once-per-session warning)]');
        s.warnFewMonsters = 0;
      }
    } else if (
      once &&
      s.Combat_MinMstrs <= n &&
      wantsRoomSpell(s, 1) !== 0 &&
      allAttackable(s) === 0
    ) {
      s.runByChoice = 1;
      startRun(
        s,
        1,
        "Running: Can't nuke - friends/players in room",
        "[Run: Can't nuke - Friends/Players in room!]"
      );
    }
  }
  const most = s.partySize < 1 ? s.Combat_MaxMstrs : s.Party_PartyMaxMstrs;
  if (s.runCount === 0 && most > 0 && most < n) {
    stop = 0;
    s.runByChoice = 1;
    startRun(
      s,
      1,
      s.partySize < 1 ? 'Running: too many monsters' : 'Running: too many monsters for party',
      `[Run: Too many monsters (${n})]`
    );
  }
  const limit = s.partySize < 1 ? s.Combat_MaxMstrExp : s.Party_PartyMaxExp;
  const exp = experienceHere(s);
  if (s.runCount !== 0 || limit <= 0 || exp <= limit) return { stop, fled: false };
  stop = 0;
  s.runByChoice = 1;
  startRun(
    s,
    1,
    'Running away because of excessive monster experience within the room',
    `[Run: Too much monster experience! (${exp})]`
  );
  return { stop, fled: true };
}

/** `Other.AutoAutoCombat`: auto-combat turns itself on when a fight is due (`0x40e938`). */
function autoAutoCombat(s: Session, stop: number): void {
  if (s.MegaMud_AutoCombat !== 0 || s.Other_AutoAutoCombat === 0) return;
  if (!((stop !== 0 && s.allOff === 0) || (s.hidden === 0 && s.sneaking === 0))) return;
  if (!(automated(s) && s.allOff === 0)) return;
  if (moving(s)) s.autoCombatForWait = 1;
  s.MegaMud_AutoCombat = 1;
  // `0x460d50` redraws MegaMUD's toolbar; ours follows the toggles each second.
}

export function runCheck(s: Session): number {
  if (s.fleeingPlayer !== 0 && hangupAllowed(s) !== 0 && s.PvP_PvpAction === 1) {
    if (s.now - s.pvpFleeAt >= s.PvP_FleeTimeout) {
      s.host.trace('[Delayed PvP Hangup]');
      s.skipRedialOnce = 1;
      s.noRedial = 1;
      s.walking = 0;
      s.host.activity('Hanging up after PvP timeout');
      hangUp(s, 0);
      s.host.alert?.('hangup');
      return 1;
    }
  }
  if (s.hideAgain !== 0 && s.attackDue === 0 && s.inCombat === 0 && hideStep(s) !== 0) return 1;
  if (s.hidden !== 0 && s.attackDue === 0) {
    if (s.inCombat === 0) {
      if (s.partySize === 0 && s.now - s.hiddenAt < s.PvP_HideDelay) {
        if (automated(s) && s.allOff === 0) return 1;
        if (s.MegaMud_AutoSneak === 0) return 1;
        sneakStep(s);
        return 1;
      }
      if (s.target === '' && enemiesHere(s, s.Combat_AttackNeutral) === 0) {
        s.attackDue = 0;
        return 0;
      }
    }
  } else if (s.inCombat === 0 && s.target === '' && enemiesHere(s, s.Combat_AttackNeutral) === 0) {
    s.attackDue = 0;
    return 0;
  }
  if (s.runDirection !== -1 && s.following === 0) return 0;
  if (s.inCombat === 0 && s.target === '' && enemiesHere(s, 0) === 0 && healthStep(s) !== 0) {
    return 1;
  }
  if (s.hp < 1) return 0;

  const checked = runChecks(s, stopToKill(s));
  if (typeof checked === 'number') return checked;
  const stop = checked.stop;
  if (
    stop === 0 &&
    (s.MegaMud_AutoCombat === 0 || s.runCount > 0) &&
    moving(s) &&
    s.held === 0 &&
    s.partyWait === 0
  ) {
    if (s.inCombat === 0) return 0;
    if (s.runCount === 0) s.runCount = s.Combat_RunRooms;
    s.target = '';
    return breakOff(s);
  }
  return fight(s, stop);
}

/** The attack itself (`0x40eab0` on). */
function fight(s: Session, stop: number): number {
  if (s.MegaMud_AutoCombat === 0) {
    if (s.following !== 0) return 0;
    if (s.walking === 0 && s.importing === 0) return 0;
  }
  if (s.attackPrevented !== 0) return 0;
  if (s.dontAttackHere !== 0 && s.held === 0) return 0;
  const e = currentTarget(s);
  if (!e) return 0;
  if (e.kind !== Stance.Enemy && (e.flags & EntityFlag.Fought) === 0) return 0;
  targetChanged(s, e);
  if (/^[A-Z]/.test(e.name) && s.whoDue !== 0) {
    s.whoDue = -1;
    if (refreshWho(s) !== 0) return 1;
  }
  if (s.state === State.Backstabbing) {
    // The backstab was sent: the fight is on.
    if (s.sneaking !== 0) return 1;
    if (
      stop === 0 &&
      s.Combat_RunIfBsFails !== 0 &&
      s.held === 0 &&
      s.allOff === 0 &&
      s.roundDamage === 0 &&
      s.backstabSurprised === 0
    ) {
      return bsFailed(s);
    }
    const plainAttack = s.Combat_AttackCmd === '' || abbrev('attack', s.Combat_AttackCmd, 1) !== 0;
    if (
      !plainAttack ||
      s.Combat_NrmWeapon === '' ||
      s.Combat_BsWeapon !== s.Combat_NrmWeapon ||
      s.Combat_AttackCmd.slice(0, 2).toLowerCase() === 'ju'
    ) {
      s.attackDue = 1;
    }
    s.inCombat = 1;
    s.probablyRoundFought = -1;
    forgetAwaited(s, State.Backstabbing);
    setState(s, State.Attacking);
    combatRoundEnd(s);
  }
  if (
    s.sneaking !== 0 &&
    s.Combat_CanBackStab !== 0 &&
    (s.Combat_DontBsIfMulti === 0 || wantsRoomSpell(s, 0) === 0)
  ) {
    const sent = backstab(s, e, stop);
    if (sent !== null) return sent;
  }
  if (
    s.inCombat !== 0 &&
    s.attackDue === 0 &&
    s.state !== State.Attacking &&
    inAttackCast(s, 0) === 0 &&
    s.state === State.Nothing &&
    s.stateBefore === State.PendingCmd &&
    s.combatOnAt - s.combatOffAt < 2 &&
    s.engagedMode === State.Nothing
  ) {
    if (s.debug !== 0) s.host.trace('{pend2}');
    s.engagedMode = State.Attacking;
    setState(s, State.Attacking);
  }
  const bs = postBackstab(s, 0);
  const rest = postRest(s, 2, 0);
  const med = postMeditate(s, 0);
  if (rest !== 0 || med !== 0 || bs !== 0) return 1;

  let sent = 0;
  if (s.state === State.CastUser || s.stateAwaited === State.CastUser)
    sent = attack(s, State.CastUser, e);
  if (s.state === State.CastAlt || s.stateAwaited === State.CastAlt) {
    if (sent !== 0) return 1;
    sent = attack(s, State.CastAlt, e);
  }
  if (sent !== 0) return 1;
  if (attack(s, State.CastPreMulti, e) !== 0) return 1;
  if (attack(s, State.CastMulti, e) !== 0) return 1;
  if (attack(s, State.CastPre, e) !== 0) return 1;
  if (
    s.preferMelee === 0 ||
    s.weaponsExhausted !== 0 ||
    s.engagedMode === State.CastAux ||
    s.engagedMode === State.CastMain
  ) {
    // The main spell before the second, which waits for it to have no effect
    // or run out of casts: MegaMUD (`0x40e190`) tries the second first, and
    // asked for the other way round (2026-10-21).
    if (attack(s, State.CastMain, e) !== 0) return 1;
    if (attack(s, State.CastAux, e) !== 0) return 1;
  }
  if (normalWeapon(s) !== 0) return 1;

  const recent =
    s.inCombat === 0 &&
    s.now - s.attackSentAt < s.Comms_LagWait + 4 &&
    s.combatChanges === s.combatChangesAtAttack;
  const justAttacked = s.state === State.Attacking && recent;
  const awaitingSpell =
    s.castMode !== State.Nothing &&
    s.castUntargeted !== 0 &&
    s.stateAwaited === s.castMode &&
    recent;
  if (
    (justAttacked || awaitingSpell || (s.attackDue === 0 && s.inCombat !== 0)) &&
    inAttackCast(s, 0) === 0
  ) {
    if (s.state !== State.Nothing) return 1;
    s.inCombat = 0;
    s.lookDue = 1;
    return 1;
  }
  if (s.weaponsExhausted !== 0) {
    // Nothing here hurts it: give it up.
    e.kind = Stance.Flee;
    s.inCombat = 0;
    setState(s, State.Nothing);
    return 0;
  }
  s.roundBlowSeen = 0;
  if (s.probablyRoundFought !== -1 && s.attackDue === 0) s.probablyRoundFought = 0;
  s.attackSentAt = s.now;
  s.probablyRoundCounted = 0;
  s.stateBefore = State.Nothing;
  s.combatOffExpected = 1;
  s.attackDue = 0;
  s.engagedHere = 1;
  s.waitLines = 2;
  s.combatChangesAtAttack = s.combatChanges;
  attackLateMark(s, e);
  e.flags |= EntityFlag.Kept | EntityFlag.Fought;
  s.target = e.name.slice(0, 99);
  rememberTarget(s);
  setState(s, State.Attacking);
  s.host.activity(`Attacking ${e.name}`);
  // Ours: the first attack at a monster may be another command (`opening.ts`).
  const opening = opensOn(s, e);
  const cmd = opening ? openingCommand(s) : s.Combat_AttackCmd;
  if (opening) openingSent(s, e);
  else s.opening = 0;
  if (s.sneaking !== 0) {
    if (
      abbrev(cmd, 'punch', 2) !== 0 ||
      (abbrev(cmd, 'attack', 1) !== 0 && s.weaponWielded === '')
    ) {
      send(s, 'break\r');
      s.sneaking = 0;
    }
  }
  const bare =
    s.weaponNoEffect !== 0 &&
    (abbrev(cmd, 'punch', 2) !== 0 ||
      abbrev(cmd, 'jumpkick', 2) !== 0 ||
      abbrev(cmd, 'kick', 3) !== 0);
  send(s, `${bare ? 'a' : cmd} ${e.name}\r`);
  return 1;
}

/** `Combat.RunIfBsFails`: the backstab failed, run (`0x40efe4`). */
function bsFailed(s: Session): number {
  s.runCount = s.Combat_RunRooms;
  s.host.activity('Running away because BS failed');
  return 0;
}

/**
 * The backstab (`0x40ed8a`–`0x40efe4`): this monster, or (immune to
 * backstabs, or to the backstab weapon) another one here. Null to go on to
 * the attack spells.
 */
function backstab(s: Session, e: RoomEntity, stop: number): number | null {
  const noBackstab = e.mon !== null && (e.mon.flags & MonsterFlag.DontBackstab) !== 0;
  const weaponImmune =
    s.Other_IgnoreWeaponImmunity === 0 &&
    s.Combat_BsWeapon !== '' &&
    s.Combat_BsWeapon === s.weaponWielded &&
    (e.flags & EntityFlag.ImmuneBackstabWeapon) !== 0;
  let victim: RoomEntity | null = e;
  if (weaponImmune || noBackstab) {
    victim = otherBackstab(s, e);
    if (victim) {
      if (s.debug !== 0) s.host.trace(`{BS-switch:${victim.name}}`);
      targetChanged(s, victim);
    }
  }
  if (victim) {
    clearCastMode(s);
    s.waitLines = 2;
    s.combatOffExpected = 1;
    s.stateBefore = State.Nothing;
    s.attackDue = 0;
    s.roundBlowSeen = 0;
    s.probablyRoundFought = 0;
    s.probablyRoundCounted = 0;
    s.backstabResolved = 0;
    s.backstabSurprised = 0;
    s.fightDamage = s.multiDamage;
    setState(s, State.Backstabbing);
    s.host.activity(`Back-stabbing ${victim.name}`);
    victim.flags |= EntityFlag.Kept | EntityFlag.Fought;
    s.target = victim.name.slice(0, 99);
    rememberTarget(s);
    attackLateMark(s, victim);
    send(s, `bs ${victim.name}\r`);
    return 1;
  }
  if (
    s.Combat_BsWeapon !== '' &&
    s.Other_IgnoreWeaponImmunity === 0 &&
    e.mon !== null &&
    (e.flags & EntityFlag.ImmuneBackstabWeapon) !== 0
  ) {
    s.host.show(`[${e.name} immune to ${s.Combat_BsWeapon}]`);
  }
  if (s.debug !== 0) s.host.trace('{BS-skip}');
  if (stop === 0 && s.Combat_RunIfBsFails !== 0 && s.held === 0 && s.allOff === 0) {
    if (moving(s)) {
      s.dontAttackHere = 1;
      return 0;
    }
    if (s.roundDamage === 0) return bsFailed(s);
  }
  return null;
}
