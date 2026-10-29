/**
 * `0x414300`: health (D10 with no monsters here, D39), read 2026-10-12. The
 * light first (`0x413760`); then, with `AutoHeal` on: the full spells (mana
 * and HP), whether to rest and why, the mana and HP regen spells, holding the
 * party leader while following, waiting on the party, meditating, and the
 * rest itself. Each reason is a bit: 1 HP, 2 mana, 4 party, 8 can't move,
 * 0x10 blind, 0x20 poisoned, 0x40 diseased, 0x80 confused, 0x100 a message.
 *
 * The rest-time statistics (`0x4b81a0`, for the stats window) are left out.
 */
import { beforeMeditate, beforeRest } from '../abilities/monitors';
import { idiv, percentOf } from '../cstr';
import { poisonRows } from '../messages/messages';
import { removeMember } from '../party/members';
import { enemiesHere, findEntity } from '../room/entities';
import { queue, send } from '../script/send';
import { refreshStats } from '../script/setup';
import { recheckStats } from '../stats/exp';
import { forgetAwaited, setState } from '../script/state';
import { hideStep, sneakStep } from '../script/stealth';
import type { Session } from '../Session';
import { castSpell, equipForSpell } from './cast';
import { healStep } from './heal';
import { postBackstab, preMeditate, preRest } from './prepost';
import { State } from '../states';
import { PartyFlag } from '../flags';

/** The first reason given is the one kept (`restReason`). */
function because(s: Session, reason: string): void {
  if (s.restReason === '') s.restReason = reason.slice(0, 99);
}

/** `0x415f60`: holding for the party, as its leader, and this character is what they wait on. */
function partyNeedsRest(s: Session): number {
  if (s.partyWait === 0 || s.following !== 0) return 0;
  if (s.leaderName !== s.Player_Name || s.sneaking !== 0 || s.hidden !== 0) return 0;
  for (let i = 0; i < s.partySize; i += 1) {
    const m = s.party[i]!;
    if (m.name === s.Player_Name || (m.flags28 & PartyFlag.AskedToWait) === 0) continue;
    if (s.Player_MaxHP < 1 || s.Player_MaxHP <= s.hp) {
      if (s.Player_MaxMana < 1 || s.Player_MaxMana <= s.mana) return 0;
    }
    return 1;
  }
  return 0;
}

/** `0x413890`: meditate, with `UseMeditate`, while mana is short of `ManaFull%` (or the party waits on it). */
export function meditate(s: Session): number {
  const max = s.Player_MaxMana;
  if (s.Health_UseMeditate === 0 || max === 0) return 0;
  if (percentOf(s.Health_ManaFullPct, max) <= s.mana) {
    if (partyNeedsRest(s) === 0) return 0;
    if (max <= s.mana) return 0;
    if (s.Health_MeditateB4Rest === 0 && s.hp < s.Player_MaxHP) return 0;
  }
  if (s.meditating !== 0) return 1;
  s.roundBlowSeen = 0;
  s.probablyRoundFought = 0;
  s.target = '';
  if (s.tooSickToRest !== 0) {
    setState(s, State.Resting);
    return 0;
  }
  if (postBackstab(s, 0) !== 0 || preMeditate(s, 0) !== 0 || beforeMeditate(s) !== 0) return 1;
  s.mustRest = 0;
  s.partyAskPending = 0;
  s.waitLines = 2;
  s.resting = 0;
  s.meditating = 1;
  s.sneaking = 0;
  s.hidden = 0;
  setState(s, State.MeditateAsked);
  send(s, 'meditate\r');
  return 1;
}

/** `0x414300`'s close: a party check after a telepath to the leader. */
function partyCheck(s: Session): number {
  if (s.parDue !== 0 || s.now - s.parAt >= 6) queue(s, 'par\r');
  return 1;
}

/** `0x414300`'s telepath releasing the leader. */
function unholdLeader(s: Session, what: string): number {
  s.holdingLeader = 0;
  s.waitLines = 2;
  s.okSentAt = s.now;
  s.host.activity(what);
  const msg = `/${s.leaderName} ${s.Party_PartyResumeCmd || '@ok'}\r`;
  s.lastResumeSent = msg.slice(0, 299);
  send(s, msg);
  return partyCheck(s);
}

