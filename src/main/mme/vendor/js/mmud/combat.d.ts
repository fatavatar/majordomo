/** `mmud/combat.js`: MME's attack numbers. Ours, beside mudtool's copy. */
export const MUD: Readonly<{
  none: number;
  punch: number;
  kick: number;
  jumpkick: number;
  surprise: number;
  normal: number;
  bash: number;
  smash: number;
}>;
/** `char.attack.type`'s numbers. */
export const ATTACK: Readonly<{
  oneshot: number;
  weapon: number;
  spell: number;
  spellAny: number;
  martial: number;
  manual: number;
  bash: number;
  smash: number;
}>;
/** The calculators' maths (`frmSwingCalc`, `frmHitCalc`, `frmBSCalc`). */
export const EVIL: Readonly<{ criminal: number; fiend: number }>;
export function blankProfile(): Record<string, unknown>;
export function itemHasAbility(itemNum: number, abil: number): number;
export function weaponStats(
  item: number
): { accy: number; bsAccy: number } & Record<string, unknown>;
export function getHitMin(cls?: number): number;
export function getHitCap(): number;
export function getDodgeCap(cls?: number, softCap?: boolean): number;
export function classStealth(cls: number): number;
export function calcEncum(strength: number, encumBonus?: number): number;
export function calcEncumbrancePercent(current: number, max: number): number;
export function calcEnergyUsed(
  combat: number,
  level: number,
  attackSpeed: number,
  agl: number,
  str?: number,
  encum?: number,
  itemStr?: number,
  speedAdj?: number,
  isBackstab?: boolean
): number;
export function calcQuickAndDeadlyBonus(agl: number, eu: number, encum: number): number;
export function adjustSpeedForSlowness(speed: number): number;
export function swingTable(
  energy: number,
  rounds?: number
): Array<{ swings: number; energyLeft: number }>;
export function calcTrueAverage(
  swings: number,
  hitP: number,
  hitA: number,
  critP: number,
  critA: number,
  extraP: number,
  extraA: number
): number;
export function calculateBackstabAccuracy(
  stealth: number,
  agility: number,
  plusBSaccy: number,
  hasClassStealth: unknown,
  plusNormalAccy: number,
  level?: number,
  strength?: number,
  strReq?: number
): number;
export function backstabRange(
  weapon: number | Record<string, unknown>,
  opts: Record<string, unknown>
): {
  noBS?: boolean;
  min: number;
  max: number;
  avg: number;
  adj: { maxDmg: number; bsMin: number; bsMax: number; stealth: number };
} | null;
export function calculateAttackDefense(
  accy: number,
  ac: number,
  dodge: number,
  opts: Record<string, unknown>
): [number, number];
export function calculateAttack(
  profile: Record<string, unknown>,
  attackType: number,
  weapon?: number,
  opts?: Record<string, unknown>
): { roundTotal: number };
export function monsterDefense(monster: number | Record<string, unknown>): {
  ac: number;
  dodge: number;
  bsDefense: number;
  seeHidden: boolean;
  evil: boolean;
};
/** `CalcCombatRounds`: rounds to kill a monster (`nRTK`), to the next half round. */
export function calcCombatRounds(opts: {
  damageOut: number;
  mobHealth: number;
  numMobs?: number;
  mobDamage?: number;
  surpriseDamageOut?: number;
  firstRoundDamageOut?: number;
}): { nRTK: number };
/** `GetDamageOutput`: damage a round against a monster, or against `opts.vs` with no monster. */
export function damageVsMonster(
  profile: unknown,
  attack: unknown,
  monster: unknown,
  opts?: Record<string, unknown>
): { averageDamage: number; swings: number } & Record<string, unknown>;
