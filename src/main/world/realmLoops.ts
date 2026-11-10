/**
 * A realm's hunting loops from its own database (2026-11-10): one loop for
 * each hunting area, its lairs in walking order, in place of loops recorded
 * in MegaMUD or shipped with the client.
 *
 * An area is the Hunting card's own (`realmAreas`): the lairs a player calls
 * one place, which is also what the card prices a lair group by since a group
 * spread over several places is priced a place at a time (#109). So a loop
 * here walks exactly the lairs the card prices as that area — MudRev's Rocky
 * Cliffs, 59 lairs of griffons, and not the Darkened Forest's 145 that share
 * their group.
 *
 * Walking order is nearest neighbour from the area's first lair, round and
 * back to it (`orderRing`), by the realm's own steps between them. An area
 * of one lair is a place to stand rather than a loop, and is left out.
 */
import { areaStem } from '../../shared/huntingGrounds';
import { orderRing, type HuntingRoom } from '../../shared/hunting';
import type { Loop } from '../../shared/loops';
import { roomId, type RoomId } from '../../shared/world';
import { realmAreas } from './huntingAreas';
import type { WorldGraph } from './WorldGraph';

/**
 * How far one lair's sweep looks for the next. An area's lairs lie within
 * the Hunting card's few steps of one another or along rooms of one name, so
 * the next is almost always well inside it; one past it is taken as far.
 */
const RING_REACH = 12;

/** The most monster names a loop's name lists. */
const NAMED_MOBS = 2;

/** One loop for each of the realm's hunting areas of two lairs or more, by area name. */
export function realmLoops(world: WorldGraph, radius: number): Loop[] {
  const steps = realmLoopsYielding(world, radius);
  for (;;) {
    const next = steps.next();
    if (next.done === true) return next.value;
  }
}

/**
 * `realmLoops` an area at a time, yielding between them, so a caller on the
 * client's one thread can let everything else run between areas: MudRev's
 * 463 take a second and a half (2026-11-10).
 */
export function* realmLoopsYielding(world: WorldGraph, radius: number): Generator<void, Loop[]> {
  const places = realmAreas(world, radius);
  const lairsOf = new Map<string, RoomId[]>();
  for (const [id, area] of places.areaOf) lairsOf.set(area, [...(lairsOf.get(area) ?? []), id]);

  const loops: Loop[] = [];
  const names = new Map<string, number>();
  for (const [area, ids] of lairsOf) {
    if (ids.length < 2) continue;
    const rooms: HuntingRoom[] = ids.flatMap((id) => {
      const room = world.byId(id);
      return room === undefined
        ? []
        : [{ id, map: room.map, room: room.room, name: room.name, steps: 0 }];
    });
    rooms.sort((a, b) => a.map - b.map || a.room - b.room);
    const inArea = new Set(ids);
    const sweeps = new Map<RoomId, Map<RoomId, number>>();
    const sweep = (id: RoomId): Map<RoomId, number> => {
      let found = sweeps.get(id);
      if (found === undefined) {
        found = new Map(
          [...world.withinSteps(id, RING_REACH)].filter(([other]) => inArea.has(other))
        );
        sweeps.set(id, found);
      }
      return found;
    };
    const { order } = orderRing(
      rooms,
      (a, b) => sweep(a).get(b) ?? sweep(b).get(a) ?? RING_REACH + 1
    );

    // What it is called: the area, and what most of its lairs spawn.
    const counts = new Map<string, number>();
    for (const room of rooms) {
      const at = world.byId(room.id);
      if (at === undefined) continue;
      for (const name of new Set(world.lairEntities(at).map((entity) => entity.name)))
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const mobs = [...counts]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, NAMED_MOBS)
      .map(([name]) => name);
    const place = places.areas.get(area)?.name ?? areaStem(rooms[0]!.name);
    const base = `${place}: ${mobs.join(', ')}`;
    const seen = (names.get(base.toLowerCase()) ?? 0) + 1;
    names.set(base.toLowerCase(), seen);

    loops.push({
      name: seen === 1 ? base : `${base} (${seen})`,
      stops: order.map((room) => ({ room: `${room.name} ${roomId(room.map, room.room)}` }))
    });
    yield;
  }
  return loops.sort((a, b) => a.name.localeCompare(b.name));
}
