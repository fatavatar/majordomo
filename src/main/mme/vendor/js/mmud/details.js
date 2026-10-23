// Detail text and reference lists for the explorer tabs: ports of MME's
// PullItemDetail / PullSpellDetail / PullMonsterDetail / PullShopDetail /
// PullClassDetail / PullRaceDetail (modMain.bas) and the helpers they lean on
// (PullSpellEQ, GetAbilityStats, GetLocations, GetItemValue, the lair tables).
//
// Everything here is DOM-free. Text comes back as plain strings in MME's own
// wording, with cross-references embedded as markers (see ref()), so the VB
// string handling (AutoAppend, InStr, Replace) ports line for line. The UI
// turns markers into links; plain() strips them for tests and clipboard.
//
// MME's ListView "location" panes become arrays of rows:
//   { pct, head, text }   pct: number ('' when none), head: first column
//                         (two-column panes), text: may contain markers.

import { db, by, roomKey } from '../db.js';
import { engine } from './engine.js';
import {
  abilityName, monType, monAlignment, spellTargets, shopType, magery, classWeaponType,
  armourType, weaponType, wornType, itemType,
} from './enums.js';
import { spellUsableBy, spellAttackType } from './usable.js';
import { vbRound, fix, cur } from './vb.js';
import { getCurrentSpellMinMax, getMaxLevel } from './spellcalc.js';
import { calcCombatRounds } from './combat.js';

// ------------------------------------------------------------ combat hooks
//
// Phase 4 (combat math) and phase 7 (exp/hr) plug in here instead of editing
// the tabs. Each array holds Table column defs ({key, label, get, num, ...});
// the tabs append them after MME's database columns. The functions return
// extra detail text (or '' / null) and are called with the row and ctx.
export const hooks = {
  columns: { weapons: [], armour: [], spells: [], monsters: [] },
  weaponDamageText: null,     // (item, ctx) -> "Damage: .../round ..." block (PullItemDetail weapon damage)
  spellCast: null,            // (spell, castLevel, ctx) -> tSpellCastValues (CalculateSpellCast)
  monsterDamageRows: null,    // (monster, ctx) -> detail rows (PullMonsterDetail char_damage_out / scripting)
  // (lairInfo, ctx) -> { damage, mitigate } for GetLairInfo / GetLairAveragesFromLocs:
  //   damage   GetDamageOutput against the lair's averages ({averageDamage, firstRoundDamage,
  //            minRoundDamage, surpriseDamage, surpriseMinDamage, surpriseDamageChance}; < -9990 = none)
  //   mitigate true when the mobs' damage is taken vs the character / party (monsterDamageIn)
  lairDamageOut: null,
  monsterDamageIn: null,      // (monster #) -> GetPreCalculatedMonsterDamage: { damage, vs, calculated }
  monsterExtraRows: [],       // [(monster, ctx) -> detail rows], after monsterDamageRows' damageOut part (exp/hr scripting estimate)
};
// modMMudDatabase.LAIR_FLAG_RATIO: share of a lair's mobs that makes it count as undead/living/animal
export const LAIR_FLAG_RATIO = 0.9;

// ------------------------------------------------------------ VB helpers

// VB Round / Fix / Currency: one copy, in vb.js.
export { vbRound, fix, cur };
// modSyntaxsFunc.RoundUp
export const roundUp = n => (n - Math.floor(n) > 0 ? Math.floor(n) + 1 : Math.floor(n));
// modSyntaxsFunc.Truncate
export const truncate = (v, places = 2) => fix(v * 10 ** places) / 10 ** places;

// modSyntaxsFunc.AutoAppend / AutoPrepend
export function autoAppend(s, add, glue = ', ') {
  if (s.length > 0) return String(add).trim().length > 0 ? s + glue + add : s;
  return String(add);
}
export function autoPrepend(s, pre, glue = ', ') {
  if (s.length > 0) return String(pre).trim().length > 0 ? pre + glue + s : s;
  return String(pre);
}

