/**
 * Planning a loop that is being built by hand on the map.
 *
 * The builder's picks are rooms clicked in order. Every pair is planned by
 * `WorldGraph.route` with the traveller a lap walks by
 * (`SessionManager.lapTraveller`: distance and passability, nothing waiting
 * on the way priced), so a detour clicked round a lair stays a waypoint where
 * the lap would otherwise walk through it — and then the picks are
 * reduced to **waypoints**: the fewest rooms whose routes reproduce the whole
 * way exactly. A loop in this client is a list of places
 * (`src/shared/loops.ts`), and a pick in the middle of a corridor the planner
 * would walk anyway is not a place anybody chose — it is a click made on the
 * way to one. `npm run build:loops` applies the identical reduction to
 * MegaMUD's recorded paths, and for the same reason: a loop only carries the
 * rooms where the walk is a *choice*.
 *
 * **The draft plans plainly — with no preferred corridors — and what it
 * saves is preferred.** That pair is what makes the way drawn the way that
 * is walked, whatever else the character prefers: a saved way's own steps are
 * discounted like every other preferred corridor, and it is a shortest plain
 * way between its waypoints, so under any discount that includes it no other
 * way between them is cheaper. Drawn under somebody's *other* preferences
 * instead, the reduction would reproduce the drawn way only while those
 * preferences stood, and a way saved without them would be walked another
 * way the night one of them changed.
 */
import { splitStop, type Loop } from '../../shared/loops';
import {
  EMPTY_LOOP_DRAFT,
  type LoopDraft,
  type LoopDraftLeg,
  type RoomId
} from '../../shared/world';
import type { Traveller, WorldGraph } from './WorldGraph';

/**
 * The reduction's working state, so a longer path can carry on from where a
 * shorter one stopped rather than starting again from the first room.
 *
 * The greedy rule looks only forward from its current anchor, and every
 * decision it makes about the rooms before `next` depends only on those
 * rooms — so the state at the end of a path is exactly the state the same
 * rule would be in at that point of any path that extends it. That is what
 * lets a draft grow by one pick at the cost of one leg.
 */
interface Reduction {
  stops: RoomId[];
  anchor: number;
  next: number;
}

const seedReduction = (first: RoomId): Reduction => ({ stops: [first], anchor: 0, next: 2 });

function reduceMore(
  graph: WorldGraph,
  path: readonly RoomId[],
  traveller: Traveller,
  state: Reduction,
  kept: ReadonlySet<number> = new Set()
): Reduction {
  const stops = [...state.stops];
  let anchor = state.anchor;
  let index = state.next;
  for (; index < path.length; index += 1) {
    const route = graph.route(path[anchor]!, path[index]!, traveller);
    const walked = route.blocked ? null : route.steps.map((step) => step.to);
    const recorded = path.slice(anchor + 1, index + 1);
    const same =
      walked !== null &&
      walked.length === recorded.length &&
      walked.every((id, at) => id === recorded[at]);
    // A place on the way that must stay a stop (`kept`) is one, walked through or not.
    if (!same || kept.has(index - 1)) {
      stops.push(path[index - 1]!);
      anchor = index - 1;
    }
  }
  return { stops, anchor, next: index };
}

/** The waypoints a reduction states: its stops, and the last room if it is not one already. */
function waypointsOf(state: Reduction, path: readonly RoomId[]): RoomId[] {
  const last = path[path.length - 1];
  if (last === undefined) return [];
  return state.stops[state.stops.length - 1] === last ? [...state.stops] : [...state.stops, last];
}

/**
 * `reduceWaypoints`, handing the thread back after every route it plans.
 *
 * For a caller reducing hundreds of recorded loops on the thread that holds
 * every session's socket (`megamudLoops.ts`, 2026-09-29): MudRev's 285 plan
 * about eleven thousand routes, half a minute of work, and a character
 * playing while its realm imports must not stand still for any of it. The
 * reduction resumes where it stopped — the property a draft grows by one
 * pick on — so the answer is `reduceWaypoints`' own.
 */
export async function reduceWaypointsYielding(
  graph: WorldGraph,
  path: readonly RoomId[],
  traveller: Traveller = {}
): Promise<RoomId[]> {
  const first = path[0];
  if (first === undefined) return [];
  let state = seedReduction(first);
  for (let end = state.next + 1; end <= path.length; end += 1) {
    state = reduceMore(graph, path.slice(0, end), traveller, state);
    await new Promise<void>((next) => setImmediate(next));
  }
  return waypointsOf(state, path);
}

