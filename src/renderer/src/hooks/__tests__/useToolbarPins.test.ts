// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useToolbarPins, type PinnedToolbars } from '../useToolbarPins';
import { renderHook, type RenderedHook } from './renderHook';

/** A row of four buttons, two of them on it as the file ships it. */
const IDS = ['combat', 'heal', 'rest', 'stop'] as const;
const SHIPPED = ['combat', 'stop'];

describe('useToolbarPins', () => {
  let rendered: RenderedHook<null, PinnedToolbars> | null = null;
  const mount = (): RenderedHook<null, PinnedToolbars> => {
    rendered = renderHook(() => useToolbarPins(SHIPPED, IDS), null);
    return rendered;
  };
  const row = (pins: PinnedToolbars, session: string): string[] => [...pins.pinnedFor(session)];
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    rendered?.unmount();
    rendered = null;
  });

  it('pins a button on one character’s row and on no other’s', () => {
    const pins = mount();
    act(() => pins.current.toggle('skinny', 'heal'));
    expect(row(pins.current, 'skinny')).toEqual(['combat', 'heal', 'stop']);
    // The Stable's other consoles, and whoever is shown next, keep theirs.
    expect(row(pins.current, 'fatty')).toEqual(['combat', 'stop']);
    act(() => pins.current.toggle('fatty', 'stop'));
    expect(row(pins.current, 'fatty')).toEqual(['combat']);
    expect(row(pins.current, 'skinny')).toEqual(['combat', 'heal', 'stop']);
  });

  it('remembers each character’s row for the next window', () => {
    const first = mount();
    act(() => first.current.toggle('skinny', 'rest'));
    first.unmount();
    const again = mount();
    expect(row(again.current, 'skinny')).toEqual(['combat', 'rest', 'stop']);
    expect(row(again.current, 'fatty')).toEqual(['combat', 'stop']);
  });

  it('starts every character from the row kept for the whole client before', () => {
    localStorage.setItem(
      'mudengine.toolbar.pins',
      JSON.stringify({ heal: { pinned: true, against: false } })
    );
    const pins = mount();
    expect(row(pins.current, 'skinny')).toEqual(['combat', 'heal', 'stop']);
    expect(row(pins.current, 'fatty')).toEqual(['combat', 'heal', 'stop']);
    // A click is made against that row, and changes only the character it was on.
    act(() => pins.current.toggle('fatty', 'heal'));
    expect(row(pins.current, 'fatty')).toEqual(['combat', 'stop']);
    expect(row(pins.current, 'skinny')).toEqual(['combat', 'heal', 'stop']);
  });

  it('hands an untouched character the same set after another’s click', () => {
    const pins = mount();
    const before = pins.current.pinnedFor('fatty');
    act(() => pins.current.toggle('skinny', 'heal'));
    expect(pins.current.pinnedFor('fatty')).toBe(before);
  });

  it('reads past a stored record it cannot use', () => {
    localStorage.setItem(
      'mudengine.toolbar.pinsByCharacter',
      JSON.stringify({ skinny: { heal: { pinned: 'yes' } }, fatty: [1, 2], bowel: 7 })
    );
    const pins = mount();
    for (const session of ['skinny', 'fatty', 'bowel'])
      expect(row(pins.current, session)).toEqual(['combat', 'stop']);
  });
});
