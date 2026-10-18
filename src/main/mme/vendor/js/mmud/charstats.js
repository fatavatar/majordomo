// The character's calculated stats: MME's EQ-tab stat panel and the Character
// tab's HP / mana / MR / picklocks / CP readouts.
//
// Ported from frmMain.CalcCharacterStats (and the routines it calls:
// RefreshCharBless, AdjMainStatBonus, InvenCalcEncum), frmMain.RefreshHitPoints,
// RefreshMagic, RefreshMagicRes, RefreshPicklocks, RefreshCPs, and the formulas
// in modMMudFunc.bas. Pure: takes the character model (char.js) and reads the
// database maps, so it runs under node.
//
// The formulas shared with the combat math (CalculateAccuracy, CalcDodge,
// CalcDodgeVSAccuracy, CalcEncum, CalcEnergyUsed, CalcQuickAndDeadlyBonus,
// CalculateStealth, CalcMR, GetAbilityStatSlot, ...) live once in combat.js;
// VB rounding in vb.js. They are re-exported here for the stat panel's callers.

import { by } from '../db.js';
import { engine } from './engine.js';
import { itemUsableBy, spellUsableBy } from './usable.js';
import { fix, vbRound, cint, idiv } from './vb.js';
import {
  ATTACK, MUD, STOCK_DODGE_CAP, GMUD_DODGE_SOFTCAP, GMUD_DODGE_CAP, classCombat, statSlot, getDodgeCap,
  calcEncum, calcEncumbrancePercent, calculateAccuracy, calcDodge, calcDodgeVSAccuracy, dodgeMaxAccForPercent,
  calcMR, calculateStealth, calcEnergyUsed, calcEnergyUsedWithEncum, calcQuickAndDeadlyBonus,
} from './combat.js';
import { getCurrentSpellMinMax, ROUND_SECS, SPELL_ROUND_SECS } from './spellcalc.js';
import { encRatio } from './details.js';

export {
  fix, vbRound, cint, idiv, ATTACK, MUD, STOCK_DODGE_CAP, GMUD_DODGE_SOFTCAP, GMUD_DODGE_CAP, classCombat,
  calcEncum, calcEncumbrancePercent, calculateAccuracy, calcDodge, calcDodgeVSAccuracy, dodgeMaxAccForPercent,
  calcMR, calculateStealth, calcEnergyUsed, calcEnergyUsedWithEncum, calcQuickAndDeadlyBonus,
  ROUND_SECS, SPELL_ROUND_SECS, encRatio,
};
export const abilityStatSlot = statSlot;   // modMain.GetAbilityStatSlot

// lblInvenCharStat(x) indices ("STAT REFERENCE" in CalcCharacterStats).
export const S = {
  curEnc: 0, maxEnc: 1, ac: 2, dr: 3, encBonus: 4, hp: 5, mana: 6, crits: 7, dodge: 8, sc: 9,
  accy: 10, maxDmg: 11, hitMagic: 12, bsAccy: 13, bsMin: 14, bsMax: 15, hpRegen: 16, manaRegen: 17,
  perception: 18, stealth: 19, protEvil: 20, traps: 21, picks: 22, illu: 23, mr: 24,
  resStone: 25, resWater: 26, resFire: 27, resCold: 28, resLightning: 29, minDmg: 30,
  quickness: 31, protGood: 32, spellDmg: 33,
  punchDmg: 34, kickDmg: 35, jkDmg: 36, punchSkill: 37, kickSkill: 38, jkSkill: 39,
  punchAccy: 40, kickAccy: 41, jkAccy: 42, attk: 46,
};
export const TOTAL_STAT_LBLS = 46;

// lblInvenStats(x).Caption
export const STAT_LABELS = ['Encumbrance', 'Max Encumbrance', 'Armour Class', 'Damage Resistance',
  'Encumbrance', 'HitPoints', 'Mana', 'Crits', 'Dodge', 'SpellCast', 'Accuracy', 'Max Damage',
  'Hit Magic', 'BS Accuracy', 'BS Min Damage', 'BS Max Damage', 'HitPoint Regen', 'Mana Regen',
  'Perception', 'Stealth', 'Prot. Evil', 'Traps', 'Picklocks', 'Illuminate', 'Magic Resist',
  'Stone Resist', 'Water Resist', 'Fire Resist', 'Cold Resist', 'Lightning Res', 'Min Damage',
  'Quickness', 'Prot. Good', 'Spell Damage', 'Punch DMG', 'Kick DMG', 'Jumpkick DMG',
  'Punch Skill', 'Kick Skill', 'Jumpkick Skill', 'Punch Accy', 'Kick Accy', 'Jumpkick Accy',
  'Punch', 'Kick', 'JmpKck', 'Attk'];

// Stat order of txtCharStats(0..5), and the char.stats keys.
export const MAIN_STATS = ['str', 'int', 'wis', 'agi', 'hea', 'cha'];
// AdjMainStatBonus: "label" numbers 101..124 -> txtCharStats index.
const LABEL_TO_STAT = { 101: 0, 104: 1, 124: 2, 102: 3, 123: 4, 103: 5 };

// ---------------------------------------------------------------- lookups

export const raceHPBonus = n => (by.race.get(n) || {}).HPPerLVL || 0;                          // GetRaceHPBonus
export const raceCP = n => { const r = by.race.get(n); return r ? r.BaseCP : 100; };            // GetRaceCP
const classMagery = n => (by.cls.get(n) || {}).MageryType || 0;
const classMageryLvl = n => (by.cls.get(n) || {}).MageryLVL || 0;

// Abil-N/AbilVal-N pairs of a row, including zeros (the VB loops walk every slot).
function abilSlots(row, count) {
  const out = [];
  for (let i = 0; i < count && ('Abil-' + i) in row; i++) out.push([row['Abil-' + i] || 0, row['AbilVal-' + i] || 0]);
  return out;
}

// ---------------------------------------------------------------- formulas

// The encumbrance level label (lblInvenCharStat_Change, lblEncumLevel).
export function encumLevel(cur, max) {
  if (!max) return cur >= 1 ? { name: 'Heavy', pct: cur } : { name: 'None', pct: 0 };
  const pct = fix((cur / max) * 100);
  return { name: pct < 17 ? 'None' : pct < 34 ? 'Light' : pct < 67 ? 'Medium' : 'Heavy', pct };
}

// modMMudFunc.GetEncumPercents: weights at which each level starts.
export function encumThresholds(max) {
  if (!max) return [];
  const out = [['Light', fix(max * 0.17) + 1], ['Medium', fix(max * 0.34) + 1], ['Heavy', fix(max * 0.67) + 1]];
  for (let i = 1; i <= 9; i++) out.push([`${i * 10}%`, fix(max * (i / 10)) + 1]);
  return out;
}

// frmMain.GetDodgeSummary: lines like "95% <= 40 accy", "50% vs 80 accy".
export function dodgeSummary(rawDodge, cls = 0) {
  const cap = Math.min(100, Math.max(0, getDodgeCap(cls)));
  const targets = [cap, 50, 25, 10];
  const out = [];
  let first = -1;
  targets.forEach((t, i) => {
    if (t <= 0 || (i > 0 && t === targets[i - 1])) return;
    const accy = dodgeMaxAccForPercent(rawDodge, t, cls);
    if (accy < 0 || !(first < 0 || t < first)) return;
    const d = calcDodgeVSAccuracy(rawDodge, accy, cls);
    out.push(`${d}% ${!out.length && d === cap ? '<=' : 'vs'} ${accy} accy`);
    if (out.length === 1) first = t;
  });
  return out;
}

