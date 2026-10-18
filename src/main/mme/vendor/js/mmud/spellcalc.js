// Spell numbers: min/max/duration at a cast level, damage after magic
// resistance, the per-round cast summary, and the spell text MME parses for a
// weapon's cast-on-hit damage. Ported from modMMudDatabase.bas
// (GetCurrentSpellMinMax, PullSpellEQ, GetSpell{Min,Max}Damage, GetSpellDuration,
// SpellHasAbility), modMMudFunc.bas (CalculateSpellCast, CalculateResistDamage,
// GetSpellCastChance, ResistPct_*) and modMain.bas (CalcRoundsToOOM).
//
// Spells are passed as rows of db.Spells or as spell numbers.

import { by, spellName, monsterName, className } from '../db.js';
import { engine } from './engine.js';
import { abilityName } from './enums.js';
import { fix, vbRound, cint, cur, idiv } from './vb.js';

export const ROUND_SECS = 5;
export const SPELL_ROUND_SECS = 3;
export const STOCK_SPELL_HIT_CAP = 98;
export const GMUD_SPELL_HIT_CAP = 100;

const spellRow = s => (typeof s === 'object' ? s : by.spell.get(s));

// modMMudDatabase.GetMaxLevel. MME raises it above 255 when the average level
// at which every race/class maxes its stats is higher (ComputeAvgLevelMaxStats);
// that refinement lives with the character builder, so 255 here.
export const getMaxLevel = () => 255;

// modMMudFunc.GetSpellHitCap
export const getSpellHitCap = () => (engine.greater ? GMUD_SPELL_HIT_CAP : STOCK_SPELL_HIT_CAP);

const autoAppend = (s, add, glue = ', ') => (s.length ? (String(add).trim().length ? s + glue + add : s) : String(add));

// modMMudDatabase.GetCurrentSpellMinMax. Returns numbers and the strings MME
// shows (formulas like "5+(0.5*lvl)" when no level applies). `out.useLevel` and
// `out.noHeader` carry back the ByRef flags.
export function getCurrentSpellMinMax(spell, useLevel = false, level = 0,
  { overrideMin = 0, overrideMax = 0, spellBonus = 0 } = {}) {
  const sp = spellRow(spell);
  const out = { nMin: 0, nMax: 0, nDur: 0, sMin: '', sMax: '', sDur: '', useLevel, noHeader: false };
  if (!sp) return out;
  const bonus = spellBonus < 1 ? 1 : 1 + spellBonus / 100;
  const override = overrideMin !== 0 || overrideMax !== 0;
  let nMin = override ? overrideMin : sp.MinBase;
  let nMax = override ? overrideMax : sp.MaxBase;
  const minInc = sp.MinInc, minLvls = sp.MinIncLVLs, maxInc = sp.MaxInc, maxLvls = sp.MaxIncLVLs;
  let nDur = sp.Dur;
  const durInc = sp.DurInc, durLvls = sp.DurIncLVLs;
  let sMin, sMax, sDur;

  if (level === 0 && !override && (minLvls > 0 || maxLvls > 0 || durLvls > 0)) level = getMaxLevel();
  if (useLevel && (minInc === 0 || minLvls === 0) && (maxInc === 0 || maxLvls === 0) &&
    (durInc === 0 || durLvls === 0)) useLevel = false;

  if (sp.Cap === 0 && sp.ReqLevel === 0 && !useLevel && level === 0) {
    if (bonus > 1) { nMin = fix(cur(nMin * bonus)); nMax = fix(cur(nMax * bonus)); }
    sDur = String(nDur); sMax = String(nMax); sMin = String(nMin);
  } else {
    if (override || minLvls === 0 || minInc === 0) {
      if (bonus > 1) nMin = fix(cur(nMin * bonus));
      sMin = String(nMin);
    } else {
      if (!useLevel) {
        out.noHeader = true;
        sMin = `${nMin}+(${vbRound(minInc / minLvls, 2)}*lvl)`;
        if (bonus > 1) sMin += `+${spellBonus}%`;
      }
      if (useLevel || level > 0) {
        nMin = nMin + fix((minInc / minLvls) * level);
        if (bonus > 1) nMin = fix(cur(nMin * bonus));
        if (useLevel) sMin = String(nMin);
      }
    }
    if (override || maxLvls === 0 || maxInc === 0) {
      if (bonus > 1) nMax = fix(cur(nMax * bonus));
      sMax = String(nMax);
    } else {
      if (!useLevel) {
        out.noHeader = true;
        sMax = `${nMax}+(${vbRound(maxInc / maxLvls, 2)}*lvl)`;
        if (bonus > 1) sMax += `+${spellBonus}%`;
      }
      if (useLevel || level > 0) {
        nMax = nMax + fix((maxInc / maxLvls) * level);
        if (bonus > 1) nMax = fix(cur(nMax * bonus));
        if (useLevel) sMax = String(nMax);
      }
    }
    if (durLvls === 0 || durInc === 0) {
      sDur = String(nDur);
    } else {
      if (!useLevel) sDur = `${nDur}+(${vbRound(durInc / durLvls, 2)}*lvl)`;
      if (useLevel || level > 0) {
        nDur = fix(nDur + fix((durInc / durLvls) * level));
        if (useLevel) sDur = String(nDur);
      }
    }
  }
  return Object.assign(out, { nMin, nMax, nDur, sMin, sMax, sDur, useLevel });
}

