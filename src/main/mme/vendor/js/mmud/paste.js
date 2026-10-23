// Paste Character: read MajorMUD's `stat`, `inventory` and `spells` output
// into the character model.
//
// Ported from frmMain.PasteCharacter / PasteSpells / PasteInventoryManager,
// modMMudFunc.TestPasteChar, modSyntaxsFunc.ExtractValueFromString and the
// inventory parser in modItemParse.bas (ParseGameTextInventory and helpers).
// DOM-free: parsePaste() reads the text, applyPaste() works out the changes.

import { by, db } from '../db.js';
import { engine } from './engine.js';
import { settings } from '../state.js';
import { spellUsableBy } from './usable.js';
import { carriedItems, itemIsCarryActive, itemSlots } from './charstats.js';

// ---------------------------------------------------------------- text helpers

const removeSpaces = s => s.replace(/ /g, '');

// modMMudFunc.TestPasteChar: the characters the equipment scan keeps.
const PASTE_CHAR = /^[a-z0-9()\-_,: '".`]$/i;
export const testPasteChar = ch => PASTE_CHAR.test(ch);

// modSyntaxsFunc.ExtractValueFromString: the number after `label`
// (case-insensitive), skipping leading spaces and "*".
export function extractValue(text, label) {
  let x = text.toLowerCase().indexOf(label.toLowerCase());
  if (x < 0) return 0;
  x += label.length;
  let y = x;
  while (y < text.length) {
    const ch = text[y];
    if (ch >= '0' && ch <= '9') { /* digit */ }
    else if (ch === ' ' || ch === '*') { if (y > x) break; x++; }
    else break;
    y++;
  }
  return y > x ? parseInt(text.slice(x, y), 10) || 0 : 0;
}

// frmMain.PastedStatIsBuffed: is the value after `label` asterisked?
export function pastedStatIsBuffed(text, label) {
  let x = text.toLowerCase().indexOf(label.toLowerCase());
  if (x < 0) return false;
  for (x += label.length; x < text.length; x++) {
    if (text[x] === ' ') continue;
    return text[x] === '*';
  }
  return false;
}

// The "Race: " / "Class: " / "Name: " field readers in PasteCharacter: the text
// up to the next label on the line (if it's close), else to the line end.
function fieldAfter(text, label, next, maxGap) {
  let x = text.indexOf(label);
  if (x < 0) return '';
  x += label.length;
  let y = text.indexOf(next, x);
  if (y > x + maxGap) y = -1;
  if (y >= 0 && text.slice(x, y).trim().includes('\n')) y = -1;
  if (y < 0) y = text.indexOf('\r', x);
  if (y < 0) y = text.indexOf('\n', x);
  return y > x ? text.slice(x, y).trim() : '';
}

// ---------------------------------------------------------------- equipment scan

// PasteCharacter's slot scan. Returns equipLoc[20] (names with spaces removed,
// by EQ slot index) and worn[2], plus whether an inventory header was seen.
export const SLOT_WORDS = { HEAD: 0, EARS: 1, EYES: 17, FACE: 18, NECK: 2, BACK: 3, TORSO: 4, ARMS: 5,
  WAIST: 11, HANDS: 8, LEGS: 12, FEET: 13, 'OFF-HAND': 15, WEAPONHAND: 16, TWOHANDED: 16 };

export function scanEquipment(text) {
  const loc = new Array(20).fill('');
  const worn = ['', ''];
  let s = '', paren = -1, pastedInven = false;
  const clear = () => { s = ''; paren = -1; };
  for (const ch of text) {
    if (!testPasteChar(ch)) continue;
    s = removeSpaces(s + ch);
    const low = s.toLowerCase();
    if (low.includes('equippedwith:')) { clear(); continue; }
    if (low.includes('arecarrying')) { pastedInven = true; clear(); continue; }
    if (ch === ',') { clear(); continue; }
    if (ch === '(') { paren = s.length; continue; }
    if (ch !== ')') continue;
    if (paren === -1) { clear(); continue; }
    const where = s.slice(paren, s.length - 1).toUpperCase();
    const name = s.slice(0, paren - 1);
    if (where in SLOT_WORDS) loc[SLOT_WORDS[where]] = name;
    else if (where === 'WRIST') { if (!loc[6]) loc[6] = name; else if (!loc[7]) loc[7] = name; }
    else if (where === 'FINGER') { if (!loc[9]) loc[9] = name; else if (!loc[10]) loc[10] = name; }
    else if (where === 'WORN') { if (!worn[0]) worn[0] = name; else if (!worn[1]) worn[1] = name; }
    clear();
  }
  return { loc, worn, pastedInven };
}

// ---------------------------------------------------------------- spells

// frmMain.PasteSpells, the parsing half: spell names from `spells` output.
// Returns { none: true } for "You have no spells/powers", else { names }.
export function parseSpellNames(text) {
  if (text.length < 10) return { names: [] };
  const low = text.toLowerCase();
  if (low.includes('you have no spells') || low.includes('you have no power')) return { none: true, names: [] };
  const names = [];
  const store = s => {
    if (s.length <= 17) return;
    s = s.trim().replace(/  /g, ' ').replace(/  /g, ' ').replace(/  /g, ' ');
    const a = s.trim().split(' ');
    if (a.length >= 4 && vbVal(a[0]) > 0 && (a[1] === '0' || vbVal(a[1]) > 0)) {
      names.push(a.slice(3).join(' ').trim());
    }
  };
  let s = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') { store(s); s = ''; continue; }
    s += ch;
    const l = s.toLowerCase();
    if (l.includes('you have the following spells:') || l.includes('you have the following powers:')
      || l.includes('level mana short spell name') || l.includes('level kai  short spell name')) { s = ''; continue; }
    if (i === text.length - 1) { store(s); s = ''; }
  }
  return { names: names.slice(0, 200) };
}
const vbVal = s => parseFloat(String(s).trim()) || 0;

