import { memo, useEffect, useMemo, useState } from 'react';

import { t } from '../lib/i18n';
import { ROUND_MS, type RoundTimer as Round, type RoundTone } from '@shared/roundTimer';

/** The round timer as last said by main, and when it was said (`performance.now()`). */
export interface HeldRound {
  timer: Round;
  at: number;
}

const TONE_TIP: Record<RoundTone, () => string> = {
  unsynced: () => t('statusRail.round.unsynced'),
  unsure: () => t('statusRail.round.unsure'),
  wait: () => t('statusRail.round.wait'),
  ready: () => t('statusRail.round.ready')
};

/** How often the seconds left are written again. */
const FIGURE_TICK_MS = 100;

/** How long the round has left at `now`, counted on from when it was said; null unsynced. */
function leftAt(round: HeldRound, now: number): number | null {
  const { nextInMs } = round.timer;
  if (nextInMs === null) return null;
  const left = (((nextInMs - (now - round.at)) % ROUND_MS) + ROUND_MS) % ROUND_MS;
  return left === 0 ? ROUND_MS : left;
}

/**
 * `0x49ae20`: the seconds left as MegaMUD writes them, whole seconds rounded
 * up over two seconds (`3.0`) and tenths under (`1.7`); `?` before rounds are
 * synced.
 */
function figureOf(left: number | null): string {
  if (left === null) return '?';
  if (left > 2000) return `${Math.min(Math.ceil(left / 1000), 5)}.0`;
  const tenths = Math.min(Math.floor(left / 100), 20);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/**
 * MegaMUD's round timer on the status rail (`0x4a9ff0`, 2026-10-31): the
 * seconds until the next combat round and a bar that runs down to it, in the
 * colour of what the timer knows: amber while the round's timing is not yet
 * trusted, blue once a spell has been cast this round (the next waits for the
 * round to turn; MegaMUD writes the figure bold), green while one may be cast.
 * Nothing before the rounds are found. MegaMUD's two Display settings hide
 * the figure and the bar.
 *
 * The bar runs down by itself, a CSS animation started a round's worth back
 * from what main last said, so nothing is drawn again for it; the figure is
 * written again a tenth of a second at a time. MegaMUD's own bar steps down a
 * block a second; this one shrinks smoothly.
 */
function RoundTimer({ round }: { round: HeldRound }) {
  const { tone, figure, bar } = round.timer;
  const synced = round.timer.nextInMs !== null;
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!figure || !synced) return;
    const timer = window.setInterval(() => setNow(performance.now()), FIGURE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [figure, synced]);
  // Begun a round's worth back from when it was told the round's end, once per telling.
  const delay = useMemo(() => {
    const left = leftAt(round, performance.now());
    return left === null ? 0 : left - ROUND_MS;
  }, [round]);
  if (!figure && !bar) return null;
  return (
    <span className="round-timer" data-tone={tone} title={TONE_TIP[tone]()}>
      {figure && <b>{figureOf(leftAt(round, now))}</b>}
      {bar && (
        <span aria-hidden="true" className="round-bar">
          {synced && (
            <span className="round-fill" key={round.at} style={{ animationDelay: `${delay}ms` }} />
          )}
        </span>
      )}
    </span>
  );
}

export default memo(RoundTimer);
