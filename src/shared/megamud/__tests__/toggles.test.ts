import { describe, expect, it } from 'vitest';

import { asMegaToggle } from '../toggles';

describe('MegaMUD’s toolbar toggles', () => {
  it('are read off the wire by name, and nothing else', () => {
    expect(asMegaToggle('nuke')).toBe('nuke');
    expect(asMegaToggle('toString')).toBeNull();
  });
});
