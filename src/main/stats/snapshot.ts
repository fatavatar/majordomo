/**
 * One whole snapshot of a character's readings, in a mudstats board's names
 * (its ingest specification, 2026-10-16). Whole every time rather than what
 * changed: while a character posts, the board stops asking it by telepath, so
 * whatever is not posted goes stale there.
 *
 * Our tracker's readings for what the realm prints (vitals off the prompt, the
 * stat sheet, the room, the pack) and the MegaMUD engine's for what only it
 * works out (the experience meter, the task, the path), as its own `@exp`,
 * `@status` and `@path` replies give them, so the board reads the same either
 * way. A reading not known is left out, which the board takes as no reading.
 */
import type { CharacterState } from '../../shared/character';
import type { EngineStats } from '../session/MegaEngine';
import type { Reading } from './MudStatsApi';

export function statsSnapshot(
  state: CharacterState,
  engine: EngineStats | null,
  version: string
): Record<string, Reading> {
  const out: Record<string, Reading> = {};
  const number = (name: string, value: number | null | undefined): void => {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      out[name] = Math.trunc(value);
    }
  };
  const text = (name: string, value: string | null | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed) out[name] = trimmed;
  };

  const { progress, vitals, inventory, room } = state;
  number('level', progress.level);
  number('exp', progress.exp);
  number('exp_made', engine?.expMade ?? progress.expThisSession);
  number('exp_needed', engine?.expNeeded ?? progress.expNeeded);
  number(
    'exp_needed_level',
    engine?.expNeededLevel ?? (progress.level === null ? null : progress.level + 1)
  );
  if (engine?.expPerHour !== null && engine?.expPerHour !== undefined) {
    out['exp_rate_hour'] = engine.expPerHour;
  }
  text('level_eta', engine?.levelEta);

  number('hp', vitals.hp);
  number('hp_max', vitals.hpMax);
  const kai = vitals.manaType === 'KAI';
  number(kai ? 'kai' : 'mana', vitals.mana);
  number(kai ? 'kai_max' : 'mana_max', vitals.manaMax);
  number('lives', progress.lives);

  number('wealth', inventory.wealth);
  if (inventory.wealth !== null) out['wealth_unit'] = 'copper';
  number('encumbrance', inventory.encumbrance);
  number('encumbrance_max', inventory.encumbranceMax);
  text('encumbrance_label', inventory.encumbranceWord);

  text('location', room.name);
  text(
    'exits',
    room.exits
      .map((exit) => (exit.note ? `${exit.note} ${exit.direction}` : exit.direction))
      .join(', ')
  );
  text('who_text', room.occupants.map((occupant) => occupant.name).join(', '));
  text('status_text', engine?.status);
  text('path_text', engine?.path);

  text('race', state.race);
  text('class', state.className);
  text('megamud_version', `mudengine ${version}`);
  return out;
}
