/** `mmud/monsterattack.js`: `frmMonsterAttackSim`. Ours, beside mudtool's copy. */
export interface MonsterSim {
  numberOfRounds: number;
  totalAttacks: number;
  totalDamage: number;
  maxRoundDamage: number;
  averageDamagePhys: number;
  averageDamageSpell: number;
  combatLog: string;
  atk: Array<{ name: string }>;
  run(): void;
  getMaxDamage(): number;
  results(): Array<{
    name: string;
    trueChance: number;
    avgHit: number;
    hitPct: number;
    dmgResistPct: number;
    resistDodgePct: number;
  } | null>;
}
export function createMonsterSim(
  monster: number,
  defenses?: Record<string, unknown>,
  opts?: Record<string, unknown>
): MonsterSim;
