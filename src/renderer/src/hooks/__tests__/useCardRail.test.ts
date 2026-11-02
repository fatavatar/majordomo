// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TerminalHandle } from '../../components/TerminalView';
import { TUCK_SETTLE_MS, useCardRail, type CardRail } from '../useCardRail';
import { renderHook, type RenderedHook } from './renderHook';

/** A console as a tuck sees one: following the game or backscrolled, and brought to its edge. */
function consoleThat(following: boolean): TerminalHandle {
  const handle: Pick<TerminalHandle, 'following' | 'jumpToLatest'> = {
    following: () => following,
    jumpToLatest: vi.fn()
  };
  return handle as TerminalHandle;
}

describe('useCardRail', () => {
  let rendered: RenderedHook<boolean, CardRail> | null = null;
  const terminals = { current: new Map<string, TerminalHandle>() };
  const setResizing = vi.fn();
  const mount = (showHud: boolean): RenderedHook<boolean, CardRail> => {
    rendered = renderHook((hud: boolean) => useCardRail(hud, terminals, setResizing), showHud);
    return rendered;
  };
  beforeEach(() => {
    localStorage.clear();
    terminals.current.clear();
    setResizing.mockClear();
  });
  afterEach(() => {
    rendered?.unmount();
    rendered = null;
    vi.useRealTimers();
  });

  it('shows the rail for the HUD or the diagnostics, either one', () => {
    const rail = mount(true);
    expect([rail.current.hudOpen, rail.current.railOpen, rail.current.railVisible]).toEqual([
      true,
      false,
      true
    ]);
    act(() => rail.current.setHudPreference('off'));
    expect(rail.current.railVisible).toBe(false);
    act(() => rail.current.toggleRail());
    expect([rail.current.railOpen, rail.current.railVisible]).toEqual([true, true]);
  });

  it('tucks the cards in one step, bringing each following console back to its edge', () => {
    vi.useFakeTimers();
    const following = consoleThat(true);
    const reading = consoleThat(false);
    terminals.current.set('a', following);
    terminals.current.set('b', reading);
    const rail = mount(true);

    act(() => rail.current.setTucked(true));
    expect(rail.current.tucked).toBe(true);
    expect(setResizing).toHaveBeenLastCalledWith(true);
    expect(following.jumpToLatest).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(TUCK_SETTLE_MS);
    });
    expect(setResizing).toHaveBeenLastCalledWith(false);
    expect(following.jumpToLatest).toHaveBeenCalledOnce();
    expect(reading.jumpToLatest).not.toHaveBeenCalled();
  });

  it('remembers a tuck, which means nothing while the rail is not shown', () => {
    const first = mount(true);
    act(() => first.current.setTucked(true));
    first.unmount();
    rendered = null;

    const again = mount(true);
    expect([again.current.tuckPreference, again.current.tucked]).toEqual(['tucked', true]);
    act(() => again.current.setHudPreference('off'));
    expect(again.current.tucked).toBe(false);
  });

  it('counts the pinned stream floats, and keeps the set while nothing changes', () => {
    const rail = mount(true);
    act(() => rail.current.noteStreamFloat('a', true));
    const once = rail.current.pinnedStreams;
    expect([...once]).toEqual(['a']);
    act(() => rail.current.noteStreamFloat('a', true));
    expect(rail.current.pinnedStreams).toBe(once);
    act(() => rail.current.noteStreamFloat('a', false));
    expect(rail.current.pinnedStreams.size).toBe(0);
  });
});
