import { describe, expect, it } from 'vitest';

import { acted, commandsOf, flagText } from '../itemManager';

/* The Item Manager's flags as item rules (2026-10-19), MME's `imSetAction` and `imCommands`. */
describe("the Item Manager's flags", () => {
  it('words a rule as MME flags it', () => {
    expect(flagText({ item: 'torch', buy: true, keep: 3 })).toBe('BUY x3');
    expect(flagText({ item: 'rat tail', sell: true, discard: true })).toBe('SELL · DROP');
    expect(flagText({ item: 'gem', collect: true })).toBe('PICKUP');
    expect(flagText(undefined)).toBe('');
  });

  it('cycles Sell, Buy and neither, the count from the pack', () => {
    expect(acted(undefined, 'sell', 2)).toEqual({ sell: true, buy: false });
    expect(acted({ item: 'x', sell: true }, 'sell', 2)).toEqual({
      sell: false,
      buy: true,
      keep: 2
    });
    expect(acted({ item: 'x', buy: true, keep: 2 }, 'sell', 2)).toEqual({
      sell: false,
      buy: false
    });
  });

  it('cycles Pick up, Equip and neither, and counts what is kept or got', () => {
    expect(acted(undefined, 'pickup', 0)).toEqual({ collect: true });
    expect(acted({ item: 'x', collect: true }, 'pickup', 0)).toEqual({
      collect: false,
      equip: true
    });
    expect(acted({ item: 'x', buy: true, keep: 2 }, 'plus', 0)).toEqual({ keep: 3 });
    expect(acted({ item: 'x', collect: true, most: 1 }, 'minus', 0)).toEqual({ most: 1 });
    expect(acted({ item: 'x' }, 'plus', 0)).toBeNull();
  });

  it('makes the game commands the rules say, as many as they say', () => {
    expect(
      commandsOf([
        { name: 'torch', carried: 1, rule: { item: 'torch', buy: true, keep: 3 } },
        { name: 'rat tail', carried: 2, rule: { item: 'rat tail', discard: true } },
        { name: 'dagger', carried: 1 }
      ])
    ).toBe('buy torch\r\nbuy torch\r\ndrop rat tail\r\ndrop rat tail');
  });
});
