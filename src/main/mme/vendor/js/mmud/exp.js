// Experience tables and the CP maths MME uses to pick the Exp Calculator's
// default level range. Pure functions; table lookups go through by.cls/by.race.
import { by, db } from '../db.js';
import { engine } from './engine.js';

const MAX_UINT = 4294967295;
const CURRENCY_MAX = 922337203685477.5807;   // VB6 Currency overflows past this

// modMMudFunc.GetExpModifiers_STOCK: [multiplier, divisor] for levels 3-27
function expModifiersStock(level) {
  switch (level) {
    case 3: return [40, 20];
    case 4: case 5: return [44, 24];
    case 6: case 7: return [48, 28];
    case 8: case 9: return [52, 32];
    case 10: case 11: return [56, 36];
    case 12: case 13: return [60, 40];
    case 14: case 15: return [65, 45];
    case 16: case 17: return [70, 50];
    case 18: return [75, 55];
    default: return level <= 26 ? [50, 40] : [23, 20];
  }
}

// modMMudFunc.CalcExpNeeded_STOCK (Locke's port of MajorMUD's own routine,
// uint rollovers and all). MME recomputes levels 1..n on every call; the state
// carried between levels doesn't depend on the target, so this walks once and
// returns exp for every level 1..maxLevel (index = level; [0] unused).
// A Currency overflow makes MME's function error out and return 0, so levels
// past that point are 0 here too.
export function expTableStock(maxLevel, exptable) {
  const out = new Array(maxLevel + 1).fill(0);
  let running = 0, billions = 0;
  for (let i = 1; i <= maxLevel; i++) {
    if (i === 1) running = 0;
    else if (i === 2) running = exptable * 10;
    else {
      let mul, div;
      if (i <= 27) [mul, div] = expModifiersStock(i);   // levels 1-27
      else if (i <= 55) { mul = 115; div = 100; }       // levels 28-55
      else if (i <= 58) { mul = 109; div = 100; }       // levels 56-58
      else { mul = 108; div = 100; }                    // levels 59+

      let potential = (mul === 0 || div === 0) ? 0 : running * mul;
      let alternate;
      if (potential > MAX_UINT) {                       // UINT ROLLOVER #1
        let divides = 0;
        while (potential > MAX_UINT) {
          running = Math.trunc(running / 100);
          potential = running * mul;
          divides++;
        }
        alternate = divides > 1 ? Math.trunc((running * mul * 100) / div) : Math.trunc(potential / div);
        for (; divides > 0; divides--) alternate *= 100;
      } else {
        alternate = Math.trunc(potential / div);
      }

      let j = 1000000 * mul * billions;
      if (j > CURRENCY_MAX) return out;                 // overflow: MME returns 0 from here on
      if (j > MAX_UINT) j %= MAX_UINT + 1;              // UINT ROLLOVER #2 (MME subtracts in a loop)
      while (j >= 1000000000) { j -= 1000000000; billions++; }

      let k = j + alternate;
      while (k >= 1000000000) { k -= 1000000000; billions++; }
      running = k;
    }
    const last = running + billions * 1000000000;
    if (billions * 1000000000 > CURRENCY_MAX || last > CURRENCY_MAX) return out;
    out[i] = last;
  }
  return out;
}

// modMMudFunc.CalcExpNeeded: total exp to reach `level` on exp chart `exptable`.
export function calcExpNeeded(level, exptable) {
  if (engine.greater) {
    // TODO GreaterMUD: CalcExpNeeded_GMUD_1_8_5 (dat <= 1.85) / CalcExpNeeded_GMUD
  }
  if (level < 1) return 0;
  return expTableStock(level, exptable)[level];
}

// The exp chart for a class/race pair, as frmExpCalc.CalcExp and
// modMMudDatabase.CalcExpNeededByRaceClass build it: class ExpTable + 100,
// plus race ExpTable; an unknown or unset class/race contributes 0.
export function expChart(clsNum, raceNum) {
  const c = clsNum > 0 ? by.cls.get(clsNum) : null;
  const r = raceNum > 0 ? by.race.get(raceNum) : null;
  return (c ? c.ExpTable + 100 : 0) + (r ? r.ExpTable : 0);
}

// modMMudDatabase.CalcExpNeededByRaceClass
export const calcExpNeededByRaceClass = (level, clsNum, raceNum) =>
  calcExpNeeded(level, expChart(clsNum, raceNum));

