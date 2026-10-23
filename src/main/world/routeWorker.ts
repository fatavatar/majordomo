/**
 * The route planner's own thread (`RoutePlanner`): an A* search over a realm
 * of fifty thousand rooms takes up to half a second, and on main's thread the
 * console stood still for it — eight times over when the MegaMUD engine
 * weighed every room sharing a signature (2026-10-14).
 *
 * Holds its own copy of each realm, read from the file main read, and plans
 * exactly as `WorldGraph.route` does there: the same code, the same traveller,
 * the same numbers (`tuning` comes with every ask).
 *
 * A traveller's callbacks (`danger`, `lairDamage`, `hazard`) read main's state
 * and cannot be sent, so each stands here as a question put to main: posted,
 * and waited on (`Atomics.wait`) until main writes the answer into the buffer
 * the two share. Main is free meanwhile; this thread is the one that waits.
 * An answer is kept for the rest of its plan, which asks against one state,
 * and the rooms near one asked about are asked with it (`Asker.fetch`).
 */
import { parentPort, workerData } from 'node:worker_threads';

import { setTuning } from '../app/tuning';
import type { WorldRoom } from '../../shared/world';
import { WorldGraph } from './WorldGraph';
import type { RouteAsk, RouteAnswer, RouteCall } from './RoutePlanner';

const graphs = new Map<string, WorldGraph>();
const shared = (workerData as { answer: SharedArrayBuffer } | undefined)?.answer;
const flag = shared ? new Int32Array(shared, 0, 1) : null;
const values = shared ? new Float64Array(shared, 8) : null;

/**
 * The rooms each callback can answer for at all (`Traveller`'s contract):
 * any other is null without asking. A plan expands most of a realm, and
 * asking main of every room cost 187,462 round trips for three plans
 * (2026-10-14); the lairs and the rooms with a spell are what is left.
 */
const ASKED_FOR: Readonly<Record<string, (room: WorldRoom) => boolean>> = {
  danger: (room) => Boolean(room.lair),
  lairDamage: (room) => Boolean(room.lair),
  hazard: (room) => room.spell !== undefined
};

/** How far round a room asked about its neighbours are asked about with it. */
const NEAR_STEPS = 6;

/** One plan's questions to main: each answer kept for the rest of the plan. */
class Asker {
  private readonly kept = new Map<string, number | null>();

  constructor(
    private readonly id: number,
    private readonly names: readonly string[],
    private readonly graph: WorldGraph
  ) {}

  private wanted(name: string, room: WorldRoom): boolean {
    const asked = ASKED_FOR[name];
    return asked === undefined || asked(room);
  }

  answer(name: string, room: WorldRoom): number | null {
    if (!this.wanted(name, room)) return null;
    const key = `${name}|${room.map}/${room.room}`;
    if (!this.kept.has(key)) this.fetch(room);
    return this.kept.get(key) ?? null;
  }

  /**
   * This room and those near it that any callback answers for, asked at once
   * (`RouteCall`): the A* expands outward, so the rooms round one asked about
   * are the next asked. Main writes a number per room and callback (`NaN`
   * for null) into the shared buffer and wakes this thread.
   */
  private fetch(start: WorldRoom): void {
    if (flag === null || values === null) {
      for (const name of this.names) this.kept.set(`${name}|${start.map}/${start.room}`, null);
      return;
    }
    const most = Math.floor(values.length / Math.max(1, this.names.length));
    const rooms: WorldRoom[] = [];
    const seen = new Set<string>();
    let ring: WorldRoom[] = [start];
    seen.add(`${start.map}/${start.room}`);
    for (let step = 0; step <= NEAR_STEPS && ring.length > 0 && rooms.length < most; step += 1) {
      const next: WorldRoom[] = [];
      for (const room of ring) {
        if (rooms.length >= most) break;
        const id = `${room.map}/${room.room}`;
        const due = this.names.some(
          (name) => this.wanted(name, room) && !this.kept.has(`${name}|${id}`)
        );
        if (due || room === start) rooms.push(room);
        for (const exit of room.exits) {
          const to = `${exit.map}/${exit.room}`;
          if (seen.has(to)) continue;
          seen.add(to);
          const there = this.graph.get(exit.map, exit.room);
          if (there !== undefined) next.push(there);
        }
      }
      ring = next;
    }
    Atomics.store(flag, 0, 0);
    parentPort?.postMessage({
      call: this.id,
      names: [...this.names],
      rooms: rooms.map((room): [number, number] => [room.map, room.room])
    } satisfies RouteCall);
    Atomics.wait(flag, 0, 0);
    rooms.forEach((room, i) => {
      this.names.forEach((name, j) => {
        const value = values[i * this.names.length + j]!;
        this.kept.set(`${name}|${room.map}/${room.room}`, Number.isNaN(value) ? null : value);
      });
    });
  }
}

parentPort?.on('message', (ask: RouteAsk) => {
  let answer: RouteAnswer;
  try {
    if (ask.tuning !== undefined) setTuning(ask.tuning);
    let graph = graphs.get(ask.file);
    if (graph === undefined) {
      graph = WorldGraph.load(ask.file);
      graphs.set(ask.file, graph);
    }
    const traveller: Record<string, unknown> = { ...ask.traveller };
    const asker = new Asker(ask.id, ask.callbacks, graph);
    for (const name of ask.callbacks) {
      traveller[name] = (room: WorldRoom): number | null => asker.answer(name, room);
    }
    answer = { id: ask.id, route: graph.route(ask.from, ask.to, traveller, ask.options) };
  } catch (error) {
    answer = { id: ask.id, error: error instanceof Error ? error.message : String(error) };
  }
  parentPort?.postMessage(answer);
});
