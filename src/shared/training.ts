/* -------------------------------------------------------------- the trainer */

/**
 * A place that will take a level, as the realm states it.
 *
 * Only what choosing needs: the room it is in is the caller's, because a shop
 * is a property of a room and the caller is the one holding the index.
 */
export interface TrainerRow {
  /** The shop's own row number, so a choice can be recorded as a fact. */
  id: number;
  name: string;
  /** `Shops.MinLVL`; absent is no floor. */
  minLevel?: number;
  /** `Shops.MaxLVL`; absent is no ceiling. */
  maxLevel?: number;
  /** `Shops.ClassRest`; absent is anybody. */
  classOnly?: number;
  /** `Shops.Markup%`, the percentage added to the base price. Absent is none. */
  markup?: number;
}

/**
 * Whether a trainer takes a character of this level and class.
 *
 * **The off-by-one is the server's and it is load-bearing.**
 * `TrainCommand.cs:33` refuses below `MinLVL - 1` and at or above `MaxLVL`,
 * so a level 20 character *may* train at a 21–50 trainer — training is what
 * makes it 21 — and a level 50 character may **not**, because 50 is the
 * ceiling rather than the last level served. A client using the band as
 * written walks to the wrong room at every boundary, in both directions.
 *
 * Class is one id or nothing; `unknown` class is not permission, so a
 * restricted trainer refuses a character whose class the client has not read.
 */
export function trainsLevel(trainer: TrainerRow, level: number, classId: number | null): boolean {
  if (trainer.minLevel !== undefined && level < trainer.minLevel - 1) return false;
  if (trainer.maxLevel !== undefined && level >= trainer.maxLevel) return false;
  if (trainer.classOnly !== undefined && trainer.classOnly !== classId) return false;
  return true;
}

/**
 * What one level costs here, in copper.
 *
 * `TrainCommand.cs:92`, transcribed including its integer division — the
 * markup is applied *before* dividing, so computing it any other way
 * disagrees with the server at the rounding and the client quotes a figure
 * the counter will not honour.
 *
 * Measured against the wire: level 30 at `Training Area` (markup 6,000) was
 * **88,450** copper, which is `29 × 50 × 6100 / 100`.
 */
export const BASE_TRAINING_COPPER = 50;

export function trainingCost(level: number, markup: number | undefined): number {
  const base = (level - 1) * BASE_TRAINING_COPPER;
  return Math.trunc((base * (100 + (markup ?? 0))) / 100);
}

/**
 * The trainers that will take this character, cheapest first.
 *
 * **Cost leads, and it is not close.** The bands overlap heavily — 21–50,
 * 31–52, 41–54, 51–75 — so a level 52 character matches several, and the
 * markups across them span a factor of eight: `Hydra Trainer` (51–75) charges
 * 9,999% and quotes 257,524 copper at level 52, where `Sixty Seven` (1–67)
 * charges 1,200% and quotes 33,150. Reach buys at most one walk saved, once;
 * the markup is paid at **every** level. Reach is the tiebreak, so that
 * between two equally priced rooms the one serving the next several levels
 * wins and the walk is not repeated.
 *
 * **The band filter is what stops the ladder stalling**, not the order.
 * Walking into the *first* match refused at exactly 52 and again at 54 —
 * bands whose ceiling the character had just reached — and `trainsLevel`
 * excludes those outright, whatever the sort does with the rest.
 *
 * The whole list rather than one answer: the player picks (the settings
 * screen offers exactly these), and a client that has to fall back needs the
 * next one down.
 */
export function trainersFor(
  trainers: readonly TrainerRow[],
  level: number,
  classId: number | null
): TrainerRow[] {
  return trainers
    .filter((trainer) => trainsLevel(trainer, level, classId))
    .sort(
      (a, b) =>
        trainingCost(level, a.markup) - trainingCost(level, b.markup) ||
        (b.maxLevel ?? Number.MAX_SAFE_INTEGER) - (a.maxLevel ?? Number.MAX_SAFE_INTEGER) ||
        a.id - b.id
    );
}
