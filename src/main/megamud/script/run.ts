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
import { f_426ab0, wantsRoomSpell } from '../combat/casts';
import { attackLateMark, clearCastMode, rememberTarget, targetChanged } from '../combat/engaged';
import { combatRoundEnd } from '../combat/rounds';
import { abbrev, idiv } from '../cstr';
import { postBackstab, postMeditate, postRest } from '../health/prepost';
import { healthStep } from '../health/rest';
import { hangupAllowed } from '../room/checkNames';
import { allAttackable, currentTarget, enemiesHere, stopToKill } from '../room/entities';
import type { RoomEntity, Session } from '../Session';
import { unported } from '../unported';
import { hangUp } from './game';
import { send } from './send';
import { refreshWho } from './setup';
import { forgetAwaited, setState } from './state';
import { hideStep, sneakStep } from './stealth';

function moving(s: Session): boolean {
  return s.f_e184 !== 0 || s.f_e18c !== 0 || s.f_e178 !== 0;
}

/** A reason to run: counted, `Combat.RunRooms` (or one) rooms, the alert, and the message. */
function startRun(s: Session, rooms: number, what: string, shown: string): void {
  s.f_32534 += 1;
  s.runCount = rooms;
  s.host.activity(what);
  s.host.alert?.('lowHp');
  if (s.Display_ShowRunMsg !== 0 && s.held === 0 && s.partyWait === 0) s.host.show(shown);
}

