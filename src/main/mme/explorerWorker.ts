/**
 * MMUD Explorer's own thread (`ExplorerThread`, 2026-10-18): the realm's
 * tables loaded once and MME's sums over them, one ask at a time, off main's
 * thread, where a Monsters list with exp/hour held the socket for over a
 * second. The facade's own calls, with the realm named by its file.
 */
import { parentPort } from 'node:worker_threads';

import { answerHere, type ExplorerAnswer, type ExplorerAsk } from './ExplorerThread';

parentPort?.on('message', (ask: ExplorerAsk) => {
  void answerHere(ask).then(
    (value) => parentPort?.postMessage({ id: ask.id, value } satisfies ExplorerAnswer),
    (error: unknown) =>
      parentPort?.postMessage({
        id: ask.id,
        error: error instanceof Error ? error.message : String(error)
      } satisfies ExplorerAnswer)
  );
});