// modMMudFunc.CalcSpellCasting
export function calcSpellCasting(level, int, wil, cha, magLvl, magType) {
  const lv = level * 2 + magLvl * 5;
  switch (magType) {
    case 1: return fix((int * 3 + wil) / 6) + lv;
    case 2: return fix((wil * 3 + int) / 6) + lv;
    case 3: return fix((wil + int) / 3) + lv;
    case 4: return fix((cha * 3 + wil) / 6) + lv;
    case 5: return 500 + lv;
    default: return 0;
  }
}

// modMMudFunc.CalcManaRegen
export function calcManaRegen(level, int, wil, cha, magLvl, magType, mpRegen = 0, meditating = false) {
  let r;
  switch (magType) {
    case 1: r = int; break;
    case 2: r = wil; break;
    case 3: r = fix((int + wil) / 2); break;
    case 4: r = cha; break;
    case 5: return fix(((mpRegen + 100) * 1) / 100);
    default: return 0;
  }
  r = fix(((level + 20) * r * (magLvl + 2)) / 1650);
  if (meditating) return r;
  if (engine.greater) return r + fix((mpRegen * r) / 100);
  return fix(((mpRegen + 100) * r) / 100);
}

// modMMudFunc.CalcMaxMana
export const calcMaxMana = (level, magLvl) => magLvl * level * 2 + 6;

// modMMudFunc.CalcMaxHP
export const calcMaxHP = (random, level, health, minPerLevel) =>
  fix(health / 2) + level * minPerLevel + fix(((health - 50) * level) / 16) + random;

// modMMudFunc.CalcRestingRate
export function calcRestingRate(level, health, regenPct = 0, resting = false) {
  let r = engine.greater ? fix(((level + 20) * health) / 500) : fix(((level + 20) * health) / 750);
  if (r < 1) r = 1;
  if (resting) r *= 3;
  return fix(((regenPct + 100) * r) / 100);
}

// modMMudFunc.CalcMovementSpeed (ms per room)
export function calcMovementSpeed(encPct = 0, quickness = 0, slowness = 0) {
  let ms;
  if (engine.greater) {
    ms = 1100;   // TODO GreaterMUD: + (enc%^2)*2000, slowness*7, -quickness*10
  } else {
    ms = encPct > 66 ? 2000 : 1000;
    if (slowness > 0) ms *= 2;
    if (quickness > 0) ms = idiv(ms, 2);
  }
  return Math.max(1000, ms);
}

// modMMudFunc.CalcPicklocks
export function calcPicklocks(level, agi, int, cha = 0) {
  if (engine.greater) {
    // TODO GreaterMUD: verify; ported as written
    const lv = level <= 15 ? level : ((level - 15) / 2) + 15;
    return cint((int + agi + cha * 2 + lv * 28) / 7);
  }
  const p = level <= 15 ? level * 2 : (fix((level - 15) / 2) + 15) * 2;
  return fix(((p * 5 + (agi + int)) * 2) / 7);
}

// modMMudFunc.CalcCPLevel: CP earned from level 1 up to `level`.
export function calcCPLevel(level) {
  let cp = 0;
  for (let i = 1; i <= level - 1; i++) cp += fix(i / 10) * 5 + 10;
  return cp;
}

// ---------------------------------------------------------------- bless

// frmMain.RefreshCharBless. `encumPct` and `wornArmourType` are the values
// CalcCharacterStats has when it calls this (before bless and before the
// equipped-item loop, so wornArmourType is always its reset value of 0).
export function calcBless(c, encumPct = 0, wornArmourType = 0) {
  const stats = new Array(201).fill(0);
  const text = Array.from({ length: 201 }, () => []);
  let level = c.level || 1, manaPerSec = 0, accyWin = 0, shadow = [];
  const spells = [];
  for (const n of c.bless || []) {
    const sp = n > 0 && by.spell.get(n);
    if (!sp) continue;
    let lv = level;
    if (lv > sp.Cap && sp.Cap > 0) lv = sp.Cap;
    if (lv < sp.ReqLevel) lv = sp.ReqLevel;
    const mm = getCurrentSpellMinMax(sp, lv > 0, lv);
    const avg = cint((mm.nMin + mm.nMax) / 2);
    if (mm.nDur > 0) manaPerSec += vbRound(sp.ManaCost / (mm.nDur * SPELL_ROUND_SECS), 3);
    spells.push({ spell: sp.Number, name: sp.Name, short: sp.Short, mana: sp.ManaCost, dur: mm.nDur, level: lv });
    for (let y = 0; y < 10; y++) {
      const abil = sp['Abil-' + y];
      if (!(abil > 0)) continue;
      if (abil === 9) { shadow.push('Bless: ' + sp.Name); continue; }
      let v = sp['AbilVal-' + y];
      if (v === 0) v = avg;
      if (abil === 7) v = vbRound(v / 10, 1);
      const slot = abilityStatSlot(abil);
      if (slot <= 0) continue;
      if (slot === 10 && !engine.greater) {
        if (v > accyWin) { accyWin = v; stats[10] = v; text[10] = [`Bless: ${sp.Name} (${v})**`]; }
      } else if (slot === 2 && abil === 10) {           // AC blur
        let t = v;
        if (engine.greater) { /* TODO GreaterMUD: blur scales with (100 - encum%) */ }
        else {
          const at = wornArmourType - 3;
          t = at >= 6 ? fix(t / 4) : (at === 4 || at === 5) ? fix(t / 3) : fix(t / 2);
        }
        if (t > 0) { stats[2] += t; text[2].push(`Bless: ${sp.Name} (${t}) [BLUR]${encumPct === 0 ? ' *need encum' : ''}`); }
      } else {
        stats[slot] += v;
        text[slot].push(`Bless: ${sp.Name} (${v})`);
      }
    }
  }
  if (shadow.length) { stats[100] = 10; text[100] = [shadow.join('/')]; }
  // (convert to mana per round) * mana regen every 6 rounds
  const manaPerTick = vbRound(manaPerSec * ROUND_SECS * 6, 2);
  return { stats, text, manaPerTick, spells };
}

// ---------------------------------------------------------------- quests

// chkCharQuests captions and cmbCharQuestOpts lists (frmMain designer + Form_Load).
export const QUESTS = ['Ice Sorceress (+1 AC)', 'High Druid (+1 SC)', 'ARD (+1 Crit, +2 SC)',
  'Bishop (+3 ACC)', 'Apparatus (+1 DG)', '2nd Alignment', 'Opaline (+100 HP)',
  'Cartographer (+3% Enc)', 'Loremaster (+1 AC)', '6th Alignment', 'Dread Wraith', "Renfry's Conquerors"];
