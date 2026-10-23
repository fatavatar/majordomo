import { describe, expect, it } from 'vitest';

import { isFledList } from '../fled';

describe('the monsters run from', () => {
  it('reads back only a list it wrote', () => {
    expect(isFledList([{ name: 'kobold', level: 1, at: 0 }])).toBe(true);
    expect(isFledList([{ name: 'kobold', at: 0 }])).toBe(false);
    expect(isFledList({})).toBe(false);
  });
});
