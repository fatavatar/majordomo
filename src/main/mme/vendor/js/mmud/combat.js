// Combat math: accuracy, crits, dodge, MR, energy and swings, quick-and-deadly,
// weapon / martial-arts / bash / smash / backstab damage against a target's
// AC, DR and dodge, and a character's damage per round against a monster.
// Ported from modMMudFunc.bas, modMain.bas (GetDamageOutput) and frmMain
// (CalcCharacterStats' crit block). Spell maths are in spellcalc.js; monster
// damage against a character in monsterattack.js.
//
// Everything here is pure: callers pass a character profile, item/monster rows
// (or numbers) and options. Only stock MajorMUD is ported; GreaterMUD branch
// points are kept as `if (engine.greater)` with TODOs.
//
// ---------------------------------------------------------------- inputs
//
// CharProfile (MME's tCharacterProfile, plus the nGlobalChar* globals that
// CalculateAttack reads for a loaded character). Make one with blankProfile()
// and fill what you know; unknown numbers stay 0.
//   isLoaded        bIsLoadedCharacter: the numbers below are the character's
//                   totals and already include the equipped weapon(s). When
//                   false CalculateAttack adds nothing from the weapon but its
//                   damage and speed. level 0 means "any character": MME then
//                   assumes level 255, combat 3, STR/AGI/stealth 255.
//   party           1 for a single character
//   level, cls, race, align
//   combat          class combat rating as GetClassCombat returns it
//                   (Classes.CombatLVL - 2: 1 poor .. 5 excellent); 0 = look up cls
//   str, agi, int, wis, cha, hea
//   accuracy        total accuracy (lblInvenCharStat(10))
//   crit            total crit %, before diminishing returns, including
//                   qndBonus for the equipped weapon
//   qndBonus        nGlobalCharQnDbonus: the Q&D part of crit
//   dodge           raw dodge value
//   plusMaxDamage, plusMinDamage
//   plusBSaccy, plusBSmindmg, plusBSmaxdmg
//   maSkill, maAccy, maDmg   [_, punch, kick, jumpkick] (+skill/acc/dmg)
//   stealth, classStealth, raceStealth
//   hitMagic        weapon + other hit-magic level; hitMagicNonWeapon without it
//   encumPct, encumCurrent, encumMax
//   spellcasting, spellDmgBonus, maxMana, manaRegen, spellOverhead
//   hp, hpRegen
//   weapons         [main hand item #, off hand item #] equipped (0 = none)
//   accyAbils, accyOther, accyItems   nGlobalCharAccy* (backstab accuracy)
//
// Items, monsters and spells are db rows, keyed by mdb column names
// (item.Speed, mon.ArmourClass, mon['Abil-0']); functions also accept numbers.
//
// AttackConfig (MME's nGlobalAttack* globals) for damageVsMonster:
//   type            ATTACK.oneshot | weapon | spell | spellAny | martial |
//                   manual | bash | smash
//   weapon          item # used for weapon/bash/smash (default profile.weapons[0])
//   spell, spellLevel     for spell / spellAny
//   ma              1 punch, 2 kick, 3 jumpkick
//   manualPhys, manualMag  for manual
//   backstab, backstabWeapon   also work out the opening backstab
//
// ---------------------------------------------------------------- API
//
// calculateAttack(profile, attackType, weapon, opts) -> AttackDamage
// calculateAttackDefense(accy, ac, dodge, opts) -> [hit %, dodge %]
// damageVsMonster(profile, attack, monster, opts) -> DamageOutput
// plus the single formulas exported below (calcEnergyUsed, swingTable,
// calcQuickAndDeadlyBonus, calculateAccuracy, calcCritChance, calcDodge,
// calcDodgeVSAccuracy, calcMR, calcBSDamage, calculateStealth, ...).

import { by, abilities } from '../db.js';
import { engine } from './engine.js';
import { fix, vbRound, cint, cur, idiv, val } from './vb.js';
import { getMaxLevel, pullSpellEQ, calculateSpellCast, calculateResistDamage } from './spellcalc.js';
import { spellName } from '../db.js';

export const MAX_SWINGS = 5;
export const STOCK_HIT_MIN = 8, GMUD_HIT_MIN = 2;
export const STOCK_HIT_CAP = 99, GMUD_HIT_CAP = 100;
export const STOCK_DODGE_CAP = 95, GMUD_DODGE_SOFTCAP = 55, GMUD_DODGE_CAP = 98;

// eAttackTypeMUD
export const MUD = Object.freeze({ none: 0, punch: 1, kick: 2, jumpkick: 3, surprise: 4, normal: 5, bash: 6, smash: 7 });
// eAttackTypeMME
export const ATTACK = Object.freeze({ oneshot: 0, weapon: 1, spell: 2, spellAny: 3, martial: 4, manual: 5, bash: 6, smash: 7 });

// eEvilPoints: the top of each alignment band.
export const EVIL = Object.freeze({ saint: -201, good: -51, neutral: 29.99, seedy: 39.99, outlaw: 79.99,
  criminal: 119.99, villain: 299.99, fiend: 500 });

const itemRow = i => (typeof i === 'object' ? i : by.item.get(i));
const monRow = m => (typeof m === 'object' ? m : by.monster.get(m));
const gmudMaxSwings = () => engine.maxSwings;

export function blankProfile() {
  return {
    isLoaded: false, party: 1, level: 0, cls: 0, race: 0, align: 0, combat: 0,
    str: 0, agi: 0, int: 0, wis: 0, cha: 0, hea: 0,
    accuracy: 0, crit: 0, qndBonus: 0, dodge: 0, plusMaxDamage: 0, plusMinDamage: 0,
    plusBSaccy: 0, plusBSmindmg: 0, plusBSmaxdmg: 0,
    maSkill: [0, 0, 0, 0], maAccy: [0, 0, 0, 0], maDmg: [0, 0, 0, 0],
    stealth: 0, classStealth: false, raceStealth: false,
    hitMagic: 0, hitMagicNonWeapon: 0,
    encumPct: 0, encumCurrent: 0, encumMax: 0,
    spellcasting: 0, spellDmgBonus: 0, maxMana: 0, manaRegen: 0, spellOverhead: 0,
    hp: 0, hpRegen: 0,
    weapons: [0, 0], accyAbils: 0, accyOther: 0, accyItems: 0,
  };
}

// ---------------------------------------------------------------- class / race

// modMMudDatabase.GetClassCombat: CombatLVL - 2 (1 = poor .. 5 = excellent).
export function classCombat(cls) {
  const c = typeof cls === 'object' ? cls : by.cls.get(cls);
  return c ? c.CombatLVL - 2 : 1;
}
const hasAbil = (row, n, slots = 10) => {
  for (let x = 0; x < slots; x++) if (row && row['Abil-' + x] === n) return true;
  return false;
};
// modMMudDatabase.GetClassStealth / GetRaceStealth (abilities 103 / 102).
export const classStealth = cls => hasAbil(typeof cls === 'object' ? cls : by.cls.get(cls), 103);
export const raceStealth = race => hasAbil(typeof race === 'object' ? race : by.race.get(race), 102);

// modMain.GetAbilityStatSlot: which character-stat slot (lblInvenCharStat
// index; >100 = a base stat) an ability adds to.
export const STAT_SLOT = Object.freeze({
  2: 2, 3: 28, 4: 11, 5: 27, 7: 3, 10: 2, 13: 23, 14: 23, 22: 10, 24: 20, 25: 32, 27: 19,
  29: 37, 30: 38, 34: 8, 35: 39, 36: 24, 37: 22, 40: 21, 44: 104, 45: 124, 46: 101, 47: 123,
  48: 102, 49: 103, 58: 7, 65: 25, 66: 29, 67: 31, 69: 6, 70: 9, 77: 18, 88: 5, 89: 40, 90: 41,
  91: 42, 92: 34, 93: 35, 94: 36, 96: 4, 105: 10, 106: 10, 116: 13, 117: 14, 118: 15, 123: 16,
  142: 12, 145: 17, 147: 26, 165: 33, 179: 21, 180: 22,
});
export const statSlot = abil => STAT_SLOT[abil] ?? -1;

// modMMudDatabase.ItemHasAbility: the ability's value, or -31337.
export function itemHasAbility(itemNum, abil) {
  const it = itemRow(itemNum);
  if (!it || abil < -1) return -31337;
  let v = -31337;
  if (engine.greater && abil > 0) {
    // TODO GreaterMUD: AC/DR/accuracy columns count as abilities
    if (abil === 2 && it.ArmourClass) v = it.ArmourClass;
    if (abil === 7 && it.DamageResist) v = it.DamageResist;
    if (abil === 22 && it.Accy) v = it.Accy;
  }
  for (let x = 0; x <= 19; x++) {
    if (it['Abil-' + x] === abil) { if (v === -31337) v = 0; return v + it['AbilVal-' + x]; }
  }
  return v;
}

