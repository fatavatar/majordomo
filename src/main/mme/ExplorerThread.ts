/**
 * MMUD Explorer on its own thread (2026-10-18): the realm's tables and MME's
 * sums over them — a Monsters list with exp/hour was 1.3 s of main's thread,
 * the socket standing still for it — answered by `explorerWorker`, which
 * holds the facade (`Explorer.ts`) and the realm it has loaded.
 *
 * The same answers as calling the facade here, which is what is done where
 * no worker file is set (the tests): every call is the facade's own, with
 * the realm named by its file and the character as it is now. What lives in
 * main and cannot be sent — which items some counter stocks — is sent as it
 * stands (`sold`).
 */
import { Worker } from 'node:worker_threads';

import * as facade from './Explorer';
import { explorerTool } from './ExplorerTools';
import { realmFile } from './Explorer';

/** The facade's calls the thread answers, by name, each with the realm named by its file. */
export const EXPLORER_CALLS = {
  list: facade.explorerList,
  detail: facade.explorerDetail,
  wear: facade.explorerWear,
  roomView: facade.explorerRoomView,
  roomTip: facade.explorerRoomTip,
  roomSearch: facade.explorerRoomSearch,
  textblock: facade.explorerTextblock,
  room: facade.explorerRoom,
  eq: facade.explorerEq,
  eqBest: facade.explorerEqBest,
  eqWear: facade.explorerEqWear,
  compare: facade.explorerCompare,
  find: facade.explorerFind,
  items: facade.explorerItems,
  tool: explorerTool,
  hunting: facade.explorerHunting,
  huntingPools: facade.explorerHuntingPools,
  gear: (
    realm: facade.MmeRealm,
    state: Parameters<typeof facade.explorerGear>[1],
    options: Parameters<typeof facade.explorerGear>[2],
    /** What some counter stocks, from main's world; null where it has none, which keeps every item. */
    sold: readonly number[] | null
  ) => {
    const stocked = sold === null ? null : new Set(sold);
    return facade.explorerGear(realm, state, options, (item) => stocked?.has(item) ?? true);
  }
} as const;

export type ExplorerCall = keyof typeof EXPLORER_CALLS;

/** What a call takes after the realm. */
type Rest<F> = F extends (realm: facade.MmeRealm, ...rest: infer R) => unknown ? R : never;
/** What a call answers. */
type Answer<F> = F extends (...args: never[]) => Promise<infer A> ? A : never;

export interface ExplorerAsk {
  id: number;
  call: ExplorerCall;
  file: string;
  args: unknown[];
}

export type ExplorerAnswer = { id: number; value: unknown } | { id: number; error: string };

let workerFile: string | null = null;
let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

/** Where the worker's build is, beside main's; null keeps every call on this thread. */
export function setExplorerWorkerFile(file: string | null): void {
  workerFile = file;
}

/** The facade's realm for a file, on whichever thread answers. */
const realms = new Map<string, facade.MmeRealm>();
function realmAt(file: string): facade.MmeRealm {
  let realm = realms.get(file);
  if (realm === undefined) {
    realm = realmFile(file);
    realms.set(file, realm);
  }
  return realm;
}

/** Answers an ask on this thread: the worker's whole job, and main's where there is no worker. */
export async function answerHere(ask: Omit<ExplorerAsk, 'id'>): Promise<unknown> {
  const call = EXPLORER_CALLS[ask.call] as (
    realm: facade.MmeRealm,
    ...args: unknown[]
  ) => Promise<unknown>;
  return call(realmAt(ask.file), ...ask.args);
}

function theWorker(): Worker | null {
  if (worker !== null || workerFile === null) return worker;
  const started = new Worker(workerFile);
  started.unref();
  started.on('message', (message: ExplorerAnswer) => {
    const asked = waiting.get(message.id);
    if (!asked) return;
    waiting.delete(message.id);
    if ('value' in message) asked.resolve(message.value);
    else asked.reject(new Error(message.error));
  });
  const fail = (error: Error): void => {
    worker = null;
    for (const asked of waiting.values()) asked.reject(error);
    waiting.clear();
  };
  started.on('error', fail);
  started.on('exit', (code) => fail(new Error(`The Explorer's thread stopped (${code}).`)));
  worker = started;
  return worker;
}

/** One of the facade's calls, answered on the Explorer's thread, for the realm in `file`. */
export function explorerAsk<C extends ExplorerCall>(
  call: C,
  file: string,
  ...args: Rest<(typeof EXPLORER_CALLS)[C]>
): Promise<Answer<(typeof EXPLORER_CALLS)[C]>> {
  const thread = theWorker();
  if (thread === null)
    return answerHere({ call, file, args }) as Promise<Answer<(typeof EXPLORER_CALLS)[C]>>;
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const ask: ExplorerAsk = { id, call, file, args };
    thread.postMessage(ask);
  });
}
