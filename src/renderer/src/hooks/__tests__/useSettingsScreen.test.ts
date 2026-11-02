// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_GLOBAL, SETTINGS_NEW_CHARACTER } from '../../components/SettingsScreen';
import { useSettingsScreen, type SettingsScreenState } from '../useSettingsScreen';
import { renderHook, type RenderedHook } from './renderHook';

describe('useSettingsScreen', () => {
  let rendered: RenderedHook<boolean, SettingsScreenState> | null = null;
  afterEach(() => {
    rendered?.unmount();
    rendered = null;
  });
  const mount = (mustMakeCharacter: boolean, returnFocus = vi.fn()) => {
    rendered = renderHook(
      (must: boolean) => useSettingsScreen(must, returnFocus),
      mustMakeCharacter
    );
    return { screen: rendered, returnFocus };
  };

  it('opens where it is asked to, and hands the keyboard back on the way out', () => {
    const { screen, returnFocus } = mount(false);
    expect(screen.current.open).toBe(false);

    act(() => screen.current.editCharacter('archer'));
    expect([screen.current.open, screen.current.at]).toEqual([true, 'archer']);
    act(() => screen.current.editGlobal());
    expect(screen.current.at).toBe(SETTINGS_GLOBAL);
    act(() => screen.current.openSettings());
    expect(screen.current.at).toBeNull();

    act(() => screen.current.close());
    expect(screen.current.open).toBe(false);
    expect(returnFocus).toHaveBeenCalledOnce();
  });

  it('stays open on the new-character form while there is no character', () => {
    const { screen, returnFocus } = mount(true);
    expect([screen.current.open, screen.current.at]).toEqual([true, SETTINGS_NEW_CHARACTER]);
    act(() => screen.current.close());
    expect(screen.current.open).toBe(true);
    expect(returnFocus).not.toHaveBeenCalled();

    // A character made: it can be closed now.
    screen.rerender(false);
    act(() => screen.current.close());
    expect(screen.current.open).toBe(false);
  });
});