// What an equipped weapon contributes (frmMain's nGlobalCharWeapon*(i) arrays):
// its accuracy, encumbrance and the weapon-specific ability stats.
export function weaponStats(item) {
  const it = itemRow(item);
  const s = { number: 0, accy: 0, encum: 0, crit: 0, maxDmg: 0, bsAccy: 0, bsMin: 0, bsMax: 0, stealth: 0,
    str: 0, agi: 0, maSkill: [0, 0, 0, 0], maAccy: [0, 0, 0, 0], maDmg: [0, 0, 0, 0] };
  if (!it) return s;
  s.number = it.Number; s.accy = it.Accy; s.encum = it.Encum;
  for (const { abil, val: v } of abilities(it)) {
    if (!v) continue;
    switch (statSlot(abil)) {
      case 7: s.crit = v; break;
      case 11: s.maxDmg = v; break;
      case 13: s.bsAccy = v; break;
      case 14: s.bsMin = v; break;
      case 15: s.bsMax = v; break;
      case 37: s.maSkill[1] = v; break;
      case 40: s.maAccy[1] = v; break;
      case 34: s.maDmg[1] = v; break;
      case 38: s.maSkill[2] = v; break;
      case 41: s.maAccy[2] = v; break;
      case 35: s.maDmg[2] = v; break;
      case 39: s.maSkill[3] = v; break;
      case 42: s.maAccy[3] = v; break;
      case 36: s.maDmg[3] = v; break;
      case 19: s.stealth = v; break;
      case 101: if (engine.greater) s.str = v; break;   // only spells add +stats in stock
      case 102: if (engine.greater) s.agi = v; break;
    }
  }
  return s;
}

// ---------------------------------------------------------------- caps

// modMMudFunc.GetHitMin / GetHitCap / GetDodgeCap
export function getHitMin(cls = 0) {
  if (engine.greater) {
    let m = GMUD_HIT_MIN;
    if (cls > 0) { const c = by.cls.get(cls); if (c && c.ArmourType <= 6) m -= 1; }
    return m;
  }
  return STOCK_HIT_MIN;
}
export const getHitCap = () => (engine.greater ? GMUD_HIT_CAP : STOCK_HIT_CAP);
export function getDodgeCap(cls = 0, softCap = false) {
  if (softCap && engine.greater) return GMUD_DODGE_SOFTCAP;
  return engine.greater ? GMUD_DODGE_CAP : STOCK_DODGE_CAP;
}

// modMMudFunc.GMUD_DiminishingReturns
export function gmudDiminishingReturns(value, scale) {
  if (scale <= 0) return value;
  const neg = value < 0;
  if (neg) value = -value;
  const tri = (Math.sqrt(8 * (value / scale) + 1) - 1) / 2;
  return neg ? -tri * scale : tri * scale;
}

// ---------------------------------------------------------------- encumbrance, energy, swings

// modMMudFunc.CalcEncum: max encumbrance for a strength.
export function calcEncum(strength, encumBonus = 0) {
  if (strength < 0) return 0;
  let e;
  if (/v1\.11i$/i.test(engine.datLabel)) e = strength * 48;
  else e = strength < 101 ? strength * 48 : 4800 + (strength - 100) * 84;
  if (encumBonus > 0) e = e + e * (encumBonus / 100);
  return vbRound(e);
}

// modMMudFunc.CalcEncumbrancePercent
export function calcEncumbrancePercent(current, max) {
  if (max < 1) max = 1;
  if (max > 999999) max = 999999;
  if (current < 0) current = 0;
  if (current > max) current = max;
  return fix((current * 100) / max);
}

// modMMudFunc.CalcEnergyUsed: energy per swing. `encum` -1 skips the
// encumbrance adjustment; speedAdj (85 fast, 125 slow; 0/100 normal) is
// ignored for backstabs.
export function calcEnergyUsed(combat, level, attackSpeed, agl, str = 0, encum = -1, itemStr = 0, speedAdj = 0, isBackstab = false) {
  let e = fix((attackSpeed * 1000) / fix((((level * (combat + 2)) + 45) * (agl + 150)) / 6));
  if (str > 0 && str < itemStr) e = fix(((((itemStr - str) * 3) + 200) * e) / 200);
  if (speedAdj > 0 && speedAdj !== 100 && !isBackstab) e = fix((e * speedAdj) / 100);
  if (encum >= 0) e = fix((e * (fix(encum / 2) + 75)) / 100);
  return e;
}

// modMMudFunc.CalcEnergyUsedWithEncum
export function calcEnergyUsedWithEncum(combat, level, speed, agl, str, encum, itemStr = 0) {
  const e = calcEnergyUsed(combat, level, speed, agl, str, -1, itemStr);
  return fix((e * (fix(encum / 2) + 75)) / 100);
}

// modMMudFunc.AdjustSpeedForSlowness / AdjustEnergyUsedWithSpeed / AdjustEnergyUsedWithEncum
export const adjustSpeedForSlowness = speed => fix((speed * 3) / 2);
export const adjustEnergyUsedWithSpeed = (eu, speed) => fix((eu * speed) / 100);
export const adjustEnergyUsedWithEncum = (eu, encum) => fix((eu * (fix(encum / 2) + 75)) / 100);

// modMMudFunc.CalcQuickAndDeadlyBonus: crit % for swinging fast (< 200 energy).
export function calcQuickAndDeadlyBonus(agl, eu, encum) {
  if (eu >= 200 || (encum > 66 && !engine.greater)) return 0;
  if (engine.greater) {
    // TODO GreaterMUD: check against the GMUD source
    const mult = engine.datVersion > 1.85 ? 40 : 50;
    return fix((1000 - eu * 5) / mult);
  }
  let b = (200 - eu) + fix((agl - 50) / 10);
  if (b > 20) b = 20;
  if (encum >= 33) b = fix(b / 2);
  return b;
}

// frmSwingCalc.CalcSwings: swings in each of the next ten rounds and the
// energy left over after each, carrying the remainder forward.
export function swingTable(energy, rounds = 10) {
  const out = [];
  let temp = 1000;
  if (energy <= 0) energy = 1;
  const max = engine.greater ? gmudMaxSwings() : MAX_SWINGS;
  for (let x = 0; x < rounds; x++) {
    let i = fix(idiv(temp, energy));
    temp = (temp % cint(energy)) + 1000;
    if (i > max) i = max;
    out.push({ swings: i, energyLeft: temp - 1000 });
  }
  return out;
}

// modMMudFunc.CalcTrueAverage: MegaMUD-style average round from hit/crit/extra
// percentages (whole numbers) and averages.
export function calcTrueAverage(swings, hitP, hitA, critP, critA, extraP, extraA) {
  if (swings <= 0) return -1;
  const max = engine.greater ? gmudMaxSwings() : MAX_SWINGS;
  if (swings > max) swings = max;
  hitP /= 100; critP /= 100; extraP /= 100;
  return vbRound(((hitP * hitA) + (critP * critA) + ((hitP + critP) * extraP * extraA)) * swings, 2);
}

// ---------------------------------------------------------------- character stats

// modMMudFunc.CalculateAccuracy. Returns the total and the breakdown lines
// MME shows in the tooltip. accyWorn -1 means "add item accuracy later".
export function calculateAccuracy({ cls = 0, level = 0, str = 0, agi = 0, int = 0, cha = 0, accyWorn = 0,
  plusAccy = 0, encumPct = 0, attackType = 0 } = {}) {
  const lines = [];
  if (accyWorn === 0 && (!engine.greater || plusAccy === 0)) { accyWorn = 1; lines.push(`Pity Accy (${accyWorn})`); }
  if (encumPct === 0) encumPct = 1;
  if (accyWorn < 0) accyWorn = 0;
  let calc = 0;
  if (encumPct < 33) {
    const b = 15 - fix(encumPct / 10);
    lines.push(`Encum (${b})`);
    calc += b;
  }
  if (!engine.greater) {
    const t = calc;
    calc = fix(calc / 2) * 2;                         // ...how it is in the dll
    if (t !== calc) lines.push(`odd number penalty (${vbRound(calc - t)})`);
  }
  let base = 0;
  if (level > 0) {
    base = fix(Math.sqrt(level));
    while ((base + 1) * (base + 1) <= level && !engine.greater) base++;
  }
  if (cls > 0) {
    const combatLevel = classCombat(cls) + 2;       // GetClassCombat subtracts 2
    base = base * (combatLevel - 1);
    base = (base + combatLevel * 2 + fix(level / 2) - 2) * 2;
  }
  if (base > 0) lines.push(`Combat+Level (${base})`);
  calc += base;
  const bashy = attackType === MUD.bash || attackType === MUD.smash;
  if (str > 0 && (!engine.greater || bashy)) {
    const t = fix((str - 50) / 3);
    if (t !== 0) { lines.push(`Strength (${t})`); calc += t; }
  }
  if (agi > 0) {
    const t = !engine.greater || bashy ? fix((agi - 50) / 6) : fix((agi - 50) / 3);
    if (t !== 0) { lines.push(`Agility (${t})`); calc += t; }
  }
  if (engine.greater && !bashy) {
    // TODO GreaterMUD: intellect/charm accuracy (ported from MME, unverified here)
    if (int > 0) { const t = fix((int - 50) / 6); if (t) { calc += t; lines.push(`Intellect (${t})`); } }
    if (cha > 0) { const t = fix((cha - 50) / 10); if (t) { calc += t; lines.push(`Charm (${t})`); } }
  }
  let total = calc + accyWorn + plusAccy;
  if (engine.greater && attackType === MUD.smash) {
    const t = fix((total * 3) / 2);
    lines.push(`Smash Bonus (${t - total})`);
    total = t;
  }
  return { accuracy: total, lines };
}

