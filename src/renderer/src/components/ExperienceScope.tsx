import { useRememberedChoice } from '../hooks/useRemembered';
import Icon from './Icon';
import { EXP_RATE_SETTLE_MS, type CharacterState } from '@shared/character';
import { experienceOwed, experienceStanding } from '@shared/experience';
import type { SessionId } from '@shared/ipc';
import {
  experienceWithin,
  levelIn,
  rateSeries,
  ratePerHour,
  STATS_WINDOW_HOURS,
  type AwaySpell,
  type ExperienceSample,
  type StatsGraph
} from '@shared/tally';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { tuning } from '../lib/tuning';

/*
 * The experience a character is making, as the Vitals card shows it
 * (2026-10-25): moved off the Combat Stats card, which keeps the fighting,
 * because Vitals is where the experience already lived. Over the session —
 * since the character entered the realm, which nothing resets — or over the
 * last hours, from the card's own reset where that is later. The reset is its
 * own (`CharacterState.expResetAt`): the Combat Stats card's leaves it, and
 * it leaves theirs.
 */

/** The views: the session, and the hour windows the rate graph has always offered. */
export const SCOPES: readonly string[] = ['session', ...STATS_WINDOW_HOURS.map(String)];

/** A rate an hour in the unit that keeps it readable, as MegaMUD's `k/hr` and `m/hr`. */
export function rate(value: number | null): string {
  if (value === null) return '—';
  const size = Math.abs(value);
  if (size >= 1_000_000)
    return t('cards.stats.ratePerHour', { value: `${(value / 1_000_000).toFixed(2)}M` });
  if (size >= 1_000)
    return t('cards.stats.ratePerHour', { value: `${(value / 1_000).toFixed(1)}k` });
  return t('cards.stats.ratePerHour', { value: value.toFixed(0) });
}

export interface ExperienceView {
  /** `session`, or the hours of the window as a string. */
  scope: string;
  choose(scope: string): void;
  /** Experience made in the view, or null where nothing can say. */
  made: number | null;
  /** An hour, over the time spent in the realm in the view. */
  perHour: number | null;
  /** How long the next level is at that rate. */
  levelInMs: number | null;
  /** What the next level still costs, and whether the client worked it out. */
  owed: { value: number | null; derived: boolean };
  /** The level being earned towards, where the table can say. */
  next: number | null;
  /** The stretch the view covers, for its graph. */
  from: number;
  now: number;
}

/**
 * The figures for the view the character's card has chosen, remembered per
 * character. Read once per render, so every figure is taken at one instant.
 */
export function useExperienceView(character: CharacterState, session: SessionId): ExperienceView {
  const [scope, choose] = useRememberedChoice(session, 'vitals-exp-scope', SCOPES, 'session');
  const { progress, tally, expResetAt } = character;
  const now = Date.now();
  const standing = experienceStanding(progress.level, progress.exp, progress.expTable);
  const owed = experienceOwed(progress.expNeeded, standing);
  let made: number | null;
  let perHour: number | null;
  let from: number;
  if (scope === 'session') {
    from = progress.realmEnteredAt ?? now;
    const elapsed = Math.max(0, now - from);
    made = progress.expThisSession;
    // Meaningless for the first couple of minutes: forty in ten seconds is a rate nobody earns.
    perHour = elapsed < EXP_RATE_SETTLE_MS || made === 0 ? null : (made / elapsed) * 3_600_000;
  } else {
    const window = now - Number(scope) * 3_600_000;
    const within = experienceWithin(tally, Math.max(window, expResetAt ?? window), now);
    from = within?.from ?? Math.max(window, expResetAt ?? window);
    made = within?.made ?? null;
    perHour =
      within === null ? null : ratePerHour(within.made, within.presentMs, tuning().rateFloorMs);
  }
  return {
    scope,
    choose,
    made,
    perHour,
    levelInMs: levelIn(owed.value, perHour),
    owed,
    next: standing?.next ?? null,
    from,
    now
  };
}

/**
 * Session or the last hours, as a row of small keys, and the reset beside
 * them where an hours view is chosen: it restarts the hours views and leaves
 * the session alone, so it is not offered where it would do nothing.
 */
export function ScopePicker({ view, onReset }: { view: ExperienceView; onReset(): void }) {
  return (
    <div className="exp-scope" role="group" aria-label={t('cards.vitals.scope.label')}>
      {SCOPES.map((scope) => (
        <button
          aria-pressed={view.scope === scope}
          className="chip toggle"
          data-on={view.scope === scope ? 'true' : 'false'}
          key={scope}
          onClick={() => view.choose(scope)}
          onMouseDown={keepFocus}
          type="button"
        >
          {scope === 'session'
            ? t('cards.vitals.scope.session')
            : t('cards.vitals.scope.hours', { hours: Number(scope) })}
        </button>
      ))}
      {view.scope !== 'session' && (
        <button
          aria-label={t('cards.vitals.scope.reset')}
          className="card-action exp-scope-reset"
          onClick={onReset}
          onMouseDown={keepFocus}
          title={t('cards.vitals.scope.reset')}
          type="button"
        >
          <Icon name="reset" />
        </button>
      )}
    </div>
  );
}