// The matching half: learned spell numbers, in database order.
export function matchSpells(names, clsNum) {
  const out = [];
  const want = new Set(names);
  for (const sp of db.Spells) {
    const name = String(sp.Name || '').trim();
    if (!name || !String(sp.Short || '').trim()) continue;
    if (!spellUsableBy(sp, clsNum, 0, 0, true)) continue;
    if (want.has(name) && !out.includes(sp.Number)) out.push(sp.Number);
  }
  return out.slice(0, 100);
}

// ---------------------------------------------------------------- inventory (modItemParse)

const HDR_INV = 'You are carrying';
const HDR_KEYS = 'You have the following keys';
const HDR_NOKEY = 'You have no keys';
const HDR_NOTC = 'You notice';
const startsCI = (s, p) => s.slice(0, p.length).toLowerCase() === p.toLowerCase();
const squeeze = s => s.replace(/\s+/g, ' ').trim();
const isBracketLine = s => { const t = s.trim(); return t.length >= 2 && t[0] === '[' && t[t.length - 1] === ']'; };
const stripBrackets = s => s.replace(/\[[^\]]*\]/g, '');
function isCashItem(s) {
  const l = ' ' + s.trim().toLowerCase() + ' ';
  return /\s(gold crowns?|silver nobles?|copper farthings?|platinum pieces?|runic coins?)\s/.test(l);
}
function isEquippedItem(s) {
  if (!s.endsWith(')')) return false;
  const p = s.lastIndexOf(' (');
  return p >= 0 && p < s.length - 1;
}

