// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionSummary } from '@shared/ipc';

import { useView, type View } from '../useView';
import { renderHook, summary, type RenderedHook } from './renderHook';

const tabs = (...ids: string[]): SessionSummary[] =>
  ids.map((id) => summary(id, 'Skinny Inc', 'connected'));

describe('useView', () => {
  let rendered: RenderedHook<SessionSummary[], View> | null = null;
  const mount = (sessions: SessionSummary[]): RenderedHook<SessionSummary[], View> => {
    rendered = renderHook((given: SessionSummary[]) => useView(given), sessions);
    return rendered;
  };
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    rendered?.unmount();
    rendered = null;
  });

  const rows = (view: View) => view.rows?.map((entry) => entry.id) ?? null;

  it('shows the first character alone until told otherwise', () => {
    const shown = mount(tabs('a', 'b', 'c'));
    expect([shown.current.session, rows(shown.current)]).toEqual(['a', null]);
    act(() => shown.current.showSession('c'));
    expect([shown.current.session, rows(shown.current)]).toEqual(['c', null]);
  });

  it('groups a character added to the view, its tabs together, and a tab click shows it', () => {
    const shown = mount(tabs('a', 'b', 'c'));
    act(() => shown.current.addToView('c'));
    expect(rows(shown.current)).toEqual(['a', 'c']);
    expect(shown.current.groups).toEqual([['a', 'c']]);
    expect(shown.current.order.map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
    // The keyboard stays where it was.
    expect(shown.current.session).toBe('a');

    // Another tab alone, then a member's tab: the group, the keyboard on that row.
    act(() => shown.current.showSession('b'));
    expect([shown.current.session, rows(shown.current)]).toEqual(['b', null]);
    act(() => shown.current.showSession('c'));
    expect([shown.current.session, rows(shown.current)]).toEqual(['c', ['a', 'c']]);
    act(() => shown.current.focusRow('a'));
    expect(shown.current.session).toBe('a');
  });

  it('takes one out, the keyboard staying with the group, and undoes a group of one', () => {
    const shown = mount(tabs('a', 'b', 'c'));
    act(() => shown.current.addToView('b'));
    act(() => shown.current.addToView('c'));
    expect(rows(shown.current)).toEqual(['a', 'b', 'c']);
    act(() => shown.current.removeFromView('a'));
    expect([shown.current.session, rows(shown.current)]).toEqual(['b', ['b', 'c']]);
    act(() => shown.current.removeFromView('c'));
    expect([shown.current.session, rows(shown.current), shown.current.groups]).toEqual([
      'b',
      null,
      []
    ]);
  });

  it('opens a member alone as one Escape goes back from', () => {
    const shown = mount(tabs('a', 'b'));
    act(() => shown.current.addToView('b'));
    act(() => shown.current.openAlone('b'));
    expect([shown.current.session, rows(shown.current), shown.current.fromGroup]).toEqual([
      'b',
      null,
      true
    ]);
    act(() => shown.current.backToGroup());
    expect([rows(shown.current), shown.current.fromGroup]).toEqual([['a', 'b'], false]);
  });

  it('shows a group alone while only one of it is loaded, and the group again once both are', () => {
    const shown = mount(tabs('a', 'b'));
    act(() => shown.current.addToView('b'));
    shown.rerender(tabs('a'));
    expect([shown.current.session, rows(shown.current), shown.current.groups]).toEqual([
      'a',
      null,
      []
    ]);
    shown.rerender(tabs('a', 'b'));
    expect(rows(shown.current)).toEqual(['a', 'b']);
  });

  // The first tab, standing in for no choice, is kept when the rail is reordered (2026-11-10).
  it('keeps the character shown when another tab is moved to the front', () => {
    const shown = mount(tabs('a', 'b'));
    expect(shown.current.session).toBe('a');
    shown.rerender(tabs('b', 'a'));
    expect(shown.current.session).toBe('a');
  });

  it('comes back to what was on screen after a reload', () => {
    const first = mount(tabs('a', 'b', 'c'));
    act(() => first.current.addToView('c'));
    act(() => first.current.showSession('c'));
    first.unmount();

    rendered = null;
    const again = mount(tabs('a', 'b', 'c'));
    expect([again.current.session, rows(again.current)]).toEqual(['c', ['a', 'c']]);
  });
});