export const QUEST_STOCK = 6;     // quests 6..11 are GreaterMUD only
export function questOptions(i) {
  const g = engine.greater;
  if (i === 0) return ['2nd Alignment Quest ...', g ? '+1 Max Dmg, +5 Accy' : '+1 Max Damage', '+1 AC, +6 Mana',
    g ? '+5 ManaRgn, +10 Mana' : '+1 SC, +10 Mana', '+4 Mana, +6 BS Min/Max, +1 Stealth', '+10 BS Min/Max, +2 Stealth',
    ...(g ? ['+1 Max Dmg, +5 Accy, +1 AC', '+1 Max Dmg, +10 Accy'] : [])];
  if (i === 1) return ['6th Alignment Quest ...', '+10 Accy, +2 Max Dmg, +1 Crit, +5% Encum, +50 MaxHP',
    '+2 AC, +1 Max Dmg, +10 ManaRgn, +5% Encum, +50 MaxHP', '+50 SC, +15 ManaRgn, +50 MaxMana, +50 MaxHP',
    '+10 BS Min/Max, +5 ManaRgn, +1 Max Dmg, +20 Stealth, +50 MaxHP',
    '+15 BS Min/Max, +1 Max Dmg, +1 Crit, +20 Stealth, +50 MaxHP',
    '+10 Accy, +1 Max Dmg, +10 Dodge, +1 Crit, +50 MaxHP'];
  if (i === 2) return ['Dread Wraith Quest ...', '+1 AC, +1 Max Dmg, +1 Crit', '+1 AC, +1 Max Dmg, +2 Crit', '+1 AC',
    '+1 AC, +7 Accy, +5 BS Max', '+10 Dodge, +1 Max Dmg, +10 BS Max', '+10 Dodge, +1 Max Dmg, +7 Accy'];
  if (i === 3) return ["Renfry's Conquerors ...", '1st: +10% Encum, +1 Max Dmg', '2nd: +10 Strength (plus 1st)'];
  return [];
}

// ---------------------------------------------------------------- carried items

// Item Manager rows flagged CARRIED -> [{item, qty}] (CalcCharacterStats' nCarriedItems).
export function carriedItems(c) {
  return (c.itemManager || []).filter(r => r.flag === 'CARRIED' && by.item.has(r.item))
    .map(r => ({ item: r.item, qty: Math.max(1, r.qty || 1) }));
}

// Special items and armour worn nowhere apply their abilities while carried,
// if usable (frmPasteChar's ItemIsCarryActive, and CalcCharacterStats).
export function itemIsCarryActive(item, c) {
  if (typeof item === 'number') item = by.item.get(item);
  if (!item) return false;
  if (item.ItemType === 10 || (item.ItemType === 0 && item.Worn === 0)) return itemUsableBy(item, c, { ignoreMinItemLevel: true });
  return false;
}

// ---------------------------------------------------------------- the panel