// modMMudDatabase.SpellHasAbility: the first slot's value, or -1.
export function spellHasAbility(spell, abil) {
  const sp = spellRow(spell);
  if (!sp || abil <= 0) return -1;
  for (let x = 0; x <= 9; x++) if (sp['Abil-' + x] === abil) return sp['AbilVal-' + x];
  return -1;
}

// modMMudDatabase.GetSpellMinDamage / GetSpellMaxDamage (which = 'Min' | 'Max').
function spellDamage(which, spell, castLevel = 0, energyRem = 0, forMonster = false, healsInstead = false) {
  const sp = spellRow(spell);
  if (!sp) return 0;
  let dmg = 0, does = false, endCast = 0;
  for (let x = 0; x <= 9; x++) {
    const a = sp['Abil-' + x];
    if (a === 1 || a === 8 || a === 17 || a === 18) {
      if (a === 18 || (a === 8 && healsInstead)) { if (!healsInstead) continue; }
      else if (healsInstead) continue;
      does = true;
      if (sp['AbilVal-' + x] !== 0) dmg = sp['AbilVal-' + x];
    } else if (a === 151) endCast = sp['AbilVal-' + x];
  }
  if (dmg === 0) {
    if (!does) return 0;
    if (!forMonster || castLevel === 0) {
      if (castLevel > sp.Cap && sp.Cap > 0) castLevel = sp.Cap;
      if (castLevel < sp.ReqLevel) castLevel = sp.ReqLevel;
    }
    const base = sp[which + 'Base'], lvls = sp[which + 'IncLVLs'];
    dmg = lvls === 0 || castLevel < 1 ? base : base + fix((sp[which + 'Inc'] / lvls) * castLevel);
  }
  if (forMonster) return dmg;
  if (energyRem === 0) energyRem = 1000;
  energyRem -= sp.EnergyCost;
  if (energyRem < 1) energyRem = 1;
  if (energyRem >= 143 && sp.EnergyCost >= 143) {
    if (endCast === 0) {
      if (sp.EnergyCost <= 500) dmg += dmg * fix(energyRem / sp.EnergyCost);
    } else dmg += spellDamage(which, endCast, castLevel, energyRem, forMonster);
  }
  return dmg;
}
export const getSpellMinDamage = (spell, castLevel, energyRem, forMonster, healsInstead) =>
  spellDamage('Min', spell, castLevel, energyRem, forMonster, healsInstead);
export const getSpellMaxDamage = (spell, castLevel, energyRem, forMonster, healsInstead) =>
  spellDamage('Max', spell, castLevel, energyRem, forMonster, healsInstead);

