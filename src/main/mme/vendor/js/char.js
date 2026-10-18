// The loaded character: MME's nGlobalChar* globals and Character-tab fields,
// gathered into one object. Shape follows what MME saves to a .mmec file
// (frmMain.SaveCharacter / LoadCharacter), so .mmec import/export is a
// straight mapping.
//
// Characters persist in localStorage as a roster; one is active. Anything
// that changes the active character must go through `update()` (or call
// `changed()` after mutating), which saves and emits a 'char' event.

import { emit } from './state.js';

export const EQ_SLOTS = ['Head', 'Ears', 'Neck', 'Back', 'Torso', 'Arms', 'Wrist', 'Wrist2', 'Hands',
  'Finger1', 'Finger2', 'Waist', 'Legs', 'Feet', 'Worn', 'Off-Hand', 'Weapon', 'Eyes', 'Face', 'Everywhere'];

export const STAT_KEYS = ['str', 'int', 'wis', 'agi', 'hea', 'cha'];
export const STAT_LABEL = { str: 'Strength', int: 'Intellect', wis: 'Willpower', agi: 'Agility', hea: 'Health', cha: 'Charm' };
export const ALIGNMENTS = ['Any', 'Good', 'Neutral', 'Evil'];   // cmbGlobalAlignment
export const TOTAL_STAT_LBLS = 46;                               // modMain.bas

export function blankChar() {
  return {
    name: '',
    cls: 0, race: 0, level: 1,
    alignment: 0,                    // index into ALIGNMENTS
    globalMinLevel: 0,
    stats: { str: 0, int: 0, wis: 0, agi: 0, hea: 0, cha: 0 },
    mr: 0, antiMagic: false, unequipMissing: false,
    weaponVsChar: { ac: 0, dr: 0, dodge: 0 },   // txtWeaponExtras(2..4): target AC/DR/dodge
    spellVsMR: 0,
    addWeight: 0, useAddWeight: false,
    quests: new Array(12).fill(0),              // chkCharQuests(0..11)
    questOpts: [0, 0, 0, 0],                    // 2nd align, 6th align, extra1, extra2
    attack: {
      type: 0, ma: 0, spellNum: 0, spellLvl: 0, manual: 0, manualMag: 0,
      healType: 0, healSpellNum: 0, healSpellLvl: 0, healManual: 0, healRounds: 0,
      useMeditate: false, backstab: false, backstabWeapon: 0,
    },
    statAdjustments: new Array(TOTAL_STAT_LBLS + 1).fill(0),
    equipped: new Array(EQ_SLOTS.length).fill(0),   // item numbers, by EQ_SLOTS index
    // Item Manager rows (lvItemManager): {item, flag, qty, fieldQty, source}.
    //   flag: '' | CARRIED | STASH | MANUAL | BUY | SELL | DROP | HIDE | PICKUP | USE
    //   qty: the flag's " xN" count; fieldQty: the QTY column; source: Saved /
    //   Equipped / Inventory / Ground / Manual. Only CARRIED and STASH rows go
    //   into a .mmec (IM_CARRIED / IM_STASH), as in MME.
    itemManager: [],
    wornInGame: null,                                // equipped[] as last pasted/imported: "rem" cmds
    bless: new Array(10).fill(0),                    // spell numbers
    learnedSpells: [],                               // spell numbers
    compare: { weapons: [], armour: [], spells: [], monsters: [] },
    monsterFilter: {},                               // MME [MonsterFilter] keys, verbatim
  };
}

// Fill any fields missing from an older saved character.
function normalise(c) {
  const b = blankChar();
  const out = { ...b, ...c };
  for (const k of ['stats', 'weaponVsChar', 'attack', 'compare']) out[k] = { ...b[k], ...(c[k] || {}) };
  // older saves kept carried/stash lists
  if (!c.itemManager && (c.carried || c.stash)) {
    out.itemManager = [...imRows(c.carried, 'CARRIED'), ...imRows(c.stash, 'STASH')];
  }
  delete out.carried; delete out.stash;
  for (const k of ['quests', 'questOpts', 'statAdjustments', 'equipped', 'bless']) {
    out[k] = b[k].map((v, i) => (Array.isArray(c[k]) && c[k][i] != null ? c[k][i] : v));
  }
  return out;
}
const imRows = (list, flag) => (list || []).map(e => ({ item: e.item, flag, qty: e.qty || 1, fieldQty: e.qty || 1, source: 'Saved' }));