// VB Str() of a number: no exponent, no trailing zeros.
const num = n => String(Number.isInteger(n) ? n : Number(n.toFixed(10)));
// Format(n, "#,#")
export const fmtComma = n => (Math.round(n) === 0 ? '' : Math.round(n).toLocaleString('en-US'));
// Format(n, "##,##0.00") with a trailing ".00" dropped
export function fmtMoney(n) {
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}
// PutCommas
const putCommas = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ExtractNumbersFromString (first number in a string)
function extractNumber(s) {
  const m = String(s).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

// ------------------------------------------------------------ ref markers

const R0 = '', R1 = '', R2 = '';
export const ref = (kind, n, text) => `${R0}${kind}:${n}${R1}${text}${R2}`;
const REF_RE = /([a-z]+):([^]*)([^]*)/g;
export const plain = s => String(s ?? '').replace(REF_RE, '$3');
// [{text}|{kind, n, text}] for the UI.
export function segments(s) {
  const out = [];
  let last = 0;
  s = String(s ?? '');
  for (const m of s.matchAll(REF_RE)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ kind: m[1], n: m[1] === 'room' || m[1] === 'tool' ? m[2] : Number(m[2]), text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

// ------------------------------------------------------------ names (GetXName)

export const opts = { hideNumbers: false };   // bHideRecordNumbers

const nm = (map, kind, none = 'None') => (n, noNumber = opts.hideNumbers) => {
  if (!n) return none;
  const r = map.get(Number(n));
  if (!r) return String(n);
  return ref(kind, n, noNumber ? r.Name : `${r.Name}(${n})`);
};
export const itemName = nm(by.item, 'item');
export const spellName = nm(by.spell, 'spell');
export const monsterName = nm(by.monster, 'monster');
export const shopName = nm(by.shop, 'shop');
// GetClassName / GetRaceName: no number suffix
export const className = n => (!n ? 'None' : by.cls.get(Number(n)) ? ref('class', n, by.cls.get(Number(n)).Name) : String(n));
export const raceName = n => (!n ? 'None' : by.race.get(Number(n)) ? ref('race', n, by.race.get(Number(n)).Name) : String(n));

// ExtractMapRoom
export function extractMapRoom(s) {
  const m = String(s).match(/(\d*)\/(\d+)/);
  if (!m) return { map: 0, room: 0 };
  return { map: Number(m[1]) || 0, room: Number(m[2]) || 0 };
}
// GetRoomName
export function roomName(mapRoom, noNumber = opts.hideNumbers) {
  const { map, room } = typeof mapRoom === 'string' ? extractMapRoom(mapRoom) : mapRoom;
  if (!map || !room) return '?';
  const r = by.room.get(roomKey(map, room));
  if (!r) return `${map}/${room}`;
  let s = r.Name || '(no name)';
  if (!noNumber) s += ` (${map}/${room})`;
  return ref('room', `${map}/${room}`, s);
}
// GetRoomRegen
export function roomRegen(mapRoom) {
  if (engine.nmrVersion < 1.83) return 0;
  const { map, room } = extractMapRoom(mapRoom);
  const r = by.room.get(roomKey(map, room));
  if (!r) return 0;
  let d = r.Delay || 0;
  if (engine.greater && d >= 1) d -= 0.5;
  return d;
}

const abilSlots = (row, n = 20) => {
  const out = [];
  for (let i = 0; i < n && ('Abil-' + i) in row; i++) out.push([row['Abil-' + i] || 0, row['AbilVal-' + i] || 0]);
  return out;
};
// SpellHasAbility / ItemHasAbility: the value, or -32768 when absent
export function hasAbil(row, abil, none = -32768) {
  if (!row) return none;
  for (const [a, v] of abilSlots(row)) if (a === abil) return v;
  return none;
}

// GetTextblockAction
export const textblockAction = n => (n ? (by.textblock.get(n) || {}).Action ?? 'none' : 'none');

// ------------------------------------------------------------ spells

// modMMudDatabase.GetMaxLevel. MME raises this past 255 when the average
// level-to-max-all-stats (ComputeAvgLevelMaxStats) is higher; stock data
// stays at 255.
export { getMaxLevel };

// modMMudDatabase.GetCurrentSpellMinMax (spellcalc.js) with this file's
// option names. `noHeader` is VB's ByRef flag: it stays set once set.
export function spellMinMax(sp, { useLevel = false, level = 0, noHeader = false, overrideMin = 0, overrideMax = 0, spellBonus = 0 } = {}) {
  const r = getCurrentSpellMinMax(sp, useLevel, level, { overrideMin, overrideMax, spellBonus });
  return { ...r, noHeader: noHeader || r.noHeader };
}

// VB globals PullSpellEQ uses to stop runaway nesting and to give the short
// list-column form.
let spellNest = 0;
let quickSpell = false;

// modMMudFunc.GetAbilityStats(nNum, nValue, lv, bCalcSpellLevel, bPercentColumn)
export function abilityStats(n, value = 0, lv = null, calcSpellLevel = true, pctCol = false, ctx = {}) {
  let out = abilityName(n);
  if (out === '') return '';

  if (n === 148 && value > 0) {   // execute textblock: show the spells it casts, if that's all it does
    const action = textblockAction(value);
    if (/cast /i.test(action)) {
      let casts = '', only = true;
      for (const part of action.split(':')) {
        if (part.slice(0, 5) === 'cast ') {
          casts = autoAppend(casts, pullSpellEQ(false, 0, Number(part.slice(5).match(/^\s*-?\d+/)?.[0] || 0), null, {}, ctx), ', ');
        } else { only = false; break; }
      }
      if (only && casts) return /\(click\)/i.test(casts) ? '(click)' : casts;
    }
  }

  if (value !== 0) {
    const head = value < 0 ? ' ' : ' +';
    switch (n) {
      case 7: out += head + num(value / 10); break;                                  // DR
      case 42: case 122: case 160: {                                                // learn/removes/givetemp spell
        const s = spellName(value);
        out += ` (${s})`;
        if (lv) lv.push({ pct: pctCol ? '' : undefined, head: '', text: 'Spell: ' + s });
        break;
      }
      case 43: case 153: case 151:                                                  // casts / killspell / endcast
        out += ` [${spellName(value)}, ${pullSpellEQ(calcSpellLevel, 0, value, lv, { pctCol, nested: true }, ctx)}]`;
        break;
      case 73: case 124: out += ` (${abilityName(value)})`; break;                  // dispell, negate ability
      case 59: out += ' ' + className(value); break;                                // class ok
      case 146: case 12: out += ' ' + monsterName(value); break;                    // guards, summon
      case 1: case 8: case 17: case 18: case 19: case 140: case 141: case 148:
        out += ' ' + value; break;                                                  // no "+" header
      case 178: break;                                                              // shadowform: message only
      case 185: case 1115: out += ' ' + itemName(value); break;
      default: out += head + value;
    }
  }
  return out;
}

const END_TWO = new Set([23, 51, 52, 80, 97, 98, 100, 108, 109, 110, 111, 112, 113, 119, 138, 144, 178]);
const NO_HEADER = new Set([1, 8, 17, 18, 19, 140, 141, 148]);

// modMMudDatabase.PullSpellEQ(bCalcLevel, nLevel, nSpell, lv, ...).
// o: { minMaxOnly, forMonster, pctCol, nested, noShowLevel, overrideMin, overrideMax, spellBonus }
// ctx: { useChar, level } (the global filter's character level)
export function pullSpellEQ(calcLevel, level, spellNum, lv = null, o = {}, ctx = {}) {
  spellNest++;
  try {
    if (!db.Spells.length) return '(No Spell Records)';
    if (spellNest > 19) return ' ... to infinity and beyond?';
    if (quickSpell && spellNest > 1) return '(click)';
    const sp = by.spell.get(spellNum);
    if (!sp) return '?';
    const pctCol = !!o.pctCol;

    let useLevel = calcLevel;
    level = level || 0;
    if (useLevel) {
      if (level === 0 && ctx.useChar) level = ctx.level || 0;
      if (!o.forMonster) {
        if (level > sp.Cap && sp.Cap > 0) level = sp.Cap;
        if (level < sp.ReqLevel) level = sp.ReqLevel;
      }
      if (level < 1) level = sp.ReqLevel;
      if (level === 0) useLevel = false;
    }

    let mm = spellMinMax(sp, { useLevel, level, overrideMin: o.overrideMin || 0, overrideMax: o.overrideMax || 0 });
    useLevel = mm.useLevel;
    const noHeader = mm.noHeader;
    const { nMin, nMax, nDur, sMin, sMax, sDur } = mm;
    let sMinB = '', sMaxB = '';
    if (o.spellBonus > 0) {
      const b = spellMinMax(sp, { useLevel, level, noHeader, overrideMin: o.overrideMin || 0, overrideMax: o.overrideMax || 0, spellBonus: o.spellBonus });
      sMinB = b.sMin; sMaxB = b.sMax;
    }

    let detail = '', removes = '', endCastPct = '', endOne = '', endTwo = '';
    let doesDamage = false, getsBonus = false, nonMagical = false;
    const slots = abilSlots(sp, 10);
    const teleMap = () => { let m = 0; for (const [a, v] of slots) if (a === 141) m = v; return m; };
    const lvAdd = text => { if (lv) lv.push({ pct: pctCol ? '' : undefined, head: '', text }); };

    for (const [abil, abilValue] of slots) {
      if (abil === 0) continue;
      if (abil === 144) nonMagical = true;
      getsBonus = false;
      switch (abil) {
        case 1: case 17: getsBonus = true; doesDamage = true; break;
        case 8: case 18: if (engine.greater) getsBonus = true; doesDamage = true; break;
        case 19: doesDamage = true; break;
      }
      if (o.minMaxOnly) break;
      let minHead = '', maxHead = '';

      if (abil === 122) {                       // RemoveSpell
        if (quickSpell) { if (removes === '') removes = 'click'; }
        else removes = autoAppend(removes, spellName(abilValue));
      } else if (abil === 137) {
        // shock: just the message
      } else if (abilValue === 0) {
        const range = sMin === sMax ? sMin : `${sMin} to ${sMax}`;
        switch (abil) {
          case 140: {                           // teleport room range
            detail = autoAppend(detail, abilityStats(abil, 0, lv, true, pctCol, ctx) + ' ' + range);
            const map = teleMap();
            if (lv && map > 0) for (let y = Number(sMin) || 0; y <= (Number(sMax) || 0); y++) lvAdd('Teleport: ' + roomName({ map, room: y }, false));
            break;
          }
          case 148:                             // textblock range
            detail = autoAppend(detail, abilityStats(abil, 0, lv, true, pctCol, ctx) + ' ' + range);
            if (lv) for (let y = Number(sMin) || 0; y <= (Number(sMax) || 0); y++) lvAdd('Execute: ' + ref('textblock', y, 'Textblock ' + y));
            break;
          case 164: endCastPct = `${abilValue}% `; break;
          case 151:                             // endcast (spell number range)
            if (quickSpell) {
              endOne = autoAppend(endOne, endCastPct + (nMax > nMin ? `End cast ${nMin} to ${nMax}` : `End cast ${nMin}`));
            } else if (nMin >= nMax) {
              endOne = autoAppend(endOne, `${endCastPct}EndCast [${spellName(nMin)}, ${pullSpellEQ(calcLevel, level, nMin, lv, { pctCol }, ctx)}]`);
            } else {
              let s = `${endCastPct}EndCast [{${spellName(nMin)}, ${pullSpellEQ(calcLevel, level, nMin, lv, { pctCol }, ctx)}}`;
              for (let y = nMin + 1; y <= nMax; y++) s += ` OR {${spellName(y)}, ${pullSpellEQ(calcLevel, level, y, lv, { pctCol }, ctx)}}`;
              endOne = autoAppend(endOne, s + ']');
            }
            break;
          case 12:                              // summon (monster number range)
            if (quickSpell) detail = autoAppend(detail, 'Summon');
            else if (nMin >= nMax) {
              const t = monsterName(nMin);
              detail = autoAppend(detail, 'Summon ' + t);
              lvAdd('Summon: ' + t);
            } else {
              let t = monsterName(nMin);
              detail = autoAppend(detail, 'Summons{' + t);
              lvAdd('Summon: ' + t);
              for (let y = nMin + 1; y <= nMax; y++) {
                t = monsterName(y);
                detail += ' OR ' + t;
                lvAdd('Summon: ' + t);
              }
              detail += '}';
            }
            break;
          case 7:                               // DR
            if (!noHeader) { if (Number(sMin) > 0) minHead = '+'; if (Number(sMax) > 0) maxHead = '+'; }
            if (useLevel) detail = autoAppend(detail, abilityStats(abil, 0, lv, true, pctCol, ctx) + ' '
              + (nMin === nMax ? minHead + num(nMin / 10) : `${minHead}${num(nMin / 10)} to ${maxHead}${num(nMax / 10)}`));
            else detail = autoAppend(detail, abilityStats(abil, 0, lv, true, pctCol, ctx) + ' '
              + (sMin === sMax ? minHead + sMin : `${minHead}${sMin} to ${maxHead}${sMax}`));
            break;
          default:
            if (END_TWO.has(abil)) { endTwo = autoAppend(endTwo, abilityStats(abil, 0, null, true, false, ctx)); break; }
            if (!noHeader && !NO_HEADER.has(abil)) { if (Number(sMin) > 0) minHead = '+'; if (Number(sMax) > 0) maxHead = '+'; }
            if (o.spellBonus > 0 && getsBonus) detail = autoAppend(detail, abilityStats(abil, 0, lv, calcLevel, pctCol, ctx) + ' '
              + (sMinB === sMaxB ? minHead + sMinB : `${minHead}${sMinB} to ${maxHead}${sMaxB}`));
            else detail = autoAppend(detail, abilityStats(abil, 0, lv, calcLevel, pctCol, ctx) + ' '
              + (sMin === sMax ? minHead + sMin : `${minHead}${sMin} to ${maxHead}${sMax}`));
        }
      } else {
        switch (abil) {
          case 148:
            detail = autoAppend(detail, abilityStats(abil, abilValue, lv, true, pctCol, ctx));
            lvAdd('Execute: ' + ref('textblock', abilValue, 'Textblock ' + abilValue));
            break;
          case 12:
            if (quickSpell) detail = autoAppend(detail, 'Summon');
            else {
              const t = monsterName(abilValue);
              detail = autoAppend(detail, 'Summon ' + t);
              lvAdd('Summon: ' + t);
            }
            break;
          case 140: {
            detail = autoAppend(detail, abilityStats(abil, abilValue, lv, true, pctCol, ctx));
            const map = teleMap();
            if (map > 0) lvAdd('Teleport: ' + roomName({ map, room: abilValue }, false));
            break;
          }
          case 164: endCastPct = `${abilValue}% `; break;
          case 151: endOne = autoAppend(endOne, endCastPct + abilityStats(abil, abilValue, lv, calcLevel, pctCol, ctx)); break;
          default:
            if (END_TWO.has(abil)) endTwo = autoAppend(endTwo, abilityStats(abil, abilValue, null, true, false, ctx));
            else detail = autoAppend(detail, abilityStats(abil, abilValue, lv, calcLevel, pctCol, ctx));
        }
      }
      if (detail.endsWith(', ')) detail = detail.slice(0, -2);
    }
    if (nonMagical) detail = detail.replace(/Damage\(-MR\)/gi, 'Damage');

    if (o.minMaxOnly) {
      if (!doesDamage) return '0:0:0';
      return (o.spellBonus > 0 && getsBonus ? `${sMinB}:${sMaxB}` : `${sMin}:${sMax}`) + (nDur > 0 ? ':' + sDur : '');
    }
    if (detail === '' && removes === '' && endOne === '' && endTwo === '') return '(No EQ)';

    let out = detail;
    if (endOne.length) out = autoAppend(out, endOne);
    if (!o.nested && sp.EnergyCost > 0 && sp.EnergyCost <= 500) {
      out += ' x' + fix(1000 / sp.EnergyCost) + (quickSpell ? '/rnd' : ' times/round');
    }
    if (endTwo.length) out = autoAppend(out, endTwo);
    const scales = (sp.MinInc !== 0 && sp.MinIncLVLs > 0) || (sp.MaxInc !== 0 && sp.MaxIncLVLs > 0) || (sp.DurInc !== 0 && sp.DurIncLVLs > 0);
    if (!o.noShowLevel && level > 0 && (useLevel || ((sp.Cap === 0 || sp.Cap > sp.ReqLevel) && scales))) {
      if (sp.Cap > 0 || sp.ReqLevel > 0) out = `(@lvl ${level}): ` + out;
    }
    if (sDur !== '0') {
      if (out !== '') out += ' ';
      out += `for ${sDur} rounds`;
    }
    if (quickSpell) return out;
    if (removes !== '') {
      if (out !== '') out += ' -- ';
      out += `RemovesSpells(${removes})`;
    }
    return out;
  } finally {
    spellNest--;
  }
}

// AddSpell2LV's "Detail" column: PullSpellEQ in bQuickSpell mode.
export function spellQuickDetail(sp, castLevel, minCast, maxCast) {
  quickSpell = true;
  try {
    return castLevel > 0
      ? pullSpellEQ(true, castLevel, sp.Number, null, { noShowLevel: true, overrideMin: minCast, overrideMax: maxCast })
      : pullSpellEQ(false, 0, sp.Number, null, { noShowLevel: true });
  } finally { quickSpell = false; }
}

// The character-free part of modMMudFunc.CalculateSpellCast: cast level,
// min/max/duration at that level, casts per round, "Min/Avg/Max Cast" and
// "LVL Increases" text. Damage after resists, cast chance and OOM need the
// character and belong to phase 4 (hooks.spellCast replaces this).
export function spellCastBasics(sp, castLvl = 0) {
  let lvlSpecified = false;
  if (castLvl <= 0) { if (castLvl < sp.Cap) castLvl = sp.Cap; }
  else lvlSpecified = true;
  if (castLvl < sp.ReqLevel) castLvl = sp.ReqLevel;
  if (castLvl > sp.Cap && sp.Cap > 0) castLvl = sp.Cap;
  const scales = (sp.MinInc !== 0 && sp.MinIncLVLs > 0) || (sp.MaxInc !== 0 && sp.MaxIncLVLs > 0) || (sp.DurInc !== 0 && sp.DurIncLVLs > 0);
  const showAtLevel = (sp.Cap === 0 || sp.Cap > sp.ReqLevel) && scales;
  const mm = spellMinMax(sp, { useLevel: castLvl > 0, level: castLvl });
  const dur = mm.nDur < 1 ? 1 : mm.nDur;
  const minCast = mm.nMin, maxCast = mm.nMax;
  const avg = vbRound((minCast + maxCast) / 2);
  const casts = sp.EnergyCost > 0 && sp.EnergyCost <= 500 ? fix(1000 / sp.EnergyCost) : 1;
  const r = { nCastLevel: castLvl, nRequiredLevel: sp.ReqLevel, nMinCast: minCast, nMaxCast: maxCast, nAvgCast: avg,
    nNumCasts: casts, nManaCost: sp.ManaCost * casts, nDuration: dur, sMMA: '', sLVLincreases: '', nCastChance: 0 };

  if (minCast > 0 && (minCast !== maxCast || maxCast !== avg)) {
    const lvlTxt = (!lvlSpecified || showAtLevel) && castLvl > 0 ? ` (@lvl ${castLvl})` : '';
    let s = `Min/Avg/Max Cast${lvlTxt}: ${minCast}/${avg}/${maxCast}`;
    if (casts > 1) s += ` x${casts}/round (${minCast * casts}/${avg * casts}/${maxCast * casts})`;
    r.sMMA = s;
  }
  if (showAtLevel) {
    let t = '', t2 = '', y = 0;
    const skip = new Set([23, 51, 52, 80, 97, 98, 100, 108, 109, 110, 111, 112, 113, 115, 119, 122, 138, 144, 151, 164, 178, 137]);
    for (const [a, v] of abilSlots(sp, 10)) {
      if (a <= 0 || skip.has(a)) continue;
      const s = abilityStats(a, 0, null, false);
      if (s.length) { y++; if (v === 0) t = autoAppend(t, s); else t2 = autoAppend(t2, s); }
    }
    if (t !== '') {
      if (t2 !== '') t += ` (not ${t2})`;
      t2 = '';
      const f = spellMinMax(sp, { useLevel: false });
      if (num(f.nDur) !== f.sDur) t2 = autoAppend(t2, 'Duration: ' + f.sDur);
      if (num(f.nMin) !== f.sMin) t2 = autoAppend(t2, 'Min: ' + f.sMin);
      if (num(f.nMax) !== f.sMax) t2 = autoAppend(t2, 'Max: ' + f.sMax);
      if (t2 !== '') r.sLVLincreases = 'LVL Increases: ' + t2 + (y > 1 ? ' for: ' + t : '');
    }
  }
  return r;
}

// modMMudDatabase.SpellDoesDamage
export function spellDoesDamage(n, notDuration = false, depth = 0) {
  const sp = by.spell.get(n);
  if (!sp || depth > 10) return false;
  if (notDuration) {
    if (sp.Dur > 0) return false;
    if (sp.DurIncLVLs > 0 && sp.DurInc > 0) return false;
  }
  let endCast = 0;
  for (const [a, v] of abilSlots(sp, 10)) {
    if (a === 1 || a === 8 || a === 17) return true;
    if (a === 151) endCast = v;
  }
  return endCast > 0 ? spellDoesDamage(endCast, false, depth + 1) : false;
}

// modMMudDatabase.SpellIsAreaAttack
export const spellIsAreaAttack = n => [9, 11, 12].includes((by.spell.get(n) || {}).Targets);

// ------------------------------------------------------------ prices

const COPPER = { 0: 1, 1: 10, 2: 100, 3: 10000, 4: 1000000 };

// Reduce copper to the largest coin MME shows it in (GetItemValue / PullShopDetail).
function reduceCoin(copper, { runic = 10000000, plat = 100000, gold = 1000, silver = 100 } = {}) {
  if (copper >= runic) return [vbRound(copper / 1000000, 2), 'Runic'];
  if (copper >= plat) return [vbRound(copper / 10000, 2), 'Platinum'];
  if (copper >= gold) return [vbRound(copper / 100, 2), 'Gold'];
  if (copper >= silver) return [vbRound(copper / 10, 2), 'Silver'];
  return [0, 'Copper'];
}

// GetItemValue(nItemNumber, nCharm, nMarkup, nShopNumber, bNObuy) -> tItemValue
export function itemValue(item, charm = 0, markup = 0, shopNumber = 0, noBuy = false) {
  if (typeof item === 'number') item = by.item.get(item);
  const out = { nBaseCost: 0, nBaseCoin: 0, nCopperBuy: 0, nCopperSell: 0, sFriendlyBuy: 'unknown', sFriendlyBuyShort: '',
    sFriendlySell: '', sFriendlySellShort: '', nMarkup: markup, nShopNumber: shopNumber };
  if (!item) return out;
  if (item.Price === 0) { out.sFriendlySell = '(no value)'; out.sFriendlyBuy = 'Free'; return out; }
  const base = item.Price;
  let buy = base * (COPPER[item.Currency] ?? 0);
  let sell = buy;
  if (engine.greater) { /* TODO GreaterMUD: ganghouse buy price (GMUD_GHOUSE_SHOP_MARKUP) */ }
  if (!noBuy) {
    if (shopNumber > 0) markup = (by.shop.get(shopNumber) || {})['Markup%'] || 0;
    if (markup > 0) buy = buy + fix(buy * (markup / 100));
  }
  if (charm > 0) {
    if (engine.greater) {
      // TODO GreaterMUD: verify. MME: sell/2, then +(Fix((charm-50)/5))%
      sell = sell / 2;
      sell = sell + (fix((charm - 50) / 5) * sell) / 100;
    } else {
      sell = (fix(charm / 2) + 25) * sell;
      while (sell > 4294967295) sell -= 4294967295;   // the game's overflow bug
      sell = fix(sell / 100);
    }
    const modBuy = 1 - (fix(charm / 5) - 10) / 100;
    if (!noBuy) {
      buy = modBuy * buy;
      while (buy > 4294967295) buy -= 4294967295;
    }
  }
  if (buy <= 0) buy = 0;
  if (sell <= 0) sell = 0;

  let rBuy, cBuy;
  if (buy >= 100) [rBuy, cBuy] = reduceCoin(buy);
  else { rBuy = vbRound(buy); cBuy = 'Copper'; }
  let rSell, cSell;
  if (sell >= 100) [rSell, cSell] = reduceCoin(sell);
  else { rSell = vbRound(sell); cSell = 'Copper'; }

  const friendly = (copper, reduced, coin) => {
    let s = fmtComma(copper) + ' Copper';
    if (reduced !== copper) s += ` (${fmtMoney(reduced)} ${coin})`;
    return s;
  };
  if (rSell === 0) { out.sFriendlySell = '(no value)'; out.sFriendlySellShort = '0'; }
  else { out.sFriendlySell = friendly(sell, rSell, cSell); out.sFriendlySellShort = vbRound(rSell) + cSell[0]; }
  if (!noBuy) {
    if (rBuy === 0) { out.sFriendlyBuy = '(no value)'; out.sFriendlyBuyShort = '0'; }
    else { out.sFriendlyBuy = friendly(buy, rBuy, cBuy); out.sFriendlyBuyShort = vbRound(rBuy) + cBuy[0]; }
  } else out.sFriendlyBuy = '';
  out.nBaseCost = base;
  out.nBaseCoin = item.Currency;
  out.nCopperBuy = vbRound(buy);
  out.nCopperSell = vbRound(sell);
  out.nMarkup = markup;
  return out;
}

// modItemParse.ExtractShopsFromObtainedFrom: "Shop #n" tokens; "(sell)" = sell-only.
export function itemShops(obtained) {
  const out = [];
  for (const part of String(obtained || '').split(',')) {
    const t = part.trim().replace(/\s+/g, ' ').toLowerCase();
    if (t.slice(0, 4) !== 'shop') continue;
    const m = t.match(/\d+/);
    const n = m ? Number(m[0]) : 0;
    if (n > 0) out.push({ shop: n, noBuy: t.includes('(sell)') });
  }
  return out;
}

// modItemParse.EvaluateBestPriceForHit: the Item Manager's Value and Shop
// cells. The cheapest buy (ties to the lower shop #), else the lowest-numbered
// sell-only shop. -> { shop, more, value, sellOnly, copperSell }
export function bestShopPrice(item, charm = 0) {
  if (typeof item === 'number') item = by.item.get(item);
  const out = { shop: 0, more: 0, value: '', sellOnly: false, copperSell: 0 };
  if (!item) return out;
  const shops = itemShops(item['Obtained From']);
  if (!shops.length) return out;
  out.more = shops.length - 1;
  let buyShop = 0, bestBuy = -1, sellShop = 0;
  for (const s of shops) {
    const v = itemValue(item, charm, 0, s.shop, s.noBuy);
    if (!s.noBuy && v.nCopperBuy > 0 && (!buyShop || v.nCopperBuy < bestBuy || (v.nCopperBuy === bestBuy && s.shop < buyShop))) {
      buyShop = s.shop; bestBuy = v.nCopperBuy;
    }
    if (v.nCopperSell > 0 && (!sellShop || s.shop < sellShop)) sellShop = s.shop;
  }
  if (buyShop) {
    const v = itemValue(item, charm, 0, buyShop, false);
    return { ...out, shop: buyShop, value: `${v.sFriendlyBuyShort} / ${v.sFriendlySellShort}`, copperSell: Math.max(0, v.nCopperSell) };
  }
  if (sellShop) {
    const v = itemValue(item, charm, 0, sellShop, true);
    return { ...out, shop: sellShop, value: '(sell) ' + v.sFriendlySellShort, sellOnly: true, copperSell: Math.max(0, v.nCopperSell) };
  }
  return out;
}

// modMMudFunc.CalcMoneyRequiredToTrain
export const moneyToTrain = (level, markup) => fix((level * 5) * (markup + 100) / 100) * 10;

// modMMudDatabase.GetItemShopRegenPCT
export function itemShopRegenPct(shopNum, itemNum) {
  const s = by.shop.get(shopNum);
  if (!s || itemNum < 1 || s.ShopType === 8) return 0;
  let pct = 0;
  for (let x = 0; x < 20; x++) {
    if (s['Item-' + x] === itemNum && s['Max-' + x] > 0) {
      if (s['Time-' + x] > 0 && s['%-' + x] > 0 && s['Amount-' + x] > 0) {
        pct += s['Amount-' + x] * (1440 / s['Time-' + x]) * (s['%-' + x] / 100);
      } else pct += 1;   // stock only: call it 1%
    }
  }
  if (pct > 99) pct = 99;
  return vbRound(pct, 2);
}

// PullShopDetail's charm label (lblCharmMod)
export function charmModText(charm, showSell, isTrainer) {
  if (!(charm > 0 || showSell)) return '';
  if (showSell && !isTrainer) return `${fix(charm / 2) + 25}% cost pre-markup`;
  const mod = 1 - (fix(charm / 5) - 10) / 100;
  const pct = vbRound(Math.abs(1 - mod) * 100, 4);
  if (mod > 1) return `${num(pct)}% Markup`;
  if (mod < 1) return `${num(pct)}% Discount`;
  return 'Retail Value';
}

// The regen column of PullShopDetail's stock list.
export function shopRegenText(shop, x) {
  const t = shop['Time-' + x], p = shop['%-' + x], a = shop['Amount-' + x];
  if (!(t > 0 && p > 0 && a > 0)) return 'no regen';
  let s = '', n = t;
  if (n >= 1440) { s += Math.floor(n / 1440) + 'd'; n -= Math.floor(n / 1440) * 1440; }
  if (n >= 60) { s += Math.floor(n / 60) + 'h'; n -= Math.floor(n / 60) * 60; }
  if (n > 0) s += n + 'm';
  return `${p}% for ${a} per ${s}`;
}

// PullShopDetail(nShopNum, ..., nCharm, bShowSell)
// -> { text, trainer, rows, charmMod, refs }
//    trainer rows: { level, cost, copper }; stock rows: { item, name, max, regen, cost, copper }
export function shopDetail(shop, charm = 0, showSell = false) {
  if (typeof shop === 'number') shop = by.shop.get(shop);
  if (!shop) return { text: 'Shop not found', rows: [], refs: [], trainer: false, charmMod: '' };
  const trainer = shop.ShopType === 8;
  const rows = [];
  if (trainer) {
    for (let x = shop.MinLVL; x <= shop.MaxLVL; x++) {
      let copper = moneyToTrain(x - 1, shop['Markup%']);
      if (copper < 0) copper = 0;
      copper = vbRound(copper);
      const [reduced, coin] = reduceCoin(copper, { runic: 10000000, plat: 100000, gold: 1000, silver: 100 });
      const cost = reduced === 0 ? (copper <= 0 ? 'Free' : fmtMoney(copper) + ' Copper')
        : `${fmtComma(copper)} copper (${fmtMoney(reduced)} ${coin})`;
      rows.push({ level: x, cost, copper });
    }
  } else {
    for (let x = 0; x < 20; x++) {
      const n = shop['Item-' + x];
      if (!n) continue;
      const v = itemValue(n, charm, shop['Markup%']);
      rows.push({ item: n, name: (by.item.get(n) || {}).Name ?? String(n), max: shop['Max-' + x], regen: shopRegenText(shop, x),
        cost: showSell ? v.sFriendlySell : v.sFriendlyBuy, copper: showSell ? v.nCopperSell : v.nCopperBuy });
    }
  }
  let text = `Levels: ${shop.MinLVL} to ${shop.MaxLVL} -- Markup: ${shop['Markup%']}%`;
  if (shop.ClassRest) text += ' -- Class: ' + className(shop.ClassRest);
  return { text, trainer, rows, charmMod: trainer ? '' : charmModText(charm, showSell, trainer), refs: getLocations(shop['Assigned To']) };
}

// ------------------------------------------------------------ GetLocations

const LOOK = ['room ', 'monster #', 'textblock #', 'textblock(rndm) #', 'item #', 'spell #', 'shop #', 'shop(sell) #',
  'shop(nogen) #', 'group(lair): ', 'group: ', 'npc #'];

export function lairRegex(nmr = engine.nmrVersion) {
  let s = 'Group\\(lair\\): (\\d+)\\/(\\d+)';
  if (nmr >= 1.83) s = '\\[([\\d\\-]+)\\]\\[(\\d+)\\]' + s;
  else if (nmr >= 1.82) s = '\\[(\\d+)\\]' + s;
  return s;
}

// Parse one lair reference. "[10-10-15][4]Group(lair): 1/1753"
// -> { groupIndex, maxRegen, room }
export function parseLair(s, nmr = engine.nmrVersion) {
  const m = String(s).match(new RegExp(lairRegex(nmr), 'i'));
  if (!m) return null;
  if (nmr >= 1.83) return { groupIndex: m[1], maxRegen: Number(m[2]), room: `${m[3]}/${m[4]}` };
  if (nmr >= 1.82) return { groupIndex: '0-0-0', maxRegen: Number(m[1]), room: `${m[2]}/${m[3]}` };
  return { groupIndex: '0-0-0', maxRegen: 0, room: `${m[1]}/${m[2]}` };
}
export function parseLairs(s, nmr = engine.nmrVersion) {
  const out = [];
  for (const m of String(s).matchAll(new RegExp(lairRegex(nmr), 'gi'))) out.push(parseLair(m[0], nmr));
  return out;
}

// modMain.GetLocations(sLoc, lv, ...). Returns the rows it would add.
// o: { header, aux, twoColumns, dontSort, pctCol, footer, limit, ctx }
export function getLocations(sLoc, o = {}, rows = []) {
  const header = o.header || '', footer = o.footer || '', aux = o.aux || 0, limit = o.limit || 0;
  const pctCol = !!o.pctCol, two = !!o.twoColumns;
  const ctx = o.ctx || {};
  const start = rows.length;
  let displayFooter = footer;
  let count = 0;
  sLoc = String(sLoc ?? '');
  if (sLoc.length < 5) return rows;
  const test = sLoc.toLowerCase();
  const add = (pct, head, text) => { const r = { pct: pctCol ? (pct > 0 ? pct : '') : undefined, head, text }; rows.push(r); return r; };

  outer:
  for (let z = 0; z < LOOK.length; z++) {
    const look = LOOK[z];
    let x = 0;
    for (;;) {
      if (limit > 0 && count > limit) break outer;
      const at = test.indexOf(look, x);
      if (at < 0) break;
      const y1 = at + look.length;
      const digits = test.slice(y1).match(/^[0-9/.]*/)[0];
      const next = test[y1 + digits.length];
      let sPercent = '';
      if (digits.length === 0) {
        if (test[y1] === '+') return rows;      // end-of-string marker
        x = y1; continue;
      }
      if (next === '+') return rows;
      if (next === '(') {
        const x2 = test.indexOf(')', y1 + digits.length);
        if (x2 >= 0) sPercent = ' ' + test.slice(y1 + digits.length, x2 + 1);
      }
      const nValue = z !== 0 ? Number.parseFloat(digits) || 0 : 0;
      let nPercent = 0;
      if (pctCol) {
        nPercent = extractNumber(sPercent);
        if (footer.includes('%)')) {
          const p2 = extractNumber(footer.slice(footer.indexOf('(')));
          if (p2 > 0) {
            displayFooter = footer.replace(`(${p2}%)`, '');
            nPercent = nPercent > 0 ? (nPercent * p2) / 100 : p2;
          }
        }
        nPercent = cur(nPercent);
        nPercent = nPercent > 1 ? vbRound(nPercent) : vbRound(nPercent, 2);
      }
      const counted = () => { if (limit > 0) count++; return limit > 0 && count > limit; };
      const simple = (label, kind, nameFn) => {
        if (counted()) return;
        const name = nameFn(nValue);
        if (pctCol) add(nPercent, '', label + header + name + displayFooter);
        else if (two) add(0, label + header, name + sPercent + displayFooter);
        else add(0, '', label + header + name + sPercent + displayFooter);
      };
      switch (z) {
        case 0: {   // room
          if (counted()) break;
          let loc = 'Room: ';
          if (header !== '') loc = header.includes(':') ? header : loc + header;
          // a shop's rooms link to the shop (nAuxValue as the row tag)
          const rn = aux > 0 && /^Shop/.test(header) ? ref('shop', aux, plain(roomName(digits))) : roomName(digits);
          if (pctCol) add(nPercent, '', loc + rn + displayFooter);
          else if (two) add(0, loc, rn + sPercent + displayFooter);
          else add(0, '', loc + rn + sPercent + displayFooter);
          break;
        }
        case 1: simple('Monster: ', 'monster', monsterName); break;
        case 2: case 3: {
          if (counted()) break;
          const tb = ref('textblock', nValue, String(nValue));
          if (pctCol) add(nPercent, '', 'Textblock ' + header + tb + displayFooter);
          else if (two) add(0, 'Textblock ' + header, tb + sPercent + displayFooter);
          else add(0, '', 'Textblock ' + header + tb + sPercent + displayFooter);
          break;
        }
        case 4: {
          if (counted()) break;
          const name = itemName(nValue);
          if (pctCol) add(nPercent, '', 'Item: ' + header + name + displayFooter);
          else if (two) add(0, 'Item: ' + header, name + sPercent + displayFooter);
          else add(0, '', 'Item: ' + header + name + sPercent + displayFooter);
          const it = by.item.get(nValue);
          if (it && it.ItemType === 8 && header === '' && footer === '') {     // ItemIsChest: where the chest comes from
            getLocations(it['Obtained From'], { ...o, header: '', aux: 0, dontSort: true, footer: ' -> ' + it.Name + sPercent, limit: limit - count }, rows);
          }
          break;
        }
        case 5: simple('Spell: ', 'spell', spellName); break;
        case 6: case 7: case 8: {   // shop / shop(sell) / shop(nogen)
          if (counted()) break;
          let shopValue = '';
          const sh = by.shop.get(nValue);
          if (nValue > 0 && aux > 0) {
            const v = itemValue(aux, ctx.useChar ? ctx.charm || 0 : 0, (sh || {})['Markup%'] || 0);
            if (z === 7) { if (v.nCopperSell > 0) shopValue = ' - Value: ' + v.sFriendlySellShort; }
            else if (v.nBaseCost > 0) shopValue = ` - Value: ${v.sFriendlyBuyShort}/${v.sFriendlySellShort}`;
          }
          const hdr = ['Shop: ', 'Shop (sell): ', 'Shop (nogen): '][z - 6];
          const loc = sh ? sh['Assigned To'] : String(nValue);
          const sub = { ...o, header: hdr, aux: nValue, twoColumns: false, footer: shopValue, limit: limit - count, dontSort: true };
          if (z === 6) {
            if (pctCol && aux > 0) {
              const p = itemShopRegenPct(nValue, aux);
              if (p > 0) {
                let t = String(loc).split(',').join(`(${p}%),`);
                if (!t.endsWith('%)')) t += `(${p}%)`;
                getLocations(t, sub, rows);
              } else getLocations(loc, sub, rows);
            } else getLocations(loc, { ...sub, pctCol: false }, rows);
          } else getLocations(loc, sub, rows);
          break;
        }
        case 9: {   // group (lair)
          let loc;
          let maxRegen = 0, spawnChance = 0, roomKeyStr = digits;
          let lairInfo = null;
          // the "[a-b-c][n]" prefix sits between the previous comma and here
          const before = test.lastIndexOf(',', at - 1);
          const chunk = sLoc.slice(before + 1, y1 + digits.length);
          const lair = parseLair(chunk);
          if (lair) {
            maxRegen = lair.maxRegen; roomKeyStr = lair.room;
            if (engine.nmrVersion >= 1.83) {
              lairInfo = lairInfoFor(lair.groupIndex, maxRegen, ctx);
              if (lairInfo.nMobs > 0) spawnChance = cur(vbRound(1 - (1 - 1 / lairInfo.nMobs) ** maxRegen, 2) * 100);
            }
          }
          if (spawnChance > 0) loc = `Lair ${maxRegen} (${num(vbRound(spawnChance, 2))}%)`;
          else if (maxRegen > 0) loc = `Lair ${maxRegen}`;
          else loc = 'Lair';
          const regen = roomRegen(roomKeyStr);
          if (regen > 0) loc += ` - ${num(regen)}m`;
          const rn = roomName(roomKeyStr);
          if (pctCol) add(nPercent, '', loc + rn + displayFooter);
          else if (two) {
            let t = rn + sPercent + displayFooter;
            if (lairInfo && lairInfo.nAvgExp > 0) t += ', Exp: ' + fmtComma(lairInfo.nAvgExp * lairInfo.nMaxRegen);
            if (lairInfo && lairInfo.nAvgDmgLair > 0) t += ', Dmg In: ' + vbRound(lairInfo.nAvgDmgLair);
            add(0, loc, t);
          } else add(0, '', loc.trim() + ': ' + rn + sPercent + displayFooter);
          break;
        }
        case 10: {  // group
          if (counted()) break;
          const rn = roomName(digits);
          if (pctCol) add(nPercent, '', 'Group: ' + rn + displayFooter);
          else if (two) add(0, 'Group: ', rn + sPercent + displayFooter);
          else add(0, '', 'Group ' + rn + sPercent + displayFooter);
          break;
        }
        case 11: simple('NPC: ', 'monster', monsterName); break;
      }
      x = y1;
    }
  }

  const mine = rows.length - start;
  if (mine > 1 && !o.dontSort && !pctCol) {
    const part = rows.splice(start).sort((a, b) => plain(a.head + a.text).localeCompare(plain(b.head + b.text)));
    rows.push(...part);
  }
  if (rows.length > 1) {
    if (sLoc.endsWith('+\u0000') || sLoc.endsWith('+')) {
      if (footer === '') add(0, '', '... plus more.');
    } else if (limit > 0 && count >= limit && header === '' && footer === '') {
      add(0, '', `... plus ${count - limit} more.`);
    }
  }
  return rows;
}

// Sort an item's location rows like LV_RefreshSort on the % column (largest
// first), or shops first when "Show shops first in item references" is on.
export function sortItemRefs(rows, shopsFirst = false) {
  const isShop = r => /^Shop/.test(plain(r.text));
  return rows.slice().sort((a, b) => {
    if (shopsFirst && isShop(a) !== isShop(b)) return isShop(a) ? -1 : 1;
    return (Number(b.pct) || 0) - (Number(a.pct) || 0);
  });
}

// ------------------------------------------------------------ lairs

let lairTable = null;   // GroupIndex -> colLairs entry (LoadLairInfo)
let possy = null;       // monster -> { possy, spawnChance } (CalculateAverageLairs)

const bump = (m, k, d = 1) => { if (d) m.set(k, (m.get(k) || 0) + d); };
// DICT_ModeFromCounts: most common key, higher key on ties
function modeOf(m, dflt = 0) {
  let best = dflt, bestCount = -1;
  for (const [k, c] of m) {
    if (c > bestCount) { bestCount = c; best = k; }
    else if (c === bestCount && k > best) best = k;
  }
  return best;
}
const MAJ_THRESH_PCT = 51;

// The melee accuracy spread of one monster's attacks: [[acc, pct], ...], max acc.
function meleeAccuracies(mon) {
  const uniq = new Map();
  let prevCum = 0, maxAcc = 0, total = 0;
  for (let i = 0; i < 5; i++) {
    const t = mon['AttType-' + i];
    if (!(t > 0 && t <= 3)) continue;
    let pct;
    if (engine.nmrVersion >= 1.8) pct = vbRound(mon['AttTrue%-' + i] || 0);
    else { const cur = mon['Att%-' + i] || 0; pct = cur - prevCum; prevCum = cur; }
    if (pct < 0) pct = 0;
    if (t === 1 || t === 3) {
      const acc = mon['AttAcc-' + i];
      bump(uniq, acc, pct);
      if (!uniq.has(acc)) uniq.set(acc, 0);
      total += pct;
      if (acc > maxAcc) maxAcc = acc;
    }
  }
  return { uniq, maxAcc, total };
}

// modMMudDatabase.LoadLairInfo
export function loadLairInfo() {
  lairTable = new Map();
  for (const l of db.Lairs) {
    const info = {
      sGroupIndex: l.GroupIndex, sMobList: String(l.MobList ?? ''), nMobs: l.Mobs,
      nAvgDelay: engine.greater ? l.AvgDelay - 0.5 : l.AvgDelay,
      nAvgExp: l.AvgExp, nAvgDmg: l.AvgDmg, nAvgHP: l.AvgHP, nAvgAC: l.AvgAC, nAvgDR: l.AvgDR, nAvgMR: l.AvgMR,
      nAvgDodge: l.AvgDodge, nAvgWalk: l.AvgWalk, nTotalLairs: l.TotalLairs,
      nNumUndeads: 0, nNumAntiMagic: 0, nNumAnimals: 0, nNumLiving: 0, nMagicLVL: 0, nMaxMagicLVL: 0,
      nSpellImmuLVL: 0, nMaxSpellImmuLVL: 0, nAvgBSDefense: 0, nAvgRCOL: 0, nAvgRFIR: 0, nAvgRSTO: 0, nAvgRLIT: 0,
      nAvgRWAT: 0, nAccyMajority: 0, nAccyMax: 0,
    };
    if (info.nMobs > 0 && db.Monsters.length) {
      const accPct = new Map(), magic = new Map(), immu = new Map();
      let meleeTotal = 0, maxAccLair = 0, bs = 0;
      const res = { 3: 0, 5: 0, 65: 0, 66: 0, 147: 0 };
      for (const s of info.sMobList.split(',')) {
        const mon = by.monster.get(Number(s));
        if (!mon) continue;
        if (mon.Undead === 1) info.nNumUndeads++;
        bs += mon.BSDefense || 0;
        let hadMag = false, hadImm = false, living = true, animal = false;
        for (const [a, v] of abilSlots(mon, 10)) {
          if (!a) continue;
          if (a in res) res[a] += v;
          else if (a === 28) { hadMag = true; bump(magic, v); if (v > info.nMaxMagicLVL) info.nMaxMagicLVL = v; }
          else if (a === 51) info.nNumAntiMagic++;
          else if (a === 78) animal = true;
          else if (a === 109) living = false;
          else if (a === 139) { hadImm = true; bump(immu, v); if (v > info.nMaxSpellImmuLVL) info.nMaxSpellImmuLVL = v; }
        }
        if (animal) info.nNumAnimals++;
        if (living) info.nNumLiving++;
        if (!hadMag) bump(magic, 0);
        if (!hadImm) bump(immu, 0);
        const { uniq, maxAcc } = meleeAccuracies(mon);
        let sum = 0;
        for (const [acc, pct] of uniq) if (pct > 0) { bump(accPct, acc, pct); sum += pct; }
        meleeTotal += sum;
        if (maxAcc > maxAccLair) maxAccLair = maxAcc;
      }
      info.nMagicLVL = magic.size ? modeOf(magic) : 0;
      info.nSpellImmuLVL = immu.size ? modeOf(immu) : 0;
      const idiv = v => (v !== 0 ? Math.trunc(v / info.nMobs) : 0);
      info.nAvgBSDefense = idiv(bs);
      info.nAvgRCOL = idiv(res[3]); info.nAvgRFIR = idiv(res[5]); info.nAvgRSTO = idiv(res[65]);
      info.nAvgRLIT = idiv(res[66]); info.nAvgRWAT = idiv(res[147]);
      info.nAccyMajority = accPct.size ? modeOf(accPct) : 0;
      info.nAccyMax = maxAccLair;
    }
    lairTable.set(info.sGroupIndex, info);
  }
  return lairTable;
}

// modMMudDatabase.GetLairInfo(sGroupIndex, nMaxRegen). The character's (or
// party's) damage output comes from hooks.lairDamageOut; without it, as when
// GetDamageOutput works nothing out, the lair counts as one-shot.
export function lairInfoFor(groupIndex, maxRegen = 0, ctx = {}) {
  if (!lairTable) loadLairInfo();
  const blank = { sGroupIndex: '', nMobs: 0, nMaxRegen: 0, nAvgDmgLair: 0, nRTK: 0, nRTC: 0, nDamageMitigated: 0, nTotalLairs: 0, sMobList: '' };
  if (String(groupIndex).length < 5) return blank;
  const base = lairTable.get(groupIndex) || { ...blank, sGroupIndex: groupIndex };
  const info = { ...base, nMaxRegen: maxRegen, nRTK: 1, nRTC: maxRegen, nDamageMitigated: 0, nDamageOut: 0,
    nFirstRoundDamageOut: 0, nMinRoundDamageOut: 0, nSurpriseDamageOut: 0, nSurpriseMinDamageOut: 0, nSurpriseChance: 0 };
  if (!info.sMobList.length) return info;
  const lairDamageOut = ctx.lairDamageOut || hooks.lairDamageOut;   // a caller (exp/hr) may supply its own
  const out = lairDamageOut ? lairDamageOut(info, ctx) : null;
  const d = out && out.damage;
  let damageOut = -9999, firstRound = -9999, surprise = -9999;
  if (d && (d.averageDamage > -9999 || d.surpriseDamage > -9999)) {
    damageOut = d.averageDamage; firstRound = d.firstRoundDamage; surprise = d.surpriseDamage;
    if (d.averageDamage > -9990) {
      info.nDamageOut = d.averageDamage; info.nFirstRoundDamageOut = d.firstRoundDamage; info.nMinRoundDamageOut = d.minRoundDamage;
    }
    if (d.surpriseDamage > -9990) {
      info.nSurpriseDamageOut = d.surpriseDamage; info.nSurpriseChance = d.surpriseDamageChance; info.nSurpriseMinDamageOut = d.surpriseMinDamage;
    }
  } else damageOut = 9999999;
  if (damageOut <= -9990) damageOut = 0;
  if (firstRound <= -9990) firstRound = 0;
  if (surprise <= -9990) surprise = 0;

  if (out && out.mitigate && hooks.monsterDamageIn) {
    const mobs = info.sMobList.split(',');
    let t = 0;
    for (const m of mobs) t += hooks.monsterDamageIn(vbVal(m)).damage;
    info.nDamageMitigated = vbRound(t / mobs.length, 1);
  }
  if (out && out.mitigate && info.nAvgDmg > 0 && info.nDamageMitigated !== info.nAvgDmg) {
    info.nDamageMitigated = info.nAvgDmg - info.nDamageMitigated;
    info.nAvgDmg -= info.nDamageMitigated;
  } else info.nDamageMitigated = 0;
  info.nAvgDmgLair = info.nAvgDmg;

  let rtk;
  if (damageOut + surprise > 0) {
    rtk = calcCombatRounds({ damageOut, mobHealth: info.nAvgHP, mobDamage: info.nAvgDmgLair, numMobs: 1,
      surpriseDamageOut: surprise, firstRoundDamageOut: firstRound }).nRTK;
    if (rtk > 0 && rtk < 1) rtk = 1;
    info.nRTK = rtk;
    if (rtk > 1) info.nAvgDmgLair = vbRound(info.nAvgDmgLair * rtk, 1);
  } else { rtk = 0; info.nRTK = 0; }
  if (info.nMaxRegen > 1 && info.nAvgDmgLair > 0) {
    // more mobs than rounds: fewer of them are alive as the rounds go on
    const avgAlive = (info.nMaxRegen + 1) / (2 * info.nMaxRegen);
    info.nAvgDmgLair = vbRound(info.nAvgDmgLair / avgAlive, 1);
  }
  info.nRTC = damageOut + surprise > 0 ? (info.nMaxRegen > 1 ? rtk * info.nMaxRegen : rtk) : 0;
  return info;
}
const vbVal = v => Number(String(v).trim().match(/^-?\d+/)?.[0] || 0);

// RemoveOutliers + CalcAverageNonZero (for the lair walk distance)
function median(a) {
  const t = a.slice().sort((x, y) => x - y);
  const n = t.length;
  if (n < 1) return 0;
  return n % 2 ? t[(n - 1) / 2] : (t[n / 2 - 1] + t[n / 2]) / 2;
}
export function removeOutliers(a) {
  if (!a.length) return a;
  const med = median(a);
  let mad = median(a.map(v => Math.abs(v - med)));
  if (mad === 0) {
    const n = a.length;
    if (n < 2) mad = 0;
    else { const mean = a.reduce((s, v) => s + v, 0) / n; mad = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)); }
  }
  const kept = a.filter(v => Math.abs(v - med) <= 3 * mad);
  return kept.length ? kept : a;
}
const avgNonZero = a => { const nz = a.filter(v => v !== 0); return nz.length ? nz.reduce((s, v) => s + v, 0) / nz.length : 0; };

// modMMudDatabase.GetLairAveragesFromLocs(sLoc)
export function lairAverages(summonedBy, ctx = {}) {
  const out = { nPossSpawns: (String(summonedBy).match(/Group:/g) || []).length, nTotalLairs: 0, nMaxRegen: 0, nMobs: 0, sMobList: '' };
  if (engine.nmrVersion < 1.83) return out;
  const lairs = parseLairs(summonedBy);
  const n = lairs.length;
  if (!n) return out;
  const t = { mobs: 0, exp: 0, hp: 0, dmg: 0, dmgLair: 0, rtc: 0, rtk: 0, ac: 0, dr: 0, mr: 0, dodge: 0, bs: 0, out: 0, mit: 0,
    rcol: 0, rfir: 0, rsto: 0, rlit: 0, rwat: 0, und: 0, am: 0, ani: 0, liv: 0, regen: 0, delay: 0,
    first: 0, min: 0, sur: 0, surChance: 0, surMin: 0 };
  const walk = new Array(n).fill(0), mag = new Map(), imm = new Map(), accMaj = new Map();
  let maxMag = 0, maxImm = 0, accMax = 0, mobList = '';
  lairs.forEach((l, i) => {
    if (!(l.maxRegen > 0)) return;
    const li = lairInfoFor(l.groupIndex, l.maxRegen, ctx);
    if (!(li.nMobs > 0)) return;
    if (li.nAccyMax > accMax) accMax = li.nAccyMax;
    if (li.nAccyMajority > 0) bump(accMaj, li.nAccyMajority);
    t.mobs += li.nMobs; t.exp += li.nAvgExp * li.nMaxRegen; t.hp += li.nAvgHP * li.nMaxRegen;
    t.dmg += li.nAvgDmg; t.dmgLair += li.nAvgDmgLair; t.rtc += li.nRTC; t.rtk += li.nRTK;
    t.ac += li.nAvgAC; t.dr += li.nAvgDR; t.mr += li.nAvgMR; t.dodge += li.nAvgDodge; t.bs += li.nAvgBSDefense;
    t.rcol += li.nAvgRCOL; t.rfir += li.nAvgRFIR; t.rsto += li.nAvgRSTO; t.rlit += li.nAvgRLIT; t.rwat += li.nAvgRWAT;
    t.out += li.nDamageOut || 0; t.mit += li.nDamageMitigated;
    t.first += li.nFirstRoundDamageOut || 0; t.min += li.nMinRoundDamageOut || 0; t.sur += li.nSurpriseDamageOut || 0;
    t.surChance += li.nSurpriseChance || 0; t.surMin += li.nSurpriseMinDamageOut || 0;
    bump(mag, li.nMagicLVL); bump(imm, li.nSpellImmuLVL);
    if (li.nMaxMagicLVL > maxMag) maxMag = li.nMaxMagicLVL;
    if (li.nMaxSpellImmuLVL > maxImm) maxImm = li.nMaxSpellImmuLVL;
    t.und += li.nNumUndeads; t.am += li.nNumAntiMagic; t.ani += li.nNumAnimals; t.liv += li.nNumLiving;
    t.regen += li.nMaxRegen; t.delay += li.nAvgDelay; walk[i] = li.nAvgWalk;
    mobList = autoAppend(mobList, li.sMobList, ',');
  });
  Object.assign(out, {
    nAvgDmg: vbRound(t.dmg / n), nAvgDmgLair: vbRound(t.dmgLair / n), nRTC: vbRound(t.rtc / n, 1), nRTK: vbRound(t.rtk / n, 1),
    nAvgExp: vbRound(t.exp / n), nAvgHP: vbRound(t.hp / n), nAvgAC: vbRound(t.ac / n), nAvgDR: vbRound(t.dr / n),
    nAvgMR: vbRound(t.mr / n), nAvgRCOL: vbRound(t.rcol / n), nAvgRFIR: vbRound(t.rfir / n), nAvgRSTO: vbRound(t.rsto / n),
    nAvgRLIT: vbRound(t.rlit / n), nAvgRWAT: vbRound(t.rwat / n), nAvgDodge: vbRound(t.dodge / n),
    nAvgBSDefense: vbRound(t.bs / n), nDamageMitigated: vbRound(t.mit / n), nMobs: t.mobs / n,
    nMaxRegen: vbRound(t.regen / n, 1), nAvgDelay: vbRound(t.delay / n, 1), nDamageOut: vbRound(t.out / n),
    nFirstRoundDamageOut: vbRound(t.first / n), nMinRoundDamageOut: vbRound(t.min / n),
    nSurpriseDamageOut: vbRound(t.sur / n), nSurpriseChance: vbRound(t.surChance / n), nSurpriseMinDamageOut: vbRound(t.surMin / n),
  });
  let maj = 0;
  if (accMaj.size) {
    const dom = modeOf(accMaj);
    const denom = [...accMaj.values()].reduce((s, v) => s + v, 0);
    if (accMaj.get(dom) * 100 >= MAJ_THRESH_PCT * denom) maj = dom;
  }
  out.nAccyMajority = maj;
  out.nAccyMax = accMax;
  out.nMagicLVL = mag.size ? modeOf(mag) : 0;
  out.nMaxMagicLVL = maxMag;
  out.nSpellImmuLVL = imm.size ? modeOf(imm) : 0;
  out.nMaxSpellImmuLVL = maxImm;
  out.nNumUndeads = roundUp(t.und / n); out.nNumAntiMagic = roundUp(t.am / n);
  out.nNumAnimals = roundUp(t.ani / n); out.nNumLiving = roundUp(t.liv / n);
  out.nAvgWalk = vbRound(avgNonZero(removeOutliers(walk)), 1);
  out.nTotalLairs = n;
  if (out.nMaxRegen < 1) out.nMaxRegen = 1;
  out.nPossSpawns += n;
  out.sGroupIndex = summonedBy;
  out.sMobList = [...new Set(mobList.split(',').filter(Boolean))].join(',');   // RemoveDuplicateNumbersFromString
  if (hooks.lairDamageOut && (out.nSpellImmuLVL > 0 || out.nMagicLVL > 0 || out.nNumUndeads > 0 || out.nNumAntiMagic > 0
    || out.nNumLiving > 0 || out.nNumAnimals > 0)) {
    // immune to the attack against the averaged defences: no damage out
    const d = (hooks.lairDamageOut(out, ctx, { averages: true }) || {}).damage;
    if (d && d.averageDamage === -9998) { out.nDamageOut = 0; out.nFirstRoundDamageOut = 0; out.nMinRoundDamageOut = 0; }
    if (d && d.surpriseDamage === -9998) { out.nSurpriseDamageOut = 0; out.nSurpriseMinDamageOut = 0; out.nSurpriseChance = 0; }
  }
  return out;
}

// modMMudDatabase.CalculateAverageLairs -> nMonsterPossy / nMonsterSpawnChance
export function monsterPossy(n) {
  if (!possy) {
    possy = new Map();
    for (const m of db.Monsters) {
      const sb = m['Summoned By'];
      if (!sb || !/\(lair\)/i.test(sb)) continue;
      const lairs = parseLairs(sb);
      if (!lairs.length) continue;
      let mobs = 0, chance = 0;
      for (const l of lairs) {
        let regen = l.maxRegen;
        if (engine.nmrVersion >= 1.83) {
          if (regen > 0) {
            const li = lairInfoFor(l.groupIndex, regen);
            if (li.nMobs > 0) chance += vbRound(1 - (1 - 1 / li.nMobs) ** regen, 2);
          }
        } else if (engine.nmrVersion < 1.82) regen = 1;
        mobs += regen;
      }
      possy.set(m.Number, {
        possy: mobs > 0 ? vbRound(mobs / lairs.length, 1) : 0,
        spawnChance: engine.nmrVersion >= 1.83 ? vbRound(chance / lairs.length, 2) : 0,
      });
    }
  }
  return possy.get(n) || { possy: 0, spawnChance: 0 };
}
export function resetCaches() { lairTable = null; possy = null; }

// ------------------------------------------------------------ monsters

// modMMudDatabase.GetMonsterAttackSummary(nNum, bGetSpellAttackTypes, bGetSpellSpecialAttacks)
export function monsterAttackSummary(mon, spellTypes = false, specials = false) {
  if (typeof mon === 'number') mon = by.monster.get(mon);
  const r = { nAccMajority: 0, nAccMax: 0, bAtkPoison: false, bAtkFear: false, bAtkConfusion: false, sSpellAttackTypes: '', sSpellExtraTypes: '' };
  if (!mon) return r;
  const special = n => {
    if (!n) return;
    const sp = by.spell.get(n);
    if (!sp) return;
    if (hasAbil(sp, 60) >= 0) r.bAtkFear = true;
    if (hasAbil(sp, 19) >= 0) r.bAtkPoison = true;
    if (hasAbil(sp, 71) >= 0) r.bAtkConfusion = true;
  };
  const typeLetter = n => spellAttackType((by.spell.get(n) || {}).AttType ?? 0, true);
  if (specials && mon.DeathSpell > 0) special(mon.DeathSpell);
  let types = '', extra = '';
  if (spellTypes || specials) {
    let pct = 0;
    for (let x = 0; x < 5; x++) {
      const s = mon['MidSpell-' + x];
      if (!s) continue;
      pct = mon['MidSpell%-' + x] - pct;
      if (pct > 0) {
        if (spellTypes && spellDoesDamage(s, true)) extra += typeLetter(s);
        if (specials) special(s);
      }
      if (pct < 0) pct = 0;
    }
  }
  const uniq = new Map();
  let prevCum = 0, meleeTotal = 0, maxAcc = 0;
  for (let x = 0; x < 5; x++) {
    const t = mon['AttType-' + x];
    if (!(t > 0 && t <= 3 && mon['Att%-' + x] > 0)) continue;
    let pct;
    if (engine.nmrVersion >= 1.8) pct = vbRound(mon['AttTrue%-' + x] || 0);
    else { const cur = mon['Att%-' + x]; pct = cur - prevCum; prevCum = cur; }
    if (pct < 0) pct = 0;
    if (t === 1 || t === 3) {
      const acc = mon['AttAcc-' + x];
      uniq.set(acc, (uniq.get(acc) || 0) + pct);
      meleeTotal += pct;
      if (acc > maxAcc) maxAcc = acc;
      if (specials) special(mon['AttHitSpell-' + x]);
    } else if (t === 2) {
      if (spellTypes) types += typeLetter(mon['AttAcc-' + x]);
      if (specials) { special(mon['AttAcc-' + x]); special(mon['AttHitSpell-' + x]); }
    }
    if (spellTypes && mon['AttHitSpell-' + x] > 0 && spellDoesDamage(mon['AttHitSpell-' + x], true)) extra += typeLetter(mon['AttHitSpell-' + x]);
  }
  if (meleeTotal < 1) meleeTotal = 100;
  let domPct = 0, domAcc = 0, found = false;
  for (const [acc, pct] of uniq) {
    if (pct > domPct || (pct === domPct && acc > domAcc)) { domPct = pct; domAcc = acc; found = true; }
  }
  if (found && domPct * 100 >= MAJ_THRESH_PCT * meleeTotal) {
    r.nAccMajority = domAcc;
    r.nAccMax = Math.abs(maxAcc - domAcc) > 2 ? maxAcc : domAcc;
  } else { r.nAccMajority = maxAcc; r.nAccMax = maxAcc; }
  if (spellTypes) { r.sSpellAttackTypes = types; r.sSpellExtraTypes = extra; }
  return r;
}

// SortLettersWithSeparator
export const sortLettersSep = (s, sep) => s.split(sep).map(p => [...p].sort().join('')).join(sep);

// The "Spell Atk." column of AddMonster2LV
export function monsterSpellAttackCol(mon) {
  const s = monsterAttackSummary(mon, true);
  let t = s.sSpellAttackTypes;
  if (s.sSpellExtraTypes.length) t += '+' + s.sSpellExtraTypes;
  return t.length ? sortLettersSep(t, '+') : '';
}

export const monsterExp = m => m.EXP * (m.ExpMulti || 1);   // UseExpMulti

// AddMonster2LV's Exp/(Dmg+HP) for the by-mob view (nAvgDmg from the database).
export function expPerDmgHP(exp, avgDmg, hp) {
  if (exp <= 0) return 0;
  if (avgDmg > 0 || hp > 0) { if (avgDmg < 0) avgDmg = 0; return cur(vbRound(exp / ((avgDmg * 2) + hp), 2) * 100); }
  return exp * 100;
}

const COLOR_SPECIAL = sp => {
  if (!sp) return '';
  if (hasAbil(sp, 60) >= 0) return 'fear';
  if (hasAbil(sp, 19) >= 0) return 'poison';
  if (hasAbil(sp, 71) >= 0) return 'confusion';
  if (hasAbil(sp, 95) >= 0) return 'slay';
  return '';
};

// modMain.PullMonsterDetail -> rows of { label, text, cls }. cls marks MME's
// colours: 'b' bold, 'red', 'blue', 'purple', 'green', 'fear', 'poison', ...
// ctx: { useChar, alignment, lairMode, lookupLimit }
export function monsterDetail(mon, ctx = {}) {
  if (typeof mon === 'number') mon = by.monster.get(mon);
  const rows = [];
  const add = (label, text = '', cls = '') => { const r = { label, text: String(text), cls }; rows.push(r); return r; };
  if (!mon) { add('Monster not found'); return rows; }
  const n = mon.Number;
  const nmr = engine.nmrVersion;

  add('Name', `${mon.Name} (${n})`, 'b');
  const exp = monsterExp(mon);
  add('Experience', exp > 0 ? fmtComma(exp) : 0);
  if (mon.RegenTime !== 0) add('Regen Time', `${mon.RegenTime} hour(s)`);
  if (nmr >= 1.83 && mon.GameLimit !== 0) add('Game Limit', mon.GameLimit, mon.RegenTime === 0 ? 'red' : '');
  add('Type', monType(mon.Type));
  let al = monAlignment(mon.Align);
  if ([0, 3, 4].includes(mon.Align)) al += ' [Not-Hostile]';
  else if (mon.Align === 6) al += ctx.useChar && ctx.alignment === 3 ? ' [Not-Hostile to EVIL]' : ' [Hostile]';
  else al += ' [Hostile]';
  add('Alignment', al);
  if (mon.Undead === 1) add('Undead', 'Yes');
  if (engine.greater) add('HPs', `${mon.HP} (Regens: ${mon.HPRegen} HPs every 30 seconds [6 rounds])`);
  else add('HPs', `${mon.HP} (Regens: ${mon.HPRegen} HPs every 90 seconds [18 rounds])`);
  add('AC/DR', `${mon.ArmourClass}/${mon.DamageResist}`);
  add('MR', mon.MagicRes);
  add('Follow %', mon['Follow%']);
  add('Charm LVL', mon.CharmLVL);

  const cash = mon.R * 1000000 + mon.P * 10000 + mon.G * 100 + mon.S * 10 + mon.C;
  if (cash > 0) {
    let coin = '';
    for (const k of ['R', 'P', 'G', 'S', 'C']) if (mon[k] > 0) coin = autoAppend(coin, mon[k] + k, '/');
    let reduced = cash, name = 'Copper';
    if (cash >= 1000000) { reduced = cash / 1000000; name = 'Runic'; }
    else if (cash >= 10000) { reduced = cash / 10000; name = 'Platinum'; }
    else if (cash >= 100) { reduced = cash / 100; name = 'Gold'; }
    else if (cash >= 10) { reduced = cash / 10; name = 'Silver'; }
    if (name !== 'Copper') reduced = vbRound(reduced, 2);
    const names = { R: 'Runic', P: 'Platinum', G: 'Gold', S: 'Silver', C: 'Copper' };
    if (coin && Object.keys(names).some(k => mon[k] > 0 && !name.includes(names[k]))) name += ` (${coin})`;
    add('Cash (up to)', `${fmtMoney(reduced)} ${name}`);
  }
  if (mon.Weapon) add('Weapon', itemName(mon.Weapon));
  if (mon.CreateSpell > 0) add('Create Spell:', `[${spellName(mon.CreateSpell)}, ${pullSpellEQ(false, 0, mon.CreateSpell)}]`);
  if (mon.DeathSpell > 0) add('Death Spell', `[${spellName(mon.DeathSpell)}, ${pullSpellEQ(false, 0, mon.DeathSpell)}]`,
    COLOR_SPECIAL(by.spell.get(mon.DeathSpell)) === 'slay' ? '' : COLOR_SPECIAL(by.spell.get(mon.DeathSpell)));
  if (mon.GreetTXT > 0) {
    const tb = by.textblock.get(mon.GreetTXT);
    const a = String((tb || {}).Action || '').toLowerCase();
    if (tb && !['heh:', 'nothing:', 'yada:', 'hehe:', 'shit:'].some(p => a.startsWith(p)))
      add('Greet Commands:', ref('textblock', mon.GreetTXT, 'Textblock ' + mon.GreetTXT), 'green');
  }
  if (nmr >= 1.83 && mon.BSDefense > 0) add('BS Defense:', mon.BSDefense, 'blue');

  let abil = '';
  for (const [a, v] of abilSlots(mon, 10)) {
    if (!(a > 0) || a === 146) continue;
    abil = autoAppend(abil, abilityStats(a, v, null, true, false, ctx));
    if (a === 34 && v > 0 && ctx.useChar && ctx.accuracy > 0) {
      abil += ` (${fix((v * 10) / fix(ctx.accuracy / 8))}% @ ${ctx.accuracy} accy)`;
    }
  }
  if (abil !== '') add('Abilities: ', abil, 'blue');
  let first = true;
  for (const [a, v] of abilSlots(mon, 10)) {
    if (a === 146 && v > 0) { add(first ? 'Guarded by: ' : '', monsterName(v), 'purple'); first = false; }
  }
  add('');

  // item drops
  let y = 0, blank = false;
  for (let x = 0; x < 10; x++) {
    const it = mon['DropItem-' + x];
    if (!it) continue;
    y++;
    add(y === 1 ? 'Item Drops' : '', `${y}. ${itemName(it)} (${mon['DropItem%-' + x]}%)`, y === 1 ? 'bh' : '');
    blank = true;
  }
  let hasAttacks = false;
  for (let x = 0; x < 5 && !hasAttacks; x++) {
    if (mon['MidSpell-' + x]) hasAttacks = true;
    if (mon['AttType-' + x] > 0 && mon['AttType-' + x] <= 3 && mon['Att%-' + x] > 0) hasAttacks = true;
  }
  const energy = nmr >= 1.71 && mon.Energy ? mon.Energy : 1000;
  if (blank) { add(''); blank = false; }
  if (hasAttacks) {
    add("Mob's Attacks", nmr >= 1.71 && mon.Energy ? `${energy} energy/round` : '', 'bh');
    add('');
    // CalculateMonsterAvgDmg(n, 0) also gives a max; that sim is phase 4's.
    const avg = mon.AvgDmg;
    if (avg > 0) {
      add('Dmg/Round *', `AVG: ${num(avg)}   * before character defenses, calculated when DB created`, 'red');
      blank = true;
    }
    if (hooks.monsterDamageRows) for (const r of hooks.monsterDamageRows(mon, { ...ctx, part: 'vsChar' }) || []) { rows.push(r); blank = true; }
    if (blank) { add(''); blank = false; }

    let pct = 0; y = 0;
    for (let x = 0; x < 5; x++) {
      const s = mon['MidSpell-' + x];
      if (!s) continue;
      y++;
      pct = mon['MidSpell%-' + x] - pct;
      add(y === 1 ? 'Between Rounds' : '', `(${pct}%) [${spellName(s)}, ${pullSpellEQ(true, mon['MidSpellLVL-' + x], s, null, { forMonster: true })}]`,
        COLOR_SPECIAL(by.spell.get(s)));
      pct = mon['MidSpell%-' + x];
      blank = true;
    }
    if (blank) { add(''); blank = false; }

    pct = 0; y = 0;
    for (let x = 0; x < 5; x++) {
      const t = mon['AttType-' + x];
      if (!(t > 0 && t <= 3 && mon['Att%-' + x] > 0)) continue;
      y++;
      blank = true;
      pct = mon['Att%-' + x] - pct;
      if (pct < 0) pct = 0;
      let label;
      if (nmr >= 1.8) {
        const tp = vbRound(mon['AttTrue%-' + x] || 0);
        label = `(${tp === 0 ? pct : tp}%) ` + (String(mon['AttName-' + x] || '').trim() || `Attack ${y}`);
      } else label = `Attack ${y} (${pct}%)`;
      pct = mon['Att%-' + x];
      const en = mon['AttEnergy-' + x];
      const energyText = en > 0 ? `Energy: ${en} (Max ${fix(energy / en)}x/round)` : `Energy: ${en}`;
      const hit = mon['AttHitSpell-' + x];
      if (t === 1 || t === 3) {
        add(label, `Min-Max: ${mon['AttMin-' + x]}-${mon['AttMax-' + x]}`);
        add('', `Accuracy: ${mon['AttAcc-' + x]}`);
        add('', energyText);
        if (hit) add('', `Hit Spell: [${spellName(hit)}, ${pullSpellEQ(false, 0, hit)}]`, COLOR_SPECIAL(by.spell.get(hit)) === 'slay' ? '' : COLOR_SPECIAL(by.spell.get(hit)));
      } else {
        const s = mon['AttAcc-' + x];
        add(label, `Spell: [${spellName(s)}, ${pullSpellEQ(true, mon['AttMax-' + x], s, null, { forMonster: true })}]`, COLOR_SPECIAL(by.spell.get(s)));
        if (spellIsAreaAttack(s)) add('', 'Target: ' + spellTargets(by.spell.get(s).Targets), 'red');
        add('', `Success %: ${mon['AttMin-' + x]}`);
        add('', energyText);
        if (hit) add('', `Hit Spell: [${spellName(hit)}, ${pullSpellEQ(false, 0, hit)}]`, COLOR_SPECIAL(by.spell.get(hit)));
        if (!engine.greater && spellIsAreaAttack(s)) {
          const sp = by.spell.get(s);
          const dur = spellMinMax(sp, { useLevel: true, level: mon['AttMax-' + x] }).nDur;   // GetSpellDuration(.., bForMonster)
          if (dur === 0 && hasAbil(sp, 1) > -1) add('', 'This is an invalid spell and will not be cast (area attack spells from regular monster casts must use ability 17, Damage-MR).', 'b');
        }
      }
      if (blank) { add(''); blank = false; }
    }
  } else if (blank) { add(''); blank = false; }

  // char_damage_out / scripting estimate: phase 4 + 7
  if (hooks.monsterDamageRows) for (const r of hooks.monsterDamageRows(mon, { ...ctx, part: 'damageOut' }) || []) rows.push(r);
  for (const fn of hooks.monsterExtraRows) for (const r of fn(mon, { ...ctx, part: 'damageOut' }) || []) rows.push(r);

  const lair = nmr >= 1.83 && /lair/i.test(mon['Summoned By'] || '') ? lairAverages(mon['Summoned By'], ctx) : { nTotalLairs: 0 };
  const ps = monsterPossy(n);
  if (lair.nTotalLairs > 0 || (nmr >= 1.82 && ps.possy > 0)) {
    add('');
    add('Lair Stats', mon.RegenTime > 0 && lair.nMobs > 0 ? 'Note: Mobs with regen time >0 are not included in lair stats' : '', 'bh');
  }
  if (lair.nTotalLairs > 0) {
    add('Total Lairs', lair.nTotalLairs);
    add('AVG # Mobs/Lair', ps.spawnChance > 0
      ? `${num(ps.possy)}  (${num(vbRound(ps.spawnChance * 100, 2))}% avg chance for this monster to spawn/lair)` : num(lair.nMaxRegen));
    add('AVG DMG/mob', putCommas(lair.nAvgDmg) + '/mob/round' + (lair.nDamageMitigated > 0 ? ` (${lair.nDamageMitigated} dmg/round mitigated)` : ''));
    if (lair.nRTK > 1 || lair.nRTC > 1) add('AVG Rounds', `${num(lair.nRTK)} RTK/mob, ${num(lair.nRTC)} RTC/lair`);
    if (lair.nRTC > 1 || lair.nAvgDmg !== lair.nAvgDmgLair)
      add('AVG DMG/clear', `${putCommas(lair.nAvgDmgLair)}/round, ${putCommas(vbRound(lair.nAvgDmgLair * lair.nRTC))}/clear (average damage taken, before any healing)`);
    if (lair.nAvgDelay > 0 && lair.nMaxRegen > 0) {
      const t1 = vbRound((lair.nAvgDelay * 60) / (lair.nMaxRegen * 5));
      let s = ` (lairs/regen period: ${t1} @ ${num(lair.nMaxRegen)} RTC`;
      if (lair.nRTC > lair.nMaxRegen) {
        const t2 = vbRound((lair.nAvgDelay * 60) / (lair.nRTC * 5));
        if (t2 !== t1) s += ` [${t2} @ ${num(lair.nRTC)} RTC]`;
      }
      s += ')';
      add('AVG Regen', engine.greater ? `${fix(lair.nAvgDelay)}m 30s${s}` : `${num(lair.nAvgDelay)} minutes${s}`);
    }
    if (lair.nAvgWalk > 0) add('AVG Walk', `${num(lair.nAvgWalk)} rooms lair to lair`);
    add('AVG Exp', `${putCommas(mon.AvgLairExp)}  (${putCommas(vbRound(mon.AvgLairExp / lair.nMaxRegen))}/mob)`);
    add('ACC Maj/Max', `${lair.nAccyMajority} / ${lair.nAccyMax}`);
    add('AVG HP', `${putCommas(lair.nAvgHP)}  (${vbRound(lair.nAvgHP / lair.nMaxRegen)}/mob)`);
    add('AVG AC/DR', `${lair.nAvgAC}/${lair.nAvgDR}`);
    if (lair.nAvgDodge > 0) add('AVG Dodge', ctx.useChar && ctx.accuracy > 0
      ? `${lair.nAvgDodge} (${fix((lair.nAvgDodge * 10) / fix(ctx.accuracy / 8))}% @ ${ctx.accuracy} accy)` : lair.nAvgDodge);
    add('AVG BS Defense', lair.nAvgBSDefense);
    add('AVG MR', lair.nAvgMR);
    if (lair.nNumAntiMagic > 0 && lair.nMobs > 0) add('AVG Anti-Magic', `${vbRound((lair.nNumAntiMagic / lair.nMobs) * 100)}% of mobs/lair`);
    if (lair.nAvgRCOL || lair.nAvgRFIR || lair.nAvgRSTO || lair.nAvgRLIT || lair.nAvgRWAT) {
      let s = '';
      const sg = v => (v > 0 ? '+' : '') + v;
      if (lair.nAvgRCOL) s = autoAppend(s, 'Cold: ' + sg(lair.nAvgRCOL));
      if (lair.nAvgRFIR) s = autoAppend(s, 'Fire: ' + sg(lair.nAvgRFIR));
      if (lair.nAvgRSTO) s = autoAppend(s, 'Stone: ' + sg(lair.nAvgRSTO));
      if (lair.nAvgRLIT) s = autoAppend(s, 'Litng: ' + sg(lair.nAvgRLIT));
      if (lair.nAvgRWAT) s = autoAppend(s, 'Water: ' + sg(lair.nAvgRWAT));
      add('AVG EL. Resist', s);
    }
    if (lair.nMagicLVL + lair.nMaxMagicLVL > 0) {
      let s = `${lair.nMagicLVL} (immune to attacks with < ${lair.nMagicLVL} magic/hitmagic)`;
      if (lair.nMaxMagicLVL > lair.nMagicLVL) s += ' - Max MagicLVL in lairs: ' + lair.nMaxMagicLVL;
      add('Effective MagicLVL', s);
    }
    if (lair.nSpellImmuLVL + lair.nMaxSpellImmuLVL > 0) {
      let s = `${lair.nSpellImmuLVL} (immune to spells <= level ${lair.nSpellImmuLVL})`;
      if (lair.nMaxSpellImmuLVL > lair.nSpellImmuLVL) s += ' - Max SpellImmu in lairs: ' + lair.nMaxSpellImmuLVL;
      add('Effective SpellImmu', s);
    }
    const ofMobs = k => `${vbRound((k / roundUp(lair.nMobs)) * 100)}% of mobs/lair`;
    if (lair.nNumUndeads > 0 && lair.nMobs > 0) add('Effective Undead', ofMobs(lair.nNumUndeads));
    if (lair.nNumLiving > 0 && lair.nNumLiving < lair.nMobs) add('Effective Living', ofMobs(lair.nNumLiving));
    if (lair.nNumAnimals > 0 && lair.nMobs > 0) add('Effective Animals', ofMobs(lair.nNumAnimals));
    if (lair.sMobList.includes(',')) {
      const list = lair.sMobList.split(',');
      let k = 0;
      for (let x = 0; x < list.length; x++) {
        if (Number(list[x]) === n) continue;
        add(k === 0 ? 'Other Lair Mobs' : '', monsterName(Number(list[x])));
        k++;
        if (k > 14 && list.length - 1 > 20) { add('', `... plus ${list.length - 1 - k} more.`); break; }
      }
    }
  } else if (nmr >= 1.82 && ps.possy > 0) {
    add('Avg # Mobs / Lair', num(ps.possy));
    if (ps.spawnChance > 0) add('Avg Spawn Chance', `${num(vbRound(ps.spawnChance * 100, 2))}%  (the chance for this monster to spawn per lair)`);
  }
  if (nmr < 1.83) add(' ', 'This database is out of date and unable to use all features.');
  add('');

  if (String(mon['Summoned By'] || '').length > 4) {
    add('Spawns via ...', '', 'bh');
    for (const r of getLocations(mon['Summoned By'], { twoColumns: true, dontSort: true, limit: ctx.lookupLimit ?? 100, ctx }))
      add(r.head, r.text);
  }
  return rows;
}

// ------------------------------------------------------------ items

// PullItemDetail's location list for an item (Obtained From, References,
// and the spells it casts), as percent-column rows.
export function itemRefs(item, ctx = {}, extra = []) {
  const rows = [...extra];
  getLocations(item['Obtained From'], { pctCol: true, aux: item.Number, ctx }, rows);
  if (engine.nmrVersion >= 1.7) getLocations(item.References, { pctCol: true, ctx }, rows);
  for (const [a, v] of abilSlots(item)) {
    if (a === 43) {
      pullSpellEQ(true, 0, v, rows, { pctCol: true }, ctx);
      rows.push({ pct: '', head: '', text: 'Casts: ' + spellName(v) });
    }
  }
  return sortItemRefs(rows, ctx.shopsFirst);
}

// modMain.PullItemDetail -> { text, refs }. The weapon damage line comes from
// hooks.weaponDamageText; the "Compared to" lines need ctx.equipped.
// ctx: { useChar, level, charm, shopsFirst, onSundry, equipped }
export function itemDetail(item, ctx = {}) {
  if (typeof item === 'number') item = by.item.get(item);
  if (!item) return { text: '', refs: [] };
  const lvRefs = [];
  let uses = '', getDrop = '', abil = '', casts = '', castOnKill = '', classOk = '', classes = '', races = '', negate = '';
  let pct = 0, killPct = 0, lvlReq = 0, bsAcc = 0, acc = 0;
  const auraItem = (item.ItemType === 0 && item.Worn <= 0) || item.ItemType === 10;

  if (item.UseCount > 0) uses = item.UseCount + (item['Retain After Uses'] === 1 ? ' start/max' : ' (destroys after uses)');
  if (item.Gettable === 0) getDrop = autoAppend(getDrop, 'Not Getable');
  if (item['Not Droppable'] === 1) getDrop = autoAppend(getDrop, 'Not Droppable');
  if (item['Destroy On Death'] === 1) getDrop = autoAppend(getDrop, 'Destroys On Death');

  for (const [a, v] of abilSlots(item)) {
    if (!(a > 0)) continue;
    switch (a) {
      case 116: abil = autoAppend(abil, abilityStats(a, v, lvRefs, true, true, ctx)); bsAcc = v; break;
      case 22: case 105: case 106: case 135:
        abil = autoAppend(abil, abilityStats(a, v, lvRefs, true, true, ctx));
        if (a === 135) lvlReq = v; else acc += v;
        break;
      case 59: classOk = autoAppend(classOk, className(v)); break;
      case 43: {
        let t = `[${spellName(v)}, ${pullSpellEQ(true, 0, v, null, { pctCol: true }, ctx)}`;
        t += pct + killPct > 0 ? `, ${killPct > 0 ? killPct : pct}%]` : ']';
        if (killPct > 0) castOnKill = autoAppend(castOnKill, t);
        else casts = autoAppend(casts, t);
        break;
      }
      case 114: pct = v; killPct = 0; break;
      case 1114:
        if (engine.greater) { killPct = v; pct = 0; }   // TODO GreaterMUD: cast-on-kill
        else abil = autoAppend(abil, abilityStats(a, v, lvRefs, true, true, ctx));
        break;
      default: abil = autoAppend(abil, abilityStats(a, v, lvRefs, true, true, ctx));
    }
  }
  acc += item.Accy;
  for (let x = 0; x < 10; x++) {
    if (item['ClassRest-' + x]) classes = autoAppend(classes, className(item['ClassRest-' + x]));
    if (item['RaceRest-' + x]) races = autoAppend(races, raceName(item['RaceRest-' + x]));
    if (item['NegateSpell-' + x]) negate = autoAppend(negate, spellName(item['NegateSpell-' + x]));
  }

  let s = '';
  if (getDrop) s = autoAppend(s, getDrop, ' -- ');
  if (uses) s = autoAppend(s, 'Uses: ' + uses, ' -- ');
  if (abil) s = autoAppend(s, 'Abilities: ' + abil, ' -- ');
  if (engine.greater && auraItem) { /* TODO GreaterMUD: Accy/AC/DR of special (aura) items */ }
  if (casts) s = autoAppend(s, 'Casts: ' + casts, ' -- ');
  if (castOnKill) s = autoAppend(s, 'CastOnKill: ' + castOnKill, ' -- ');
  if (classOk) s = autoAppend(s, 'ClassOK: ' + classOk, ' -- ');
  if (classes) s = autoAppend(s, 'Classes: ' + classes, ' -- ');
  if (races) s = autoAppend(s, 'Races: ' + races, ' -- ');
  if (negate) s = autoAppend(s, 'Negates: ' + negate, ' -- ');
  if (ctx.equipped) {
    for (const [other, cmp] of compareToEquipped(item, ctx.equipped, { uses, abil, casts, classes, races, negate }, ctx)) {
      s = autoAppend(s, `Compared to ${other.Name}: ${cmp}`, '\n\n');
    }
  }

  let head = '';
  if (item.ItemType === 1 && hooks.weaponDamageText) head = hooks.weaponDamageText(item, ctx) || '';
  else if (item.ItemType === 0 && ctx.fullDetails) {
    let t = 'Armour Type: ' + armourType(item.ArmourType);
    if (lvlReq > 0) t += ', LVL Req: ' + lvlReq;
    if (item.ArmourClass + item.DamageResist > 0) t += `, AC/DR: ${roundUp(item.ArmourClass / 10)}/${num(item.DamageResist / 10)}`;
    if (acc > 0) t += ', Accy: ' + acc;
    if (item.Limit > 0) t += ', Limit: ' + item.Limit;
    head = t + '\n\n';
  }
  let text = head + s;
  if (castOnKill.length && /Damage/i.test(castOnKill)) {
    if (text.length) text += '\n\n';
    text += '(KillSpell effects not factored into damage output)';
  }
  if (engine.greater && item.Price > 0) { /* TODO GreaterMUD: "Ganghouse Shop Value" */ }
  return { text, refs: itemRefs(item, ctx, lvRefs), lvlReq, bsAcc, acc };
}

// ------------------------------------------------------------ "Compared to"

// PullItemDetail's choice of equipped slots to compare against (nInvenSlot1/2).
export function compareSlots(item, equipped) {
  const eq = equipped || [];
  let s1 = -1, s2 = -1, weapon = false;
  if (item.ItemType === 1) { s1 = 16; weapon = true; }
  else if (item.ItemType === 0 && item.Worn > 0) {
    const pair = (a, b) => { if (eq[a] > 0) { s1 = a; if (eq[b] > 0) s2 = b; } else if (eq[b] > 0) s1 = b; };
    const single = { 1: 19, 2: 0, 3: 8, 5: 13, 6: 5, 7: 3, 8: 2, 9: 12, 10: 11, 11: 4, 12: 15, 15: 1, 16: 14, 18: 17, 19: 18 };
    if (item.Worn === 4 || item.Worn === 13) pair(9, 10);
    else if (item.Worn === 14) pair(6, 7);
    else if (item.Worn in single) s1 = single[item.Worn];
  }
  if (s1 >= 0 && !(eq[s1] > 0)) s1 = -1;
  if (s2 >= 0 && !(eq[s2] > 0)) s2 = -1;
  if (s1 >= 0 && eq[s1] === item.Number) s1 = -1;
  if (s2 >= 0 && eq[s2] === item.Number) s2 = -1;
  if (s2 >= 0 && s1 < 0) { s1 = s2; s2 = -1; }
  return { slots: [s1, s2].filter(x => x >= 0 && by.item.has(eq[x])), weapon };
}

const signedNum = n => (n > 0 ? '+' : '') + num(n);

// frmMain/modMain.CompareWeapons(new, equipped)
export function compareWeapons(a, b) {
  let s = '';
  if (a.WeaponType !== b.WeaponType) s = autoAppend(s, `${weaponType(b.WeaponType)} -> ${weaponType(a.WeaponType)}`);
  if (a.Min !== b.Min || a.Max !== b.Max) {
    const t = vbRound(a.Min + a.Max / 2, 0) - vbRound(b.Min + b.Max / 2, 0);   // (sic: Min + Max/2)
    if (t !== 0) s = autoAppend(s, 'Damage: ' + signedNum(t));
  }
  const diff = (f, label, show) => {
    const t = a[f] - b[f];
    if (t !== 0) s = autoAppend(s, `${label}: ${signedNum(t)}${show ? ` (${a[f]})` : ''}`);
  };
  diff('Speed', 'Speed'); diff('Encum', 'Weight'); diff('Accy', 'WepAccy');
  if (a.ArmourClass !== b.ArmourClass || a.DamageResist !== b.DamageResist) {
    const t = roundUp(a.ArmourClass / 10) - roundUp(b.ArmourClass / 10);
    const t2 = a.DamageResist / 10 - b.DamageResist / 10;
    if (t !== 0 || t2 !== 0) s = autoAppend(s, `AC: ${signedNum(t)}/${signedNum(t2)}`);
  }
  diff('StrReq', 'StrReq', true); diff('Limit', 'Limit', true);
  return s;
}

// CompareArmor(new, equipped)
export function compareArmour(a, b) {
  let s = '';
  if (a.Worn !== b.Worn) s = autoAppend(s, `${wornType(b.Worn)} -> ${wornType(a.Worn)}`);
  if (a.ArmourType !== b.ArmourType) s = autoAppend(s, `${armourType(b.ArmourType)} -> ${armourType(a.ArmourType)}`);
  const diff = (f, label) => { const t = a[f] - b[f]; if (t !== 0) s = autoAppend(s, `${label}: ${signedNum(t)}`); };
  diff('Encum', 'Weight'); diff('Accy', 'WepAccy');
  if (a.ArmourClass !== b.ArmourClass || a.DamageResist !== b.DamageResist) {
    const t = vbRound(vbRound(a.ArmourClass / 10, 1) - vbRound(b.ArmourClass / 10, 1), 10);
    const t2 = vbRound(vbRound(a.DamageResist / 10, 1) - vbRound(b.DamageResist / 10, 1), 10);
    if (t !== 0 || t2 !== 0) s = autoAppend(s, `AC: ${signedNum(t)}/${signedNum(t2)}`);
  }
  diff('Limit', 'Limit');
  return s;
}

// modMain.GetAbilDiffText
function abilDiffText(abil, v1, v2, pct, opposite, ctx) {
  const v = opposite ? v2 - v1 : v1 - v2;
  switch (abil) {
    case 59: return className(v1);
    case 43:
      if (!(v1 > 0)) return '';
      return `[${spellName(v1)}, ${pullSpellEQ(true, 0, v1, null, {}, ctx)}${pct !== 0 ? `, ${pct}%]` : ']'}`;
    case 114: return '';
    case 1114: return engine.greater ? '' : abilityStats(abil, v, null, true, false, ctx);
    default: {
      let t = abilityStats(abil, v, null, true, false, ctx);
      if (abil === 135) t += ` (${opposite ? v2 : v1})`;
      return t;
    }
  }
}

