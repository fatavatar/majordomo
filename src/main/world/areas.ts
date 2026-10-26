/**
 * The realm carved into areas, one map each — mudmaps' `areas.py`, ported
 * (2026-10-26).
 *
 * The realm has no notion of an area, only room names and exits, so the split
 * is a heuristic and the one mudmaps tuned over all 38,908 of MudRev's rooms:
 *
 * 1. Rooms are grouped by the part of the name before a comma (`Lagoon, Reef`
 *    is the Lagoon) where an exit on one map number joins them.
 * 2. A group under `min_size` is folded into the neighbour it shares most
 *    exits with, smallest first — same-map exits count three times a portal's.
 * 3. Groups densely interlinked (a town's streets cross at every block) are
 *    joined while `shared exits / √(|A|·|B|)` is over `coupling` and the
 *    result stays under `max_size`.
 * 4. Neighbours of one family (`Copper Mine` and `Copper Mine Tunnel` once
 *    the generic words are gone) are joined, and a small group whose every
 *    way out is into one other is folded into it as its side branch,
 *    alternately until neither finds anything.
 * 5. The hand joins, and the rooms with no way in or out share one area.
 *
 * `resources/world/areas.json` is mudmaps' `overrides.json`, the hand tuning
 * in its own spelling: `names`, `join`, `pin`, `seeds` and the five numbers.
 */
import { roomId, type RoomId } from '../../shared/world';
import { MinHeap, type WorldGraph } from './WorldGraph';

/** mudmaps' `overrides.json`. Every field optional. */
export interface AreaOverrides {
  /** An area holding this room is called this. */
  names?: Record<string, string>;
  /** This room's name group is an area of its own, so called. */
  pin?: Record<string, string>;
  /** The areas these two rooms land in are one. */
  join?: Array<[string, string]>;
  /** An area holding one of these rooms is laid out from it (`areaLayout`). */
  seeds?: string[];
  min_size?: number;
  coupling?: number;
  max_size?: number;
  family_max?: number;
  culdesac_max?: number;
}

export interface Area {
  id: number;
  name: string;
  rooms: RoomId[];
}

export interface AreaIndex {
  areas: Area[];
  areaOf: ReadonlyMap<RoomId, number>;
  /** The overrides' seeds, for the layout. */
  seeds: ReadonlySet<RoomId>;
}

/**
 * Words that say what kind of place a room is rather than which place:
 * `Copper Mine Tunnel` and `Copper Mine, Shaft` are both the copper mine.
 */
const GENERIC = new Set([
  'tunnel', 'tunnels', 'passage', 'passages', 'passageway', 'corridor', 'corridors', 'hall',
  'hallway', 'hallways', 'cave', 'caves', 'cavern', 'caverns', 'path', 'trail', 'road', 'room',
  'rooms', 'chamber', 'chambers', 'entrance', 'entry', 'shaft', 'stair', 'stairs', 'stairway',
  'ramp', 'bridge', 'street', 'alley', 'the', 'of', 'a', 'lower', 'upper', 'inner', 'outer',
  'deep', 'deeper', 'bottom', 'top'
]); // prettier-ignore

/** Names that say nothing about where a room is: such rooms join their neighbours. */
const ANONYMOUS = new Set(['', 'blank', 'unused', 'room']);

/** The area-ish part of a room name: `Lagoon, Reef` is `Lagoon`. */
function keyOf(name: string): string {
  return name.split(',')[0]!.trim();
}

function stemOf(key: string): string[] {
  const words = key.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const core = words.filter((word) => !GENERIC.has(word));
  return core.length > 0 ? core : words;
}

/** Equal stems, or one is the other plus words (`silver mine` / `silver mine cart`). */
function sameFamily(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === long.length) return short.every((word, i) => word === long[i]);
  // A one-word stem (`dark`, `black`) is too common to identify a place.
  return short.length >= 2 && short.every((word, i) => word === long[i]);
}

