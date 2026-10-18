// Exp/hour prediction: a port of MME's modExpPerHour.bas (v1.10).
//
// calcExpPerHour(args, cfg) runs the enabled models (A, B, C, D) and averages
// them, returning MME's tExpPerHourInfo: exp/hr plus the attack / move /
// HP-rest / mana-rest / roam / overkill / slowdown fractions and the detail
// strings PullMonsterDetail shows. MME's docs/exp-per-hour-models.md explains
// the models: D (round-by-round simulation) is the one it recommends; A-C are
// kept for parity and averaging.
//
// args (CalcExpPerHour's parameters, named as in VB without the Hungarian n):
//   exp          exp per clear of one lair (all its mobs)
//   regenTime    lair regen time, minutes (boss: hours, with totalLairs <= 0)
//   numMobs      mobs per lair
//   totalLairs   lairs that spawn the mob (-1: a single mob / NPC)
//   possSpawns   plain rooms around the lairs
//   rtk          rounds to kill ONE mob (CalcCombatRounds via GetLairInfo)
//   charDmg      character damage per round (not counting surprise)
//   charHP, charHPRegen (resting-rate form, i.e. CalcRestingRate(..., True))
//   mobDmg       lair damage per round (GetLairInfo.nAvgDmgLair)
//   mobHP        lair total HP; mobHPRegen lair HP regen
//   damageThreshold  damage per round healed / ignored (-1 = recovery off)
//   spellCost    attack spell mana per round; spellOverhead heal + bless upkeep
//   charMana, charMPRegen, meditateRate
//   avgWalk      rooms between lairs; walkSpeed seconds per room
//   surpriseDmg, surpriseMinDmg, surpriseChance  backstab opener
//   firstRoundDmg, minRoundDmg
//
// cfg (MME's nGlobal_ceph*/bGlobal_ceph* globals): { models: {A,B,C,D}, xp,
// dmg, mana, move, recoveryOnly, showAll } -- see EXPHR_DEFAULTS.
//
// The higher-level glue that builds args from a character and a monster or
// lair (MME's FilterMonsters / PullMonsterDetail callers) is at the bottom.

import { by } from '../db.js';
import { engine } from './engine.js';
import { vbRound, cint, cur, fix } from './vb.js';
import { ATTACK, blankProfile, damageVsMonster, attackFromChar } from './combat.js';
import { calculateSpellCast, getSpellDuration, getMaxLevel } from './spellcalc.js';
import { calcMovementSpeed } from './charstats.js';
import { calcCombatRounds } from './combatrounds.js';
import { monsterExp } from './details.js';

export const SEC_PER_ROUND = 5;
export const SEC_PER_REST_TICK = 20;
export const SEC_PER_REGEN_TICK = 30;
export const SEC_PER_MEDI_TICK = 10;
// modMMudFunc
export const STOCK_MOB_HPREGEN_ROUNDS = 18;
export const GMUD_MOB_HPREGEN_ROUNDS = 6;
const mobRegenRounds = () => (engine.greater ? GMUD_MOB_HPREGEN_ROUNDS : STOCK_MOB_HPREGEN_ROUNDS);

export const DEFAULT_CEPHA_DMG = 1;
export const DEFAULT_CEPHA_Mana = 1.25;
export const DEFAULT_CEPHA_Move = 1;
export const DEFAULT_CEPHA_MoveRecover = 0.5;
export const DEFAULT_CEPHA_ClusterMx = 10;
export const DEFAULT_CEPHA_HP_PASSIVE_COMBAT_EFF = 0.3;
export const DEFAULT_CEPHB_DMG = 1;
export const DEFAULT_CEPHB_Mana = 0.95;
export const DEFAULT_CEPHB_Move = 0.9;
export const DEFAULT_CEPHB_XP = 1;

// frmSettings: model checkboxes, the four knobs (0.01..10), No Recovery, Show
// in Detail. MME's INI read defaults every model key to on (cmdDefaults too).
export const EXPHR_DEFAULTS = Object.freeze({
  models: Object.freeze({ A: true, B: true, C: true, D: true }),
  xp: 1, dmg: 1, mana: 1, move: 1, recoveryOnly: false, showAll: false,
});
// frmSettings.cmdSave_Click: knobs rounded to 2 places and clamped; all models
// off falls back to A+B+C.
export function normaliseExpHrConfig(c = {}) {
  const knob = v => { let k = vbRound(Number(v) || 0, 2); if (k < 0.01) k = 0.01; if (k > 10) k = 10; return k; };
  const m = { ...EXPHR_DEFAULTS.models, ...(c.models || {}) };
  for (const k of 'ABCD') m[k] = !!m[k];
  if (!m.A && !m.B && !m.C && !m.D) { m.A = true; m.B = true; m.C = true; }
  return {
    models: m,
    xp: knob(c.xp ?? 1), dmg: knob(c.dmg ?? 1), mana: knob(c.mana ?? 1), move: knob(c.move ?? 1),
    recoveryOnly: !!c.recoveryOnly, showAll: !!c.showAll,
  };
}

// ---------------------------------------------------------------- helpers