// The "Compared to <equipped item>: ..." lines of PullItemDetail.
// mine: the item's own detail parts { uses, abil, casts, classes, races, negate }.
// -> [[equipped item row, text], ...]
export function compareToEquipped(item, equipped, mine, ctx = {}) {
  const { slots, weapon } = compareSlots(item, equipped);
  if (!slots.length) return [];
  const others = slots.map(x => by.item.get(equipped[x]));
  const cmp = others.map(() => '');
  const add = (i, t, glue) => { cmp[i] = autoAppend(cmp[i], t, glue); };

  // uses / get / drop / destroy
  others.forEach((o, i) => {
    const t = o.UseCount > 0 ? `Uses: ${o.UseCount}${o['Retain After Uses'] === 1 ? ' start/max' : ' (destroys after uses)'}` : '';
    if (t !== mine.uses) add(i, t);
  });
  others.forEach((o, i) => {
    if (item.Gettable !== o.Gettable) add(i, o.Gettable === 0 ? '+Getable' : '+Not Getable');
  });
  others.forEach((o, i) => {
    if (item['Not Droppable'] !== o['Not Droppable']) add(i, o['Not Droppable'] === 1 ? '+Droppable' : '+Not Droppable');
  });
  others.forEach((o, i) => {
    if (item['Destroy On Death'] !== o['Destroy On Death']) add(i, o['Destroy On Death'] === 1 ? '-Destroy On Death' : '+Destroy On Death');
  });

  // abilities: nAbils(item/equipped1/equipped2, slot) -> [abil, value]
  const rows = [item, ...others];
  const abils = rows.map(r => Array.from({ length: 20 }, (_, x) => (r['Abil-' + x] > 0 ? [r['Abil-' + x], r['AbilVal-' + x] || 0] : [0, 0])));
  // getval_array_long_3d: the last slot of row y holding `abil` (and value `match`)
  const find = (y, abil, match) => {
    for (let x = 19; x >= 0; x--) {
      const [a, v] = abils[y][x];
      if (a === abil && (match === -32000 || v === match)) return { v };
    }
    return null;
  };
  const txt = ['', ''], castSp = ['', ''], clsOk = ['', ''], flag = [false, false], castFlag = [false, false, false];
  for (let y = 0; y < rows.length; y++) {
    let pct = 0;
    for (let x = 0; x < 20; x++) {
      const [a, v] = abils[y][x];
      if (!(a > 0)) continue;
      let match = -32000;
      if (a === 59) match = v;
      if (a === 43) { match = v; castFlag[y] = true; }
      if (a === 114) pct = v;
      if (y === 0) {
        for (let i = 0; i < others.length; i++) {
          const hit = find(i + 1, a, match);
          if (!hit) {
            const t = abilDiffText(a, v, 0, pct, false, ctx);
            if (!t) continue;
            if (a === 59) clsOk[i] = autoAppend(clsOk[i], '+' + t);
            else if (a === 43) castSp[i] = autoAppend(castSp[i], '+' + t);
            else { flag[i] = true; txt[i] = autoAppend(txt[i], (v === 0 ? '+' : '') + t); }
          } else if (hit.v !== v) {
            const t = abilDiffText(a, v, hit.v, pct, false, ctx);
            if (t) { flag[i] = true; txt[i] = autoAppend(txt[i], t); }
          }
        }
      } else if (!find(0, a, match)) {
        const i = y - 1;
        const t = abilDiffText(a, v, 0, pct, true, ctx);
        if (!t) continue;
        if (a === 59) clsOk[i] = autoAppend(clsOk[i], '-' + t);
        else if (a === 43) castSp[i] = autoAppend(castSp[i], '-' + t);
        else { flag[i] = true; txt[i] = autoAppend(txt[i], (v === 0 ? '-' : '') + t); }
      }
    }
  }
  others.forEach((_, i) => {
    if (txt[i]) add(i, `Abilities${!mine.abil && flag[i] ? ' [none]' : ''}: ${txt[i]}`, ' -- ');
  });
  others.forEach((_, i) => {
    if (castSp[i]) add(i, `Casts${!mine.casts && castFlag[i + 1] ? ' [none]' : ''}: ${castSp[i]}`, ' -- ');
  });
  others.forEach((_, i) => { if (clsOk[i]) add(i, 'ClassOk: ' + clsOk[i], ' -- '); });

  // class / race restrictions and negated spells
  const lists = (prefix, nameOf, label, mineText, emptyNote) => {
    const vals = rows.map(r => Array.from({ length: 10 }, (_, x) => r[prefix + x] || 0));
    const has = (y, v) => vals[y].includes(v);
    const t = ['', ''], f = [false, false];
    for (let y = 0; y < rows.length; y++) {
      for (const v of vals[y]) {
        if (!(v > 0)) continue;
        if (y === 0) {
          others.forEach((_, i) => { if (!has(i + 1, v)) t[i] = autoAppend(t[i], '+' + nameOf(v)); });
        } else {
          f[y - 1] = true;
          if (!has(0, v)) t[y - 1] = autoAppend(t[y - 1], '-' + nameOf(v));
        }
      }
    }
    others.forEach((_, i) => {
      if (!t[i]) return;
      let head = label;
      if (emptyNote === 'restricted') {
        if (!mineText) head += ' [not-restricted]';
        else if (!f[i]) head += ' [+restricted]: ' + t[i];
        else head += ': ' + t[i];
      } else head += (!mineText && f[i] ? ' [none]: ' : ': ') + t[i];
      add(i, head, ' -- ');
    });
  };
  lists('ClassRest-', n => className(n), 'Classes', mine.classes, 'restricted');
  lists('RaceRest-', n => raceName(n), 'Races', mine.races, 'restricted');
  lists('NegateSpell-', n => spellName(n), 'Negate', mine.negate, 'none');

  return others.map((o, i) => {
    const stat = weapon ? compareWeapons(item, o) : compareArmour(item, o);
    return [o, autoPrepend(cmp[i], stat)];
  });
}

