/**
 * The route planner's own thread (`RoutePlanner`): an A* search over a realm
 * of fifty thousand rooms takes up to half a second, and on main's thread the
 * console stood still for it — eight times over when the MegaMUD engine
 * weighed every room sharing a signature (2026-10-14).
 *
 * Holds its own copy of each realm, read from the file main read, and plans
 * exactly as `WorldGraph.route` does there: the same code, the same traveller,
 * the same numbers (`tuning` comes with every ask).
 */
import { parentPort } from 'node:worker_threads';

import { setTuning } from '../app/tuning';
import { WorldGraph } from './WorldGraph';
import type { RouteAsk, RouteAnswer } from './RoutePlanner';

const graphs = new Map<string, WorldGraph>();

parentPort?.on('message', (ask: RouteAsk) => {
  let answer: RouteAnswer;
  try {
    if (ask.tuning !== undefined) setTuning(ask.tuning);
    let graph = graphs.get(ask.file);
    if (graph === undefined) {
      graph = WorldGraph.load(ask.file);
      graphs.set(ask.file, graph);
    }
    answer = { id: ask.id, route: graph.route(ask.from, ask.to, ask.traveller, ask.options) };
  } catch (error) {
    answer = { id: ask.id, error: error instanceof Error ? error.message : String(error) };
  }
  parentPort?.postMessage(answer);
});
