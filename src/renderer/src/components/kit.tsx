import type { ReactNode } from 'react';

import type { Direction } from '@shared/world';
import { t } from '../lib/i18n';

/**
 * The shared pieces a skin lays a card out from (2026-10-25), where it lays
 * the card out its own way (`shared/skins.ts`, `glance` first). Each is the
 * smallest thing two cards say the same way — a bar that carries its own
 * figures, a bank of tiles filled to where each stands, a strip of a loop's
 * stops, a line of figures — drawn in `styles/kit.css`, which a skin's own
 * stylesheet restyles.
 *
 * Tones name what a figure is about rather than a hue: `life`, `mana`,
 * `load`, `exp`, `threat`, `gold`, `plain`. Each maps to the colour theme's
 * own token, which is how every theme works under every skin.
 */
export type KitTone = 'life' | 'mana' | 'load' | 'exp' | 'threat' | 'gold' | 'plain';

/** A whole number short, `21.1M`, for a line of figures; the exact one goes in its title. */
export function compact(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: Math.abs(value) < 1000 ? 0 : 1
  }).format(value);
}

/**
 * How full something is, as a bar with its own figures in it: the value and
 * what it is out of at the left, the share (or the state, where `tag` says)
 * at the right. A null fraction draws the empty track, which is how an
 * unknown reads, never as zero; `level` is the threshold band a vital is in,
 * which the fill wears.
 */
export function KitBar({
  value,
  max,
  fraction,
  tag,
  tone,
  level,
  label,
  title
}: {
  value: ReactNode;
  max?: ReactNode;
  fraction: number | null;
  tag?: ReactNode;
  tone: KitTone;
  level?: string;
  /** What the bar measures, for a reader that cannot see it. */
  label: string;
  title?: string;
}) {
  const shown = fraction === null ? null : Math.max(0, Math.min(1, fraction));
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={shown === null ? undefined : Math.round(shown * 100)}
      className="kit-bar"
      data-level={level}
      data-tone={tone}
      data-unknown={shown === null ? 'true' : undefined}
      role="meter"
      title={title}
    >
      <i className="kit-bar-fill" style={{ width: `${(shown ?? 0) * 100}%` }} />
      <span className="kit-bar-text">
        <span>
          {value}
          {max !== undefined && max !== null && <span className="kit-bar-of"> / {max}</span>}
        </span>
        {tag !== undefined && tag !== null && <span className="kit-bar-tag">{tag}</span>}
      </span>
    </div>
  );
}

/** A line of short figures and words, wrapping where it must: what a stack of readout rows said, in one breath. */
export function KitLine({ children }: { children: ReactNode }) {
  return <div className="kit-line">{children}</div>;
}

/** A figure in a line: its value bright, what it is quiet beside it; `push` sends it and what follows to the right edge. */
export function KitFigure({
  value,
  unit,
  tone,
  title,
  push
}: {
  value: ReactNode;
  unit?: ReactNode;
  tone?: KitTone;
  title?: string;
  push?: boolean;
}) {
  return (
    <span
      className="kit-figure"
      data-push={push ? 'true' : undefined}
      data-tone={tone}
      title={title}
    >
      <b>{value}</b>
      {unit !== undefined && unit !== null && <span>{unit}</span>}
    </span>
  );
}

/** A level as a small badge, for a line saying where a character stands. */
export function KitLevel({ level, title }: { level: number | null; title?: string }) {
  return (
    <span className="kit-level" title={title}>
      {level ?? '—'}
    </span>
  );
}

/** How many times a folded line or name stands for: `×3`. Nothing for one. */
export function KitCount({ count }: { count: number }) {
  if (count < 2) return null;
  return <span className="kit-count">{t('kit.count', { count })}</span>;
}

/**
 * A bank of tiles, one figure each, every tile filled from the bottom to
 * where its figure stands in the range it can have (a race's, for an
 * attribute), so the high and the low read before a digit does. A tile whose
 * range is unknown is not filled: a fill says a range was known.
 */