// Item Manager / compare-list helpers (mutate `c`; call inside update()).
export const imCarried = c => c.itemManager.filter(r => r.flag === 'CARRIED').map(r => ({ item: r.item, qty: r.qty || 1 }));
export const imStash = c => c.itemManager.filter(r => r.flag === 'STASH').map(r => ({ item: r.item, qty: r.qty || 1 }));
export function imAdd(c, item, { flag = '', qty = 1, fieldQty = qty, source = 'Manual' } = {}) {
  c.itemManager.push({ item, flag, qty, fieldQty, source });
}
// modListViewExt.ParseActionAndQty: "SELL x3" -> ['SELL', 3].
export function parseActionAndQty(s, fieldQty = 0) {
  const t = String(s || '').trim();
  const m = t.match(/^(.*?)\s+x(\d+)$/i);
  if (m) return [m[1].trim().toUpperCase(), Math.max(1, Number(m[2]))];
  return [t.toUpperCase(), Math.max(1, fieldQty)];
}
// The flag text a row shows ("CARRIED x2").
export const imFlagText = r => (r.flag ? r.flag + ((r.qty || 1) > 1 ? ' x' + r.qty : '') : '');

// modListViewExt.LV_SetActionCell for one row. action: dropHide | pickupUse |
// sell | carried | stash | minus | plus | clear. Returns true if it changed.
export function imSetAction(r, action) {
  const base = r.flag || '';
  let qty = Math.max(1, r.qty || 1);
  if (!base && (r.fieldQty || 0) > 1) qty = r.fieldQty;      // blank flag: seed from the QTY column
  const cycle = (a, b) => (base === a ? [b, qty] : base === b ? ['', 1] : [a, qty]);
  const QTY_FLAGS = ['DROP', 'HIDE', 'BUY', 'SELL', 'PICKUP', 'USE', 'STASH', 'CARRIED'];
  let next;
  switch (action) {
    case 'dropHide': next = cycle('DROP', 'HIDE'); break;
    case 'pickupUse': next = cycle('PICKUP', 'USE'); break;
    case 'sell': next = cycle('SELL', 'BUY'); break;
    case 'carried': next = base === 'CARRIED' ? ['', 1] : ['CARRIED', qty]; break;
    case 'stash': next = base === 'STASH' ? ['', 1] : ['STASH', qty]; break;
    case 'minus': if (!QTY_FLAGS.includes(base)) return false; next = [base, Math.max(1, qty - 1)]; break;
    case 'plus': if (!QTY_FLAGS.includes(base)) return false; next = [base, qty + 1]; break;
    case 'clear': next = ['', 1]; break;
    default: return false;
  }
  if (next[0] === base && next[1] === (r.qty || 1)) return false;
  [r.flag, r.qty] = next;
  return true;
}

// modListViewExt.LV_CopySelectedActionsToClipboard: game commands for flagged rows.
export function imCommands(rows, itemOf) {
  const out = [];
  for (const r of rows) {
    const it = itemOf(r.item);
    const name = it ? it.Name : '';
    if (!name) continue;
    let cmd = '';
    switch (r.flag) {
      case 'DROP': cmd = 'drop ' + name; break;
      case 'HIDE': cmd = 'hide ' + name; break;
      case 'SELL': cmd = 'sell ' + name; break;
      case 'BUY': cmd = 'buy ' + name; break;
      case 'PICKUP': cmd = 'get ' + name; break;
      case 'USE': cmd = (it.ItemType === 0 || it.ItemType === 1 ? 'equip ' : it.ItemType === 8 ? 'open ' : it.ItemType === 9 ? 'read ' : 'use ') + name; break;
      case 'STASH': cmd = 'stash ' + name; break;
    }
    if (cmd) for (let k = 0; k < Math.max(1, r.qty || 1); k++) out.push(cmd);
  }
  return out.join('\r\n');
}

// CompareAddItem etc.: kind is weapons | armour | spells | monsters.
export function compareAdd(c, kind, n) {
  if (!c.compare[kind].includes(n)) c.compare[kind].push(n);
}
export function compareRemove(c, kind, n) {
  c.compare[kind] = c.compare[kind].filter(x => x !== n);
}

// ---------------------------------------------------------------- roster

