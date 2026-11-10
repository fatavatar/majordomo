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
 *
 * An area with a boss in it (`bossRooms`) gets two loops, as the Hunting card
 * prices it two ways: one with its bosses, and one for a character they are
 * too hard for, which never enters their rooms: they are neither stops nor
 * on the way between them (`Loop.avoid`, 2026-11-10).
 */
import { areaStem } from '../../shared/huntingGrounds';
import { orderRing, type HuntingRoom } from '../../shared/hunting';
import type { Loop } from '../../shared/loops';
import { t } from '../app/i18n';
import { roomId, type RoomId, type WorldRoom } from '../../shared/world';
import { bossRooms, realmAreas } from './huntingAreas';
import type { WorldGraph } from './WorldGraph';

/**
 * How far one lair's sweep looks for the next. An area's lairs lie within
 * the Hunting card's few steps of one another or along rooms of one name, so
 * the next is almost always well inside it; one past it is taken as far.
 */
const RING_REACH = 12;

/**
 * How far that sweep looks for a loop that keeps out of its bosses' rooms:
 * the way round a boss is longer than the way through. On MudRev, at the
 * plain reach, 274 of the 425 lairs a loop without its bosses left out could
 * still be walked to round them, most within a couple of dozen steps
 * (2026-11-10).
 */
const ROUND_REACH = 2 * RING_REACH;

/** The most monster names a loop's name lists. */
const NAMED_MOBS = 2;

/** The areas a loop is made for, each with its lairs: those of two lairs or more. */
function loopAreas(world: WorldGraph, radius: number): Map<string, RoomId[]> {
  const lairsOf = new Map<string, RoomId[]>();
  for (const [id, area] of realmAreas(world, radius).areaOf)
    lairsOf.set(area, [...(lairsOf.get(area) ?? []), id]);
  for (const [area, ids] of lairsOf) if (ids.length < 2) lairsOf.delete(area);
  return lairsOf;
}

/**
 * An area's lairs and its bosses' rooms apart, where it has bosses: the lairs
 * that reach one another without entering a boss's room, the most of them
 * that do. A lair the only way to which is through a boss is left out with
 * it. Null where fewer than two are left.
 */
function withoutBosses(
  world: WorldGraph,
  ids: readonly RoomId[]
): { lairs: RoomId[]; bosses: ReadonlySet<RoomId> } | null {
  const bosses = bossRooms(world, ids);
  if (bosses.size === 0) return null;
  const lairs = ids.filter((id) => !bosses.has(id));
  const inLoop = new Set(lairs);
  const reach = (id: RoomId): RoomId[] =>
    [...world.withinSteps(id, ROUND_REACH, undefined, away(bosses)).keys()].filter((other) =>
      inLoop.has(other)
    );
  let most: RoomId[] = [];
  const placed = new Set<RoomId>();
  for (const id of lairs) {
    if (placed.has(id)) continue;
    const part: RoomId[] = [];
    const queue = [id];
    placed.add(id);
    while (queue.length > 0) {
      const at = queue.pop()!;
      part.push(at);
      for (const other of reach(at)) {
        if (placed.has(other)) continue;
        placed.add(other);
        queue.push(other);
      }
    }
    if (part.length > most.length) most = part;
  }
  const kept = new Set(most);
  return kept.size < 2 ? null : { lairs: lairs.filter((id) => kept.has(id)), bosses };
}

/** A sweep's test that keeps it out of these rooms. */
const away =
  (avoid: ReadonlySet<RoomId>) =>
  (room: WorldRoom): boolean =>
    !avoid.has(roomId(room.map, room.room));

/** How many loops `realmLoops` makes, without making them: for saying so (`RealmSummary`). */
export function realmLoopCount(world: WorldGraph, radius: number): number {
  let count = 0;
  for (const ids of loopAreas(world, radius).values())
    count += withoutBosses(world, ids) === null ? 1 : 2;
  return count;
}

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
  const loops: Loop[] = [];
  const names = new Map<string, number>();
  for (const [area, ids] of loopAreas(world, radius)) {
    // What it is called: the area, and what most of its lairs spawn.
    const counts = new Map<string, number>();
    for (const id of ids) {
      const at = world.byId(id);
      if (at === undefined) continue;
      for (const name of new Set(world.lairEntities(at).map((entity) => entity.name)))
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const mobs = [...counts]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, NAMED_MOBS)
      .map(([name]) => name);
    const first = world.byId(ids[0]!);
    const place = places.areas.get(area)?.name ?? areaStem(first?.name ?? '');
    const base = `${place}: ${mobs.join(', ')}`;
    const seen = (names.get(base.toLowerCase()) ?? 0) + 1;
    names.set(base.toLowerCase(), seen);
    const name = seen === 1 ? base : `${base} (${seen})`;

    const apart = withoutBosses(world, ids);
    if (apart === null) {
      loops.push({ name, stops: ring(world, ids) });
    } else {
      loops.push({ name: t('loops.fromDatabase.withBosses', { name }), stops: ring(world, ids) });
      loops.push({
        name: t('loops.fromDatabase.noBosses', { name }),
        stops: ring(world, apart.lairs, apart.bosses),
        avoid: [...apart.bosses].sort().map((id) => stopFor(world, id))
      });
    }
    yield;
  }
  return loops.sort((a, b) => a.name.localeCompare(b.name));
}

/** A room as a loop names it: its name and where it is. */
function stopFor(world: WorldGraph, id: RoomId): string {
  const room = world.byId(id);
  return room === undefined ? id : `${room.name} ${roomId(room.map, room.room)}`;
}

/**
 * These rooms in walking order, nearest first round a ring and back, measured
 * by ways that keep out of `avoid`.
 */
function ring(
  world: WorldGraph,
  ids: readonly RoomId[],
  avoid: ReadonlySet<RoomId> = new Set()
): Loop['stops'] {
  const rooms: HuntingRoom[] = ids.flatMap((id) => {
    const room = world.byId(id);
    return room === undefined
      ? []
      : [{ id, map: room.map, room: room.room, name: room.name, steps: 0 }];
  });
  rooms.sort((a, b) => a.map - b.map || a.room - b.room);
  const inLoop = new Set(ids);
  const reach = avoid.size === 0 ? RING_REACH : ROUND_REACH;
  const sweeps = new Map<RoomId, Map<RoomId, number>>();
  const sweep = (id: RoomId): Map<RoomId, number> => {
    let found = sweeps.get(id);
    if (found === undefined) {
      found = new Map(
        [...world.withinSteps(id, reach, undefined, away(avoid))].filter(([other]) =>
          inLoop.has(other)
        )
      );
      sweeps.set(id, found);
    }
    return found;
  };
  const { order } = orderRing(rooms, (a, b) => sweep(a).get(b) ?? sweep(b).get(a) ?? reach + 1);
  return order.map((room) => ({ room: stopFor(world, room.id) }));
}
