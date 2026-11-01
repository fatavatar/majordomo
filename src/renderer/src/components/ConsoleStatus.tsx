import { memo } from 'react';

import RoundTimer, { type HeldRound } from './RoundTimer';
import { levelReading, rate, useExperienceView } from './ExperienceScope';
import { barOf } from './StableView';
import { t } from '../lib/i18n';
import type { CharacterState } from '@shared/character';
import type { VitalsUiConfig } from '@shared/config';
import type { SessionId } from '@shared/ipc';
import { clock } from '@shared/tally';

export interface ConsoleStatusProps {
  session: SessionId;
  character: CharacterState;
  round: HeldRound;
  thresholds: VitalsUiConfig;
}

/**
 * A line of its own along the foot of every console (2026-11-01): health and
 * mana as bars with their figures, the way through the level with the rate
 * and the time to it, and MegaMUD's round timer at the end, which had grown
 * out of the console's corner and off the window's status bar. Under each
 * console rather than once a window, as MegaMUD's status bar is under its
 * one, so every character in the Stable carries its own. The bars it draws
 * left the Vitals card and the Stable's status for it.
 */
function ConsoleStatus({ session, character, round, thresholds }: ConsoleStatusProps) {
  const { vitals, progress } = character;
  const hp = barOf(vitals.hp, vitals.hpMax, thresholds.hp);
  const mana = barOf(vitals.mana, vitals.manaMax, thresholds.mana);
  // The view the character's Vitals card has chosen, so the two agree.
  const view = useExperienceView(character, session);
  const reading = levelReading(progress, view.made ?? 0);
  const through = reading === null ? null : Math.min(1, reading.into / reading.span);
  return (
    <div className="console-status" aria-label={t('consoleStatus.label')}>
      <span className="console-status-vital">
        <span className="quiet">{t('stable.row.hp')}</span>
        <span className="stable-bar" data-kind="hp" data-level={hp.level}>
          <span style={{ width: hp.width }} />
        </span>
        <span className="stable-figure">{hp.text}</span>
      </span>
      {vitals.mana !== null && (
        <span className="console-status-vital">
          <span className="quiet">
            {vitals.manaType === 'KAI' ? t('stable.row.kai') : t('stable.row.mana')}
          </span>
          <span className="stable-bar" data-kind="mana" data-level={mana.level}>
            <span style={{ width: mana.width }} />
          </span>
          <span className="stable-figure">{mana.text}</span>
        </span>
      )}
      <span className="console-status-exp">
        <span className="quiet">{t('consoleStatus.exp')}</span>
        <span
          className="stable-bar"
          data-kind="exp"
          title={
            reading === null
              ? undefined
              : t('consoleStatus.through', {
                  into: reading.into.toLocaleString(),
                  span: reading.span.toLocaleString()
                })
          }
        >
          <span style={{ width: `${Math.round((through ?? 0) * 100)}%` }} />
        </span>
        <b className="console-status-rate">{rate(view.perHour)}</b>
        {reading !== null && (
          <span className="quiet">
            {t('consoleStatus.toLevel', {
              percent: Math.round((through ?? 0) * 100),
              next: reading.next
            })}
            {view.levelInMs !== null && ` · ${clock(view.levelInMs)}`}
          </span>
        )}
      </span>
      <RoundTimer round={round} />
    </div>
  );
}

export default memo(ConsoleStatus);
