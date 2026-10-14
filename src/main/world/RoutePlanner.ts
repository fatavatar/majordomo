/**
 * Routes planned off main's thread (`routeWorker.ts`), so a long search no
 * longer holds the console still while it runs. The plan is
 * `WorldGraph.route`'s own, unchanged; only where it runs moves.
 *
 * A graph read from no file (one built in memory, as the tests do) and a
 * build with no worker are planned here as before, answered on the next turn
 * of the event loop so a caller sees one behaviour either way.
 */
import { Worker } from 'node:worker_threads';

import { tuning } from '../app/tuning';
import type { TuningConfig } from '../../shared/internal';
import type { RoomId, Route, WorldRoom } from '../../shared/world';
import type { RouteOptions, Traveller, WorldGraph } from './WorldGraph';

export interface RouteAsk {
  id: number;
  file: string;
  from: RoomId;
  to: RoomId;
  /** The traveller with its callbacks taken off: they are asked of main instead (`RouteCall`). */
  traveller: Traveller;
  /** The names of the callbacks it had. */
  callbacks: string[];
  options: RouteOptions;
  tuning: TuningConfig;
}

export type RouteAnswer = { id: number; route: Route } | { id: number; error: string };

/**
 * The worker asking a plan's callbacks about rooms, waiting on the shared
 * buffer: a number per room and callback, in that order (`NaN` for null).
 */
export interface RouteCall {
  call: number;
  names: string[];
  rooms: [number, number][];
}

let workerFile: string | null = null;
let worker: Worker | null = null;
let nextId = 0;
interface Waiting {
  resolve(route: Route): void;
  reject(error: Error): void;
  world: WorldGraph;
  callbacks: Record<string, (room: WorldRoom) => number | null>;
}
const waiting = new Map<number, Waiting>();
/** Where main writes the callbacks' answers for the worker: a flag, then the numbers. */
let answer: { flag: Int32Array; values: Float64Array } | null = null;
/** How many answers one ask of the worker's can carry back. */
const ANSWERS_AT_ONCE = 8192;

/** Where the built worker is (`index.ts`); unset, routes are planned on main's thread. */
export function setRouteWorkerFile(file: string | null): void {
  workerFile = file;
}

function theWorker(): Worker | null {
  if (worker !== null || workerFile === null) return worker;
  const buffer = new SharedArrayBuffer(8 + 8 * ANSWERS_AT_ONCE);
  answer = { flag: new Int32Array(buffer, 0, 1), values: new Float64Array(buffer, 8) };
  const started = new Worker(workerFile, { workerData: { answer: buffer } });
  started.unref();
  started.on('message', (message: RouteAnswer | RouteCall) => {
    if ('call' in message) {
      answerCall(message);
      return;
    }
    const asked = waiting.get(message.id);
    if (!asked) return;
    waiting.delete(message.id);
    if ('route' in message) asked.resolve(message.route);
    else asked.reject(new Error(message.error));
  });
  const fail = (error: Error): void => {
    worker = null;
    for (const asked of waiting.values()) asked.reject(error);
    waiting.clear();
  };
  started.on('error', fail);
  started.on('exit', (code) => fail(new Error(`The route planner stopped (${code}).`)));
  worker = started;
  return worker;
}

/** A callback asked by the worker, answered from main's own state and room. */
function answerCall(call: RouteCall): void {
  if (answer === null) return;
  const asked = waiting.get(call.call);
  call.rooms.forEach(([map, number], i) => {
    const room = asked?.world.get(map, number);
    call.names.forEach((name, j) => {
      let result: number | null = null;
      try {
        const callback = asked?.callbacks[name];
        if (room !== undefined && callback !== undefined) result = callback(room);
      } catch {
        // A callback that throws answers nothing, as a room it cannot price.
        result = null;
      }
      answer!.values[i * call.names.length + j] = result ?? Number.NaN;
    });
  });
  Atomics.store(answer.flag, 0, 1);
  Atomics.notify(answer.flag, 0);
}

/** `world.route(from, to, traveller, options)`, planned on the worker's thread. */
export function planRoute(
  world: WorldGraph,
  from: RoomId,
  to: RoomId,
  traveller: Traveller = {},
  options: RouteOptions = {}
): Promise<Route> {
  const thread = world.file === undefined ? null : theWorker();
  if (thread === null) {
    return new Promise((resolve, reject) =>
      setImmediate(() => {
        try {
          resolve(world.route(from, to, traveller, options));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
    );
  }
  const id = (nextId += 1);
  // The traveller's callbacks stay here, to be asked by the worker (`RouteCall`).
  const plain: Record<string, unknown> = {};
  const callbacks: Waiting['callbacks'] = {};
  for (const [key, value] of Object.entries(traveller)) {
    if (typeof value === 'function') callbacks[key] = value as Waiting['callbacks'][string];
    else plain[key] = value;
  }
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, world, callbacks });
    const ask: RouteAsk = {
      id,
      file: world.file!,
      from,
      to,
      traveller: plain as Traveller,
      callbacks: Object.keys(callbacks),
      options,
      tuning: tuning()
    };
    thread.postMessage(ask);
  });
}
