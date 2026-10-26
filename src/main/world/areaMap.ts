/**
 * One level of the area a room is in, as the map draws it (2026-10-26): the
 * area from `areaIndex`, its rooms placed by `layOut`, each drawn by
 * `mapCell`. mudmaps' pages, a level at a time, for the Map card.
 *
 * The area and its layout are worked out once — the areas once per realm, a
 * layout the first time its area is asked for — and the cells per ask, since
 * they are stated about the centre.
 */
import type { AreaMap } from '../../shared/map';
import type { RoomId } from '../../shared/world';
import { areaIndex, type AreaOverrides } from './areas';
import { layOut, type Spot } from './areaLayout';
import { mapCell } from './localMap';
import type { WorldGraph } from './WorldGraph';

const layouts = new WeakMap<WorldGraph, Map<number, Map<RoomId, Spot>>>();

/** Rooms in the realm's own order: map, then room. */
function byRoom(a: RoomId, b: RoomId): number {
  const [am, ar] = a.split('/').map(Number);
  const [bm, br] = b.split('/').map(Number);
  return am! - bm! || ar! - br!;
}

/**
 * The level `level` of the area `room` is in — the room's own level where
 * that is null or one the area does not have — centred on `room`, or on the
 * room of that level nearest its square (the staircase, usually) where it is
 * on another. Null where the realm has no such room.
 */
export function areaMap(
  graph: WorldGraph,
  room: RoomId,
  level: number | null,
  overrides: AreaOverrides = {}
): AreaMap | null {
  const index = areaIndex(graph, overrides);
  const areaId = index.areaOf.get(room);
  if (areaId === undefined) return null;
  const area = index.areas[areaId]!;
  let held = layouts.get(graph);
  if (held === undefined) layouts.set(graph, (held = new Map()));
  let spots = held.get(areaId);
  if (spots === undefined) {
    const seed = area.rooms.find((id) => index.seeds.has(id)) ?? null;
    spots = layOut(graph, area.rooms, seed);
    held.set(areaId, spots);
  }
  const at = spots.get(room);
  if (at === undefined) return null;

  const counts = new Map<number, number>();
  for (const { z } of spots.values()) counts.set(z, (counts.get(z) ?? 0) + 1);
  const levels = [...counts.entries()]
    .sort(([a], [b]) => b - a)
    .map(([z, rooms]) => ({ level: z, rooms }));
  const z = level !== null && counts.has(level) ? level : at.z;

  let centre = room;
  if (z !== at.z) {
    let nearest = Infinity;
    for (const [id, spot] of spots) {
      if (spot.z !== z) continue;
      const far = (spot.x - at.x) ** 2 + (spot.y - at.y) ** 2;
      if (far < nearest || (far === nearest && byRoom(id, centre) < 0)) {
        nearest = far;
        centre = id;
      }
    }
  }
  const origin = spots.get(centre)!;
  const cells = [];
  for (const [id, spot] of spots) {
    if (spot.z !== z) continue;
    cells.push(mapCell(graph, graph.byId(id)!, spot.x - origin.x, spot.y - origin.y));
  }
  return {
    centre,
    cells,
    dropped: 0,
    whole: true,
    area: { id: area.id, name: area.name, rooms: area.rooms.length },
    level: z,
    levels
  };
}