const KEY = 'mme.roster';
export const roster = { active: null, chars: [] };   // chars: [{id, char}]
let seq = 0;
const newId = () => Date.now().toString(36) + (seq++).toString(36);

export let char = blankChar();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(roster)); } catch { /* private mode etc. */ }
}

export function loadRoster() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.chars)) Object.assign(roster, saved);
  } catch { /* corrupt or unavailable: start fresh */ }
  if (!roster.chars.length) addChar(blankChar(), false);
  const entry = roster.chars.find(e => e.id === roster.active) || roster.chars[0];
  roster.active = entry.id;
  entry.char = normalise(entry.char);
  char = entry.char;
}

export function addChar(c, activate = true) {
  const entry = { id: newId(), char: normalise(c) };
  roster.chars.push(entry);
  if (activate || !roster.active) switchChar(entry.id);
  else persist();
  return entry;
}

export function switchChar(id) {
  const entry = roster.chars.find(e => e.id === id);
  if (!entry) return;
  roster.active = id;
  entry.char = normalise(entry.char);
  char = entry.char;
  persist();
  emit('char', { switched: true });
}

export function deleteChar(id) {
  roster.chars = roster.chars.filter(e => e.id !== id);
  if (!roster.chars.length) { addChar(blankChar()); return; }
  if (roster.active === id) switchChar(roster.chars[0].id);
  else persist();
}

export const charLabel = c => (c.name || '').trim() || 'Unnamed';

// Mutate the active character, then save and notify.
export function update(fn) {
  fn(char);
  changed();
}
export function changed(detail = {}) {
  persist();
  emit('char', detail);
}

// ---------------------------------------------------------------- .mmec (INI)

