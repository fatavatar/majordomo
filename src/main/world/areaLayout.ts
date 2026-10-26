/**
 * An area's rooms on a grid — mudmaps' `layout.py`, ported (2026-10-26).
 *
 * The realm has no coordinates, only exits, and a MUD is not Euclidean, so
 * the layout is made the way a person maps by hand:
 *
 * 1. **Out from a seed**, breadth first, each neighbour one step in its exit's
 *    direction. Up and down go to the level above or below at the same x,y —
 *    or up to `MAX_STACK` levels on where that square is taken — so a
 *    staircase stays in its column. A taken square on the same level is not
 *    stepped over; that room is left for later.
 * 2. **Each leftover piece laid out on its own**, then packed into the frame as
 *    near as it fits to where its tie to the rest says it belongs, never
 *    touching another room. The exits that no longer line up are drawn as
 *    arrows (`MapArrow`).
 *
 * One frame for every level, so the level above is drawn over the one below
 * and a staircase lines up across them. `localMap` is the other layout: out
 * from the character, a radius at a time, for the loop builder and the route
 * panel.
 */
import type { Direction, RoomId } from '../../shared/world';
import type { WorldGraph } from './WorldGraph';

/** A room's square: east, south, up. */
export interface Spot {
  x: number;
  y: number;
  z: number;
}

const VEC: Record<Direction, [number, number, number]> = {
  n: [0, -1, 0],
  s: [0, 1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
  ne: [1, -1, 0],
  nw: [-1, -1, 0],
  se: [1, 1, 0],
  sw: [-1, 1, 0],
  u: [0, 0, 1],
  d: [0, 0, -1]
};

const OPPOSITE: Record<Direction, Direction> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
  u: 'd',
  d: 'u'
};

const ORDER: Direction[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd'];

/** Levels a way up or down may skip to stay in its column. */
const MAX_STACK = 3;

/** How far a piece is moved, at most, looking for room near where it belongs. */
const SPIRAL_R = 40;

/** The offsets a piece is tried at, nearest first. */
const SPIRAL: ReadonlyArray<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let dx = -SPIRAL_R; dx <= SPIRAL_R; dx += 1) {
    for (let dy = -SPIRAL_R; dy <= SPIRAL_R; dy += 1) out.push([dx, dy]);
  }
  return out.sort(
    ([ax, ay], [bx, by]) =>
      ax * ax + ay * ay - (bx * bx + by * by) || Math.abs(ay) - Math.abs(by) || ax - bx || ay - by
  );
})();

const square = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Rooms in the realm's own order: map, then room. */
function byRoom(a: RoomId, b: RoomId): number {
  const [am, ar] = a.split('/').map(Number);
  const [bm, br] = b.split('/').map(Number);
  return am! - bm! || ar! - br!;
}

/**
 * Where each of an area's rooms goes. `seed` is laid first where it is in the
 * area; otherwise the busiest room (a town square, a junction) is.
 */