// Values for the Weapons list (AddWeapon2LV, database columns only).
export function weaponCols(item, abilFilter = 0) {
  let level = 0, acc = 0, bs = 'No', crits = 0, abilVal = 0;
  for (const [a, v] of abilSlots(item)) {
    switch (a) {
      case 58: crits = v; break;
      case 22: case 105: case 106: acc = v; break;   // MME keeps the last one, not the sum, here
      case 135: level = v; break;
      case 116: bs = v; break;
    }
    if (abilFilter > 0 && a === abilFilter) abilVal = v;
  }
  return { level, acc: acc + item.Accy, bs, crits, ac: `${roundUp(item.ArmourClass / 10)}/${num(item.DamageResist / 10)}`, abilVal };
}

// modMain.Get_Enc_Ratio
export function encRatio(enc, v1, v2 = 0) {
  const total = v1 + v2;
  if (total <= 0) return 0;
  if (enc < 1) return total;
  return cur(vbRound(total / enc, 4) * 100);
}

// Values for the Armour list (AddArmour2LV).
export function armourCols(item, abilFilter = 0) {
  let level = 0, acc = item.Accy, crits = 0, abilVal = 0;
  for (const [a, v] of abilSlots(item)) {
    switch (a) {
      case 58: crits = v; break;
      case 135: level = v; break;
      case 22: case 105: case 106: acc += v; break;
    }
    if (abilFilter > 0 && a === abilFilter) abilVal = v;
  }
  return { level, acc, crits, abilVal, ac: `${num(item.ArmourClass / 10)}/${num(item.DamageResist / 10)}`,
    acEnc: encRatio(item.Encum, item.ArmourClass, item.DamageResist) };
}