// frmMain.CalcCharacterStats. opt: { hideCharStats, globalFilter }
// Returns {
//   stats[0..46], tips[0..46] (contributor lines), eff {str..cha}, base, bonus,
//   statSources {str: [...]}, encumPct, slots[20] {tip, warn}, weapon[0..1], ...
// }
export function calcCharStats(c, opt = {}) {
  const g = engine.greater, hide = !!opt.hideCharStats;
  const st = new Array(TOTAL_STAT_LBLS + 1).fill(0);
  const tips = Array.from({ length: TOTAL_STAT_LBLS + 1 }, () => []);
  const tip = (i, s) => { if (String(s).trim()) tips[i].push(s); };
  const adj = c.statAdjustments || [];
  const level = c.level || 0, cls = c.cls || 0, race = c.race || 0;
  const attackType = (c.attack && c.attack.type) || 0;

  // txtCharStats(x).Text / .Tag and lblLabelArray(..).Tag
  const base = MAIN_STATS.map(k => (c.stats && c.stats[k]) || 0);
  const bonus = [0, 0, 0, 0, 0, 0];
  const sources = [[], [], [], [], [], []];
  const eff = i => base[i] + bonus[i];
  const adjMainStat = (v, src, statIdx = -1, label = -1) => {     // AdjMainStatBonus
    if (statIdx < 0 && label < 101) return;
    if (label >= 101) { if (!(label in LABEL_TO_STAT)) return; statIdx = LABEL_TO_STAT[label]; }
    bonus[statIdx] += v;
    if (String(src).trim()) sources[statIdx].push(src);
  };

  let accyItems = 0, accyAbils = 0, accyOther = 0, plusDodge = 0, plusMR = 0;
  let wornArmourType = 0, shadowAC = 0, accySrc = [], qnd = 0;
  const shadowSrc = [];
  let classStealth = false, raceStealth = false;
  const weapon = [0, 1].map(() => ({ number: 0, accy: 0, encum: 0, str: 0, agi: 0, crit: 0, maxDmg: 0,
    bsAccy: 0, bsMin: 0, bsMax: 0, punchSkill: 0, punchAccy: 0, punchDmg: 0, kickSkill: 0, kickAccy: 0,
    kickDmg: 0, jkSkill: 0, jkAccy: 0, jkDmg: 0, stealth: 0 }));
  const slots = (c.equipped || []).map(() => ({ tip: [], warn: '' }));

  const equipped = (c.equipped || []).slice();
  const carried = carriedItems(c);

  // class and race abilities
  const owners = [];
  if (cls > 0 && !hide && by.cls.has(cls)) owners.push(['Class', by.cls.get(cls), 103]);
  if (race > 0 && !hide && by.race.has(race)) {
    const hpb = raceHPBonus(race) * level;
    if (hpb) { st[5] += hpb; tip(5, `Race: ${by.race.get(race).Name} (${hpb})`); }
    owners.push(['Race', by.race.get(race), 102]);
  }
  for (const [kind, row, stealthAbil] of owners) {
    for (const [abil, val] of abilSlots(row, 10)) {
      if (abil === stealthAbil) { if (kind === 'Class') classStealth = true; else raceStealth = true; }
      if (g && abil === 9) { shadowAC = 10; shadowSrc.push(row.Name); continue; }
      const slot = abilityStatSlot(abil);
      if (slot <= 0) continue;
      const who = `${kind}: ${row.Name}`;
      if (slot > 100) adjMainStat(val, row.Name, -1, slot);
      else if (slot === 3) { st[3] = vbRound(st[3] + val / 10, 1); tip(3, `${who} (${val / 10})`); }
      else if (slot === 10) {
        if (val > 0 && (val > accyAbils || g)) {
          if (g) { accyAbils += val; accySrc.push(`${who} (${val})`); }
          else { accyAbils = val; accySrc = [`${who} (${val})**`]; }
        }
      } else {
        if (slot === 8) plusDodge += val;
        if (slot === 24) plusMR += val;
        if (slot === 12 && g) { if (val > st[12]) st[12] = val; }
        else st[slot] += val;
        tip(slot, `${who} (${val})`);
      }
    }
  }

  // ENCUM FIRST BECAUSE IT EFFECTS OTHER THINGS...
  if (adj[4]) { st[4] += adj[4]; tip(4, `*Manual Adjustment (${adj[4]})`); }
  if (!hide && g) { /* TODO GreaterMUD: Cartographer / 6th align / Renfry +encum and +str quests */ }

  const all = [
    ...equipped.map((n, slot) => ({ n, slot, qty: 1, carried: false })),
    ...carried.map(e => ({ n: e.item, slot: -1, qty: e.qty, carried: true })),
  ];
  for (const e of all) {
    const it = e.n > 0 && by.item.get(e.n);
    if (!it) continue;
    if (it.Encum) {
      st[0] += it.Encum;
      if (e.carried && e.qty > 1) st[0] += it.Encum * (e.qty - 1);
    }
    if (e.carried && !itemIsCarryActive(it, c)) continue;
    for (const [abil, val] of abilSlots(it, 20)) {
      if (abil === 96 && val !== 0) st[4] += val;
      else if (abil === 46 && val !== 0 && g) adjMainStat(val, `${it.Name} (${val})`, -1, 101);
    }
  }
  if (c.useAddWeight && c.addWeight > 0) {
    tip(0, `Additional Items (${c.addWeight})`);
    st[0] += c.addWeight;
  }
  const calcEnc = () => { st[1] = calcEncum(eff(0), st[4]); };
  calcEnc();

  // bless (its own encumbrance % is taken before the bless +enc is applied)
  let pct0 = st[1] > 0 ? Math.min(100, fix((st[0] / st[1]) * 100)) : 0;
  const bless = calcBless(c, pct0, wornArmourType);
  const bs = bless.stats;
  if (bs[4]) { st[4] += bs[4]; bless.text[4].forEach(t => tip(4, t)); calcEnc(); }
  if (bs[101]) { adjMainStat(bs[101], bless.text[101].join(', '), -1, 101); calcEnc(); }

  let encumPct = 0;
  if (st[1] > 0) encumPct = fix((st[0] / st[1]) * 100);
  if (encumPct > 100) encumPct = 100;

  // rest of manual and bless stats
  for (let x = 0; x <= TOTAL_STAT_LBLS; x++) {
    if (x === 4) continue;
    const a = adj[x] || 0;
    if (a) {
      if (x === 2 || x === 3) { st[x] += a / 10; tip(x, `*Manual Adjustment (${a / 10})`); }
      else {
        if (x === 12 && g) { if (a > st[x]) st[x] = a; }
        else st[x] += a;
        tip(x, `*Manual Adjustment (${a})`);
      }
      if (x === 10) accyOther += a;
      if (x === 8) plusDodge += a;
      if (x === 24) plusMR += a;
    }
    if (bs[x]) {
      if (x === 10 && !g) {
        if (bs[x] > accyAbils) { accyAbils = bs[x]; accySrc = bless.text[10].slice(); }
      } else {
        if (x === 10 && g) accyAbils += bs[x];
        if (x === 8) plusDodge += bs[x];
        if (x === 24) plusMR += bs[x];
        if (x === 12 && g) { if (bs[x] > st[x]) st[x] = bs[x]; }
        else st[x] += bs[x];
        bless.text[x].forEach(t => tip(x, t));
      }
    }
  }
  if (bs[100] > 0) { shadowAC = 10; shadowSrc.push(...bless.text[100]); }
  for (let x = 102; x <= 124; x++) {
    if (bs[x] && x in LABEL_TO_STAT) adjMainStat(bs[x], bless.text[x].join(', '), -1, x);
  }

  // equipped (and carried) items
  let weaponHitMagic = 0;
  for (const e of all) {
    const it = e.n > 0 && by.item.get(e.n);
    if (!it) continue;
    const name = it.Name, qty = e.qty;
    const carryText = e.carried ? ' [carried]' : '';
    const multi = e.carried && qty > 1 ? ' x' + qty : '';
    const stip = e.slot >= 0 ? slots[e.slot].tip : [];
    let ac = 0, dr = 0, wIdx = -1, doBase = true;

    // nGlobalCharWornArmourType compares ItemType (always 0 for worn armour),
    // as MME does; it only feeds the AC-blur divisor.
    if (!e.carried && e.slot !== 16 && it.ItemType > wornArmourType) wornArmourType = it.ItemType;
    if (it.Encum) {
      stip.push(`Enc: ${it.Encum}`);
      tip(0, `${name} (${it.Encum})${carryText}${multi}`);
    }

    if (e.carried) {
      if (!itemIsCarryActive(it, c)) continue;
      doBase = g;      // in GreaterMUD a carried item's Accy/AC/DR fields count too
    } else {
      if (e.slot === 15) wIdx = 1;
      else if (e.slot === 16) {
        wIdx = 0;
        if ((it.WeaponType === 1 || it.WeaponType === 3) && equipped[15] > 0) {
          slots[15].warn = slots[16].warn = '2-handed weapon with an off-hand item';
        }
      }
      if (wIdx >= 0) Object.assign(weapon[wIdx], { number: e.n, accy: it.Accy, encum: it.Encum });
      if (!itemUsableBy(it, c, { ignoreMinItemLevel: true })) slots[e.slot].warn = 'not usable by this character';
    }

    if (doBase) {
      ac = (it.ArmourClass * qty) / 10;
      dr = (it.DamageResist * qty) / 10;
      if (it.Accy) {
        accyItems += it.Accy * qty;
        st[10] += it.Accy * qty;
        stip.push(`Accy: ${it.Accy * qty}`);
        tip(10, `${name} (${it.Accy * qty})${carryText}${multi}`);
      }
    }

    for (const [abil, val] of abilSlots(it, 20)) {
      if (!(abil > 0) || val === 0) continue;
      if (g && abil === 9) { shadowAC = 10; shadowSrc.push(name); stip.push('ShadowAC +10'); continue; }
      if (e.slot === 16 && (abil === 28 || abil === 142)) {        // weapon magical / hit magic
        if (attackType !== ATTACK.martial) {
          weaponHitMagic = val;
          tip(12, `${name} (${val})`);
          stip.push(`Magical ${val < 0 ? val : '+' + val}`);
        } else tip(12, `${name} (${val}) [ignored: MA attack]`);
        continue;
      }
      const slot = abilityStatSlot(abil);
      const text = val > 0 ? abilityText(abil, val) : '';
      if (slot <= 0) { if (text) stip.push(text); continue; }
      if (text) stip.push(text);
      if (slot > 100) {
        if (g) { /* TODO GreaterMUD: items add +stats (AdjMainStatBonus), weapon STR/AGI */ }
      } else if (slot === 2 && abil === 10) {                     // AC blur
        let t = val * qty;
        if (g) { /* TODO GreaterMUD: blur scales with (100 - encum%) */ }
        else {
          const at = wornArmourType - 3;
          t = at >= 6 ? fix(t / 4) : (at === 4 || at === 5) ? fix(t / 3) : fix(t / 2);
        }
        if (t > 0) { st[2] += t; tip(2, `${name} (${t}) [BLUR]${carryText}${multi}${encumPct === 0 ? ' *need encum' : ''}`); }
      } else if (slot === 2) ac += val * qty;
      else if (slot === 3) dr += (val * qty) / 10;
      else if (slot === 10) {
        if (val > 0 && (val > accyAbils || g)) {
          if (g) { accyAbils += val * qty; accySrc.push(`${name} (${val * qty})${carryText}${multi}`); }
          else { accyAbils = val; accySrc = [`${name} (${val})**${carryText}`]; }
        }
      } else {
        if (wIdx >= 0) {
          const k = { 7: 'crit', 11: 'maxDmg', 13: 'bsAccy', 14: 'bsMin', 15: 'bsMax', 37: 'punchSkill',
            40: 'punchAccy', 34: 'punchDmg', 38: 'kickSkill', 41: 'kickAccy', 35: 'kickDmg', 39: 'jkSkill',
            42: 'jkAccy', 36: 'jkDmg', 19: 'stealth' }[slot];
          if (k) weapon[wIdx][k] = val;
        }
        if (slot !== 4) {
          if (slot === 8) plusDodge += val * qty;
          if (slot === 24) plusMR += val * qty;
          if (slot === 12 && g) { if (val > st[12]) st[12] = val; }
          else st[slot] += val * qty;
        }
        if (slot === 12) tip(12, `${name} (${val})${carryText}`);
        else tip(slot, `${name} (${val * qty})${carryText}${multi}`);
      }
    }

    if (ac || dr) {
      st[2] = vbRound(st[2] + ac, 1);
      st[3] = vbRound(st[3] + dr, 1);
      stip.push(`AC: ${ac}/${dr}`);
      if (ac) tip(2, `${name} (${ac}/${dr})${carryText}${multi}`);
      if (dr) tip(3, `${name} (${ac}/${dr})${carryText}${multi}`);
    }
  }

  const hitMagicNonWeapon = st[12];
  if (attackType !== ATTACK.martial) {
    if (g) { if (weaponHitMagic > st[12]) st[12] = weaponHitMagic; }
    else st[12] = hitMagicNonWeapon + weaponHitMagic;
  }

  if (shadowAC > 0) {
    st[2] += shadowAC;
    tip(2, shadowSrc.length > 1 ? 'multiple sources (10/0) [shadow]' : `${shadowSrc[0]} (10/0) [shadow]`);
  }

  // stealth
  if (!hide && (raceStealth || classStealth)) {
    const r = calculateStealth({ level, agi: eff(3), int: eff(1), cha: eff(5), classStealth, raceStealth, plusStealth: st[19], encumPct });
    tips[19].push(...r.lines);
    st[19] = r.stealth;
  }

  // strength -> max / min damage
  if (eff(0) !== 0 && !hide) {
    let b = fix((eff(0) - 50) / 10);
    if (b !== 0 && (b > 0 || !g)) { tip(11, `Strength (${b})`); st[11] += b; }
    b = fix((eff(0) - 100) / 10);
    if (!g) b *= 2;
    if (b < 0) b = 0;
    if (b > 0) { tip(30, `Strength (${b})`); st[30] += b; }
  }

  // quest bonuses
  const q = c.quests || [], qo = c.questOpts || [];
  const quest = (i, v, label) => { st[i] += v; tip(i, `Quest: ${label} (${v})`); };
  const questAccy = (v, label) => {
    if (v > accyAbils || g) {
      if (g) { accyAbils += v; accySrc.push(`Quest: ${label} (${v})`); }
      else { accyAbils = v; accySrc = [`Quest: ${label} (${v})**`]; }
    }
  };
  if (!hide) {
    for (let x = 0; x <= 11; x++) {
      if (!q[x] || !(x < QUEST_STOCK || g)) continue;
      switch (x) {
        case 0: quest(2, 1, 'Ice Sorceress'); break;
        case 1: quest(9, 1, 'High Druid'); break;
        case 2: quest(7, 1, 'Adult Red Dragon'); quest(9, 2, 'Adult Red Dragon'); break;
        case 3: questAccy(3, 'Bishop'); break;
        case 4: plusDodge += 1; tip(8, 'Quest: Apparatus (1)'); break;
        case 5:
          switch (qo[0]) {
            case 1: quest(11, 1, '2nd Align'); if (g) { accyAbils += 5; accySrc.push('Quest: 2nd Align (5)'); } break;
            case 2: quest(2, 1, '2nd Align'); quest(6, 6, '2nd Align'); break;
            case 3: if (g) quest(17, 5, '2nd Align'); else quest(9, 1, '2nd Align'); quest(6, 10, '2nd Align'); break;
            case 4: quest(6, 4, '2nd Align'); quest(14, 6, '2nd Align'); quest(15, 6, '2nd Align'); quest(19, 1, '2nd Align'); break;
            case 5: quest(14, 10, '2nd Align'); quest(15, 10, '2nd Align'); quest(19, 2, '2nd Align'); break;
            case 6: case 7:
              if (g) { /* TODO GreaterMUD: 2nd align options 6/7 */ }
              break;
          }
          break;
        default:
          if (g) { /* TODO GreaterMUD: Opaline, Cartographer, Loremaster, 6th align, Dread Wraith, Renfry */ }
      }
    }
  }

  // accuracy
  const accyTips = tips[10];
  const accyRes = hide
    ? calculateAccuracy({ accyWorn: accyItems, plusAccy: accyOther + accyAbils, encumPct })
    : calculateAccuracy({ cls, level, str: eff(0), agi: eff(3), int: eff(1), cha: eff(5),
      accyWorn: accyItems, plusAccy: accyOther + accyAbils, encumPct, attackType: 0 });
  accyTips.push(...accyRes.lines);
  st[10] = accyRes.accuracy;
  if (accyAbils > 0) accySrc.forEach(s => tip(10, s));
  let attackAccyAdj = 0;
  if (st[10] > 0) {
    if (attackType === ATTACK.bash) { attackAccyAdj = -15; tip(10, 'not shown: bash attack (-15)'); }
    else if (attackType === ATTACK.smash) { attackAccyAdj = -25; tip(10, 'not shown: smash attack (-25)'); }
  }

  // crits
  let crit = 0;
  if ((level > 0 || eff(1) > 0 || eff(3) > 0) && !hide) {
    const part = (v, label) => { if (v > 0) { tip(7, `${label} (${v})`); crit += v; } };
    part(fix(level / 10), 'Level');
    part(fix((eff(3) - 50) / 20), 'Agility');
    part(fix((eff(1) - 50) / 10), 'Intellect');
    part(fix((eff(5) - 50) / 30), 'Charm');
    if (crit > 75 && !g) crit = 75;
    if (crit < 1) crit = 1;
    if (g) { /* TODO GreaterMUD: +(5 - combat) crit for combat levels 1..4 */ }
    if (equipped[16] > 0) {
      qnd = quickAndDeadlyBonus(equipped[16], c, eff, st[0], st[1], opt);
      if (qnd > 0) { tip(7, `Quick & Deadly (${qnd})`); crit += qnd; }
    }
    crit += st[7];
    if (crit < 0) crit = 0;
    st[7] = crit;
  }

  // magic resistance
  if (!hide) {
    if (idiv(eff(1), 4) > 0) tip(24, `Intellect (${idiv(eff(1), 4)})`);
    if (idiv(eff(2) * 3, 4) > 0) tip(24, `Wisdom (${idiv(eff(2) * 3, 4)})`);
    st[24] = calcMR(eff(1), eff(2), plusMR);
  } else st[24] = plusMR;

  // dodge
  let dodge = 0;
  if ((level > 0 || eff(5) > 0 || eff(3) > 0) && !hide) {
    if (encumPct < 33) tip(8, `Encumbrance (${10 - fix(encumPct / 10)})`);
    if (fix((eff(3) - 50) / 3) !== 0) tip(8, `Agility (${fix((eff(3) - 50) / 3)})`);
    if (fix(level / 5) !== 0) tip(8, `Level (${fix(level / 5)})`);
    if (fix((eff(5) - 50) / 5) !== 0) tip(8, `Charm (${fix((eff(5) - 50) / 5)})`);
    dodge = calcDodge({ level, agi: eff(3), cha: eff(5), plusDodge, currentEncum: st[0], maxEncum: st[1] });
    st[8] = dodge;
  }

  sortStatTips(tips);

  // movement speed
  const walkMs = calcMovementSpeed(encumPct, st[31]);
  let walk;
  if (g) { walk = vbRound(walkMs / 1000, 2); /* TODO GreaterMUD tooltip */ }
  else {
    if (tips[31].length) tips[31].push('');
    tips[31].push('Base (1)');
    if (encumPct > 66) tips[31].push('Encum > 66% (1)');
    if (st[31] > 0) tips[31].push('Quickness > 0 (-1)');
    walk = vbRound(walkMs / 1000);
  }
  tips[31].push('', `Movement Speed: ${walk}s${walk === 1 && st[31] > 0 ? ' [capped]' : ''}`);

  // effective MR
  const mr = st[24];
  let mrEffective = null;
  if (mr >= 2) {
    if (c.antiMagic) {
      const t = idiv(mr, 2);
      mrEffective = Math.min(t, 75);
      tips[24].push(t >= 75 ? 'MR Capped @ 75% resist' : `Effective MR: ${t}% dmg resist`);
    } else if (mr >= 52) {
      const t = idiv(mr - 50, 2);
      mrEffective = Math.min(t, 50);
      tips[24].push(t >= 50 ? 'MR Capped @ 50% resist' : `Effective MR: ${t}% dmg resist`);
    } else if (mr <= 50) {
      const t = Math.max(-50, mr - 50);
      mrEffective = t;
      tips[24].push(`Effective MR: ${t}% dmg resist!`);
    }
  }

  const dodgeLines = dodge > 0 ? dodgeSummary(dodge, cls) : [];
  if (dodgeLines.length) tips[8].push('', ...dodgeLines);

  let critEffective = crit;
  if (crit > 40) {
    if (g) { /* TODO GreaterMUD: "Crit Capped @ 65%" */ }
    else {
      critEffective = Math.min(99, 40 + fix((crit - 40) / 3));
      tips[7].push('', 'Diminishing Returns >40', `Effective Crit: ${critEffective}%`);
    }
  }
  if (g) { /* TODO GreaterMUD: spellcasting > 150 adds spell damage */ }

  // the tooltip slot for martial-arts labels 43..45 is cleared
  tips[43] = []; tips[44] = []; tips[45] = [];

  const effStats = {};
  MAIN_STATS.forEach((k, i) => { effStats[k] = eff(i); });
  const bonusStats = {}, statSources = {};
  MAIN_STATS.forEach((k, i) => { bonusStats[k] = bonus[i]; statSources[k] = sources[i]; });

  return {
    stats: st, tips, eff: effStats, bonus: bonusStats, statSources, encumPct,
    acInt: fix(st[2]), drInt: fix(st[3]),
    accyItems, accyAbils, accyOther, plusDodge, plusMR, hitMagicNonWeapon, attackAccyAdj,
    qnd, critEffective, mrEffective, dodgeSummary: dodgeLines, walkSeconds: walk,
    classStealth, raceStealth, weapon, slots, bless,
  };
}

