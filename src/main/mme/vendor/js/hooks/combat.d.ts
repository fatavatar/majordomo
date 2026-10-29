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
/** The EQ tab's `Attk`: the attack's damage a round against nothing, and its name. */
export function attkStat(): { text: string; tip: string; cls: string };
export function currentAttackName(desc?: boolean): string;
/** A weapon's attack with the Weapons tab's options (`AddWeapon2LV`'s `CalculateAttack`). */
export function weaponAttack(item: Row | number): { swings?: number; roundTotal?: number } | null;
/** A spell's Dmg and Heal columns. */
export function spellColumns(
  spell: Row,
  castLevel?: number,
  generic?: boolean
): {
  dmgText: string;
  healText: string;
  dmg: number;
  heal: number;
  dmgPerMana: number;
  healPerMana: number;
};
/** A monster's damage against the character, worked out where it can be. */
export function monsterDamageIn(n: number): { damage: number; vs: string; calculated: boolean };
/** How many monsters' damage has been worked out against the character (or the party). */
export function monsterDamageCalculated(partyInstead?: boolean): number;
/** One monster's blows simulated against the character (or the party): `CalculateMonsterDamageVsChar`. */
export function calcMonsterDamage(
  n: number,
  partyInstead?: boolean,
  rounds?: number
): { avg: number; max: number };
/** MME's party box (`txtMonsterLairFilter`, `txtMonsterDamageOUT`) as the character holds it. */
export function party(): {
  size: number;
  ac: number;
  dr: number;
  mr: number;
  dodge: number;
  hp: number;
  antiMagic: number;
  hpRegen: number;
  accy: number;
  swings: number;
  physical: number;
  spell: number;
};
