/**
 * The character on screen when the window last drew, and whether it was shown
 * alone out of its group, so a reload, a browser tab the browser discarded, a
 * remount after a lost web socket, or a relaunch comes back to it instead of
 * the first tab in the rail (`useView`).
 *
 * Kept per tab first (`sessionStorage`), since two browser tabs showing two
 * characters would otherwise each come back to the other's; the window's
 * `localStorage` copy is what a new tab or a relaunch starts from. A stored id
 * no longer loaded is dropped by `useView`'s own check.
 */
import type { SessionId } from '@shared/ipc';

import { readStored, writeStored, type StorageArea } from './storage';

const KEY = 'mudengine.shown';

export interface Shown {
  session: SessionId | null;
  /** Opened alone from its group, which Escape goes back to. */
  alone: boolean;
}

const NOTHING = (): Shown => ({ session: null, alone: false });

export function parseShown(stored: string): Shown {
  const parsed = JSON.parse(stored) as {
    session?: unknown;
    alone?: unknown;
    panes?: unknown;
    at?: unknown;
  } | null;
  if (typeof parsed?.session === 'string') {
    return { session: parsed.session, alone: parsed.alone === true };
  }
  // Written before tab groups (2026-11-09): the pane with the keyboard.
  const panes = Array.isArray(parsed?.panes) ? (parsed.panes as unknown[]) : [];
  const at = typeof parsed?.at === 'number' && Number.isInteger(parsed.at) ? parsed.at : 0;
  const was = panes[at] ?? panes[0];
  return { session: typeof was === 'string' ? was : null, alone: false };
}

const readFrom = (area: StorageArea): Shown => readStored(KEY, parseShown, NOTHING, area);

export function readShown(): Shown {
  const own = readFrom('session');
  return own.session !== null ? own : readFrom('local');
}

export function writeShown(shown: Shown): void {
  const text = JSON.stringify(shown);
  writeStored(KEY, text, 'session');
  writeStored(KEY, text, 'local');
}
