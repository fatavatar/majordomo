/**
 * MegaMUD's recorded loops as this client's loops (2026-09-29).
 *
 * MegaMUD stores a loop as the steps it recorded, because it has no
 * pathfinder to re-derive them. We do, so a loop here is a list of *places*
 * (`src/shared/loops.ts`). Bringing one across therefore means:
 *
 *   1. place its first room in the realm: by the coordinates a recorder typed,
 *      by its name, or by the signature MegaMUD recorded for every room on the
 *      way (`placedBySignature`),
 *   2. replay its recorded directions through the realm to recover the loop
 *      it actually walks,
 *   3. reduce that to the fewest waypoints whose routes reproduce it exactly
 *      — the loop builder's own reduction, yielding the thread as it goes,
 *   4. name it the way whoever recorded it did.
 *
 * A loop whose start cannot be placed, or whose steps do not fit the realm, is
 * **dropped and counted** rather than guessed at: a loop that walks somewhere
 * the character did not mean is worse than no loop.
 *
 * One converter for both ways a folder arrives: the Import button on a
 * server's page, and `npm run build:loops`, which made the shipped shelf.
 */
import { loopCategory, type Loop } from '../../shared/loops';
import type { MegaMudConversion, MegaMudPath } from '../../shared/megamudPaths';
import { roomId, type Direction, type RoomId, type WorldRoom } from '../../shared/world';
import { reduceWaypointsYielding } from './loopDraft';
import type { WorldGraph } from './WorldGraph';
import { worldSignature } from './megamudSignature';