export function layOut(
  graph: WorldGraph,
  members: readonly RoomId[],
  seed: RoomId | null = null
): Map<RoomId, Spot> {
  const rooms = new Set(members.filter((id) => graph.byId(id) !== undefined));
  /** Exits inside the area, in a fixed order; a one-way exit in is taken backwards. */
  const ways = new Map<RoomId, Array<[Direction, RoomId]>>();
  const incoming = new Map<RoomId, Array<[Direction, RoomId]>>();
  for (const id of rooms) {
    for (const exit of graph.byId(id)!.exits) {
      const to = `${exit.map}/${exit.room}`;
      if (!rooms.has(to) || to === id) continue;
      const list = incoming.get(to);
      const back: [Direction, RoomId] = [OPPOSITE[exit.direction], id];
      if (list === undefined) incoming.set(to, [back]);
      else list.push(back);
    }
  }
  for (const id of rooms) {
    const out: Array<[Direction, RoomId]> = [];
    const reached = new Set<RoomId>();
    for (const exit of graph.byId(id)!.exits) {
      const to = `${exit.map}/${exit.room}`;
      if (!rooms.has(to) || to === id) continue;
      out.push([exit.direction, to]);
      reached.add(to);
    }
    for (const [direction, to] of incoming.get(id) ?? []) {
      if (!reached.has(to)) out.push([direction, to]);
    }
    ways.set(
      id,
      out.sort(([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b))
    );
  }

  /** Breadth first from `start` over rooms not yet placed, in a frame of its own. */
  const grow = (start: RoomId, taken: ReadonlyMap<RoomId, Spot>): Map<RoomId, Spot> => {
    const pos = new Map<RoomId, Spot>([[start, { x: 0, y: 0, z: 0 }]]);
    const occupied = new Set([square(0, 0, 0)]);
    const queue = [start];
    for (let i = 0; i < queue.length; i += 1) {
      const id = queue[i]!;
      const { x, y, z } = pos.get(id)!;
      for (const [direction, to] of ways.get(id)!) {
        if (pos.has(to) || taken.has(to)) continue;
        const [dx, dy, dz] = VEC[direction];
        const reach = dz !== 0 ? MAX_STACK : 1;
        for (let k = 1; k <= reach; k += 1) {
          const at = { x: x + dx * k, y: y + dy * k, z: z + dz * k };
          if (occupied.has(square(at.x, at.y, at.z))) continue;
          pos.set(to, at);
          occupied.add(square(at.x, at.y, at.z));
          queue.push(to);
          break;
        }
      }
    }
    return pos;
  };

  let start = seed !== null && rooms.has(seed) ? seed : null;
  if (start === null) {
    for (const id of [...rooms].sort(byRoom)) {
      if (start === null || ways.get(id)!.length > ways.get(start)!.length) start = id;
    }
  }
  const out = new Map<RoomId, Spot>();
  if (start === null) return out;

  /** Per level, every placed room's square and the eight around it. */
  const blocked = new Map<number, Set<string>>();
  const put = (id: RoomId, at: Spot): void => {
    out.set(id, at);
    let level = blocked.get(at.z);
    if (level === undefined) blocked.set(at.z, (level = new Set()));
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) level.add(`${at.x + dx},${at.y + dy}`);
    }
  };
  const bounds = (): { x0: number; y0: number; x1: number } => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    for (const { x, y } of out.values()) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
    }
    return { x0, y0, x1 };
  };

  for (const [id, at] of grow(start, out)) put(id, at);

  const unplaced = new Set([...rooms].filter((id) => !out.has(id)));
  while (unplaced.size > 0) {
    // Next piece: the unplaced room most tied to what is already down.
    let best: RoomId | null = null;
    let bestTies = -1;
    let anchor: [Direction, RoomId] | null = null;
    for (const id of unplaced) {
      const ties = ways.get(id)!.filter(([, to]) => out.has(to));
      if (ties.length > bestTies || (ties.length === bestTies && byRoom(id, best!) < 0)) {
        best = id;
        bestTies = ties.length;
        anchor = ties[0] ?? null;
      }
    }
    const piece = grow(best!, out);

    // `direction` is best's way to the room it ties to, so best sits one step back from it.
    let want: Spot;
    if (anchor !== null) {
      const [dx, dy, dz] = VEC[OPPOSITE[anchor[0]]];
      const to = out.get(anchor[1])!;
      want = { x: to.x + dx, y: to.y + dy, z: to.z + dz };
    } else {
      const { x1, y0 } = bounds();
      want = { x: x1 + 3, y: y0, z: 0 };
    }
    const local = piece.get(best!)!;
    const ox = want.x - local.x;
    const oy = want.y - local.y;
    const oz = want.z - local.z;
    const fits = (fx: number, fy: number, fz: number): boolean => {
      for (const { x, y, z } of piece.values()) {
        if (blocked.get(z + fz)?.has(`${x + fx},${y + fy}`) === true) return false;
      }
      return true;
    };

    let offset: [number, number, number] | null = null;
    if (anchor !== null && VEC[anchor[0]][2] !== 0) {
      // Hung off a way up or down: a level further on, in the same columns,
      // before it is moved sideways out of line.
      const step = -VEC[anchor[0]][2];
      for (let k = 0; k < 6 && offset === null; k += 1) {
        if (fits(ox, oy, oz + step * k)) offset = [ox, oy, oz + step * k];
      }
    }
    for (const [sx, sy] of offset === null ? SPIRAL : []) {
      if (fits(ox + sx, oy + sy, oz)) {
        offset = [ox + sx, oy + sy, oz];
        break;
      }
    }
    if (offset === null) {
      const { x1, y0 } = bounds();
      let px = Infinity;
      let py = Infinity;
      for (const { x, y } of piece.values()) {
        px = Math.min(px, x);
        py = Math.min(py, y);
      }
      offset = [x1 + 3 - px, y0 - py, oz];
    }
    for (const [id, { x, y, z }] of piece) {
      put(id, { x: x + offset[0], y: y + offset[1], z: z + offset[2] });
      unplaced.delete(id);
    }
  }
  return out;
}