export function parseINI(text) {
  const out = {};
  let sec = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === ';') continue;
    const m = line.match(/^\[(.*)\]$/);
    if (m) { sec = out[m[1]] = out[m[1]] || {}; continue; }
    const eq = line.indexOf('=');
    if (eq > 0 && sec) sec[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export function writeINI(ini) {
  return Object.entries(ini).map(([sec, kv]) =>
    `[${sec}]\r\n` + Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\r\n')).join('\r\n\r\n') + '\r\n';
}

const n = v => Number(v) || 0;
const flag = v => n(v) !== 0;
const nums = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean).map(Number).filter(x => x);
const itemQtys = s => String(s || '').split(',').filter(Boolean).map(p => {
  const [item, qty] = p.split('|');
  return { item: n(item), qty: Math.max(1, n(qty) || 1) };
}).filter(e => e.item);

export function fromMMEC(text) {
  const ini = parseINI(text);
  const P = ini.PlayerInfo || {}, I = ini.Inventory || {}, B = ini.Bless || {};
  const L = ini.LearnedSpells || {}, C = ini.Compare || {};
  const c = blankChar();
  c.name = P.Name === '0' ? '' : (P.Name || '');
  c.cls = n(P.Class); c.race = n(P.Race); c.level = n(P.Level) || 1;
  c.alignment = n(P.Alignment); c.globalMinLevel = n(P.GlobalMinLVL);
  c.stats = { str: n(P.Strength), int: n(P.Intellect), wis: n(P.Widsom), agi: n(P.Agility),
    hea: n(P.Health), cha: n(P.Charm) };
  c.weaponVsChar = { ac: n(P.WeaponVSCharAC), dr: n(P.WeaponVSCharDR), dodge: n(P.WeaponVSCharDodge) };
  c.spellVsMR = n(P.SpellVSMR);
  c.addWeight = n(P.AddWeight); c.useAddWeight = flag(P.UseAddWeight);
  c.mr = n(P.MR); c.antiMagic = flag(P.AntiMagic); c.unequipMissing = flag(P.UnequipMissing);
  c.quests = c.quests.map((_, i) => n(P['Quest' + i]));
  c.questOpts = [n(P.Quest_2nd), n(P.Quest_6th), n(P.Quest_Extra1), n(P.Quest_Extra2)];
  c.attack = {
    type: n(P.CurrentAttackType), ma: n(P.CurrentAttackMA), spellNum: n(P.CurrentAttackSpellNum),
    spellLvl: n(P.CurrentAttackSpellLVL), manual: n(P.CurrentAttackManual),
    manualMag: n(P.CurrentAttackManualMag), healType: n(P.nGlobalAttackHealType),
    healSpellNum: n(P.nGlobalAttackHealSpellNum), healSpellLvl: n(P.nGlobalAttackHealSpellLVL),
    healManual: n(P.nGlobalAttackHealManual), healRounds: n(P.nGlobalAttackHealRounds),
    useMeditate: flag(P.bGlobalAttackUseMeditate), backstab: flag(P.bGlobalAttackBackstab),
    backstabWeapon: n(P.nGlobalAttackBackstabWeapon),
  };
  const adj = String(P.char_StatAdjustments || '').split(',');
  c.statAdjustments = c.statAdjustments.map((_, i) => n(adj[i]));
  c.equipped = EQ_SLOTS.map(s => n(I[s]));
  c.itemManager = [...imRows(itemQtys(I.IM_CARRIED), 'CARRIED'), ...imRows(itemQtys(I.IM_STASH), 'STASH')];
  c.wornInGame = c.equipped.slice();
  c.bless = c.bless.map((_, i) => n(B['Bless' + i]));
  c.learnedSpells = Object.keys(L).map(k => n(L[k])).filter(x => x);
  c.compare = { weapons: nums(C.WeaponCompare), armour: nums(C.ArmourCompare),
    spells: nums(C.SpellCompare), monsters: nums(C.MonsterCompare) };
  c.monsterFilter = { ...(ini.MonsterFilter || {}) };
  c.dataFile = P.DataFileVer || '';
  return c;
}

export function toMMEC(c, dataFileVer = '') {
  const b = x => (x ? 1 : 0);
  const P = {
    DataFileVer: dataFileVer || c.dataFile || '',
    Class: c.cls, Race: c.race, Level: c.level, Alignment: c.alignment,
    GlobalMinLVL: c.globalMinLevel, Name: c.name,
    Strength: c.stats.str, Intellect: c.stats.int, Widsom: c.stats.wis, Agility: c.stats.agi,
    Health: c.stats.hea, Charm: c.stats.cha,
    WeaponVSCharAC: c.weaponVsChar.ac, WeaponVSCharDR: c.weaponVsChar.dr,
    WeaponVSCharDodge: c.weaponVsChar.dodge, SpellVSMR: c.spellVsMR,
    AddWeight: c.addWeight, UseAddWeight: b(c.useAddWeight),
    MR: c.mr, AntiMagic: b(c.antiMagic), UnequipMissing: b(c.unequipMissing),
  };
  c.quests.forEach((q, i) => { P['Quest' + i] = q; });
  [P.Quest_2nd, P.Quest_6th, P.Quest_Extra1, P.Quest_Extra2] = c.questOpts;
  const a = c.attack;
  Object.assign(P, {
    CurrentAttackType: a.type, CurrentAttackMA: a.ma, CurrentAttackSpellNum: a.spellNum,
    CurrentAttackSpellLVL: a.spellLvl, CurrentAttackManual: a.manual, CurrentAttackManualMag: a.manualMag,
    nGlobalAttackHealType: a.healType, nGlobalAttackHealSpellNum: a.healSpellNum,
    nGlobalAttackHealSpellLVL: a.healSpellLvl, nGlobalAttackHealManual: a.healManual,
    bGlobalAttackUseMeditate: b(a.useMeditate), bGlobalAttackBackstab: b(a.backstab),
    nGlobalAttackHealRounds: a.healRounds, nGlobalAttackBackstabWeapon: a.backstabWeapon,
    char_StatAdjustments: c.statAdjustments.join(','),
  });
  const I = {};
  EQ_SLOTS.forEach((s, i) => { I[s] = c.equipped[i] || 0; });
  const qtys = l => l.slice(0, 50).map(e => `${e.item}|${e.qty},`).join('');
  I.IM_CARRIED = qtys(imCarried(c));
  I.IM_STASH = qtys(imStash(c));
  const B = {};
  c.bless.forEach((s, i) => { B['Bless' + i] = s; });
  const L = {};
  for (let i = 0; i < 100; i++) L['LearnedSpell' + i] = c.learnedSpells[i] || 0;
  const list = l => l.map(x => x + ',').join('');
  return writeINI({
    PlayerInfo: P, MonsterFilter: c.monsterFilter, Inventory: I, Bless: B, LearnedSpells: L,
    Compare: { WeaponCompare: list(c.compare.weapons), ArmourCompare: list(c.compare.armour),
      SpellCompare: list(c.compare.spells), MonsterCompare: list(c.compare.monsters) },
  });
}
