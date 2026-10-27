/**
 * One whole snapshot of a character's readings, in a mudstats board's names
 * (its ingest specification, 2026-10-16). Whole every time rather than what
 * changed: while a character posts, the board stops asking it by telepath, so
 * whatever is not posted goes stale there.
 *
 * Our tracker's readings for what the realm prints (vitals off the prompt, the
 * stat sheet, the room, the pack); the experience as the Combat Stats card
 * shows it, since its baseline (its Reset, or the lap begun), where it had
 * been the engine's meter since the session began (2026-10-16); and the
 * MegaMUD engine's for what only it works out (the task, the path), as its
 * own `@status` and `@path` replies give them. A reading not known is left
 * out, which the board takes as no reading.
 */
import type { CharacterState } from '../../shared/character';
import { experienceOwed, experienceStanding } from '../../shared/experience';
import {
  clock,
  levelIn,
  onlineFor,
  ratePerHour,
  sinceCardBaseline,
  type CombatTally
} from '../../shared/tally';
import type { EngineStats } from '../session/MegaEngine';
import type { Reading } from './MudStatsApi';

/**
 * What the board is told the client is, beside its version: the version
 * field and the label a character's key is claimed under. Majordomo since the
 * rename (2026-10-25; reported as it from 2026-10-27, mudengine before).
 */
export const REPORTED_AS = 'Majordomo';

/** The Combat Stats card's scope: its baseline, the hour's floor it reads rates over, and now. */
export interface CardScope {
  baseline: CombatTally | null;
  rateFloorMs: number;
  now: number;
}

export function statsSnapshot(
  state: CharacterState,
  engine: EngineStats | null,
  version: string,
  card: CardScope
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
  // As the Combat Stats card reads them (`StatsCard`).
  const shown = sinceCardBaseline(state.tally, card.baseline);
  const perHour = ratePerHour(shown.experience, onlineFor(shown, card.now), card.rateFloorMs);
  const standing = experienceStanding(progress.level, progress.exp, progress.expTable);
  const owed = experienceOwed(progress.expNeeded, standing);
  number('exp_made', shown.experience);
  number('exp_needed', owed.value);
  number(
    'exp_needed_level',
    standing?.next ?? (progress.level === null ? null : progress.level + 1)
  );
  if (perHour !== null) out['exp_rate_hour'] = perHour;
  const eta = levelIn(owed.value, perHour);
  if (eta !== null) out['level_eta'] = clock(eta);

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
  text('megamud_version', `${REPORTED_AS} ${version}`);
  return out;
}