// modMMudFunc.CalculateBackstabAccuracy
export function calculateBackstabAccuracy(stealth, agility, plusBSaccy, hasClassStealth, plusNormalAccy,
  level = 0, strength = 0, strReq = 0) {
  let a;
  if (engine.greater) {
    // TODO GreaterMUD: verify (MME's VB assigns a Double to a Long here)
    a = cint((stealth / 3) + ((agility - 50 + level) / 2)) + 15 + plusBSaccy;
    if (strength < strReq) a -= 15;
  } else {
    a = fix((stealth + agility) / 2) + fix(plusBSaccy / 2);
    a += hasClassStealth ? 5 : -15;                 // race stealth only: -15
  }
  return a + plusNormalAccy;
}

// frmMain.CalcCharacterStats, crit block:
//   c = (lvl/10)+((agil-50)/20)+((int-50)/10)+((cha-50)/30), at least 1 (75 max
//   in stock), + Q&D + items/abilities. Returns the raw total; see effectiveCrit.
export function calcCritChance({ level = 0, agi = 0, int = 0, cha = 0, combatLevel = 0, qnd = 0, plusCrit = 0 } = {}) {
  let c = 0;
  const parts = [fix(level / 10), fix((agi - 50) / 20), fix((int - 50) / 10), fix((cha - 50) / 30)];
  for (const t of parts) if (t > 0) c += t;
  if (c > 75 && !engine.greater) c = 75;
  if (c < 1) c = 1;
  if (engine.greater && combatLevel > 0 && combatLevel < 5) c += 5 - combatLevel;   // TODO GreaterMUD
  if (qnd > 0) c += qnd;
  c += plusCrit;
  return c < 0 ? 0 : c;
}

// Diminishing returns over 40% (CalculateAttack / CalcCharacterStats).
export function effectiveCrit(c) {
  if (c <= 40) return c;
  if (engine.greater) return c > 65 ? 65 : c;
  c = 40 + fix((c - 40) / 3);
  return c > 99 ? 99 : c;
}

// modMMudFunc.CalcDodge: raw dodge.
export function calcDodge({ level = 0, agi = 0, cha = 0, plusDodge = 0, currentEncum = 0, maxEncum = -1 } = {}) {
  let d = fix(level / 5) + fix((cha - 50) / 5) + fix((agi - 50) / 3);
  d = cint(d + plusDodge);
  if (maxEncum > 0) {
    const pct = fix((currentEncum / maxEncum) * 100);
    if (pct < 33) d += 10 - fix(pct / 10);
  }
  return d;
}

// modMMudFunc.CalcDodgeVSAccuracy: dodge % against an attacker's accuracy.
export function calcDodgeVSAccuracy(rawDodge, accy, cls = 0) {
  if (rawDodge < 0) return 0;
  if (rawDodge > 9999) rawDodge = 9999;
  if (accy < 0) accy = 0;
  if (accy > 9999) accy = 9999;
  let pct = 0;
  if (engine.greater) {
    // TODO GreaterMUD: per-class soft caps if GMUD brings them back
    let ta = cint(((accy * accy) / 14) / 10);
    if (ta < 1) ta = 1;
    pct = cint((rawDodge * rawDodge) / ta);
    const soft = getDodgeCap(cls, true);
    if (pct > soft && soft > 0) pct = cint(soft + gmudDiminishingReturns(pct - soft, 4));
    if (pct > GMUD_DODGE_CAP) pct = GMUD_DODGE_CAP;
  } else if (accy > 8) {
    let ta = idiv(accy, 8);
    if (ta < 1) ta = 1;
    pct = fix(idiv(rawDodge * 10, ta));
    if (pct > STOCK_DODGE_CAP) pct = STOCK_DODGE_CAP;
  }
  return pct < 0 ? 0 : pct;
}

