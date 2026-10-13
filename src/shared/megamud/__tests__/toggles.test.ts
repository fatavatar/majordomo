import { describe, expect, it } from 'vitest';

import { asMegaToggle, shownToggles } from '../toggles';

describe('MegaMUD’s toolbar toggles', () => {
  /* `0x4bb4d0` ticks Visible above 0 and Separator above 1. */
  it('show those the `[Toolbar]` gives a value above 0', () => {
    expect(shownToggles({ AutoCombat: 1, AutoNuke: 2, AutoMelee: 0, AllOff: 2 })).toEqual([
      'allOff',
      'combat',
      'nuke'
    ]);
    expect(shownToggles(undefined)).toEqual([]);
  });

  it('are read off the wire by name, and nothing else', () => {
    expect(asMegaToggle('nuke')).toBe('nuke');
    expect(asMegaToggle('toString')).toBeNull();
  });
});
