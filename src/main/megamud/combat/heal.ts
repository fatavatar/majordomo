/**
 * Healing in and around a fight, read 2026-10-12: the combat step (`0x4120b0`,
 * D23), healing this character (`0x412b10`) and the party (`0x412120`), the
 * drain heal (a heal spell that hits a monster, cast as the alt attack), and
 * asking the party for help (`0x40dfa0`).
 *
 * `HealCmd` is the main heal, cast below `HpHealAtt%` (or `HpHeal%` resting);
 * `HealCmd2` the minor one, below `HpHealMinor%`. In a fight each needs its
 * mana (`ManaHealAtt%`, `ManaHealMinor%`); out of one, `ManaHeal%`.
 */
import { percentOf } from '../cstr';
import { castSpell, equipForSpell } from '../health/cast';
import { askParty, membersInStep, weakestMember } from '../party/members';
import { findPlayer } from '../room/checkNames';
import { currentTarget, enemiesHere } from '../room/entities';
import { curesFirst, diseaseToCure } from '../script/cures';
import { forgetAwaited, setState } from '../script/state';
import { moving, type RoomEntity, type Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { attack } from './attack';
import { spellTakesTarget, wantsRoomSpell } from './casts';
import { clearCastMode } from './engaged';
import { State } from '../states';
import { EntityFlag, SpellFlag, PartyFlag, PlayerFlag, Stance, EntityType } from '../flags';

function hostile(e: RoomEntity): boolean {
  return (
    e.kind === Stance.Enemy ||
    e.kind === Stance.Flee ||
    e.kind === Stance.Hangup ||
    (e.flags & EntityFlag.Fought) !== 0
  );
}

/** A monster here the drain can hit: not immune to it (`which`), and hostile. */
function drainable(s: Session, which: number): RoomEntity | null {
  return (
    s.room.find((e) => e.type !== EntityType.Item && (e.flags & which) === 0 && hostile(e)) ?? null
  );
}

/**
 * `0x416060`: the drain heal is over: if it was the fight's spell, the fight
 * casts nothing, and the alt attack's casts are all spent.
 */
function drainOver(s: Session): void {
  if (s.altHeal === 0) return;
  s.altHeal = 0;
  if (s.altSpell === '') return;
  const isHeal =
    (s.Spells_HealCmd2 !== '' && s.altSpell === s.Spells_HealCmd2) ||
    (s.Spells_HealCmd !== '' && s.altSpell === s.Spells_HealCmd);
  if (!isHeal) return;
  if (s.castShort !== '' && s.altSpell === s.castShort) {
    clearCastMode(s);
    if (s.state === State.CastAlt) {
      forgetAwaited(s, State.CastAlt);
      setState(s, State.Nothing);
    }
  }
  s.castsAlt = s.altCastCap;
  s.altSpell = '';
}

/** The mana-regen recast, the first thing a heal does (`0x412b10`). */
function fluxRecast(s: Session): number {
  if (s.fluxRecast === 0 || s.Player_MaxMana <= 0) return 0;
  if (s.Spells_FluxCmd === '' || s.lastTick === -999) return 0;
  if (equipForSpell(s, s.Spells_FluxCmd) === 1) return 1;
  if (castSpell(s, s.Spells_FluxCmd, null) === 0) return 0;
  s.manaRegen = 1;
  s.fluxRecast = 0;
  s.lastTick = -999;
  s.lastTickAt = s.now;
  return 1;
}

/** Whether a fight may be joined to drain: auto-combat, or this character held or waiting. */
function mayDrain(s: Session): boolean {
  let allowed = true;
  if (s.MegaMud_AutoCombat === 0 || s.runCount > 0) {
    if (moving(s) && s.held === 0 && s.partyWait === 0) allowed = false;
    if (s.MegaMud_AutoCombat === 0 && (s.following !== 0 || !moving(s))) allowed = false;
  }
  return s.attackPrevented === 0 && allowed;
}

/**
 * `0x412b10`: heal this character: the main heal, else the minor one. A heal
 * flagged as a room attack (Spells.md `4`) is a drain: cast through the alt
 * attack (mode 14) at a monster, up to `HealCasts` times.
 */
export function selfHeal(s: Session): number {
  if (s.allOff !== 0 || s.hp < 1 || s.Player_MaxHP === 0 || s.Player_MaxMana === 0) return 0;
  const n = enemiesHere(s, 0);
  if (s.state === State.Backstabbing) return 0;
  if (s.state === State.Nothing && s.sneaking !== 0 && s.walking !== 0 && n > 0) return 0;
  if (fluxRecast(s) !== 0) return 1;
  if (s.MegaMud_AutoHeal === 0) return 0;
  if (s.now - s.partyAskedAt < 8) s.partyAskPending = 1;
  const since = s.now - s.healCastAt;
  if (since < s.Health_HpHealPeriod || since < s.Comms_LagWait + 4) return 0;
  const done = (): number => {
    drainOver(s);
    return 0;
  };

  let minorPct = s.Health_HpHealMinorPct;
  let mainPct = s.Health_HpHealAttPct;
  let mainOk = true;
  let minorOk = true;
  if (s.inCombat === 0 && n < 1) {
    if (s.mana < percentOf(s.Health_ManaHealPct, s.Player_MaxMana)) return done();
    const restPct = s.Health_HpHealPct;
    if (restPct > 0) {
      if (percentOf(s.Player_MaxHP, restPct) <= s.hp) return done();
      minorPct = restPct;
      if (s.Spells_HealCmd2 === '') mainPct = restPct;
    }
  } else {
    if (s.Health_ManaHealAttPct > 0)
      mainOk = percentOf(s.Player_MaxMana, s.Health_ManaHealAttPct) <= s.mana;
    if (s.Health_ManaHealMinorPct > 0) {
      minorOk = percentOf(s.Player_MaxMana, s.Health_ManaHealMinorPct) <= s.mana;
    }
    if (!mainOk && !minorOk) return done();
  }

  let which: number;
  let minor: boolean;
  let short: string;
  if (s.Spells_HealCmd === '' || percentOf(s.Player_MaxHP, mainPct) <= s.hp || !mainOk) {
    if (s.Spells_HealCmd2 === '' || percentOf(s.Player_MaxHP, minorPct) <= s.hp || !minorOk) {
      return done();
    }
    which = EntityFlag.ImmuneMinorDrain;
    minor = true;
    short = s.Spells_HealCmd2;
  } else {
    which = EntityFlag.ImmuneMainDrain;
    minor = false;
    short = s.Spells_HealCmd;
  }
  short = short.slice(0, 20);
  let spell = findSpell(s, short);
  if (
    spell === null ||
    s.Spells_HealCmd2 === '' ||
    s.Spells_HealCmd === '' ||
    short !== s.Spells_HealCmd
  ) {
    if (minor && curesFirst(s)) return done();
  } else if (!(
    spell.cost <= s.mana &&
    ((spell.flags & SpellFlag.EvilInCombat) === 0 || (n !== 0 && s.drainCasts < s.Spells_HealCasts))
  )) {
    // The main heal can't be cast (mana, or a drain with nothing to drain): the minor one instead.
    short = s.Spells_HealCmd2.slice(0, 20);
    spell = findSpell(s, short);
    which = EntityFlag.ImmuneMinorDrain;
    if (curesFirst(s)) return done();
  }

  if (s.poisoned !== 0 && s.Other_IgnorePoison === 0) {
    if (s.Spells_PoisonCmd !== '' && n === 0 && s.poisonCureWaits < 3) {
      s.poisonCureWaits += 1;
      return 0;
    }
  }
  s.poisonCureWaits = 0;
  if (s.altHeal !== 0) {
    // A drain is under way: it goes on while it has casts left.
    let over = false;
    if (s.state !== State.CastAlt) {
      over = s.stateAwaited !== State.CastAlt;
    } else if (s.altCastCap <= s.castsAlt || s.Spells_HealCasts <= s.drainCasts) {
      over = true;
    } else if (spell && (spell.flags & SpellFlag.EvilInCombat) !== 0 && short !== s.altSpell) {
      over = true;
    }
    if (over) drainOver(s);
  }
  if (spell && (spell.flags & SpellFlag.EvilInCombat) !== 0 && n === 0) return 0;
  if (equipForSpell(s, short) === 1) return 1;

  let target = '';
  if (spell) {
    if ((spell.flags & SpellFlag.EvilInCombat) === 0) {
      s.host.activity("Healing because HP's below threshold");
      if ((spell.flags & SpellFlag.Self) === 0) target = s.Player_Name;
      if (equipForSpell(s, short) === 1) return 1;
    } else {
      return drain(s, n, which, short, spell);
    }
  }
  const sent = castSpell(s, short, target);
  if (sent === 0) return done();
  s.healCastAt = s.now;
  s.attackDue = 1;
  s.combatOffExpected = 1;
  if (s.debug !== 0) s.host.trace('{I7+}');
  return sent;
}

/** `0x412b10`'s drain: the heal cast at a monster as the alt attack. */
function drain(
  s: Session,
  n: number,
  which: number,
  short: string,
  spell: NonNullable<ReturnType<typeof findSpell>>
): number {
  const done = (): number => {
    drainOver(s);
    return 0;
  };
  if (n === 0 || s.Spells_HealCasts <= s.drainCasts) return 0;
  if (s.multiAttacking !== 0 && s.state === State.CastUser) return 0;
  if (s.state === State.CastPreMulti || s.state === State.CastMulti) return 0;
  if (s.inCombat === 0 && wantsRoomSpell(s, 0) !== 0) return 0;
  if ((s.dontAttackHere !== 0 && s.held === 0) || !mayDrain(s)) return done();
  if (s.altHeal === 0 && s.inCombat !== 0 && s.now - s.attackSentAt < s.Comms_LagWait + 3) return 0;

  let victim = currentTarget(s);
  const ignore = s.Other_IgnoreSpellImmunity !== 0;
  if (!ignore && victim && (victim.flags & which) !== 0) victim = drainable(s, which);
  if (!victim) {
    // Immune to the main heal: the minor one, if it is not a drain, heals this character.
    if (
      which === EntityFlag.ImmuneMainDrain &&
      s.Spells_HealCmd2 !== '' &&
      short !== s.Spells_HealCmd2
    ) {
      short = s.Spells_HealCmd2.slice(0, 20);
      const minor = findSpell(s, short);
      if (curesFirst(s)) return done();
      if (minor) {
        if ((minor.flags & SpellFlag.EvilInCombat) === 0) {
          const at = (minor.flags & SpellFlag.Self) !== 0 ? '' : s.Player_Name;
          drainOver(s);
          if (equipForSpell(s, short) === 1) return 1;
          const sent = castSpell(s, short, at);
          if (sent !== 0) {
            s.healCastAt = s.now;
            s.attackDue = 1;
            s.combatOffExpected = 1;
            if (s.debug !== 0) s.host.trace('{I6+}');
            s.host.activity("Healing (minor fallback) because HP's below threshold");
          }
          return sent;
        }
        spell = minor;
        victim = currentTarget(s);
        if (!ignore) {
          if (!victim) return 0;
          if ((victim.flags & EntityFlag.ImmuneMinorDrain) !== 0)
            victim = drainable(s, EntityFlag.ImmuneMinorDrain);
        }
      }
    }
    if (!victim) return 0;
  }
  const name = victim.name.slice(0, 99);
  if (
    s.altHeal !== 0 &&
    spellTakesTarget(spell) !== 0 &&
    (s.state === State.CastAlt || s.stateAwaited === State.CastAlt) &&
    s.altSpell !== '' &&
    s.altSpell === spell.short
  ) {
    if (s.Spells_HealCasts <= s.castsAlt) return done();
    if (
      s.inCombat !== 0 &&
      s.state === State.CastAlt &&
      s.attackDue === 0 &&
      s.castsAlt < s.altCastCap
    )
      return 0;
  }
  if (equipForSpell(s, spell.short) === 1) return 1;
  s.castsAlt = s.drainCasts;
  s.altCastCap = spellTakesTarget(spell) === 0 ? s.castsAlt + 1 : Math.max(s.Spells_HealCasts, 1);
  s.engagedMode = State.Nothing;
  s.altSpell = spell.short.slice(0, 10);
  if (attack(s, State.CastAlt, victim) === 0) return done();
  const each = spellTakesTarget(spell) === 0;
  if (each) s.healCastAt = s.now;
  s.attackDue = each ? 1 : 0;
  s.altHeal = 1;
  s.target = name;
  s.combatOffExpected = 1;
  if (s.debug !== 0) s.host.trace('{I11+}');
  s.host.activity(`Casting drain on ${name}`);
  return 1;
}

/**
 * `0x412120`: heal the party: the area heal when enough are low
 * (`PartyHealAreaAt` below `PartyHealArea%`), else the weakest member, with
 * `PartyHeal2` below `PartyHeal2%` or `PartyHeal1` below `PartyHeal1%`. This
 * character is weighed with its own heals. Each member is marked 0x10000 (the
 * main heal), 0x40 (the minor) or neither.
 */
export function partyHeal(s: Session): number {
  if (s.allOff !== 0 || s.MegaMud_AutoHeal === 0 || s.partySize < 1) return 0;
  if (s.hp < 1 || s.Player_MaxHP === 0) return 0;
  if (s.Party_PartyHeal1 === '' && s.Party_PartyHeal2 === '' && s.Party_PartyHealArea === '') {
    return s.Party_HealLowest === 0 ? 0 : selfHeal(s);
  }
  if (s.state === State.Backstabbing) return 0;
  if (s.state === State.Nothing && s.sneaking !== 0 && s.walking !== 0 && enemiesHere(s, 0) > 0)
    return 0;
  const since = s.now - s.healCastAt;
  if (since < s.Health_HpHealPeriod || since < s.Comms_LagWait + 4) return 0;

  let mainOk = true;
  let minorOk = true;
  let fighting: boolean;
  let pct2 = s.Party_PartyHeal2Pct;
  let pct1 = s.Party_PartyHeal1Pct;
  if (s.inCombat === 0 && enemiesHere(s, 0) < 1) {
    if (s.mana < percentOf(s.Player_MaxMana, s.Health_ManaHealPct)) return 0;
    fighting = false;
    if (s.Party_RestHealParty !== 0 && s.Health_HpHealPct > 0) {
      pct1 = Math.max(s.Health_HpHealPct, Math.max(pct1, pct2));
      if (s.Party_PartyHeal1 === '') pct2 = pct1;
    }
  } else {
    fighting = true;
    if (s.Health_ManaHealAttPct > 0)
      mainOk = percentOf(s.Player_MaxMana, s.Health_ManaHealAttPct) <= s.mana;
    if (s.Health_ManaHealMinorPct > 0) {
      minorOk = percentOf(s.Player_MaxMana, s.Health_ManaHealMinorPct) <= s.mana;
    }
    if (!mainOk && !minorOk) return 0;
  }

  let wantMain = 0;
  let wantMinor = 0;
  let wantArea = 0;
  for (let i = 0; i < s.partySize; i += 1) {
    const m = s.party[i]!;
    let f = m.flags28;
    if (
      (f &
        (PartyFlag.HealthUnknown | PartyFlag.Invited | PartyFlag.Unlisted | PartyFlag.Offline)) !==
      0
    ) {
      m.flags28 = f & ~(PartyFlag.MinorHealDue | PartyFlag.MainHealDue);
      continue;
    }
    if (m.name === s.Player_Name) {
      let main = s.Health_HpHealAttPct;
      let minor = s.Health_HpHealMinorPct;
      if (!fighting && s.Health_HpHealPct > 0) {
        minor = s.Health_HpHealPct;
        if (s.Spells_HealCmd2 === '') main = s.Health_HpHealPct;
      }
      if (mainOk && s.Spells_HealCmd !== '' && s.hp < percentOf(s.Player_MaxHP, main)) {
        wantMain += 1;
        m.flags28 = f | PartyFlag.MainHealDue;
      } else {
        if (minorOk && s.Spells_HealCmd2 !== '' && s.hp < percentOf(s.Player_MaxHP, minor)) {
          wantMinor += 1;
          f |= PartyFlag.MinorHealDue;
        } else {
          f &= ~(PartyFlag.MinorHealDue | PartyFlag.MainHealDue);
        }
        m.flags28 = f;
        if (!mainOk) continue;
      }
      if (
        s.Party_PartyHealArea !== '' &&
        s.Party_PartyHealAreaPct > 0 &&
        s.hp < percentOf(s.Player_MaxHP, s.Party_PartyHealAreaPct)
      ) {
        wantArea += 1;
      }
      continue;
    }
    const known = findPlayer(s, m.name);
    if (known && (known.flags & (PlayerFlag.ProbablyDontHealOrBless | PlayerFlag.DontHeal)) !== 0)
      continue;
    f = m.flags28;
    if ((f & PartyFlag.ChangedSinceListing) !== 0) {
      f &= ~(PartyFlag.MinorHealDue | PartyFlag.MainHealDue);
    } else if (mainOk && s.Party_PartyHeal2 !== '' && m.hpPct < pct2) {
      wantMain += 1;
      f |= PartyFlag.MainHealDue;
    } else if (minorOk && s.Party_PartyHeal1 !== '' && m.hpPct < pct1) {
      wantMinor += 1;
      f |= PartyFlag.MinorHealDue;
    } else {
      f &= ~(PartyFlag.MinorHealDue | PartyFlag.MainHealDue);
    }
    m.flags28 = f;
    if (
      mainOk &&
      s.Party_PartyHealArea !== '' &&
      s.Party_PartyHealAreaPct > 0 &&
      s.Party_PartyHealAreaAt > 0 &&
      m.hpPct > 0 &&
      m.hpPct < s.Party_PartyHealAreaPct
    ) {
      wantArea += 1;
    }
  }
  if (wantMinor + wantArea + wantMain === 0) return 0;

  if (
    mainOk &&
    s.parDue === 0 &&
    s.Party_PartyHealArea !== '' &&
    (wantMain === 0 || s.Party_AreaHealPriority !== 0) &&
    s.Party_PartyHealAreaAt > 0 &&
    s.Party_PartyHealAreaAt <= wantArea
  ) {
    if (equipForSpell(s, s.Party_PartyHealArea) === 1) return 1;
    if (castSpell(s, s.Party_PartyHealArea, '') !== 0) {
      s.healCastAt = s.now;
      if (enemiesHere(s, 0) > 0) s.parAt = s.now;
      s.parDue = 1;
      s.host.activity(`Casting Area Heal (${wantArea} members)`);
      return 1;
    }
  }

  let i = weakestMember(s, s.Party_HealLowest, 0x900);
  if (i === -1) return 0;
  if (s.Party_HealLowest !== 0 && s.party[i]!.name === s.Player_Name) {
    if (selfHeal(s) !== 0) return 1;
    i = weakestMember(s, 0, 0x900);
  }
  if (i < 0 || i >= s.partySize) return 0;
  const m = s.party[i]!;
  const f = m.flags28;
  if ((f & (PartyFlag.MinorHealDue | PartyFlag.MainHealDue | PartyFlag.AskedForHeal)) === 0)
    return 0;
  let heal: string;
  if (mainOk && s.Party_PartyHeal2 !== '' && (f & PartyFlag.MainHealDue) !== 0) {
    heal = s.Party_PartyHeal2;
  } else if (minorOk && s.Party_PartyHeal1 !== '' && (f & PartyFlag.MinorHealDue) !== 0) {
    heal = s.Party_PartyHeal1;
    if (curesFirst(s)) return 0;
  } else if (mainOk && s.Party_PartyHeal2 !== '' && (f & PartyFlag.AskedForHeal) !== 0) {
    heal = s.Party_PartyHeal2;
  } else if (minorOk && s.Party_PartyHeal1 !== '' && (f & PartyFlag.AskedForHeal) !== 0) {
    heal = s.Party_PartyHeal1;
    if (curesFirst(s)) return 0;
  } else {
    return 0;
  }
  if (equipForSpell(s, heal) === 1) return 1;
  if (castSpell(s, heal, m.name) === 0) return 0;
  m.flags28 =
    (m.flags28 & ~(PartyFlag.MinorHealDue | PartyFlag.MainHealDue | PartyFlag.AskedForHeal)) |
    PartyFlag.ChangedSinceListing;
  s.healCastAt = s.now;
  s.host.activity(`Healing party: ${m.name}`);
  return 1;
}

/**
 * `0x40dfa0`: with someone else in the party, ask for help: a cure for
 * disease or blindness, freeing, or a heal below `PartyAskHeal%`.
 */
export function askForHelp(s: Session): boolean {
  if (membersInStep(s) < 2) return false;
  if (diseaseToCure(s) && askParty(s, 'diseased') !== 0) return true;
  if (s.blind !== 0 && s.Other_IgnoreBlind === 0 && askParty(s, 'blind') !== 0) return true;
  if (s.held !== 0 && askParty(s, 'held') !== 0) return true;
  if (s.hp < percentOf(s.Player_MaxHP, s.Party_PartyAskHealPct)) return askParty(s, 'heal') !== 0;
  return false;
}

/**
 * `0x4120b0`: the combat step (D23). Alone, this character's heals; in a
 * party, its own heals first unless `HealLowest`, then the party's; failing
 * those, and with no cure to cast, ask the party for help.
 */
export function combatStep(s: Session): number {
  if (s.partySize < 2) return selfHeal(s);
  if (s.Party_HealLowest === 0 && selfHeal(s) !== 0) return 1;
  if (partyHeal(s) !== 0) return 1;
  if (!curesFirst(s)) askForHelp(s);
  return 0;
}
