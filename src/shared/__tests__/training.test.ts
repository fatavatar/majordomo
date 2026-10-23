import { describe, expect, it } from 'vitest';

import { trainersFor, trainingCost, trainsLevel, type TrainerRow } from '../training';

/*
 * Choosing where to go and level.
 *
 * The rows below are Paradigm's own, read out of `Shops` (`ShopType 8`) —
 * 46 trainers, bands that overlap, one class id where restricted. The two
 * walls the ladder hit live here (todos 18 and 25).
 */
describe('choosing a trainer', () => {
  const row = (over: Partial<TrainerRow> & { id: number }): TrainerRow => ({
    name: `trainer ${over.id}`,
    ...over
  });

  /* Paradigm's own, as measured. */
  const NINJA_ROOM = row({ id: 26, minLevel: 1, maxLevel: 10, markup: 300, classOnly: 7 });
  const TITAN = row({ id: 74, minLevel: 21, maxLevel: 50, markup: 6000 });
  const AMAZON = row({ id: 135, minLevel: 31, maxLevel: 52, markup: 9999 });
  const ETHEREAL = row({ id: 90, minLevel: 41, maxLevel: 54, markup: 9999 });
  const HYDRA = row({ id: 113, minLevel: 51, maxLevel: 75, markup: 9999 });
  const SIXTY_SEVEN = row({ id: 165, minLevel: 1, maxLevel: 67, markup: 1200 });
  const BARD_76 = row({ id: 188, minLevel: 76, maxLevel: 85, markup: 12000, classOnly: 9 });

  /*
   * `TrainCommand.cs:33` refuses below `MinLVL - 1`, so training *into* the
   * band is allowed: this is the off-by-one that puts a client in the wrong
   * room at every boundary if it reads the band as written.
   */
  it('lets a character train into the band, one level below its floor', () => {
    expect(trainsLevel(TITAN, 20, 7)).toBe(true);
    expect(trainsLevel(TITAN, 19, 7)).toBe(false);
  });

  /* And the ceiling is exclusive: `>= MaxLvl` refuses. */
  it('refuses at the ceiling, which is not the last level served', () => {
    expect(trainsLevel(TITAN, 49, 7)).toBe(true);
    expect(trainsLevel(TITAN, 50, 7)).toBe(false);
  });

  /* Wall one, as walked into: the obvious room for a Ninja trains 1-10. */
  it('refuses the class trainer a level 30 Ninja would walk to', () => {
    expect(trainsLevel(NINJA_ROOM, 30, 7)).toBe(false);
  });

  it('honours a class restriction, and unknown class is not permission', () => {
    expect(trainsLevel(BARD_76, 80, 9)).toBe(true);
    expect(trainsLevel(BARD_76, 80, 7)).toBe(false);
    expect(trainsLevel(BARD_76, 80, null)).toBe(false);
    // An unrestricted row takes anybody, including a class not yet read.
    expect(trainsLevel(TITAN, 30, null)).toBe(true);
  });

  /*
   * The cost, checked against the wire: level 30 at `Training Area`
   * (markup 6,000) quoted 88,450 copper.
   */
  it('computes the cost the way the server does, integer division and all', () => {
    expect(trainingCost(30, 6000)).toBe(88_450);
    expect(trainingCost(30, undefined)).toBe(1_450);
    expect(trainingCost(80, 0)).toBe(3_950);
  });

  /*
   * Wall two of choosing: the bands overlap, and taking the first match walks
   * to a trainer whose ceiling this level has just reached. The ladder stalled
   * at exactly 52 and again at 54 that way — and it is the **filter** that
   * fixes it, whatever order the rest come back in.
   */
  it('never offers a trainer whose ceiling this level has reached', () => {
    const chosen = trainersFor([TITAN, AMAZON, ETHEREAL, HYDRA, SIXTY_SEVEN], 52, 7);
    expect(chosen.map((t) => t.id)).not.toContain(TITAN.id);
    expect(chosen.map((t) => t.id)).not.toContain(AMAZON.id);
  });

  /*
   * And cost leads, because the markup is paid at every level where reach
   * saves at most one walk once. At level 52 Hydra (51–75, 9,999%) quotes
   * 257,524 copper and Sixty Seven (1–67, 1,200%) quotes 33,150.
   */
  it('puts the cheap trainer first even where a dearer one reaches further', () => {
    const chosen = trainersFor([HYDRA, SIXTY_SEVEN], 52, 7);
    expect(chosen[0]?.id).toBe(SIXTY_SEVEN.id);
    expect(chosen[1]?.id).toBe(HYDRA.id);
  });

  /* Reach breaks a tie between two priced the same. */
  it('takes the further-reaching of two that cost the same', () => {
    const short = row({ id: 200, minLevel: 21, maxLevel: 40, markup: 1200 });
    const far = row({ id: 201, minLevel: 21, maxLevel: 60, markup: 1200 });
    expect(trainersFor([short, far], 30, 7)[0]?.id).toBe(far.id);
  });

  it('answers with nothing where no trainer takes this character', () => {
    expect(trainersFor([NINJA_ROOM, BARD_76], 30, 7)).toEqual([]);
  });
});
