/**
 * `0x4a7250`: the stats window's experience meter, read 2026-10-13: what has
 * been made since the baseline, what the next level needs, the rate an hour
 * and when the level will come. The `@exp` and `@level` replies are made of
 * it (`0x4ae4a0`).
 *
 * The level needed is the realm's own (`exp`'s "Exp needed for next level"),
 * or, where that says 0 (enough for a level not yet trained), worked out on
 * the class's and race's chart (`0x439e70`) to the first level not yet
 * reached, with how many are owed.
 */
import { findClass, findRace } from '../data';
import { expBaseline } from '../script/timer';
import type { Session } from '../Session';
import { expForLevel } from './expChart';

export interface ExpMeter {
  made: string;
  needed: string;
  rate: string;
  levelIn: string;
}

const HOUR = 3600;
const MINUTE = 60;
const LEVEL_SEARCH = 0xfa;

/** `0x4ada90`: digits grouped by commas. */
function commas(n: number): string {
  return Math.trunc(n).toLocaleString('en-US');
}

/** The level `exp` says is owed, worked out on the chart: how far, and the level after. */
function charted(s: Session): { needed: number; level: number; owed: number } | null {
  if (s.Display_HideNextLevel !== 0) return null;
  const race = findRace(s.data, s.Player_Race);
  const cls = findClass(s.data, s.Player_Class);
  if (!race || !cls) return null;
  const chart = cls.f28 + race.exp;
  const exp = BigInt(Math.trunc(s.exp));
  let owed = 0;
  let level = s.Player_Level;
  let next = 0n;
  do {
    level += 1;
    next = expForLevel(level, chart);
    if (next <= 0n || exp < next) break;
    owed += 1;
  } while (owed < LEVEL_SEARCH);
  if (owed < 1) {
    level = s.Player_Level + 2;
    next = expForLevel(level, chart);
  }
  if (exp >= next) return null;
  return { needed: Number(next - exp), level, owed };
}

/** A figure in millions past a thousand million (`%s.%03d M`). */
function large(n: number): string {
  if (n < 1e9) return commas(n);
  return `${commas(Math.floor(n / 1e6))}.${String(Math.floor((n % 1e6) / 1000)).padStart(3, '0')} M`;
}

function rateText(rate: number): string {
  if (rate < 10000) return `${commas(rate)} exp/hr`;
  if (rate < 10_000_000) return `${commas(Math.floor(rate / 1000))} k/hr`;
  if (rate < 100_000_000) {
    const hundredths = Math.floor(rate / 10000) % 100;
    return `${Math.floor(rate / 1e6)}.${String(hundredths).padStart(2, '0')} m/hr`;
  }
  if (rate < 1e9) return `${Math.floor(rate / 1e6)}.${Math.floor(rate / 1e5) % 10} m/hr`;
  return `${commas(Math.floor(rate / 1e6))} m/hr`;
}

/** How long, in the largest unit that reads well, as MegaMUD gives it. */
function wait(minutes: number, hoursADay: number): string {
  if (minutes <= 120) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / MINUTE);
  if (hours <= hoursADay * 2) return `${hours}-${hours + 1} hours`;
  const days = Math.floor(hours / hoursADay);
  if (days <= 60) return `${days}-${days + 1} days`;
  const months = Math.floor(days / 31);
  if (months < 13) return `${months}-${months + 1} months`;
  const years = Math.floor(months / 12);
  return `${years}-${years + 1} years`;
}

export function expMeter(s: Session): ExpMeter {
  expBaseline(s);
  const baseline = s.f_324c8;
  const made = commas(s.f_324d0 - baseline + s.exp);

  const unknown = s.expToLevel === -1;
  const chart = !unknown && s.expToLevel === 0 ? charted(s) : null;
  const toGo = chart?.needed ?? Math.max(0, s.expToLevel);
  const needed = unknown
    ? '?'
    : chart
      ? `${large(chart.needed)} (L${chart.level})`
      : commas(s.expToLevel);

  // Scaled up before dividing, finer for a small gain.
  const gained = s.exp - baseline;
  const scale = gained < 100000 ? 10000 : 100;
  const elapsed = s.f_322b8 - s.f_322b0;
  const scaledHours = elapsed >= 0 ? Math.floor((elapsed * scale) / HOUR) : 0;
  const seconds = scaledHours === 0 ? 0 : elapsed;
  if (seconds < MINUTE) return { made, needed, rate: '? k/hr', levelIn: '?' };
  const rate = Math.floor((gained * scale) / scaledHours);

  let levelIn = '?';
  if (!unknown) {
    if (s.expToLevel === 0 && !chart) {
      levelIn = 'Now!';
    } else {
      const prefix = chart && chart.owed > 0 ? `+${chart.owed} in ` : '';
      const perMinute = Math.floor((gained * scale) / Math.floor((elapsed * scale) / MINUTE));
      levelIn =
        perMinute <= 0
          ? 'A millenium'
          : prefix + wait(Math.floor(toGo / perMinute) + 1, s.maxHours);
    }
  }
  return { made, needed, rate: rateText(rate), levelIn };
}
