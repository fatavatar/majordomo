/**
 * Which of a loop's stops lie behind an item gate, and so are walked only
 * some laps (2026-11-17).
 *
 * A room script that works only while an item lies in the room (`itemGate`)
 * cannot be walked every lap: the portal at 2/8602 to the Flame Pit is
 * there only once the Greater Glabrezu that drops it is dead. So the lap
 * passes the gate's room, and the stops behind it are a side trip taken from
 * there when the item lies in it — the engine's to walk (`MegaEngine`), the
 * builder's to say (`loopDraft.ts`), one reading for both.
 *
 * A stop whose way in crosses a gate is behind it, and so is every stop after
 * it that the gate's room can reach only through the gate: what lies behind a
 * portal is all behind it. The first stop after them the gate's room can reach
 * another way is where the trip comes back to the lap.
 */
import { itemGate, type RoomId, type Route } from '../../shared/world';

/** A loop's lap, and its side trips. */
export interface LapPlan {
  /**
   * The rooms the lap walks, in order: a stop of the loop (`stop`, its place
   * in the list), or a gate's room put in before the stops behind it.
   */
  lap: { room: RoomId; stop: number | null }[];
  trips: {
    /** The gate's room, as its place in `lap`. */
    at: number;
    /** What the gate wants lying in the room, as the realm names it. */
    items: string[];
    /** The stops behind it, as their places in the list. */
    stops: number[];
    /** The stop it comes back to, as its place in the list: past the end is the start. */
    rejoin: number;
  }[];
}

/**
 * `rooms`' lap and side trips, every way between two rooms asked of `way`:
 * a route, why there is none, or `pending` while it is being planned — which
 * the whole answer then is.
 */
export function lapWithTrips(
  rooms: readonly RoomId[],
  way: (from: RoomId, to: RoomId) => Route | string
): LapPlan | 'pending' {
  const first = rooms[0];
  if (first === undefined) return { lap: [], trips: [] };
  const lap: LapPlan['lap'] = [{ room: first, stop: 0 }];
  const trips: LapPlan['trips'] = [];
  for (let i = 1; i < rooms.length;) {
    const from = lap[lap.length - 1]!.room;
    const to = rooms[i]!;
    const leg = from === to ? null : way(from, to);
    if (leg === 'pending') return leg;
    const gate =
      leg === null || typeof leg === 'string' || leg.blocked ? null : itemGate(leg.steps);
    if (gate === null) {
      lap.push({ room: to, stop: i });
      i += 1;
      continue;
    }
    if (gate.room !== from) lap.push({ room: gate.room, stop: null });
    let j = i + 1;
    for (; j < rooms.length; j += 1) {
      const onward = way(gate.room, rooms[j]!);
      if (onward === 'pending') return onward;
      if (typeof onward === 'string' || onward.blocked || itemGate(onward.steps) === null) break;
    }
    const stops: number[] = [];
    for (let k = i; k < j; k += 1) stops.push(k);
    trips.push({ at: lap.length - 1, items: gate.items, stops, rejoin: j });
    i = j;
  }
  return { lap, trips };
}
