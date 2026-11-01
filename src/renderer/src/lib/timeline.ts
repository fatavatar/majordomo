/**
 * The Timeline card's arithmetic (2026-11-01, the card rethink's W5): what a
 * character was doing across a window, as segments to draw, cut where it was
 * out of the realm.
 */

import {
  ACTIVITY_KINDS,
  type ActivityKind,
  type ActivitySpan,
  type AwaySpell
} from '@shared/tally';

export type TimelineKind = ActivityKind | 'away';

export interface TimelineSegment {
  from: number;
  to: number;
  kind: TimelineKind;
}

/**
 * The window from `from` to `now` as segments: each span until the next, the
 * span already running at `from` included, then every stretch out of the
 * realm cut in on top -- `away`'s closed spells, and an open one from
 * `leftAt` while the character is still out. Nothing is drawn before the
 * first span: no record is not idle.
 */
export function timelineOf(
  spans: readonly ActivitySpan[],
  away: readonly AwaySpell[],
  leftAt: number | null,
  from: number,
  now: number
): TimelineSegment[] {
  if (now <= from) return [];
  let doing: TimelineSegment[] = [];
  spans.forEach((span, index) => {
    const start = Math.max(span.at, from);
    const end = Math.min(spans[index + 1]?.at ?? now, now);
    if (end > start) doing.push({ from: start, to: end, kind: span.kind });
  });
  const out = [...away];
  const lastSpan = spans.at(-1);
  // Out now: left after the last thing it did, and not back.
  if (leftAt !== null && (lastSpan === undefined || leftAt >= lastSpan.at)) {
    out.push({ from: leftAt, to: now });
  }
  for (const spell of out) {
    const start = Math.max(spell.from, from);
    const end = Math.min(spell.to, now);
    if (end <= start) continue;
    doing = doing.flatMap((segment) => {
      if (segment.to <= start || segment.from >= end) return [segment];
      const cut: TimelineSegment[] = [];
      if (segment.from < start) cut.push({ ...segment, to: start });
      if (segment.to > end) cut.push({ ...segment, from: end });
      return cut;
    });
    doing.push({ from: start, to: end, kind: 'away' });
  }
  return doing.sort((a, b) => a.from - b.from);
}

/** Each kind's share of the time in the realm the segments cover, in [0, 1]. */
export function sharesOf(segments: readonly TimelineSegment[]): Record<ActivityKind, number> {
  const spent = Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0])) as Record<
    ActivityKind,
    number
  >;
  let total = 0;
  for (const segment of segments) {
    if (segment.kind === 'away') continue;
    spent[segment.kind] += segment.to - segment.from;
    total += segment.to - segment.from;
  }
  for (const kind of ACTIVITY_KINDS) spent[kind] = total === 0 ? 0 : spent[kind] / total;
  return spent;
}