// modMMudFunc.DodgeMaxAccForPercent: the highest attacker accuracy against
// which a raw dodge still reaches targetPct; -1 if never.
export function dodgeMaxAccForPercent(rawDodge, targetPct, cls = 0) {
  if (targetPct <= 0 || rawDodge <= 0) return -1;
  if (rawDodge > 9999) rawDodge = 9999;
  if (!engine.greater) {
    if (targetPct > STOCK_DODGE_CAP) targetPct = STOCK_DODGE_CAP;
    let maxLow = rawDodge * 10;
    if (maxLow > STOCK_DODGE_CAP) maxLow = STOCK_DODGE_CAP;
    if (maxLow < targetPct) return -1;
    let k = idiv(rawDodge * 10, targetPct);
    if (k < 1) k = 1;
    let cand = 8 * k + 7;
    if (cand < 9) cand = 9;
    if (cand > 1000) cand = 1000;
    while (cand < 1000 && calcDodgeVSAccuracy(rawDodge, cand + 1, cls) >= targetPct) cand++;
    while (cand >= 9 && calcDodgeVSAccuracy(rawDodge, cand, cls) < targetPct) cand--;
    return cand < 9 ? -1 : cand;
  }
  if (targetPct > GMUD_DODGE_CAP) targetPct = GMUD_DODGE_CAP;
  if (calcDodgeVSAccuracy(rawDodge, 0, cls) < targetPct) return -1;
  let lo = 0, hi = 1000;
  while (lo < hi) {
    const mid = idiv(lo + hi + 1, 2);
    if (calcDodgeVSAccuracy(rawDodge, mid, cls) >= targetPct) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// modMMudFunc.CalcMR
export const calcMR = (int, wis, modifiers = 0) => fix((int + wis * 3) / 4) + modifiers;

// modMMudFunc.CalculateStealth
export function calculateStealth({ level = 0, agi = 0, int = 0, cha = 0, classStealth: cs = false,
  raceStealth: rs = false, plusStealth = 0, encumPct = 0 } = {}) {
  const lines = [];
  if (!rs && !cs) return { stealth: 0, lines };
  let s = level <= 15 ? level * 2 : fix(((level - 15) * 2) / 2) + 30;
  s += 20;
  lines.push(`Level (${s})`);
  if (engine.greater) s = cint(agi / 4 + int / 8 + cha / 6) + s;     // TODO GreaterMUD
  else s += fix(agi / 4) + fix(int / 8) + fix(cha / 6);
  lines.push(`Agility (${fix(agi / 4)})`, `Intellect (${fix(int / 8)})`, `Charm (${fix(cha / 6)})`);
  if (rs && cs) { s += 10; lines.push('Race+Class (10)'); }
  else if (rs) { s -= 15; lines.push('Race Only (-15)'); }
  if (engine.greater && encumPct > 0) {
    let pen = fix((encumPct * 15) / 100);
    if (pen < 0) pen = 0;
    if (pen > 15) pen = 15;
    s -= pen;
    if (pen) lines.push(`Encum Penalty (${-pen})`);
  }
  return { stealth: s + plusStealth, lines };
}

// modMMudFunc.CalcBSDamage (the Delphi CalcBSDamage MME quotes):
//   ((Level*2) + (Stealth div 10)) + (Dmg*2) + BsDmgMod; race stealth only *75%;
//   then * (Level+100)/100.
export function calcBSDamage(level, stealth, dmg, bsDmgMod, hasClassStealth) {
  let d = level * 2 + fix(stealth / 10) + dmg * 2 + bsDmgMod;
  if (!hasClassStealth) d = fix((d * 75) / 100);
  if (hasClassStealth || !engine.greater) d = fix(((level + 100) * d) / 100);
  return d;
}

// frmBSCalc.CalcBS: backstab damage range for a weapon and the calculator's
// inputs. `equipped` is the profile's main/off-hand weapon (weaponStats) to
// take back out when a different weapon is picked with the global filter on.
export function backstabRange(weapon, { level = 0, stealth = 0, str = 0, plusMaxDamage = 0, plusBSmin = 0,
  plusBSmax = 0, hasClassStealth = false, globalFilter = false, equipped = [null, null] } = {}) {
  const it = itemRow(weapon);
  if (!it) return null;
  if (!hasAbil(it, 116, 20)) return { noBS: true };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  plusBSmin = clamp(plusBSmin, 0, 1000); plusBSmax = clamp(plusBSmax, 0, 1000);
  level = clamp(level, 0, 1000); stealth = clamp(stealth, 0, 1000); plusMaxDamage = clamp(plusMaxDamage, 0, 1000);
  let minStr = fix((str - 100) / 10);
  if (!engine.greater) minStr *= 2;
  if (minStr < 0) minStr = 0;
  const adj = { maxDmg: 0, bsMin: 0, bsMax: 0, stealth: 0, notes: [] };
  const main = equipped[0];
  if (!main || main.number !== it.Number || !globalFilter) {
    for (const { abil, val: v } of abilities(it)) {
      if (!v) continue;
      switch (statSlot(abil)) {
        case 11: plusMaxDamage += v; adj.maxDmg += v; break;
        case 14: plusBSmin += v; adj.bsMin += v; break;
        case 15: plusBSmax += v; adj.bsMax += v; break;
        case 19: stealth += v; adj.stealth += v; break;
      }
    }
  }
  if (main && main.number && main.number !== it.Number && globalFilter) {
    const sub = w => { plusMaxDamage -= w.maxDmg; plusBSmin -= w.bsMin; plusBSmax -= w.bsMax; stealth -= w.stealth;
      adj.maxDmg -= w.maxDmg; adj.bsMin -= w.bsMin; adj.bsMax -= w.bsMax; adj.stealth -= w.stealth; };
    sub(main);
    if ((it.WeaponType === 1 || it.WeaponType === 3) && equipped[1] && equipped[1].number) sub(equipped[1]);
  }
  let min = it.Min + minStr;
  let max = it.Max + plusMaxDamage;
  if (max < min) max = min;
  min = calcBSDamage(level, stealth, min, plusBSmin, hasClassStealth);
  max = calcBSDamage(level, stealth, max, plusBSmax, hasClassStealth);
  return { min, max, avg: vbRound((max + min) / 2), adj, stealth, plusMaxDamage, plusBSmin, plusBSmax };
}

// ---------------------------------------------------------------- to-hit

// modMMudFunc.CalculateAttackDefense: [hit %, dodge %] for an attack. The
// dodge % still has to be taken off the hit % (CalculateAttack does
// hit * (1 - dodge/100)).
//
// MME's input clamps are one-line Ifs (`If x > 9999 Then x = 9999: If x < 1
// Then x = 1`), where VB only runs the second test when the first passed, so
// only the upper bounds apply. Kept as is.
export function calculateAttackDefense(accy, ac, dodge, { bsDefense = 0, protEv = 0, protGd = 0, perception = 0,
  vileWard = 0, evil = 0, shadow = false, seeHidden = false, backstab = false, vsPlayer = false, cls = 0 } = {}) {
  accy = cint(accy); ac = cint(ac); dodge = cint(dodge);
  if (accy > 9999) accy = 9999;
  if (ac > 9999) ac = 9999;
  if (dodge > 9999) dodge = 9999;
  if (protEv > 9999) protEv = 9999;
  if (perception > 9999) perception = 9999;
  if (bsDefense > 9999) bsDefense = 9999;
  if (vileWard > 9999) vileWard = 9999;
  if (evil > EVIL.fiend) evil = EVIL.fiend;

  let accTemp = idiv(accy * accy, 140);
  if (accTemp < 1) accTemp = 1;
  let hit, def = 0;
  if (ac + def <= 0) hit = 100;
  else if (backstab) {
    if (engine.greater) {
      // TODO GreaterMUD: backstab defence
      if (vsPlayer) {
        if (vileWard > 0 && evil > 0) {
          if (evil <= EVIL.seedy) vileWard = 0;
          else if (evil <= EVIL.criminal) vileWard = idiv(vileWard, 2);
          vileWard = idiv(vileWard, 10);
        } else vileWard = 0;
        def = ac + protEv + fix(perception * 0.8) + vileWard;
        def = idiv(def, 2) + (shadow ? 10 : 0);
      } else def = seeHidden ? ac + bsDefense : idiv(ac, 4) + bsDefense;
      if (def < 0) def = 0;
      if (def > 9999) def = 9999;
      hit = 100 - idiv(def * def, accTemp);
    } else {
      if (vsPlayer) def = idiv(ac + perception, 2);
      else def = seeHidden ? ac + bsDefense : idiv(ac, 4) + bsDefense;
      if (def < 0) def = 0;
      if (def > 9999) def = 9999;
      hit = accy - def;
    }
  } else {
    let secondary = protEv + protGd + (shadow ? 10 : 0);
    if (engine.greater && vileWard > 0 && evil > 0) {
      // TODO GreaterMUD: vile ward
      if (evil <= EVIL.seedy) vileWard = 0;
      else if (evil <= EVIL.criminal) vileWard = idiv(vileWard, 2);
      vileWard = idiv(vileWard, 10);
      secondary += vileWard;
    }
    def = ac + secondary;
    hit = 100 - idiv(def * def, accTemp);
  }
  const minHit = getHitMin(cls), maxHit = getHitCap();
  if (hit < minHit) hit = minHit;
  if (hit > maxHit) hit = maxHit;

  let dodgeChance = 0;
  if (engine.greater) {
    if (dodge > 0 || (perception > 0 && backstab && vsPlayer)) {
      if (backstab && vsPlayer) {
        let dt = idiv(dodge + idiv(perception, 2), 2);
        if (seeHidden && dodge - 9 > dt) dt = dodge;
        dodge = dt;
      }
      dodgeChance = calcDodgeVSAccuracy(dodge, accy, cls);
    }
  } else if (dodge > 0 && accy > 8) {
    dodgeChance = calcDodgeVSAccuracy(dodge, accy, cls);
    if (backstab) dodgeChance = fix(idiv(dodgeChance, 5));
  }
  return [cint(hit), cint(dodgeChance)];
}

// ---------------------------------------------------------------- cast-on-hit

const RX_OR = /\[[^\[\{\}\]]+\[{[^\[\{\}\]]+, (Damage(?:\(-MR\))?|DrainLife) (-?\d+) to (-?\d+)[^\]\}]*(?:} OR )(?:{[^\[\{\}\]]+, (Damage(?:\(-MR\))?|DrainLife) (-?\d+) to (-?\d+)[^\]\}]*(?:} OR )?)?(?:{[^\[\{\}\]]+, (Damage(?:\(-MR\))?|DrainLife) (-?\d+) to (-?\d+)[^\]\}]*(?:} OR )?)?(?:{[^\[\{\}\]]+, (Damage(?:\(-MR\))?|DrainLife) (-?\d+) to (-?\d+)[^\]\}]*(?:} OR )?)?(?:{[^\[\{\}\]]+, (Damage(?:\(-MR\))?|DrainLife) (-?\d+) to (-?\d+)[^\]\}]*(?:} OR )?)?(?:{[^\[\{\}\]]+, (Damage(?:\(-MR\))?|DrainLife) (-?\d+) to (-?\d+)[^\]\}]*(?:} OR )?)?}\], (\d+)%\]/gi;
const EC = '(?:\\[[^\\[\\{\\}\\]]+, (Damage(?:\\(-MR\\))?|DrainLife) (-?\\d+) to (-?\\d+)(?:\\]|, EndCast ))?';
const RX_ENDCAST = new RegExp('\\[(?:[^\\[\\{\\}\\]]+, (Damage(?:\\(-MR\\))?|DrainLife) (-?\\d+) to (-?\\d+)(?:\\]|, EndCast ))' +
  EC + EC + EC + EC + EC + '\\]+, (\\d+)%\\]', 'gi');
const RX_ONE = /\[(?:[^\[\{\}\]]+, (Damage(?:\(-MR\))?|DrainLife) (-?\d+) to (-?\d+)[^\]]*), (\d+)%\]/gi;

// The "[spell(n), <spell text>, 25%]|..." string CalculateAttack builds from a
// weapon's CastsSp (43) / %Spell (114) abilities.
export function weaponCastsText(item, { level = 0, spellDmgBonus = 0 } = {}) {
  const it = itemRow(item);
  if (!it) return '';
  let s = '', pct = 0, ignoreNext = false;
  for (let x = 0; x <= 19; x++) {
    const a = it['Abil-' + x], v = it['AbilVal-' + x];
    if (a === 43) {
      if (ignoreNext) { ignoreNext = false; continue; }
      const piece = `[${spellName(v)}, ${pullSpellEQ(true, level, v, { spellBonus: spellDmgBonus })}`;
      s = s.length ? (piece.trim() ? s + '|' + piece : s) : piece;
      s += pct !== 0 ? `, ${pct}%]` : ']';
    } else if (a === 114) pct = v;
    else if (a === 1114 && engine.greater) ignoreNext = true;   // castonkill%: not counted
  }
  return s;
}

