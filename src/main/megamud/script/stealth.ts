/**
 * Hiding and sneaking (`0x407ac0`, `0x40b520`), read 2026-10-12: a
 * stealthy character (`Player.Stealth`, or `Other.SuperStealth`) hides while
 * idle with `AutoHide`, and sneaks with `AutoSneak`, its backstab weapon and
 * shield readied first. Neither with monsters here, nor after too many
 * failures in this room.
 */
import { postBackstab, postMeditate, postRest, preBackstab } from '../health/prepost';
import { findCarried } from '../items/inventory';
import type { Session } from '../Session';
import { send } from './send';
import { setState } from './state';

function moving(s: Session): boolean {
  return s.walking !== 0 || s.roaming !== 0 || s.importing !== 0;
}

/** `0x472aa0`: the monsters here. */
function monstersHere(s: Session): number {
  return s.room.filter((e) => e.type === 2).length;
}

/** The post-rest and post-meditate commands owed before getting up. */
function getUp(s: Session): number {
  if (s.resting === 0 && s.meditating === 0) return 0;
  const rested = postRest(s, 2, 0);
  const meditated = postMeditate(s, 0);
  return rested !== 0 || meditated !== 0 ? 1 : 0;
}

/** Too many failures in this room: give up, and look at it again once (`0xdb6c` 10 → 11). */
function givenUp(s: Session): void {
  if (s.f_db6c === 10) {
    s.f_db6c = 0xb;
    s.f_e290 = 1;
  }
}

/** `0x407ac0`: hiding while idle (D49, and to rest or run unseen). */
export function hideStep(s: Session): number {
  if (s.Player_Stealth === 0 && s.Other_SuperStealth === 0) return 0;
  if (s.MegaMud_AutoHide === 0 || (s.following === 0 && s.f_e2ec !== 0)) return 0;
  if (s.state === 0x13) return 1;
  if (s.inCombat !== 0 || s.hidden !== 0) return 0;
  if (monstersHere(s) > 0) {
    s.f_e1d0 = 0;
    return 0;
  }
  if (s.f_db68 < 3 && s.f_db6c < 10) {
    if (s.hp < 1) return 0;
    if (s.f_e1d0 === 0 && !moving(s) && s.now - s.f_322d0 < s.Comms_LagWait + 6) return 0;
    if (getUp(s) !== 0) return 1;
    if (preBackstab(s, 0) !== 0) return 1;
    s.f_e1d0 = 0;
    s.hidden = 1;
    s.f_32300 = s.now;
    s.waitLines = 2;
    setState(s, 0x13);
    s.host.activity('Attempting to hide');
    send(s, 'hide\r');
    return 1;
  }
  givenUp(s);
  return 0;
}

/** Equip `name` (`0x1f`), marked equipped at once. */
function equipFor(s: Session, name: string, what: string, clearFight: boolean): number {
  const c = findCarried(s, name);
  if (!c || (c.flags & 1) !== 0) return 0;
  c.flags |= 1;
  s.f_a5f8 += 1;
  s.waitLines = 2;
  if (clearFight) {
    s.f_e1d8 = 0;
    s.stateBefore = 0;
  }
  s.equipping = name.slice(0, 30);
  setState(s, 0x1f);
  s.host.activity(what);
  send(s, `equip ${name}\r`);
  return 1;
}

/**
 * `0x40b520`: sneaking (D12 when asked for, D49), its backstab kit ready:
 * the shield off (or on, with `UseShieldForBS`), the backstab weapon in hand
 * (or none, to backstab with hands), and the pre-backstab command. Without
 * `AutoSneak`, only the post-backstab command.
 */
export function sneakStep(s: Session): number {
  if (s.MegaMud_AutoSneak === 0 && s.f_e2bc === 0) {
    if (s.sneaking !== 0 || s.hidden !== 0 || s.MegaMud_AutoHide !== 0) return 0;
    if (((s.active !== 0 || moving(s)) && s.f_a32c === 0) || s.MegaMud_DefSneak1 === 0) {
      if (s.active === 0 && !moving(s)) return 0;
      if (s.f_a32c !== 0 || s.MegaMud_DefSneak2 === 0) return 0;
    }
    return postBackstab(s, 0);
  }
  if (s.Player_Stealth === 0 && s.Other_SuperStealth === 0) return 0;
  if (s.f_e2d8 !== 0) return 0;
  if (s.state === 0x1b) return 1;
  if (s.inCombat !== 0 || monstersHere(s) > 0) return 0;
  const tries = s.Other_MustSneak !== 0 ? 5 : 3;
  if ((tries <= s.f_db68 || s.f_db6c > 9) && s.f_e2bc === 0) {
    givenUp(s);
    return 0;
  }
  if (s.hp < 1) return 0;
  if (s.following !== 0 && (s.state === 3 || s.state === 5)) return 0;
  if (getUp(s) !== 0) return 1;
  if ((s.Other_MustSneak === 0 || s.f_e1a0 !== 0) && s.now - s.f_322f0 < 3) return 0;

  const shield = s.Combat_Shield;
  if (s.Combat_CanBackStab !== 0) {
    if (shield !== '' && s.Combat_UseShieldForBS === 0) {
      const c = findCarried(s, shield);
      if (c && (c.flags & 1) !== 0) {
        c.flags &= ~1;
        s.waitLines = 2;
        s.f_e1d8 = 0;
        s.stateBefore = 0;
        setState(s, 0x2e);
        s.host.activity(`Removing shield ${shield} for BS`);
        send(s, `remove ${shield}\r`);
        return 1;
      }
    }
    if (preBackstab(s, 0) !== 0) return 1;
    const weapon = s.Combat_BsWeapon;
    if (s.s_b060 !== weapon) {
      if (weapon === '') {
        if (s.s_b060 !== '') {
          s.waitLines = 2;
          setState(s, 0x2e);
          s.host.activity('Removing weapon to BS with hands');
          send(s, `remove ${s.s_b060}\r`);
          return 1;
        }
      } else if (equipFor(s, weapon, `Equipping BS weapon ${weapon}`, false) !== 0) {
        return 1;
      }
    }
    if (
      shield !== '' &&
      s.Combat_UseShieldForBS !== 0 &&
      equipFor(s, shield, `Equipping shield ${shield} for BS`, true) !== 0
    ) {
      return 1;
    }
  }
  if (s.sneaking !== 0) return 0;
  s.sneaking = 1;
  s.f_e2bc = 0;
  s.f_e1c8 = 0;
  s.waitLines = 2;
  setState(s, 0x1b);
  s.host.activity('Attempting to sneak');
  send(s, 'sn\r');
  return 1;
}