export function KitTiles({
  cells
}: {
  cells: ReadonlyArray<{
    key: string;
    label: ReactNode;
    value: ReactNode;
    share?: number | null;
    title?: string;
  }>;
}) {
  return (
    <div className="kit-tiles">
      {cells.map((cell) => {
        const share =
          cell.share === undefined || cell.share === null
            ? null
            : Math.max(0, Math.min(1, cell.share));
        const band =
          share === null ? undefined : share >= 0.75 ? 'high' : share <= 0.3 ? 'low' : 'mid';
        return (
          <div className="kit-tile" data-band={band} key={cell.key} title={cell.title}>
            {share !== null && (
              <i className="kit-tile-fill" style={{ height: `${share * 100}%` }} />
            )}
            <small>{cell.label}</small>
            <b>{cell.value}</b>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Short labelled figures two to a line, label quiet and figure bright: a
 * sheet's skills, where a column of them was a card's height. A figure with
 * no range to stand in gets no bar; only the label and the number.
 */
export function KitPairs({
  cells
}: {
  cells: ReadonlyArray<{ key: string; label: ReactNode; value: ReactNode; title?: string }>;
}) {
  return (
    <dl className="kit-pairs">
      {cells.map((cell) => (
        <div className="kit-pair" key={cell.key} title={cell.title}>
          <dt>{cell.label}</dt>
          <dd>{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A quiet sentence closing a card: what is folded away, or what has nothing to say. */
export function KitAside({ children }: { children: ReactNode }) {
  return <div className="kit-aside">{children}</div>;
}

/** The compass, in the rose's reading order, the middle cell the room itself. */
const ROSE: ReadonlyArray<Direction | null> = ['nw', 'n', 'ne', 'w', null, 'e', 'sw', 's', 'se'];

/**
 * A room's ways out as a rose: the eight compass cells lit where there is an
 * exit, amber where it is blocked, and up and down as two pips beside it —
 * the row of direction chips, in the space of a glyph. Each lit cell's
 * direction is its title.
 */
export function KitRose({
  open,
  blocked,
  label,
  names
}: {
  open: ReadonlySet<Direction>;
  blocked: ReadonlySet<Direction>;
  label: string;
  names: Record<Direction, string>;
}) {
  const state = (direction: Direction): string | undefined =>
    blocked.has(direction) ? 'blocked' : open.has(direction) ? 'open' : undefined;
  return (
    <div aria-label={label} className="kit-rose" role="img">
      <div className="kit-rose-compass">
        {ROSE.map((direction, i) =>
          direction === null ? (
            <i className="kit-rose-here" key={i} />
          ) : (
            <i
              data-state={state(direction)}
              key={direction}
              title={state(direction) === undefined ? undefined : names[direction]}
            />
          )
        )}
      </div>
      <div className="kit-rose-levels">
        {(['u', 'd'] as const).map((direction) => (
          <i
            data-state={state(direction)}
            key={direction}
            title={state(direction) === undefined ? undefined : names[direction]}
          >
            {direction === 'u' ? '▲' : '▼'}
          </i>
        ))}
      </div>
    </div>
  );
}

/**
 * A loop's or a walk's stops as a strip of cells: those passed, the one the
 * character is at, and those still ahead, each one's name its title. `at` is
 * zero-based; null for none.
 */
export function KitTrack({
  stops,
  at,
  label,
  names
}: {
  stops: number;
  at: number | null;
  label: string;
  names?: readonly string[];
}) {
  const cells = Array.from({ length: Math.max(0, stops) }, (_, i) =>
    at === null ? 'ahead' : i < at ? 'done' : i === at ? 'at' : 'ahead'
  );
  return (
    <div aria-label={label} className="kit-track" role="img">
      {cells.map((state, i) => (
        <i className="kit-track-stop" data-state={state} key={i} title={names?.[i]} />
      ))}
    </div>
  );
}
