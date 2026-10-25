import type { ReactNode } from 'react';

import type { Direction } from '@shared/world';
import { t } from '../lib/i18n';
import { useSkin } from '../lib/skin';

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
 * which the fill wears. Atlas draws the same as a label, a pill track and the
 * figures after it (`unit` is the label, `HP`); the others put `unit` after
 * the value inside the bar.
 */
export function KitBar({
  value,
  unit,
  max,
  fraction,
  tag,
  tone,
  level,
  label,
  title
}: {
  value: ReactNode;
  unit?: string;
  max?: ReactNode;
  fraction: number | null;
  tag?: ReactNode;
  tone: KitTone;
  level?: string;
  /** What the bar measures, for a reader that cannot see it. */
  label: string;
  title?: string;
}) {
  const skin = useSkin();
  const shown = fraction === null ? null : Math.max(0, Math.min(1, fraction));
  const meter = {
    'aria-label': label,
    'aria-valuemax': 100,
    'aria-valuemin': 0,
    'aria-valuenow': shown === null ? undefined : Math.round(shown * 100),
    'data-level': level,
    'data-tone': tone,
    'data-unknown': shown === null ? 'true' : undefined,
    role: 'meter',
    title
  } as const;
  const of = max !== undefined && max !== null && <span className="kit-bar-of"> / {max}</span>;
  if (skin === 'atlas') {
    return (
      <div className="kit-bar kit-bar-row" {...meter}>
        {unit !== undefined && <span className="kit-bar-unit">{unit}</span>}
        <span className="kit-bar-track">
          <i className="kit-bar-fill" style={{ width: `${(shown ?? 0) * 100}%` }} />
        </span>
        <span className="kit-bar-figures">
          {value}
          {of}
        </span>
      </div>
    );
  }
  return (
    <div className="kit-bar" {...meter}>
      <i className="kit-bar-fill" style={{ width: `${(shown ?? 0) * 100}%` }} />
      <span className="kit-bar-text">
        <span>
          {value}
          {unit !== undefined && ` ${unit}`}
          {of}
        </span>
        {tag !== undefined && tag !== null && <span className="kit-bar-tag">{tag}</span>}
      </span>
    </div>
  );
}

/**
 * Concentric rings, the first outermost (Halo's vitals, 2026-10-25): each
 * filled to its share in its tone, the threshold band a vital is in its
 * colour, the figure in the middle. An unknown share draws its empty track.
 */
export function KitRings({
  rings,
  center,
  size = 64,
  label
}: {
  rings: ReadonlyArray<{ fraction: number | null; tone: KitTone; level?: string }>;
  center?: ReactNode;
  size?: number;
  label: string;
}) {
  const stroke = Math.max(3, Math.round(size / 11));
  return (
    <svg
      aria-label={label}
      className="kit-rings"
      height={size}
      role="img"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
    >
      {rings.map((ring, i) => {
        const r = size / 2 - stroke / 2 - i * (stroke + 3);
        const length = 2 * Math.PI * r;
        const shown = ring.fraction === null ? 0 : Math.max(0, Math.min(1, ring.fraction));
        return (
          <g data-level={ring.level} data-tone={ring.tone} key={i}>
            <circle
              className="kit-ring-track"
              cx={size / 2}
              cy={size / 2}
              r={r}
              strokeWidth={stroke}
            />
            <circle
              className="kit-ring-fill"
              cx={size / 2}
              cy={size / 2}
              r={r}
              strokeDasharray={`${shown * length} ${length}`}
              strokeWidth={stroke}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </g>
        );
      })}
      {center !== undefined && (
        <text
          className="kit-rings-center"
          x={size / 2}
          y={size / 2}
          dy="0.35em"
          textAnchor="middle"
        >
          {center}
        </text>
      )}
    </svg>
  );
}