// The ability filter shared by the Weapons/Armour/Sundry filter bars.
// filter: { abil: n (>0 ability, -1 negates spell #, 0 any), op: 'le'|'ge', value }
export function itemPassesAbility(item, f) {
  if (!f || !f.abil) return true;
  if (f.abil === -1) {
    if (!(f.value > 0)) return true;
    for (let x = 0; x < 10; x++) if (item['NegateSpell-' + x] === f.value) return true;
    return false;
  }
  for (const [a, v] of abilSlots(item)) {
    if (a === f.abil && (f.op === 'le' ? v <= f.value : v >= f.value)) return true;
  }
  return false;
}

// GetAbilityList: [[n, label]] of every named ability, for the filter combos.
export function abilityList() {
  const max = engine.greater ? 1120 : 200;
  const out = [];
  for (let x = 1; x <= max; x++) {
    let s = abilityName(x, false);
    if (s === '' || s === 'Ability ' + x) { if (x <= 200) s = `[Ability ${x}]`; else continue; }
    else if (!opts.hideNumbers) s += ` (${x})`;
    out.push([x, s]);
  }
  return out;
}

// ------------------------------------------------------------ spells (tab)

// modMain.PullSpellDetail -> { text, refs }.
// ctx: { useChar, level, cls }
export function spellDetail(sp, ctx = {}) {
  if (typeof sp === 'number') sp = by.spell.get(sp);
  if (!sp) return { text: 'spell not found', refs: [] };
  let useChar = !!(ctx.useChar && ctx.level > 0);
  const usable = useChar ? spellUsableBy(sp, ctx.cls || 0) : false;
  useChar = usable;
  const castLvl = useChar ? ctx.level : 0;
  const cast = hooks.spellCast ? hooks.spellCast(sp, castLvl, ctx) : spellCastBasics(sp, castLvl);
  const refs = [];
  let detail = '';
  if (cast.sAvgRound) { detail = autoAppend(detail, cast.sAvgRound, '\n'); }
  if (!useChar && cast.sMMA && cast.nMinCast > 0 && (cast.nMinCast !== cast.nMaxCast || cast.nMaxCast !== cast.nAvgCast)) {
    detail = autoAppend(detail, cast.sMMA, '\n');
  }
  if (usable && cast.nCastLevel > 0) {
    detail = detail.split(`(@lvl ${cast.nCastLevel}) `).join('').split(` (@lvl ${cast.nCastLevel})`).join('').trim();
  }
  if (detail) detail += '\n';

  let eq = pullSpellEQ(true, cast.nCastLevel, sp.Number, refs, { overrideMin: cast.nMinCast, overrideMax: cast.nMaxCast }, ctx);
  let removes = '';
  const ri = eq.toLowerCase().indexOf(' -- removesspells(');
  if (ri >= 0) {
    removes = eq.slice(ri + ' -- RemovesSpells('.length, -1);
    eq = eq.slice(0, ri);
  }
  if (sp.Cap !== 0 && (cast.sLVLincreases || eq.includes('@'))) eq = `LVL Cap: ${sp.Cap} ` + eq;
  if (eq.length) detail = autoAppend(detail, eq, '\n');
  if (cast.nManaCost > 0 && cast.nNumCasts > 1) detail = autoAppend(detail, ` (${fix(cast.nManaCost / cast.nNumCasts)} mana/ea)`, '');
  if (cast.sLVLincreases) detail = autoAppend(detail, cast.sLVLincreases, '\n');

  detail += '\n\nTarget: ' + spellTargets(sp.Targets);
  const learnable = sp.Learnable === 1 || (sp.Magery === 5 && !engine.disableKai && sp.ReqLevel > 0);
  if (sp.Diff < 200 && (sp.Diff !== 0 || learnable)) detail = autoAppend(detail, 'Difficulty: ' + sp.Diff);
  detail = autoAppend(detail, 'Attack Type: ' + spellAttackType(sp.AttType));
  if (engine.nmrVersion >= 1.8) {
    if (sp.TypeOfResists === 1) detail += ', Fully-Resistable by Anti-Magic Only';
    else if (sp.TypeOfResists === 2) detail += ', Fully-Resistable by All';
    else detail += ', Can Not be Fully-Resisted';
  }
  if (engine.nmrVersion >= 1.7) {
    const c = String(sp.Classes || '');
    if (c.length > 2 && c !== '(*)') {
      detail += '\nClass Restricted (via learning method): ' + (c.match(/\d+/g) || []).map(n => className(Number(n))).join(', ');
    }
  }
  if (removes) detail += '\nRemoves: ' + removes;

  getLocations(sp['Learned From'], { header: '(learn) ', ctx }, refs);
  getLocations(sp['Casted By'], { ctx }, refs);
  refs.sort((a, b) => plain(a.text).localeCompare(plain(b.text)));
  return { text: detail, refs };
}