// modMMudDatabase.GetSpellDuration
export function getSpellDuration(spell, castLevel = 0, forMonster = false) {
  const sp = spellRow(spell);
  if (!sp) return 0;
  if (!forMonster || castLevel === 0) {
    if (castLevel > sp.Cap && sp.Cap > 0) castLevel = sp.Cap;
    if (castLevel < sp.ReqLevel) castLevel = sp.ReqLevel;
  }
  if (sp.DurIncLVLs === 0 || castLevel < 1) return sp.Dur;
  return sp.Dur + fix((sp.DurInc / sp.DurIncLVLs) * castLevel);
}

// modMMudFunc.GetSpellCastChance
export function getSpellCastChance(difficulty, spellcasting, kai = false) {
  if (!difficulty && !spellcasting) return 0;
  if (spellcasting > 0 && difficulty < 200) {
    let c = spellcasting + difficulty;
    if (c < 0) c = 0;
    if (kai) { if (c > 100) c = 100; }
    else if (c > getSpellHitCap()) c = getSpellHitCap();
    return c;
  }
  return 100;
}

// modMMudFunc.CalculateResistDamage. resistType: 0 never, 1 anti-magic only,
// 2 everyone. `resistable` is true for Damage(-MR) (ability 17); bonusResist is
// the matching elemental resist (rfir, rcol...).
export function calculateResistDamage(damage, vsMR, { resistType = 2, resistable = true,
  includeTotalResist = false, vsAntiMagic = false, bonusResist = 0 } = {}) {
  if (vsMR <= 0) vsMR = 1;
  if (bonusResist > 0) damage = fix(cur(((100 - bonusResist) * damage) / 100));
  let dr = 0;
  if (resistable) {
    if (vsAntiMagic) { dr = fix(vsMR / 2); if (dr > 75) dr = 75; }
    else if (vsMR > 51) { dr = fix((vsMR - 50) / 2); if (dr > 50) dr = 50; }
    if (dr > 0) damage = cur(damage * (1 - dr / 100));
    else if (!vsAntiMagic && vsMR < 50) damage = cur(damage + (damage * (50 - vsMR)) / 100);   // +damage for MR < 50
  }
  if (includeTotalResist && vsMR > 1 && (resistType === 2 || (vsAntiMagic && resistType === 1))) {
    let total = fix(vsMR / 2);
    if (total > 98) total = 98;
    damage = cur(damage * (1 - total / 100));
  }
  return vbRound(damage);
}

// modMMudFunc.ResistPct_SignedOfBase: signed % of base. B=75, F=-30 => -40.
export function resistPctSignedOfBase(baseDmg, finalNet) {
  if (baseDmg <= 0) return 0;
  if (finalNet >= 0) {
    if (Math.abs(baseDmg - finalNet) <= 1) return 0;
    return cint(vbRound(((baseDmg - finalNet) / baseDmg) * 100));
  }
  return -cint(vbRound((-finalNet / baseDmg) * 100));
}

// modMMudFunc.NegResistPct_ShareOfTotal: B=75, F=-30 => -29.
export function negResistPctShareOfTotal(baseDmg, finalNet) {
  if (baseDmg <= 0 || finalNet >= 0) return 0;
  const heal = -finalNet;
  return -cint(vbRound((heal / (baseDmg + heal)) * 100));
}

// modMain.CalcRoundsToOOM: combat rounds until a caster can't afford the
// spell; 0 = never runs out.
export function calcRoundsToOOM(manaCost, maxMana, regenRate, castChance = 0, duration = 1) {
  if (manaCost > maxMana) return 0;
  const RoundSecs = ROUND_SECS, regenSecs = 30, SpellRoundSecs = SPELL_ROUND_SECS;
  const roundsPerRegen = idiv(regenSecs, RoundSecs);
  let returnOnFail = 0, failAcc = 0, durationRounds = 0;
  if (duration < 1) duration = 1;
  if (castChance <= 0) castChance = 100;
  if (castChance < 100 && manaCost > 0) returnOnFail = fix(manaCost / 2);
  if (duration > 1) {
    const auraSecs = duration * SpellRoundSecs;
    const regenTicks = idiv(auraSecs, regenSecs);
    const regenBetween = cint(regenTicks * regenRate);
    if (regenBetween >= manaCost + (manaCost / 2) * (1 - castChance / 100)) return 0;
    durationRounds = idiv(auraSecs + RoundSecs - 1, RoundSecs);
    if (durationRounds < 1) durationRounds = 1;
  } else if (regenRate >= manaCost * roundsPerRegen) return 0;

  let mana = maxMana, rounds = 0, roundsDur = 0;
  while (mana >= manaCost && rounds < 999) {
    rounds++;
    if (duration > 1) roundsDur++;
    let cast = false;
    if (duration === 1) cast = true;
    else if (rounds === 1 || roundsDur === 1) cast = true;
    else if (roundsDur % durationRounds === 0) cast = true;
    if (cast) mana -= manaCost;
    if (castChance < 100 && cast) {
      failAcc += 100 - castChance;
      if (failAcc >= 100 - (100 - castChance) / 2) {
        mana += returnOnFail;
        failAcc -= 100;
        if (duration > 1) roundsDur = 0;
      }
    }
    if (rounds % roundsPerRegen === 0) {
      mana += regenRate;
      if (mana > maxMana) {
        mana = maxMana;
        if (rounds > 200) return 0;          // full for a long time: assume it never runs out
      }
    }
  }
  return rounds === 999 ? 0 : rounds;
}