/** A name's initials in a disc of its colour (Halo's people and monsters): `pirate ghost` is `PG`, `Damyr` is `D`. */
export function KitInitials({ name }: { name: string }) {
  const words = name.split(/\s+/).filter((word) => /^[\p{L}]/u.test(word));
  // Two words, their first letters; one, its first: `Damyr` is D, not DA.
  const initials =
    words.length >= 2 ? `${words[0]![0]}${words.at(-1)![0]}` : (words[0] ?? name).slice(0, 1);
  return (
    <span aria-hidden="true" className="kit-initials">
      {initials.toUpperCase()}
    </span>
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
  const skin = useSkin();
  return (
    <div className="kit-tiles">
      {cells.map((cell) => {
        const share =
          cell.share === undefined || cell.share === null
            ? null
            : Math.max(0, Math.min(1, cell.share));
        const band =
          share === null ? undefined : share >= 0.75 ? 'high' : share <= 0.3 ? 'low' : 'mid';
        // Halo's tile is a small ring filled to the same share, the figure inside it.
        if (skin === 'halo') {
          const r = 13;
          const length = 2 * Math.PI * r;
          return (
            <div
              className="kit-tile kit-tile-ring"
              data-band={band}
              key={cell.key}
              title={cell.title}
            >
              <svg aria-hidden="true" height={32} viewBox="0 0 32 32" width={32}>
                <circle className="kit-ring-track" cx={16} cy={16} r={r} strokeWidth={3} />
                {share !== null && (
                  <circle
                    className="kit-ring-fill"
                    cx={16}
                    cy={16}
                    r={r}
                    strokeDasharray={`${share * length} ${length}`}
                    strokeWidth={3}
                    transform="rotate(-90 16 16)"
                  />
                )}
                <text className="kit-rings-center" dy="0.35em" textAnchor="middle" x={16} y={16}>
                  {cell.value}
                </text>
              </svg>
              <small>{cell.label}</small>
            </div>
          );
        }
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
  const skin = useSkin();
  const state = (direction: Direction): string | undefined =>
    blocked.has(direction) ? 'blocked' : open.has(direction) ? 'open' : undefined;
  // Halo: the ways out as lettered keys, in the compass's reading order.
  if (skin === 'halo') {
    const order: Direction[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'u', 'd'];
    return (
      <div aria-label={label} className="kit-keys" role="img">
        {order
          .filter((direction) => state(direction) !== undefined)
          .map((direction) => (
            <span data-state={state(direction)} key={direction} title={names[direction]}>
              {direction.toUpperCase()}
            </span>
          ))}
      </div>
    );
  }
  // Atlas: a compass rose, each way out an arm lit from the centre.
  if (skin === 'atlas') {
    const arm: Partial<Record<Direction, number>> = {
      n: 0,
      ne: 45,
      e: 90,
      se: 135,
      s: 180,
      sw: 225,
      w: 270,
      nw: 315
    };
    return (
      <svg aria-label={label} className="kit-compass" role="img" viewBox="0 0 40 40">
        <circle className="kit-compass-ring" cx={20} cy={20} r={17} />
        {(Object.entries(arm) as Array<[Direction, number]>).map(([direction, angle]) => (
          <path
            d={angle % 90 === 0 ? 'M20 4 L23 20 L17 20 Z' : 'M20 8 L22 20 L18 20 Z'}
            data-state={state(direction)}
            key={direction}
            transform={`rotate(${angle} 20 20)`}
          >
            <title>{names[direction]}</title>
          </path>
        ))}
        <circle className="kit-compass-hub" cx={20} cy={20} r={2.2} />
        {(['u', 'd'] as const).map((direction) =>
          state(direction) === undefined ? null : (
            <text
              className="kit-compass-level"
              data-state={state(direction)}
              key={direction}
              textAnchor="middle"
              x={direction === 'u' ? 34 : 6}
              y={direction === 'u' ? 9 : 37}
            >
              {direction === 'u' ? '▲' : '▼'}
            </text>
          )
        )}
      </svg>
    );
  }
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
  const skin = useSkin();
  // Atlas: how far round the lap, as a ring with the stop in the middle.
  if (skin === 'atlas') {
    const r = 21;
    const length = 2 * Math.PI * r;
    const share = at === null || stops <= 0 ? 0 : (at + 1) / stops;
    return (
      <svg aria-label={label} className="kit-loop-ring" role="img" viewBox="0 0 50 50">
        <circle className="kit-ring-track" cx={25} cy={25} r={r} strokeWidth={5} />
        <circle
          className="kit-ring-fill"
          cx={25}
          cy={25}
          r={r}
          strokeDasharray={`${share * length} ${length}`}
          strokeWidth={5}
          transform="rotate(-90 25 25)"
        />
        <text className="kit-rings-center" dy="0.35em" textAnchor="middle" x={25} y={25}>
          {at === null ? '—' : `${at + 1}/${stops}`}
        </text>
      </svg>
    );
  }
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