export interface LevelReading {
  next: number;
  into: number;
  span: number;
  over: number;
  made: number;
}

/**
 * Where the character stands in its level, off the experience table.
 *
 * `into` is what it has past the level's own threshold and `span` what the
 * next one costs from there; past the next threshold `over` is the surplus,
 * which is a banked level the trainer has not been asked for. `made` is the
 * view's own experience, drawn as the band it accounts for.
 */
export function levelReading(
  progress: CharacterState['progress'],
  made: number
): LevelReading | null {
  const { level, exp, expTable } = progress;
  if (level === null || exp === null || expTable === null) return null;
  const rowAt = (which: number): number | null =>
    expTable.rows.find((row) => row.level === which)?.experience ?? null;
  const base = rowAt(level) ?? (level <= 1 ? 0 : null);
  const top = rowAt(level + 1);
  if (base === null || top === null || top <= base) return null;
  const into = Math.max(0, exp - base);
  const span = top - base;
  return { next: level + 1, into, span, over: Math.max(0, into - span), made: Math.max(0, made) };
}

/**
 * The level meter. The scale is the larger of the way into the level and the
 * level's span, so a character past the threshold fills the whole track, the
 * 100% mark moves left to where the span ends and the overage is tinted past
 * it. The band inside the fill is the view's share.
 */
export function LevelMeter({ reading }: { reading: LevelReading }) {
  const scale = Math.max(reading.into, reading.span, 1);
  const pct = (value: number): number => Math.max(0, Math.min(100, (value / scale) * 100));
  const fill = pct(reading.into);
  const mark = pct(reading.span);
  const mineFrom = pct(Math.max(0, reading.into - reading.made));
  const percent = Math.round((reading.into / reading.span) * 100);
  return (
    <div className="stats-level">
      <div className="meter exp-meter" data-level="ok">
        <div className="fill" style={{ width: `${fill}%` }} />
        {reading.made > 0 && (
          <span className="mine" style={{ left: `${mineFrom}%`, width: `${fill - mineFrom}%` }} />
        )}
        {reading.over > 0 && (
          <>
            <span className="over" style={{ left: `${mark}%`, width: `${100 - mark}%` }} />
            <span className="mark" style={{ left: `${mark}%` }} />
          </>
        )}
        <span className="meter-label">
          {t('cards.stats.percent', { value: String(percent) })}
          {reading.over > 0 && (
            <span className="meter-state">
              {t('cards.stats.levelOver', { over: reading.over.toLocaleString() })}
            </span>
          )}
        </span>
      </div>
      <span className="hint">
        {t('cards.stats.levelFigure', { percent, next: reading.next })}
        {' · '}
        {t('cards.stats.levelMade', { made: reading.made.toLocaleString() })}
      </span>
    </div>
  );
}

/**
 * The rate over the view, one bar or point per bin, the view's own rate ruled
 * across it. Drawn from `CombatTally.samples`; a bin before the first sample
 * is left blank rather than drawn as a rate of nothing.
 */
export function RateGraph({
  samples,
  away,
  leftAt,
  from,
  now,
  graph,
  current,
  label
}: {
  samples: readonly ExperienceSample[];
  away: readonly AwaySpell[];
  leftAt: number | null;
  from: number;
  now: number;
  graph: StatsGraph;
  current: number | null;
  label: string;
}) {
  const bins = tuning().statsGraphBins;
  // A stretch away still running reaches to now: a character off the realm
  // is drawn as off it, not as earning nothing.
  const spells = leftAt === null ? away : [...away, { from: leftAt, to: now }];
  const series = rateSeries(samples, from, now, bins, spells);
  const known = series.filter((value): value is number => value !== null);
  const head = (
    <div className="stats-graph-head">
      <span>{label}</span>
      {current !== null && <span>{t('cards.stats.graphNow', { rate: rate(current) })}</span>}
    </div>
  );
  if (known.length === 0) {
    return (
      <div className="stats-graph">
        {head}
        <span className="hint">{t('cards.stats.graphEmpty')}</span>
      </div>
    );
  }
  const top = Math.max(...known, current ?? 0, 1);
  const height = 36;
  const width = 100;
  const step = width / series.length;
  const y = (value: number): number => height - 2 - (value / top) * (height - 4);
  const points = series
    .map((value, index) => (value === null ? null : `${index * step + step / 2},${y(value)}`))
    .filter((point): point is string => point !== null)
    .join(' ');
  return (
    <div className="stats-graph">
      {head}
      <svg aria-hidden="true" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
        {graph === 'bars' ? (
          series.map((value, index) =>
            value === null ? null : (
              <rect
                className="bar"
                height={height - y(value)}
                key={index}
                width={Math.max(0.2, step - 0.6)}
                x={index * step + 0.3}
                y={y(value)}
              />
            )
          )
        ) : (
          <polyline className="line" points={points} />
        )}
        {current !== null && (
          <line className="now" x1={0} x2={width} y1={y(current)} y2={y(current)} />
        )}
      </svg>
    </div>
  );
}
