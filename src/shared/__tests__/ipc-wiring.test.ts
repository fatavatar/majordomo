import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { bridgeOver, Invoke, Push, pushMethod, Send, type IpcApi } from '../ipc';

/**
 * Channel names and payload types are declared together so a mismatch is a
 * compile error. What the type system cannot see is whether the *other end*
 * exists: `IpcApi` forces a bridge to expose every method, but nothing
 * forces main to handle it. A channel with no handler is an `invoke` that
 * rejects at runtime, on a path somebody only reaches by pressing the thing.
 *
 * Two bridges since 2026-09-07 — the preload for the desktop and the web
 * bridge for a browser tab — and both are `bridgeOver` (2026-10-22), built
 * from the channel tables, so neither can miss a channel the other carries.
 * What is checked of them here is that the builder routes every channel.
 *
 * Read as source text, deliberately. Importing `src/main/client.ts` would
 * start the client.
 */
const read = (file: string): string => fs.readFileSync(path.resolve(file), 'utf8');
const main = read('src/main/client.ts');
const preload = read('src/preload/index.ts');
const web = read('src/renderer/src/lib/webBridge.ts');

/**
 * What the web bridge answers in the window rather than over the socket,
 * each for a stated reason (`webBridge.ts` header): the clipboard is the
 * tab's, the picker browses the client's disk through `browseHome`, and the
 * Explorer's own window is a pop-up of the tab's (2026-10-29). Each
 * still has to be a method on the bridge; it is only the channel constant it
 * does not name.
 */
const ANSWERED_IN_THE_WINDOW = [
  'copyText',
  'pasteText',
  'chooseRealm',
  'raiseWindow',
  'explorerWindow'
] as const;

/** Whether a file mentions `Invoke.name`, `Send.name` or `Push.name`. */
const mentions = (source: string, group: string, key: string): boolean =>
  new RegExp(`\\b${group}\\.${key}\\b`).test(source);

/** Whether a bridge defines the method at all, by whichever route. */
const defines = (source: string, key: string): boolean =>
  new RegExp(`^\\s+${key}:`, 'm').test(source);

describe('the IPC contract is wired at both ends', () => {
  it('has channels to check', () => {
    expect(Object.keys(Invoke).length).toBeGreaterThan(20);
  });

  it('handles every invocable channel in main', () => {
    const missing = Object.keys(Invoke).filter((key) => !mentions(main, 'Invoke', key));
    expect(missing, `no handler in main for: ${missing.join(', ')}`).toEqual([]);
  });

  it('answers in the web bridge itself only what it says it does', () => {
    const undefinedLocally = ANSWERED_IN_THE_WINDOW.filter((key) => !defines(web, key));
    expect(
      undefinedLocally,
      `the web bridge does not answer: ${undefinedLocally.join(', ')}`
    ).toEqual([]);
  });

  it('listens for every one-way channel', () => {
    const missing = Object.keys(Send).filter((key) => !mentions(main, 'Send', key));
    expect(missing, `nothing in main listens for: ${missing.join(', ')}`).toEqual([]);
  });

  /*
   * A push nothing ever sends is a subscription the renderer holds open for a
   * message that cannot arrive — which looks exactly like a feature that is
   * merely quiet.
   */
  it('sends every push from somewhere in main', () => {
    const sources = [main, ...sessionSources()].join('\n');
    const missing = Object.keys(Push).filter((key) => !mentions(sources, 'Push', key));
    expect(missing, `nothing ever pushes: ${missing.join(', ')}`).toEqual([]);
  });

  /*
   * The bridge says which host it is, and only the value that is true of it.
   * A preload claiming `web` would hide every desktop control on the desktop.
   */
  it('each bridge states its own host kind', () => {
    expect(/host: 'electron'/.test(preload)).toBe(true);
    expect(/host: 'web'/.test(web)).toBe(true);
  });
});

describe('the bridge built from the channel tables', () => {
  const heard: Array<[string, string, unknown[]]> = [];
  const api = bridgeOver(
    {
      invoke: (channel, ...args) => {
        heard.push(['invoke', channel, args]);
        return Promise.resolve(null);
      },
      send: (channel, ...args) => {
        heard.push(['send', channel, args]);
      },
      subscribe: (channel) => {
        heard.push(['subscribe', channel, []]);
        return () => {};
      }
    },
    { host: 'web' }
  ) as unknown as Record<string, (...args: unknown[]) => unknown>;

  it('calls every invocable channel by its own name, arguments as given', () => {
    for (const [key, channel] of Object.entries(Invoke)) {
      heard.length = 0;
      void api[key]!('s1', 2);
      expect(heard, key).toEqual([['invoke', channel, ['s1', 2]]]);
    }
  });

  it('sends every one-way channel by its own name', () => {
    for (const [key, channel] of Object.entries(Send)) {
      heard.length = 0;
      api[key]!('s1');
      expect(heard, key).toEqual([['send', channel, ['s1']]]);
    }
  });

  it('subscribes to every push as on…', () => {
    for (const [key, channel] of Object.entries(Push)) {
      heard.length = 0;
      const off = api[pushMethod(key)]!(() => {});
      expect(typeof off, key).toBe('function');
      expect(heard, key).toEqual([['subscribe', channel, []]]);
    }
  });

  it('keeps what a bridge answers itself', () => {
    const own = bridgeOver(
      { invoke: () => Promise.resolve(null), send: () => {}, subscribe: () => () => {} },
      { host: 'electron', copyText: async () => {} }
    ) as IpcApi;
    expect(own.host).toBe('electron');
    expect(own.copyText.toString()).toContain('async');
  });
});

/** Main is not the only thing that pushes; the session layer does most of it. */
function sessionSources(): string[] {
  const dir = path.resolve('src/main');
  const files: string[] = [];
  const walk = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) files.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return files;
}
