import { memo, useState, type MouseEvent } from 'react';

import BentoCard, { type CardChrome } from './BentoCard';
import { ScopePicker, useExperienceView } from './ExperienceScope';
import { t } from '../lib/i18n';
import { sharesOf, timelineOf, type TimelineKind } from '../lib/timeline';
import type { CharacterState } from '@shared/character';
import type { SessionId } from '@shared/ipc';
import { ACTIVITY_KINDS, NO_ACTIVITY } from '@shared/tally';

export interface TimelineCardProps extends CardChrome {
  character: CharacterState;
  session: SessionId;
  /** The hours views restarted, as the Vitals card's reset does. */
  onExpReset(): void;
  /** The console brought to a moment; false where its backscroll holds nothing that old. */
  onJump(at: number): boolean;
}

/** One literal key a kind, for the coverage test. */
function kindWord(kind: TimelineKind): string {
  switch (kind) {
    case 'fight':
      return t('cards.timeline.kind.fight');
    case 'rest':
      return t('cards.timeline.kind.rest');
    case 'walk':
      return t('cards.timeline.kind.walk');
    case 'idle':
      return t('cards.timeline.kind.idle');
    case 'away':
      return t('cards.timeline.kind.away');
  }
}

const clockOf = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const minutesOf = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes < 60
    ? t('cards.timeline.minutes', { minutes })
    : t('cards.timeline.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
};

/**
 * What the character was doing, over the window the Vitals card has chosen
 * (2026-11-01, the card rethink's W5): a strip coloured by fighting, resting,
 * walking and idle, the stretches out of the realm left hatched, a mark for
 * each death and level, and each kind's share of the time. A click on the
 * strip brings the console's backscroll to that moment.
 */
function TimelineCard({ character, session, onExpReset, onJump, ...chrome }: TimelineCardProps) {
  const view = useExperienceView(character, session);
  const { tally } = character;
  const log = tally.activity ?? NO_ACTIVITY;
  const segments = timelineOf(log.spans, tally.away, tally.leftAt, view.from, view.now);
  const shares = sharesOf(segments);
  const span = Math.max(1, view.now - view.from);
  const at = (moment: number): string => `${((moment - view.from) / span) * 100}%`;
  const moments = log.moments.filter((moment) => moment.at >= view.from && moment.at <= view.now);
  const [missed, setMissed] = useState(false);

  const jump = (event: MouseEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setMissed(!onJump(view.from + fraction * span));
  };

  return (
    <BentoCard {...chrome} className="timeline-card" title={t('cards.timeline.title')}>
      <ScopePicker onReset={onExpReset} view={view} />
      {segments.length === 0 ? (
        <div className="empty">{t('cards.timeline.empty')}</div>
      ) : (
        <>
          {moments.length > 0 && (
            <div className="timeline-moments" aria-hidden="true">
              {moments.map((moment) => (
                <span
                  className="timeline-moment"
                  data-kind={moment.kind}
                  key={`${moment.kind}:${moment.at}`}
                  style={{ left: at(moment.at) }}
                  title={
                    moment.kind === 'death'
                      ? t('cards.timeline.died', { at: clockOf(moment.at), where: moment.note })
                      : t('cards.timeline.levelled', { at: clockOf(moment.at), level: moment.note })
                  }
                >
                  {moment.kind === 'death' ? '✕' : '▲'}
                </span>
              ))}
            </div>
          )}
          <div
            aria-label={t('cards.timeline.stripLabel')}
            className="timeline-strip"
            onClick={jump}
            role="img"
            title={t('cards.timeline.stripHint')}
          >
            {segments.map((segment) => (
              <span
                className="timeline-segment"
                data-kind={segment.kind}
                key={`${segment.from}:${segment.kind}`}
                style={{
                  left: at(segment.from),
                  width: `${((segment.to - segment.from) / span) * 100}%`
                }}
                title={`${kindWord(segment.kind)} ${clockOf(segment.from)}–${clockOf(segment.to)} (${minutesOf(segment.to - segment.from)})`}
              />
            ))}
          </div>
          <div className="timeline-axis">
            <span>{clockOf(view.from)}</span>
            <span>{t('cards.timeline.now')}</span>
          </div>
          <div className="timeline-legend">
            {ACTIVITY_KINDS.map((kind) => (
              <span data-kind={kind} key={kind}>
                <i aria-hidden="true" />
                {kindWord(kind)} {Math.round(shares[kind] * 100)}%
              </span>
            ))}
          </div>
          {missed && <span className="hint">{t('cards.timeline.notInBackscroll')}</span>}
        </>
      )}
    </BentoCard>
  );
}

export default memo(TimelineCard);