/** Rooms in the realm's own order: map, then room. */
function byRoom(a: RoomId, b: RoomId): number {
  const [am, ar] = a.split('/').map(Number);
  const [bm, br] = b.split('/').map(Number);
  return am! - bm! || ar! - br!;
}

function mapOf(id: RoomId): number {
  return Number(id.slice(0, id.indexOf('/')));
}

/** Adds `by` to a tally. */
function bump<K>(tally: Map<K, number>, key: K, by: number): void {
  tally.set(key, (tally.get(key) ?? 0) + by);
}

/** The commonest name key among rooms, the anonymous ones left out. */
function mainKey(keys: ReadonlyMap<RoomId, string>, members: Iterable<RoomId>): string {
  const counts = new Map<string, number>();
  for (const id of members) {
    const key = keys.get(id)!;
    if (!ANONYMOUS.has(key.toLowerCase())) bump(counts, key, 1);
  }
  let best = '';
  let most = 0;
  for (const [key, count] of counts) {
    if (count > most) [best, most] = [key, count];
  }
  return best;
}

const held = new WeakMap<WorldGraph, AreaIndex>();

/** The realm's areas, worked out once per realm. */
export function areaIndex(graph: WorldGraph, overrides: AreaOverrides = {}): AreaIndex {
  let index = held.get(graph);
  if (index === undefined) {
    index = buildAreas(graph, overrides);
    held.set(graph, index);
  }
  return index;
}

