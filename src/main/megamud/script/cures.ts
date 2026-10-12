/**
 * Curing: blindness, disease, being held, poison, for this character and the
 * party. The step itself (`0x410130`) is not ported yet; the checks the heals
 * ask first (`0x415ad0`, `CureOverMinorHeal`) are, read 2026-10-12.
 */
import { castAllowed } from '../combat/timer';
import { findPlayer } from '../room/checkNames';
import { enemiesHere } from '../room/entities';
import type { Session } from '../Session';
import { findSpell } from '../spells/lookup';
import { unported } from '../unported';

/** `0x410130`: cures (D26 in a fight, D34 out of one). Not ported yet. */
export function cureStep(_s: Session, _fighting: number): number {
  return unported('410130');
}

/** `0x40df50`: a cure spell is set, and unknown or affordable. */
export function cureCastable(s: Session, short: string): boolean {
  if (short === '') return false;
  const spell = findSpell(s, short);
  return spell === null || spell.cost === 0 || spell.cost <= s.mana;
}

/** The health step's own holds (`0x414300`'s start), shared by `0x415d40`. */
function busyRunning(s: Session): boolean {
  if (s.inCombat === 0 && s.f_32604 === 0) {
    if (s.runCount > 0 && s.held === 0 && s.following === 0) return true;
  } else if (s.runCount > 0 && s.held === 0) {
    return true;
  }
  return s.rescueCount > 0 && s.held === 0 && s.following === 0;
}

/**
 * `0x415d40`: this character needs a cure it can cast. In a fight (`fighting`)
 * blindness and disease, and being held when running; out of one, being held
 * or poisoned, unless resting, running or staying hidden.
 */
export function selfCureWanted(s: Session, fighting: number): boolean {
  if (s.f_a32c !== 0 || s.MegaMud_AutoHeal === 0 || s.hp < 1) return false;
  if (s.Player_MaxHP === 0 || s.Player_MaxMana === 0 || s.state === 0x12) return false;
  if (s.state === 0 && s.f_e1c4 !== 0 && s.f_e184 !== 0 && enemiesHere(s, 0) > 0) return false;
  if (!castAllowed(s, s.Comms_LagWait)) return false;
  if (fighting !== 0) {
    if (s.blind !== 0 && s.Other_IgnoreBlind === 0 && cureCastable(s, s.Spells_BlindCmd))
      return true;
    if (s.diseased !== 0 && cureCastable(s, s.Spells_DiseaseCmd)) return true;
    if (s.runCount < 1) return false;
  } else {
    if (s.state === 2 || s.state === 4) return false;
    if (busyRunning(s)) return false;
    if (
      s.hidden !== 0 &&
      (s.mustRest === 0 || s.f_e1a0 !== 0 || s.partyWait !== 0) &&
      s.holdingLeader === 0 &&
      s.now - s.f_32300 < s.PvP_HideDelay
    ) {
      return false;
    }
  }
  if (s.held !== 0 && cureCastable(s, s.Spells_FreedomCmd)) return true;
  return (
    fighting === 0 &&
    s.poisoned !== 0 &&
    s.Other_IgnorePoison === 0 &&
    cureCastable(s, s.Spells_PoisonCmd)
  );
}

/**
 * `0x415b40`: a party member needs a cure this character can cast: in a fight
 * (`fighting`) blindness (`0x4000`) or disease (`0x2000`); out of one, being
 * held (`0x8000`, with no monsters here) or poison (`0x1000`, out of combat).
 */
export function partyCureWanted(s: Session, fighting: number): boolean {
  if (s.f_a32c !== 0 || s.MegaMud_AutoHeal === 0 || s.partySize < 1) return false;
  if (s.hp < 1 || s.Player_MaxHP === 0 || s.state === 0x12) return false;
  if (s.state === 0 && s.f_e1c4 !== 0 && s.f_e184 !== 0 && enemiesHere(s, 0) >= 1) return false;
  if (!castAllowed(s, s.Comms_LagWait)) return false;
  for (let i = 0; i < s.partySize; i += 1) {
    const m = s.party[i]!;
    const f = m.flags28;
    if ((f & 0x8f) !== 0 || m.name === s.Player_Name) continue;
    const known = findPlayer(s, m.name);
    if (known && (known.flags & 0x2000) !== 0) continue;
    if (fighting === 0) {
      if ((f & 0x8000) !== 0 && cureCastable(s, s.Spells_FreedomCmd) && enemiesHere(s, 0) === 0) {
        return true;
      }
      if (
        (f & 0x1000) !== 0 &&
        cureCastable(s, s.Spells_PoisonCmd) &&
        s.inCombat === 0 &&
        enemiesHere(s, 0) === 0
      ) {
        return true;
      }
    } else if (
      ((f & 0x4000) !== 0 && cureCastable(s, s.Spells_BlindCmd)) ||
      ((f & 0x2000) !== 0 && cureCastable(s, s.Spells_DiseaseCmd))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * `0x415ad0`: with `CureOverMinorHeal`, a cure is wanted before a heal: a
 * fight's cures, or (no monsters here) any.
 */
export function curesFirst(s: Session): boolean {
  if (s.Other_CureOverMinorHeal === 0) return false;
  if (selfCureWanted(s, 1) || partyCureWanted(s, 1)) return true;
  if (enemiesHere(s, 0) !== 0) return false;
  return selfCureWanted(s, 0) || partyCureWanted(s, 0);
}