function isSectionBoundary(line) {
  const l = line.trim().toLowerCase();
  if (!l) return true;
  for (const h of [HDR_INV, HDR_KEYS, HDR_NOKEY, HDR_NOTC, 'wealth:', 'encumbrance:', 'name:', 'race:', 'class:', 'also here:']) {
    if (l.startsWith(h.toLowerCase())) return true;
  }
  return l[0] === '[' || l.includes('obvious exits:') || l.includes('*combat');
}
function inlineBoundary(line) {
  const l = line.toLowerCase();
  let best = -1;
  for (const h of [HDR_KEYS, HDR_NOKEY, HDR_INV, HDR_NOTC, 'wealth:', 'encumbrance:', 'you have no keys']) {
    const p = l.indexOf(h.toLowerCase());
    if (p > 0 && (best < 0 || p < best)) best = p;
  }
  return best;
}

// Collect* in modItemParse: lines from `i` until the next section boundary.
function collect(lines, i, endTest) {
  let s = '', j = i;
  for (; j < lines.length; j++) {
    const line = lines[j].trim();
    if (endTest?.skip?.(line)) continue;
    if (j === i && endTest?.single?.(line)) { s = line; j++; break; }
    if (j !== i && isSectionBoundary(line)) break;
    const pos = inlineBoundary(line);
    if (pos > 0) {
      const left = line.slice(0, pos).trim();
      if (left) s += (s ? ' ' : '') + left;
      lines[j] = line.slice(pos);
      break;
    }
    s += (s ? ' ' : '') + line;
    if (endTest?.last?.(line)) { j++; break; }
  }
  return { blob: s, next: j - 1 };
}

const splitTokens = s => s.split(',').map(t => t.trim()).filter(Boolean);

