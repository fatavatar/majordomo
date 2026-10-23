import { describe, expect, it } from 'vitest';

import { expForLevel } from '../../../shared/megamud/expChart';
import { expMeter } from '../stats/expMeter';
import { session } from './fixture';

/* `0x439e70` and `0x4a7250`, read 2026-10-13. */
describe('the level chart (0x439e70)', () => {
  it('starts at ten times the chart and grows by MegaMUD’s ratios', () => {
    expect(expForLevel(1, 250)).toBe(0n);
    expect(expForLevel(2, 250)).toBe(2500n);
    expect(expForLevel(3, 250)).toBe(5000n);
  });

  /*
   * The realm's own figures off `exp` (its "(next level)" total), every level
   * the logs hold matched (2026-10-13): Healbot, a Dwarf Priest (chart 155),
   * and Skinny, a Wood-Elf Necrolyte (chart 250).
   */
  it('gives the realm’s own figures', () => {
    expect(expForLevel(4, 155)).toBe(5683n);
    expect(expForLevel(27, 155)).toBe(16823667n);
    expect(expForLevel(42, 155)).toBe(136894100n);
    expect(expForLevel(52, 250)).toBe(893286500n);
    expect(expForLevel(54, 250)).toBe(1146371310n);
    expect(expForLevel(81, 250)).toBe(17049253500n);
  });
});

describe('the experience meter (0x4a7250)', () => {
  const meter = (fill: (s: ReturnType<typeof session>['s']) => void) => {
    const r = session();
    const { s } = r;
    s.online = 1;
    s.inGame = 1;
    fill(s);
    s.now = r.clock.now;
    return expMeter(s);
  };

  it('says nothing it cannot know in the first minute', () => {
    const m = meter((s) => {
      s.exp = 1000;
      s.expToLevel = -1;
    });
    expect(m).toEqual({ made: '0', needed: '?', rate: '? k/hr', levelIn: '?' });
  });

  it('gives what was made, what is needed, the rate and when the level comes', () => {
    const m = meter((s) => {
      s.exp = 5_000_000;
      s.expBaseline = 4_000_000;
      s.expMeterStart = s.host.clock() - 2 * 3600;
      s.expMeterEnd = s.host.clock();
      s.expToLevel = 3_000_000;
    });
    expect(m.made).toBe('1,000,000');
    expect(m.needed).toBe('3,000,000');
    expect(m.rate).toBe('500 k/hr');
    expect(m.levelIn).toBe('6-7 hours');
  });

  it('says Now! when the realm says nothing more is needed and no chart can say more', () => {
    const m = meter((s) => {
      s.exp = 5_000_000;
      s.expBaseline = 4_000_000;
      s.expMeterStart = s.host.clock() - 3600;
      s.expMeterEnd = s.host.clock();
      s.expToLevel = 0;
    });
    expect(m.needed).toBe('0');
    expect(m.levelIn).toBe('Now!');
  });
});