/** A draft and the working the next pick carries on from. */
interface Built {
  picks: RoomId[];
  legs: LoopDraftLeg[];
  path: RoomId[];
  /** Where in `path` each pick planned so far stands, for the picks that stay stops. */
  ends: number[];
  reduction: Reduction;
  /** True once a leg was blocked: nothing after it was planned, and nothing extends it. */
  blocked: boolean;
  draft: LoopDraft;
}

/**
 * Plans the picks from `base` onward.
 *
 * The first blocked leg ends the plan: the picks after it are not routed,
 * because a leg planned on from a room the character cannot reach is a
 * picture of a walk that will never happen, and the blocked leg is the one
 * thing the reader needs to see. `path` is what was planned, opening with the
 * first pick, so a blocked draft still draws everything up to the door.
 */
function extend(
  graph: WorldGraph,
  base: Built,
  picks: readonly RoomId[],
  traveller: Traveller,
  keep: ReadonlySet<RoomId>
): Built {
  const legs = [...base.legs];
  const path = [...base.path];
  const ends = [...base.ends];
  let blocked = base.blocked;
  for (let index = base.picks.length; index < picks.length && !blocked; index += 1) {
    const from = picks[index - 1]!;
    const to = picks[index]!;
    const route = graph.route(from, to, traveller);
    legs.push({ from, to, route });
    if (route.blocked) blocked = true;
    else {
      for (const step of route.steps) path.push(step.to);
      ends.push(path.length - 1);
    }
  }
  // Ours (2026-10-23): a pick with commands to type there stays a stop.
  const kept = new Set(ends.filter((at) => keep.has(path[at]!)));
  const reduction = reduceMore(graph, path, traveller, base.reduction, kept);
  const waypoints = waypointsOf(reduction, path).map((id) => ({
    id,
    name: graph.byId(id)?.name ?? id
  }));
  return {
    picks: [...picks],
    legs,
    path,
    ends,
    reduction,
    blocked,
    draft: { legs, path, waypoints }
  };
}

function fresh(
  graph: WorldGraph,
  picks: readonly RoomId[],
  traveller: Traveller,
  keep: ReadonlySet<RoomId>
): Built | null {
  const first = picks[0];
  if (first === undefined) return null;
  const seed: Built = {
    picks: [first],
    legs: [],
    path: [first],
    ends: [0],
    reduction: seedReduction(first),
    blocked: false,
    draft: { legs: [], path: [first], waypoints: [] }
  };
  return extend(graph, seed, picks, traveller, keep);
}

/**
 * The picks, planned as far as they go — from scratch. See {@link LoopDraftCache}.
 * A pick whose room is in `keep` stays a waypoint, though the way runs through
 * it anyway: the builder keeps there a stop with commands to type.
 */
export function draftLoop(
  graph: WorldGraph,
  picks: readonly RoomId[],
  traveller: Traveller = {},
  keep: ReadonlySet<RoomId> = new Set()
): LoopDraft {
  return fresh(graph, picks, traveller, keep)?.draft ?? EMPTY_LOOP_DRAFT;
}

/**
 * Drafts remembered, so a pick costs its own leg and an undo costs nothing.
 *
 * The builder asks on every click, and a draft from scratch is one A* pass
 * for every room on the way — measured on the shipped realm at 180ms for
 * 300 rooms and 1.5s for 2,500 (the reviewer's figures, 2026-09-05), on the
 * thread that holds every session's socket and every walker's clock. So the
 * last few drafts are kept, keyed on the picks and on the stats the router
 * prices against: a list that extends a remembered one carries its legs, its
 * path and its reduction forward and plans only what is new, and a list
 * already seen — which every undo and redo is — is answered from memory.
 * Keyed on the graph as well, so a realm swapped underneath is not answered
 * with the old one's corridors.
 *
 * Bounded, and one per session: a builder is one card, and sixty-four
 * drafts is more undo depth than `tuning.view.historyDepth` keeps.
 */
export class LoopDraftCache {
  private readonly entries = new Map<string, { graph: WorldGraph; built: Built }>();

  constructor(private readonly limit = 64) {}

  draft(
    graph: WorldGraph,
    picks: readonly RoomId[],
    traveller: Traveller = {},
    keep: ReadonlySet<RoomId> = new Set()
  ): LoopDraft {
    if (picks.length === 0) return EMPTY_LOOP_DRAFT;
    // The rooms kept are part of what a remembered draft answers for.
    const stamp = `${fingerprint(traveller)}|${[...keep].sort().join(',')}`;
    const hit = this.get(graph, stamp, picks);
    if (hit !== null) return hit.draft;

    let base: Built | null = null;
    for (let length = picks.length - 1; length >= 1 && base === null; length -= 1) {
      const found = this.get(graph, stamp, picks.slice(0, length));
      if (found !== null && !found.blocked) base = found;
    }
    const built =
      base === null
        ? fresh(graph, picks, traveller, keep)
        : extend(graph, base, picks, traveller, keep);
    if (built === null) return EMPTY_LOOP_DRAFT;
    this.put(graph, stamp, built);
    return built.draft;
  }

