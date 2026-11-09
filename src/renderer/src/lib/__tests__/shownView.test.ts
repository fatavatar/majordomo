import { describe, expect, it } from 'vitest';

import { parseShown } from '../shownView';

describe('parseShown', () => {
  it('reads what writeShown writes', () => {
    expect(parseShown(JSON.stringify({ session: 'festus', alone: true }))).toEqual({
      session: 'festus',
      alone: true
    });
  });

  // Written before tab groups (2026-11-09): the pane with the keyboard.
  it('reads the panes an older build wrote as the one with the keyboard', () => {
    expect(parseShown(JSON.stringify({ panes: ['festus', 'rayzor'], at: 1 }))).toEqual({
      session: 'rayzor',
      alone: false
    });
    expect(parseShown(JSON.stringify({ panes: ['festus'], at: 3, stable: true }))).toEqual({
      session: 'festus',
      alone: false
    });
  });

  // The value is on the player's own disk and an older build may have written it.
  it('keeps only what it can use', () => {
    expect(parseShown('null')).toEqual({ session: null, alone: false });
    expect(parseShown(JSON.stringify({ panes: [3, null], at: 0 }))).toEqual({
      session: null,
      alone: false
    });
    expect(parseShown(JSON.stringify({ session: 'festus', alone: 'yes' }))).toEqual({
      session: 'festus',
      alone: false
    });
  });
});
