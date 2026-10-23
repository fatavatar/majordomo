/**
 * How a MegaMUD setting is named on the ported session: as the decompiled
 * session struct names it, `Section_Key` with `%` spelled `Pct` and anything
 * else that cannot be in a name spelled `_` (`Health.HpFull%` is
 * `Health_HpFullPct`, `Auto-roam.AutoMove` is `Auto_roam_AutoMove`). The same
 * rule names the struct's fields in the Ghidra project, so a line of the
 * decompile and a line of the port say the same thing.
 */
import type { SettingDef } from '../../shared/megamud/schema';
import type { MegaSettings } from '../../shared/megamud/settings';

/** Keys the loader only falls back to; their value lands in the newer key. */
const LEGACY = new Set(['Combat.ActiveProfile', 'Party.PartyHeal']);

/** The field a setting is kept in, or null for one the engine never reads. */
export function fieldName(def: SettingDef): string | null {
  if (def.kind === 'rect' || LEGACY.has(`${def.section}.${def.key}`)) return null;
  return `${def.section}_${def.key}`.replace(/%/g, 'Pct').replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Copies a character's settings onto the session's fields, as the loader
 * fills the struct (`0x449aa0`).
 */
export function applySettings(
  target: object,
  settings: MegaSettings,
  defs: readonly SettingDef[]
): void {
  const fields = target as Record<string, number | string>;
  for (const def of defs) {
    const name = fieldName(def);
    if (!name) continue;
    const value = settings.live[def.section]?.[def.key];
    if (value !== undefined) fields[name] = value;
  }
}
