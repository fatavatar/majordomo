/**
 * `0x410f50`: the weapon for the fight, read 2026-10-12. The normal weapon
 * (`Combat.NrmWeapon`), else (the monster immune to it, `0x200`) the alt
 * weapon (`0x400`), else the backstab weapon (`0x4000`); else every weapon is
 * exhausted and the fight is given up. Bare hands with no normal weapon and
 * an unarmed attack (punch, jumpkick, kick). A weapon the monster's immunity
 * is only suspected for is probed once (`0xdf04`). The shield goes on for
 * normal combat, unless it is only for backstabs.
 */
import { abbrev } from '../cstr';
import { findCarried } from '../items/inventory';
import { currentTarget, findEntity } from '../room/entities';
import { send } from '../script/send';
import { setState } from '../script/state';
import type { RoomEntity, Session } from '../Session';
import { weaponKinds } from './hits';

/** `0x4263f0`: the monster mark that suspects immunity to weapon kind `kind`. */
function suspected(kind: number): number {
  return kind === 1 ? 0x20000 : kind === 2 ? 0x40000 : kind === 4 ? 0x80000 : 0;
}

/** `0x416290`: all the configured weapons are exhausted against this monster. */
function exhausted(s: Session, e: RoomEntity | null): void {
  if (s.f_8bec !== 0) return;
  if (s.debug !== 0)
    s.host.trace(`{W-exh:${s.Combat_NrmWeapon}/${s.Combat_AltWeapon}/${s.Combat_BsWeapon}}`);
  const who = e?.name ?? s.target;
  s.host.show(
    who !== ''
      ? `[all configured weapons exhausted vs ${who}]`
      : '[all configured weapons exhausted]'
  );
}

/** Before an equip or remove: the fight's flags kept, the state its own. */
function changing(s: Session, state: number, what: string): void {
  s.waitLines = 2;
  s.f_e1d8 = s.inCombat;
  s.stateBefore = 0;
  setState(s, state);
  s.host.activity(what);
}