// modExpPerHour MinDbl / MaxDbl / ClampDbl / SafeDiv
export const minDbl = (a, b) => (a < b ? a : b);
export const maxDbl = (a, b) => (a > b ? a : b);
export const clampDbl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const safeDiv = (n, d, def = 0) => (d === 0 ? def : n / d);
// cephC_Ceil
const cephCeil = v => (v === fix(v) ? v : v > 0 ? fix(v) + 1 : fix(v));
// cephB_Saturate / SmoothStep / Lerp / MulBlend / BandWeight
const saturate = x => (x <= 0 ? 0 : x >= 1 ? 1 : x);
export function smoothStep(e0, e1, x) {
  if (e0 === e1) return x >= e1 ? 1 : 0;
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const lerp = (a, b, t) => a + (b - a) * t;
const mulBlend = (v, factor, t) => v * lerp(1, factor, saturate(t));
const bandWeight = (x, lo, hi, fade = 2) => saturate(smoothStep(lo - fade, lo, x) * (1 - smoothStep(hi, hi + fade, x)));
// modSyntaxsFunc.RoundUp
const roundUp = n => (n - Math.floor(n) > 0 ? Math.floor(n) + 1 : Math.floor(n));
// VB Format(n, "#,#.00") / "#,#.0" / "#,#"
function fmtGroup(n, places) {
  const s = Math.abs(n).toFixed(places);
  let [i, f] = s.split('.');
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (i === '0') i = '';
  return (n < 0 ? '-' : '') + i + (places ? '.' + f : '');
}
const autoAppend = (s, add, glue = ', ') => (s.length > 0 ? (String(add).trim().length > 0 ? s + glue + add : s) : String(add));

// The short exp/hr text MME uses in lists and the detail ("12.3K", "1.20M").
export function formatExpPerHour(n, spaced = false) {
  const sp = spaced ? ' ' : '';
  if (n > 1000000) return fmtGroup(vbRound(n / 1000000, 2), 2) + sp + 'M';
  if (n > 1000) return fmtGroup(vbRound(n / 1000, 1), 1) + sp + 'K';
  return n > 0 ? fmtGroup(roundUp(n), 0) : '0';
}

const blankInfo = () => ({
  nExpPerHour: 0, nHitpointRecovery: 0, nManaRecovery: 0, nTimeRecovering: 0, nOverkill: 0, nMove: 0,
  nRTC: 0, nAttackTime: 0, nSlowdownTime: 0, nRoamTime: 0,
  sHitpointRecovery: '', sManaRecovery: '', sTimeRecovering: '', sRTCText: '', sMoveText: '', sExpAll: '',
});
const pct1 = v => (v * 100).toFixed(1) + '%';

// ---------------------------------------------------------------- IsMobKillable

// modMain.IsMobKillable
export function isMobKillable(charDmg, charHP, mobDmg, mobHP, charHPRegen = 0, mobHPRegen = 0) {
  charHP = cint(charHP); mobHP = cint(mobHP); charHPRegen = cint(charHPRegen); mobHPRegen = cint(mobHPRegen);
  if (charDmg <= 0 && mobHP > 0) return false;
  if (mobHP < 1) return true;
  const regenRounds = mobRegenRounds();
  const factor = 0.25;
  charDmg = charDmg * (factor + 1);
  let roundsToKill = mobHP / charDmg;
  if (roundsToKill < 1) roundsToKill = 1;
  let regenPerRound = 0;
  if (roundsToKill > 1) {
    regenPerRound = mobHPRegen / regenRounds;
    // reducing by percentage chance to reach the hp tick at 90 seconds
    if (roundsToKill < regenRounds) regenPerRound = regenPerRound * (roundsToKill / regenRounds);
  }
  if (regenPerRound > 0) {
    const eff = charDmg - regenPerRound;
    if (eff <= 0) return false;
    roundsToKill = mobHP / eff;
    if (roundsToKill < 1) roundsToKill = 1;
  }
  if (roundsToKill > 720) return false;   // would take over an hour to kill
  mobDmg = mobDmg * (1 - factor);
  if (mobDmg <= 0) return true;
  // nCharTotalHP is a Long
  const charTotalHP = charHPRegen > 0 ? cint(charHP + ((charHP / mobDmg) * (charHPRegen / 3 / 6))) : charHP;
  return charTotalHP / mobDmg >= roundsToKill;
}

// ---------------------------------------------------------------- Model C

// cephC_EstimateMoveSecs
function cephC_EstimateMoveSecs(totalLairs, possSpawns, avgWalk, walkSpeed) {
  const DENSITY_K = 0.2;
  let rooms = avgWalk;
  if (rooms <= 0 || walkSpeed <= 0) return 0;
  let densityFactor = 1;
  if (totalLairs > 0 && possSpawns >= 0) {
    let dens = totalLairs / (totalLairs + possSpawns);
    dens = clampDbl(dens, 0, 1);
    // treat nAvgWalk as already "path-optimized"; only a very mild density
    // effect for extremely sparse zones
    if (dens < 0.05) densityFactor = clampDbl(dens ** DENSITY_K, 0.9, 1.1);
  }
  rooms = rooms * densityFactor;
  if (rooms < 0) rooms = 0;
  return rooms * walkSpeed;
}

const C_XP_KNOB = 1.05, C_REST_KNOB = 0.8, C_SLACK_KNOB = 0.2;
const C_HP_REST_START = 0.75, C_HP_REST_TARGET = 0.9, C_MP_REST_START = 0.25, C_MP_REST_TARGET = 0.9;
const C_MAX_LAIRS_PER_CYCLE = 200;

// cephC_BuildCombatProfile (Model C only; still carries the bugs the 2026-06
// audit lists, which MME left in place)
function cephC_BuildCombatProfile(numMobs, mobHP, mobDmg, charDmg, firstRoundDmg, minRoundDmg,
  surpriseDmg, surpriseMinDmg, surpriseChance, mobHPRegen) {
  const c = { RTK_Mob: 0, RTC_Lair: 0, OverkillFrac: 0, SlowdownFrac: 0, perMobHP: 0, PerMobDmgPerRound: 0 };
  if (numMobs <= 0) numMobs = 1;
  const hp = mobHP / numMobs;
  c.perMobHP = hp;
  c.PerMobDmgPerRound = numMobs > 0 ? mobDmg / numMobs : 0;

  let firstDmgNorm = 0, avgDmgNorm = 0, rtkAvg;
  if (hp <= 0 || (charDmg <= 0 && firstRoundDmg <= 0)) {
    rtkAvg = 1;
  } else {
    firstDmgNorm = firstRoundDmg;
    if (firstDmgNorm <= 0) firstDmgNorm = charDmg;
    avgDmgNorm = charDmg;
    if (avgDmgNorm <= 0) avgDmgNorm = firstDmgNorm;
    const approxRTKNoRegen = avgDmgNorm > 0 ? hp / avgDmgNorm : 0;
    let avgDmgForSeq = avgDmgNorm;
    if (mobHPRegen > 0 && approxRTKNoRegen >= 6) {
      const perMobRegenTick = mobHPRegen / numMobs;
      const regenPerRound = perMobRegenTick * (SEC_PER_ROUND / (mobRegenRounds() * SEC_PER_ROUND));
      avgDmgForSeq = avgDmgNorm - regenPerRound;
      if (avgDmgForSeq < avgDmgNorm * 0.1) avgDmgForSeq = avgDmgNorm * 0.1;
    }
    const baseRTK = startDmg => {
      if (hp <= startDmg) return 1;
      const extra = avgDmgForSeq > 0 ? cephCeil((hp - startDmg) / avgDmgForSeq) : 0;
      return 1 + extra;
    };
    let extraProbNormal = 0;
    if (avgDmgNorm > 0 && minRoundDmg > 0 && minRoundDmg < avgDmgNorm) {
      extraProbNormal = clampDbl((avgDmgNorm - minRoundDmg) / avgDmgNorm, 0, 1);
    }
    const rtkNormal = baseRTK(firstDmgNorm) + extraProbNormal;
    let rtkFirst = rtkNormal;
    if (surpriseDmg > 0 && surpriseChance > 0) {
      let extraProbSurprise = 0;
      if (surpriseDmg > 0 && surpriseMinDmg > 0 && surpriseMinDmg < surpriseDmg) {
        extraProbSurprise = clampDbl((surpriseDmg - surpriseMinDmg) / surpriseDmg, 0, 1);
      }
      const rtkHit = baseRTK(surpriseDmg) + extraProbSurprise;
      const rtkMiss = 1 + rtkNormal;   // on miss: lose 1 round, then a normal kill
      const p = clampDbl(surpriseChance / 100, 0, 1);
      rtkFirst = p * rtkHit + (1 - p) * rtkMiss;
    }
    rtkAvg = (rtkFirst + (numMobs - 1) * rtkNormal) / numMobs;
  }
  c.RTK_Mob = rtkAvg;
  c.RTC_Lair = rtkAvg * numMobs;

  if (hp > 0) {
    let lastRoundDmg, hpBeforeLast;
    if (hp <= firstDmgNorm) {
      lastRoundDmg = firstDmgNorm;
      hpBeforeLast = 0;            // the one-shot overkill bug (audit #1)
    } else {
      const extra = avgDmgNorm > 0 ? cephCeil((hp - firstDmgNorm) / avgDmgNorm) : 0;
      hpBeforeLast = hp - firstDmgNorm - (extra - 1) * avgDmgNorm;
      if (hpBeforeLast < 0) hpBeforeLast = 0;
      lastRoundDmg = avgDmgNorm;
    }
    let spill = lastRoundDmg - hpBeforeLast;
    if (spill < 0) spill = 0;
    c.OverkillFrac = lastRoundDmg > 0 ? clampDbl(spill / lastRoundDmg, 0, 1) : 0;
  }
  c.SlowdownFrac = c.RTK_Mob > 0 ? clampDbl((c.RTK_Mob - 1) / c.RTK_Mob, 0, 1) : 0;
  return c;
}

// cephC_BuildCycleProfile
function cephC_BuildCycleProfile(a, cfg, combat) {
  const { exp, regenTime, totalLairs, possSpawns, avgWalk, walkSpeed, charHP, charHPRegen, charMana,
    charMPRegen, meditateRate, damageThreshold, spellCost, spellOverhead, mobDmg } = a;
  const c = { ExpPerCycle: exp, cycleSecs: 0, attackSecs: 0, moveSecs: 0, restHPSecs: 0, restMPSecs: 0, roamSecs: 0 };
  let attackSecsPerLair = combat.RTC_Lair * SEC_PER_ROUND;
  if (attackSecsPerLair < 0) attackSecsPerLair = 0;

  // boss-style lair: no movement or recovery; only the spawn timer matters
  if (totalLairs <= 0 && regenTime > 0) {
    let regenSecs = regenTime * 3600;   // HOURS between boss kills
    if (regenSecs < attackSecsPerLair) regenSecs = attackSecsPerLair;
    c.attackSecs = attackSecsPerLair;
    c.roamSecs = Math.max(0, regenSecs - attackSecsPerLair);
    c.cycleSecs = regenSecs;
    return c;
  }

  let moveSecsPerLair = 0;
  if (!(totalLairs < 0 && regenTime === 0)) {
    moveSecsPerLair = cephC_EstimateMoveSecs(totalLairs, possSpawns, avgWalk, walkSpeed) * cfg.move;
    if (moveSecsPerLair < 0) moveSecsPerLair = 0;
  }
  const roamSecsPerLair = 0;

  let hpNat = (charHPRegen / 3) / SEC_PER_REGEN_TICK;
  let hpRestExtra = charHPRegen / SEC_PER_REST_TICK;
  let mpNat = charMPRegen / SEC_PER_REGEN_TICK;
  let mpMedExtra = meditateRate > 0 ? meditateRate / SEC_PER_MEDI_TICK : 0;

  let effMobDmg = mobDmg * C_REST_KNOB * cfg.dmg;
  if (effMobDmg < 0) effMobDmg = 0;
  let effAfter = effMobDmg - damageThreshold;
  if (effAfter < 0) effAfter = 0;
  let hpDrain = effAfter * combat.RTC_Lair;
  let effSpell = (spellCost + spellOverhead) * cfg.mana;
  if (effSpell < 0) effSpell = 0;
  let mpDrain = effSpell * combat.RTC_Lair;

  if (damageThreshold < 0) { hpNat = 0; hpRestExtra = 0; mpNat = 0; mpMedExtra = 0; hpDrain = 0; mpDrain = 0; }

  const HPmax = charHP, MPmax = charMana;
  const useHP = HPmax > 0 && (hpDrain > 0 || hpNat > 0 || hpRestExtra > 0);
  const useMP = MPmax > 0 && (mpDrain > 0 || mpNat > 0 || mpMedExtra > 0);
  const thHP = useHP ? C_HP_REST_START * HPmax : 0;
  const targetHP = useHP ? Math.min(C_HP_REST_TARGET * HPmax, HPmax) : 0;
  const thMP = useMP ? C_MP_REST_START * MPmax : 0;
  const targetMP = useMP ? Math.min(C_MP_REST_TARGET * MPmax, MPmax) : 0;

  if (!useHP && !useMP) {
    c.attackSecs = attackSecsPerLair; c.moveSecs = moveSecsPerLair; c.roamSecs = roamSecsPerLair;
    c.cycleSecs = attackSecsPerLair + moveSecsPerLair;
    return c;
  }

  let HPcur = HPmax, MPcur = MPmax, totAttack = 0, totMove = 0, totRestHP = 0, totRestMP = 0, lairs = 0;
  for (let i = 1; i <= C_MAX_LAIRS_PER_CYCLE; i++) {
    if (moveSecsPerLair > 0) {
      if (useHP && hpNat > 0) HPcur = Math.min(HPmax, HPcur + hpNat * moveSecsPerLair);
      if (useMP && mpNat > 0) MPcur = Math.min(MPmax, MPcur + mpNat * moveSecsPerLair);
      totMove += moveSecsPerLair;
    }
    if (useHP) {
      HPcur -= hpDrain;
      if (hpNat > 0) HPcur += hpNat * attackSecsPerLair;
      if (HPcur < 0) HPcur = 0;
      if (HPcur > HPmax) HPcur = HPmax;
    }
    if (useMP) {
      MPcur -= mpDrain;
      if (mpNat > 0) MPcur += mpNat * attackSecsPerLair;
      if (MPcur < 0) MPcur = 0;
      if (MPcur > MPmax) MPcur = MPmax;
    }
    totAttack += attackSecsPerLair;
    lairs++;
    if (useHP && HPcur <= thHP) break;
    if (useMP && MPcur <= thMP) break;
  }
  if (lairs <= 0) lairs = 1;

  if (useHP && HPcur < targetHP) {
    const rate = hpNat + hpRestExtra;
    if (rate > 0) {
      const secs = Math.max(0, Math.max(0, targetHP - HPcur) / rate);
      totRestHP += secs;
      HPcur = Math.min(HPmax, HPcur + rate * secs);
      if (useMP && mpNat > 0) MPcur = Math.min(MPmax, MPcur + mpNat * secs);
    }
  }
  if (useMP && MPcur < targetMP) {
    const rate = mpNat + mpMedExtra;
    if (rate > 0) {
      const secs = Math.max(0, Math.max(0, targetMP - MPcur) / rate);
      totRestMP += secs;
      MPcur = Math.min(MPmax, MPcur + rate * secs);
      if (useHP && hpNat > 0) HPcur = Math.min(HPmax, HPcur + hpNat * secs);
    }
  }
  c.attackSecs = totAttack / lairs;
  c.moveSecs = totMove / lairs;
  c.restHPSecs = totRestHP / lairs;
  c.restMPSecs = totRestMP / lairs;
  c.roamSecs = roamSecsPerLair;
  c.cycleSecs = c.attackSecs + c.moveSecs + c.restHPSecs + c.restMPSecs;
  return c;
}

// ceph_ModelC: per-lair "cycle" macro-simulation (legacy; basis for D)
export function modelC(a, cfg) {
  a = { ...a };
  if (a.numMobs <= 0) a.numMobs = 1;
  if (a.walkSpeed <= 0) a.walkSpeed = 1;
  const { exp, regenTime, numMobs, totalLairs, charDmg, charHP, charHPRegen, mobDmg, mobHP, damageThreshold,
    spellCost, spellOverhead, charMana, charMPRegen, surpriseDmg } = a;
  const r = blankInfo();
  const combat = cephC_BuildCombatProfile(numMobs, mobHP, mobDmg, charDmg, a.firstRoundDmg, a.minRoundDmg,
    surpriseDmg, a.surpriseMinDmg, a.surpriseChance, a.mobHPRegen);
  const cycle = cephC_BuildCycleProfile(a, cfg, combat);
  const isBoss = totalLairs <= 0 && regenTime > 0;

  // non-rest overhead ("slack"), only when there is no explicit rest
  if (!isBoss && cycle.restHPSecs <= 0 && cycle.restMPSecs <= 0) {
    const baseAM = cycle.attackSecs + cycle.moveSecs;
    if (baseAM > 0) {
      let rtkEff = combat.RTK_Mob;
      if (rtkEff <= 0) rtkEff = 1;
      const slack = C_SLACK_KNOB * (cycle.attackSecs / rtkEff);
      if (slack > 0) {
        const s = (baseAM + slack) / baseAM;
        cycle.attackSecs *= s;
        cycle.moveSecs *= s;
        cycle.cycleSecs = cycle.attackSecs + cycle.moveSecs + cycle.restHPSecs + cycle.restMPSecs;
      }
    }
  }
  const totalSecs = cycle.cycleSecs;
  if (totalSecs <= 0) return r;

  let lairsPerHour = 3600 / totalSecs;
  if (totalLairs > 0 && regenTime > 0) {
    const supply = totalLairs * (60 / regenTime);
    if (supply > 0 && lairsPerHour > supply) lairsPerHour = supply;
  }
  if (lairsPerHour < 0) lairsPerHour = 0;

  const attackPH = cycle.attackSecs * lairsPerHour;
  const movePH = cycle.moveSecs * lairsPerHour;
  const restHPPH = cycle.restHPSecs * lairsPerHour;
  const restMPPH = cycle.restMPSecs * lairsPerHour;
  let roamPH = 3600 - (attackPH + movePH + restHPPH + restMPPH);
  if (roamPH < 0) roamPH = 0;
  const used = attackPH + movePH + restHPPH + restMPPH + roamPH;
  if (used <= 0) return r;

  r.nExpPerHour = exp * lairsPerHour;
  if (!isBoss) r.nExpPerHour = r.nExpPerHour * C_XP_KNOB * cfg.xp;
  const totalRest = restHPPH + restMPPH;
  r.nAttackTime = attackPH / used;
  r.nMove = movePH / used;
  r.nRoamTime = roamPH / used;
  if (totalRest > 0) {
    r.nTimeRecovering = totalRest / used;
    if (restHPPH <= 0 && restMPPH > 0) { r.nManaRecovery = r.nTimeRecovering; }
    else if (restMPPH <= 0 && restHPPH > 0) { r.nHitpointRecovery = r.nTimeRecovering; }
    else {
      // both: pressure-based split
      const hpNat = (charHPRegen / 3) / SEC_PER_REGEN_TICK, mpNat = charMPRegen / SEC_PER_REGEN_TICK;
      const effAfter = Math.max(0, mobDmg * cfg.dmg - damageThreshold);
      const effSpell = Math.max(0, (spellCost + spellOverhead) * cfg.mana);
      const active = Math.max(0, cycle.attackSecs + cycle.moveSecs);
      const netHP = Math.max(0, effAfter * combat.RTC_Lair - hpNat * active);
      const netMP = Math.max(0, effSpell * combat.RTC_Lair - mpNat * active);
      const hpPress = charHP > 0 ? netHP / (charHP + 1) : 0;
      const mpPress = charMana > 0 ? netMP / (charMana + 1) : 0;
      let hw, mw;
      if (hpPress <= 0 && mpPress <= 0) { hw = restHPPH / totalRest; mw = restMPPH / totalRest; }
      else { hw = hpPress / (hpPress + mpPress); mw = mpPress / (hpPress + mpPress); }
      r.nHitpointRecovery = r.nTimeRecovering * hw;
      r.nManaRecovery = r.nTimeRecovering * mw;
    }
  }
  r.nOverkill = combat.OverkillFrac;
  r.nSlowdownTime = combat.SlowdownFrac;
  r.nRTC = combat.RTC_Lair;
  // surprise inefficiency flag: surprise worse than a normal round
  if (surpriseDmg > 0 && charDmg > 0 && surpriseDmg < charDmg && charDmg < mobHP / numMobs) r.nAttackTime *= -1;
  modelStrings(r);
  return r;
}

function modelStrings(r) {
  r.sHitpointRecovery = pct1(r.nHitpointRecovery);
  r.sManaRecovery = pct1(r.nManaRecovery);
  r.sTimeRecovering = pct1(r.nTimeRecovering);
  r.sMoveText = pct1(r.nMove);
  r.sRTCText = 'RTC ' + r.nRTC.toFixed(2);
}

// ---------------------------------------------------------------- Model D

const D_KILL_OVERHEAD_SEC = 1.5;   // looting/retarget/latency seconds per kill (overlaps recovery)
const D_HEAVY_REST_RELIEF = 0.35;  // max fraction of HP-rest trimmed on brutal fights
const D_MEDITATE_EFF = 0.5;        // meditate skill efficiency; passive MP unaffected

// cephD_OverkillFrac: display-only per-mob overkill (one-shot bug fixed)
export function cephD_OverkillFrac(perMobHP, charDmg, firstRoundDmg) {
  if (perMobHP <= 0) return 0;
  let firstDmg = firstRoundDmg;
  if (firstDmg <= 0) firstDmg = charDmg;
  let avgDmg = charDmg;
  if (avgDmg <= 0) avgDmg = firstDmg;
  if (avgDmg <= 0) return 0;
  let lastDmg, hpBeforeLast;
  if (perMobHP <= firstDmg) { lastDmg = firstDmg; hpBeforeLast = perMobHP; }
  else {
    const extra = cephCeil((perMobHP - firstDmg) / avgDmg);
    hpBeforeLast = Math.max(0, perMobHP - firstDmg - (extra - 1) * avgDmg);
    lastDmg = avgDmg;
  }
  const spill = Math.max(0, lastDmg - hpBeforeLast);
  return lastDmg > 0 ? clampDbl(spill / lastDmg, 0, 1) : 0;
}

// ceph_ModelD: round-by-round simulation in game ticks (recommended)
export function modelD(a, cfg) {
  let { numMobs, walkSpeed } = a;
  const { exp, regenTime, totalLairs, rtk, charDmg, charHP, charHPRegen, mobDmg, mobHP, damageThreshold,
    spellCost, spellOverhead, charMana, charMPRegen, meditateRate, avgWalk, firstRoundDmg } = a;
  const r = blankInfo();
  if (numMobs <= 0) numMobs = 1;
  if (walkSpeed <= 0) walkSpeed = 1;
  const isBoss = totalLairs <= 0 && regenTime > 0;
  const instant = totalLairs < 0 && regenTime === 0;
  const unlimited = damageThreshold < 0;

  // canonical RTK (CalcCombatRounds via GetLairInfo); derive like Model A if 0
  let rtkAvg = rtk;
  if (rtkAvg <= 0 && charDmg > 0 && mobHP > 0) {
    const hpPerMob = numMobs > 1 ? mobHP / numMobs : mobHP;
    rtkAvg = hpPerMob / charDmg;
    if (rtkAvg > 1) rtkAvg = -Math.floor(-(rtkAvg * 2)) / 2;
  }
  if (rtkAvg < 1) rtkAvg = 1;
  let RTC = rtkAvg * numMobs;
  if (RTC < 1) RTC = 1;
  const attackSecs = RTC * SEC_PER_ROUND;
  const perMobHP = mobHP / numMobs;

  // undo GetLairInfo's (AvgDmg * nRTK) / avgAlive to get per-mob, per-round damage
  let perMobDmg = mobDmg;
  if (numMobs > 1) perMobDmg = perMobDmg * ((numMobs + 1) / (2 * numMobs));
  if (rtk > 1) perMobDmg = perMobDmg / rtk;
  if (perMobDmg < 0) perMobDmg = 0;

  let hpLost = 0;
  if (!unlimited) {
    let rounds = cint(cephCeil(RTC));
    if (rounds < 1) rounds = 1;
    for (let rr = 1; rr <= rounds; rr++) {
      const killedBefore = Math.floor((rr - 1) / rtkAvg);
      let alive = numMobs - killedBefore;
      if (alive < 1) alive = 1;
      let incoming = alive * perMobDmg - damageThreshold;
      if (incoming < 0) incoming = 0;
      if (rr === rounds) {
        let frac = RTC - (rounds - 1);
        if (frac <= 0) frac = 1;
        if (frac > 1) frac = 1;
        incoming *= frac;
      }
      hpLost += incoming;
    }
    hpLost *= cfg.dmg;
    if (hpLost < 0) hpLost = 0;
  }

  let effSpell = (spellCost + spellOverhead) * cfg.mana;
  if (effSpell < 0) effSpell = 0;
  const mpSpent = unlimited ? 0 : effSpell * RTC;

  let moveSecs = 0;
  if (!isBoss && !instant) moveSecs = Math.max(0, avgWalk * walkSpeed * cfg.move);

  const passiveHPps = (charHPRegen / 3) / SEC_PER_REGEN_TICK;
  const restHPps = charHPRegen / SEC_PER_REST_TICK + passiveHPps;
  const passiveMPps = charMPRegen / SEC_PER_REGEN_TICK;
  const medMPps = (meditateRate > 0 ? D_MEDITATE_EFF * (meditateRate / SEC_PER_MEDI_TICK) : 0) + passiveMPps;

  const HPmax = charHP, MPmax = charMana;
  const useHP = !unlimited && HPmax > 0 && hpLost > 0;
  const useMP = !unlimited && MPmax > 0 && mpSpent > 0;
  let restHPPerLair = 0, medMPPerLair = 0;

  // serialized recovery macro-cycle
  if (!isBoss && (useHP || useMP)) {
    const thHP = C_HP_REST_START * HPmax, tgHP = C_HP_REST_TARGET * HPmax;
    const thMP = C_MP_REST_START * MPmax, tgMP = C_MP_REST_TARGET * MPmax;
    let HPcur = HPmax, MPcur = MPmax, lairs = 0, totRest = 0, totMed = 0;
    for (let k = 1; k <= C_MAX_LAIRS_PER_CYCLE; k++) {
      if (moveSecs > 0) {
        HPcur = Math.min(HPmax, HPcur + passiveHPps * moveSecs);
        MPcur = Math.min(MPmax, MPcur + passiveMPps * moveSecs);
      }
      if (useHP) HPcur = Math.max(0, Math.min(HPmax, HPcur - hpLost + passiveHPps * attackSecs));
      if (useMP) MPcur = Math.max(0, Math.min(MPmax, MPcur - mpSpent + passiveMPps * attackSecs));
      lairs++;
      if (useHP && HPcur <= thHP) break;
      if (useMP && MPcur <= thMP) break;
    }
    if (lairs < 1) lairs = 1;
    if (useHP && HPcur < tgHP && restHPps > 0) {
      const secs = Math.max(0, (tgHP - HPcur) / restHPps);
      totRest += secs;
      HPcur = tgHP;
      MPcur = Math.min(MPmax, MPcur + passiveMPps * secs);
    }
    if (useMP && MPcur < tgMP && medMPps > 0) {
      const secs = Math.max(0, (tgMP - MPcur) / medMPps);
      totMed += secs;
      MPcur = tgMP;
      HPcur = Math.min(HPmax, HPcur + passiveHPps * secs);
    }
    restHPPerLair = totRest / lairs;
    medMPPerLair = totMed / lairs;
  }

  // realism terms: heavy-hit rest relief, then per-kill overhead gated by recovery
  let overheadSecs = 0;
  if (!isBoss) {
    if (HPmax > 0 && restHPPerLair > 0) {
      const relief = D_HEAVY_REST_RELIEF * smoothStep(0.25, 0.5, hpLost / HPmax);
      restHPPerLair *= 1 - relief;
    }
    const rec = restHPPerLair + medMPPerLair;
    const recFrac = safeDiv(rec, attackSecs + moveSecs + rec, 0);
    const gate = 1 - smoothStep(0.1, 0.35, recFrac);
    overheadSecs = Math.max(0, D_KILL_OVERHEAD_SEC * numMobs * gate);
  }

  let cycleSecs;
  if (isBoss) {
    let regenSecs = regenTime * 3600;   // HOURS between boss kills
    if (regenSecs < attackSecs) regenSecs = attackSecs;
    cycleSecs = regenSecs;
    moveSecs = 0; restHPPerLair = 0; medMPPerLair = 0;
  } else {
    cycleSecs = attackSecs + moveSecs + restHPPerLair + medMPPerLair + overheadSecs;
  }
  if (cycleSecs <= 0) return r;

  let lairsPerHour = 3600 / cycleSecs;
  if (totalLairs > 0 && regenTime > 0) {
    // lairs respawn on the wall-clock minute: regen + ~0.25 min on average
    const supply = totalLairs * (60 / (regenTime + 0.25));
    if (supply > 0 && lairsPerHour > supply) lairsPerHour = supply;
  }
  if (lairsPerHour < 0) lairsPerHour = 0;

  const attackPH = (attackSecs + overheadSecs) * lairsPerHour;
  const movePH = moveSecs * lairsPerHour;
  const restHPPH = restHPPerLair * lairsPerHour;
  const restMPPH = medMPPerLair * lairsPerHour;
  const roamPH = Math.max(0, 3600 - (attackPH + movePH + restHPPH + restMPPH));
  const used = attackPH + movePH + restHPPH + restMPPH + roamPH;
  if (used <= 0) return r;

  r.nExpPerHour = exp * lairsPerHour;
  if (!isBoss) r.nExpPerHour *= cfg.xp;
  r.nAttackTime = attackPH / used;
  r.nMove = movePH / used;
  r.nRoamTime = roamPH / used;
  r.nHitpointRecovery = restHPPH / used;
  r.nManaRecovery = restMPPH / used;
  r.nTimeRecovering = (restHPPH + restMPPH) / used;
  r.nOverkill = cephD_OverkillFrac(perMobHP, charDmg, firstRoundDmg);
  r.nSlowdownTime = clampDbl((rtkAvg - 1) / rtkAvg, 0, 1);
  r.nRTC = RTC;
  modelStrings(r);
  r.debug = { perMobDmg, hpLostPerLair: hpLost, mpSpentPerLair: mpSpent, attackSecs, moveSecs,
    restHPSecsPerLair: restHPPerLair, medMPSecsPerLair: medMPPerLair, overheadSecs, cycleSecs, lairsPerHour };
  return r;
}

// ---------------------------------------------------------------- Model A

// cephA_CalcHPRecoveryRounds v4.0: rest rounds for nDmgIN per round, with
// the q-elasticity damping
function cephA_CalcHPRecoveryRounds(dmgIn, dmgOut, mobHP, restHP, mobs = 0, rtc = 0) {
  if (dmgIn <= 0) return 0;
  mobs = cint(mobs);                       // nMobs As Integer
  if (mobs < 1) mobs = 1;
  if (restHP < 1) restHP = 1;
  let r;
  if (rtc === 0 && dmgOut > 0) {
    r = dmgOut >= mobHP ? 1 : mobHP / dmgOut;
    if (mobs > 1) r *= mobs;
  } else r = rtc;
  if (r < 1) r = 1;
  const combatSecs = r * SEC_PER_ROUND;
  const dmgInTotal = r * dmgIn;
  const passivePerTick = restHP / 3;
  const passiveHealCombat = DEFAULT_CEPHA_HP_PASSIVE_COMBAT_EFF * (combatSecs / SEC_PER_REGEN_TICK) * passivePerTick;
  let netDmg = dmgInTotal - passiveHealCombat;
  if (netDmg < 0) netDmg = 0;
  const restHealPerSec = restHP / SEC_PER_REST_TICK + passivePerTick / SEC_PER_REGEN_TICK;
  let restRounds = restHealPerSec > 0 ? netDmg / (restHealPerSec * SEC_PER_ROUND) : 0;
  if (restRounds < 0) restRounds = 0;
  const restHealPerRound = restHealPerSec * SEC_PER_ROUND;
  const q = restHealPerRound > 0 ? dmgIn / restHealPerRound : 0;
  let g;
  if (q <= 0) g = 1;
  else if (q < 1) g = 0.6 + 0.4 * q;
  else if (q <= 4) { g = 1 - 0.4 * (q - 1) / 3; if (g < 0.6) g = 0.6; }
  else g = 0.6;
  restRounds *= g;
  return restRounds < 0 ? 0 : restRounds;
}

// cephA_InCombatMPFrac
function cephA_InCombatMPFrac(meditateRate, totalLairs, avgWalk) {
  let f = 0.26;
  if (meditateRate > 0) {
    if (totalLairs >= 28 && avgWalk <= 3.5) f += 0.02;
    return clampDbl(f, 0.1, 0.4);
  }
  return clampDbl(f, 0.1, 0.35);
}

// ceph_ModelA v5.7: closed form with q-elasticity HP recovery, a mana-pool
// model, density-based movement and overlap credits (legacy)
export function modelA(a, cfg) {
  let { regenTime, numMobs, rtk, charHP, charHPRegen, mobHP, damageThreshold } = a;
  const { exp, totalLairs, possSpawns, charDmg, mobDmg, mobHPRegen, spellCost, spellOverhead, charMana,
    charMPRegen, meditateRate, avgWalk, walkSpeed, surpriseDmg } = a;
  const r = blankInfo();
  if (exp === 0) return r;
  if (totalLairs === 0 && regenTime === 0) return r;

  let basicDamage = false;
  if (damageThreshold === -1) { basicDamage = true; damageThreshold = 2000000000; }

  let nRouteBiasLocal = 0.98;
  let limitMovement = false;
  if (avgWalk > 0 && avgWalk <= 2 && totalLairs > 0 && possSpawns > totalLairs) {
    // cluster detection (i.e. gnoll encampment)
    if (possSpawns / totalLairs >= DEFAULT_CEPHA_ClusterMx) limitMovement = true;
  }
  let secsPerRoom = walkSpeed;
  if (secsPerRoom < 1) secsPerRoom = 1;
  if (secsPerRoom > 2) secsPerRoom = 2;
  const regenRounds = mobRegenRounds();

  if (charHP < 1) charHP = 1;
  if (mobHP < 1) mobHP = 1;
  if (charHPRegen < 1) charHPRegen = 1;
  if (regenTime < 0) regenTime = 0;
  if (regenTime > 60) regenTime = 60;

  if (rtk === 0 && charDmg > 0 && mobHP > 0) {
    const hpPerMob = numMobs > 1 ? mobHP / numMobs : mobHP;
    rtk = hpPerMob / charDmg;
    if (rtk > 1) rtk = -Math.floor(-(rtk * 2)) / 2;
  }
  if (rtk < 1) rtk = 1;
  if (numMobs < 1) numMobs = 1;
  const nRTC = rtk * numMobs;

  // surprise opener (either/or; can add OR subtract rounds)
  let mobDmgUse = mobDmg, rtcEff = nRTC, surpriseLess = false;
  if (surpriseDmg > 0) {
    let hp1 = numMobs > 1 ? mobHP / numMobs : mobHP;
    if (hp1 < 1) hp1 = 1;
    const aSharp = 6;
    let rtkNns, pKillN;
    if (charDmg > 0) {
      rtkNns = -Math.floor(-(hp1 / charDmg) * 2) / 2;
      pKillN = 1 / (1 + Math.exp(-aSharp * (charDmg / hp1 - 1)));
    } else { rtkNns = rtk; pKillN = 0; }
    if (rtkNns < 1) rtkNns = 1;
    pKillN = clampDbl(pKillN, 0, 1);
    const rtkNeff = pKillN + (1 - pKillN) * rtkNns;
    const rmn = Math.max(0, hp1 - surpriseDmg);
    let rtkSns = 1 + (-Math.floor(-((rmn / (charDmg > 0 ? charDmg : 1)) * 2)) / 2);
    if (rtkSns < 1) rtkSns = 1;
    const pKillS = clampDbl(1 / (1 + Math.exp(-aSharp * (surpriseDmg / hp1 - 1))), 0, 1);
    const rtkSeff = pKillS + (1 - pKillS) * rtkSns;
    const deltaFirst = rtkSeff - rtkNeff;
    if (deltaFirst < 0) {
      // surprise is BETTER -> reduce rounds (attenuate the savings only)
      let saved = -deltaFirst;
      const regenPerRound = mobHPRegen / regenRounds;
      const regenRatio = charDmg > 0 ? regenPerRound / charDmg : 0;
      // (the VB inlines SmoothStep(0, 0.6) without clamping the ratio)
      let regenAtten = 1 - 0.45 * (regenRatio <= 0 ? 0 : ((regenRatio / 0.6) ** 2) * (3 - 2 * (regenRatio / 0.6)));
      if (regenAtten < 0.55) regenAtten = 0.55;
      const packFade = 1 / Math.sqrt(numMobs > 1 ? numMobs : 1);
      let fadeGate = 0;
      if (numMobs > 3) { const t = clampDbl((numMobs - 3) / 5, 0, 1); fadeGate = t * t * (3 - 2 * t); }
      saved = saved * (1 - (1 - packFade) * fadeGate) * regenAtten;
      rtcEff = nRTC - saved;
      if (rtcEff < numMobs) rtcEff = numMobs;
    } else if (deltaFirst > 0 && charDmg < mobHP / numMobs) {
      rtcEff = nRTC + deltaFirst;        // surprise is WORSE
      surpriseLess = true;
    } else rtcEff = nRTC;
    const pDeleteDelta = pKillS - pKillN;
    if (pDeleteDelta > 0) mobDmgUse = Math.max(0, mobDmg * (1 - pDeleteDelta / numMobs));
  }

  // NPC / boss shortcut
  if (totalLairs <= 0 && regenTime > 0) {
    r.nExpPerHour = vbRound(exp * (1 / regenTime));
    return r;
  }
  // lair regen happens by time of day: regen time + the rest of the minute
  if (regenTime > 0) regenTime += 0.25;

  const killTimeSec = rtcEff * SEC_PER_ROUND;
  let overshootFrac = 0;
  if (charDmg > 0) {
    const totalDamage = rtk * charDmg;
    const effMobHP = numMobs > 1 ? mobHP / numMobs : mobHP;
    if (totalDamage > effMobHP) overshootFrac = ((totalDamage - effMobHP) / totalDamage) * 0.8;
    else if (effMobHP > 0 && rtk !== fix(rtk)) overshootFrac = (Math.abs(rtk - fix(rtk)) * charDmg) / effMobHP;
  }

  let nLocalDmgScaleFactor = 0, roundsHitpoints = 0, hpRecSec = 0, hpRec = 0, manaRecSec = 0, manaRec = 0;
  let recoveryDemandFrac = 0, recoveryDemandTime = 0, recoveryTimeSec = 0, recoveryCreditSec = 0;
  let mpPerSecRegen = 0, mpPerSecMeditate = 0, costRoom = 0, regenRoom = 0, drainRoom = 0, roomsPerPool = 0;
  let tRefill = 0, tRestAvg = 0, hpFullySustained = false;

  if (!basicDamage) {
    // HP recovery
    let dmgInHP = mobDmgUse;
    if (damageThreshold > 0) dmgInHP = Math.max(0, dmgInHP - damageThreshold);
    const qRatio = dmgInHP > 0 ? safeDiv(charHPRegen, dmgInHP) : 9999;
    if (qRatio < 0.3) nLocalDmgScaleFactor = 1.2;
    else if (qRatio <= 0.7) nLocalDmgScaleFactor = 1.05 + 0.375 * (0.7 - qRatio);
    else nLocalDmgScaleFactor = 1;
    if (damageThreshold > 0 && (dmgInHP <= 0.0001 || qRatio >= 4)) hpFullySustained = true;
    if (!hpFullySustained) {
      let dmgPerRound = dmgInHP;
      if (dmgPerRound < 0.05) dmgPerRound = 0;
      roundsHitpoints = dmgPerRound > 0 ? cephA_CalcHPRecoveryRounds(dmgInHP, charDmg, mobHP, charHPRegen, numMobs, rtcEff) : 0;
    }
    hpRecSec = Math.max(0, roundsHitpoints * SEC_PER_ROUND);
    hpRec = killTimeSec + hpRecSec > 0 ? hpRecSec / (killTimeSec + hpRecSec) : 0;
    hpRec = clampDbl(hpRec, 0, 1);

    // mana recovery (per-room pool model)
    mpPerSecRegen = charMPRegen / SEC_PER_REGEN_TICK;
    const MED_EFF_FACTOR = 0.5;
    mpPerSecMeditate = mpPerSecRegen + MED_EFF_FACTOR * (meditateRate / SEC_PER_MEDI_TICK);
    const mpUseFrac = cephA_InCombatMPFrac(meditateRate, totalLairs, avgWalk);
    const mpCostFrac = spellCost > 0 ? 1 : mpUseFrac;
    costRoom = spellCost * rtcEff + spellOverhead * rtcEff * mpCostFrac;
    regenRoom = mpPerSecRegen * killTimeSec;
    drainRoom = Math.max(0, costRoom - regenRoom);
    roomsPerPool = drainRoom === 0 || charMana === 0 ? 1e30 : charMana / drainRoom;
    const refillTarget = 0.95 * charMana;
    tRefill = mpPerSecMeditate > 0 ? refillTarget / mpPerSecMeditate : 0;
    tRestAvg = tRefill / roomsPerPool;
    manaRecSec = Math.max(0, tRestAvg * DEFAULT_CEPHA_Mana * cfg.mana);
    manaRec = killTimeSec + manaRecSec > 0 ? manaRecSec / (killTimeSec + manaRecSec) : 0;
    if (manaRec > 1) manaRec = 1;
    if (manaRec === 1) manaRecSec = killTimeSec * 2;
    else if (manaRec > 0 && manaRecSec === 0) manaRecSec = killTimeSec * (manaRec / (1 - manaRec));
    if (manaRecSec < 0) manaRecSec = 0;

    recoveryDemandFrac = clampDbl(hpRec + manaRec - hpRec * manaRec, 0, 1);
    if (recoveryDemandFrac > 0 && recoveryDemandFrac < 1) recoveryDemandTime = killTimeSec * (recoveryDemandFrac / (1 - recoveryDemandFrac));
    else if (recoveryDemandFrac >= 1) recoveryDemandTime = 3600;
    else recoveryDemandTime = 0;
  }

  // movement model
  let moveBaseSec, pTravel = 0, densityP = 0;
  if (totalLairs > 0 && !limitMovement) {
    const roomsRaw = possSpawns + totalLairs;
    let effectiveLairs, roomsScaled, maxRooms;
    if (regenTime > 0) {
      effectiveLairs = (60 * regenTime) / 5;
      if (effectiveLairs > totalLairs) { roomsScaled = roomsRaw * (totalLairs / effectiveLairs); effectiveLairs = totalLairs; }
      else roomsScaled = roomsRaw;
      maxRooms = effectiveLairs * (60 / regenTime);
    } else { effectiveLairs = totalLairs; roomsScaled = roomsRaw; maxRooms = 720; }
    if (roomsScaled > maxRooms) roomsScaled = maxRooms;
    densityP = roomsScaled <= 0 ? 1 : clampDbl(effectiveLairs / roomsScaled, 0.01, 1);
    pTravel = clampDbl(totalLairs / roomsRaw, 0.0001, 1);
    if (pTravel < 0.1) nRouteBiasLocal = 0.7 + 3 * pTravel;
    else if (pTravel < 0.18) {
      if (densityP > 0.5) nRouteBiasLocal = 1.08;
      else if (densityP >= 0.25 && densityP <= 0.4) nRouteBiasLocal = 0.85;
      else nRouteBiasLocal = 1.02;
    } else nRouteBiasLocal = 0.98;
    const MOVE_TARGET_SECS = 2.2, DENSITY_COEF = 0.2;
    let coef = DENSITY_COEF;
    if (DEFAULT_CEPHA_Move > 0) coef *= DEFAULT_CEPHA_Move;
    if (cfg.move > 0) coef *= cfg.move;
    const targetFactor = MOVE_TARGET_SECS / secsPerRoom;
    let scaleFactor;
    if (densityP !== 0 && coef !== 0 && coef !== 1) {
      scaleFactor = 1 + ((1 / densityP - 1) / (1 / coef - 1)) * (targetFactor - 1);
      if (scaleFactor < 1) scaleFactor = 1;
    } else if (coef === 0) scaleFactor = 0.00001;
    else scaleFactor = targetFactor;
    const secsPerRoomEff = secsPerRoom * scaleFactor;
    const nMoveBias = 0.75;
    const densForSpawn = clampDbl(pTravel, 0.0001, 1);
    const moveSpawnBased = ((1 - densForSpawn) / densForSpawn) * secsPerRoomEff * nMoveBias;
    let moveRouteBased = ((roomsRaw / totalLairs) - 1) * secsPerRoom * nRouteBiasLocal * DEFAULT_CEPHA_Move * cfg.move;
    if (pTravel >= 0.2 && pTravel <= 0.3) moveRouteBased *= 1 + 0.1 * (pTravel - 0.2) / 0.1;
    if (densityP > 0.8 && moveRouteBased < 2 * secsPerRoom) moveRouteBased = 2 * secsPerRoom;
    if (moveRouteBased < 0) moveRouteBased = 0;
    moveBaseSec = moveRouteBased > moveSpawnBased ? moveRouteBased : moveSpawnBased;
  } else if (limitMovement) moveBaseSec = secsPerRoom * avgWalk;
  else moveBaseSec = secsPerRoom;

  if (!basicDamage) {
    // walk credit rolled back into the mana model
    const regenWalkRaw = mpPerSecRegen * moveBaseSec;
    let regenWalk;
    if (limitMovement) regenWalk = regenWalkRaw * 0.25;
    else {
      let walkScale = 1;
      if (pTravel < 0.25) { walkScale = 0.4 + 2 * pTravel; if (walkScale > 0.9) walkScale = 0.9; }
      regenWalk = regenWalkRaw * walkScale;
    }
    const walkCap = (killTimeSec <= 6 ? 0.7 : 0.4) * killTimeSec * mpPerSecRegen;
    if (regenWalk > walkCap) regenWalk = walkCap;
    regenRoom += regenWalk;
    drainRoom = Math.max(0, costRoom - regenRoom);
    if (drainRoom === 0) roomsPerPool = 1e30;
    else { roomsPerPool = charMana / drainRoom; if (roomsPerPool < 1) roomsPerPool = 1; }
    tRestAvg = tRefill / roomsPerPool;
    manaRecSec = Math.max(0, tRestAvg * DEFAULT_CEPHA_Mana * cfg.mana);
    manaRec = killTimeSec + manaRecSec > 0 ? manaRecSec / (killTimeSec + manaRecSec) : 0;
    if (manaRec > 1) manaRec = 1;

    // loop-level HP fallback (pre-overlap) when per-clear rest collapsed to ~0
    let restSecsLoop = 0, restRoundsLoop = 0;
    if (manaRecSec <= 0) {
      if (!hpFullySustained && roundsHitpoints <= 0 && mobDmgUse > 0 && totalLairs > 0) {
        const combatSecs = maxDbl(0, rtcEff) * SEC_PER_ROUND;
        const passiveCombatHP = DEFAULT_CEPHA_HP_PASSIVE_COMBAT_EFF * (charHPRegen / 3) * safeDiv(combatSecs, SEC_PER_REGEN_TICK);
        let dmgPerRoundHP = mobDmgUse;
        if (damageThreshold > 0) dmgPerRoundHP = Math.max(0, dmgPerRoundHP - damageThreshold);
        const dmgTotal = dmgPerRoundHP * maxDbl(1, rtcEff);
        const lairNetHP = maxDbl(0, dmgTotal - passiveCombatHP);
        const loopDeficitHP = maxDbl(0, lairNetHP * totalLairs - 0.02 * charHP);
        const restHPperSec = charHPRegen / SEC_PER_REST_TICK + (charHPRegen / 3) / SEC_PER_REGEN_TICK;
        restSecsLoop = safeDiv(loopDeficitHP, maxDbl(0.0001, restHPperSec));
        restRoundsLoop = safeDiv(restSecsLoop, SEC_PER_ROUND);
        if (restRoundsLoop > roundsHitpoints) roundsHitpoints = restRoundsLoop;
      }
    }
    if (restSecsLoop > 0) {
      hpRecSec = maxDbl(hpRecSec, restSecsLoop);
      roundsHitpoints = maxDbl(roundsHitpoints, restRoundsLoop);
    }
    const T_HP0 = maxDbl(hpRecSec, roundsHitpoints * SEC_PER_ROUND);
    const T_M0 = manaRecSec;

    // walk/rest overlap credit (revised 2025-11-10)
    const walkWindow = moveBaseSec;
    const passiveHPps = (charHPRegen / 3) / SEC_PER_REGEN_TICK;
    const restHPps = charHPRegen / SEC_PER_REST_TICK + passiveHPps;
    const hpWalkEq = restHPps > 0 ? passiveHPps / restHPps : 0;
    const moveCredHP = DEFAULT_CEPHA_MoveRecover * hpWalkEq * (T_HP0 < walkWindow ? T_HP0 : walkWindow);
    const passiveMPps = charMPRegen / SEC_PER_REGEN_TICK;
    const medMPps = meditateRate / SEC_PER_MEDI_TICK + passiveMPps;
    const mpWalkEq = medMPps > 0 ? passiveMPps / medMPps : 0;
    let moveCredMP = DEFAULT_CEPHA_MoveRecover * mpWalkEq * (T_M0 < walkWindow ? T_M0 : walkWindow);
    const walkLeft = Math.max(0, walkWindow - moveCredHP);
    if (moveCredMP > walkLeft) moveCredMP = walkLeft;
    let T_HP1 = Math.max(0, T_HP0 - moveCredHP);
    const T_M1 = Math.max(0, T_M0 - moveCredMP);
    recoveryCreditSec = moveCredHP + moveCredMP;
    const restManaCredit = 0 > T_M1 ? T_M1 : 0;   // restAsManaEq is never set (the patch left it 0)
    const T_M2 = Math.max(0, T_M1 - restManaCredit);

    // hard gate: no HP rest when net per-round damage <= 0
    let core = mobDmgUse;
    if (damageThreshold > 0) core -= damageThreshold;
    if (core <= 0.0001) T_HP1 = 0;

    let hpScale = nLocalDmgScaleFactor;
    if (hpScale <= 0) hpScale = 1;
    if (DEFAULT_CEPHA_DMG > 0) hpScale *= DEFAULT_CEPHA_DMG;
    if (cfg.dmg > 0) hpScale *= cfg.dmg;
    hpRecSec = T_HP1 * hpScale;
    manaRecSec = T_M2;
    recoveryTimeSec = hpRecSec + manaRecSec;
    recoveryDemandTime = recoveryTimeSec;
    if (hpRecSec < 0) hpRecSec = 0;
    if (manaRecSec < 0) manaRecSec = 0;
    if (recoveryTimeSec < 0) recoveryTimeSec = 0;
  }

  // totals pre-spawn gate
  let moveTimeSec = moveBaseSec;
  let timePerClear = killTimeSec + recoveryTimeSec + moveTimeSec;
  let spawnInterval = 0, timeLoss = 0;
  if (totalLairs > 0 && regenTime > 0) spawnInterval = (regenTime * 60) / totalLairs;
  if (timePerClear > 0 && spawnInterval > timePerClear) {
    const filler = spawnInterval - timePerClear;
    const toMove = clampDbl(0.2 + 0.8 * (1 - pTravel), 0, 1);
    const fillerMove = filler * toMove;
    const fillerStand = filler - fillerMove;
    // standing still also recovers HP/MP
    recoveryCreditSec += fillerStand * recoveryDemandFrac;
    if (recoveryCreditSec > recoveryDemandTime) recoveryCreditSec = recoveryDemandTime;
    recoveryTimeSec = Math.max(0, recoveryDemandTime - recoveryCreditSec);
    moveTimeSec = moveBaseSec + fillerMove;
    timePerClear = spawnInterval;
    timeLoss = filler / spawnInterval;
  }

  let effClearsPerHour = 0, attackFrac = 0, recoverFrac = 0, hitpointFrac = 0, manaFrac = 0, moveFrac = 0, slowdown = 0;
  if (timePerClear > 0) {
    effClearsPerHour = 3600 / timePerClear;
    attackFrac = killTimeSec / timePerClear;
    recoverFrac = recoveryTimeSec / timePerClear;
    hitpointFrac = hpRecSec / timePerClear;
    manaFrac = manaRecSec / timePerClear;
    moveFrac = moveTimeSec / timePerClear;
    if (rtcEff > numMobs) slowdown = Math.max(0, (killTimeSec - SEC_PER_ROUND * numMobs) / timePerClear);
  }
  r.nExpPerHour = vbRound(exp * effClearsPerHour) * cfg.xp;
  r.nHitpointRecovery = hitpointFrac;
  r.nManaRecovery = manaFrac;
  r.nTimeRecovering = recoverFrac;
  r.nOverkill = overshootFrac;
  r.nMove = moveFrac;
  r.nAttackTime = attackFrac;
  r.nSlowdownTime = slowdown;
  r.nRoamTime = timeLoss;
  if (limitMovement) r.nMove *= -1;
  if (surpriseLess) r.nAttackTime *= -1;
  return r;
}

// ---------------------------------------------------------------- Model B

const B_LOGISTIC_CAP = 700, B_LOGISTIC_DENOM = 0.5, B_MIN_LOOP = 22;
const B_TF_LOG_COEF = 0.15, B_TF_SMALL_BUMP = 0.7, B_TF_SCARCITY_COEF = 0.15, B_LAIR_OVERHEAD_R = 1;

// cephB_CalcOverkill
function cephB_CalcOverkill(dmg, mobHP, isSpell) {
  if (mobHP <= 0) return 1;
  const raw = clampDbl((mobHP - dmg) / (B_LOGISTIC_DENOM * mobHP), -B_LOGISTIC_CAP, B_LOGISTIC_CAP);
  const ok = 1 + 1 / (1 + Math.exp(raw * (isSpell ? 1.35 : 1)));
  return clampDbl(ok, 1, isSpell ? 1.06 : 1.18);
}

// cephB_CalcDensity: rooms per lair (falls back to avgWalk)
function cephB_CalcDensity(totalLairs, possSpawns, avgWalk) {
  return totalLairs > 0 && possSpawns > 0 ? safeDiv(possSpawns, totalLairs, avgWalk) : avgWalk;
}

// cephB_CalcTravelLoopSecs
function cephB_CalcTravelLoopSecs(avgWalk, totalLairs, possSpawns, secPerRoom = 1.25) {
  const dens = cephB_CalcDensity(totalLairs, possSpawns, avgWalk);
  let scarcity = dens >= 5
    ? 1 + (B_TF_SCARCITY_COEF - 0.03) * safeDiv(avgWalk, maxDbl(1, dens))
    : 1 + B_TF_SCARCITY_COEF * safeDiv(avgWalk, maxDbl(1, dens));
  let tf = 1 + B_TF_LOG_COEF * Math.log(1 + avgWalk) + B_TF_SMALL_BUMP / (1 + avgWalk);
  if (avgWalk <= 1.6 && dens >= 30) tf *= 0.93;
  let lairOverhead = B_LAIR_OVERHEAD_R * secPerRoom;
  const baseRooms = avgWalk * secPerRoom;
  let overheadScale = 0.6 + 0.4 * minDbl(1, 20 / maxDbl(1, totalLairs));
  overheadScale += 0.06 * smoothStep(30, 45, totalLairs) * smoothStep(2.4, 3.6, avgWalk);
  lairOverhead *= overheadScale;

  // smoothed micro-route shaves
  const wUD = (1 - smoothStep(1.6, 2.2, avgWalk)) * smoothStep(50, 70, dens);
  tf = mulBlend(tf, 0.91, wUD);
  lairOverhead = mulBlend(lairOverhead, 0.91, wUD);
  const wUD2 = (1 - smoothStep(1.4, 1.9, avgWalk)) * smoothStep(70, 90, dens);
  tf = mulBlend(tf, 0.97, wUD2);
  lairOverhead = mulBlend(lairOverhead, 0.96, wUD2);

  // only damp LONG routes
  const aw = maxDbl(0, avgWalk - 5);
  let damp = 1 / (1 + 0.12 * aw ** 1.4);

  if (totalLairs >= 12 && totalLairs <= 16 && avgWalk >= 5) {
    tf *= 0.75; damp *= 0.75; lairOverhead *= 0.8;
    if (avgWalk >= 6) { tf *= 0.97; damp *= 0.92; lairOverhead *= 0.94; }
    if (totalLairs <= 13 && avgWalk >= 6) { tf *= 0.97; lairOverhead *= 0.96; }
  } else {
    const wBig = smoothStep(24, 34, totalLairs);
    const wShort3 = 1 - smoothStep(3.3, 4.2, avgWalk);
    const wLowWalk = wBig * wShort3;
    const wHuge = smoothStep(30, 45, totalLairs) * smoothStep(2.4, 3.6, avgWalk);
    const wLL = wLowWalk * (1 - 0.5 * wHuge);
    tf = mulBlend(tf, 0.94, wLL);
    lairOverhead = mulBlend(lairOverhead, 0.96, wLL);
    // route complexity for big chains with ~3-room walks
    const wCX = bandWeight(totalLairs, 30, 38, 3) * smoothStep(2.6, 3.2, avgWalk) * (1 - smoothStep(3.6, 3.9, avgWalk));
    lairOverhead += 2.5 * wCX;
    tf = mulBlend(tf, 1.1, wCX);
    const ratio = safeDiv(avgWalk, maxDbl(1, dens));
    let scCoef = B_TF_SCARCITY_COEF - 0.02 * wLowWalk;
    if (scCoef > B_TF_SCARCITY_COEF) scCoef = B_TF_SCARCITY_COEF;
    scarcity = 1 + scCoef * ratio;
    const wHugeChain = bandWeight(totalLairs, 60, 80, 6) * smoothStep(2.4, 3.4, avgWalk);
    tf = mulBlend(tf, 0.95, wHugeChain);
    lairOverhead = mulBlend(lairOverhead, 0.92, wHugeChain);
    const wSparseBand = bandWeight(totalLairs, 28, 40, 4) * wShort3 * (1 - smoothStep(5, 7, dens));
    tf = mulBlend(tf, 0.91, wSparseBand);
    lairOverhead = mulBlend(lairOverhead, 0.94, wSparseBand);
    const wBand = wBig * smoothStep(2.4, 2.6, avgWalk) * (1 - smoothStep(3.3, 3.7, avgWalk))
      * smoothStep(1.7, 2, dens) * (1 - smoothStep(4, 4.6, dens));
    tf = mulBlend(tf, 0.93, wBand);
    lairOverhead = mulBlend(lairOverhead, 0.88, wBand);
    scarcity = 1 + lerp(B_TF_SCARCITY_COEF, B_TF_SCARCITY_COEF - 0.12, wBand) * ratio;
  }
  const wVerySparse = (1 - smoothStep(1.6, 2.4, dens)) * smoothStep(36, 44, totalLairs);
  tf = mulBlend(tf, 0.985, wVerySparse);
  scarcity = lerp(scarcity, scarcity * 0.97, wVerySparse);
  return (totalLairs * (baseRooms + lairOverhead)) * tf * scarcity * damp;
}

// The mid-band shape B reuses: lairs 28-40, walk ~2.4-3.3, density ~2-4.
const midBand = (lairs, walk, dens) => bandWeight(lairs, 28, 40, 4)
  * smoothStep(2.4, 2.6, walk) * (1 - smoothStep(3.3, 3.7, walk))
  * smoothStep(1.7, 2, dens) * (1 - smoothStep(4, 4.6, dens));

// ceph_ModelB v9.12: smoothed, band-aware closed form (legacy; overfit)
export function modelB(a, cfg) {
  let { numMobs, totalLairs, rtk, damageThreshold } = a;
  const { exp, regenTime, possSpawns, charDmg, charHP, charHPRegen, mobDmg, mobHP, mobHPRegen, spellCost,
    spellOverhead, charMana, charMPRegen, meditateRate, avgWalk, walkSpeed, surpriseDmg } = a;
  const r = blankInfo();
  if (exp === 0) return r;
  if (numMobs <= 0) numMobs = 1;
  let basicDamage = false;
  if (damageThreshold === -1) { basicDamage = true; damageThreshold = 2000000000; }
  const regenRounds = mobRegenRounds();

  // NPC / boss shortcut
  if (totalLairs <= 0 && regenTime > 0) { r.nExpPerHour = vbRound(exp * (1 / regenTime)); return r; }
  if (totalLairs === 0 && regenTime === 0) return r;
  const instant = totalLairs < 0;
  if (totalLairs <= 0) totalLairs = 1;
  const densGuess = cephB_CalcDensity(totalLairs, possSpawns, avgWalk);

  if (rtk === 0 && mobHP > 0 && charDmg > 0) {
    if (numMobs > 1) { rtk = mobHP / numMobs / charDmg; rtk = -Math.floor(-(rtk * 2)) / 2; rtk *= numMobs; }
    else rtk = vbRound(mobHP / charDmg, 1);
  }
  if (rtk <= 0) rtk = 1;

  let effRTK;
  if (spellCost > 0) effRTK = maxDbl(minDbl(rtk * 0.78, roundUp(rtk)), 0.74);
  else if (rtk < 2) effRTK = maxDbl(rtk * (1 - 0.1 * smoothStep(1.2, 1.6, rtk)), 1);
  else effRTK = roundUp(rtk);

  // effective RTC with the surprise opener (one target per lair)
  const rtcBase = effRTK * numMobs;
  let rtcAdj = rtcBase, backstabLess = false;
  if (surpriseDmg > 0 && numMobs >= 1) {
    const hpPerMob = safeDiv(mobHP, maxDbl(1, numMobs));
    const sRatio = safeDiv(surpriseDmg, maxDbl(1, hpPerMob));
    const roundsPerSurp = safeDiv(surpriseDmg, maxDbl(1, charDmg));
    const regenRatio = safeDiv(mobHPRegen / regenRounds, maxDbl(1, charDmg));
    const regenAtten = 1 - 0.45 * smoothStep(0, 0.6, regenRatio);
    let posSaved = maxDbl(0, roundsPerSurp - 1) * regenAtten;
    const negPenalty = maxDbl(0, 1 - roundsPerSurp) * regenAtten;
    if (negPenalty > 0 && charDmg < mobHP / numMobs) backstabLess = true;
    posSaved = minDbl(effRTK, lerp(posSaved, effRTK, smoothStep(0.85, 1.15, sRatio)));
    const packFade = lerp(1, 1 / Math.sqrt(maxDbl(1, numMobs)), smoothStep(3, 8, numMobs));
    const deltaRounds = clampDbl((posSaved - negPenalty) * packFade, -effRTK, effRTK);
    rtcAdj = effRTK * numMobs - deltaRounds;
    rtcAdj = maxDbl(rtcAdj, effRTK * maxDbl(0, numMobs - 1) + 1);
  }
  r.nRTC = rtcAdj;
  let killSecsPerLair = rtcAdj * SEC_PER_ROUND;

  // over-kill time inflation
  const isSpell = spellCost > 0;
  let overkillFactor = cephB_CalcOverkill(charDmg, mobHP, isSpell);
  let okCap = lerp(isSpell ? 1.06 : 1.18, isSpell ? 1.02 : 1.06, 1 - smoothStep(1.05, 1.2, effRTK));
  const okCapMid = lerp(1.12, 1.1, smoothStep(1.2, 1.6, effRTK));
  const groupEase = 1 - 0.06 * smoothStep(3, 5, numMobs);
  if (spellCost === 0) okCap = minDbl(okCap, okCapMid) * groupEase;
  overkillFactor = minDbl(overkillFactor, okCap);
  killSecsPerLair *= overkillFactor;
  if (spellCost === 0) killSecsPerLair *= lerp(1, 0.955, 1 - smoothStep(1, 1.4, rtk));
  const wChain = smoothStep(32, 44, totalLairs) * (1 - smoothStep(2.5, 3.1, avgWalk));
  killSecsPerLair = mulBlend(killSecsPerLair, 0.97, wChain);
  const noMedCasterOrUpkeep = (spellCost > 0 || spellOverhead > 0) && meditateRate === 0 ? 1 : 0;
  const wMB = midBand(totalLairs, avgWalk, densGuess) * noMedCasterOrUpkeep;
  killSecsPerLair = mulBlend(killSecsPerLair, 0.99, wMB);
  const micro = (1 - smoothStep(1, 1.1, effRTK)) * (1 - smoothStep(1.2, 1.6, numMobs));
  // MB4: micro kill trim (no-med casters, mid-band only)
  killSecsPerLair *= lerp(0.78, 1, 1 - micro * wMB * noMedCasterOrUpkeep);
  r.nOverkill = overkillFactor - 1;

  let walkLoopSecs = cephB_CalcTravelLoopSecs(avgWalk, totalLairs, possSpawns, walkSpeed);
  const walkRegenSecs = walkLoopSecs;
  // MB1: micro-route taper (no-med casters, mid-band only)
  const wMicroMB1 = micro * midBand(totalLairs, avgWalk, densGuess);
  if (spellCost > 0 && meditateRate === 0 && wMicroMB1 > 0) walkLoopSecs *= lerp(0.78, 1, 1 - wMicroMB1);
  const wCX = bandWeight(totalLairs, 30, 38, 3) * smoothStep(2.6, 3.2, avgWalk) * (1 - smoothStep(3.6, 3.9, avgWalk));
  walkLoopSecs *= lerp(0.96, 1, wCX);
  walkLoopSecs *= DEFAULT_CEPHB_Move * cfg.move;
  if (densGuess >= 60 && avgWalk >= 1.8 && avgWalk <= 2.6) walkLoopSecs *= lerp(1, 1.12, smoothStep(60, 90, densGuess));

  const regenWindow = regenTime * 60;
  const loopSecsRaw = killSecsPerLair * totalLairs + walkLoopSecs;
  const regenEnvelope = loopSecsRaw;

  let restSecs = 0, medSecs = 0, restSecsDisp = 0, medSecsDisp = 0, hPerMob = 0;
  let manaCostLoop = 0, manaGain = 0, medNeeded = 0, poolCredit = 0;

  if (!basicDamage) {
    // HP / rest
    const lairRoundsEff = maxDbl(1, r.nRTC);
    const dmgPerRoundCore = safeDiv(mobDmg, lairRoundsEff);
    let hpLossPerRound = maxDbl(0, dmgPerRoundCore - damageThreshold);
    hpLossPerRound *= DEFAULT_CEPHB_DMG * cfg.dmg;
    const h = hpLossPerRound;
    hPerMob = safeDiv(h, maxDbl(1, numMobs));
    const rtcForDamage = lerp(rtcBase, r.nRTC, 0.35);   // 35% of opener savings reduces damage-in
    let hpLossPerLoop = hpLossPerRound * rtcForDamage * totalLairs;
    const hpLift = lerp(1, 3.2, smoothStep(2, 4.5, numMobs) * (1 - smoothStep(4, 12, hPerMob)));
    hpLossPerLoop *= hpLift;
    const wLongWalk = smoothStep(8, 12, avgWalk);
    const lightHitTrim = 1 - 0.25 * (1 - smoothStep(8, 14, hPerMob));
    const passiveHP = (charHPRegen * 0.02 * lightHitTrim) * safeDiv(regenEnvelope, SEC_PER_REGEN_TICK);
    const hGateBuf = smoothStep(24, 36, hPerMob);
    const wTinyLong = bandWeight(totalLairs, 5, 9, 1) * smoothStep(8, 12, avgWalk);
    const hpBuffer = charHP * (0.01 + 0.006 * hGateBuf + 0.006 * wLongWalk + 0.004 * wTinyLong);
    const deficit = hpLossPerLoop - passiveHP - hpBuffer;
    const dmgPerRound = maxDbl(0, dmgPerRoundCore - damageThreshold);
    let minBoost = 1.05 + 0.1 * smoothStep(1, 4, h) + 0.1 * smoothStep(10, 15, h) + 0.1 * smoothStep(25, 35, h);
    const wHeavy = bandWeight(totalLairs, 8, 16, 4) * smoothStep(5, 7, avgWalk) * smoothStep(10, 16, h);
    minBoost = lerp(minBoost, maxDbl(minBoost, 1.3), wHeavy);
    let tickBoost;
    if (charHPRegen === 0) tickBoost = 1;
    else {
      tickBoost = clampDbl(safeDiv(dmgPerRound, maxDbl(1, charHPRegen)), 1, 3);
      if (tickBoost < minBoost) tickBoost = minBoost;
    }
    const hGate = smoothStep(12, 24, hPerMob), hGateLair = smoothStep(18, 28, h);
    let restRateBoost = 1 + 0.62 * (tickBoost - 1) * maxDbl(hGate, hGateLair);
    if (hPerMob >= 30) restRateBoost *= 1.004;
    restRateBoost += 0.22 * (tickBoost - 1) * smoothStep(32, 60, h) * (1 - smoothStep(12, 24, hPerMob));
    if (spellCost === 0) restRateBoost *= 1 + 0.008 * smoothStep(28, 36, hPerMob) * (1 - smoothStep(2.2, 3, avgWalk));
    restRateBoost = clampDbl(restRateBoost, 1, 1.85);
    let restTickHP = 0;
    if (deficit > 0) {
      let k = 0.28;
      if (spellCost > 0) k += 0.06 * maxDbl(smoothStep(20, 36, totalLairs), 1 - smoothStep(1.6, 2.2, avgWalk));
      else k += 0.03 * (smoothStep(18, 32, hPerMob) * (1 - smoothStep(2.2, 3.3, avgWalk)));
      restTickHP = charHPRegen * k * maxDbl(0, tickBoost - 1);
    }
    const restNeeded = maxDbl(0, hpLossPerLoop - (passiveHP + restTickHP) - hpBuffer);
    if (charHPRegen > 0 && restRateBoost > 0) restSecs = restNeeded * SEC_PER_REST_TICK / (charHPRegen * restRateBoost);
    restSecsDisp = restSecs;

    // mana / meditate
    if (spellCost > 0 || spellOverhead > 0) {
      const totalRounds = r.nRTC * totalLairs;
      // MB5: micro cost bump (no-med casters, mid-band only)
      const kCost = lerp(1.1, 1, 1 - micro * midBand(totalLairs, avgWalk, densGuess) * noMedCasterOrUpkeep);
      const killSecsAll = killSecsPerLair * totalLairs;
      let inCombatMPFrac;
      if (meditateRate > 0) {
        inCombatMPFrac = 0.26;
        if (totalLairs >= 28 && avgWalk <= 3.5) inCombatMPFrac += 0.02;
        inCombatMPFrac = clampDbl(inCombatMPFrac, 0.1, 0.4);
      } else {
        inCombatMPFrac = 0.31 - 0.035 * avgWalk;
        inCombatMPFrac = inCombatMPFrac
          + 0.04 * (1 - smoothStep(2, 2.6, avgWalk))
          + 0.015 * (1 - smoothStep(1.6, 1.9, avgWalk))
          + 0.01 * smoothStep(30, 50, densGuess)
          + 0.01 * smoothStep(70, 90, densGuess) * (1 - smoothStep(1.4, 1.8, avgWalk))
          + 0.01 * (spellCost > 0 ? 1 : 0)
          + 0.01 * (spellCost > 0 && meditateRate === 0 ? 1 : 0)
            * smoothStep(2.4, 2.6, avgWalk) * (1 - smoothStep(3.5, 3.9, avgWalk))
            * smoothStep(1.7, 2, densGuess) * (1 - smoothStep(4, 4.6, densGuess));
        let mpFracHi = 0.34;
        if (spellCost > 0 && meditateRate === 0) {
          mpFracHi = 0.36;
          if (densGuess >= 60 && avgWalk <= 1.6) mpFracHi = 0.38;
        }
        if (densGuess >= 80 && avgWalk <= 1.4) {
          inCombatMPFrac += 0.005;
          if (spellCost > 0 && meditateRate === 0) mpFracHi = maxDbl(mpFracHi, 0.385);
        }
        const wMBn = midBand(totalLairs, avgWalk, densGuess);
        inCombatMPFrac += 0.005 * wMBn;
        if (wMBn > 0) mpFracHi = maxDbl(mpFracHi, 0.37);
        inCombatMPFrac = clampDbl(inCombatMPFrac, 0.1, mpFracHi);
        if (meditateRate === 0) {
          const wNoMedBand = bandWeight(totalLairs, 28, 40, 4) * smoothStep(2.4, 3.2, avgWalk) * (1 - smoothStep(3.4, 3.9, avgWalk));
          inCombatMPFrac = maxDbl(0.1, inCombatMPFrac - 0.035 * wNoMedBand);
          // MB2: micro in-combat MP damp
          const wMicroMB2 = micro * wNoMedBand;
          if (wMicroMB2 > 0) inCombatMPFrac *= lerp(0.88, 1, 1 - wMicroMB2);
        }
      }
      const mpUseFrac = spellCost > 0 ? 1 : inCombatMPFrac;
      manaCostLoop = spellCost * totalRounds + spellOverhead * totalRounds * mpUseFrac;
      manaCostLoop *= kCost;
      manaCostLoop *= DEFAULT_CEPHB_Mana * cfg.mana;
      let combatRegenFrac;
      if (spellCost > 0) {
        combatRegenFrac = 0.5 + 0.35 * smoothStep(3, 28, r.nRTC);
        if (combatRegenFrac < inCombatMPFrac) combatRegenFrac = inCombatMPFrac;
        if (combatRegenFrac > 1) combatRegenFrac = 1;
      } else combatRegenFrac = inCombatMPFrac;
      const combatRegenSecs = combatRegenFrac * killSecsAll;
      const walkForMana = walkLoopSecs + 0.5 * maxDbl(0, walkRegenSecs - walkLoopSecs);
      const manaRegenSecs = walkForMana + restSecs + combatRegenSecs;
      manaGain = charMPRegen * safeDiv(manaRegenSecs, SEC_PER_REGEN_TICK);
      poolCredit = charMana * 0.1;
      if (spellCost > 0 && meditateRate === 0) {
        if (densGuess >= 60 && avgWalk <= 1.6) poolCredit = charMana * 0.16;
        else if (avgWalk >= 2.5 && avgWalk <= 3.5 && densGuess >= 2 && densGuess <= 4) {
          poolCredit = charMana * lerp(0.06, 0.1, midBand(totalLairs, avgWalk, densGuess));
          // MB3: micro pool-credit damp
          const wMicroMB3 = micro * midBand(totalLairs, avgWalk, densGuess);
          if (wMicroMB3 > 0) poolCredit *= lerp(0.85, 1, 1 - wMicroMB3);
        }
      }
      medNeeded = maxDbl(0, manaCostLoop - manaGain - poolCredit);
      if (meditateRate > 0 && medNeeded >= meditateRate / 2) medSecs = (medNeeded / meditateRate) * SEC_PER_MEDI_TICK;
      else if (meditateRate === 0 && charMPRegen > 0) medSecs = (medNeeded / charMPRegen) * SEC_PER_REGEN_TICK;
      else medSecs = 0;
      medSecsDisp = medSecs;
      // re-label HP rest -> mana when not meditating and rest masks an MP deficit
      if (medSecs === 0 && meditateRate === 0) {
        let capPct = 0;
        if (avgWalk >= 8 && densGuess >= 12) capPct = 0.55;
        else if (hpLossPerRound <= 8) capPct = 0.35;
        if (capPct > 0 && restSecsDisp > 0) {
          const gainNoRest = charMPRegen * safeDiv(walkLoopSecs + inCombatMPFrac * killSecsAll, SEC_PER_REGEN_TICK);
          const neededNoRest = maxDbl(0, manaCostLoop - gainNoRest - poolCredit);
          if (neededNoRest > 0) {
            const relabel = minDbl((neededNoRest / maxDbl(1, charMPRegen)) * SEC_PER_REGEN_TICK, restSecsDisp * capPct);
            medSecsDisp += relabel;
            restSecsDisp -= relabel;
          }
        }
      }
    }
  }

  // cephB_ApplySlackWindow: push slack into walking and credit passive MP over it
  const applySlack = extra => {
    if (extra <= 0) return;
    walkLoopSecs += extra;
    if ((spellCost > 0 || spellOverhead > 0) && charMPRegen > 0) {
      manaGain += charMPRegen * safeDiv(extra, SEC_PER_REGEN_TICK);
      medNeeded = maxDbl(0, manaCostLoop - manaGain - poolCredit);
      if (meditateRate > 0 && medNeeded >= meditateRate / 2) medSecs = (medNeeded / meditateRate) * SEC_PER_MEDI_TICK;
      else if (meditateRate === 0 && charMPRegen > 0) medSecs = (medNeeded / charMPRegen) * SEC_PER_REGEN_TICK;
      else medSecs = 0;
      medSecsDisp = medSecs;
    }
  };

  // final loop time (instant-respawn micro-floor, then the respawn gate)
  const finalRaw = loopSecsRaw + restSecs + medSecs;
  let loopSecs = finalRaw;
  if (instant && finalRaw < B_MIN_LOOP) { applySlack(B_MIN_LOOP - finalRaw); loopSecs = B_MIN_LOOP; }
  if (regenTime > 0 && totalLairs > 0) {
    const spawnInterval = safeDiv(regenTime * 60, totalLairs);
    if (loopSecs < spawnInterval) { const gate = spawnInterval - loopSecs; loopSecs = spawnInterval; applySlack(gate); }
  }

  const cyclesPerHour = safeDiv(3600, loopSecs);
  // HP/MP overlap during meditation (display only)
  if (meditateRate > 0 && medSecsDisp > 0 && restSecsDisp > 0) {
    const overlap = minDbl(restSecsDisp, medSecsDisp * 0.6 * (1 - smoothStep(8, 16, hPerMob)));
    if (overlap > 0) { medSecsDisp += overlap; restSecsDisp -= overlap; }
    restSecsDisp = maxDbl(0, restSecsDisp);
    medSecsDisp = maxDbl(0, medSecsDisp);
  }

  r.nExpPerHour = exp * totalLairs * cyclesPerHour * DEFAULT_CEPHB_XP * cfg.xp;
  r.nHitpointRecovery = safeDiv(restSecsDisp, loopSecs);
  r.nManaRecovery = safeDiv(medSecsDisp, loopSecs);
  r.nTimeRecovering = r.nHitpointRecovery + r.nManaRecovery;
  r.nMove = minDbl(1, safeDiv(walkLoopSecs, loopSecs));
  r.nOverkill = maxDbl(0, overkillFactor - 1);
  r.nAttackTime = safeDiv(killSecsPerLair * totalLairs, loopSecs);
  r.nSlowdownTime = rtk > 0 ? maxDbl(0, safeDiv(effRTK, rtk) - 1) : 0;
  r.nRoamTime = regenWindow > 0 && loopSecs < regenWindow ? clampDbl((regenWindow - loopSecs) / regenWindow, 0, 1) : 0;
  if (backstabLess) r.nAttackTime *= -1;
  return r;
}

// ---------------------------------------------------------------- CalcExpPerHour

// The VB parameter types: Long / Integer arguments are rounded on the way in.
function coerceArgs(x = {}) {
  const n = v => Number(v) || 0;
  return {
    exp: cur(n(x.exp)), regenTime: n(x.regenTime), numMobs: n(x.numMobs),
    totalLairs: x.totalLairs === undefined ? -1 : cint(n(x.totalLairs)), possSpawns: cint(n(x.possSpawns)),
    rtk: n(x.rtk), charDmg: n(x.charDmg), charHP: cint(n(x.charHP)), charHPRegen: cint(n(x.charHPRegen)),
    mobDmg: n(x.mobDmg), mobHP: cint(n(x.mobHP)), mobHPRegen: cint(n(x.mobHPRegen)),
    damageThreshold: cint(n(x.damageThreshold)), spellCost: cint(n(x.spellCost)), spellOverhead: n(x.spellOverhead),
    charMana: cint(n(x.charMana)), charMPRegen: cint(n(x.charMPRegen)), meditateRate: cint(n(x.meditateRate)),
    avgWalk: n(x.avgWalk), walkSpeed: x.walkSpeed === undefined ? 1.25 : n(x.walkSpeed),
    surpriseDmg: n(x.surpriseDmg), surpriseMinDmg: n(x.surpriseMinDmg), surpriseChance: cint(n(x.surpriseChance)),
    firstRoundDmg: n(x.firstRoundDmg), minRoundDmg: n(x.minRoundDmg),
  };
}

const MODELS = ['A', 'B', 'C', 'D'];

// modExpPerHour.CalcExpPerHour
export function calcExpPerHour(args, config = EXPHR_DEFAULTS) {
  const cfg = normaliseExpHrConfig(config);
  const a = coerceArgs(args);
  const ret = blankInfo();
  let showAll = cfg.showAll;
  if (a.exp === 0) return ret;
  if (!isMobKillable(a.charDmg, a.charHP, a.mobDmg, a.mobHP - a.surpriseDmg, a.charHPRegen, a.mobHPRegen)) {
    ret.nExpPerHour = -1;
    ret.nHitpointRecovery = 1;
    ret.nTimeRecovering = 1;
    return ret;
  }
  if (cfg.recoveryOnly) a.damageThreshold = -1;

  const fns = { A: modelA, B: modelB, C: modelC, D: modelD };
  const res = {};
  let movementLimited = false, surpriseLess = false;
  for (const m of MODELS) {
    if (!cfg.models[m]) continue;
    const t = fns[m](a, cfg);
    if (t.nMove < 0) { movementLimited = true; t.nMove *= -1; }
    if (t.nAttackTime < 0) { surpriseLess = true; t.nAttackTime *= -1; }
    res[m] = t;
  }
  ret.models = res;

  let count = 0, sAttack = '', sRecover = '', sRecoverHP = '', sRecoverMana = '', sMove = '';
  for (const m of MODELS) {
    const t = res[m];
    if (!t) continue;
    count++;
    ret.nExpPerHour += t.nExpPerHour;
    ret.nHitpointRecovery += t.nHitpointRecovery;
    ret.nManaRecovery += t.nManaRecovery;
    ret.nTimeRecovering += t.nTimeRecovering;
    ret.nOverkill += t.nOverkill;
    ret.nMove += t.nMove;
    ret.nRTC += t.nRTC;
    ret.nRoamTime += t.nRoamTime;
    ret.nSlowdownTime += t.nSlowdownTime;
    ret.nAttackTime += t.nAttackTime;
    ret.nRTC += t.nRTC;   // (sic) MME adds RTC twice, then divides twice below
    if (showAll) {
      ret.sExpAll = autoAppend(ret.sExpAll, m + ':' + formatExpPerHour(t.nExpPerHour), '/');
      sAttack = autoAppend(sAttack, vbRound(t.nAttackTime * 100) + '%', '/');
      sRecover = autoAppend(sRecover, vbRound(t.nTimeRecovering * 100) + '%', '/');
      sRecoverHP = autoAppend(sRecoverHP, vbRound(t.nHitpointRecovery * 100) + '%', '/');
      sRecoverMana = autoAppend(sRecoverMana, vbRound(t.nManaRecovery * 100) + '%', '/');
      sMove = autoAppend(sMove, vbRound(t.nMove * 100) + '%', '/');
    }
  }
  if (count > 1) {
    ret.nExpPerHour = vbRound(ret.nExpPerHour / count);
    for (const k of ['nHitpointRecovery', 'nManaRecovery', 'nTimeRecovering', 'nOverkill', 'nMove', 'nRTC',
      'nRoamTime', 'nSlowdownTime', 'nAttackTime']) ret[k] = vbRound(ret[k] / count, 2);
    ret.nRTC = vbRound(ret.nRTC / count, 2);
    if (showAll) {
      const wrap = s => (s.length ? ' (' + s + ')' : '');
      ret.sExpAll = wrap(ret.sExpAll);
      sAttack = wrap(sAttack); sRecover = wrap(sRecover); sRecoverHP = wrap(sRecoverHP);
      sRecoverMana = wrap(sRecoverMana); sMove = wrap(sMove);
    }
  } else {
    showAll = false;
    ret.sExpAll = ''; sAttack = ''; sRecover = ''; sRecoverHP = ''; sRecoverMana = ''; sMove = '';
  }

  const R = v => vbRound(v * 100);
  if (ret.nAttackTime > 0 && ret.nAttackTime < 1) ret.sRTCText = R(ret.nAttackTime) + '% time spent attacking' + sAttack;
  if (ret.nSlowdownTime > 0.01 && ret.nSlowdownTime < 1) ret.sRTCText = autoAppend(ret.sRTCText, R(ret.nSlowdownTime) + '% slower kill speed');
  if (ret.nOverkill > 0.01 && a.charDmg < 9999999) ret.sRTCText = autoAppend(ret.sRTCText, R(ret.nOverkill) + '% wasted overkill');
  if (ret.nTimeRecovering > 0.01) ret.sTimeRecovering = R(ret.nTimeRecovering) + '% time spent recovering' + sRecover;
  if (ret.nHitpointRecovery > 0.01) ret.sHitpointRecovery = R(ret.nHitpointRecovery) + '% reduction due to HP recovery' + sRecoverHP;
  if (ret.nManaRecovery > 0.01) ret.sManaRecovery = R(ret.nManaRecovery) + '% reduction due to mana recovery' + sRecoverMana;
  if (ret.nMove > 0.01) ret.sMoveText = R(ret.nMove) + '% time spent moving' + sMove;
  if (ret.nRoamTime > 0.04) ret.sMoveText = autoAppend(ret.sMoveText, R(ret.nRoamTime) + '% time lost due to insufficient lairs');
  if (movementLimited) ret.sMoveText = autoAppend(ret.sMoveText, '(cluster detected: movement limited)', ' ');
  if (surpriseLess) ret.sRTCText = autoAppend(ret.sRTCText, '[backstab is worse than attack]', ' ');
  return ret;
}

// ---------------------------------------------------------------- calibration

// RunAllSimulations' SIM_TABLE: real in-game observations.
//   Desc | ObsExp | ObsRest | ObsMana | ObsMove | 20 CalcExpPerHour args | SurpriseDMG
// (MME assigns lines(18) twice; the GreaterMUD row overwrites the slime-beast one.)
export const SIM_TABLE = [
  '135 Cleric/manscorpions/physical/50 heal | 7174000 | 0 | 0 | 17% | 54125 | 3 | 3 | 48 | 85 | 1.5 | 619 | 1952 | 158 | 51 | 1800 | 0 | 50 | 0 | 0 | 0 | 0 | 0 | 1.8 | 1.44 | 0',
  '81 Priest/stone elementals/srip+MEDITATE/no heal | 909000 | 0 | 16% | 55% | 3171 | 3 | 1 | 35 | 100 | 1 | 564 | 891 | 67 | 4 | 238 | 0 | 0 | 30 | 1 | 623 | 63 | 42 | 2.9 | 1.44 | 0',
  '81 Priest/stone elementals/srip/no heal | 890000 | 0 | 39% | 36% | 3171 | 3 | 1 | 35 | 100 | 1 | 564 | 891 | 67 | 4 | 238 | 0 | 0 | 30 | 1 | 623 | 63 | 0 | 2.9 | 1.44 | 0',
  '81 Priest/gnolls+LIMIT_MOVE/fury/no heal | 325000 | 0 | 29% | 11% | 2071 | 2 | 3 | 13 | 1223 | 1 | 255 | 891 | 67 | 1 | 339 | 0 | 0 | 16 | 1 | 623 | 63 | 0 | 1.3 | 1.44 | 0',
  '81 Priest/white dragons/fury/no heal | 1181000 | 50% | 0 | 7% | 19650 | 3 | 3 | 20 | 26 | 1.5 | 232 | 891 | 67 | 40 | 876 | 0 | 0 | 16 | 1 | 623 | 63 | 0 | 1.3 | 1.44 | 0',
  '12 Gypsy/orc shaman/lbol/no heal | 20000 | 32% | 43% | 5% | 857 | 5 | 2 | 14 | 239 | 2.5 | 34 | 182 | 11 | 14 | 166 | 0 | 0 | 5 | 0 | 54 | 6 | 0 | 12.5 | 1.44 | 0',
  '20 Druid/kobolds/acid+MEDITATE/no heal | 52000 | 1% | 52% | 10% | 690 | 3 | 3 | 33 | 83 | 1 | 59 | 198 | 15 | 2 | 120 | 0 | 0 | 8 | 0 | 131 | 11 | 9 | 2.4 | 1.44 | 0',
  '20 Druid/kobolds/acid/no heal | 34000 | 0 | 75% | 5% | 690 | 3 | 3 | 33 | 83 | 1 | 59 | 198 | 15 | 2 | 120 | 0 | 0 | 8 | 0 | 131 | 11 | 0 | 2.4 | 1.44 | 0',
  '20 Druid/kobolds/physical/10 heal | 75000 | 0 | 0 | 13% | 690 | 3 | 3 | 33 | 83 | 1.5 | 41 | 198 | 15 | 2 | 120 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 2.4 | 1.44 | 0',
  '20 Druid/slime beast/physical/10 heal | 82000 | 4% | 0 | 7% | 500 | 0 | 0 | -1 | 0 | 0 | 56 | 198 | 15 | 8 | 170 | 25 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 1.44 | 0',
  '46 Paladin/orc captains/bash/15 heal | 847000 | 2% | 0 | 16% | 8875 | 3 | 4 | 13 | 85 | 1.5 | 249 | 585 | 37 | 5 | 877 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 6.2 | 1.44 | 0',
  '46 Paladin/orc captains/physical/15 heal | 633000 | 1% | 0 | 9% | 8875 | 3 | 4 | 13 | 85 | 2 | 145 | 585 | 37 | 7 | 877 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 6.2 | 1.44 | 0',
  '46 Paladin/orc captains/physical/no heal | 409000 | 37% | 0 | 4% | 8875 | 3 | 4 | 13 | 85 | 2 | 145 | 585 | 37 | 7 | 877 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6.2 | 1.44 | 0',
  '75 Warrior/white dragons/bash/no heal | 1942000 | 29% | 0 | 34% | 20236 | 3 | 3 | 7 | 53 | 1 | 566 | 1175 | 81 | 24 | 928 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10.4 | 1.44 | 0',
  '75 Warrior/white dragons/physical/no heal | 1818000 | 31% | 0 | 31% | 20236 | 3 | 3 | 7 | 53 | 1.1 | 522 | 1175 | 81 | 24 | 928 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10.4 | 1.44 | 0',
  '75 Warrior/stone elementals/physical/no heal | 987000 | 0 | 0 | 62% | 3171 | 3 | 1 | 35 | 100 | 1 | 448 | 1175 | 81 | 1 | 238 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2.9 | 1.44 | 0',
  '75 Warrior/stone giants/physical/no heal | 2231000 | 67% | 0 | 3% | 49500 | 5 | 3 | 25 | 50 | 1.5 | 447 | 1175 | 81 | 104 | 1620 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1.44 | 0',
  '30 missionary/black asps/physical/5 heal/GREATERMUD | 322000 | 0 | 0 | 33% | 1170 | 3 | 1.2 | 20 | 1256 | 2 | 153 | 268 | 26 | 9 | 180 | 0 | 5 | 0 | 0.38 | 140 | 10 | 0 | 2 | 1.31 | 145',
];

// ParseNum: "31%", "31/100", "0.31" or "31"
function parseNum(s) {
  const t = String(s).trim();
  if (!t) return 0;
  if (t.endsWith('%')) return (parseFloat(t) || 0) / 100;
  const p = t.indexOf('/');
  if (p >= 0) { const d = parseFloat(t.slice(p + 1)) || 0; return d ? (parseFloat(t) || 0) / d : 0; }
  return parseFloat(t) || 0;
}
const SIM_ARGS = ['exp', 'regenTime', 'numMobs', 'totalLairs', 'possSpawns', 'rtk', 'charDmg', 'charHP', 'charHPRegen',
  'mobDmg', 'mobHP', 'mobHPRegen', 'damageThreshold', 'spellCost', 'spellOverhead', 'charMana', 'charMPRegen',
  'meditateRate', 'avgWalk', 'walkSpeed'];
// LoadSimRows
export function loadSimRows(lines = SIM_TABLE) {
  const rows = [];
  for (const line of lines) {
    const v = line.split('|').map(s => s.trim());
    if (v.length < 25) continue;
    const args = {};
    SIM_ARGS.forEach((k, i) => { args[k] = parseNum(v[5 + i]); });
    args.surpriseDmg = v.length > 25 ? parseNum(v[25]) : 0;
    if (v.length > 29) {
      args.surpriseMinDmg = parseNum(v[26]); args.surpriseChance = parseNum(v[27]);
      args.firstRoundDmg = parseNum(v[28]); args.minRoundDmg = parseNum(v[29]);
    } else {
      args.surpriseMinDmg = args.surpriseDmg; args.surpriseChance = 100;
      args.firstRoundDmg = args.charDmg; args.minRoundDmg = args.charDmg;
    }
    rows.push({ desc: v[0], obs: { exp: parseNum(v[1]), rest: parseNum(v[2]), mana: parseNum(v[3]), move: parseNum(v[4]) }, args });
  }
  return rows;
}

// RunAllSimulations: per-row results plus the signed "Avg Diff" (bias) MME
// prints and the mean absolute exp error the docs compare models by.
export function runAllSimulations(config = EXPHR_DEFAULTS) {
  const rows = loadSimRows().map(row => ({ ...row, result: calcExpPerHour(row.args, config) }));
  let exp = 0, absExp = 0;
  const sum = { rest: [0, 0], mana: [0, 0], move: [0, 0] };
  for (const { obs, result: r } of rows) {
    const d = r.nExpPerHour > 0 ? 1 - obs.exp / r.nExpPerHour : 1;
    exp += d; absExp += Math.abs(d);
    for (const [k, f] of [['rest', 'nHitpointRecovery'], ['mana', 'nManaRecovery'], ['move', 'nMove']]) {
      if (r[f] !== 0 || obs[k] !== 0) { sum[k][0] += r[f] - obs[k]; sum[k][1]++; }
    }
  }
  const n = rows.length;
  return {
    rows, avgExpDiff: exp / n, maeExp: absExp / n,
    avgRestDiff: sum.rest[0] / (sum.rest[1] || 1), avgManaDiff: sum.mana[0] / (sum.mana[1] || 1),
    avgMoveDiff: sum.move[0] / (sum.move[1] || 1),
  };
}

// ---------------------------------------------------------------- callers

// What FilterMonsters / AddMonster2LV / PullMonsterDetail feed CalcExpPerHour.
// Party mode (txtMonsterLairFilter > 1) is not ported: one character only.

// char.attack (MME's nGlobalAttack* globals) -> combat.js AttackConfig
export const attackConfig = (at = {}, equipped = []) => attackFromChar(at, equipped);

// modMain.RefreshCombatHealingValues -> { value, cost } (nGlobalAttackHealValue / HealCost).
// heal types: 0 infinite, 1 base (none), 2/3 spell, 4 manual.
export function healingValues(at = {}, profile = null, useChar = false) {
  let value = 0, cost = 0;
  switch (at.healType || 0) {
    case 0: value = 999999; break;
    case 1: value = 0; break;
    case 2: case 3: {
      if (!(at.healSpellNum > 0)) break;
      let rounds = at.healRounds || 0;
      if (rounds < 1) rounds = 1;
      if (rounds > 50) rounds = 50;
      const level = useChar ? (profile?.level || 0) : getMaxLevel();
      const heal = calculateSpellCast(profile, at.healSpellNum, useChar ? level : 0);
      const dur = getSpellDuration(at.healSpellNum, level);
      if (dur > 1) {
        value = heal.nAvgCast;
        if (rounds < dur) rounds = dur;
        else value = value - value * (1 - dur / rounds);
      } else value = vbRound(heal.nAvgCast / rounds, 2);
      cost = vbRound(heal.nManaCost / rounds, 2);
      break;
    }
    case 4: value = at.healManual || 0; break;
  }
  if (cost < 0.1) cost = 0;
  if (cost > 9999) cost = 9999;
  if (value < 0) value = 0;
  if (value > 999999) value = 999999;
  return { value, cost };
}

// modMain.PopulateCharacterProfile: the exp/hr fields of tCharacterProfile.
//   useChar   the global filter is on (else MME's stand-in: 10000 HP, no mana)
//   profile   profileFromChar (the combat CharProfile)
//   panel     calcCharStats(c); summary: calcCharSummary(c, panel)
export function expHrCharacter(c, { useChar = false, profile = null, panel = null, summary = null } = {}) {
  const at = c.attack || {};
  const heal = healingValues(at, profile, useChar);
  const ch = { useChar, hp: 0, hpRegen: 0, meditateRate: 0, maxMana: 0, manaRegen: 0, damageThreshold: 0,
    spellOverhead: 0, spellAttackCost: 0, walkSpeed: 1.25, heal };
  const spellAttack = (at.type === ATTACK.spell || at.type === ATTACK.spellAny) && at.spellNum > 0;
  if (useChar) {
    const pct = panel ? panel.encumPct : 0;
    ch.walkSpeed = pct > 0 ? vbRound(calcMovementSpeed(pct, panel.stats[31]) / 1000, 2) : 1.25;
    ch.hp = summary?.hp ? summary.hp.avg : 0;
    ch.hpRegen = summary ? summary.restResting : 0;
    if (at.useMeditate) ch.meditateRate = summary?.mediTicks || 0;
    ch.maxMana = summary?.maxMana ? summary.maxMana.total : 0;
    ch.manaRegen = summary?.manaRegen || 0;
    ch.damageThreshold = heal.value;
    ch.spellOverhead = heal.cost + (panel?.bless ? panel.bless.manaPerTick : 0) / 6;
    if (spellAttack) ch.spellAttackCost = by.spell.get(at.spellNum)?.ManaCost || 0;
  } else {
    ch.hp = 10000;
    ch.hpRegen = cint(ch.hp * 0.05);
    if (engine.nmrVersion < 1.83) ch.damageThreshold = 0;   // txtMonsterDamage
    else {
      ch.damageThreshold = heal.value;
      if (spellAttack) ch.spellAttackCost = by.spell.get(at.spellNum)?.ManaCost || 0;
    }
  }
  ch.damageThreshold = clampDbl(ch.damageThreshold, 0, 9999999);
  if (ch.hp < 1) ch.hp = 1;
  if (ch.hpRegen < 1) ch.hpRegen = 1;
  ch.maxMana = clampDbl(ch.maxMana, 0, 9999999);
  ch.manaRegen = clampDbl(ch.manaRegen, 0, 9999999);
  ch.spellOverhead = clampDbl(ch.spellOverhead, 0, 9999999);
  return ch;
}

// The CharProfile to fight with: the character's with the global filter on,
// else MME's "any character" (level 0 -> 255 / combat 3 / 255 STR etc. in
// combat.js) still holding the equipped weapons, as GetDamageOutput does.
export function expHrProfile(charProfile, useChar, spellOverhead = 0) {
  if (useChar) return { ...charProfile, spellOverhead };
  return { ...blankProfile(), isLoaded: false, level: 0, accuracy: 999, hitMagic: 9999, hitMagicNonWeapon: 9999,
    plusBSaccy: 999, stealth: 255, classStealth: true, raceStealth: true, hp: 10000, hpRegen: 500,
    maSkill: [0, 1, 1, 1], weapons: charProfile ? charProfile.weapons.slice() : [0, 0] };
}

const LAIR_FLAG_RATIO = 0.9;
const clean = v => (v > -9990 ? v : 0);

// modMMudDatabase.GetLairInfo's damage block: the character's damage against
// a lair's averages, and its RTK (CalcCombatRounds). Returns what
// details.lairInfoFor reads from hooks.lairDamageOut / ctx.lairDamageOut.
export function lairDamageOutput(info, profile, attack) {
  const vs = {
    ac: info.nAvgAC, dr: info.nAvgDR, mr: info.nAvgMR, dodge: info.nAvgDodge, bsDefense: info.nAvgBSDefense,
    magicLevel: info.nMagicLVL, spellImmuLevel: info.nSpellImmuLVL,
    rcol: info.nAvgRCOL, rfir: info.nAvgRFIR, rsto: info.nAvgRSTO, rlit: info.nAvgRLIT, rwat: info.nAvgRWAT,
    antiMagic: info.nNumAntiMagic > 0 && info.nNumAntiMagic >= info.nMobs / 2,
    undead: info.nNumUndeads > 0 && info.nNumUndeads >= info.nMobs * LAIR_FLAG_RATIO,
    living: info.nNumLiving > 0 && info.nNumLiving >= info.nMobs * LAIR_FLAG_RATIO,
    animal: info.nNumAnimals > 0 && info.nNumAnimals >= info.nMobs * LAIR_FLAG_RATIO,
  };
  const d = damageVsMonster(profile, attack, null, { vs });
  // damage / mitigate: the shape details.lairInfoFor reads from a lair hook
  const out = { damage: d, mitigate: false, damageOut: 0, firstRoundDamageOut: 0, minRoundDamageOut: 0, surpriseDamageOut: 0,
    surpriseMinDamageOut: 0, surpriseChance: 0, rtk: 0, rtkDamageOut: 0, spell: d.spell, attack: d.attack };
  let dmgOut = d.averageDamage, first = d.firstRoundDamage, sur = d.surpriseDamage;
  if (dmgOut > -9999 || sur > -9999) {
    if (dmgOut > -9990) { out.damageOut = dmgOut; out.firstRoundDamageOut = d.firstRoundDamage; out.minRoundDamageOut = d.minRoundDamage; }
    if (sur > -9990) { out.surpriseDamageOut = sur; out.surpriseChance = d.surpriseDamageChance; out.surpriseMinDamageOut = d.surpriseMinDamage; }
  } else dmgOut = 9999999;   // nothing to attack with: count it as a one-shot
  dmgOut = clean(dmgOut); first = clean(first); sur = clean(sur);
  out.rtkDamageOut = dmgOut;
  if (dmgOut + sur > 0) {
    out.rtk = calcCombatRounds({ damageOut: dmgOut, mobHealth: info.nAvgHP, mobDamage: info.nAvgDmg, numMobs: 1,
      surpriseDamageOut: sur, firstRoundDamageOut: first }).nRTK;
  }
  return out;
}

// Exp/hr for one monster, as the list (AddMonster2LV / FilterMonsters) or the
// detail (PullMonsterDetail) works it out.
//   env: { ch (expHrCharacter), profile (expHrProfile), attack (attackConfig),
//          config, list (true: FilterMonsters' stand-in HP), lair (summonedBy -> lairAverages with
//          lairDamageOutput), monsterDamage (mon -> damage per round vs the character; default AvgDmg) }
// -> { kind: 'lair' | 'mob' | 'none', info (tExpPerHourInfo), args, lair, damage, spell }
export function monsterExpPerHour(mon, env) {
  const nmr = engine.nmrVersion;
  const exp = monsterExp(mon);
  const sb = mon['Summoned By'] || '';
  const lair = nmr >= 1.83 && /lair/i.test(sb) && env.lair ? env.lair(sb) : { nTotalLairs: 0 };
  const mobDmg = env.monsterDamage ? env.monsterDamage(mon) : mon.AvgDmg;
  const ch = { ...env.ch };
  const res = { kind: 'none', info: null, args: null, lair, damage: null, spell: null, exp };
  if (exp === 0) return res;
  const charArgs = () => ({
    charHP: ch.hp, charHPRegen: ch.hpRegen, damageThreshold: ch.damageThreshold, spellCost: ch.spellAttackCost,
    spellOverhead: ch.spellOverhead, charMana: ch.maxMana, charMPRegen: ch.manaRegen, meditateRate: ch.meditateRate,
    walkSpeed: ch.walkSpeed,
  });
  if (mon.RegenTime === 0 && lair.nTotalLairs > 0) {
    if (env.list && !ch.useChar) { ch.hp = cint(lair.nAvgDmgLair * 2); ch.hpRegen = cint(ch.hp * 0.05); }
    res.kind = 'lair';
    res.args = {
      exp: lair.nAvgExp, regenTime: lair.nAvgDelay, numMobs: lair.nMaxRegen, totalLairs: lair.nTotalLairs,
      possSpawns: lair.nPossSpawns, rtk: lair.nRTK, charDmg: lair.nDamageOut, mobDmg: lair.nAvgDmgLair, mobHP: lair.nAvgHP,
      avgWalk: lair.nAvgWalk, surpriseDmg: lair.nSurpriseDamageOut, surpriseMinDmg: lair.nSurpriseMinDamageOut,
      surpriseChance: lair.nSurpriseChance, firstRoundDmg: lair.nFirstRoundDamageOut, minRoundDmg: lair.nMinRoundDamageOut,
      ...charArgs(),
    };
  } else if (mon.RegenTime > 0 || /Room/i.test(sb)) {
    if (env.list && !ch.useChar) { ch.hp = cint(mobDmg * 2); ch.hpRegen = cint(ch.hp * 0.05); }
    const d = damageVsMonster(env.profile, env.attack, mon);
    res.damage = d;
    res.spell = d.spell;
    res.kind = 'mob';
    res.args = {
      exp, regenTime: mon.RegenTime, numMobs: 1, totalLairs: -1, possSpawns: 0, rtk: 0,
      charDmg: clean(d.averageDamage), mobDmg, mobHP: mon.HP, mobHPRegen: mon.HPRegen, avgWalk: 0,
      surpriseDmg: clean(d.surpriseDamage), surpriseMinDmg: d.surpriseDamage > -9990 ? d.surpriseMinDamage : 0,
      surpriseChance: d.surpriseDamage > -9990 ? d.surpriseDamageChance : 0,
      firstRoundDmg: d.averageDamage > -9990 ? clean(d.firstRoundDamage) : 0,
      minRoundDmg: d.averageDamage > -9990 ? d.minRoundDamage : 0,
      ...charArgs(),
    };
    // PullMonsterDetail walks at 1 s/room for a single mob; the list uses the character's speed
    if (!env.list) res.args.walkSpeed = 1;
  } else return res;
  if (!env.list) {
    // PullMonsterDetail bills tSpellcast.nManaCost (cost x casts) from its last
    // damage pass: against the lair averages when the mob has lairs
    const sp = lair.nTotalLairs > 0 ? lairDamageOutput(lair, env.profile, env.attack).spell : res.damage?.spell;
    res.spell = sp || null;
    res.args.spellCost = sp ? sp.nManaCost : 0;
  }
  res.info = calcExpPerHour(res.args, env.config);
  return res;
}

// The list's exp/hr cell text (AddMonster2LV, by lair).
export function expPerHourCell(n) {
  let s;
  if (n > 1000000) s = fmtGroup(vbRound(n / 1000000, 1), 1) + ' M';
  else if (n > 1000) s = fmtGroup(vbRound(n / 1000, 1), 1) + ' K';
  else s = n > 0 ? fmtGroup(roundUp(n), 0) : '0';
  return s + '/hr';
}

// PullMonsterDetail's "Scripting" block -> detail rows { label, text, cls }.
export function scriptingRows(mon, r, { useChar = false, showAll = false } = {}) {
  const rows = [];
  const add = (label, text = '', cls = '') => rows.push({ label, text, cls });
  if (engine.nmrVersion < 1.83 || r.exp <= 1 || mon.HP < 1) return rows;
  const lairs = r.lair && r.lair.nTotalLairs > 0;
  add(lairs && (mon.RegenTime > 0 || /Room/i.test(mon['Summoned By'] || '')) ? 'Scripting vs MOB'
    : lairs ? 'Scripting vs Lair' : 'Scripting', useChar ? '' : '(global filter inactive. default stats used.)', 'bh');
  const t = r.info || blankInfo();
  let text;
  if (r.kind === 'none') { text = '0'; t.sRTCText = '(No lairs and not assigned as an NPC)'; }
  else if (t.nExpPerHour > 0) text = formatExpPerHour(t.nExpPerHour, true) + '/hr' + (showAll ? t.sExpAll : '');
  else if (t.nExpPerHour === -1) text = (r.kind === 'lair' ? 'The lairs of this mob' : 'This mob') + ' deemed undefeatable against current stats.';
  else text = '0';
  add('Scripting Estimate', text);
  if (t.sRTCText) add('', t.sRTCText);
  if (t.sMoveText) add('', t.sMoveText);
  if ((t.nTimeRecovering > 0 || (showAll && (t.sHitpointRecovery.length > 6 || t.sManaRecovery.length > 6))) && t.nExpPerHour >= 0) {
    let pre = '';
    if (t.sManaRecovery && t.sHitpointRecovery) { add('', t.sTimeRecovering); pre = ' > '; }
    if (t.sHitpointRecovery) add('', pre + t.sHitpointRecovery);
    const oom = r.spell && r.spell.nOOM > 0 ? ` (OOM every ${r.spell.nOOM} rounds)` : '';
    if (t.sManaRecovery) add('', pre + t.sManaRecovery + oom);
  }
  return rows;
}