  /** A room id is `map/room`, so a comma cannot occur in one and a hash cannot open one. */
  private key(stamp: string, picks: readonly RoomId[]): string {
    return `${stamp}#${picks.join(',')}`;
  }

  private get(graph: WorldGraph, stamp: string, picks: readonly RoomId[]): Built | null {
    const entry = this.entries.get(this.key(stamp, picks));
    return entry !== undefined && entry.graph === graph ? entry.built : null;
  }

  private put(graph: WorldGraph, stamp: string, built: Built): void {
    const key = this.key(stamp, built.picks);
    this.entries.delete(key);
    this.entries.set(key, { graph, built });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/**
 * The parts of a traveller a remembered draft depends on.
 *
 * **Not the purse, and not the pack**: both move with every coin looted and
 * every rope bought, and a toll or an item gate on a draft is priced again
 * the night it is walked.
 *
 * The three the character *is* are here, and they were not: `classId` went in
 * with todo 03 and never reached this line, so a draft planned before the stat
 * sheet arrived — which is every draft in the first seconds of a session —
 * survived the sheet landing and could draw a way through a class gate the
 * character is refused at. Unlike the purse these settle once and stay put,
 * which is exactly what makes them safe to key a cache on.
 */
function fingerprint(traveller: Traveller): string {
  return [
    traveller.level ?? '',
    traveller.strength ?? '',
    traveller.pickSkill ?? '',
    // Which of those two the walker may spend: a switch flipped in settings
    // changes which doors a draft can walk through.
    traveller.forcing === undefined
      ? ''
      : `${traveller.forcing.pick ? 'p' : ''}${traveller.forcing.bash ? 'b' : ''}`,
    // And what it keeps out of: a word added changes which ways a draft walks.
    (traveller.keepOut?.words ?? []).join('\n'),
    (traveller.keepOut?.allowed ?? []).join('\n'),
    traveller.classId ?? '',
    traveller.raceId ?? '',
    traveller.alignment ?? ''
  ].join('|');
}

/** A stop as `splitStop` reads it: the name, and the coordinates when stated. */
export type StopPlace = ReturnType<typeof splitStop>;

/**
 * The corridors of every route this character prefers, as `from|to` room
 * ids both ways, and the routes that could not be stated.
 *
 * A loop with `prefer` is *this is the way*: each leg between its stops is
 * planned once, **plainly** — with the traveller's stats and no preferences,
 * because a route's own corridors are what its waypoints reproduce under the
 * plain planner, and deriving one route under another's discount would make
 * the set depend on the order the files were read in — and every step's edge
 * is kept in both directions, since a saved route is walked out and back. A
 * ring closes with the leg from its last stop to its first.
 *
 * A stop the realm cannot settle — a name thirteen rooms share, a name it
 * does not have — leaves the whole route out rather than half of it, and
 * names it in `unresolved` so the caller can say so: a preference that
 * silently prefers nothing is a setting somebody edits and then waits to see
 * work.
 */
export function preferredEdges(
  graph: WorldGraph,
  loops: readonly Loop[],
  resolve: (stop: StopPlace) => RoomId | null,
  traveller: Traveller
): { edges: ReadonlySet<string>; unresolved: string[] } {
  const edges = new Set<string>();
  const unresolved: string[] = [];
  const plain: Traveller = { ...traveller };
  delete plain.preferred;

  for (const loop of loops) {
    if (loop.prefer !== true) continue;
    const rooms: RoomId[] = [];
    let settled = true;
    for (const stop of loop.stops) {
      const room = resolve(splitStop(stop));
      if (room === null) {
        settled = false;
        break;
      }
      rooms.push(room);
    }
    if (!settled || rooms.length < 2) {
      unresolved.push(loop.name);
      continue;
    }
    const legs: Array<[RoomId, RoomId]> = rooms.slice(1).map((to, at) => [rooms[at]!, to]);
    if (loop.bounce !== true) legs.push([rooms[rooms.length - 1]!, rooms[0]!]);
    for (const [from, to] of legs) {
      const route = graph.route(from, to, plain);
      if (route.blocked) continue;
      for (const step of route.steps) {
        edges.add(`${step.from}|${step.to}`);
        edges.add(`${step.to}|${step.from}`);
      }
    }
  }
  return { edges, unresolved };
}