// ParseCountAndName
function parseCountAndName(token, keys) {
  let s = token.trim();
  while (s && (s.endsWith('.') || s.endsWith(';'))) s = s.slice(0, -1).trimEnd();
  let trailing = 0;
  for (;;) {
    const c = s.lastIndexOf(')');
    if (c < 0) break;
    const o = s.lastIndexOf('(', c);
    if (o < 0 || o >= c) break;
    const inside = s.slice(o + 1, c).trim();
    if (inside !== '' && !isNaN(Number(inside))) { trailing = Math.trunc(Number(inside)); s = s.slice(0, o).trimEnd(); }
    else break;
  }
  let count = 1, name = s;
  const p = s.indexOf(' ');
  if (p > 0 && !isNaN(Number(s.slice(0, p)))) { count = Math.trunc(Number(s.slice(0, p))); name = s.slice(p + 1).trim(); }
  name = squeeze(name);
  if (count === 1 && trailing > 1) count = trailing;
  if (keys) {
    if (name.toLowerCase().endsWith(' keys')) name = name.slice(0, -1);
    if (name.toLowerCase().endsWith(' idols')) name = name.slice(0, -1);
    if (count > 1) name = singularize(name);
  }
  return { name: name.toLowerCase(), count };
}
// SingularizeSimple
function singularize(s) {
  s = s.trim();
  const L = s.length;
  if (!L) return s;
  if (L >= 3 && s.endsWith('ies')) return s.slice(0, -3) + 'y';
  if (L >= 2 && s.endsWith('es') && (s.endsWith('sses') || s.endsWith('ches') || s.endsWith('shes') || s.endsWith('xes'))) return s.slice(0, -2);
  if (L >= 2 && s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}
// ConsolidateList: "name" or "name (N)", lower case, duplicates summed.
function consolidate(list, keys) {
  const m = new Map();
  for (const t of list) {
    if (!t) continue;
    const { name, count } = parseCountAndName(t, keys);
    m.set(name, (m.get(name) || 0) + count);
  }
  return [...m].map(([n, c]) => (c > 1 ? `${n} (${c})` : n));
}

// ParseNameAndQty: "name (N)" -> { name, qty }
export function parseNameAndQty(raw) {
  let s = raw.trim(), trailing = 0;
  for (;;) {
    const c = s.lastIndexOf(')');
    if (c < 0 || c !== s.length - 1) break;
    const o = s.lastIndexOf('(', c);
    if (o < 0 || o >= c) break;
    const inside = s.slice(o + 1, c).trim();
    if (inside !== '' && !isNaN(Number(inside))) { trailing = Math.trunc(Number(inside)); s = s.slice(0, o).trimEnd(); }
    else break;
  }
  return { name: s, qty: trailing > 0 ? trailing : 1 };
}
// NormalizeEquippedName: "Item (Slot)" -> "Item"
export function normalizeEquippedName(raw) {
  const s = raw.trim(), c = s.lastIndexOf(')');
  if (c > 0 && c === s.length - 1) {
    const o = s.lastIndexOf('(', c);
    if (o > 0) return s.slice(0, o).trim();
  }
  return s;
}

const MOVES = new Set(['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se', 'north', 'south', 'east', 'west',
  'northwest', 'northeast', 'southwest', 'southeast']);
function isMovement(line) {
  let s = line.trim().toLowerCase();
  const p = s.indexOf(']:');
  if (p >= 0) s = s.slice(p + 2);
  return MOVES.has(s.trim());
}

// ConsolidateGroundByRoom: "You notice ..." per room, MAX within a room, SUM across rooms.
function groundByRoom(all) {
  const v = all.replace(/\r/g, '').split('\n');
  const rooms = new Map();
  let roomName = '', exits = '', pending = '';
  const addNotice = (key, span) => {
    if (!rooms.has(key)) rooms.set(key, new Map());
    const r = rooms.get(key);
    if (startsCI(span, HDR_NOTC)) span = span.slice(HDR_NOTC.length).trim();
    if (span.toLowerCase().endsWith('here.')) span = span.slice(0, -5);
    for (const t of splitTokens(squeeze(stripBrackets(span)))) {
      if (isCashItem(t)) continue;
      const { name, qty } = parseNameAndQty(t);
      const n = name.toLowerCase();
      r.set(n, Math.max(r.get(n) || 0, Math.max(1, qty)));
    }
  };
  const key = () => (exits ? `${roomName.trim()}||${exits.trim()}`.toLowerCase() : '__unknown||__unknown');
  for (let i = 0; i < v.length; i++) {
    const line = v[i].trim();
    if (!line) continue;
    if (isMovement(line)) {
      if (pending) { addNotice(key(), pending); pending = ''; }
      roomName = exits = '';
      continue;
    }
    if (!startsCI(line, HDR_NOTC) && !startsCI(line, 'also here:') && !line.toLowerCase().includes('obvious exits:')
      && line[0] !== '[' && !['name:', 'race:', 'class:', HDR_INV, HDR_KEYS, HDR_NOKEY].some(h => startsCI(line, h))) {
      roomName = line;
    }
    if (startsCI(line, HDR_NOTC)) {
      let span = line;
      while (i < v.length - 1 && !v[i].trim().toLowerCase().endsWith('here.')) { i++; span += ' ' + v[i].trim(); }
      pending = squeeze(stripBrackets(span));
      continue;
    }
    if (line.toLowerCase().includes('obvious exits:')) {
      exits = line;
      if (pending) { addNotice(key(), pending); pending = ''; }
    }
  }
  if (pending) addNotice(key(), pending);
  const tot = new Map();
  for (const r of rooms.values()) for (const [n, c] of r) tot.set(n, (tot.get(n) || 0) + c);
  return [...tot].map(([n, c]) => (c > 1 ? `${n} (${c})` : n));
}

// modItemParse.ParseGameTextInventory -> { equipped, inventory, keys, ground }
export function parseGameTextInventory(input) {
  const out = { equipped: [], inventory: [], keys: [], ground: [] };
  const norm = input.replace(/\r/g, '');
  const lines = norm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (startsCI(line, HDR_INV)) {
      const { blob, next } = collect(lines, i);
      i = next;
      let s = blob;
      if (startsCI(s, HDR_INV)) s = s.slice(HDR_INV.length).trim();
      for (const it of splitTokens(squeeze(s))) {
        if (isBracketLine(it) || isCashItem(it)) continue;
        (isEquippedItem(it) ? out.equipped : out.inventory).push(it);
      }
    } else if (startsCI(line, HDR_KEYS) || startsCI(line, HDR_NOKEY)) {
      const { blob, next } = collect(lines, i, {
        single: l => startsCI(l, 'you have no keys'),
        last: l => l.endsWith('.'),
      });
      i = next;
      let s = blob;
      if (startsCI(s, HDR_NOKEY)) continue;
      if (startsCI(s, HDR_KEYS)) { s = s.slice(HDR_KEYS.length).trim(); if (s[0] === ':') s = s.slice(1).trim(); }
      if (s.toLowerCase().includes('no keys')) continue;
      s = s.trimEnd();
      if (s.endsWith('.')) s = s.slice(0, -1);
      out.keys.push(...splitTokens(squeeze(s)));
    } else if (startsCI(line, HDR_NOTC)) {
      const { next } = collect(lines, i, { skip: isBracketLine, last: l => l.toLowerCase().endsWith('here.') });
      i = next;     // ground items are rebuilt per room below
    }
  }
  out.ground = groundByRoom(norm);
  out.inventory = consolidate(out.inventory, false);
  out.keys = consolidate(out.keys, true);
  const seen = new Set();
  out.equipped = out.equipped.filter(e => { const k = e.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return out;
}

// ItemNameInParseResult
export function itemNameInParse(p, name, { equipped = true, inventory = true, keys = true } = {}) {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (equipped && p.equipped.some(e => normalizeEquippedName(e).toLowerCase() === n)) return true;
  if (inventory && p.inventory.some(e => parseNameAndQty(e).name.toLowerCase() === n)) return true;
  if (keys && p.keys.some(e => parseNameAndQty(e).name.toLowerCase() === n)) return true;
  return false;
}

// GetItemsByExactNameArr (case-insensitive exact name), with its Gettable rule.
export function itemsByExactName(name, onlyInGame = settings.onlyInGame) {
  const n = name.trim().toLowerCase();
  const out = [];
  for (const it of db.Items) {
    if (onlyInGame && it['In Game'] === 0) continue;
    if (String(it.Name || '').trim().toLowerCase() !== n) continue;
    const from = String(it['Obtained From'] || '');
    const gettable = it.Gettable === 1 || /NPC #/i.test(from) || (/Textblock #/i.test(from) && !/Room /i.test(from));
    out.push({ item: it, gettable });
  }
  return out;
}

// ---------------------------------------------------------------- whole paste

// The parse half of PasteCharacter.
export function parsePaste(text) {
  const s = String(text || '');
  const scan = scanEquipment(s);
  const out = {
    text: s,
    ...scan,
    race: fieldAfter(s, 'Race: ', 'Exp:', 20),
    cls: fieldAfter(s, 'Class: ', 'Level:', 15),
    name: fieldAfter(s, 'Name: ', 'Lives/CP:', 35),
    level: extractValue(s, 'Level:'),
    encumbrance: extractValue(s, 'Encumbrance:'),
    stats: {},
    spells: parseSpellNames(s),
    inventory: scan.pastedInven ? parseGameTextInventory(s) : null,
  };
  for (const [k, label] of [['str', 'Strength:'], ['int', 'Intellect:'], ['wis', 'Willpower:'],
    ['agi', 'Agility:'], ['hea', 'Health:'], ['cha', 'Charm:']]) {
    out.stats[k] = { value: extractValue(s, label), buffed: pastedStatIsBuffed(s, label) };
  }
  const ac = extractValue(s, 'Armour Class:');
  out.ac = ac;
  out.dr = ac > 0 && String(ac).length <= 4 ? extractValue(s, 'Armour Class:' + ' '.repeat(4 - String(ac).length) + ac + '/') : 0;
  out.itemsFound = scan.loc.some(Boolean) || scan.worn.some(Boolean);
  out.hasSpellList = /ou have the following/i.test(s) || /short spell nam/i.test(s) || !!out.spells.none;
  out.empty = !out.name && !out.cls && !out.race && !out.itemsFound;
  return out;
}

// The apply half of PasteCharacter. Returns a new character plus a report:
// { char, messages[], buffed[{key, label, pasted, base}], setGlobalFilter, clsChanged }
// opts: { holds: bool[20], use2ndWrist, onlyInGame }
export function applyPaste(cIn, p, opts = {}) {
  const c = JSON.parse(JSON.stringify(cIn));
  const holds = opts.holds || [];
  const use2ndWrist = opts.use2ndWrist ?? true;
  const onlyInGame = opts.onlyInGame ?? settings.onlyInGame;
  const report = { messages: [], buffed: [], setGlobalFilter: false, spellsLearned: null, imAdded: 0 };

  if (!p.empty) {
    if (c.unequipMissing && p.itemsFound) c.equipped = c.equipped.map((n, x) => (holds[x] ? n : 0));
    if (p.level > 0) { c.level = p.level; report.setGlobalFilter = true; }
    if (p.name) c.name = p.name;
    if (p.race) { const r = db.Races.find(x => x.Name === p.race); if (r) c.race = r.Number; }
    if (p.cls) {
      const k = db.Classes.find(x => x.Name === p.cls);
      if (k) { report.clsChanged = cIn.cls > 0 && cIn.cls !== k.Number; c.cls = k.Number; report.setGlobalFilter = true; }
    }

    // match equipped names against the item table
    let enc = p.encumbrance;
    const loc = p.loc.slice();
    for (const it of db.Items) {
      if (onlyInGame && it['In Game'] === 0) continue;
      const t = removeSpaces(String(it.Name || ''));
      for (let x = 0; x < 20; x++) {
        if ((x === 14 || x === 19) && (t === p.worn[0] || t === p.worn[1])) {
          if (it.Worn === 1) loc[19] = t;
          else if (it.Worn === 16) loc[14] = t;
        }
        if (t !== loc[x]) continue;
        if ((x === 14 && it.Worn === 1) || (x === 19 && it.Worn === 16)) continue;
        if (x === 7 && !use2ndWrist) break;
        if (!itemSlots(it).includes(x)) break;      // InvenAddEquip couldn't list it here
        enc = enc > 0 ? enc - it.Encum : 0;
        loc[x] = '';
        if (!holds[x]) c.equipped[x] = it.Number;
        break;
      }
    }

    // pasted stats include item bonuses; only GreaterMUD items add stats
    if (engine.greater) { /* TODO GreaterMUD: AccumItemStatBonus for equipped and carry-active items */ }
    for (const [k, label] of [['str', 'Strength'], ['int', 'Intellect'], ['wis', 'Willpower'],
      ['agi', 'Agility'], ['hea', 'Health'], ['cha', 'Charm']]) {
      const { value, buffed } = p.stats[k];
      if (value < 1) continue;
      const base = Math.max(1, value - 0);
      if (!buffed) c.stats[k] = base;
      else if (c.stats[k] !== base) report.buffed.push({ key: k, label, pasted: value, base });
    }

    // what's left of the reported weight is carried stuff we don't track
    const inv = p.inventory;
    if (enc > 0) {
      for (const r of c.itemManager) {
        if (r.flag !== 'CARRIED') continue;
        const it = by.item.get(r.item);
        if (!it) continue;
        if (inv && !itemNameInParse(inv, it.Name, { equipped: false })) continue;
        enc -= it.Encum * Math.max(1, r.qty || 1);
      }
    }
    if (enc > 0) { c.addWeight = enc; c.useAddWeight = true; }

    if (inv) {
      const missing = [], equippedToo = [];
      for (const r of c.itemManager) {
        if (r.flag !== 'CARRIED') continue;
        const it = by.item.get(r.item);
        if (!it) continue;
        if (itemNameInParse(inv, it.Name, { equipped: false })) continue;
        if (itemNameInParse(inv, it.Name, { inventory: false, keys: false })) equippedToo.push(it.Name);
        else missing.push(it.Name);
      }
      if (missing.length) report.messages.push('Flagged CARRIED on the Item Manager but NOT in the pasted inventory (their weight was not counted toward encumbrance): ' + missing.join(', '));
      if (equippedToo.length) report.messages.push('Flagged CARRIED on the Item Manager but EQUIPPED in the pasted inventory: ' + equippedToo.join(', '));
    }
  }

  // spells
  if (p.spells.none) { c.learnedSpells = []; report.spellsLearned = 0; }
  else if (p.spells.names.length) {
    const nums = matchSpells(p.spells.names, c.cls);
    if (nums.length) { c.learnedSpells = nums; report.spellsLearned = nums.length; }
  }

  // inventory -> Item Manager (PasteInventoryManager with sExtraInventoryOnly)
  if (!p.empty && p.inventory) report.imAdded = addInventoryToIM(c, p.inventory.inventory, 'Inventory', onlyInGame);

  report.char = c;
  return report;
}

// modItemParse.AddSectionItems: add Item Manager rows for one section of a
// parsed paste. Inventory rows top up quantities already listed. MME picks the
// record for a name by shop price; here it's the lowest-numbered gettable one.
export function addSectionToIM(c, list, section, { equippedSection = false, keySection = false, onlyInGame = settings.onlyInGame } = {}) {
  let added = 0;
  for (const raw of list) {
    let name, qty;
    if (equippedSection) { name = normalizeEquippedName(raw); qty = 1; }
    else ({ name, qty } = parseNameAndQty(raw));
    if (!name) continue;
    const hits = itemsByExactName(name, onlyInGame).filter(h => h.gettable);
    if (!hits.length) continue;
    const it = hits.sort((a, b) => a.item.Number - b.item.Number)[0].item;
    if (section === 'Inventory' && !keySection) {
      const have = c.itemManager.filter(r => r.item === it.Number).reduce((n, r) => {
        if (/^inventory/i.test(r.source || '')) return n + (r.fieldQty || 0);
        if (r.flag === 'CARRIED') return n + Math.max(1, r.qty || 1);
        return n;
      }, 0);
      if (have >= qty) continue;
      qty -= have;
    }
    c.itemManager.push({ item: it.Number, flag: '', qty: 1, fieldQty: qty, source: section, ...(keySection ? { key: true } : {}) });
    added++;
  }
  return added;
}
export const addInventoryToIM = (c, list, source = 'Inventory', onlyInGame = settings.onlyInGame) =>
  addSectionToIM(c, list, source, { onlyInGame });

// modItemParse.PopulateItemManagerFromParsed (the prompts are the caller's:
// opts.equipped / opts.keys / opts.clearUnflagged).
export function populateIM(c, parsed, { equipped = true, keys = true, clearUnflagged = false, onlyInGame = settings.onlyInGame } = {}) {
  if (clearUnflagged) c.itemManager = c.itemManager.filter(r => r.flag);
  let n = 0;
  if (equipped) n += addSectionToIM(c, parsed.equipped, 'Equipped', { equippedSection: true, onlyInGame });
  if (keys) n += addSectionToIM(c, parsed.keys, 'Inventory', { keySection: true, onlyInGame });
  n += addSectionToIM(c, parsed.ground, 'Ground', { onlyInGame });
  n += addSectionToIM(c, parsed.inventory, 'Inventory', { onlyInGame });
  return n;
}

export { carriedItems, itemIsCarryActive, itemSlots };
