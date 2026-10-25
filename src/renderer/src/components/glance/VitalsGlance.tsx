import { Fragment, type ReactNode } from 'react';

import { KitBar, KitLine, compact } from '../kit';
import { ratio, vitalLevel, type CharacterState, type VitalThresholds } from '@shared/character';
import type { ExperienceStanding } from '@shared/experience';
import { t } from '../../lib/i18n';
import { levelWord } from '../../lib/vitals';
import type { ExperienceView } from '../ExperienceScope';

/** One vital as its bar, the figures inside it and the threshold band its fill wears. */
function VitalBar({
  value,
  max,
  unit,
  tone,
  thresholds
}: {
  value: number | null;
  max: number | null;
  unit: string;
  tone: 'life' | 'mana';
  thresholds: VitalThresholds;
}) {
  const fraction = ratio(value, max);
  const level = vitalLevel(value, max, thresholds);
  return (
    <KitBar
      fraction={fraction}
      label={unit}
      level={level}
      max={max === null ? undefined : max.toLocaleString()}
      tag={fraction === null ? levelWord(level) : `${Math.round(fraction * 100)}%`}
      tone={tone}
      value={value === null ? '—' : `${value.toLocaleString()} ${unit}`}
    />
  );
}

export interface VitalsGlanceProps {
  character: CharacterState;
  thresholds: { hp: VitalThresholds; mana: VitalThresholds };
  standing: ExperienceStanding | null;
  owed: { value: number | null; derived: boolean };
  /** The experience over the card's chosen view, and the rows that draw it. */
  view: ExperienceView;
  experience: ReactNode;
  afflicted: ReadonlyArray<{ word: string; title?: string }>;
}

/** `7h17`, or `45m` under the hour: how long, at a glance. */
function span(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * How far through the level being earned towards: from the threshold of the
 * highest level paid for to the next one's, by the table. Null where the
 * table holds neither row, which draws the empty track rather than a guess.
 */
function towards(
  exp: number | null,
  standing: ExperienceStanding | null,
  table: CharacterState['progress']['expTable']
): number | null {
  if (exp === null || standing === null || standing.next === null || table === null) return null;
  const from = table.rows.find((row) => row.level === standing.earned)?.experience;
  const to = table.rows.find((row) => row.level === standing.next)?.experience;
  if (from === undefined || to === undefined || to <= from) return null;
  return (exp - from) / (to - from);
}

/**
 * The Vitals face as `glance` lays it out (2026-10-25): each vital a bar
 * with its figures inside, one row instead of two; the afflictions on one
 * line; then three labelled rows, so each figure says what it is — the level,
 * and the level it could train to where the experience is already there;
 * the next level, as a bar of the way through it, what it still costs and
 * how long that is at the chosen view's rate; and then the experience over
 * that view — the session or the last hours — as both skins draw it. Short figures, each exact in its title. The name and class
 * are the tab rail's and the Self card's, so not here.
 */
export default function VitalsGlance({
  character,
  thresholds,
  standing,
  owed,
  view,
  experience,
  afflicted
}: VitalsGlanceProps) {
  const { vitals, progress } = character;
  const hours = view.levelInMs === null ? null : view.levelInMs / 3_600_000;
  const next = standing?.next ?? (progress.level === null ? null : progress.level + 1);
  const through = towards(progress.exp, standing, progress.expTable);
  const worked = t('cards.vitals.workedOut');
  return (
    <>
      <VitalBar
        max={vitals.hpMax}
        thresholds={thresholds.hp}
        tone="life"
        unit="HP"
        value={vitals.hp}
      />
      {vitals.mana !== null && (
        <VitalBar
          max={vitals.manaMax}
          thresholds={thresholds.mana}
          tone="mana"
          unit={vitals.manaType ?? 'MA'}
          value={vitals.mana}
        />
      )}
      {afflicted.length > 0 && (
        <KitLine>
          {afflicted.map(({ word, title }) => (
            <Fragment key={word}>
              <span className="chip bad" title={title}>
                {word}
              </span>
            </Fragment>
          ))}
        </KitLine>
      )}
      <dl className="readout glance-vitals">
        <dt>{t('cards.vitals.labels.level')}</dt>
        <dd>
          {progress.level ?? '—'}
          {standing !== null && standing.ahead && (
            <span
              className="glance-train"
              title={standing.earnedSource === 'database' ? worked : undefined}
            >
              {' '}
              {t('cards.vitals.glance.canTrain', { level: standing.earned })}
            </span>
          )}
        </dd>
        <dt>
          {next === null
            ? t('cards.vitals.labels.toLevel')
            : t('cards.vitals.toLevelFormat', { level: next })}
        </dt>
        <dd className="glance-next">
          <KitBar
            fraction={through}
            label={t('cards.vitals.glance.through')}
            tone="exp"
            value={through === null ? '' : `${Math.round(through * 100)}%`}
          />
          <span
            title={
              owed.value === null
                ? undefined
                : `${owed.value.toLocaleString()}${owed.derived ? ` ${worked}` : ''}`
            }
          >
            {owed.value === null
              ? '—'
              : t('cards.vitals.glance.toGo', { exp: compact(owed.value) })}
            {hours !== null && <span className="glance-eta"> · {span(hours)}</span>}
          </span>
        </dd>
      </dl>
      {experience}
    </>
  );
}