export function normalWeapon(s: Session): number {
  const wasExhausted = s.f_8bec;
  const shield = s.Combat_Shield;
  if (shield !== '' && s.Combat_UseShieldForBS !== 0) {
    const c = findCarried(s, shield);
    if (c && (c.flags & 1) !== 0) {
      c.flags &= ~1;
      changing(s, 0x2e, `Removing shield ${shield} for normal combat`);
      send(s, `remove ${shield}\r`);
      return 1;
    }
  }
  const bareHands = (): number => {
    if (s.s_b060 !== '') {
      changing(s, 0x2e, 'Removing weapon to fight with hands');
      send(s, `remove ${s.s_b060}\r`);
      return 1;
    }
    return shieldOn(s);
  };
  if (s.Combat_NrmWeapon === '') {
    if (s.f_b0fc === 0) return bareHands();
    if (s.Combat_AltWeapon === '' && s.Combat_BsWeapon === '') return bareHands();
  }

  const victim = s.target === '' ? currentTarget(s) : findEntity(s, s.target, 0);
  const marks = victim?.flags ?? 0;
  const ignore = s.Other_IgnoreWeaponImmunity !== 0;
  const nrmOk = !(
    s.Combat_NrmWeapon === '' ||
    (s.f_b100 !== 0 && s.f_b0fc !== 0) ||
    (!ignore && (marks & 0x200) !== 0)
  );
  const altOk = !(
    s.Combat_AltWeapon === '' ||
    (s.f_b104 !== 0 && s.f_b0fc !== 0) ||
    (!ignore && (marks & 0x400) !== 0)
  );
  const bsOk = !(
    s.Combat_BsWeapon === '' ||
    (s.f_b108 !== 0 && s.f_b0fc !== 0) ||
    (!ignore && (marks & 0x4000) !== 0)
  );
  const cmd = s.Combat_AttackCmd;
  const unarmed =
    abbrev(cmd, 'punch', 2) !== 0 ||
    abbrev(cmd, 'jumpkick', 2) !== 0 ||
    abbrev(cmd, 'kick', 3) !== 0;
  const held = s.s_b060;
  const holdingOther =
    held !== '' &&
    !(s.Combat_NrmWeapon !== '' && held === s.Combat_NrmWeapon) &&
    !(s.Combat_AltWeapon !== '' && held === s.Combat_AltWeapon) &&
    !(s.Combat_BsWeapon !== '' && held === s.Combat_BsWeapon);

  let want = held;
  if (s.f_b0fc === 0) {
    if (nrmOk || unarmed) {
      want = s.Combat_NrmWeapon;
    } else if (holdingOther) {
      s.f_b0fc = 1;
      if (s.debug !== 0) s.host.trace('{W-cur}');
    } else if (altOk) {
      s.f_b0fc = 1;
      want = s.Combat_AltWeapon;
      if (s.debug !== 0) s.host.trace('{W-alt}');
    } else if (bsOk) {
      s.f_b0fc = 1;
      want = s.Combat_BsWeapon;
      if (s.debug !== 0) s.host.trace('{W-bs}');
    } else {
      exhausted(s, victim);
      s.f_b0fc = 1;
      s.f_8bec = 1;
      if (s.debug !== 0) s.host.trace('{W-all-immune}');
    }
  } else if (nrmOk) {
    want = s.Combat_NrmWeapon;
  } else if (altOk) {
    want = s.Combat_AltWeapon;
  } else if (bsOk) {
    want = s.Combat_BsWeapon;
  } else {
    exhausted(s, victim);
    s.f_8bec = 1;
  }
  if (s.f_8bec !== 0 && wasExhausted === 0) {
    // Nothing here can hurt it: the scheduler's next pass gives the fight up.
    s.lineFlags |= 1;
    s.f_e544 = 4;
    return 1;
  }

  let probe = 0;
  if (victim && s.f_8bec === 0) {
    const kinds = weaponKinds(s, want);
    const probing = (kind: number, known: number): boolean =>
      (kinds & kind) !== 0 &&
      known === 0 &&
      (marks & suspected(kind)) !== 0 &&
      (s.f_df08 & kind) !== 0 &&
      (s.f_df00 & kind) === 0 &&
      (s.f_df04 & kind) === 0;
    if (probing(1, s.f_b100)) probe |= 1;
    if (probing(2, s.f_b104)) probe |= 2;
    if (probing(4, s.f_b108)) probe |= 4;
    s.f_df04 |= probe;
  }
  if (probe !== 0 || held !== want) {
    const c = findCarried(s, want);
    if (c) {
      if (probe !== 0 && s.debug !== 0) {
        const tag = `${probe & 1 ? 'N' : ''}${probe & 2 ? 'A' : ''}${probe & 4 ? 'B' : ''}`;
        s.host.trace(`{W-probe:${tag}}`);
      }
      s.s_b060 = want.slice(0, 30);
      s.equipping = want.slice(0, 30);
      s.f_a5f8 += 1;
      changing(s, 0x1f, `Equiping normal attack weapon ${want}`);
      send(s, `equip ${want}\r`);
      return 1;
    }
  }
  return shieldOn(s);
}

/** The shield on for normal combat (`0x4117f7`), when it is not only for backstabs. */
function shieldOn(s: Session): number {
  const shield = s.Combat_Shield;
  if (shield === '' || s.Combat_UseShieldForBS !== 0) return 0;
  const c = findCarried(s, shield);
  if (!c || (c.flags & 1) !== 0) return 0;
  c.flags |= 1;
  s.f_a5f8 += 1;
  s.equipping = shield.slice(0, 30);
  changing(s, 0x1f, `Equipping shield ${shield} for normal combat`);
  send(s, `equip ${shield}\r`);
  return 1;
}
