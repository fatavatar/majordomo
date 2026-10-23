import { describe, expect, it } from 'vitest';

import {
  asItemRules,
  asItemTable,
  itemRuleForFile,
  itemSaysAnything,
  mergeItemRules
} from '../itemRules';

describe('item rows', () => {
  it('are keyed by name, one per item, forgiving per field', () => {
    expect(
      asItemRules([
        { item: '  Healing  Potion ', collect: true, keep: 5, most: 'ten', shop: '' },
        { item: 'healing potion', discard: true },
        { item: '' },
        'rock'
      ])
    ).toEqual([{ item: 'healing potion', collect: true, keep: 5 }]);
  });

  it('read a table with its source', () => {
    expect(
      asItemTable({
        source: { file: 'Items.md', importedAt: '2026-10-13T00:00:00.000Z' },
        items: [{ item: 'rope', buy: true }]
      })
    ).toEqual({
      source: { file: 'Items.md', importedAt: '2026-10-13T00:00:00.000Z' },
      items: [{ item: 'rope', buy: true }]
    });
  });

  it('say something only beyond the name', () => {
    expect(itemSaysAnything({ item: 'rock' })).toBe(false);
    expect(itemSaysAnything({ item: 'rock', cannotTake: true })).toBe(true);
  });

  it('go to the file in a fixed order', () => {
    expect(
      Object.keys(itemRuleForFile({ shop: 'Store', item: 'rope', keep: 1, buy: true }))
    ).toEqual(['item', 'buy', 'keep', 'shop']);
  });

  it('a narrower row changes only what it states', () => {
    expect(
      mergeItemRules(
        [{ item: 'rope', buy: true, shop: 'Store', keep: 1 }],
        [
          { item: 'Rope', keep: 3 },
          { item: 'torch', collect: true }
        ]
      )
    ).toEqual([
      { item: 'rope', buy: true, shop: 'Store', keep: 3 },
      { item: 'torch', collect: true }
    ]);
  });
});
