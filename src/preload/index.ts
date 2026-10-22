/**
 * The only bridge between the sandboxed renderer and the main process.
 *
 * Every `IpcApi` method, built from the channel tables in `shared/ipc.ts`
 * (`bridgeOver`) over Electron's IPC: a call is `ipcRenderer.invoke`, a
 * one-way message `ipcRenderer.send`, and a subscription returns an
 * unsubscribe function so React effects can clean up without leaking
 * listeners across hot reloads. The browser tab's bridge is the same builder
 * over a WebSocket (`renderer/src/lib/webBridge.ts`).
 *
 * Anything belonging to a session takes its id as the first argument, and every
 * pushed payload arrives as `Addressed<T>`. That is the contract's doing, not a
 * convention observed here — a call that forgets which character it means does
 * not compile.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { bridgeOver } from '../shared/ipc';

function subscribe(channel: string, handler: (payload: never) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => handler(payload as never);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = bridgeOver(
  {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    subscribe
  },
  // The preload is only ever Electron's; the web bridge says `web` of itself.
  { host: 'electron' }
);

contextBridge.exposeInMainWorld('mudengine', api);