const DIRECTIONS = new Set<string>(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd']);
/** MegaMUD records long forms too; the realm data is canonical short. */
const LONG: Readonly<Record<string, Direction>> = {
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
  up: 'u',
  down: 'd'
};

/**
 * How many of a recording's steps must be taken from a room with the
 * signature MegaMUD recorded there for a start to be placed by them. The
 * placed loops of MudRev's Default folder agree on 95 to 100% of their steps
 * (95 of 96, 144 of 146), the one wrong start that walked and closed on 8 of
 * 126 (2026-10-18).
 */
const SIGNATURES_AGREE = 0.9;

/** The realm's rooms by signature, read on the first loop that needs them. */
class Signatures {
  private index: Map<number, WorldRoom[]> | null = null;

  constructor(private readonly graph: WorldGraph) {}

  rooms(signature: number): readonly WorldRoom[] {
    if (this.index === null) {
      this.index = new Map();
      for (const room of this.graph.everyRoom()) {
        const code = worldSignature(room);
        if (code === null) continue;
        const list = this.index.get(code >>> 0);
        if (list) list.push(room);
        else this.index.set(code >>> 0, [room]);
      }
    }
    return this.index.get(signature) ?? [];
  }
}

/**
 * A room placed by the coordinates at the end of a name, when the realm has
 * one there.
 *
 * The coordinates were typed by hand, and every spelling in the recorded
 * corpus is accepted: `-1 1943`, `- 2 10134`, `+6 924`, `(17/25)`,
 * `Section7 519`. A pattern that loose would take the `11` off
 * `Undermountain Level 11` if it were trusted on its own, so a trailing pair
 * is coordinates only when **the realm has a room there**.
 */
function placedBy(graph: WorldGraph, name: string): { room: WorldRoom; at: number } | null {
  const pair = /[\s\-+(/]*(\d{1,3})[\s/]+(\d{1,6})\)?\s*$/.exec(name);
  if (!pair) return null;
  const room = graph.byId(roomId(Number(pair[1]), Number(pair[2])));
  return room ? { room, at: pair.index } : null;
}

/**
 * Where the loop starts, and the rooms it walks from there: by what the
 * recorder typed (`placedByName`), and where that finds no room or one the
 * steps do not fit, by what MegaMUD recorded (`placedBySignature`).
 */
function placed(
  graph: WorldGraph,
  signatures: Signatures,
  path: MegaMudPath
): { start: WorldRoom; rooms: RoomId[] | null } | null {
  const named = placedByName(graph, path);
  if (named !== null && named.rooms !== null) return named;
  return placedBySignature(graph, signatures, path) ?? named;
}

/**
 * Where the loop starts by the signatures MegaMUD recorded (2026-10-18): each
 * step names the room it is taken from by its signature, so a start is a room
 * with the first one whose replay comes back to itself and passes through
 * rooms with the recorded ones (`SIGNATURES_AGREE`). Several that do are
 * settled by which agrees on more steps, and two that agree as well are no
 * answer. MudRev's Default folder names 34 of its starts in words of the
 * recorder's own (`Rocky Trail - Dragon Start`, `Gloomy Mountain (Loop)`)
 * the realm has no room called; 25 are placed this way.
 */
function placedBySignature(
  graph: WorldGraph,
  signatures: Signatures,
  path: MegaMudPath
): { start: WorldRoom; rooms: RoomId[] } | null {
  const codes = path.codes;
  if (codes === undefined || codes.length === 0 || codes.length !== path.steps.length) return null;
  let best: { start: WorldRoom; rooms: RoomId[]; agree: number } | null = null;
  let tied = false;
  for (const start of signatures.rooms(codes[0]!)) {
    const walked = walk(graph, start, path.steps);
    if (walked === null || walked.rooms.at(-1) !== walked.rooms[0]) continue;
    const agree = walked.from.filter((room, i) => {
      const signature = worldSignature(room);
      return signature !== null && signature >>> 0 === codes[i];
    }).length;
    if (agree < SIGNATURES_AGREE * codes.length) continue;
    if (best === null || agree > best.agree) {
      best = { start, rooms: walked.rooms, agree };
      tied = false;
    } else if (agree === best.agree) tied = true;
  }
  return best !== null && !tied ? { start: best.start, rooms: best.rooms } : null;
}

/**
 * Where the loop starts by what the recorder typed, and the rooms it walks
 * from there.
 *
 * `Rooms.md`'s coordinates for its first room first, then the header's. Past
 * those, a name: and a name the realm gives several rooms (98 are called
 * Alderwood Forest) is settled by the recording itself — only the room the
 * loop was recorded from walks every step and comes back to itself, so the
 * one candidate that does is the start, and two that do are no answer. The
 * title is not asked: fourteen of Paradigm's name a room other than the one
 * the loop starts from.
 *
 * Null when the realm has no room to begin from; `rooms` null when it has one
 * and the steps do not fit it.
 */
function placedByName(
  graph: WorldGraph,
  path: MegaMudPath
): { start: WorldRoom; rooms: RoomId[] | null } | null {
  const names = [path.startRow, path.start].filter((name): name is string => name !== null);
  let typed: { start: WorldRoom; rooms: null } | null = null;
  for (const name of names) {
    const found = placedBy(graph, name);
    if (!found) continue;
    const rooms = replay(graph, found.room, path.steps);
    if (rooms !== null) return { start: found.room, rooms };
    // Coordinates are typed by hand, and a typo names a room the steps do
    // not fit; the name may still find the one they do.
    typed ??= { start: found.room, rooms: null };
  }
  for (const name of names) {
    const candidates = graph.findByName(name.slice(0, placedBy(graph, name)?.at ?? name.length));
    if (candidates.length === 0) continue;
    if (candidates.length === 1) {
      return { start: candidates[0]!, rooms: replay(graph, candidates[0]!, path.steps) };
    }
    const closing = candidates
      .map((room) => ({ room, rooms: replay(graph, room, path.steps) }))
      .filter((entry) => entry.rooms !== null && entry.rooms.at(-1) === entry.rooms[0]);
    if (closing.length === 1) return { start: closing[0]!.room, rooms: closing[0]!.rooms };
  }
  return typed;
}

/**
 * What a person calls this loop: the title on the file's first line, shed of
 * its coordinates.
 *
 * `[Burning Plains (NW)-17 9507][Winterhawk]` — the title is the name a player
 * typed, and the half that says which loop this *is*: four of Paradigm's
 * start at Narrow Ledge, and their own titles are East Half, West Half, Middle
 * and Full Loop. A trailing single number goes too when it is the start's own
 * room or map (`Siren Trees-5`); a dash or a plus is required, so
 * `Eladrin Level 1` keeps its level.
 */
function friendlyTitle(graph: WorldGraph, title: string, start: WorldRoom): string {
  if (title.length === 0) return '';
  const pair = placedBy(graph, title);
  if (pair) return title.slice(0, pair.at).trim();
  const one = /\s*[-+]\s*(\d{1,6})\s*$/.exec(title);
  if (one && (Number(one[1]) === start.room || Number(one[1]) === start.map)) {
    return title.slice(0, one.index).trim();
  }
  return title;
}

/** Every room the recorded directions walk through, or null where they do not fit. */
function replay(graph: WorldGraph, from: WorldRoom, steps: readonly string[]): RoomId[] | null {
  return walk(graph, from, steps)?.rooms ?? null;
}

/** `replay`, with the room each step is taken from beside it. */
function walk(
  graph: WorldGraph,
  from: WorldRoom,
  steps: readonly string[]
): { rooms: RoomId[]; from: WorldRoom[] } | null {
  const rooms = [roomId(from.map, from.room)];
  const taken: WorldRoom[] = [];
  let here = from;
  for (const step of steps) {
    taken.push(here);
    // `w[use dragon key w]` — the bracket is MegaMUD's extra commands for the
    // same move, which the planner and walker handle themselves — and
    // `e -- comment` is an annotation. Both are shed before reading the move.
    const bare = step
      .replace(/\[.*\]\s*$/, '')
      .replace(/\s+--.*$/, '')
      .trim()
      .toLowerCase();
    const command = LONG[bare] ?? bare;
    const exit = DIRECTIONS.has(command)
      ? here.exits.find((entry) => entry.direction === command)
      : here.exits.find((entry) => entry.requirement?.commands?.includes(command));
    if (!exit) {
      /*
       * Not every recorded step is a move: loops stash loot (`hide 500
       * gold`), check state (`stat`), wield and talk to NPCs on the way. A
       * step that is not a direction and not a text exit of this room is done
       * in place and the replay carries on. A *direction* that does not fit is
       * a real mismatch and fails the loop.
       */
      if (!DIRECTIONS.has(command)) continue;
      return null;
    }
    const next = graph.byId(roomId(exit.map, exit.room));
    if (!next) return null;
    rooms.push(roomId(next.map, next.room));
    here = next;
  }
  return { rooms, from: taken };
}

/**
 * Recorded loops as loops, sorted by name, every name unique.
 *
 * A name is a loop's address — the palette starts one by name, and a scope
 * files one by name — so two loops may not share one, and MegaMUD reuses its
 * labels across files freely. The first keeps the bare label and the rest
 * carry a number, in name-then-file order so the numbering is the same on
 * every run.
 */
export async function loopsFromMegaMud(
  graph: WorldGraph,
  paths: readonly MegaMudPath[]
): Promise<MegaMudConversion> {
  const dropped = { start: 0, steps: 0, short: 0 };
  const found: { loop: Loop; file: string }[] = [];
  const signatures = new Signatures(graph);
  for (const path of paths) {
    const place = placed(graph, signatures, path);
    if (place === null) {
      dropped.start += 1;
      continue;
    }
    const { start, rooms } = place;
    if (rooms === null) {
      dropped.steps += 1;
      continue;
    }
    // Yielding: this runs on the thread every session's socket is read on.
    const waypoints = await reduceWaypointsYielding(graph, rooms);
    // A loop ends where it began; the runner rings round by itself.
    if (waypoints.length > 1 && waypoints.at(-1) === waypoints[0]) waypoints.pop();
    if (waypoints.length < 2) {
      dropped.short += 1;
      continue;
    }
    const title = friendlyTitle(graph, path.title, start);
    const label = title.length > 0 ? title : path.start;
    const name = path.area.length > 0 ? `${path.area}: ${label}` : label;
    const stops = waypoints.map((id) => ({ room: `${graph.byId(id)?.name ?? id} ${id}` }));
    found.push({ loop: { name, stops, category: loopCategory(name) }, file: path.file });
  }

  found.sort((a, b) =>
    a.loop.name !== b.loop.name
      ? a.loop.name < b.loop.name
        ? -1
        : 1
      : a.file < b.file
        ? -1
        : a.file > b.file
          ? 1
          : 0
  );
  let numbered = 0;
  const seen = new Map<string, number>();
  for (const entry of found) {
    const key = entry.loop.name.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) {
      entry.loop.name = `${entry.loop.name} (${count})`;
      numbered += 1;
    }
  }
  return { loops: found.map((entry) => entry.loop), dropped, numbered };
}
