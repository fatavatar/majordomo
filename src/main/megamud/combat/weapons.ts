/**
 * `0x410f50`: the weapon for the fight, read 2026-10-12. The normal weapon
 * (`Combat.NrmWeapon`), else (the monster immune to it, `0x200`) the alt
 * weapon (`0x400`), else the backstab weapon (`0x4000`); else every weapon is
 * exhausted and the fight is given up. Bare hands with no normal weapon and
 * an unarmed attack (punch, jumpkick, kick). A weapon the monster's immunity
 * is only suspected for is probed once (`weaponsProbing`). The shield goes on for
 * normal combat, unless it is only for backstabs.
 */
import { abbrev } from '../cstr';
import { findCarried } from '../items/inventory';
import { currentTarget, findEntity } from '../room/entities';
import { send } from '../script/send';
import { setState } from '../script/state';
import type { RoomEntity, Session } from '../Session';
import { maybeImmunityOf, weaponKinds } from './hits';
import { openingWeapon } from './opening';
import { State } from '../states';
import { LineFlag, CarriedFlag, EntityFlag, WeaponKind } from '../flags';

/** `0x416290`: all the configured weapons are exhausted against this monster. */
function exhausted(s: Session, e: RoomEntity | null): void {
  if (s.weaponsExhausted !== 0) return;
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
  s.combatOffExpected = s.inCombat;
  s.stateBefore = State.Nothing;
  setState(s, state);
  s.host.activity(what);
}

