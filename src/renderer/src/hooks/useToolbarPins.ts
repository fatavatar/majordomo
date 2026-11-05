import { useCallback, useMemo, useState } from 'react';

import { pinnedMatches } from '@shared/internal';
import type { SessionId } from '@shared/ipc';

import { asDeviations, readDeviations, isPinned, withPin, type PinDeviations } from '../lib/pins';

/**
 * Which toolbar buttons are drawn, and which live behind the kebab.
 *
 * The palette's shelf rule, applied to a row of glyphs: `internal.yaml` states
 * what a fresh client draws, a click on the kebab's row moves a button on or
 * off, and the deviation is stored **against what the file said at the time**
 * so an edit to the file is not silently ignored for ever after the first
 * click. `lib/pins.ts` is that decision and is shared rather than copied —
 * two implementations of it would eventually disagree about what an edit
 * means.
 *
 * The one difference from the palette is the shape of the shipped list: a
 * palette command belongs to a group and is matched per group, and a toolbar
 * button belongs to no group because the row *is* the group. So the patterns
 * are one flat list.
 *
 * **Per character** (2026-11-05), not per client. In the Stable every
 * character's console wears its own row, and a healer's row and a fighter's
 * are different rows: kept per client, a button pinned over one console
 * turned up over all of them, and over whichever character was shown next. Not
 * in a file, as before, because it is chrome rather than a setting.
 */
const KEY = 'mudengine.toolbar.pinsByCharacter';

/**
 * Where the row was kept while it was one row for every character. Read and
 * never written: a character with no row of its own yet starts from it, so the
 * buttons somebody had already arranged are where they left them.
 */
const CLIENT_KEY = 'mudengine.toolbar.pins';

export interface PinnedToolbars {
  /** The button ids on this character's row, as a set — the same set while nothing changes. */
  pinnedFor(session: SessionId): ReadonlySet<string>;
  /** Moves a button on or off this character's row, and no other's. */
  toggle(session: SessionId, id: string): void;
}

/** The row as the file states it. */
export function shippedToolbar(patterns: readonly string[], ids: readonly string[]): Set<string> {
  const kept = new Set<string>();
  for (const id of ids) {
    if (patterns.some((pattern) => pinnedMatches(pattern, id))) kept.add(id);
  }
  return kept;
}

/** Each character's clicks, from whatever `localStorage` holds; untrusted, like `readDeviations`. */
export function readByCharacter(stored: string | null): Record<string, PinDeviations> {
  if (stored === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const kept: Record<string, PinDeviations> = {};
  for (const [session, value] of Object.entries(parsed as Record<string, unknown>)) {
    kept[session] = asDeviations(value);
  }
  return kept;
}

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode, or storage disabled. The shipped row is the fallback.
    return null;
  }
}

export function useToolbarPins(
  patterns: readonly string[],
  ids: readonly string[]
): PinnedToolbars {
  const [shared] = useState<PinDeviations>(() => readDeviations(stored(CLIENT_KEY)));
  const [own, setOwn] = useState<Record<string, PinDeviations>>(() => readByCharacter(stored(KEY)));

  /*
   * One set per record of clicks rather than per character, so every
   * character still on the shared row is handed the same set, and a click on
   * one character's row leaves every other character's set as it was.
   */
  const rows = useMemo(
    () => ({
      shipped: shippedToolbar(patterns, ids),
      sets: new WeakMap<PinDeviations, ReadonlySet<string>>()
    }),
    [patterns, ids]
  );
  const pinnedFor = useCallback(
    (session: SessionId): ReadonlySet<string> => {
      const deviations = own[session] ?? shared;
      const known = rows.sets.get(deviations);
      if (known) return known;
      const kept = new Set<string>();
      for (const id of ids) {
        if (isPinned(id, rows.shipped.has(id), deviations)) kept.add(id);
      }
      rows.sets.set(deviations, kept);
      return kept;
    },
    [rows, ids, own, shared]
  );

  const toggle = useCallback(
    (session: SessionId, id: string) => {
      setOwn((current) => {
        // Recomputed here rather than closed over, so a config push landing
        // between the render and the click cannot make the click record what
        // the file no longer says.
        const shipped = shippedToolbar(patterns, ids).has(id);
        const was = current[session] ?? shared;
        const next = {
          ...current,
          [session]: withPin(was, id, shipped, !isPinned(id, shipped, was))
        };
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          // The choice still applies for as long as the window is open.
        }
        return next;
      });
    },
    [patterns, ids, shared]
  );

  return { pinnedFor, toggle };
}
