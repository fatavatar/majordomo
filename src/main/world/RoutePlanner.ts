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
import type { RoomId, Route } from '../../shared/world';
import type { RouteOptions, Traveller, WorldGraph } from './WorldGraph';

export interface RouteAsk {
  id: number;
  file: string;
  from: RoomId;
  to: RoomId;
  traveller: Traveller;
  options: RouteOptions;
  tuning: TuningConfig;
}

export type RouteAnswer = { id: number; route: Route } | { id: number; error: string };

let workerFile: string | null = null;
let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve(route: Route): void; reject(error: Error): void }>();

/** Where the built worker is (`index.ts`); unset, routes are planned on main's thread. */
export function setRouteWorkerFile(file: string | null): void {
  workerFile = file;
}

function theWorker(): Worker | null {
  if (worker !== null || workerFile === null) return worker;
  const started = new Worker(workerFile);
  started.unref();
  started.on('message', (answer: RouteAnswer) => {
    const asked = waiting.get(answer.id);
    if (!asked) return;
    waiting.delete(answer.id);
    if ('route' in answer) asked.resolve(answer.route);
    else asked.reject(new Error(answer.error));
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
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    const ask: RouteAsk = {
      id,
      file: world.file!,
      from,
      to,
      traveller,
      options,
      tuning: tuning()
    };
    thread.postMessage(ask);
  });
}
