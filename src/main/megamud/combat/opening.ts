/**
 * The opening attack: ours, not megamud.exe's (asked for 2026-10-22).
 *
 * MegaMUD sends one attack command for the whole of a fight
 * (`Combat.AttackCmd`), and the realm goes on swinging with it every round
 * without being told again. `Combat.OpenCmd` is the first attack sent at each
 * monster instead, made with `Combat.OpenWeapon` where one is named: a
 * character can open with `a` and bash for the rest, or open with a weapon of
 * its own. When the round it opened ends, the fight goes on as MegaMUD's
 * would, the normal weapon wielded and `AttackCmd` sent, the way the fight
 * goes on after a backstab (`script/run.ts`).
 *
 * Both blank, or the same as the normal attack and weapon, and nothing here
 * acts: the fight is MegaMUD's own.
 */
import { stricmp } from '../cstr';
import { findCarried } from '../items/inventory';
import { currentTarget, enemiesHere, findEntity } from '../room/entities';
import type { RoomEntity, Session } from '../Session';

/** The command the opening attack is made with: `OpenCmd`, else the normal attack. */
export function openingCommand(s: Session): string {
  return s.Combat_OpenCmd !== '' ? s.Combat_OpenCmd : s.Combat_AttackCmd;
}

/** Whether the opening differs from the rest of the fight, in its command or its weapon. */
function openingSetUp(s: Session): boolean {
  const command = stricmp(openingCommand(s), s.Combat_AttackCmd) !== 0;
  const weapon = s.Combat_OpenWeapon !== '' && s.Combat_OpenWeapon !== s.Combat_NrmWeapon;
  return command || weapon;
}

/** Whether the attack about to go at `e` is its opening: the first this character sends at it. */
export function opensOn(s: Session, e: RoomEntity): boolean {
  return openingSetUp(s) && e.opened === undefined;
}

/** The opening attack sent at `e`: it is marked, and its round is watched for its end. */
export function openingSent(s: Session, e: RoomEntity): void {
  e.opened = true;
  s.opening = 1;
}

/**
 * The weapon to hold now for the opening, or null where the fight's own
 * choice stands (`normalWeapon`): the opening weapon, carried, for an attack
 * about to open on the target or for the round it opened. A weapon that has
 * already had no effect here is left to the fight's own choice.
 */
export function openingWeapon(s: Session): string | null {
  const weapon = s.Combat_OpenWeapon;
  if (weapon === '' || !openingSetUp(s) || s.weaponNoEffect !== 0) return null;
  if (s.opening === 0) {
    const victim = s.target === '' ? currentTarget(s) : findEntity(s, s.target, 0);
    if (!victim || victim.opened !== undefined) return null;
  }
  return findCarried(s, weapon) ? weapon : null;
}

/**
 * A combat round ended (`combatRoundEnd`): the round the opening attack
 * began, once it has been fought, hands the fight on to `AttackCmd` and the
 * normal weapon, which the next attack due sends.
 */
export function openingRoundEnded(s: Session, blowSeen: number): void {
  if (s.opening === 0 || s.inCombat === 0 || blowSeen === 0) return;
  s.opening = 0;
  if (enemiesHere(s, 0) > 0) s.attackDue = 1;
}
