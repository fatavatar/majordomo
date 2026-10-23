/**
 * The flux tick monitor (`0x494c90`): on each mana reading, measure the tick
 * and ask for the mana regen to be recast when it is weak. See
 * docs/megamud/megamud-exe.md, *Health: the flux tick monitor*.
 */
import type { Session } from '../Session';

export function fluxMonitor(s: Session): void {
  if (
    s.skipTick === 0 &&
    s.lastTickAt !== 0 &&
    s.meditating === 0 &&
    s.mana < s.Player_MaxMana &&
    s.hp > 0
  ) {
    const tick = s.mana - s.manaPrev;
    if (tick > 0 || s.now - s.lastTickAt > 0x22) {
      s.lastTickAt = s.now;
      s.lastTick = tick;
      s.fluxRecast =
        s.manaRegen !== 0 && (tick < 0 || (s.Spells_FluxMin > 0 && tick < s.Spells_FluxMin))
          ? 1
          : 0;
    }
  } else {
    s.skipTick = 0;
    s.lastTickAt = s.now;
  }
}

/** `0x40db40`: whether `hp` is under `HpLogoff%` of the maximum. */
export function belowLogoff(s: Session, hp: number): number {
  if (s.Health_HpLogoffPct > 0 && s.Player_MaxHP > 0) {
    const line = Math.trunc((s.Player_MaxHP * s.Health_HpLogoffPct) / 100);
    if (line > 0 && hp < line) return 1;
  }
  return 0;
}