// The short text MME shows for an ability on a slot's tooltip (GetAbilityStats stands in).
function abilityText(abil, val) {
  const names = { 2: 'AC', 3: 'Cold Res', 4: 'Max Dmg', 5: 'Fire Res', 7: 'DR', 10: 'AC(Blur)', 13: 'Illu',
    14: 'RoomIllu', 22: 'Accy', 24: 'ProtEvil', 25: 'ProtGood', 27: 'Stealth', 29: 'Punch', 30: 'Kick',
    34: 'Dodge', 35: 'JumpKick', 36: 'MR', 37: 'Picks', 40: 'Traps', 44: 'Int', 45: 'Wis', 46: 'Str', 47: 'Hea',
    48: 'Agi', 49: 'Cha', 58: 'Crits', 65: 'Stone Res', 66: 'Light Res', 67: 'Quickness', 69: 'Mana', 70: 'SC',
    72: 'Shock', 77: 'Percep', 88: 'HP', 89: 'Punch Accy', 90: 'Kick Accy', 91: 'JK Accy', 92: 'Punch Dmg',
    93: 'Kick Dmg', 94: 'JK Dmg', 96: 'Enc%', 105: 'Accy', 106: 'Accy', 116: 'BS Accy', 117: 'BS Min',
    118: 'BS Max', 123: 'HP Rgn', 142: 'Hit Magic', 145: 'Mana Rgn', 147: 'Water Res', 165: 'SpellDmg',
    179: 'Traps', 180: 'Picks' };
  return names[abil] ? `${names[abil]}: ${val}` : '';
}

