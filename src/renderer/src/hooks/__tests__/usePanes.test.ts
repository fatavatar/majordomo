// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionSummary } from '@shared/ipc';
import type { ConnectionPhase } from '@shared/types';

import { usePanes, type Panes } from '../usePanes';
import { renderHook, summary, type RenderedHook } from './renderHook';

/** Each character's tab, and the view the Stable reads its phase from. */
function realm(...entries: Array<[string, ConnectionPhase]>) {
  const sessions = entries.map(([id, phase]) => summary(id, 'Skinny Inc', phase));
  const views = Object.fromEntries(sessions.map((entry) => [entry.id, { state: entry.state }]));
  return { sessions, views };
}
type Props = ReturnType<typeof realm>;

describe('usePanes', () => {
  let rendered: RenderedHook<Props, Panes> | null = null;
  const mount = (props: Props): RenderedHook<Props, Panes> => {
    rendered = renderHook(({ sessions, views }: Props) => usePanes(sessions, views), props);
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

  const ids = (list: readonly SessionSummary[]) => list.map((entry) => entry.id);

  it('shows the first character until told otherwise, and places, swaps and closes panes', () => {
    const shown = mount(realm(['a', 'connected'], ['b', 'connected'], ['c', 'connected']));
    expect([shown.current.panes, shown.current.session]).toEqual([['a'], 'a']);

    act(() => shown.current.placePane('b'));
    expect([shown.current.panes, shown.current.paneAt, shown.current.session]).toEqual([
      ['a', 'b'],
      1,
      'b'
    ]);
    // Shown in the pane with the keyboard, which a character already on screen only focuses.
    act(() => shown.current.showSession('c'));
    expect([shown.current.panes, shown.current.session]).toEqual([['a', 'c'], 'c']);
    act(() => shown.current.showSession('a'));
    expect([shown.current.panes, shown.current.session]).toEqual([['a', 'c'], 'a']);

    act(() => shown.current.closePane());
    expect([shown.current.panes, shown.current.session]).toEqual([['c'], 'c']);
    // The last pane stays.
    act(() => shown.current.closePane());
    expect(shown.current.panes).toEqual(['c']);
  });

  it('drops a pane whose character has gone', () => {
    const shown = mount(realm(['a', 'connected'], ['b', 'connected']));
    act(() => shown.current.placePane('b'));
    shown.rerender(realm(['a', 'connected']));
    expect([shown.current.panes, shown.current.session]).toEqual([['a'], 'a']);
  });

  it('shows the Stable with a row for each character in the realm, and leaves one out', () => {
    const shown = mount(
      realm(['a', 'connected'], ['b', 'connected'], ['c', 'closed'], ['d', 'connecting'])
    );
    act(() => shown.current.showStable());
    expect(shown.current.stableOn).toBe(true);
    expect(ids(shown.current.stableRows)).toEqual(['a', 'b', 'd']);
    expect(ids(shown.current.stableAway)).toEqual(['c']);

    act(() => shown.current.focusPane('b'));
    expect(shown.current.session).toBe('b');
    // Left out, it has no row, and the keyboard goes to the first row left.
    act(() => shown.current.leaveOut('b'));
    expect(ids(shown.current.stableRows)).toEqual(['a', 'd']);
    expect(ids(shown.current.stableLeftOut)).toEqual(['b']);
    expect(shown.current.session).toBe('a');
    act(() => shown.current.bringBack('b'));
    expect(ids(shown.current.stableRows)).toEqual(['a', 'b', 'd']);
  });

  it('opens a character from the Stable as one Escape goes back from', () => {
    const shown = mount(realm(['a', 'connected'], ['b', 'connected']));
    act(() => shown.current.showStable());
    act(() => shown.current.showSession('b'));
    expect([shown.current.stableOn, shown.current.fromStable, shown.current.session]).toEqual([
      false,
      true,
      'b'
    ]);
    act(() => shown.current.showStable());
    expect([shown.current.stableOn, shown.current.fromStable]).toEqual([true, false]);
  });

  it('comes back to what was on screen after a reload', () => {
    const props = realm(['a', 'connected'], ['b', 'connected']);
    const first = mount(props);
    act(() => first.current.placePane('b'));
    act(() => first.current.showStable());
    first.unmount();

    rendered = null;
    const again = mount(props);
    expect([again.current.panes, again.current.paneAt, again.current.stableOn]).toEqual([
      ['a', 'b'],
      1,
      true
    ]);
  });
});