export function buildAreas(graph: WorldGraph, overrides: AreaOverrides = {}): AreaIndex {
  const minSize = overrides.min_size ?? 10;
  const coupling = overrides.coupling ?? 0.06;
  const maxSize = overrides.max_size ?? 700;
  const familyMax = overrides.family_max ?? 1200;
  const culdesacMax = overrides.culdesac_max ?? 40;

  const keys = new Map<RoomId, string>();
  /** Every room's ways to rooms the realm has: its exits, and its commands that move you. */
  const exits = new Map<RoomId, RoomId[]>();
  const moves = new Map<RoomId, RoomId[]>();
  for (const room of graph.everyRoom()) {
    keys.set(roomId(room.map, room.room), keyOf(room.name));
  }
  for (const id of keys.keys()) {
    const room = graph.byId(id)!;
    exits.set(
      id,
      room.exits.map((exit) => roomId(exit.map, exit.room)).filter((to) => keys.has(to))
    );
    moves.set(
      id,
      graph
        .portalsFrom(id)
        .map((portal) => roomId(portal.map, portal.room))
        .filter((to) => keys.has(to))
    );
  }

  // 1. Name-key components within a map.
  const parent = new Map<RoomId, RoomId>();
  const find = (a: RoomId): RoomId => {
    let at = a;
    while (parent.get(at) !== at) {
      const up = parent.get(parent.get(at)!)!;
      parent.set(at, up);
      at = up;
    }
    return at;
  };
  for (const id of keys.keys()) parent.set(id, id);
  for (const [id, key] of keys) {
    if (ANONYMOUS.has(key.toLowerCase())) continue;
    for (const to of exits.get(id)!) {
      if (mapOf(to) === mapOf(id) && keys.get(to) === key) {
        const [a, b] = [find(id), find(to)];
        if (a !== b) parent.set(b, a);
      }
    }
  }
  const groups = new Map<RoomId, Set<RoomId>>();
  const of = new Map<RoomId, RoomId>();
  for (const id of keys.keys()) {
    const root = find(id);
    of.set(id, root);
    let members = groups.get(root);
    if (members === undefined) groups.set(root, (members = new Set()));
    members.add(id);
  }
  const fixed = new Set(
    Object.keys(overrides.pin ?? {})
      .filter((id) => of.has(id))
      .map((id) => of.get(id)!)
  );
  const bySize = (): RoomId[] =>
    [...groups.keys()].sort((a, b) => groups.get(a)!.size - groups.get(b)!.size);
  const absorb = (into: RoomId, from: RoomId): void => {
    const members = groups.get(from)!;
    for (const id of members) of.set(id, into);
    for (const id of members) groups.get(into)!.add(id);
    groups.delete(from);
  };

  // 2. Fold small groups into their best-connected neighbour, smallest first.
  const incoming = new Map<RoomId, RoomId[]>();
  for (const [id, tos] of exits) {
    for (const to of tos) {
      const list = incoming.get(to);
      if (list === undefined) incoming.set(to, [id]);
      else list.push(id);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const g of bySize()) {
      const members = groups.get(g);
      if (members === undefined || members.size >= minSize || fixed.has(g)) continue;
      const ties = new Map<RoomId, number>();
      for (const id of members) {
        // Same-map neighbours are much better partners than a portal across the world.
        for (const to of exits.get(id)!) {
          const o = of.get(to)!;
          if (o !== g) bump(ties, o, mapOf(to) === mapOf(id) ? 3 : 1);
        }
        // Incoming too: one-way exits into the group.
        for (const from of incoming.get(id) ?? []) {
          const o = of.get(from)!;
          if (o !== g) bump(ties, o, mapOf(from) === mapOf(id) ? 3 : 1);
        }
      }
      if (ties.size === 0) continue;
      // Most ties; a tie to the smaller partner, so blobs do not snowball.
      let target: RoomId | null = null;
      for (const [o, count] of ties) {
        if (
          target === null ||
          count > ties.get(target)! ||
          (count === ties.get(target)! && groups.get(o)!.size < groups.get(target)!.size)
        ) {
          target = o;
        }
      }
      absorb(target!, g);
      changed = true;
    }
  }

  // 3. Join densely interlinked groups: a town's streets, not a forest and its road.
  const weight = new Map<RoomId, Map<RoomId, number>>();
  const tie = (a: RoomId, b: RoomId, by: number): void => {
    for (const [x, y] of [
      [a, b],
      [b, a]
    ] as const) {
      let row = weight.get(x);
      if (row === undefined) weight.set(x, (row = new Map()));
      bump(row, y, by);
    }
  };
  for (const id of keys.keys()) {
    const a = of.get(id)!;
    for (const to of exits.get(id)!) {
      const b = of.get(to)!;
      if (b !== a) tie(a, b, mapOf(to) === mapOf(id) ? 1 : 0.3);
    }
    // A room command that moves you is a way between places too, a weaker hint.
    for (const to of moves.get(id)!) {
      const b = of.get(to)!;
      if (b !== a) tie(a, b, mapOf(to) === mapOf(id) ? 0.5 : 0.15);
    }
  }
  const rowOf = (g: RoomId): Map<RoomId, number> => {
    let row = weight.get(g);
    if (row === undefined) weight.set(g, (row = new Map()));
    return row;
  };
  const score = (a: RoomId, b: RoomId): number =>
    (rowOf(a).get(b) ?? 0) / Math.sqrt(groups.get(a)!.size * groups.get(b)!.size);
  /** `b` into `a` (the larger keeps its id), the weights carried over. */
  const merge = (x: RoomId, y: RoomId): RoomId => {
    const [a, b] = groups.get(y)!.size > groups.get(x)!.size ? [y, x] : [x, y];
    absorb(a, b);
    const gone = weight.get(b) ?? new Map<RoomId, number>();
    weight.delete(b);
    for (const [c, w] of gone) {
      rowOf(c).delete(b);
      if (c !== a) tie(a, c, w);
    }
    rowOf(a).delete(b);
    return a;
  };
  const heap = new MinHeap<[RoomId, RoomId, number]>();
  for (const [a, row] of weight) {
    for (const b of row.keys()) {
      if (byRoom(a, b) < 0) heap.push(-score(a, b), [a, b, score(a, b)]);
    }
  }
  for (let next = heap.pop(); next !== undefined; next = heap.pop()) {
    const [a, b, was] = next;
    if (was < coupling) break;
    if (!groups.has(a) || !groups.has(b) || !rowOf(a).has(b)) continue;
    if (Math.abs(was - score(a, b)) > 1e-9) continue; // stale
    if (groups.get(a)!.size + groups.get(b)!.size > maxSize || fixed.has(a) || fixed.has(b))
      continue;
    const kept = merge(a, b);
    for (const c of rowOf(kept).keys()) {
      const [x, y] = byRoom(kept, c) < 0 ? [kept, c] : [c, kept];
      heap.push(-score(x, y), [x, y, score(x, y)]);
    }
  }

  // 4. Families, and the side branches folded into the one group they lead to.
  const stems = new Map<RoomId, string[]>();
  for (const [g, members] of groups) stems.set(g, stemOf(mainKey(keys, members)));
  const restem = (g: RoomId): void => {
    stems.set(g, stemOf(mainKey(keys, groups.get(g)!)));
  };
  const familyPass = (): boolean => {
    let changed = false;
    for (const a of bySize()) {
      if (!groups.has(a) || fixed.has(a)) continue;
      const row = rowOf(a);
      for (const b of [...row.keys()].sort((x, y) => row.get(y)! - row.get(x)!)) {
        if (fixed.has(b) || !groups.has(b)) continue;
        if (groups.get(a)!.size + groups.get(b)!.size > familyMax) continue;
        if (sameFamily(stems.get(a)!, stems.get(b)!)) {
          restem(merge(a, b));
          changed = true;
          break;
        }
      }
    }
    return changed;
  };
  const culdesacPass = (): boolean => {
    let changed = false;
    for (const a of bySize()) {
      if (!groups.has(a) || fixed.has(a) || groups.get(a)!.size > culdesacMax) continue;
      const outs = [...rowOf(a).keys()].filter((b) => groups.has(b));
      if (outs.length === 1 && !fixed.has(outs[0]!)) {
        restem(merge(outs[0]!, a));
        changed = true;
      }
    }
    return changed;
  };
  // Each pass can expose work for the other, so alternate until neither finds any.
  for (;;) {
    const families = familyPass();
    const branches = culdesacPass();
    if (!families && !branches) break;
  }

  // 5. Hand joins, through `merge` so the weights still say who neighbours whom.
  for (const [x, y] of overrides.join ?? []) {
    const a = of.get(x);
    const b = of.get(y);
    if (a === undefined || b === undefined || a === b) continue;
    merge(a, b);
  }

  // Rooms with no way in or out at all share one area rather than each making their own.
  const loose = [...groups.keys()].filter(
    (g) =>
      groups.get(g)!.size <= 2 && ![...rowOf(g).keys()].some((b) => groups.has(b)) && !fixed.has(g)
  );
  let looseRoot: RoomId | null = null;
  if (loose.length > 1) {
    looseRoot = loose[0]!;
    for (const g of loose.slice(1)) absorb(looseRoot, g);
  }

  // 6. Name and number them, largest first.
  const named = new Map<RoomId, string>(Object.entries(overrides.names ?? {}));
  for (const [id, name] of Object.entries(overrides.pin ?? {})) named.set(id, name);
  const ordered = [...groups.entries()].sort(([a, x], [b, y]) => y.size - x.size || byRoom(a, b));
  const areas: Area[] = [];
  const areaOf = new Map<RoomId, number>();
  for (const [g, members] of ordered) {
    const rooms = [...members].sort(byRoom);
    let name = rooms.map((id) => named.get(id)).find((given) => given !== undefined);
    if (g === looseRoot) name = 'Unconnected rooms';
    if (name === undefined) name = mainKey(keys, rooms) || `Map ${mapOf(g)}`;
    const area: Area = { id: areas.length, name, rooms };
    for (const id of rooms) areaOf.set(id, area.id);
    areas.push(area);
  }
  // Repeated names told apart: `Stone Tunnel (2)`.
  const totals = new Map<string, number>();
  for (const area of areas) bump(totals, area.name, 1);
  const seen = new Map<string, number>();
  for (const area of areas) {
    if (totals.get(area.name)! > 1) {
      bump(seen, area.name, 1);
      area.name = `${area.name} (${seen.get(area.name)})`;
    }
  }
  return { areas, areaOf, seeds: new Set(overrides.seeds ?? []) };
}