// ------------------------------------------------------------- spell text

// GetSpellName(n, bHideRecordNumbers) as it appears inside spell text.
const sname = n => spellName(n);

// modMMudFunc.GetAbilityStats, for the abilities that appear in spell text.
function abilityStats(n, v = 0, calcLevel = true, nest = 0) {
  let s = abilityName(n);
  if (!s) return '';
  if (v === 0) return s;
  const hdr = v < 0 ? ' ' : ' +';
  switch (n) {
    case 7: return s + hdr + v / 10;
    case 42: case 122: case 160: return `${s} (${sname(v)})`;
    case 43: case 153: case 151:
      return `${s} [${sname(v)}, ${pullSpellEQ(calcLevel, 0, v, { nested: true }, nest + 1)}]`;
    case 73: case 124: return `${s} (${abilityName(v)})`;
    case 59: return `${s} ${className(v)}`;
    case 146: case 12: return `${s} ${monsterName(v)}`;
    case 1: case 8: case 17: case 18: case 19: case 140: case 141: case 148: return `${s} ${v}`;
    case 178: return s;
    default: return s + hdr + v;
  }
}

const FLAG_ABILS = new Set([23, 51, 52, 80, 97, 98, 100, 108, 109, 110, 111, 112, 113, 119, 138, 144, 178]);
const NO_HEADER_ABILS = new Set([1, 8, 17, 18, 19, 140, 141, 148]);