// modMMudFunc.GetQuickAndDeadlyBonus
function quickAndDeadlyBonus(itemNum, c, eff, curEnc, maxEnc, opt) {
  const it = by.item.get(itemNum);
  if (!it || !opt.globalFilter || !(c.cls > 0)) return 0;
  if (it.StrReq > eff(0)) return 0;
  const combat = classCombat(c.cls);
  const enc = calcEncumbrancePercent(curEnc, maxEnc);
  const eu = calcEnergyUsedWithEncum(combat, c.level || 0, it.Speed, eff(3), eff(0), enc, it.StrReq);
  return calcQuickAndDeadlyBonus(eff(3), eu, enc);
}

// frmMain.SortInvenToolTips: each list sorted by its "(value)" descending.
export function sortStatTips(tips) {
  const val = s => {
    const a = s.lastIndexOf('('), b = s.lastIndexOf(')');
    if (a < 0 || b <= a) return 0;
    return parseFloat(s.slice(a + 1, b).split('/')[0]) || 0;
  };
  for (const t of tips) {
    if (t.length > 1) t.splice(0, t.length, ...t.map((s, i) => [s, i]).sort((x, y) => val(y[0]) - val(x[0]) || x[1] - y[1]).map(x => x[0]));
  }
}

// frmMain.InvenColorCodeStats: how a panel value is shown.
// Returns { text, cls: 'neg' | 'pos' | 'hi' | '' }.
export function statDisplay(i, v) {
  if (i < 4 || !v) return { text: String(v), cls: '' };
  if (v < 0) return { text: String(v), cls: 'neg' };
  if ([10, 19, 24, 12].includes(i)) return { text: String(v), cls: 'hi' };
  return { text: '+' + v, cls: 'pos' };
}

// ---------------------------------------------------------------- Character tab

// frmMain.RefreshHitPoints, RefreshMagic, RefreshMagicRes, RefreshPicklocks,
// RefreshCPs, given the panel from calcCharStats.
export function calcCharSummary(c, p) {
  const level = c.level || 0, cls = c.cls || 0;
  const e = p.eff;
  const out = {};

  out.restNormal = calcRestingRate(level, e.hea, p.stats[16]);
  out.restResting = calcRestingRate(level, e.hea, p.stats[16], true);

  const cr = by.cls.get(cls);
  if (cls > 0 && cr) {
    const nMin = cr.MinHits, nMax = cr.MinHits + cr.MaxHits;
    const hpMin = calcMaxHP(nMax - nMin, level, e.hea, nMin);
    const hpMax = calcMaxHP((nMax - nMin) * level, level, e.hea, nMin);
    out.hp = { min: hpMin, max: hpMax, bonus: p.stats[5], avg: cint((hpMin + hpMax) / 2) + p.stats[5] };
    out.hp.text = `HP: ${hpMin !== hpMax ? '~' : ''}${out.hp.avg}` + (hpMin !== hpMax ? ` (${hpMin}-${hpMax})` : '')
      + (p.stats[5] > 0 ? '+' + p.stats[5] : p.stats[5] < 0 ? String(p.stats[5]) : '');

    const mag = classMagery(cls), magLvl = classMageryLvl(cls);
    out.manaRegen = fix(calcManaRegen(level, e.int, e.wis, e.cha, magLvl, mag, p.stats[17], false));
    out.mediTicks = calcManaRegen(level, e.int, e.wis, e.cha, magLvl, mag, 0, true);
    const mana = calcMaxMana(level, magLvl);
    out.maxMana = { base: mana, bonus: p.stats[6], total: mana + p.stats[6] };
    const sc = calcSpellCasting(level, e.int, e.wis, e.cha, magLvl, mag);
    out.spellcasting = { base: sc, bonus: p.stats[9], total: sc + p.stats[9] };
    out.magery = mag;
  } else {
    out.hp = null;
  }
  out.mr = calcMR(e.int, e.wis, p.plusMR);
  const picks = calcPicklocks(level, e.agi, e.int, e.cha);
  out.picklocks = { base: picks, bonus: p.stats[22], total: picks + p.stats[22] };
  out.dodge = p.stats[8];
  out.cp = calcCPs(c);
  return out;
}