// CalculateAttack's cast-on-hit block: average extra damage per hit and per
// swing from the casts text.
export function extraHitDamage(casts, swings, spellDmgBonus = 0) {
  let avgHit = 0, avgSwing = 0;
  if (!casts) return { avgHit, avgSwing };
  let rx;
  if (/\} or \{/i.test(casts)) rx = RX_OR;
  else if (/, EndCast \[/i.test(casts)) rx = RX_ENDCAST;
  else rx = RX_ONE;
  rx.lastIndex = 0;
  const matches = [...casts.matchAll(rx)];
  if (!matches.length) return { avgHit, avgSwing };
  let abil = '';
  for (const m of matches) {
    const subs = m.slice(1).filter(s => s !== undefined && s !== '');   // RegExpFindv2 drops empty submatches
    const full = m[0];
    if (subs.length - 1 < 3) continue;
    let parts;
    if (/\} or \{/i.test(full)) parts = full.split(/\} or \{/i);
    else if (/, EndCast /i.test(full)) parts = full.split(/, EndCast /i);
    else parts = [full];
    let tmp = 0, count = 0, durDamage = 0, durCount = 0;
    for (let x = 0; x <= subs.length - 2; x++) {
      const g = fix(x / 3);
      if (x !== g * 3) {
        if (parts.length - 1 >= g && / for /i.test(parts[g]) && /rounds/i.test(parts[g])) {
          durDamage += Math.abs(val(subs[x])); durCount++; count++;
          x++;
          if (subs.length - 1 >= x + 1) { durDamage += Math.abs(val(subs[x])); durCount++; count++; }
          continue;
        }
        // spell damage bonus applies here and in the spell text: kept as MME has it
        if (spellDmgBonus > 0 && (abil === 'Damage' || abil === 'Damage(-MR)' || (engine.greater && abil === 'DrainLife'))) {
          tmp += idiv(Math.abs(val(subs[x])) * (100 + spellDmgBonus), 100);
        } else tmp += Math.abs(val(subs[x]));
        count++;
      } else abil = subs[x];
    }
    if (count > 0) avgHit = vbRound(tmp / count, 2);
    if (parts.length - 1 > 0 && count > 1 && !full.includes('} OR {')) avgHit = cur(avgHit * (count / 2));   // combine all endcasts
    const pct = vbRound(val(subs[subs.length - 1]) / 100, 2);
    if (durCount > 0) avgHit = cur(avgHit + vbRound((durDamage / durCount) / swings));
    avgSwing = vbRound(avgHit * pct);
  }
  if (matches.length > 1) avgHit = vbRound(avgHit / matches.length);
  avgSwing = vbRound(avgSwing);
  return { avgHit, avgSwing };
}

// ---------------------------------------------------------------- the attack

const blankAttack = () => ({ minDmg: 0, maxDmg: 0, hitChance: 0, dodgeChance: 0, critChance: 0, qndBonus: 0,
  accy: 0, avgHit: 0, avgCrit: 0, maxCrit: 0, avgExtraHit: 0, avgExtraSwing: 0, swings: 0, roundPhysical: 0,
  roundTotal: 0, firstRoundDamage: 0, minRoundDamage: 0, attackDesc: '', attackDetail: '', attackSpeed: 0 });

// modMMudFunc.CalculateAttack: one attack type against a target.
//   attackType  MUD.punch .. MUD.smash (0 = normal)
//   weapon      item row/number; 0 = no weapon; -2..-5 = proxy weapons
//               (10/20/40/80 damage at speed 2000..5000)
//   opts        slow (Slowness ability), speedAdj (100), vsAC, vsDR, vsDodge,
//               bsDefense, casts (prebuilt casts text), forceCalc,
//               specifyDamage (-1), specifyAccy (-1), castLevel
export function calculateAttack(profile, attackType, weapon = 0, opts = {}) {
  const { slow = false, speedAdj = 100, vsAC = 0, vsDR = 0, vsDodge = 0, bsDefense = 0, forceCalc = false,
    specifyDamage = -1, specifyAccy = -1 } = opts;
  let casts = opts.casts || '';
  const p = { ...blankProfile(), ...(profile || {}) };
  const r = blankAttack();
  let preMin = 1, preMax = 1, multMin = 1, multMax = 1;
  let dmgMin = 0, dmgMax = 0, swings = 0, energy = 0, speed = 0, strReq = 0;
  let level, combat, strength, agility, stealth, crit = 0, plusMax = 0, plusMin = 0, accy = 0;
  let plusBSaccy = 0, plusBSmin = 0, plusBSmax = 0, encumPct = 0, encumCurrent = 0, encumMax = 0;
  let cStealth = false, rStealth = false, qnd = 0;
  const maSkill = [0, 0, 0, 0], maAccy = [0, 0, 0, 0], maDmg = [0, 0, 0, 0];
  let it = null;
  const weaponNumber = typeof weapon === 'object' && weapon ? weapon.Number : weapon;

  const tail = () => {
    // calc_damage: from here on every path is the same
    if (accy === 0 && specifyAccy < 0 && p.isLoaded) accy = p.accuracy;
    else if (specifyAccy >= 0) accy = specifyAccy;
    if (accy < 8) accy = 8;

    let hitChance = 100;
    if (vsAC > 0 || vsDodge > 0) {
      const d = calculateAttackDefense(accy, vsAC, vsDodge, { bsDefense, backstab: attackType === MUD.surprise });
      hitChance = d[0];
      if (d[1] > 0) { r.dodgeChance = d[1]; hitChance = cur(hitChance * (1 - d[1] / 100)); }
    }
    if (!engine.greater && vsDodge < 0 && vsAC > 0) {
      // the dll gives a (-dodge)% chance to skip the AC check (99% hit); MME scales the hit chance
      const pc = (vsDodge + 100) / 100;
      hitChance = cur(99 * pc + hitChance * (1 - pc));
      if (hitChance < STOCK_HIT_MIN) hitChance = STOCK_HIT_MIN;
    }
    hitChance = cur(hitChance / 100);

    if (preMin > 1) dmgMin = fix(dmgMin * preMin);
    if (preMax > 1) dmgMax = fix(dmgMax * preMax);
    let minCrit = 0, maxCrit = 0, avgCrit = 0;
    if (crit > 0) {
      minCrit = dmgMax * 2; maxCrit = dmgMax * 4;
      if (minCrit > maxCrit) maxCrit = minCrit;
      avgCrit = vbRound((minCrit + maxCrit) / 2) - vsDR;
      minCrit -= vsDR; maxCrit -= vsDR;
      if (avgCrit < 0) avgCrit = 0;
      if (minCrit < 0) minCrit = 0;
      if (maxCrit < 0) maxCrit = 0;
    }
    if (engine.greater) {
      dmgMin = cint(fix(dmgMin * multMin) - vsDR);
      dmgMax = cint(fix(dmgMax * multMax) - vsDR);
    } else {
      dmgMin = fix((dmgMin - vsDR) * multMin);
      dmgMax = fix((dmgMax - vsDR) * multMax);
    }
    if (dmgMin < 0) dmgMin = 0;
    if (dmgMax < 0) dmgMax = 0;
    const avgHit = vbRound((dmgMin + dmgMax) / 2);

    const isWeapon = weaponNumber > 0 && attackType > MUD.jumpkick;
    if (!casts && isWeapon) casts = weaponCastsText(it, { level: p.isLoaded ? p.level : 0, spellDmgBonus: p.spellDmgBonus });
    let extra = { avgHit: 0, avgSwing: 0 };
    if (casts && isWeapon) extra = extraHitDamage(casts, swings, p.spellDmgBonus);

    r.minDmg = dmgMin; r.maxDmg = dmgMax; r.avgHit = avgHit; r.avgCrit = avgCrit; r.maxCrit = maxCrit;
    r.avgExtraHit = cint(extra.avgHit); r.avgExtraSwing = cint(extra.avgSwing);
    r.critChance = crit; r.qndBonus = qnd; r.swings = swings; r.accy = cint(accy); r.attackSpeed = speed;
    const pc = crit / 100;
    const perSwing = (1 - pc) * avgHit + pc * avgCrit;
    r.roundPhysical = vbRound(perSwing * swings * hitChance);
    r.roundTotal = r.roundPhysical + vbRound(extra.avgSwing * swings * hitChance);
    r.firstRoundDamage = vbRound(perSwing * fix(swings) * hitChance) + vbRound(extra.avgSwing * fix(swings) * hitChance);
    r.minRoundDamage = vbRound(((1 - pc) * dmgMin + pc * minCrit) * fix(swings) * hitChance);
    r.hitChance = vbRound(hitChance * 100);
    r.casts = casts;

    if (swings > 0 && avgHit + avgCrit > 0) {
      if (attackType === MUD.surprise) {
        let s = `Backstab: ${r.roundTotal} avg @ ${r.hitChance}% hit `;
        if (dmgMin < avgHit || dmgMax > avgHit || r.avgExtraHit !== r.avgExtraSwing) {
          let lo = dmgMin, hi = dmgMax;
          if (r.avgExtraHit > 0) { if (r.avgExtraHit === r.avgExtraSwing) lo += r.avgExtraHit; hi += r.avgExtraHit; }
          s += `(Min/Avg/Max: ${lo}/${idiv(dmgMin + dmgMax + r.avgExtraSwing + r.avgExtraSwing, 2)}/${hi})`;
        }
        r.attackDetail = s;
      } else {
        let s = `Swings: ${fix(swings * 10) / 10}, Avg Hit: ${avgHit}`;
        if (avgCrit > 0) {
          s += `, Avg/Max Crit: ${avgCrit}/${maxCrit}`;
          if (crit > 0) s += ` (${crit}%)`;
        }
        if (r.hitChance > 0) s += `, Hit: ${r.hitChance}%`;
        r.attackDetail = s;
      }
    }
    return r;
  };

  if (specifyDamage >= 0) {
    r.attackDesc = 'Manual';
    dmgMin = dmgMax = specifyDamage;
    if (dmgMin < 0) dmgMin = 0;
    if (dmgMax > 9999999) dmgMax = 9999999;
    if (dmgMin > dmgMax) dmgMin = dmgMax;
    swings = 1;
    return tail();
  }
  if (attackType <= 0) attackType = MUD.normal;
  if (!weaponNumber && attackType > MUD.normal) return r;      // bash/smash need a weapon

  if (p.level === 0) {
    level = getMaxLevel(); combat = 3; strength = 255; agility = 255; stealth = 255;
    if (attackType >= MUD.punch && attackType <= MUD.jumpkick) maSkill[attackType] = 1;
    accy = 999; plusBSaccy = 999; cStealth = true;
  } else {
    level = p.level; combat = p.combat; strength = p.str; agility = p.agi;
    plusMin = p.plusMinDamage; plusMax = p.plusMaxDamage; stealth = p.stealth; crit = p.crit;
    if (p.isLoaded) crit -= p.qndBonus;
    for (let i = 1; i <= 3; i++) { maSkill[i] = p.maSkill[i] || 0; maAccy[i] = p.maAccy[i] || 0; maDmg[i] = p.maDmg[i] || 0; }
    accy = p.accuracy; plusBSaccy = p.plusBSaccy; plusBSmin = p.plusBSmindmg; plusBSmax = p.plusBSmaxdmg;
    encumPct = p.encumPct; encumCurrent = p.encumCurrent; encumMax = p.encumMax;
    if (combat === 0 && p.cls > 0) combat = classCombat(p.cls);
    cStealth = p.classStealth; rStealth = p.raceStealth;
    if (!cStealth && p.cls > 0) cStealth = classStealth(p.cls);
    if (!rStealth && p.race > 0) rStealth = raceStealth(p.race);
    if (!cStealth && forceCalc) {
      stealth = calculateStealth({ level, agi: agility, int: p.int, cha: p.cha, classStealth: false, raceStealth: true,
        plusStealth: stealth }).stealth;
    } else if (stealth === 0 && (cStealth || rStealth)) {
      stealth = calculateStealth({ level, agi: agility, int: p.int, cha: p.cha, classStealth: cStealth, raceStealth: rStealth }).stealth;
    }
    if (forceCalc && attackType >= MUD.punch && attackType <= MUD.jumpkick && maSkill[attackType] < 1) maSkill[attackType] = 1;
  }
  if (encumMax < 48) encumMax = 48;
  const startStrength = strength;

  const nonWeapon = () => {
    if (attackType <= MUD.jumpkick && maSkill[attackType] <= 0) return false;
    r.attackDesc = 'Punch';
    switch (attackType) {
      case 1: speed = slow ? 1750 : 1150; break;
      case 2: speed = slow ? 2000 : 1400; break;
      case 3:
        if (engine.greater) {   // TODO GreaterMUD: jumpkick speeds
          if (engine.datVersion > 1.85) speed = slow ? 3905 : 2800;
          else speed = slow ? 4045 : 2900;
        } else speed = slow ? 2650 : 1900;
        break;
      case 4: case 5: speed = slow ? 1800 : 1200; break;
      default: return false;
    }
    if (attackType <= MUD.jumpkick) {
      if (engine.greater) {
        // TODO GreaterMUD: martial arts damage (VB assigns Doubles to a Long: banker's rounding)
        let t = level < 20 ? cint(level / 8 + 2) : Math.max(cint(level / 6), 5);
        dmgMin = t + maSkill[attackType];
        if (attackType === 1) t = level < 20 ? cint((level + 3) / 4 + 6) : Math.max(cint(level / 4), 12);
        else if (attackType === 2) t = level < 20 ? cint(level / 5 + 7) : Math.max(cint(level / 4), 10);
        else t = level < 20 ? cint(level / 6 + 7) : Math.max(cint(level / 4), 10);
        dmgMax = t + maSkill[attackType];
      } else {
        const t = level > 20 ? 20 : level;
        dmgMin = maSkill[attackType] * t;
        if (dmgMin < 0) dmgMin += 7;     // as in the dll
        dmgMin = fix(dmgMin / 8) + 2;
        if (attackType === 1) {
          dmgMax = maSkill[1] * (t + 3);
          if (dmgMax < 0) dmgMax += 3;
          dmgMax = fix(dmgMax / 4) + 6;
        } else if (attackType === 2) dmgMax = fix((maSkill[2] * t) / 6) + 7;
        else dmgMax = fix((maSkill[3] * t) / 6) + 8;
      }
    } else { dmgMin = 1; dmgMax = 4; }                 // surprise/normal punch, no +punch
    return true;
  };

  let ok = true;
  if (!weaponNumber) ok = nonWeapon();
  else if (weaponNumber < 0 && weaponNumber >= -5) {
    const proxy = { [-2]: [10, 2000], [-3]: [20, 3000], [-4]: [40, 4000], [-5]: [80, 5000] }[weaponNumber];
    if (!proxy) return r;
    strReq = 0; dmgMin = dmgMax = proxy[0]; speed = proxy[1];
  } else {
    it = itemRow(weaponNumber);
    if (!it) return r;
    if (p.isLoaded && weaponNumber > 0 && weaponNumber !== p.weapons[0]) {
      let recalcEncum = false;
      if (p.weapons[0] > 0) {
        // the equipped weapon isn't this one: take its stats back out
        const w = weaponStats(p.weapons[0]);
        accy -= w.accy; crit -= w.crit; plusMax -= w.maxDmg; plusBSaccy -= w.bsAccy; plusBSmin -= w.bsMin;
        plusBSmax -= w.bsMax; stealth -= w.stealth; strength -= w.str; agility -= w.agi;
        if ((w.str !== 0 || w.encum !== it.Encum) && encumCurrent > 0 && encumMax > 0) { encumCurrent -= w.encum; recalcEncum = true; }
        if (attackType >= MUD.punch && attackType <= MUD.jumpkick) {
          maSkill[attackType] -= w.maSkill[attackType]; maAccy[attackType] -= w.maAccy[attackType]; maDmg[attackType] -= w.maDmg[attackType];
        }
        if ((it.WeaponType === 1 || it.WeaponType === 3) && p.weapons[1] > 0) {
          const o = weaponStats(p.weapons[1]);      // two-hander: the off hand comes off too
          accy -= o.accy; crit -= o.crit; plusMax -= o.maxDmg; plusBSaccy -= o.bsAccy; plusBSmin -= o.bsMin;
          plusBSmax -= o.bsMax; stealth -= o.stealth; strength -= o.str; agility -= o.agi;
          if (recalcEncum) encumCurrent -= o.encum;
          if (attackType >= MUD.punch && attackType <= MUD.jumpkick) {
            maSkill[attackType] -= o.maSkill[attackType]; maAccy[attackType] -= o.maAccy[attackType]; maDmg[attackType] -= o.maDmg[attackType];
          }
        }
      } else recalcEncum = true;

      if (attackType > MUD.jumpkick) accy += it.Accy;   // weapon accuracy doesn't count for mystic attacks
      for (let x = 0; x <= 19; x++) {
        const a = it['Abil-' + x], v = it['AbilVal-' + x];
        if (!(a > 0 && v !== 0)) continue;
        switch (statSlot(a)) {
          case 7: crit += v; break;
          case 11: plusMax += v; break;
          case 13: plusBSaccy += v; break;
          case 14: plusBSmin += v; break;
          case 15: plusBSmax += v; break;
          case 37: if (attackType === 1) maSkill[1] += v; break;
          case 40: if (attackType === 1) maAccy[1] += v; break;
          case 34: if (attackType === 1) maDmg[1] += v; break;
          case 38: if (attackType === 2) maSkill[2] += v; break;
          case 41: if (attackType === 2) maAccy[2] += v; break;
          case 35: if (attackType === 2) maDmg[2] += v; break;
          case 39: if (attackType === 3) maSkill[3] += v; break;
          case 42: if (attackType === 3) maAccy[3] += v; break;
          case 36: if (attackType === 3) maDmg[3] += v; break;
          case 19: stealth += v; break;
          case 101: strength += v; break;
          case 102: agility += v; break;
        }
      }
      if (recalcEncum) {
        encumCurrent += it.Encum;
        if (startStrength !== strength) {
          if (startStrength > strength) encumMax -= calcEncum(startStrength - strength);
          else encumMax += calcEncum(strength - startStrength);
        }
        encumPct = calcEncumbrancePercent(encumCurrent, encumMax);
      }
    }
    if (attackType <= MUD.jumpkick) ok = nonWeapon();
    else {
      r.attackDesc = it.Name;
      strReq = it.StrReq; dmgMin = it.Min; dmgMax = it.Max; speed = it.Speed;
      if (slow) speed = fix((speed * 3) / 2);
    }
  }
  if (!ok) return r;

  // calc_energy
  if (attackType === MUD.surprise || attackType === MUD.smash) { energy = 1000; swings = 1; }
  else energy = calcEnergyUsed(combat, level, speed, agility, strength, encumPct, strReq, speedAdj, attackType === MUD.surprise);

  if (p.isLoaded && strength >= strReq && attackType !== MUD.surprise && attackType !== MUD.bash && attackType !== MUD.smash) {
    qnd = calcQuickAndDeadlyBonus(agility, energy, encumPct);
    crit += qnd;
  }
  crit = effectiveCrit(crit);
  if (attackType === MUD.bash) energy *= 2;
  if (energy < 1) energy = 1;
  swings = vbRound(1000 / energy, 4);
  if (engine.greater) { if (swings > gmudMaxSwings()) swings = gmudMaxSwings(); }
  else if (swings > MAX_SWINGS) swings = MAX_SWINGS;

  dmgMin += plusMin; dmgMax += plusMax;
  if (dmgMin > dmgMax) dmgMin = dmgMax;
  if (dmgMin < 0) dmgMin = 0;
  if (dmgMax < 0) dmgMax = 0;

  if (attackType <= MUD.jumpkick) {
    accy += maAccy[attackType];
    dmgMin += maDmg[attackType]; dmgMax += maDmg[attackType];
    if (attackType === MUD.kick) {
      if (engine.greater) { multMin = multMax = 1.33; accy -= 10; } else preMin = preMax = 1.33;
      r.attackDesc = 'Kick';
    } else if (attackType === MUD.jumpkick) {
      if (engine.greater) { multMin = multMax = 1.66; accy -= 15; } else preMin = preMax = 1.66;
      r.attackDesc = 'JumpKick';
    }
  } else if (attackType === MUD.surprise) {
    r.attackDesc = r.attackDesc === 'Punch' ? 'surprise punch' : 'backstab with ' + r.attackDesc;
    crit = 0; qnd = 0;
    const t = level * 2 + fix(stealth / 10);
    dmgMin = dmgMin * 2 + t + plusBSmin;
    dmgMax = dmgMax * 2 + t + plusBSmax;
    if (!cStealth) { dmgMin = fix((dmgMin * 75) / 100); dmgMax = fix((dmgMax * 75) / 100); }
    if (cStealth || !engine.greater) {
      dmgMin = fix(((level + 100) * dmgMin) / 100);
      dmgMax = fix(((level + 100) * dmgMax) / 100);
    }
    accy = calculateBackstabAccuracy(stealth, agility, plusBSaccy, cStealth,
      p.isLoaded ? p.accyAbils + p.accyOther + (engine.greater ? p.accyItems : 0) : 0, level, strength, strReq);
  } else if (attackType === MUD.bash) {
    crit = 0; qnd = 0; preMin = preMax = 1.1;
    if (engine.greater) { multMin = 2.5; multMax = 3; } else { multMin = multMax = 3; }
    accy -= 15;
    r.attackDesc = 'bash with ' + r.attackDesc;
  } else if (attackType === MUD.smash) {
    crit = 0; qnd = 0; preMin = preMax = 1.2; multMin = multMax = 5;
    accy -= 25;
    r.attackDesc = 'smash with ' + r.attackDesc;
  }
  return tail();
}

// ---------------------------------------------------------------- vs a monster

// What GetDamageOutput reads off a monster row.
export function monsterDefense(monster) {
  const m = monRow(monster);
  const d = { ac: 0, dr: 0, mr: 0, dodge: 0, bsDefense: 0, magicLevel: 0, spellImmuLevel: 0,
    rcol: 0, rfir: 0, rsto: 0, rlit: 0, rwat: 0, antiMagic: false, animal: false, living: true, undead: false,
    seeHidden: false, evil: false };
  if (!m) return d;
  d.ac = m.ArmourClass; d.dr = m.DamageResist; d.mr = m.MagicRes;
  if (engine.nmrVersion >= 1.83) d.bsDefense = m.BSDefense;
  for (let x = 0; x <= 9; x++) {
    const v = m['AbilVal-' + x];
    switch (m['Abil-' + x]) {
      case 3: d.rcol = v; break;
      case 5: d.rfir = v; break;
      case 65: d.rsto = v; break;
      case 66: d.rlit = v; break;
      case 147: d.rwat = v; break;
      case 28: d.magicLevel = v; break;
      case 34: d.dodge = v; break;
      case 51: d.antiMagic = true; break;
      case 57: d.seeHidden = true; break;
      case 78: d.animal = true; break;
      case 109: d.living = false; break;
      case 139: d.spellImmuLevel = v; break;
    }
  }
  if (m.Undead === 1) d.undead = true;
  d.evil = [1, 2, 5, 6].includes(m.Align);
  return d;
}

// Weapon hit-magic for a backstab weapon (GetDamageOutput): Magical (28) +
// HitMagic (142) on the item plus the character's non-weapon hit-magic.
function backstabWeaponMagic(profile, weaponNumber) {
  let wm = 0;
  if (weaponNumber > 0) {
    wm = itemHasAbility(weaponNumber, 28);
    const hm = itemHasAbility(weaponNumber, 142);
    if (hm > -500) { if (engine.greater) { if (hm > wm) wm = hm; } else wm += hm; }
    if (engine.greater) { if (profile.hitMagicNonWeapon > wm) wm = profile.hitMagicNonWeapon; }
    else wm += profile.hitMagicNonWeapon;
  } else wm = profile.hitMagicNonWeapon;
  return wm < 0 ? 0 : wm;
}

// modMain.GetDamageOutput: a character's (or party's) damage per round against
// a monster, or against explicit defences when `monster` is null. Values below
// -9990 mean no damage: -9999 not worked out, -9998 immune (hit-magic or spell
// immunity / wrong target type).
//   opts: party {size, physical, spell, accy, swings} for a party,
//         vs {ac, dr, mr, dodge, bsDefense, magicLevel, ...} when no monster,
//         speedAdj
export function damageVsMonster(profile, attack, monster, opts = {}) {
  const p = { ...blankProfile(), ...(profile || {}) };
  const a = { type: ATTACK.weapon, weapon: undefined, spell: 0, spellLevel: 0, ma: 1, manualPhys: 0, manualMag: 0,
    backstab: false, backstabWeapon: 0, ...(attack || {}) };
  const speedAdj = 100;
  const out = { averageDamage: -9999, firstRoundDamage: -9999, minRoundDamage: 0, surpriseDamage: -9999,
    surpriseMinDamage: 0, surpriseDamageChance: 0, swings: 0 };
  const party = opts.party && opts.party.size > 1 ? opts.party : null;
  const mainWeapon = a.weapon ?? p.weapons[0];
  let physical = 0, spellDmg = 0, accy = -1, pSwings = 0;

  if (party) {
    physical = party.physical || 0; spellDmg = party.spell || 0; accy = party.accy || 0;
    pSwings = party.swings || 0;
    if (pSwings < 1) pSwings = 1;
    if (pSwings > 6) pSwings = 6;
  } else if (a.type === ATTACK.oneshot) {
    return { ...out, averageDamage: 9999999, minRoundDamage: 9999999, firstRoundDamage: 9999999, swings: 1 };
  } else if (a.type === ATTACK.manual) {
    physical = a.manualPhys; spellDmg = a.manualMag;
    accy = p.isLoaded ? p.accuracy : 9999;
  }

  const d = monster ? monsterDefense(monster) : { ...monsterDefense(null), living: false, ...(opts.vs || {}) };
  if (d.dodge < 0) d.dodge = 0;
  const vsAC = d.ac, vsDR = d.dr, vsMR = d.mr, vsDodge = d.dodge;

  if (!party && a.type > ATTACK.oneshot && a.backstab) {
    // -1 = surprise punch; 0 = the equipped weapon
    const bsw = a.backstabWeapon > 0 ? a.backstabWeapon : (a.backstabWeapon === 0 && mainWeapon > 0 ? mainWeapon : 0);
    const wm = backstabWeaponMagic(p, bsw);
    if (d.magicLevel <= wm) {
      const bs = calculateAttack(p, MUD.surprise, bsw, { speedAdj, vsAC, vsDR, vsDodge, bsDefense: d.bsDefense });
      out.surpriseDamage = bs.avgHit + bs.avgExtraHit;
      out.surpriseMinDamage = bs.minDmg + bs.avgExtraSwing;
      out.surpriseDamageChance = bs.hitChance;
      if (out.swings < 1) out.swings = 1;
    } else { out.surpriseDamage = -9998; out.swings = 0; }
  }

  if (party || a.type === ATTACK.manual) {
    let avg = 0;
    if (physical > 0) {
      const t = party
        ? calculateAttack(p, MUD.normal, 0, { speedAdj, vsAC, vsDR: 0, vsDodge, forceCalc: true, specifyDamage: physical - vsDR * pSwings, specifyAccy: accy })
        : calculateAttack(p, MUD.normal, 0, { speedAdj, vsAC, vsDR, vsDodge, forceCalc: true, specifyDamage: physical, specifyAccy: accy });
      avg += t.roundTotal;
    }
    if (spellDmg > 0) avg += calculateResistDamage(spellDmg, vsMR, { resistable: true, vsAntiMagic: d.antiMagic });
    out.averageDamage = avg; out.firstRoundDamage = avg; out.minRoundDamage = avg;
    if (out.swings < 1 && avg * 2 > 0) out.swings = 1;
    return out;
  }

  let attackRes = null, spellRes = null, avg = -9999;
  switch (a.type) {
    case ATTACK.weapon: case ATTACK.bash: case ATTACK.smash: {
      const mud = a.type === ATTACK.weapon ? MUD.normal : a.type;
      const wm = Math.max(p.hitMagic, 0);
      if (d.magicLevel <= wm) {
        if (mainWeapon > 0) {
          attackRes = calculateAttack(p, mud, mainWeapon, { speedAdj, vsAC, vsDR, vsDodge });
          avg = attackRes.roundTotal; out.swings = attackRes.swings; out.minRoundDamage = attackRes.minRoundDamage;
        }
      } else { avg = -9998; out.swings = 0; }
      break;
    }
    case ATTACK.spell: case ATTACK.spellAny: {
      if (a.spell > 0) {
        spellRes = calculateSpellCast(p, a.spell, a.type === ATTACK.spellAny ? a.spellLevel : p.level,
          { vsMR, vsAntiMagic: d.antiMagic, vsRcol: d.rcol, vsRfir: d.rfir, vsRsto: d.rsto, vsRlit: d.rlit, vsRwat: d.rwat });
        let valid = false;
        const immu = d.spellImmuLevel;
        if (immu === 0 || spellRes.nRequiredLevel > immu || (spellRes.nRequiredLevel === 0 && spellRes.nCastLevel > immu)) {
          const sp = by.spell.get(a.spell);
          let undead = false, animal = false, living = false;
          for (let x = 0; x <= 9; x++) {
            const ab = sp && sp['Abil-' + x];
            if (ab === 23) undead = true; else if (ab === 80) animal = true; else if (ab === 108) living = true;
          }
          if (!undead && !animal && !living) valid = true;
          else if (undead) valid = d.undead;
          else if (animal) valid = d.animal;
          else if (living) valid = d.living;
        }
        if (valid) { avg = spellRes.nAvgRoundDmg; out.minRoundDamage = spellRes.nMinRoundDMG; out.swings = spellRes.nNumCasts; }
        else { avg = -9998; out.swings = 0; }
      }
      break;
    }
    case ATTACK.martial: {
      if (d.magicLevel <= p.hitMagicNonWeapon) {
        const mud = a.ma === 2 ? MUD.kick : a.ma === 3 ? MUD.jumpkick : MUD.punch;
        attackRes = calculateAttack(p, mud, 0, { speedAdj, vsAC, vsDR, vsDodge });
        avg = attackRes.roundTotal; out.minRoundDamage = attackRes.minRoundDamage; out.swings = attackRes.swings;
      } else { avg = -9998; out.swings = 0; }
      break;
    }
  }
  out.averageDamage = avg;
  if (avg > -9990) {
    if (attackRes && attackRes.swings > 0) out.firstRoundDamage = attackRes.firstRoundDamage;
    else if (spellRes && spellRes.nMinCast > 0) out.firstRoundDamage = avg;
  }
  out.attack = attackRes;
  out.spell = spellRes;
  return out;
}

// ---------------------------------------------------------------- rounds to kill

export const STOCK_MOB_HPREGEN_ROUNDS = 18, GMUD_MOB_HPREGEN_ROUNDS = 6;

// modMMudFunc's ccr_ helpers
const ccrSat = x => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const ccrSmoothStep = (e0, e1, x) => {
  if (e0 === e1) return x >= e1 ? 1 : 0;
  const t = ccrSat((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const ccrLerp = (a, b, t) => a + (b - a) * t;
const ccrDiv = (n, d, def = 0) => (d === 0 ? def : n / d);
const ceilHalf = x => -Math.floor(-(x * 2)) / 2;       // -Int(-(x * 2)) / 2: up to the next 0.5

// modMMudFunc.CalcCombatRounds: rounds to kill (RTK, or RTC for several mobs),
// rounds to die (RTD) and the chance of winning. Long parameters are
// rounded as VB passes them.
export function calcCombatRounds({ damageOut = -9999, mobHealth = 0, mobDamage = -1, charHealth = 0, mobHPRegen = 0,
  numMobs = 1, overrideRTK = 0, surpriseDamageOut = -9999, firstRoundDamageOut = -9999 } = {}) {
  damageOut = cint(damageOut); mobHealth = cint(mobHealth); mobDamage = cint(mobDamage);
  charHealth = cint(charHealth); mobHPRegen = cint(mobHPRegen); firstRoundDamageOut = cint(firstRoundDamageOut);
  const r = { nRTK: 0, nRTD: 0, sRTK: '', sRTD: '', nSuccess: 0, sSuccess: '' };
  if (numMobs < 1) numMobs = 1;
  if (mobDamage > 0 && charHealth > 0) r.nRTD = vbRound(charHealth / mobDamage, 1);
  if (overrideRTK > 0) r.nRTK = overrideRTK * numMobs;
  const regenRounds = engine.greater ? GMUD_MOB_HPREGEN_ROUNDS : STOCK_MOB_HPREGEN_ROUNDS;

  if (damageOut > 0 && mobHealth > 1) {
    let mobHP = mobHealth;
    if (numMobs > 1) mobHP = cint(mobHP / numMobs);
    if (overrideRTK < 1) {
      r.nRTK = ceilHalf(vbRound(mobHP / damageOut, 2)) * numMobs;
    }
    if (mobHPRegen > 0 && r.nRTK >= regenRounds * 0.9) {
      // add hp if it takes that long to kill the mob
      let n = 1;
      while ((r.nRTK - n * regenRounds) / regenRounds >= 0.9) n++;
      mobHealth += n * mobHPRegen;
      r.nRTK = vbRound(mobHealth / damageOut, 2);
    }
    if (r.nRTK === 1 && firstRoundDamageOut >= 0 && firstRoundDamageOut < damageOut && firstRoundDamageOut < mobHP) {
      if ((mobHP - firstRoundDamageOut) / (damageOut - firstRoundDamageOut) >= 0.5) r.nRTK = 1.5;
    }
  }

  // surprise opener credit: the first target's first round is the backstab
  if (surpriseDamageOut > 0 && mobHealth > 1 && r.nRTK > 0) {
    const hpPerMob = ccrDiv(mobHealth, numMobs, mobHealth);
    const rtkNormal = overrideRTK > 0 ? overrideRTK : ceilHalf(ccrDiv(hpPerMob, Math.max(1, damageOut), 1));
    const rtkSurprise = ceilHalf(1 + ccrDiv(Math.max(0, hpPerMob - surpriseDamageOut), Math.max(1, damageOut), 0));
    const delta = rtkNormal - rtkSurprise;
    if (delta !== 0) {
      const regenRatio = ccrDiv(mobHPRegen / regenRounds, Math.max(1, damageOut), 0);
      const regenAtten = 1 - 0.45 * ccrSmoothStep(0, 0.6, regenRatio);
      const packFade = 1 / Math.sqrt(Math.max(1, numMobs));
      const fadeGate = ccrSmoothStep(3, 8, numMobs);
      const adj = delta * regenAtten * ccrLerp(1, packFade, fadeGate);
      r.nRTK = Math.max(numMobs, r.nRTK - adj);
    }
  }

  if (numMobs > 1 && r.nRTK > 0 && r.nRTK < numMobs) r.nRTK = numMobs;
  if (r.nRTK > 0 && r.nRTK < 1) r.nRTK = 1;

  if (mobHealth > 1 && (r.nRTK < 1 || r.nRTK > 200)) r.sRTK = '<infinitely attacking>';
  else if (r.nRTK > 0) r.sRTK = vbRound(r.nRTK, 1) + (numMobs > 1 ? ' RTC' : ' RTK');

  if (r.nRTD > 0 && r.nRTD < 200) r.sRTD = `vs ${r.nRTD} RTD`;
  else if ((r.nRTD === 0 || r.nRTD >= 200) && mobDamage >= 0 && charHealth > 0) r.sRTD = 'vs <unfazed by damage>';

  if ((r.sRTK + r.sRTD).length > 0 && r.nRTD > 0 && r.nRTK >= 1) {
    r.nSuccess = vbRound((r.nRTD ** 2) / ((r.nRTK ** 2) + (r.nRTD ** 2)) * 100);
    if (r.nSuccess >= 95) r.sSuccess = ' - certain success';
    else if (r.nSuccess >= 5) r.sSuccess = ` - ${r.nSuccess}% chance of success`;
    else r.sSuccess = ' - certain failure';
  }
  return r;
}

// char.attack (MME's nGlobalAttack* globals) -> the AttackConfig above.
// equipped: the character's EQ slots, for the weapon (default: none).
export function attackFromChar(at = {}, equipped = []) {
  return { type: at.type || ATTACK.oneshot, ma: at.ma || 1, spell: at.spellNum || 0, spellLevel: at.spellLvl || 0,
    manualPhys: at.manual || 0, manualMag: at.manualMag || 0, backstab: !!at.backstab,
    backstabWeapon: at.backstabWeapon || 0, weapon: (equipped || [])[16] || 0 };
}