// AddSpell2LV's database columns. castLevel as AddSpell2LV picks it: the
// character's level, else the generic profile's (GetMaxLevel), which
// CalculateSpellCast then clamps to the spell's cap.
export function spellCols(sp, ctx = {}) {
  const castLevel = ctx.useChar && ctx.level > 0 ? ctx.level : getMaxLevel();
  const cast = hooks.spellCast ? hooks.spellCast(sp, castLevel, ctx) : spellCastBasics(sp, castLevel);
  const mana = sp.ManaCost > 0 ? (cast.nNumCasts > 1 ? sp.ManaCost * cast.nNumCasts : sp.ManaCost) : 0;
  return {
    magery: magery(sp.Magery, sp.MageryLVL), mana,
    diff: ctx.useChar && ctx.level > 0 && hooks.spellCast ? `${cast.nCastChance}%` : sp.Diff,
    detail: spellQuickDetail(sp, castLevel, cast.nMinCast, cast.nMaxCast),
    area: [3, 5, 9, 10, 11, 12, 13].includes(sp.Targets),
  };
}

// AddSpell2LV skips these rows.
export const spellListed = sp => !!sp.Name && sp.Name[0] !== '1' && sp.Name.slice(0, 3).toLowerCase() !== 'sdf';

// The Spells filter bar (FilterSpells). f: { magery, mageryLevel, target, attType, abil, learnable }
const TARGET_GROUPS = { 1: [1, 2], 2: [0, 2, 8], 3: [4, 6, 8], 4: [5, 10, 13], 5: [11, 12, 9, 3] };
export function spellPasses(sp, f, ch = null) {
  const useChar = !!ch;
  let skipMagery = false;
  if (f.magery > 0 && f.magery !== sp.Magery) {
    if (sp.Learnable > 0 && sp.Magery === 0 && useChar && engine.nmrVersion >= 1.7) {
      if (!ch.cls || sp.Classes === '(*)' || String(sp.Classes || '').includes(`(${ch.cls})`)) skipMagery = true;
      else return false;
    } else return false;
  }
  if (!skipMagery) {
    if (f.mageryLevel > 0 && f.mageryLevel < sp.MageryLVL) return false;
    if (f.learnable && sp.Learnable === 0 && (f.magery !== 5 || engine.disableKai)) return false;
  }
  if (f.attType > 0 && sp.AttType !== f.attType - 1) return false;
  if (f.target > 0 && !TARGET_GROUPS[f.target].includes(sp.Targets)) return false;
  if (useChar && !spellUsableBy(sp, ch.cls || 0, ch.level || 0, ch.alignment || 0, !!f.learnable)) return false;
  if (f.abil > 0 && hasAbil(sp, f.abil) === -32768) return false;
  return true;
}

