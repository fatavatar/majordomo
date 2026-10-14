import { createElement, useState, type MutableRefObject } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { begin, canRedo, canUndo, record, redo, undo, type History } from '../../lib/history';
import { mergedSave, useMergedHistory, type MergedHistory } from '../useMergedHistory';

/*
 * The Character page's two files, a form and its MegaMUD settings, each with
 * its own history, and one Undo over both (2026-10-14).
 */
interface Probe {
  merged: MergedHistory;
  edit(which: 'a' | 'b', value: number): void;
  reset(which: 'a' | 'b'): void;
  values: [number, number];
}

function Harness({ out }: { out: MutableRefObject<Probe | null> }) {
  const [a, setA] = useState<History<number>>(begin(0));
  const [b, setB] = useState<History<number>>(begin(0));
  const source = (h: History<number>, set: typeof setA) => ({
    present: h.present,
    can: { undo: canUndo(h), redo: canRedo(h) },
    undo: () => set((x) => undo(x)),
    redo: () => set((x) => redo(x))
  });
  const merged = useMergedHistory({ a: source(a, setA), b: source(b, setB) });
  const same = (x: number, y: number) => x === y;
  out.current = {
    merged,
    edit: (which, value) => (which === 'a' ? setA : setB)((h) => record(h, value, same)),
    reset: (which) => (which === 'a' ? setA : setB)(begin(0)),
    values: [a.present, b.present]
  };
  return null;
}

function mount(): MutableRefObject<Probe | null> {
  const out: MutableRefObject<Probe | null> = { current: null };
  act(() => {
    create(createElement(Harness, { out }));
  });
  return out;
}

describe('one Undo over two histories', () => {
  it('undoes the last change wherever it was made, and redoes in turn', () => {
    const out = mount();
    act(() => out.current!.edit('a', 1));
    act(() => out.current!.edit('b', 2));
    act(() => out.current!.edit('a', 3));
    expect(out.current!.values).toEqual([3, 2]);
    act(() => out.current!.merged.undo());
    expect(out.current!.values).toEqual([1, 2]);
    act(() => out.current!.merged.undo());
    expect(out.current!.values).toEqual([1, 0]);
    act(() => out.current!.merged.redo());
    expect(out.current!.values).toEqual([1, 2]);
    expect(out.current!.merged.can).toEqual({ undo: true, redo: true });
  });

  it('forgets a history started again (another character loaded)', () => {
    const out = mount();
    act(() => out.current!.edit('a', 1));
    act(() => out.current!.edit('b', 2));
    act(() => out.current!.reset('b'));
    act(() => out.current!.merged.undo());
    expect(out.current!.values).toEqual([0, 0]);
    expect(out.current!.merged.can.undo).toBe(false);
  });
});

describe('one save state over two autosaves', () => {
  const save = (state: 'idle' | 'saved' | 'saving' | 'refused', error: string | null = null) => ({
    state,
    error,
    flush: () => {}
  });

  it('says the least sure of the two, a refusal with its reason', () => {
    expect(mergedSave(save('saved'), save('saving')).state).toBe('saving');
    expect(mergedSave(save('refused', 'disk full'), save('saving'))).toMatchObject({
      state: 'refused',
      error: 'disk full'
    });
    expect(mergedSave(save('idle'), save('saved')).state).toBe('saved');
  });
});
