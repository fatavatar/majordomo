/**
 * The realm's hunting areas, worked out once per load of its room data
 * (2026-10-29): what a player calls a place, from what its lairs spawn and
 * what its rooms are called — not from where any one character stands.
 *
 * Every lair room is a thing to group (`groupAreas`): two are one area when
 * they are on one map under one name, of a kind (a monster in common, or a
 * monster on its own clock that belongs to wherever it stands), and close —
 * walkable one to the other through rooms of that name, or within `radius`
 * steps. The
 * user's rule: the Undersea Cavern's plain dark oceanid lairs are an area of
 * their own, apart from the lobsters spawning under that name and from the
 * Ruined Palace beside them. Done once and kept with the world data, since a
 * survey asks it only which area a lair's rooms are in.
 */
import { areaStem, groupAreas, type Placeable } from '../../shared/huntingGrounds';
import { parseLair, roomId, type RoomId } from '../../shared/world';
import type { WorldGraph } from './WorldGraph';

/** The realm's areas: each lair room's area, and what each area is called. */
export interface RealmAreas {
  areaOf: ReadonlyMap<RoomId, string>;
  areas: ReadonlyMap<string, { name: string; map: number }>;
}

/** Worked out per world data and radius, and kept with it. */
const done = new WeakMap<WorldGraph, Map<number, RealmAreas>>();

/** The realm's hunting areas within `radius` steps, worked out on first ask. */
export function realmAreas(world: WorldGraph, radius: number): RealmAreas {
  const byRadius = done.get(world) ?? new Map<number, RealmAreas>();
  done.set(world, byRadius);
  const known = byRadius.get(radius);
  if (known !== undefined) return known;

  interface LairRoom extends Placeable {
    key: RoomId;
  }
  const rooms: LairRoom[] = [];
  for (const room of world.everyRoom()) {
    if (!room.lair) continue;
    const spawns = parseLair(room.lair).ids;
    if (spawns.length === 0) continue;
    const onClock = world
      .lairEntities(room)
      .some((entity) => entity.regenHours !== undefined && entity.regenHours > 0);
    rooms.push({
      key: roomId(room.map, room.room),
      kind: onClock ? 'mob' : 'lair',
      rooms: [{ map: room.map, name: room.name }],
      mobs: spawns.map(String)
    });
  }
  /*
   * Close: walkable one to the other through rooms of that one name, however
   * far — a named place is one place — or within `radius` steps by any way.
   * The Dismagi Cavern's lairs lie more than six steps apart down corridors
   * of its own name, and by distance alone it was twenty areas. Each named
   * place is labelled once, by a flood through its own rooms; a lair room's
   * plain sweep is taken once and kept.
   */
  const place = new Map<RoomId, number>();
  let places = 0;
  for (const room of rooms) {
    if (place.has(room.key)) continue;
    const stem = areaStem(room.rooms[0]!.name).toLowerCase();
    places += 1;
    const flood = world.withinSteps(
      room.key,
      Number.POSITIVE_INFINITY,
      undefined,
      (other) => areaStem(other.name).toLowerCase() === stem
    );
    for (const id of flood.keys()) if (!place.has(id)) place.set(id, places);
  }
  const swept = new Map<RoomId, ReadonlySet<RoomId>>();
  const near = (a: LairRoom, b: LairRoom): boolean => {
    if (place.get(a.key) === place.get(b.key)) return true;
    let reached = swept.get(a.key);
    if (reached === undefined) {
      reached = new Set(world.withinSteps(a.key, radius).keys());
      swept.set(a.key, reached);
    }
    return reached.has(b.key);
  };
  const areaOf = new Map<RoomId, string>();
  const areas = new Map<string, { name: string; map: number }>();
  for (const area of groupAreas(rooms, near)) {
    areas.set(area.key, { name: area.name, map: area.map });
    for (const room of area.members) areaOf.set(room.key, area.key);
  }
  const found: RealmAreas = { areaOf, areas };
  byRadius.set(radius, found);
  return found;
}

/** The area most of these rooms are in; null where none is. */
export function areaOfRooms(realm: RealmAreas, rooms: readonly RoomId[]): string | null {
  const counts = new Map<string, number>();
  for (const id of rooms) {
    const area = realm.areaOf.get(id);
    if (area !== undefined) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [area, count] of counts) if (best === null || count > counts.get(best)!) best = area;
  return best;
}
