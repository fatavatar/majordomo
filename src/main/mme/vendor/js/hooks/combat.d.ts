/** `hooks/combat.js`: the weapon columns under Calc Combat. Ours, beside mudtool's copy. */
import type { Row } from '../db';
export function weaponMin(item: Row): number;
export function weaponMax(item: Row): number;
export function weaponSpeed(item: Row): number;
export function setWeaponOpts(options: {
  calc?: boolean;
  attack?: number;
  fast?: boolean;
  minDmg?: number;
}): void;