/** `0x471590`: how tough a monster is, from its flags (0–4). */
function toughness(flags: number): number {
  switch (flags & 0xf0) {
    case 0x10:
      return 0;
    case 0x20:
      return 1;
    case 0x40:
      return 3;
    case 0x80:
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
    if (x.type === 3 || x.kind !== 4 || !x.mon) continue;
    if (name !== '' && x.mon.name === name) continue;
    if (
      (x.mon.flags & 0x100) === 0 &&
      (s.Other_IgnoreWeaponImmunity !== 0 || (x.flags & 0x4000) === 0) &&
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
    if (e.mon && (e.kind === 4 || e.kind === 5 || e.kind === 6)) sum += e.mon.exp;
  }
  return sum;
}

/** `0x472c00`: players here who are not in the party. */
function strangersHere(s: Session): number {
  let n = 0;
  for (const e of s.room) {
    if (e.type !== 1) continue;
    const ours = s.party
      .slice(0, s.partySize)
      .some((m) => (m.flags28 & 0x8c) === 0 && m.name.toLowerCase() === e.name.toLowerCase());
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
  const polite = s.f_e184 !== 0 && s.Combat_PoliteAttacks !== 0 && s.f_e2b8 === 0;
  let fled = false;
  if (!polite || s.runCount === 0) {
    if (polite && s.following === 0 && s.partyWait === 0 && stop === 0 && strangersHere(s) > 0) {
      s.host.activity("Running to avoid other player's monsters");
      s.runCount = 1;
      s.f_907c = 1;
      if (s.Display_ShowRunMsg !== 0 && s.held === 0 && s.partyWait === 0) {
        s.host.show('[Run 1: polite attacks]');
      }
    }
    if (s.runCount === 0 && s.following === 0 && s.f_a32c === 0 && moving(s)) {
      const result = reasonsToRun(s, stop);
      stop = result.stop;
      fled = result.fled;
    }
  }
  if (!fled && stop !== 0) {
    if (s.runCount > 0) {
      s.runCount = 0;
      s.f_907c = 0;
    }
    autoAutoCombat(s, stop);
    return { stop };
  }
  if (s.runCount !== 0 && s.following === 0) {
    if (stop === 0) {
      if (moving(s) && s.held === 0 && s.partyWait === 0) {
        s.target = '';
        forgetAwaited(s, s.state);
        setState(s, 0);
        if (s.inCombat === 0) return 0;
        return breakOff(s);
      }
      if (
        ((s.active === 0 && !moving(s)) || s.f_a32c !== 0) &&
        (s.f_e1c4 !== 0 || s.hidden !== 0)
      ) {
        forgetAwaited(s, s.state);
        setState(s, 0);
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
    const once = s.Combat_ClearOnceEngaged === 0 || s.f_8be4 === 0;
    if (n < s.Combat_MinMstrs && once) {
      s.runCount = 1;
      s.f_907c = 1;
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
      s.f_907c = 1;
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
    s.f_907c = 1;
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
  s.f_907c = 1;
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
  if (!((stop !== 0 && s.f_a32c === 0) || (s.hidden === 0 && s.f_e1c4 === 0))) return;
  if (!((s.active !== 0 || moving(s)) && s.f_a32c === 0)) return;
  if (moving(s)) s.f_a328 = 1;
  s.MegaMud_AutoCombat = 1;
  unported('460d50');
}

export function runCheck(s: Session): number {
  if (s.f_e1a0 !== 0 && hangupAllowed(s) !== 0 && s.PvP_PvpAction === 1) {
    if (s.now - s.f_322f8 >= s.PvP_FleeTimeout) {
      s.host.trace('[Delayed PvP Hangup]');
      s.f_30de4 = 1;
      s.f_30de8 = 1;
      s.f_e184 = 0;
      s.host.activity('Hanging up after PvP timeout');
      hangUp(s, 0);
      s.host.alert?.('hangup');
      return 1;
    }
  }
  if (s.f_e1d0 !== 0 && s.f_e2b8 === 0 && s.inCombat === 0 && hideStep(s) !== 0) return 1;
  if (s.hidden !== 0 && s.f_e2b8 === 0) {
    if (s.inCombat === 0) {
      if (s.partySize === 0 && s.now - s.f_32300 < s.PvP_HideDelay) {
        if ((s.active !== 0 || moving(s)) && s.f_a32c === 0) return 1;
        if (s.MegaMud_AutoSneak === 0) return 1;
        sneakStep(s);
        return 1;
      }
      if (s.target === '' && enemiesHere(s, s.Combat_AttackNeutral) === 0) {
        s.f_e2b8 = 0;
        return 0;
      }
    }
  } else if (s.inCombat === 0 && s.target === '' && enemiesHere(s, s.Combat_AttackNeutral) === 0) {
    s.f_e2b8 = 0;
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
    if (s.f_e184 === 0 && s.f_e178 === 0) return 0;
  }
  if (s.f_e218 !== 0) return 0;
  if (s.f_e21c !== 0 && s.held === 0) return 0;
  const e = currentTarget(s);
  if (!e) return 0;
  if (e.kind !== 4 && (e.flags & 0x10) === 0) return 0;
  targetChanged(s, e);
  if (/^[A-Z]/.test(e.name) && s.f_e2a4 !== 0) {
    s.f_e2a4 = -1;
    if (refreshWho(s) !== 0) return 1;
  }
  if (s.state === 0x12) {
    // The backstab was sent: the fight is on.
    if (s.f_e1c4 !== 0) return 1;
    if (
      stop === 0 &&
      s.Combat_RunIfBsFails !== 0 &&
      s.held === 0 &&
      s.f_a32c === 0 &&
      s.f_32614 === 0 &&
      s.f_e1bc === 0
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
      s.f_e2b8 = 1;
    }
    s.inCombat = 1;
    s.f_32600 = -1;
    forgetAwaited(s, 0x12);
    setState(s, 0x11);
    combatRoundEnd(s);
  }
  if (
    s.f_e1c4 !== 0 &&
    s.Combat_CanBackStab !== 0 &&
    (s.Combat_DontBsIfMulti === 0 || wantsRoomSpell(s, 0) === 0)
  ) {
    const sent = backstab(s, e, stop);
    if (sent !== null) return sent;
  }
  if (
    s.inCombat !== 0 &&
    s.f_e2b8 === 0 &&
    s.state !== 0x11 &&
    f_426ab0(s, 0) === 0 &&
    s.state === 0 &&
    s.stateBefore === 0x2d &&
    s.f_32490 - s.f_32498 < 2 &&
    s.engagedMode === 0
  ) {
    if (s.debug !== 0) s.host.trace('{pend2}');
    s.engagedMode = 0x11;
    setState(s, 0x11);
  }
  const bs = postBackstab(s, 0);
  const rest = postRest(s, 2, 0);
  const med = postMeditate(s, 0);
  if (rest !== 0 || med !== 0 || bs !== 0) return 1;

  let sent = 0;
  if (s.state === 0xf || s.stateAwaited === 0xf) sent = attack(s, 0xf, e);
  if (s.state === 0xe || s.stateAwaited === 0xe) {
    if (sent !== 0) return 1;
    sent = attack(s, 0xe, e);
  }
  if (sent !== 0) return 1;
  if (attack(s, 9, e) !== 0) return 1;
  if (attack(s, 10, e) !== 0) return 1;
  if (attack(s, 0xb, e) !== 0) return 1;
  if (s.f_8be8 === 0 || s.f_8bec !== 0 || s.engagedMode === 0xc || s.engagedMode === 0xd) {
    if (attack(s, 0xc, e) !== 0) return 1;
    if (attack(s, 0xd, e) !== 0) return 1;
  }
  if (unported('410f50') !== 0) return 1;

  const recent =
    s.inCombat === 0 && s.now - s.f_322d8 < s.Comms_LagWait + 4 && s.f_324c0 === s.f_324c4;
  const justAttacked = s.state === 0x11 && recent;
  const awaitingSpell = s.f_a448 !== 0 && s.f_a460 !== 0 && s.stateAwaited === s.f_a448 && recent;
  if (
    (justAttacked || awaitingSpell || (s.f_e2b8 === 0 && s.inCombat !== 0)) &&
    f_426ab0(s, 0) === 0
  ) {
    if (s.state !== 0) return 1;
    s.inCombat = 0;
    s.f_e290 = 1;
    return 1;
  }
  if (s.f_8bec !== 0) {
    // Nothing here hurts it: give it up.
    e.kind = 5;
    s.inCombat = 0;
    setState(s, 0);
    return 0;
  }
  s.f_32604 = 0;
  if (s.f_32600 !== -1 && s.f_e2b8 === 0) s.f_32600 = 0;
  s.f_322d8 = s.now;
  s.f_3260c = 0;
  s.stateBefore = 0;
  s.f_e1d8 = 1;
  s.f_e2b8 = 0;
  s.f_8be4 = 1;
  s.waitLines = 2;
  s.f_324c4 = s.f_324c0;
  attackLateMark(s, e);
  e.flags |= 0x11;
  s.target = e.name.slice(0, 99);
  rememberTarget(s);
  setState(s, 0x11);
  s.host.activity(`Attacking ${e.name}`);
  const cmd = s.Combat_AttackCmd;
  if (s.f_e1c4 !== 0) {
    if (abbrev(cmd, 'punch', 2) !== 0 || (abbrev(cmd, 'attack', 1) !== 0 && s.s_b060 === '')) {
      send(s, 'break\r');
      s.f_e1c4 = 0;
    }
  }
  const bare =
    s.f_b0fc !== 0 &&
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
  const noBackstab = e.mon !== null && (e.mon.flags & 0x100) !== 0;
  const weaponImmune =
    s.Other_IgnoreWeaponImmunity === 0 &&
    s.Combat_BsWeapon !== '' &&
    s.Combat_BsWeapon === s.s_b060 &&
    (e.flags & 0x4000) !== 0;
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
    s.f_e1d8 = 1;
    s.stateBefore = 0;
    s.f_e2b8 = 0;
    s.f_32604 = 0;
    s.f_32600 = 0;
    s.f_3260c = 0;
    s.f_e1b8 = 0;
    s.f_e1bc = 0;
    s.f_32618 = s.f_a57c;
    setState(s, 0x12);
    s.host.activity(`Back-stabbing ${victim.name}`);
    victim.flags |= 0x11;
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
    (e.flags & 0x4000) !== 0
  ) {
    s.host.show(`[${e.name} immune to ${s.Combat_BsWeapon}]`);
  }
  if (s.debug !== 0) s.host.trace('{BS-skip}');
  if (stop === 0 && s.Combat_RunIfBsFails !== 0 && s.held === 0 && s.f_a32c === 0) {
    if (moving(s)) {
      s.f_e21c = 1;
      return 0;
    }
    if (s.f_32614 === 0) return bsFailed(s);
  }
  return null;
}