// frmExpCalc.cmdCalcExp_Click: rows of {level, exp, needed} for a level range.
// Start is clamped to 2..500 and end to 10..500, as the form does. "needed"
// is the difference from the previous row; MME starts nLastExp at 0, so the
// first row's "needed" is its whole total.
export function expRows(start, end, exptable) {
  start = Math.min(500, Math.max(2, Math.trunc(start) || 0));
  end = Math.min(500, Math.max(10, Math.trunc(end) || 0));
  const table = expTableStock(Math.max(start, end), exptable);
  const rows = [];
  let last = 0;
  for (let lvl = start; lvl <= end; lvl++) {
    const exp = engine.greater ? calcExpNeeded(lvl, exptable) : table[lvl];
    rows.push({ level: lvl, exp, needed: exp - last });
    last = exp;
  }
  return { start, end, rows };
}

// ---------------------------------------------------------------- CP maths
// modMMudDatabase, "Rules (mirrors RefreshCPs)":
//   CP gained per level L: 10 + 5 * (L \ 10)
//   CP cost per stat point starts at 1 and rises by 1 every 10 points,
//   capped at 10 per point on stock (GreaterMUD: no cap).

// modMMudDatabase.CP_CostForRaise
export function cpCostForRaise(delta) {
  if (delta <= 0) return 0;
  const cap = engine.greater ? 9999 : 10;
  const tens = Math.trunc(delta / 10), rem = delta % 10;
  if (tens >= cap) {
    return 10 * Math.trunc((cap - 1) * cap / 2) + (delta - 10 * (cap - 1)) * cap;
  }
  return 10 * Math.trunc(tens * (tens + 1) / 2) + rem * (tens + 1);
}

// modMMudDatabase.LevelNeededForCP
export function levelNeededForCP(baseCP, needCP) {
  let total = baseCP, L = 1;
  while (total < needCP && L < 2000) {
    total += 10 + 5 * Math.trunc(L / 10);
    L++;
  }
  return L;
}

// modMMudDatabase.GetRaceCP
export function raceCP(raceNum) {
  if (!raceNum) return 100;
  const r = by.race.get(raceNum);
  return r ? r.BaseCP : 100;
}

const STAT_PAIRS = [['mSTR', 'xSTR'], ['mINT', 'xINT'], ['mWIL', 'xWIL'],
  ['mAGL', 'xAGL'], ['mHEA', 'xHEA'], ['mCHM', 'xCHM']];
// modMMudDatabase.RaceStat_FieldDelta
const statDelta = (r, m, x) => ((r[x] || 0) > (r[m] || 0) ? r[x] - r[m] : 0);

// modMMudDatabase.ComputeAvgLevelMaxStats -> { allStats, singleStat }
// (gAvgLevelMaxAllStats / gAvgLevelMaxSingleStat).
// Faithful quirk: MME declares totalCost with Dim inside the race loop, which
// VB6 does not reset per iteration, so the cost to max all stats accumulates
// across races in table order.
export function avgLevelMaxStats(races = db.Races) {
  if (!races.length) return { allStats: 0, singleStat: 0 };
  let sumAll = 0, sumSingle = 0, raceCount = 0, singleCount = 0, totalCost = 0;
  for (const r of races) {
    const deltas = STAT_PAIRS.map(([m, x]) => statDelta(r, m, x));
    const baseCP = r.Number > 0 ? raceCP(r.Number) : 0;   // GetRaceCP_Safe
    for (const d of deltas) totalCost += cpCostForRaise(d);
    sumAll += levelNeededForCP(baseCP, totalCost);
    raceCount++;
    for (const d of deltas) { sumSingle += levelNeededForCP(baseCP, cpCostForRaise(d)); singleCount++; }
  }
  return { allStats: sumAll / raceCount, singleStat: sumSingle / singleCount };
}

// VB6 CLng: round half to even.
const cLng = x => {
  const f = Math.floor(x), d = x - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
};

// modSyntaxsFunc.RoundUpTo5
export function roundUpTo5(n) {
  const r = n % 5;
  if (r === 0) return n;
  return n >= 0 ? n + (5 - r) : n - r;
}

// modMMudDatabase.GetMaxLevel: 255, or the avg level to max all stats rounded
// up to 5 when that's higher. (RoundUpTo5 takes a Long, so VB rounds the
// Double average to even first.)
export function getMaxLevel(races = db.Races) {
  const avg = avgLevelMaxStats(races).allStats;
  if (avg > 0) {
    const dyn = roundUpTo5(cLng(avg));
    if (dyn > 255) return dyn;
  }
  return 255;
}