// frmMain.RefreshCPs: CP spent on base stats over the race minimums, and what's left.
export function calcCPs(c) {
  const g = engine.greater;
  const maxCost = g ? 9999 : 10;
  const race = by.race.get(c.race);
  const mins = race ? [race.mSTR, race.mINT, race.mWIL, race.mAGL, race.mHEA, race.mCHM] : [0, 0, 0, 0, 0, 0];
  const maxs = race ? [race.xSTR, race.xINT, race.xWIL, race.xAGL, race.xHEA, race.xCHM] : [0, 0, 0, 0, 0, 0];
  const perStat = MAIN_STATS.map((k, x) => {
    const used = Math.max(0, ((c.stats && c.stats[k]) || 0) - mins[x]);
    let cost = 0, per;
    for (per = 1; per <= fix(used / 10); per++) {
      if (per === maxCost) break;
      cost += 10 * per;
    }
    if (per === maxCost) cost += (used - 90) * per;
    else cost += (used % 10) * per;
    return cost;
  });
  const spent = perStat.reduce((a, b) => a + b, 0);
  if (!race && c.race) return { perStat, spent, available: null, levelReq: null, mins, maxs };
  const baseCP = raceCP(c.race);
  let levelReq = 1, have = baseCP;
  while (have < spent) { have += fix(levelReq / 10) * 5 + 10; levelReq++; }
  if ((c.level || 0) > 0) have = baseCP + calcCPLevel(c.level);
  return { perStat, spent, available: have - spent, levelReq, mins, maxs };
}

// ---------------------------------------------------------------- bless choices

// frmMain.LoadCharBless: spells offered in the bless dropdowns.
export function blessCandidates(c, { unfiltered = false, onlyInGame = true } = {}) {
  const out = [];
  for (const sp of by.spell.values()) {
    if (onlyInGame && sp['In Game'] === 0) continue;
    if (sp.Learnable === 1 || String(sp['Learned From'] || '').length > 0 || (sp.Magery === 5 && sp.ReqLevel > 0)) {
      if (![1, 2, 5, 13].includes(sp.Targets)) continue;
      if (sp.Dur === 0 && (sp.DurInc === 0 || sp.DurIncLVLs === 0)) continue;
    }
    if (!unfiltered && !spellUsableBy(sp, c.cls || 0, c.level || 0, c.alignment || 0, true)) continue;
    out.push(sp);
  }
  return out.sort((a, b) => a.Name.localeCompare(b.Name, undefined, { sensitivity: 'base' }));
}

// ---------------------------------------------------------------- EQ slot lists

// EQ slot an item naturally goes in (frmMain.InvenAddEquip); fingers and
// wrists fill both slots of the pair.
export function itemSlots(item) {
  if (!item) return [];
  if (item.ItemType === 1) return [16];
  if (item.ItemType !== 0) return [];
  const x = { 1: 19, 2: 0, 3: 8, 4: 9, 5: 13, 6: 5, 7: 3, 8: 2, 9: 12, 10: 11, 11: 4, 12: 15, 13: 10,
    14: 6, 15: 1, 16: 14, 18: 17, 19: 18 }[item.Worn];
  if (x == null) return [];
  if (x === 9 || x === 10) return [9, 10];
  if (x === 6 || x === 7) return [6, 7];
  return [x];
}


const comboOrder = new Intl.Collator('en', { sensitivity: 'base', ignorePunctuation: true });

// frmMain.LoadInvenItems / FilterInvenItems + InvenAddEquip: the items each
// EQ slot's dropdown offers, in the dropdown's (sorted) order. With the global
// filter on, only items this character can use. Equipped items are always listed.
export function eqSlotLists(c, { globalFilter = false, onlyInGame = true, slotOf = itemSlots } = {}) {
  const lists = Array.from({ length: 20 }, () => []);
  const add = it => { for (const x of slotOf(it)) if (!lists[x].includes(it.Number)) lists[x].push(it.Number); };
  for (const it of by.item.values()) {
    if (onlyInGame && it['In Game'] === 0) continue;
    if (it.ItemType > 1) continue;
    if (globalFilter && !itemUsableBy(it, c, { ignoreMinItemLevel: true })) continue;
    add(it);
  }
  (c.equipped || []).forEach((n, x) => { if (n > 0 && by.item.has(n) && !lists[x].includes(n)) lists[x].push(n); });
  const label = n => { const it = by.item.get(n); return `${it.Name} (${n})`; };
  for (const l of lists) l.sort((a, b) => comboOrder.compare(label(a), label(b)));
  return lists;
}

// ---------------------------------------------------------------- Find Best

// mnuFindBest menu: [group, label, {abils, field, acdr}] (frmMain.InvenFindBest).
export const FIND_BEST = [
  ['Armour', [['AC/DR Combo', { acdr: true }], ['AC', { field: 'ArmourClass' }], ['DR', { field: 'DamageResist' }],
    ['Dodge', { abils: [34] }], ['Prot. from Evil', { abils: [24] }], ['Prot. from Good', { abils: [25] }],
    ['VileWard', { abils: [1113], greater: true }]]],
  ['Attacking', [['Accuracy', { abils: [22, 105, 106], field: 'Accy' }], ['BS Accuracy', { abils: [116] }],
    ['BS Min', { abils: [117] }], ['BS Max', { abils: [118] }], ['Crits', { abils: [58] }],
    ['DamageShield', { abils: [72] }], ['Max Damage', { abils: [4] }]]],
  ['Mystic Attacks', [['JumpKick ACY', { abils: [91] }], ['JumpKick DMG', { abils: [94] }], ['Kick ACY', { abils: [90] }],
    ['Kick DMG', { abils: [93] }], ['Punch ACY', { abils: [89] }], ['Punch DMG', { abils: [92] }]]],
  ['Attributes', [['Agility', { abils: [48] }], ['Charm', { abils: [49] }], ['Health', { abils: [47] }],
    ['Intellect', { abils: [44] }], ['Strength', { abils: [46] }], ['Wisdom', { abils: [45] }]]],
  ['Resistances', [['All Elemental', { abils: [3, 5, 66, 65, 147] }], ['All Magic (MR)', { abils: [36] }],
    ['Cold', { abils: [3] }], ['Fire', { abils: [5] }], ['Lightning', { abils: [66] }], ['Stone', { abils: [65] }],
    ['Water', { abils: [147] }]]],
  ['Stats', [['Encumbrance', { abils: [96] }], ['HP', { abils: [88] }], ['HP Regen', { abils: [123] }],
    ['Illumination', { abils: [13, 14] }], ['Mana', { abils: [69] }], ['Mana Regen', { abils: [145] }],
    ['Perception', { abils: [77] }], ['Picklocks', { abils: [37, 180] }], ['Spellcasting', { abils: [70] }],
    ['Stealth', { abils: [27] }], ['Thievery', { abils: [39] }], ['Traps', { abils: [40, 41, 179] }]]],
];

