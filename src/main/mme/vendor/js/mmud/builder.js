// The class/race builder: frmMain.RefreshClassRaceBuilder. For a class and/or
// race, the exp chart, HP range and a sample weapon's swings at five level
// steps, as the four text columns MME prints.

import { by } from '../db.js';
import { calcExpNeeded, avgLevelMaxStats, roundUpTo5 } from './exp.js';
import { calcMaxHP, classCombat } from './charstats.js';
import { calculateAttack, blankProfile, MUD } from './combat.js';
import { truncate } from './details.js';

// VB assigning a Double to a Long/Integer: round half to even (CLng/CInt).
const cLng = x => {
  const f = Math.floor(x), d = x - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
};
// modMMudFunc.RoundUpToNearest5 (n is a Long, so the caller's Double is CLng'd)
export function roundUpToNearest5(n) {
  n = cLng(n);
  if (n % 5 === 0) return n;
  return n > 0 ? (Math.trunc(n / 5) + 1) * 5 : Math.trunc(n / 5) * 5;
}
const commas = n => Number(n).toLocaleString('en-US');

// nLevelSteps: 1, 10, 25, and two steps scaled by the average level it takes
// a race to max one stat (gAvgLevelMaxSingleStat).
export function levelSteps(avgSingle = avgLevelMaxStats().singleStat) {
  let maxCalc = cLng(avgSingle);
  if (maxCalc < 50) maxCalc = 50;
  else if (maxCalc > 100) maxCalc = cLng(maxCalc / 2);
  let s3 = maxCalc;
  if (s3 > avgSingle * 3) s3 = cLng(avgSingle * 3);
  let s4 = maxCalc * 2;
  if (s4 > avgSingle * 6) s4 = cLng(avgSingle * 6);
  return [1, 10, 25, roundUpTo5(s3), roundUpTo5(s4)];
}

const SAMPLE = [null, ' 2000/10', ' 3000/20', ' 4000/40', ' 5000/80'];   // weapon proxies -2..-5

// Returns the five output lines (MME pads the columns with spaces; so do we,
// and the page shows them in a monospaced block).
export function buildClassRace(clsNum, raceNum, steps = levelSteps()) {
  const cls = clsNum > 0 ? by.cls.get(clsNum) : null;
  const race = raceNum > 0 ? by.race.get(raceNum) : null;
  const out = ['', '', '', '', ''];
  const pad = gap => {
    const max = Math.max(...out.map(s => s.length));
    return out.map(s => ' '.repeat(max - s.length + gap));
  };

  const chart = (cls ? cls.ExpTable + 100 : 0) + (race ? race.ExpTable : 0);
  if (chart > 0) {
    out[0] = `EXP Chart: ${chart}%`;
    for (let x = 1; x <= 4; x++) out[x] = `EXP @ LVL ${steps[x]}: ${commas(calcExpNeeded(steps[x], chart))}`;
  }

  if (cls && race && race.xHEA > 0) {
    const sp = pad(5);
    const minRoll = cls.MinHits, maxRoll = cls.MinHits + cls.MaxHits;   // GetClassMinHP / GetClassMaxHP
    const mH = race.mHEA, xH = race.xHEA;
    out[0] += `${sp[0]}HP Range: ${minRoll}-${maxRoll}`;
    for (let x = 1; x <= 4; x++) {
      const hea = [0, mH, roundUpToNearest5(mH + (xH - mH) * 0.5), roundUpToNearest5(mH + (xH - mH) * 0.75), xH][x];
      const bonus = race.HPPerLVL * steps[x];
      const lo = calcMaxHP(maxRoll - minRoll, steps[x], hea, minRoll) + bonus;
      const hi = calcMaxHP((maxRoll - minRoll) * steps[x], steps[x], hea, minRoll) + bonus;
      out[x] += `${sp[x]}HP @ LVL ${steps[x]}/${hea} HEA: ${lo}-${hi}`;
    }
  }

  if (cls && race && race.xAGL > 0) {
    const sp = pad(4);
    const mA = race.mAGL, xA = race.xAGL;
    const p = { ...blankProfile(), cls: clsNum, race: raceNum, combat: classCombat(clsNum),
      encumCurrent: 1, encumMax: 100, encumPct: 1 };
    out[0] += `${sp[0]}SPEED/DMG @ LVL/AGI: Weapon Swings (DMG)`;
    for (let x = 1; x <= 4; x++) {
      p.level = steps[x];
      p.agi = cLng([0, mA, mA + (xA - mA) * 0.5, mA + (xA - mA) * 0.75, xA][x]);   // nAGI As Integer
      const a = calculateAttack(p, MUD.normal, -(x + 1), { specifyAccy: 100 });
      out[x] += `${sp[x]}${SAMPLE[x]} @ LVL ${steps[x]}/${p.agi} AGI: ${truncate(a.swings, 2)} swings (${a.roundTotal})`;
    }
  }
  return out.filter(Boolean);
}
