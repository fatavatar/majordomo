import { describe, expect, it } from 'vitest';

import { parseShown } from '../shownPanes';

describe('parseShown', () => {
  it('reads what writeShown writes', () => {
    expect(parseShown(JSON.stringify({ panes: ['festus', 'rayzor'], at: 1 }))).toEqual({
      panes: ['festus', 'rayzor'],
      at: 1,
      stable: false
    });
    // The Stable shown instead (2026-10-31).
    expect(parseShown(JSON.stringify({ panes: ['festus'], at: 0, stable: true }))).toMatchObject({
      stable: true
    });
  });

  // The value is on the player's own disk and an older build may have written it.
  it('keeps only what it can use', () => {
    expect(parseShown('null')).toEqual({ panes: [], at: 0, stable: false });
    expect(parseShown(JSON.stringify({ panes: ['festus', 3, null], at: 1.5 }))).toEqual({
      panes: ['festus'],
      at: 0,
      stable: false
    });
    expect(parseShown(JSON.stringify({ panes: 'festus', at: -2, stable: 'yes' }))).toEqual({
      panes: [],
      at: 0,
      stable: false
    });
  });
});