// InvenFindBestItemValue (SUM of the criterion's abilities, plus a field)
export function findBestValue(it, crit) {
  if (crit.acdr) return it.ArmourClass + it.DamageResist;
  let t = 0;
  const abils = crit.abils || [];
  if (abils.length) for (let z = 0; z < 20; z++) { const a = it['Abil-' + z]; if (a > 0 && abils.includes(a)) t += it['AbilVal-' + z] || 0; }
  if (crit.field) t += it[crit.field] || 0;
  return t;
}

// frmMain.InvenFindBest. `lists` from eqSlotLists. state.excluded carries the
// items Next Best has already stepped past; pass the same state object back.
// Returns { equipped, found }.
export function findBest(equippedIn, lists, crit, { next = false, holds = [], noLimited = false,
  use2ndWrist = true, state = {} } = {}) {
  if (!engine.greater && (crit.abils || []).some(a => a >= 1000)) return { equipped: equippedIn.slice(), found: false };
  const eq = equippedIn.slice();
  const cache = new Map();
  const ev = n => {
    if (n < 1) return null;
    if (cache.has(n)) return cache.get(n);
    const it = by.item.get(n);
    const r = it ? { value: findBestValue(it, crit), enc: encRatio(it.Encum, it.ArmourClass, it.DamageResist),
      limited: it.Limit > 0, twoH: it.ItemType === 1 && (it.WeaponType === 1 || it.WeaponType === 3) } : null;
    cache.set(n, r);
    return r;
  };
  const last = new Array(20).fill(0);
  if (next) {
    state.excluded = state.excluded || new Set();
    eq.forEach((n, x) => { const r = ev(n); if (r) { last[x] = r.value; state.excluded.add(n); } });
  } else state.excluded = new Set();
  const best = Array.from({ length: 20 }, () => ({ value: 0, number: 0, enc: 0 }));
  const PAIR = { 6: 7, 7: 6, 9: 10, 10: 9 };
  const dupeOK = (slot, n) => {
    if (slot === 7 && !use2ndWrist) return false;
    const pair = PAIR[slot];
    if (pair == null) return true;
    if (best[pair].number === n) return false;
    if (eq[pair] === n && (pair < slot || holds[pair] || (pair === 7 && !use2ndWrist))) return false;
    return true;
  };
  let start = 0, no2H = false;
  for (;;) {
    for (let x = start; x < 20; x++) {
      if (!lists[x] || !lists[x].length || holds[x]) continue;
      for (const n of lists[x]) {
        const r = ev(n);
        if (!r) continue;
        if (noLimited && r.limited) continue;
        if (x === 16 && no2H && r.twoH) continue;
        if (r.value <= 0) continue;
        if (next && (r.value > last[x] || state.excluded.has(n))) continue;
        if ((r.value > best[x].value || (r.value === best[x].value && r.enc > best[x].enc)) && dupeOK(x, n)) {
          best[x] = { value: r.value, number: n, enc: r.enc };
        }
      }
      if (best[x].number > 0) {
        let prev = eq[x];
        eq[x] = best[x].number;
        last[x] = best[x].value;
        const pair = PAIR[x];
        if (pair > x && !holds[pair] && eq[pair] === best[x].number) {
          if (prev === best[x].number) prev = 0;
          eq[pair] = prev > 0 && lists[pair].includes(prev) ? prev : 0;
        }
      }
    }
    // a 2-handed weapon and an off-hand item can't both stay
    if (eq[15] > 0 && eq[16] > 0 && (best[15].number > 0 || best[16].number > 0)) {
      const w = ev(eq[16]);
      if (w && w.twoH) {
        const reset16 = () => { eq[16] = 0; best[16] = { value: 0, number: 0, enc: 0 }; no2H = true; start = 16; };
        if (!holds[15] && !holds[16]) {
          if (best[16].number > 0 && best[15].value >= best[16].value) { reset16(); continue; }
          eq[15] = 0;
        } else if (holds[15] && !holds[16]) {
          if (best[16].number > 0) { reset16(); continue; }
        } else if (!holds[15] && holds[16]) eq[15] = 0;
      }
    }
    break;
  }
  return { equipped: eq, found: best.some(b => b.number > 0) };
}

// frmMain.InvenCopytoClipboard(bEquipCommands): "rem" what was worn in game
// but is now replaced, then "eq" each item (off-hand and weapon last).
export function equipCommands(equipped, wornInGame) {
  const out = [];
  const name = n => (by.item.get(n) || {}).Name || `item ${n}`;
  if (wornInGame) {
    const was = i => wornInGame[i] || 0;
    for (const [slot, pair] of [[6, [6, 7]], [7, [6, 7]], [9, [9, 10]], [10, [9, 10]], [15, [15]], [16, [16]]]) {
      const n = was(slot);
      if (n > 0 && !pair.some(p => equipped[p] === n)) out.push('rem ' + name(n));
    }
  }
  for (let x = 0; x < 20; x++) if (x !== 15 && x !== 16 && equipped[x] > 0) out.push('eq ' + name(equipped[x]));
  for (const x of [15, 16]) if (equipped[x] > 0) out.push('eq ' + name(equipped[x]));
  return out.join('\r\n');
}

// ---------------------------------------------------------------- equip an item

// frmMain.InvenEquipItem's slot choice (EQ_SLOTS indices). Returns
// { slot } to equip into, { already: slot } when it's worn there already,
// or { nowhere: true } / {} when it can't be equipped.
export function equipSlotFor(equipped, item, { use2ndWrist = true } = {}) {
  if (typeof item === 'number') item = by.item.get(item);
  if (!item) return {};
  const n = item.Number, eq = equipped || [];
  if (item.ItemType === 1) return { slot: 16 };
  if (item.ItemType !== 0) return {};
  const pair = (a, b, second = true) => {
    if (eq[a] > 0) {
      if (eq[a] === n) return { already: a };
      if (eq[b] === n) return { already: b };
      return { slot: second ? b : a };
    }
    if (eq[b] > 0) return eq[b] === n ? { already: b } : { slot: a };
    return { slot: a };
  };
  switch (item.Worn) {
    case 0: return { nowhere: true };
    case 1: return { slot: 19 };
    case 2: return { slot: 0 };
    case 3: return { slot: 8 };
    case 4: case 13: return pair(9, 10);
    case 5: return { slot: 13 };
    case 6: return { slot: 5 };
    case 7: return { slot: 3 };
    case 8: return { slot: 2 };
    case 9: return { slot: 12 };
    case 10: return { slot: 11 };
    case 11: return { slot: 4 };
    case 12: return { slot: 15 };
    case 14: return pair(6, 7, use2ndWrist);
    case 15: return { slot: 1 };
    case 16: return { slot: 14 };
    case 18: return { slot: 17 };
    case 19: return { slot: 18 };
    default: return {};            // (Worn 17, the second wrist, isn't handled by MME either)
  }
}

// InvenEquipItem(nNum, , bUnequipIfEquipped): equip, or unequip when already worn.
// Mutates c.equipped; returns { slot, unequipped } or { error }.
export function equipItem(c, n, { use2ndWrist = true, toggle = true } = {}) {
  if (toggle) {
    const at = c.equipped.indexOf(n);
    if (at >= 0) { c.equipped[at] = 0; return { slot: at, unequipped: true }; }
  }
  const r = equipSlotFor(c.equipped, n, { use2ndWrist });
  if (r.nowhere) return { error: "Nowhere-worn items can't be equipped, but you can add them to the Item Manager and mark them carried to have their stats count." };
  if (r.already != null) return { slot: r.already };
  if (r.slot == null) return { error: "This item can't be equipped." };
  c.equipped[r.slot] = n;
  return { slot: r.slot };
}
