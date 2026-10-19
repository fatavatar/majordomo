/**
 * The map's drawing, in one place (2026-10-18): the shapes, marks and bars
 * every map in the client draws with — the Map card, the route panel, the
 * loop builder and MMUD Explorer's Rooms map — in mudmaps' style
 * (`../mudmaps_pretty`, `mudmaps/svg.py`), which grew out of this map's own
 * and improved on it. Colour is the stylesheet's, by class and `data-*`, so a
 * theme paints all of them alike.
 *
 * In map units: rooms sit `MAP_CELL` (10) apart and a room's radius is the
 * tuning file's `mapRoomRadius` (3), as in mudmaps.
 *
 * - A room is a rounded square; a way up or down is the same square in its
 *   own colour; somebody living there puts a pip in it, and a room that
 *   answers a command a ring.
 * - A shop is a circle, lettered for a temple, tavern, inn or trainer; a bank
 *   is the circle with a `$`; a lair is a diamond, and a lettered room that is
 *   a lair as well wears the diamond on its corner.
 * - A corridor is a thin line, dashed where something stands in it, with a
 *   bar across its middle in the tone of what that is — a trap's is a
 *   triangle.
 * - Up and down are chevrons by the room's right shoulder, a room command
 *   that moves you a portal ring off its left, and a way out a straight line
 *   cannot draw an arrow off the room the way it goes.
 */
import type { ReactNode } from 'react';

import type { Direction } from '@shared/world';

/** How far a glyph sits from its room, in room radii and units, as mudmaps places them. */
const GAP = {
  chevron: 2.6,
  chevronStep: 3.4,
  chevronRise: 1.9,
  portal: 3,
  portalStep: 3.6,
  arrow: 3.2
};

/** The kinds of room a map draws, by shape and colour. */
export type GlyphKind = 'room' | 'stairs' | 'shop' | 'bank' | 'lair' | 'npc' | 'cmd';

/** A room's shape: `map-shape`, which the stylesheet colours by the group's `data-kind`. */
export function RoomShape({
  kind,
  letter,
  x,
  y,
  r
}: {
  kind: GlyphKind;
  letter?: string | undefined;
  x: number;
  y: number;
  r: number;
}): ReactNode {
  if (kind === 'bank')
    return (
      <>
        <circle className="map-shape" cx={x} cy={y} r={r + 0.4} />
        <text className="map-sym map-bank" textAnchor="middle" x={x} y={y + 1.15}>
          $
        </text>
      </>
    );
  if (kind === 'shop')
    return (
      <>
        <circle className="map-shape" cx={x} cy={y} r={r} />
        {letter !== undefined && (
          <text className="map-sym" textAnchor="middle" x={x} y={y + 1.1}>
            {letter}
          </text>
        )}
      </>
    );
  if (kind === 'lair') {
    const d = r + 0.6;
    return (
      <polygon
        className="map-shape"
        points={`${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}`}
      />
    );
  }
  const square = (
    <rect className="map-shape" height={r * 2} rx={1.1} width={r * 2} x={x - r} y={y - r} />
  );
  if (kind === 'npc')
    return (
      <>
        {square}
        <circle className="map-pip" cx={x} cy={y} r={1.1} />
      </>
    );
  if (kind === 'cmd')
    return (
      <>
        {square}
        <circle className="map-ring" cx={x} cy={y} r={1.3} />
      </>
    );
  return square;
}

/** A lettered room that is a lair as well: the lair's diamond on its corner. */
export function LairBadge({ x, y, r }: { x: number; y: number; r: number }): ReactNode {
  const bx = x + r;
  const by = y - r;
  return (
    <polygon
      className="map-lairbadge"
      points={`${bx},${by - 1.3} ${bx + 1.3},${by} ${bx},${by + 1.3} ${bx - 1.3},${by}`}
    />
  );
}

/**
 * What stands in a corridor, by the tone it is drawn in (mudmaps' `REQ_TONE`):
 * a door to open, a key it wants, a way hidden or opened by a word, an item
 * or a lever, a toll, a trap, a gate on level, class, race or standing, and a
 * spell it casts on whoever walks it.
 */
export type BarTone = 'door' | 'key' | 'hidden' | 'toll' | 'trap' | 'gate' | 'cast';