// ------------------------------------------------------------ classes / races

// PullClassDetail / AddClass2LV "Abilities"
export function classAbilities(c) {
  let s = '';
  for (const [a, v] of abilSlots(c, 10)) if (a && a !== 59) s = autoAppend(s, abilityStats(a, v));
  return s;
}
// PullRaceDetail / AddRace2LV "Abilities"
export function raceAbilities(r) {
  let s = '';
  for (const [a, v] of abilSlots(r, 10)) if (a) s = autoAppend(s, abilityStats(a, v));
  return s;
}
export function classCols(c) {
  return { exp: `${(Number(c.ExpTable) || 0) + 100}%`, weapon: classWeaponType(c.WeaponType), armour: armourType(c.ArmourType),
    magic: magery(c.MageryType, c.MageryLVL), combat: c.CombatLVL - 2, hp: `${c.MinHits}-${c.MinHits + c.MaxHits}` };
}
export const raceStat = (r, k) => `${r['m' + k]}-${r['x' + k]}`;

// RaceColorCode: per stat, 'lo' / 'hi' when min+max is 20 off the average.
export function raceColours(races) {
  const keys = ['STR', 'INT', 'WIL', 'AGL', 'HEA', 'CHM'];
  const avg = {};
  if (!races.length) return new Map();
  for (const k of keys) {
    // VB stores the averages in an Integer array, which rounds (banker's)
    const mn = vbRound(races.reduce((s, r) => s + (r['m' + k] || 0), 0) / races.length);
    const mx = vbRound(races.reduce((s, r) => s + (r['x' + k] || 0), 0) / races.length);
    avg[k] = mn + mx;
  }
  const out = new Map();
  for (const r of races) {
    const c = {};
    for (const k of keys) {
      const t = (r['m' + k] || 0) + (r['x' + k] || 0);
      if (t < avg[k] - 20) c[k] = 'lo';
      if (t > avg[k] + 20) c[k] = 'hi';
    }
    out.set(r.Number, c);
  }
  return out;
}

export { weaponType, wornType, itemType, armourType, shopType };
