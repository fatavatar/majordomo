// Can this character use this item / spell? The checks behind MME's global
// filter. Ported from frmMain.ItemIsUsableByChar and modMMudFunc.SpellIsUsable.

import { by } from '../db.js';
import { engine } from './engine.js';

const ABIL_SLOTS = (row) => {
  const out = [];
  for (let i = 0; ('Abil-' + i) in row; i++) out.push([row['Abil-' + i], row['AbilVal-' + i] || 0]);
  return out;
};

// alignment: 0 any, 1 good, 2 neutral, 3 evil (cmbGlobalAlignment).
// Returns true if `abil` (97 GoodOnly / 98 EvilOnly / 112 NeutralOnly /
// 110 NotGood / 111 NotEvil / 113 NotNeutral) rules this alignment out.
function alignBars(abil, alignment) {
  if (!alignment) return false;
  if (abil === 97 || abil === 98 || abil === 112) return abil !== [0, 97, 112, 98][alignment];
  if (abil === 110 || abil === 111 || abil === 113) return abil === [0, 110, 113, 111][alignment];
  return false;
}

// opts: { ignoreMinItemLevel, skipAlignCheck }
// `ch` is the character (cls, level, alignment, globalMinLevel, equipped).
export function itemUsableBy(item, ch, opts = {}) {
  if (typeof item === 'number') item = by.item.get(item);
  if (!item) return false;
  const level = ch.level || 0;
  if (level >= 999 && !ch.cls && !ch.alignment) return true;

  let classOk = false, magical = false, minLevel = 0;
  for (const [abil, val] of ABIL_SLOTS(item)) {
    switch (abil) {
      case 135: minLevel = val; if (val > level) return false; break;
      case 136: if (val < level) return false; break;
      case 59: if (val > 0 && val === ch.cls) classOk = true; break;
      case 28: magical = true; break;
      case 97: case 98: case 112: case 110: case 111: case 113:
        if (!opts.skipAlignCheck && alignBars(abil, ch.alignment)) return false;
        break;
    }
  }

  // "Min item level" global option: hide low-level gear unless it is worn.
  if (!opts.ignoreMinItemLevel && ch.globalMinLevel > 0 && minLevel < ch.globalMinLevel
      && !(ch.equipped || []).includes(item.Number)) return false;

  const cls = by.cls.get(ch.cls);
  if (!ch.cls || !cls) return true;

  for (let i = 0; i < 10; i++) {
    if (cls['Abil-' + i] === 51) { if (magical) return false; break; }   // anti-magic class
  }

  if (!classOk) {
    let state = 0;   // 0 undetermined, -1 restricted with no match yet, 1 match
    for (let i = 0; i < 10; i++) {
      const r = item['ClassRest-' + i];
      if (r && state === 0) state = -1;
      if (r === ch.cls) { classOk = true; state = 1; break; }
    }
    if (state === -1) return false;
  }
  if (classOk) return true;

  const cArm = cls.ArmourType, cWep = cls.WeaponType, wt = item.WeaponType;
  if (item.ItemType === 0) {
    if (cArm < item.ArmourType) return false;
    // 1H classes can't use shields without ClassOk (stock only)
    if (item.Worn === 12 && !engine.greater && [0, 2, 4, 9].includes(cWep)) return false;
  } else if (item.ItemType === 1) {
    switch (cWep) {
      case 0: case 1: case 2: case 3: if (wt !== cWep) return false; break;
      case 4: if (wt !== 0 && wt !== 2) return false; break;
      case 5: if (wt !== 1 && wt !== 3) return false; break;
      case 6: if (!(wt >= 2)) return false; break;
      case 7: if (!(wt <= 1)) return false; break;
      case 8: break;
      case 9:
        // hardcoded in the game dll: dagger (68) and quarterstaff (100)
        if (!engine.greater && (item.Number === 68 || item.Number === 100)) return true;
        return false;
    }
  }
  return true;
}

export const classMagery = n => (by.cls.get(n) || {}).MageryType || 0;
export const classMageryLevel = n => (by.cls.get(n) || {}).MageryLVL || 0;

const classListHas = (classes, n) => String(classes || '').toLowerCase().includes(`(${n})`);

// SpellIsUsable(nSpell, nClass, nLevel, nCharAlign, bAndLearnable)
export function spellUsableBy(spell, clsNum, level = 0, alignment = 0, andLearnable = false) {
  if (typeof spell === 'number') spell = by.spell.get(spell);
  if (!spell) return false;
  if (clsNum < 1) return true;
  const KAI = 5;

  if (andLearnable && spell.Learnable === 0 && String(spell['Learned From'] || '').length < 5
      && (spell.Magery !== KAI || engine.disableKai || spell.ReqLevel < 1)) return false;

  const mag = classMagery(clsNum), magLvl = classMageryLevel(clsNum);
  if (spell.Magery !== 0) {
    if (!mag) return false;
    let skip = false;
    if (mag !== spell.Magery) {
      // (unreachable in MME as written: Magery is non-zero here; kept for fidelity)
      if (spell.Learnable > 0 && spell.Magery === 0 && engine.nmrVersion >= 1.7) {
        if (spell.Classes === '(*)' || classListHas(spell.Classes, clsNum)) skip = true;
        else return false;
      } else return false;
    }
    if (!skip) {
      if (magLvl > 0 && magLvl < spell.MageryLVL) return false;
      if (mag !== KAI && spell.Learnable === 0) return false;
      if (mag === KAI && engine.disableKai && spell.Learnable === 0) return false;
    }
  }

  if (engine.nmrVersion >= 1.7) {
    const c = String(spell.Classes || '');
    if (c.length > 2 && c !== '(*)' && !classListHas(c, clsNum)) return false;
  }
  if (level > 0 && level < spell.ReqLevel) return false;

  if (alignment > 0) {
    for (let i = 0; i < 10; i++) if (alignBars(spell['Abil-' + i], alignment)) return false;
  }
  return true;
}

export const SPELL_ATTACK_TYPE = ['Cold', 'Fire', 'Stone', 'Lightning', 'Normal', 'Water', 'Poison'];
export const spellAttackType = (n, short) =>
  n in SPELL_ATTACK_TYPE ? (short ? 'CFSLNWP'[n] : SPELL_ATTACK_TYPE[n]) : String(n);

// modMMudFunc.SpellIsInGame: a spell nobody can learn, cast or be taught
// (and, from NMR 1.8, no class list) isn't in the game.
export function spellIsInGame(sp) {
  if (typeof sp === 'number') sp = by.spell.get(sp);
  if (!sp) return false;
  const len = v => String(v ?? '').length;
  if (sp.Learnable === 0 && len(sp['Learned From']) <= 1 && len(sp['Casted By']) <= 1
      && (sp.Magery !== 5 || sp.ReqLevel < 1 || engine.disableKai)) {
    if (engine.nmrVersion >= 1.8) { if (len(sp.Classes) <= 1) return false; }
    else return false;
  }
  return true;
}

// MME's "Only load items, monsters, and shops that are in the game" (bOnlyInGame):
// items, monsters and shops carry an "In Game" flag; spells use SpellIsInGame;
// other rows (classes, races, rooms) are always in.
export function isInGame(row) {
  if (!row) return false;
  if ('Learnable' in row && 'Casted By' in row) return spellIsInGame(row);
  return row['In Game'] !== 0;
}
