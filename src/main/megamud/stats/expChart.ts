/**
 * `0x439e70`: the experience a level takes on a chart (the class's experience
 * percentage and the race's together), as MegaMUD reckons it for MajorMUD.
 * Read 2026-10-13, from the instructions.
 *
 * Level 2 is ten times the chart. Each level after takes the one before
 * times a ratio: levels 3 to 27 from a table (`0x43a110`), then 115%, 109%
 * from level 56 and 108% from level 59. The figure is kept as billions and a
 * remainder below a billion; the billions grow by a thousandth of the
 * ratio's numerator, its product cut to 32 bits, and a remainder too large
 * for a word is worked in hundreds. The realm reckons it the same way: its
 * own figures (`exp`'s next-level total) matched at every level the logs
 * hold, 78 of them over two characters (2026-10-13).
 */
const BILLION = 1_000_000_000n;
const WORD = 0x1_0000_0000n;

/** `0x43a110`: levels 3 to 27, as a numerator and a denominator. */
function earlyRatio(level: number): [bigint, bigint] {
  if (level === 3) return [40n, 20n];
  if (level <= 5) return [44n, 24n];
  if (level <= 7) return [48n, 28n];
  if (level <= 9) return [52n, 32n];
  if (level <= 11) return [56n, 36n];
  if (level <= 13) return [60n, 40n];
  if (level <= 15) return [65n, 45n];
  if (level <= 17) return [70n, 50n];
  if (level === 18) return [75n, 55n];
  if (level > 26) return [23n, 20n];
  return [50n, 40n];
}

function ratio(level: number): [bigint, bigint] {
  if (level <= 27) return earlyRatio(level);
  return [level <= 55 ? 115n : level <= 58 ? 109n : 108n, 100n];
}

/** The experience `level` takes on `chart`; 0 below level 2. Not GreaterMUD's (`0x439840`). */
export function expForLevel(level: number, chart: number): bigint {
  if (level < 2) return 0n;
  let billions = 0n;
  let rest = 0n;
  for (let at = 2; at <= level; at += 1) {
    if (at === 2) {
      rest = BigInt(chart >>> 0) * 10n;
      continue;
    }
    const [num, den] = ratio(at);
    let product = num * rest;
    let grown: bigint;
    if (product < WORD) {
      grown = product / den;
    } else {
      // Shrunk by hundreds until the product fits a word, then grown back.
      let shrunk = rest;
      let times = 0;
      do {
        shrunk /= 100n;
        product = num * shrunk;
        times += 1;
      } while (product >= WORD);
      grown = (times > 1 ? product * 100n : product) / den;
      for (let i = 0; i < times; i += 1) grown *= 100n;
    }
    let carried = (num * billions * 1_000_000n) % WORD;
    while (carried >= BILLION) {
      carried -= BILLION;
      billions += 1n;
    }
    rest = carried + grown;
    while (rest >= BILLION) {
      rest -= BILLION;
      billions += 1n;
    }
  }
  return billions * BILLION + rest;
}