// modMMudDatabase.PullSpellEQ: the one-line description of what a spell does,
// e.g. "Damage 5 to 15 for 3 rounds". Ported for the parts the damage maths
// read (damage/drain ranges, end-casts, durations, casts per round); list-view
// side effects (teleport/textblock/summon rows) are left to the detail pane.
export function pullSpellEQ(calcLevel, level = 0, spell, opts = {}, nest = 0) {
  const { nested = false, noShowLevel = false, overrideMin = 0, overrideMax = 0, spellBonus = 0, forMonster = false } = opts;
  if (nest > 19) return ' ... to infinity and beyond?';
  const sp = spellRow(spell);
  if (!sp) return '?';
  let useLevel = calcLevel;
  if (useLevel) {
    if (!forMonster) {
      if (level > sp.Cap && sp.Cap > 0) level = sp.Cap;
      if (level < sp.ReqLevel) level = sp.ReqLevel;
    }
    if (level < 1) level = sp.ReqLevel;
    if (level === 0) useLevel = false;
  }
  let t = getCurrentSpellMinMax(sp, useLevel, level, { overrideMin, overrideMax });
  useLevel = t.useLevel;
  const noHeader = t.noHeader;
  const { nMin, nMax, nDur, sMin, sMax, sDur } = t;
  let sMinB = sMin, sMaxB = sMax;
  if (spellBonus > 0) {
    t = getCurrentSpellMinMax(sp, useLevel, level, { overrideMin, overrideMax, spellBonus });
    sMinB = t.sMin; sMaxB = t.sMax;
  }
  let detail = '', removes = '', endOne = '', endTwo = '', endPct = '', nonMagical = false;
  for (let x = 0; x <= 9; x++) {
    const a = sp['Abil-' + x];
    if (!a) continue;
    if (a === 144) nonMagical = true;
    const getsBonus = a === 1 || a === 17 || ((a === 8 || a === 18) && engine.greater);
    const v = sp['AbilVal-' + x];
    let minH = '', maxH = '';
    if (a === 122) { removes = removes ? removes + ', ' + sname(v) : sname(v); continue; }
    if (a === 137) continue;                          // shock message
    if (v === 0) {
      if (a === 140 || a === 148) {
        detail = autoAppend(detail, abilityStats(a) + ' ' + (sMin === sMax ? sMin : sMin + ' to ' + sMax));
      } else if (a === 164) {
        endPct = v + '% ';
      } else if (a === 151) {
        if (nMin >= nMax) endOne = autoAppend(endOne, `${endPct}EndCast [${sname(nMin)}, ${pullSpellEQ(calcLevel, level, nMin, {}, nest + 1)}]`);
        else {
          let s = `${endPct}EndCast [{${sname(nMin)}, ${pullSpellEQ(calcLevel, level, nMin, {}, nest + 1)}}`;
          for (let y = nMin + 1; y <= nMax; y++) s += ` OR {${sname(y)}, ${pullSpellEQ(calcLevel, level, y, {}, nest + 1)}}`;
          endOne = autoAppend(endOne, s + ']');
        }
      } else if (a === 12) {
        if (nMin >= nMax) detail = autoAppend(detail, 'Summon ' + monsterName(nMin));
        else {
          let s = 'Summons{' + monsterName(nMin);
          for (let y = nMin + 1; y <= nMax; y++) s += ' OR ' + monsterName(y);
          detail = autoAppend(detail, s + '}');
        }
      } else if (FLAG_ABILS.has(a)) {
        endTwo = autoAppend(endTwo, abilityStats(a));
      } else if (a === 7) {
        if (!noHeader) { if (parseFloat(sMin) > 0) minH = '+'; if (parseFloat(sMax) > 0) maxH = '+'; }
        detail = autoAppend(detail, abilityStats(a) + ' ' + (useLevel
          ? (nMin === nMax ? minH + nMin / 10 : `${minH}${nMin / 10} to ${maxH}${nMax / 10}`)
          : (sMin === sMax ? minH + sMin : `${minH}${sMin} to ${maxH}${sMax}`)));
      } else {
        if (!noHeader && !NO_HEADER_ABILS.has(a)) { if (parseFloat(sMin) > 0) minH = '+'; if (parseFloat(sMax) > 0) maxH = '+'; }
        const [lo, hi] = spellBonus > 0 && getsBonus ? [sMinB, sMaxB] : [sMin, sMax];
        detail = autoAppend(detail, abilityStats(a, 0, calcLevel, nest) + ' ' + (lo === hi ? minH + lo : `${minH}${lo} to ${maxH}${hi}`));
      }
    } else {
      if (a === 164) endPct = v + '% ';
      else if (a === 151) endOne = autoAppend(endOne, endPct + abilityStats(a, v, calcLevel, nest));
      else if (FLAG_ABILS.has(a)) endTwo = autoAppend(endTwo, abilityStats(a, v, calcLevel, nest));
      else if (a === 12) detail = autoAppend(detail, 'Summon ' + monsterName(v));
      else detail = autoAppend(detail, abilityStats(a, v, calcLevel, nest));
    }
    if (detail.endsWith(', ')) detail = detail.slice(0, -2);
  }
  if (nonMagical) detail = detail.replace(/Damage\(-MR\)/gi, 'Damage');
  if (!detail && !removes && !endOne && !endTwo) return '(No EQ)';
  let out = detail;
  if (endOne) out = autoAppend(out, endOne);
  if (!nested && sp.EnergyCost > 0 && sp.EnergyCost <= 500) out += ` x${fix(1000 / sp.EnergyCost)} times/round`;
  if (endTwo) out = autoAppend(out, endTwo);
  if (!noShowLevel && level > 0 && (useLevel || ((sp.Cap === 0 || sp.Cap > sp.ReqLevel) &&
    ((sp.MinInc !== 0 && sp.MinIncLVLs > 0) || (sp.MaxInc !== 0 && sp.MaxIncLVLs > 0) || (sp.DurInc !== 0 && sp.DurIncLVLs > 0))))) {
    if (sp.Cap > 0 || sp.ReqLevel > 0) out = `(@lvl ${level}): ` + out;
  }
  if (sDur !== '0') { if (out) out += ' '; out += `for ${sDur} rounds`; }
  if (removes) { if (out) out += ' -- '; out += `RemovesSpells(${removes})`; }
  void nDur;
  return out;
}

