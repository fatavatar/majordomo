import { useCallback, useEffect, useRef, useState } from 'react';

import type { AutoSave, SaveState } from './useAutoSave';

/**
 * Two undo histories as one, for a page that edits two files: the Character
 * page, whose MegaMUD rows save to the character's MegaMUD settings and whose
 * own sections to the rest of its file (2026-10-14). One Undo, one Redo and
 * one save state, where there were two bars on every row and which one
 * undid the last change was the player's to work out.
 *
 * Which history the last change went to is learned by watching each one's
 * present: a new present that this hook did not ask for is an edit, and one
 * with nothing to undo or redo is a fresh start (another character loaded),
 * which forgets that history's place in the order.
 */
export interface HistorySource {
  /** The value being edited; a new one is a change. */
  present: unknown;
  can: { undo: boolean; redo: boolean };
  undo(): void;
  redo(): void;
}

export interface MergedHistory {
  can: { undo: boolean; redo: boolean };
  undo(): void;
  redo(): void;
}

export function useMergedHistory<K extends string>(
  sources: Readonly<Record<K, HistorySource>>
): MergedHistory {
  const [order, setOrder] = useState<{ undo: K[]; redo: K[] }>({ undo: [], redo: [] });
  const seen = useRef(new Map<K, unknown>());
  /** The changes this hook asked for, one per source, so they are not taken for edits. */
  const asked = useRef(new Set<K>());

  useEffect(() => {
    for (const key of Object.keys(sources) as K[]) {
      const source = sources[key];
      const was = seen.current.get(key);
      seen.current.set(key, source.present);
      if (was === source.present) continue;
      if (asked.current.delete(key)) continue;
      const without = (list: K[]): K[] => list.filter((k) => k !== key);
      if (!source.can.undo && !source.can.redo) {
        setOrder((o) => ({ undo: without(o.undo), redo: without(o.redo) }));
      } else {
        setOrder((o) => ({ undo: [...o.undo, key], redo: without(o.redo) }));
      }
    }
  });

  const latest = useRef(sources);
  latest.current = sources;

  // Read through, so a step acts on the order as it is and not on a render's copy.
  const now = useRef(order);
  now.current = order;

  const step = useCallback((from: 'undo' | 'redo') => {
    const o = now.current;
    const key = o[from].at(-1);
    if (key === undefined) return;
    asked.current.add(key);
    if (from === 'undo') latest.current[key].undo();
    else latest.current[key].redo();
    const to = from === 'undo' ? 'redo' : 'undo';
    const next = { ...o, [from]: o[from].slice(0, -1), [to]: [...o[to], key] };
    now.current = next;
    setOrder(next);
  }, []);

  return {
    can: { undo: order.undo.length > 0, redo: order.redo.length > 0 },
    undo: useCallback(() => step('undo'), [step]),
    redo: useCallback(() => step('redo'), [step])
  };
}

/** How sure each state is that what is shown is on disk: the least sure of two wins. */
const DOUBT: Readonly<Record<SaveState, number>> = {
  idle: 0,
  saved: 1,
  pending: 2,
  saving: 3,
  refused: 4
};

/** Two autosaves as one state: the doubtful one speaks, a refusal with its reason. */
export function mergedSave(a: AutoSave, b: AutoSave): AutoSave {
  const louder = DOUBT[b.state] > DOUBT[a.state] ? b : a;
  return {
    state: louder.state,
    error: louder.error,
    flush: () => {
      a.flush();
      b.flush();
    }
  };
}
