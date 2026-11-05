import { describe, expect, it } from 'vitest';

import { reachingReading } from '../ExperienceScope';
import { EMPTY_CHARACTER, type CharacterState } from '@shared/character';

/**
 * The console's experience bar (2026-11-01): it runs to the next level the
 * experience does not reach, and the levels reached and not trained are
 * counted for the dots before it, where a character past its threshold drew
 * a full bar however many levels it held.
 */
describe('the way to the next level not reached', () => {
  const progress = (level: number, exp: number): CharacterState['progress'] => ({
    ...EMPTY_CHARACTER.progress,
    level,
    exp,
    expTable: {
      rows: [10, 11, 12, 13, 14].map((row) => ({
        level: row,
        experience: (row - 10) * 1000,
        source: 'realm' as const
      }))
    }
  });

  it('runs from the level held where nothing is waiting to be trained', () => {
    expect(reachingReading(progress(10, 400))).toEqual({
      untrained: 0,
      next: 11,
      into: 400,
      span: 1000
    });
  });

  it('counts each level reached and not trained, and runs from the last of them', () => {
    expect(reachingReading(progress(10, 2_250))).toEqual({
      untrained: 2,
      next: 13,
      into: 250,
      span: 1000
    });
    expect(reachingReading(progress(10, 1_000))).toMatchObject({ untrained: 1, next: 12, into: 0 });
  });

  it('says nothing past the end of the table, or without one', () => {
    expect(reachingReading(progress(10, 9_000))).toBeNull();
    expect(reachingReading({ ...progress(10, 400), expTable: null })).toBeNull();
  });
});
