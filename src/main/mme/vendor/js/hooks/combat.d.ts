/** `hooks/combat.js`: the weapon columns under Calc Combat, the Spells tab's vs MR. Ours, beside mudtool's copy. */
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
export function setSpellOpts(options: { calc?: boolean; antiMagic?: boolean }): void;
/** The character's illumination, which a room's light is read against. */
export function charIllumination(): number;
/** A lair's damage line, against the character. */
export function lairDamageLine(info: unknown): string;