/** Hide, else sneak (`0x414fc7`): a reason to rest that only stealth can wait out. */
function lieLow(s: Session): number {
  if (hideStep(s) !== 0) return 1;
  sneakStep(s);
  return 1;
}

export function healthStep(s: Session): number {
  let why = 0;
  let urgent = false;
  let wantRest = false;
  let hpOk = false;
  let manaOk = false;
  if (s.state === State.RestAsked || s.state === State.MeditateAsked) return 1;
  if (s.allOff !== 0 || s.hp < 1) return 0;
  if (s.inCombat === 0 && s.roundBlowSeen === 0) {
    if (s.runCount > 0 && s.held === 0 && s.following === 0) return 0;
  } else if (s.runCount > 0 && s.held === 0) {
    return 0;
  }
  if (s.rescueCount > 0 && s.held === 0 && s.following === 0) return 0;
  if (healStep(s) !== 0) return 1;

  if (s.MegaMud_AutoHeal === 0) {
    if (s.holdingLeader === 0 || s.allOff !== 0 || s.partyLost !== 0) return 0;
    return unholdLeader(s, 'Unholding party leader');
  }

  if (s.holdingLeader === 0) s.restReason = '';
  if (s.hpFullAt > 0) {
    if (s.hp < s.hpFullAt) {
      s.hpFullAt = 0;
      if (s.debug !== 0) s.host.trace('{hp-r1}');
    } else {
      hpOk = true;
    }
  }
  if (s.manaFullAt > 0) {
    const full = Math.max(s.Health_ManaFullPct, s.Health_ManaRestPct);
    if (s.mana < idiv(full * s.manaFullAt, 100)) {
      s.manaFullAt = 0;
      if (s.debug !== 0) s.host.trace('{ma-r1}');
    } else {
      manaOk = true;
    }
  }
  if (s.held !== 0 && s.following !== 0) {
    s.mustRest = 1;
    why = 8;
    because(s, "can't move");
    s.host.activity("Resting because we can't move");
  }
  if (
    (s.restUntilOff > 0 ||
      s.held !== 0 ||
      s.attackPrevented !== 0 ||
      s.blind !== 0 ||
      s.confused !== 0 ||
      s.partyWait !== 0 ||
      s.holdingLeader !== 0) &&
    s.allOff === 0 &&
    s.now - s.statAskedAt > 0x78
  ) {
    recheckStats(s);
    if (refreshStats(s) !== 0) return 1;
  }
  if (
    s.hidden !== 0 &&
    (s.mustRest === 0 || s.fleeingPlayer !== 0 || s.partyWait !== 0) &&
    s.holdingLeader === 0 &&
    s.now - s.hiddenAt < s.PvP_HideDelay
  ) {
    s.host.activity('Remaining hidden');
    return 1;
  }
  if (s.attackPrevented !== 0 && s.mustRest === 0 && s.following === 0) return 0;

  // The full spells.
  if (s.mana < percentOf(s.Player_MaxMana, s.Health_ManaFullPct)) {
    s.manaFullCast = 0;
  } else {
    if (s.restManaToFull !== 0) {
      s.restManaToFull = 0;
      s.manaFullAt = s.mana;
      manaOk = true;
      if (s.debug !== 0) s.host.trace(`{ma-${s.mana}}`);
    }
    if (s.manaFullCast === 0 && s.Spells_MaFullCmd !== '') {
      if (castSpell(s, s.Spells_MaFullCmd, null) !== 0) {
        s.host.activity(`Casting ${s.Spells_MaFullCmd} because Mana/Kai is full`);
        s.manaFullCast = 1;
        return 1;
      }
    }
  }
  if (s.hp < percentOf(s.Player_MaxHP, s.Health_HpFullPct)) {
    s.hpFullCast = 0;
  } else {
    if (s.restHpToFull !== 0) {
      s.restHpToFull = 0;
      s.hpFullAt = s.hp;
      hpOk = true;
      if (s.debug !== 0) s.host.trace(`{hp-${s.hp}}`);
    }
    if (s.hpFullCast === 0 && s.Spells_HpFullCmd !== '') {
      if (castSpell(s, s.Spells_HpFullCmd, null) !== 0) {
        s.hpFullCast = 1;
        s.host.activity(`Casting ${s.Spells_HpFullCmd} because HP's are full`);
        return 1;
      }
    }
  }

  // Why rest.
  if (s.Player_MaxHP > 0 && !hpOk) {
    if (s.hp < percentOf(s.Health_HpRestPct, s.Player_MaxHP)) {
      if (why === 0) s.host.activity("Resting because HP's are too low");
      s.restHpToFull = 1;
      why |= 1;
      because(s, "HP's too low");
    }
    if (s.hp < percentOf(s.Player_MaxHP, s.Health_HpRunPct)) {
      if (why === 0) s.host.activity("Resting because HP's are too low");
      urgent = true;
      s.restHpToFull = 1;
      why |= 1;
      because(s, "resting HP's to full");
    }
  }
  if (s.Player_MaxMana > 0 && !manaOk) {
    if (s.mana < percentOf(s.Health_ManaRestPct, s.Player_MaxMana)) {
      if (why === 0) s.host.activity('Resting because Mana/Kai is too low');
      s.restManaToFull = 1;
      why |= 2;
      because(s, 'Mana/Kai too low');
    }
    if (s.mana < percentOf(s.Player_MaxMana, s.Health_ManaRunPct)) {
      if (why === 0) s.host.activity('Resting because Mana/Kai is too low');
      urgent = true;
      why |= 2;
      because(s, 'resting Mana/Kai to full');
    }
  }
  let mustRest = urgent;
  if (s.restHpToFull !== 0) {
    mustRest = true;
    if (why === 0) s.host.activity('Resting HPs to full');
    why |= 1;
    because(s, "resting HP's to full");
  }
  if (s.restManaToFull !== 0) {
    mustRest = true;
    if (why === 0) s.host.activity('Resting Mana/Kai to full');
    why |= 2;
    because(s, 'resting Mana/Kai to full');
  }
  if (s.restUntilOff > 0) {
    if (why === 0) s.host.activity(`Resting because of ${s.lastRestRow} condition`);
    mustRest = true;
    urgent = true;
    why |= 0x100;
    because(s, 'waiting on message condition');
  }
  if (s.following === 0) {
    for (let i = 0; i < s.partySize; i += 1) {
      const m = s.party[i]!;
      if (m.name === s.Player_Name) continue;
      if ((m.flags28 & PartyFlag.Invited) !== 0 && findEntity(s, m.name, 0) === null) {
        removeMember(s, i);
        i -= 1;
        continue;
      }
      if (
        ((m.flags28 &
          (PartyFlag.Invited | PartyFlag.Unlisted | PartyFlag.AskedToWait | PartyFlag.Offline)) !==
          0 ||
          (m.hpPct < s.Party_PartyWaitPct && m.maxHp > 0)) &&
        s.rescueCount === 0
      ) {
        if (why === 0) s.host.activity(`Resting to wait for party member ${m.name}`);
        mustRest = true;
        why |= 4;
        because(s, 'waiting for party health');
      }
    }
  }
  if (
    mustRest ||
    urgent ||
    s.mustRest !== 0 ||
    (s.following !== 0 &&
      s.probablyLeaderResting !== 0 &&
      (s.hp < s.Player_MaxHP || s.mana < s.Player_MaxMana)) ||
    (!manaOk && s.mana < percentOf(s.Player_MaxMana, s.Health_ManaFullPct)) ||
    (!hpOk && s.hp < percentOf(s.Player_MaxHP, s.Health_HpFullPct))
  ) {
    wantRest = true;
  }

  // The mana regen spell.
  if (
    (s.fluxRecast !== 0 ||
      (s.mana < s.Player_MaxMana - 0x14 && s.manaRegen === 0 && s.meditating === 0)) &&
    s.Player_MaxMana > 0 &&
    s.Spells_FluxCmd !== '' &&
    s.lastTick !== -999
  ) {
    if (equipForSpell(s, s.Spells_FluxCmd) === 1) return 1;
    if (castSpell(s, s.Spells_FluxCmd, null) !== 0) {
      s.manaRegen = 1;
      s.fluxRecast = 0;
      s.lastTick = -999;
      s.lastTickAt = s.now;
      return 1;
    }
  }

  // Conditions.
  if (s.held !== 0) {
    if (why === 0) s.host.activity("Resting because we can't move");
    why |= 8;
    if (!wantRest && s.following === 0) return lieLow(s);
    mustRest = true;
    because(s, "can't move");
  }
  if (s.blind !== 0 && s.Other_IgnoreBlind === 0) {
    if (why === 0) s.host.activity('Resting because we are blinded');
    why |= 0x10;
    if (!wantRest && s.following === 0) return lieLow(s);
    urgent = true;
    mustRest = true;
    because(s, 'blinded');
  }
  if (s.diseased !== 0 && s.Other_IgnoreDisease === 0) {
    if (why === 0) s.host.activity('Resting because we are diseased');
    why |= 0x40;
    if (!wantRest && s.following === 0) return lieLow(s);
    urgent = true;
    mustRest = true;
    because(s, 'diseased');
  }
  if (s.confused !== 0 && s.Other_IgnoreConfusion === 0) {
    if (why === 0) s.host.activity('Resting because we are confused');
    why |= 0x80;
    if (!wantRest && s.following === 0) return lieLow(s);
    mustRest = true;
    because(s, 'confused');
  }

  // A follower asks the leader to wait while it rests.
  if (s.following !== 0 && s.holdingLeader === 0 && mustRest) {
    if (s.allOff === 0 && s.probablyLeaderResting === 0) {
      s.holdingLeader = 1;
      because(s, 'not sure why');
      if (s.now - s.waitSentAt <= s.Comms_LagWait + 3) return 1;
      s.host.activity('Holding leader because we need to rest');
      s.waitLines = 2;
      const msg = `/${s.leaderName} ${s.Party_PartyWaitCmd || '@wait'} (${s.restReason})\r`;
      s.lastWaitSent = msg.slice(0, 299);
      send(s, msg);
      s.waitSentAt = s.now;
      return partyCheck(s);
    }
  }

  // The HP regen spell.
  if (mustRest || s.mustRest !== 0) {
    if (
      s.hp < s.Player_MaxHP &&
      s.hpRegen === 0 &&
      s.Player_MaxMana > 0 &&
      s.Spells_RegenCmd !== '' &&
      percentOf(s.Health_ManaHealPct, s.Player_MaxMana) < s.mana
    ) {
      if (equipForSpell(s, s.Spells_RegenCmd) === 1) return 1;
      if (castSpell(s, s.Spells_RegenCmd, null) !== 0) {
        s.hpRegen = 1;
        return 1;
      }
    }
  }
  if (s.runDirection !== -1 && s.holdingLeader === 0) return 0;
  if (s.dontRestHere !== 0) return 0;

  if (s.poisoned !== 0 && s.Other_IgnorePoison === 0) {
    if (why === 0) s.host.activity('Resting because we are poisoned');
    if (s.following === 0 && hideStep(s) === 0) sneakStep(s);
    setState(s, State.Poisoned);
    return 1;
  }
  const partyWaits = partyNeedsRest(s);
  if (partyWaits === 0) {
    s.partyWaitTraced = 0;
  } else {
    urgent = true;
    if (s.partyWaitTraced === 0) {
      s.partyWaitTraced = 1;
      if (s.debug !== 0) s.host.trace('{pw-r}');
    }
  }
  if (wantRest && s.partyWait !== 0) {
    mustRest = true;
    if (s.following === 0) {
      if (why === 0) s.host.activity('Resting because party is waiting');
      why |= 4;
      because(s, 'party is waiting');
    }
  } else if (!mustRest && s.mustRest === 0) {
    if (s.fleeingPlayer !== 0 && s.PvP_PvpAction === 2) s.fleeingPlayer = 0;
    const st = s.state;
    if (st === State.Resting || st === State.Meditating || st === State.Poisoned) {
      forgetAwaited(s, st);
      setState(s, State.Nothing);
    }
    if (s.holdingLeader !== 0 && s.allOff === 0 && s.partyLost === 0) {
      return unholdLeader(s, 'Un-holding leader');
    }
    if (!wantRest) return 0;
    if (s.following === 0) {
      if (s.walking !== 0 || s.importing !== 0 || s.roaming !== 0) return 0;
    } else if (s.probablyLeaderResting === 0) {
      return 0;
    }
  }
  if (enemiesHere(s, 0) > 0 && (s.MegaMud_AutoCombat !== 0 || s.partySize === 0)) return 0;

  // Already resting or meditating.
  if (s.resting !== 0 || s.meditating !== 0) {
    setState(s, s.resting === 0 ? State.Meditating : State.Resting);
    if (s.poisoned !== 0 || s.tooSickToRest !== 0) poisonRows(s, 0);
    s.poisoned = 0;
    s.tooSickToRest = 0;
    let meditateNow = false;
    if (s.mustRest === 0) {
      if (s.meditating !== 0) return 1;
      if (s.hp === s.Player_MaxHP) {
        if (s.Health_UseMeditate === 0 || s.Player_MaxMana <= s.mana) {
          if (s.Health_PreRestCmd === '' && partyWaits === 0) {
            if (hideStep(s) !== 0 || sneakStep(s) !== 0) return 1;
          }
          return 1;
        }
        meditateNow = true;
      } else {
        if (
          partyWaits === 0 ||
          s.Health_MeditateB4Rest === 0 ||
          s.Health_UseMeditate === 0 ||
          s.Player_MaxMana <= s.mana
        ) {
          return 1;
        }
        meditateNow = true;
      }
    }
    if (
      ((s.active === 0 && s.walking === 0 && s.roaming === 0 && s.importing === 0) ||
        s.allOff !== 0) &&
      (wantRest || mustRest) &&
      s.resting !== 0 &&
      !meditateNow
    ) {
      s.mustRest = 0;
      return 1;
    }
  }

  // Not straight after moving or a fight.
  if (
    s.walking === 0 &&
    s.importing === 0 &&
    s.mustRest === 0 &&
    s.holdingLeader === 0 &&
    !urgent &&
    (s.following === 0 || s.probablyLeaderResting === 0)
  ) {
    const lag = s.Comms_LagWait + 5;
    if (s.now - s.lastKeyAt < lag) return 0;
    if (s.now - s.movedAt < lag) return 0;
  }

  // Meditate first?
  let tryMeditate: boolean;
  if (s.Health_MeditateB4Rest === 0) {
    tryMeditate = s.hp >= percentOf(s.Player_MaxHP, s.Health_HpRestPct);
  } else if (s.meditating === 0) {
    tryMeditate = !(
      percentOf(s.Health_ManaRestPct, s.Player_MaxMana) <= s.mana &&
      (partyWaits === 0 || s.Player_MaxMana <= s.mana)
    );
  } else {
    tryMeditate = true;
  }
  if (tryMeditate && meditate(s) !== 0) return 1;

  if (
    !mustRest &&
    s.mustRest === 0 &&
    (s.following === 0 || s.probablyLeaderResting === 0) &&
    (s.Player_MaxHP <= s.hp || (s.hpFullAt > 0 && s.hpFullAt <= s.hp))
  ) {
    return 0;
  }

  // Rest.
  if (postBackstab(s, 0) !== 0 || preRest(s, 0) !== 0 || beforeRest(s) !== 0) return 1;
  if (s.now - s.restAskedAt < s.Comms_LagWait + 4) return 1;
  s.restAskedAt = s.now;
  s.mustRest = 0;
  if (why === 0) {
    let what: string;
    if (s.restUntilOff >= 1) {
      why = 0x100;
      what = 'Resting due to message conditions';
    } else if (!hpOk && s.hp < s.Player_MaxHP) {
      why = 1;
      what = 'Resting HPs (no reason)';
    } else if (!manaOk && s.mana < s.Player_MaxMana) {
      why = 2;
      what = 'Resting mana/kai (no reason)';
    } else {
      what = 'Resting (unknown reason)';
    }
    s.host.activity(what);
  }
  if (
    s.hp === s.Player_MaxHP &&
    partyWaits === 0 &&
    s.Health_PreRestCmd === '' &&
    (s.hidden !== 0 || hideStep(s) !== 0 || s.sneaking !== 0 || sneakStep(s) !== 0)
  ) {
    s.roundBlowSeen = 0;
    s.probablyRoundFought = 0;
    s.target = '';
    return 1;
  }
  if (s.resting !== 0) {
    setState(s, State.Resting);
    return 1;
  }
  s.mustRest = 0;
  s.partyAskPending = 0;
  s.roundBlowSeen = 0;
  s.probablyRoundFought = 0;
  s.target = '';
  if (s.tooSickToRest !== 0) {
    setState(s, State.Resting);
    return 1;
  }
  s.waitLines = 2;
  s.resting = 1;
  s.meditating = 0;
  s.sneaking = 0;
  s.hidden = 0;
  s.restAskedAt = s.now;
  setState(s, State.RestAsked);
  send(s, 'rest\r');
  return 1;
}