const TONES: Record<string, BarTone> = {
  door: 'door',
  key: 'key',
  hidden: 'hidden',
  text: 'hidden',
  item: 'hidden',
  timed: 'hidden',
  unknown: 'hidden',
  toll: 'toll',
  trap: 'trap',
  level: 'gate',
  class: 'gate',
  race: 'gate',
  alignment: 'gate',
  ability: 'gate',
  cast: 'cast',
  spell: 'cast'
};

/** A requirement's kind as the tone its bar is drawn in. */
export function toneOf(kind: string): BarTone {
  return TONES[kind] ?? 'hidden';
}

/**
 * The bar across a corridor's middle, at right angles to it, or a trap's
 * triangle, upright whichever way the corridor runs.
 */
export function Bar({
  tone,
  x1,
  y1,
  x2,
  y2
}: {
  tone: BarTone;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): ReactNode {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  if (tone === 'trap')
    return (
      <polygon
        className="map-bar"
        data-tone={tone}
        points={`${mx},${my - 1.6} ${mx + 1.6},${my + 1.2} ${mx - 1.6},${my + 1.2}`}
      />
    );
  const along = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
  const nx = Math.cos(along) * 2.1;
  const ny = Math.sin(along) * 2.1;
  return (
    <line
      className="map-bar"
      data-tone={tone}
      x1={mx - nx}
      x2={mx + nx}
      y1={my - ny}
      y2={my + ny}
    />
  );
}

/** Where a chevron sits by its room: the right shoulder, up above and down below, stacked outward. */
export function chevronAt(x: number, y: number, r: number, up: boolean, slot = 0) {
  return {
    x: x + r + GAP.chevron + slot * GAP.chevronStep,
    y: up ? y - GAP.chevronRise : y + GAP.chevronRise
  };
}

/** An up or down chevron centred on a point. */
export function Chevron({ x, y, up }: { x: number; y: number; up: boolean }): ReactNode {
  const s = up ? -1 : 1;
  return (
    <path
      className="map-glyph map-chev"
      d={`M ${x - 1.5} ${y - s * 0.7} L ${x} ${y + s * 0.8} L ${x + 1.5} ${y - s * 0.7}`}
    />
  );
}

/**
 * Where a portal sits by its room: off its left, the second above it and the
 * third below, in the gap before the next room (2026-10-19). Stacked outward
 * as mudmaps stacks them, a room with three — Jael's, since the realm's
 * conversations became teleports — put its third ring on the room beside it.
 */
export function portalAt(x: number, y: number, r: number, slot = 0) {
  const row = slot === 0 ? 0 : (slot % 2 === 1 ? -1 : 1) * Math.ceil(slot / 2);
  return { x: x - r - GAP.portal, y: y + row * GAP.portalStep };
}

/** A room command that moves you: a dashed ring with a dot in it. */
export function Portal({ x, y }: { x: number; y: number }): ReactNode {
  return (
    <>
      <circle className="map-glyph map-portal" cx={x} cy={y} r={1.5} />
      <circle className="map-portal-dot" cx={x} cy={y} r={0.55} />
    </>
  );
}

/** Which way each compass direction points, in map units (south is down). */
const POINTS: Partial<Record<Direction, [number, number]>> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1]
};

/** Where an exit's arrow sits by its room: off it the way the exit goes. */
export function exitArrowAt(x: number, y: number, r: number, direction: Direction) {
  const [vx, vy] = POINTS[direction] ?? [1, 0];
  const length = Math.hypot(vx, vy);
  const ux = vx / length;
  const uy = vy / length;
  return { x: x + ux * (r + GAP.arrow), y: y + uy * (r + GAP.arrow), ux, uy };
}

/** An arrowhead centred on a point, pointing along `(ux, uy)`. */
export function Arrow({
  x,
  y,
  ux,
  uy
}: {
  x: number;
  y: number;
  ux: number;
  uy: number;
}): ReactNode {
  const size = 1.7;
  const tip = [x + ux * size, y + uy * size];
  const back = [x - ux * size * 0.6, y - uy * size * 0.6];
  const w = size * 0.75;
  const points = [
    tip,
    [back[0]! - uy * w, back[1]! + ux * w],
    [back[0]! + uy * w, back[1]! - ux * w]
  ]
    .map((p) => `${round(p[0]!)},${round(p[1]!)}`)
    .join(' ');
  return <polygon className="map-glyph" points={points} />;
}

/** Two decimals is under a thousandth of a room and keeps the DOM readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