export function normalWeapon(s: Session): number {
  const wasExhausted = s.weaponsExhausted;
  const shield = s.Combat_Shield;
  if (shield !== '' && s.Combat_UseShieldForBS !== 0) {
    const c = findCarried(s, shield);
    if (c && (c.flags & CarriedFlag.Equipped) !== 0) {
      c.flags &= ~CarriedFlag.Equipped;
      changing(s, State.Other, `Removing shield ${shield} for normal combat`);
      send(s, `remove ${shield}\r`);
      return 1;
    }
  }
  // Ours: the opening weapon for the round the opening attack begins (`opening.ts`).
  const opener = openingWeapon(s);
  if (opener !== null) {
    if (s.weaponWielded !== opener) return wield(s, opener, `Equiping opening weapon ${opener}`);
    return shieldOn(s);
  }
  const bareHands = (): number => {
    if (s.weaponWielded !== '') {
      changing(s, State.Other, 'Removing weapon to fight with hands');
      send(s, `remove ${s.weaponWielded}\r`);
      return 1;
    }
    return shieldOn(s);
  };
  if (s.Combat_NrmWeapon === '') {
    if (s.weaponNoEffect === 0) return bareHands();
    if (s.Combat_AltWeapon === '' && s.Combat_BsWeapon === '') return bareHands();
  }

  const victim = s.target === '' ? currentTarget(s) : findEntity(s, s.target, 0);
  const marks = victim?.flags ?? 0;
  const ignore = s.Other_IgnoreWeaponImmunity !== 0;
  const nrmOk = !(
    s.Combat_NrmWeapon === '' ||
    (s.normalWeaponWorked !== 0 && s.weaponNoEffect !== 0) ||
    (!ignore && (marks & EntityFlag.ImmuneNormalWeapon) !== 0)
  );
  const altOk = !(
    s.Combat_AltWeapon === '' ||
    (s.altWeaponWorked !== 0 && s.weaponNoEffect !== 0) ||
    (!ignore && (marks & EntityFlag.ImmuneAltWeapon) !== 0)
  );
  const bsOk = !(
    s.Combat_BsWeapon === '' ||
    (s.backstabWeaponWorked !== 0 && s.weaponNoEffect !== 0) ||
    (!ignore && (marks & EntityFlag.ImmuneBackstabWeapon) !== 0)
  );
  const cmd = s.Combat_AttackCmd;
  const unarmed =
    abbrev(cmd, 'punch', 2) !== 0 ||
    abbrev(cmd, 'jumpkick', 2) !== 0 ||
    abbrev(cmd, 'kick', 3) !== 0;
  const held = s.weaponWielded;
  const holdingOther =
    held !== '' &&
    !(s.Combat_NrmWeapon !== '' && held === s.Combat_NrmWeapon) &&
    !(s.Combat_AltWeapon !== '' && held === s.Combat_AltWeapon) &&
    !(s.Combat_BsWeapon !== '' && held === s.Combat_BsWeapon) &&
    !(s.Combat_OpenWeapon !== '' && held === s.Combat_OpenWeapon);

  let want = held;
  if (s.weaponNoEffect === 0) {
    if (nrmOk || unarmed) {
      want = s.Combat_NrmWeapon;
    } else if (holdingOther) {
      s.weaponNoEffect = 1;
      if (s.debug !== 0) s.host.trace('{W-cur}');
    } else if (altOk) {
      s.weaponNoEffect = 1;
      want = s.Combat_AltWeapon;
      if (s.debug !== 0) s.host.trace('{W-alt}');
    } else if (bsOk) {
      s.weaponNoEffect = 1;
      want = s.Combat_BsWeapon;
      if (s.debug !== 0) s.host.trace('{W-bs}');
    } else {
      exhausted(s, victim);
      s.weaponNoEffect = 1;
      s.weaponsExhausted = 1;
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
    s.weaponsExhausted = 1;
  }
  if (s.weaponsExhausted !== 0 && wasExhausted === 0) {
    // Nothing here can hurt it: the scheduler's next pass gives the fight up.
    s.lineFlags |= LineFlag.Prompted;
    s.dialState = 4;
    return 1;
  }

  let probe = 0;
  if (victim && s.weaponsExhausted === 0) {
    const kinds = weaponKinds(s, want);
    const probing = (kind: number, known: number): boolean =>
      (kinds & kind) !== 0 &&
      known === 0 &&
      (marks & maybeImmunityOf(kind)) !== 0 &&
      (s.weaponsSuspect & kind) !== 0 &&
      (s.weaponsInHand & kind) === 0 &&
      (s.weaponsProbing & kind) === 0;
    if (probing(WeaponKind.Normal, s.normalWeaponWorked)) probe |= WeaponKind.Normal;
    if (probing(WeaponKind.Alt, s.altWeaponWorked)) probe |= WeaponKind.Alt;
    if (probing(WeaponKind.Backstab, s.backstabWeaponWorked)) probe |= WeaponKind.Backstab;
    s.weaponsProbing |= probe;
  }
  if (probe !== 0 || held !== want) {
    const c = findCarried(s, want);
    if (c) {
      if (probe !== 0 && s.debug !== 0) {
        const tag = `${probe & 1 ? 'N' : ''}${probe & 2 ? 'A' : ''}${probe & 4 ? 'B' : ''}`;
        s.host.trace(`{W-probe:${tag}}`);
      }
      return wield(s, want, `Equiping normal attack weapon ${want}`);
    }
  }
  return shieldOn(s);
}

/** `equip` a weapon for the fight, its name taken as the one in hand. */
function wield(s: Session, weapon: string, what: string): number {
  s.weaponWielded = weapon.slice(0, 30);
  s.equipping = weapon.slice(0, 30);
  s.equipsPending += 1;
  changing(s, State.Equipping, what);
  send(s, `equip ${weapon}\r`);
  return 1;
}

/** The shield on for normal combat (`0x4117f7`), when it is not only for backstabs. */
function shieldOn(s: Session): number {
  const shield = s.Combat_Shield;
  if (shield === '' || s.Combat_UseShieldForBS !== 0) return 0;
  const c = findCarried(s, shield);
  if (!c || (c.flags & CarriedFlag.Equipped) !== 0) return 0;
  c.flags |= CarriedFlag.Equipped;
  s.equipsPending += 1;
  s.equipping = shield.slice(0, 30);
  changing(s, State.Equipping, `Equipping shield ${shield} for normal combat`);
  send(s, `equip ${shield}\r`);
  return 1;
}