// ------------------------------------------------------------- spell attack

// modMMudFunc.CalculateSpellCast: one spell cast at a level against a target's
// MR/anti-magic/elemental resists. `profile` needs spellcasting, spellDmgBonus,
// maxMana, manaRegen, spellOverhead (see combat.js).
export function calculateSpellCast(profile, spell, castLevel = 0, { vsMR = 0, vsAntiMagic = false,
  vsRcol = 0, vsRfir = 0, vsRsto = 0, vsRlit = 0, vsRwat = 0 } = {}) {
  const sp = spellRow(spell);
  const r = { nMinCast: 0, nMaxCast: 0, nAvgCast: 0, nNumCasts: 0, nCastChance: 0, nAvgRoundDmg: 0,
    nMinRoundDMG: 0, nAvgRoundHeals: 0, nDuration: 0, nDamageResisted: 0, nFullResistChance: 0,
    nManaCost: 0, nOOM: 0, bDoesHeal: false, bDoesDamage: false, sAvgRound: '', sLVLincreases: '',
    sMMA: '', sSpellName: '', nCastLevel: 0, nSpellAttackType: 0, nRequiredLevel: 0 };
  if (!sp) return r;
  const p = profile || {};
  r.sSpellName = sp.Name;
  r.nSpellAttackType = sp.AttType;
  const elemental = { 0: vsRcol, 1: vsRfir, 2: vsRsto, 3: vsRlit, 5: vsRwat }[sp.AttType] || 0;

  let lvlSpecified = false;
  if (castLevel <= 0) { if (castLevel < sp.Cap) castLevel = sp.Cap; }
  else lvlSpecified = true;
  if (castLevel < sp.ReqLevel) castLevel = sp.ReqLevel;
  if (castLevel > sp.Cap && sp.Cap > 0) castLevel = sp.Cap;
  r.nCastLevel = castLevel;
  r.nRequiredLevel = sp.ReqLevel;
  const hasIncs = (sp.MinInc !== 0 && sp.MinIncLVLs > 0) || (sp.MaxInc !== 0 && sp.MaxIncLVLs > 0) ||
    (sp.DurInc !== 0 && sp.DurIncLVLs > 0);
  const showAtLevel = (sp.Cap === 0 || sp.Cap > sp.ReqLevel) && hasIncs;

  const mm = getCurrentSpellMinMax(sp, castLevel > 0, castLevel);
  let duration = mm.nDur;
  if (duration < 1) duration = 1;
  let minCast = mm.nMin, maxCast = mm.nMax;
  let avgCast = vbRound((minCast + maxCast) / 2);
  let mult, avgMod, minMod;
  if ((p.spellDmgBonus || 0) > 0) {
    mult = 1 + vbRound(p.spellDmgBonus / 100, 2);
    avgMod = fix(avgCast * mult);
    minMod = fix(minCast * mult);
  } else { mult = 1; avgMod = avgCast; minMod = minCast; }

  const castChance = (p.spellcasting || 0) > 0 && sp.Diff < 200
    ? getSpellCastChance(sp.Diff, p.spellcasting, sp.Magery === 5) : 100;

  let nonMagic = false;
  for (let x = 0; x <= 9; x++) if (sp['Abil-' + x] === 144) nonMagic = true;

  let damage = 0, minDamage = 0, heals = 0, resisted = 0, valueModified = false, dmgMinusMR = false;
  const resistOpts = { resistType: sp.TypeOfResists, resistable: true, includeTotalResist: false, vsAntiMagic };
  for (let x = 0; x <= 9; x++) {
    const a = sp['Abil-' + x], v = sp['AbilVal-' + x];
    if (a === 1) {
      r.bDoesDamage = true;
      if (v === 0) { damage += avgMod; minDamage += minMod; if (mult > 1) valueModified = true; }
      else { damage += v; minDamage += v; }
      if (elemental !== 0) {
        const t2 = vbRound(damage * (elemental / 100));
        damage = vbRound(damage - t2);
        resisted += t2;
      }
    } else if (a === 8) {
      r.bDoesDamage = true; r.bDoesHeal = true;
      if (v === 0) {
        damage += avgMod; minDamage += minMod; heals += avgMod;
        if (mult > 1 && engine.greater) valueModified = true;
      } else { damage = v; minDamage = v; heals = v; }
    } else if (a === 17) {
      r.bDoesDamage = true;
      let tmp, tmpMin;
      if (v === 0) { dmgMinusMR = true; tmp = avgMod; tmpMin = minMod; if (mult > 1) valueModified = true; }
      else { tmp = v; tmpMin = tmp; }
      if (vsMR > 0 && !nonMagic) {
        let t2 = calculateResistDamage(tmp, vsMR, resistOpts);
        resisted += tmp - t2;
        damage += t2;
        if (v === 0) t2 = calculateResistDamage(tmpMin, vsMR, resistOpts);
        minDamage += t2;
      } else { damage += tmp; minDamage += tmpMin; }
      if (elemental !== 0) {
        let t2 = vbRound(damage * (elemental / 100));
        damage = vbRound(damage - t2);
        resisted += t2;
        t2 = vbRound(minDamage * (elemental / 100));
        minDamage = vbRound(minDamage - t2);
      }
    } else if (a === 18) {
      r.bDoesHeal = true;
      if (v === 0) { heals += avgMod; if (mult > 1 && engine.greater) valueModified = true; }
      else heals = v;
    } else if (a === 150 || a === 174 || a === 175) {
      if (engine.greater && v === 0) valueModified = true;     // TODO GreaterMUD: mana heal/steal values
    } else if (a === 176) {
      if (engine.greater) {                                    // TODO GreaterMUD: verify StealMPToHP
        r.bDoesHeal = true;
        if (v === 0) { heals += avgMod; if (mult > 1) valueModified = true; } else heals = v;
      }
    }
  }
  void resisted;
  if (valueModified) { minCast = fix(minCast * mult); maxCast = fix(maxCast * mult); }
  const avgBeforeResist = vbRound((minCast + maxCast) / 2);
  let fullResist = 0;
  if (vsMR > 0) {
    if (dmgMinusMR && !nonMagic) {
      minCast = calculateResistDamage(minCast, vsMR, resistOpts);
      maxCast = calculateResistDamage(maxCast, vsMR, resistOpts);
    }
    if (sp.TypeOfResists === 2 || (sp.TypeOfResists === 1 && vsAntiMagic)) {
      fullResist = fix(vsMR / 2);
      if (fullResist > 98) fullResist = 98;
    }
  }
  if (elemental !== 0) {
    minCast = vbRound(minCast - minCast * (elemental / 100));
    maxCast = vbRound(maxCast - maxCast * (elemental / 100));
  }
  avgCast = vbRound((minCast + maxCast) / 2);
  const casts = sp.EnergyCost > 0 && sp.EnergyCost <= 500 ? fix(1000 / sp.EnergyCost) : 1;

  r.nMinCast = minCast;
  r.nMaxCast = maxCast;
  r.nAvgCast = valueModified ? avgMod : avgCast;
  r.nNumCasts = casts;
  r.nManaCost = sp.ManaCost * casts;
  r.nCastChance = castChance;
  const k = (castChance / 100) * (1 - fullResist / 100);
  r.nAvgRoundDmg = vbRound(damage * casts * k);
  r.nMinRoundDMG = vbRound(minDamage * casts * k);
  r.nAvgRoundHeals = vbRound(heals * casts * k);
  r.nDuration = duration;
  r.nFullResistChance = fullResist;
  if (r.nManaCost > 0 && r.nManaCost <= (p.maxMana || 0)) {
    r.nOOM = calcRoundsToOOM(r.nManaCost + (p.spellOverhead || 0), p.maxMana, p.manaRegen || 0, castChance, duration);
  }
  r.nDamageResisted = resistPctSignedOfBase(avgBeforeResist, damage);

  // text
  let castLvlText = '';
  if (r.bDoesDamage || r.bDoesHeal) {
    if ((!lvlSpecified || showAtLevel) && castLevel > 0) castLvlText = `(@lvl ${castLevel}) `;
    let s = '';
    const perRound = duration > 1 ? avgCast : null;
    if (r.bDoesDamage && r.bDoesHeal) s = `${castLvlText}${perRound ?? r.nAvgRoundDmg} damage + ${r.nAvgRoundHeals} heals`;
    else if (r.bDoesDamage) s = `${castLvlText}${perRound ?? r.nAvgRoundDmg} damage`;
    else s = `${castLvlText}${perRound ?? r.nAvgRoundHeals} healing`;
    s += duration > 1 ? `/${SPELL_ROUND_SECS}sec` : '/round';
    if (duration > 1) {
      s += ` for ${duration * SPELL_ROUND_SECS} secs/${fix((duration * SPELL_ROUND_SECS) / ROUND_SECS)} rounds (${(r.nAvgRoundDmg + r.nAvgRoundHeals) * duration} total)`;
      if (r.nDamageResisted !== 0) s += ` after ${r.nDamageResisted}% damage resisted`;
      let t = '';
      if (lvlSpecified && castChance < 100) t = autoAppend(t, `${100 - castChance}% chance to fail cast`, ' and ');
      if (fullResist > 0) t = autoAppend(t, `${fullResist}% chance to fully-resist`, ' and ');
      if (t) s += ', not including ' + t;
    } else {
      if (lvlSpecified && castChance < 100) s += ` @ ${castChance}% chance to cast`;
      if (r.nDamageResisted !== 0) s += `, ${r.nDamageResisted}% damage resisted`;
      if (fullResist > 0) s += `, ${fullResist}% chance to fully-resist`;
    }
    r.sAvgRound = s;
  }
  if (r.nMinCast > 0 && (r.nMinCast !== r.nMaxCast || r.nMaxCast !== avgCast)) {
    if ((!lvlSpecified || showAtLevel) && castLevel > 0) castLvlText = ` (@lvl ${castLevel})`;
    let s = `Min/Avg/Max Cast${castLvlText}: ${r.nMinCast}/${avgCast}/${r.nMaxCast}`;
    if (casts > 1) s += ` x${casts}/round (${r.nMinCast * casts}/${avgCast * casts}/${r.nMaxCast * casts})`;
    if (lvlSpecified && duration === 1) {
      if (fullResist > 0 && castChance < 100) s += ' (before full resist & cast % reductions)';
      else if (fullResist > 0) s += ' (before full resist reduction)';
    }
    r.sMMA = s;
  }
  if (showAtLevel) {
    let scaled = '', fixed = '', n = 0;
    const IGNORE = new Set([23, 51, 52, 80, 97, 98, 100, 108, 109, 110, 111, 112, 113, 115, 119, 122, 138, 144, 151, 164, 178, 137]);
    for (let x = 0; x <= 9; x++) {
      const a = sp['Abil-' + x];
      if (a > 0 && !IGNORE.has(a)) {
        const name = abilityName(a);
        if (name) { n++; if (sp['AbilVal-' + x] === 0) scaled = autoAppend(scaled, name); else fixed = autoAppend(fixed, name); }
      }
    }
    if (scaled) {
      if (fixed) scaled += ` (not ${fixed})`;
      const t = getCurrentSpellMinMax(sp, false);
      let inc = '';
      if (String(t.nDur) !== t.sDur) inc = autoAppend(inc, 'Duration: ' + t.sDur);
      if (String(t.nMin) !== t.sMin) inc = autoAppend(inc, 'Min: ' + t.sMin);
      if (String(t.nMax) !== t.sMax) inc = autoAppend(inc, 'Max: ' + t.sMax);
      if (inc) r.sLVLincreases = 'LVL Increases: ' + inc + (n > 1 ? ' for: ' + scaled : '');
    }
  }
  return r;
}
