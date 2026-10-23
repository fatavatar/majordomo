// The room map: exit parsing, the grid MME draws (frmMap.MapStartMapping /
// MapMapExits / MapActivateCell), each room's tooltip and references
// (MapGetRoomLoc), "what leads here" and the room finders. DOM-free; the
// Rooms tab draws what buildMap returns.

import { db, by, roomKey, itemName, monsterName, shopName, spellName, className, raceName } from '../db.js';
import { engine } from './engine.js';
import { settings } from '../state.js';
import {
  instr, mid, vbVal, extractValue, textblockCMDS, textblockHasTeleport, textblockTeleport,
  roomTeleports, roomLabel,
} from './textblocks.js';
import { A } from './enums.js';
import { getCurrentSpellMinMax } from './spellcalc.js';

export const DIRS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'U', 'D'];
export const DIR_NAMES = { N: 'north', S: 'south', E: 'east', W: 'west', NE: 'northeast', NW: 'northwest',
  SE: 'southeast', SW: 'southwest', U: 'up', D: 'down' };

export const getRoom = (map, room) => by.room.get(roomKey(map, room)) || null;

// modMMudFunc.ExtractMapRoom: "12/77 (Key: 1124 ...)" -> {map:12, room:77, type:"(Key: 1124 ...)"}.
// type starts as "0" (VB assigns 0 to the String) when there's nothing after the room.
export function extractMapRoom(s) {
  s = String(s ?? '');
  const out = { map: 0, room: 0, type: '0' };
  let x = instr(1, s, '/');
  let i = 0;
  while (x - 1 > 0) {
    const c = mid(s, x - 1, 1);
    if (c >= '0' && c <= '9') i = x - 1; else break;
    x--;
  }
  x = instr(1, s, '/');
  if (!x || x === s.length || !i) return out;
  out.map = vbVal(mid(s, i, x - 1));
  const y = instr(x, s, ' ');
  if (!y) out.room = vbVal(mid(s, x + 1));
  else {
    out.room = vbVal(mid(s, x + 1, y - 1));
    out.type = mid(s, y + 1);
  }
  return out;
}

// The nExitType codes MME assigns from the first five characters of an exit's
// type (MapMapExits and friends). 8 (map change) is set by the caller.
export const EXIT = Object.freeze({
  NORMAL: 0, KEY: 2, ITEM: 3, TOLL: 4, HIDDEN: 6, DOOR: 7, MAPCHANGE: 8, TRAP: 9, TEXT: 10, GATE: 11,
  ACTION: 12, CLASS: 13, RACE: 14, LEVEL: 15, TIMED: 16, TICKET: 17, MAX: 18, BLOCKED: 19, ALIGN: 20,
  DELAY: 21, CAST: 22, ABILITY: 23, SPELLTRAP: 24,
});
const PREFIX = {
  '(Key:': 2, '(Item': 3, '(Toll': 4, '(Hidd': 6, '(Door': 7, '(Trap': 9, '(Text': 10, '(Gate': 11,
  'Actio': 12, '(Clas': 13, '(Race': 14, '(Leve': 15, '(Time': 16, '(Tick': 17, '(Max ': 18, '(Bloc': 19,
  '(Alig': 20, '(Dela': 21, '(Cast': 22, '(Abil': 23, '(Spel': 24,
};
export function exitTypeCode(type) {
  type = String(type ?? '');
  return type.length > 2 ? (PREFIX[type.slice(0, 5)] ?? 0) : 0;
}

// The ten exits of a room row, parsed:
//   { dir, i, raw, action: true }                    an "Action#n [...]" remote command
//   { dir, i, raw, map, room, type, code }           a real exit (code 8 = map change)
//   null                                             no exit
export function roomExits(row) {
  return DIRS.map((dir, i) => {
    const raw = String(row[dir] ?? '');
    if (raw.startsWith('Action')) return { dir, i, raw, action: true };
    if (vbVal(raw) === 0) return null;
    const e = extractMapRoom(raw);
    let code = exitTypeCode(e.type);
    if (e.map !== row['Map Number']) code = EXIT.MAPCHANGE;
    return { dir, i, raw, map: e.map, room: e.room, type: e.type, code };
  });
}

// ---------------------------------------------------------------- the grid

// Map sizes: frmMain's built-in map, then frmMap's cmbMapSize list. cols x rows,
// the start cell (row-major, 0-based) and whether it uses the zoomed cells.
export const MAP_SIZES = [
  { id: 'main', label: '30×23', cols: 30, rows: 23, center: 11 * 30 + 14, zoom: false },
  { id: '20', label: '20×20', cols: 20, rows: 20, center: 10 * 20 + 9, zoom: false },
  { id: '30', label: '30×30', cols: 30, rows: 30, center: 15 * 30 + 14, zoom: false },
  { id: '50x31', label: '50×31', cols: 50, rows: 31, center: 15 * 50 + 24, zoom: false },
  { id: '50', label: '50×50', cols: 50, rows: 50, center: 25 * 50 + 24, zoom: false },
  { id: 'z21', label: '21×21 zoom', cols: 21, rows: 21, center: 10 * 21 + 10, zoom: true },
  { id: 'z28', label: '28×28 zoom', cols: 28, rows: 28, center: 13 * 28 + 14, zoom: true },
];

// QBColor() palette, which the map is drawn in.
export const QB = ['#000000', '#000080', '#008000', '#008080', '#800000', '#800080', '#808000', '#c0c0c0',
  '#808080', '#0000ff', '#00ff00', '#00ffff', '#ff0000', '#ff00ff', '#ffff00', '#ffffff'];
export const QBC = Object.freeze({ Black: 0, Blue: 1, Green: 2, Cyan: 3, Red: 4, Magenta: 5, Yellow: 6, White: 7,
  Grey: 8, BrightBlue: 9, BrightGreen: 10, BrightCyan: 11, BrightRed: 12, BrightMagenta: 13, BrightYellow: 14, BrightWhite: 15 });

// Cell colours (lblRoomCell.BackColor, VB's BGR written as RGB).
export const CELL = Object.freeze({ PLAIN: '#c0c0c0', UP: '#00ff00', DOWN: '#ffff00', BOTH: '#00ffff', UNSEEN: '#000000' });

// MapActivateCell's line colours by exit code.
export function exitLineColor(code) {
  switch (code) {
    case 2: case 3: case 4: return 10;    // key / item / toll
    case 5: return 11;                    // action
    case 6: return 5;                     // hidden
    case 7: case 11: return 9;            // door / gate
    case 8: return 13;                    // map change
    case 9: case 24: return 12;           // trap / spell trap
    case 10: return 14;                   // text
    case 12: return 11;                   // remote action
    case 13: case 14: case 15: case 20: case 23: return 4;   // class / race / level / alignment / ability
    case 16: return 2;                    // timed
    default: return 8;
  }
}

export const MAP_OPTIONS = {
  followMap: false,     // chkMapOptions(0) "Follow map changes"
  noHidden: false,      // (1) don't follow hidden exits
  noLairs: false,       // (2) don't mark lairs
  noNPC: false,         // (3) don't mark NPCs
  noCMD: false,         // (4) don't mark room commands
  dupes: false,         // (9) allow a room drawn twice
  overwrite: false,     // (10) allow cells to be overwritten
  noRestricted: false,  // (12) don't follow class/race/level restricted exits
  alsoMark: 0,          // optAlsoMark: 0 none, 1 shops, 2 room spells, 3 rooms MegaMUD knows
};

// frmMap.MapStartMapping: lay rooms out on the grid by walking exits outward
// from the start room, in MME's order, so the same rooms land in the same
// cells. Returns { cols, rows, center, cells } where cells[i] is null or
//   { map, room, row, color, marks: [{shape, size, color}], lines: [{dir, color}], draw, alt }
// marks and lines are MapDrawOnRoom's calls; `draw` has both in call order
// ({shape: 'square'|'star'|'circle'|'opencircle'|<direction>, size, color}),
// drawn under the cell as MME draws on the picture box behind its labels. `known(map, room)` says
// whether MegaMUD knows a room (optAlsoMark 3).
export function buildMap(startMap, startRoom, size = MAP_SIZES[0], opts = {}, centerCell = null, known = null) {
  const o = { ...MAP_OPTIONS, ...opts };
  const { cols, rows } = size;
  const N = cols * rows;
  const center = centerCell ?? size.center;
  const cellRoom = new Array(N).fill(null);           // {map, room}
  const unch = new Int8Array(N);                        // 0 uncharted, 1 needs charting, 2 charted
  const alt = new Array(N).fill(null);                  // ALT_CellRoom
  const altUnch = new Int8Array(N);
  const cells = new Array(N).fill(null);
  let passes = 0;

  const cell = i => cells[i] || (cells[i] = { map: 0, room: 0, row: null, color: CELL.UNSEEN, marks: [], lines: [], draw: [], alt: null });
  const mark = (i, shape, size, color) => { const m = { shape, size, color }; cell(i).marks.push(m); cell(i).draw.push(m); };
  const line = (i, dir, color) => { const l = { dir, color }; cell(i).lines.push(l); cell(i).draw.push({ shape: dir, size: 4, color }); };
  const same = (a, b) => a && b && a.map === b.map && a.room === b.room;
  const clearCell = i => { cellRoom[i] = null; unch[i] = 0; altUnch[i] = 0; alt[i] = null; };

  // MapActivateCell: the cell an exit leads to, -1 for none, or {over: i}
  // when "allow overwrite" lets it replace a charted cell.
  function activate(from, d, code) {
    const r = Math.floor(from / cols), c = from % cols;
    const dr = [-1, 1, 0, 0, -1, -1, 1, 1][d], dc = [0, 0, 1, -1, 1, -1, 1, -1][d];
    if (d >= 8) return -1;
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) { line(from, DIRS[d], QBC.Grey); return -1; }
    const to = nr * cols + nc;
    line(from, DIRS[d], exitLineColor(code));
    if (code === EXIT.ACTION) return -1;
    if (code === EXIT.MAPCHANGE && !o.followMap) return -1;
    if (unch[to] === 2 && o.overwrite && !alt[to]) return { over: to };
    if (unch[to] === 2) return -1;
    return to;
  }

  // MapMapExits
  function chart(i, map, room) {
    cellRoom[i] = { map, room };
    const c = cell(i);
    c.map = map; c.room = room;
    const row = getRoom(map, room);
    c.row = row;
    if (!row) { unch[i] = 2; mark(i, 'square', 8, QBC.BrightRed); return; }
    if (passes > 0 && alt[i]) mark(i, 'square', 4, QBC.Black);

    if (!o.noCMD && row.CMD > 0) mark(i, 'square', 4, QBC.BrightGreen);
    if (!o.noNPC && row.NPC > 0) mark(i, 'opencircle', 2, QBC.BrightRed);
    if (!o.noLairs && String(row.Lair || '').length > 1) mark(i, 'circle', 4, QBC.BrightMagenta);
    if (row.Shop > 2 && o.alsoMark === 1) mark(i, 'star', 2, QBC.BrightCyan);
    if (row.Spell > 0 && o.alsoMark === 2) mark(i, 'star', 2, QBC.BrightCyan);

    for (const e of roomExits(row)) {
      if (!e) continue;
      if (e.action) { if (!o.noCMD) mark(i, 'square', 6, QBC.BrightGreen); continue; }
      let to = -1;
      if (e.code !== EXIT.ACTION) { to = activate(i, e.i, e.code); if (to === -1) continue; }
      if (e.code === EXIT.ACTION) { if (!o.noCMD) mark(i, 'square', 6, QBC.BrightGreen); continue; }
      if (e.code === EXIT.HIDDEN && o.noHidden) continue;
      if (e.code === EXIT.MAPCHANGE && !o.followMap) continue;
      if (e.code >= 13 && e.code <= 15 && o.noRestricted) continue;
      const dest = { map: e.code === EXIT.MAPCHANGE ? e.map : map, room: e.room };
      if (typeof to === 'object') {
        const t = to.over;
        if (!same(cellRoom[t], { map, room: e.room })) { altUnch[t] = 1; alt[t] = dest; }
        continue;
      }
      cellRoom[to] = dest;
      if (unch[to] === 0) unch[to] = 1;
    }

    if (known && known(map, room) && o.alsoMark === 3) mark(i, 'star', 2, QBC.BrightCyan);

    const up = vbVal(row.U) !== 0, down = vbVal(row.D) !== 0;
    c.color = up && down ? CELL.BOTH : up ? CELL.UP : down ? CELL.DOWN : CELL.PLAIN;
    if (passes > 0 && alt[i]) { mark(i, 'square', 4, QBC.BrightYellow); c.alt = alt[i]; }
    unch[i] = 2;
  }

  cellRoom[center] = { map: startMap, room: startRoom };
  chart(center, startMap, startRoom);

  let delaying = o.dupes;
  for (;;) {
    let again = false;
    for (let x = 0; x < N; x++) {
      if (unch[x] !== 1) continue;
      let skip = false;
      if (!o.dupes || delaying) {
        for (let y = 0; y < N && cellRoom[x]; y++) {
          if (x !== y && same(cellRoom[y], cellRoom[x])) {
            if (delaying) { skip = true; break; }
            clearCell(x);
          }
        }
      }
      if (skip) continue;
      if (cellRoom[x] && cellRoom[x].map > 0 && cellRoom[x].room > 0) {
        chart(x, cellRoom[x].map, cellRoom[x].room);
        again = true;
      }
    }
    if (again) continue;
    if (delaying) { delaying = false; continue; }
    if (o.overwrite && passes < N) {
      let swapped = false;
      for (let x = 0; x < N; x++) {
        if (altUnch[x] === 1 && alt[x]) {
          if (x === center) { altUnch[x] = 0; alt[x] = null; }
          else if (!same(cellRoom[x], alt[x])) {
            swapped = true;
            unch[x] = altUnch[x];
            altUnch[x] = 0;
            const t = cellRoom[x];
            cellRoom[x] = alt[x];
            alt[x] = t;
          }
        }
      }
      if (swapped) { passes++; continue; }
    }
    break;
  }

  mark(center, 'square', 6, QBC.BrightBlue);
  // only cells that hold a room are shown
  for (let i = 0; i < N; i++) if (cells[i] && !cellRoom[i]) cells[i] = null;
  for (let i = 0; i < N; i++) if (cellRoom[i] && !cells[i]) { const c = cell(i); c.map = cellRoom[i].map; c.room = cellRoom[i].room; }
  return { cols, rows, center, cells, zoom: !!size.zoom };
}

// ---------------------------------------------------------------- lairs

// The Lair column: "(Max 2): 802,832,882,923,[29-13-13-2]". From NMR 1.83 the
// last element is the group index and max regen.
export function parseLair(s) {
  s = String(s ?? '');
  const out = { groupIndex: '', maxRegen: 0, mobs: [] };
  if (s.length <= 1) return out;
  if (engine.nmrVersion >= 1.83) {
    const parts = s.split(',');
    const gi = parts[parts.length - 1];
    if (gi.length >= 9) {
      const a = gi.slice(1, -1).split('-');
      if (a.length === 4) { out.groupIndex = a.slice(0, 3).join('-'); out.maxRegen = vbVal(a[3]); }
    }
  }
  out.mobs = lairMobs(s);
  if (!out.maxRegen) {
    const t1 = instr(1, s, 'Max ', true), t2 = instr(1, s, ':');
    if (t1 && t2) out.maxRegen = vbVal(mid(s, t1 + 4, t2 - t1 - 5));
  }
  return out;
}

// The comma-terminated monster numbers after "): " (MapGetRoomLoc's loop).
export function lairMobs(s) {
  const nums = mid(s, instr(1, s, ':') + 2);
  const out = [];
  let x = 0;
  for (;;) {
    const y = instr(x + 1, nums, ',');
    if (!y) break;
    const n = vbVal(mid(nums, x + 1, y - x - 1));
    if (n) out.push(n);
    x = y;
  }
  return out;
}

let lairIdx = null;
export function lairInfo(groupIndex) {
  if (!lairIdx || lairIdx.size !== db.Lairs.length) {
    lairIdx = new Map();
    for (const l of db.Lairs) lairIdx.set(l.GroupIndex, l);
  }
  return lairIdx.get(groupIndex) || null;
}

// modMMudDatabase.GetMultiMonsterNames: "Name(1), Name(2)" for a comma-terminated list.
export function multiMonsterNames(numbers, hideNumber = false) {
  if (!numbers) return 'None';
  const out = [];
  let x = 0;
  for (;;) {
    const y = instr(x + 1, numbers, ',');
    if (!y) break;
    const m = by.monster.get(vbVal(mid(numbers, x + 1, y - x - 1)));
    if (m) out.push(m.Name + (hideNumber ? '' : `(${m.Number})`));
    x = y;
  }
  return out.join(', ');
}

// ---------------------------------------------------------------- tooltip

// Toll: in gold, shown in the largest coin it reaches (MapMapExits case 4).
export function tollText(type) {
  if (!type.startsWith('(Toll: ')) return type;
  const gold = Math.trunc(vbVal(type.slice(7)));
  let n = gold, coin = 'gold';
  if (gold >= 10000) { n = gold / 10000; coin = 'runic'; }
  else if (gold >= 100) { n = gold / 100; coin = 'platinum'; }
  return `(Toll: ${String(Math.round(n * 100) / 100)} ${coin})`;
}

const lightDesc = v => v < -200 ? 'The room is pitch black'
  : v < -150 ? "The room is very dark - you can't see anything"
  : v < -100 ? 'The room is barely visible'
  : v < 0 ? 'The room is dimly lit' : '';

// MapMapExits' tooltip for one room ("\n"-separated, blank lines between
// blocks). `illu` is the character's illumination (frmMain.lblInvenCharStat(23));
// `megaInfo` the MegaMUD rooms.md entries matching the room ([{code, group, name}]).
// `lairDamage(groupIndex, maxRegen)` gives the lair's "Dmg vs ..." line.
export function roomTooltip(row, opts = {}) {
  const o = { ...MAP_OPTIONS, showAllExits: false, illu: 0, ...opts };
  const map = row['Map Number'], room = row['Room Number'];
  const name = `${row.Name} (${map}/${room})`;
  let lightDetail = '', light = '';
  if (engine.nmrVersion >= 1.82 && row.Light) {
    const v = o.illu + row.Light;
    lightDetail = `Room Light: ${row.Light > 0 ? '+' : ''}${row.Light}`
      + (v < -150 ? ` (${Math.abs(150 + v)} more illu needed to see)` : ` (${150 + v} illu over req to see)`);
    light = lightDesc(v);
  }
  const roomCMDs = !o.noCMD && row.CMD > 0 ? 'Room commands: ' + textblockCMDS(row.CMD) : '';
  const npc = !o.noNPC && row.NPC > 0 ? monsterName(row.NPC) + ' (NPC)' : '';

  let placed = '';
  if (String(row.Placed || '').length > 1) {
    placed = String(row.Placed).split(',').filter(n => vbVal(n) > 0).map(n => itemName(vbVal(n))).join(', ');
    if (placed) placed = 'Placed Items: ' + placed;
  }

  let alsoHere = '', lairText = '', regenTime = '', maxRegen = 0;
  const lairStr = String(row.Lair || '');
  if (!o.noLairs && lairStr.length > 1) {
    const lair = parseLair(lairStr);
    const info = lair.groupIndex ? lairInfo(lair.groupIndex) : null;
    if (info && info.Mobs > 0) {
      maxRegen = lair.maxRegen;
      alsoHere = `Also Here (${maxRegen}): ${npc}${npc ? ', ' : ''}${multiMonsterNames(info.MobList + ',')}`;
      if (engine.greater) {
        regenTime = `@ ${row.Delay - 1}m 30s`;    // GreaterMUD lairs regen 30s early
      } else regenTime = `@ ${row.Delay} mins`;
      lairText = `Lair Exp: ${(info.AvgExp * maxRegen).toLocaleString('en-US')}, HP: ${(info.AvgHP * maxRegen).toLocaleString('en-US')}`;
      // "Dmg vs Char: n/clear": GetLairInfo(..).nAvgDmgLair with GetPreCalculatedMonsterDamage(0)'s label,
      // supplied by the caller (o.lairDamage(groupIndex, maxRegen) -> line or '')
      const dmg = o.lairDamage ? o.lairDamage(lair.groupIndex, maxRegen) : '';
      if (dmg) lairText += '\n' + dmg;
    } else {
      alsoHere = `Also Here: ${npc}${npc ? ', ' : ''}${multiMonsterNames(mid(lairStr, instr(1, lairStr, ':') + 2))}`;
      maxRegen = lair.maxRegen;
    }
  }

  const shop = row.Shop > 2 ? 'Shop: ' + shopName(row.Shop) : '';
  const roomSpell = row.Spell > 0 ? 'Room Spell: ' + spellName(row.Spell) : '';

  let exitText = '', remote = '';
  for (const e of roomExits(row)) {
    if (!e) continue;
    if (e.action) { remote = autoAppend(remote, e.raw, '\n'); continue; }
    const t = e.type, d = e.dir;
    switch (e.code) {
      case EXIT.KEY: {
        const y = extractValue(t, 'Key: ');
        exitText += `\n${d} (Key: ${itemName(y)} ${mid(t, instr(1, t, String(y)) + String(y).length + 1)}`;
        break;
      }
      case EXIT.ITEM: {
        const y = extractValue(t, 'Item: ');
        exitText += `\n${d} (Item): ${itemName(y)} ${mid(t, instr(1, t, String(y)) + String(y).length + 1)}`;
        break;
      }
      case EXIT.ACTION: remote = autoAppend(remote, row[d], '\n'); break;
      case EXIT.CLASS: case EXIT.RACE: {
        const what = e.code === EXIT.CLASS ? 'Class' : 'Race';
        const nameOf = e.code === EXIT.CLASS ? className : raceName;
        const y = extractValue(t, what + ': ');
        const z = extractValue(t, `${what}: ${y} OK, `);
        if (y > 0 && z === 0) exitText += `\n${d} (${what} Only: ${nameOf(y, true)}(${y})`;
        else if (y > 0 && z > 0) exitText += `\n${d} (${what} OK: ${nameOf(y, true)}(${y}), ${what} NO: ${nameOf(z, true)}(${z})`;
        else if (z > 0) exitText += `\n${d} (NOT ${what}: ${nameOf(z, true)}(${z})`;
        else exitText += `\n${d} (${what}?`;
        exitText += ')';
        break;
      }
      case EXIT.CAST: {
        // TODO phase 2: MME follows each spell name with its effect text (PullSpellEQ).
        const y = extractValue(t, 'pre-'), z = extractValue(t, 'post-');
        exitText += `\n${d} (Cast `;
        if (y > 0 || z > 0) {
          if (y > 0) exitText += 'Pre: ' + spellName(y);
          if (z > 0) exitText += (y > 0 ? ', ' : '') + 'Post: ' + spellName(z);
        } else exitText += '?';
        exitText += ')';
        break;
      }
      case EXIT.SPELLTRAP: {
        const y = extractValue(t, 'Spell Trap: ');
        exitText += `\n${d} (Spell Trap: ${y > 0 ? spellName(y) : '?'})`;
        break;
      }
      case EXIT.TOLL: exitText += `\n${d}: ${tollText(t)}`; break;
      case EXIT.MAPCHANGE: case EXIT.NORMAL: break;
      default: exitText += `\n${d}: ${t}`;
    }
    if (o.showAllExits) {
      if (e.code === EXIT.MAPCHANGE) exitText += `\n${d} > ${roomLabel(e.map, e.room)}`;
      else if (e.code > 0) { if (e.code !== EXIT.ACTION) exitText += ` > ${roomLabel(map, e.room)}`; }
      else exitText += `\n${d} > ${roomLabel(map, e.room)}`;
    }
  }

  // Assembled exactly as MapMapExits builds sToolTipString.
  let tip = name;
  if (!alsoHere && npc) alsoHere = 'Also Here: ' + npc;
  tip = autoAppend(tip, alsoHere, '\n');
  tip = autoAppend(tip, light, '\n');
  if ((shop + placed + roomSpell).length) tip += '\n';
  tip = autoAppend(tip, shop, '\n');
  tip = autoAppend(tip, placed, '\n');
  tip = autoAppend(tip, roomSpell, '\n');
  tip += '\n';
  if (exitText) tip += exitText + '\n';
  tip = autoAppend(tip, remote, '\n');
  tip = autoAppend(tip, roomCMDs, '\n');
  if (remote || roomCMDs) tip += '\n';
  tip = autoAppend(tip, lightDetail, '\n');
  if (maxRegen > 0) {
    tip = autoAppend(tip, 'Max Regen: ' + maxRegen, '\n');
    tip = autoAppend(tip, regenTime, ' ');
  }
  tip = autoAppend(tip, lairText, '\n');
  if (o.megaInfo && o.megaInfo.length) {
    tip = tip.replace(/\n$/, '');
    tip = autoAppend(tip, '\n' + (o.megaInfo.length > 1 ? 'MegaMUD Known Rooms:' : 'MegaMUD Known Room:'), '\n');
    for (const v of o.megaInfo) tip = autoAppend(tip, `[${v.group}] ${v.code} - ${v.name}`, '\n');
  }
  return tip.replace(/\n$/, '');
}

// modSyntaxsFunc.AutoAppend
export function autoAppend(s, add, glue = ', ') {
  if (s.length > 0) return String(add ?? '').trim().length > 0 ? s + glue + add : s;
  return add ?? '';
}

// ---------------------------------------------------------------- references

// frmMap.MapGetRoomLoc (+ modMain.AddRoomNPCCommandRefs): the list beside the
// map. Each entry is { text, ref } with ref = {kind, n, mode?} or null, where
// what double-clicking does (frmMain.GotoLocation) decides the ref:
// "Commands"/"Command" open the room's command tree, "Greet" the NPC's greet
// tree, teleports and actions walk the map.
export function roomRefs(map, room, opts = {}) {
  const o = { ...MAP_OPTIONS, ...opts };
  const row = getRoom(map, room);
  const out = [];
  if (!row) return out;
  const add = (text, ref = null) => out.push({ text, ref });
  const has = text => out.some(e => e.text === text);

  let npc = 0;
  if (!o.noNPC && row.NPC > 0) { npc = row.NPC; add('NPC: ' + monsterName(row.NPC), { kind: 'monster', n: row.NPC }); }
  if (row.Shop > 0) add('Shop: ' + shopName(row.Shop), { kind: 'shop', n: row.Shop });
  if (String(row.Placed || '').length > 1) {
    for (const s of String(row.Placed).split(',')) {
      const it = by.item.get(vbVal(s));
      if (vbVal(s) > 0 && it) add(`Item: ${it.Name}(${it.Number})`, { kind: 'item', n: it.Number });
    }
  }
  if (row.Spell > 0) add('Spell: ' + spellName(row.Spell), { kind: 'spell', n: row.Spell });

  if (row.CMD > 0 && by.textblock.get(row.CMD)) {
    for (const t of roomTeleports(row.CMD, map)) {
      add(`Teleport: ${t.command} --> ${roomLabel(t.map, t.room)}`, { kind: 'room', n: roomKey(t.map, t.room), teleport: t.command });
    }
    const tbRef = { kind: 'textblock', n: row.CMD, mode: 'room' };
    add('Commands: Textblock ' + row.CMD, tbRef);
    for (const c of textblockCMDS(row.CMD).split(',')) add('Command: ' + c.trim(), tbRef);
  }
  if (npc) out.push(...npcCommandRefs(npc, map));

  for (const e of roomExits(row)) {
    if (!e) continue;
    const actionRefs = raw => {
      const e2 = extractMapRoom(raw);
      if (e2.map > 0) {
        const text = 'Action On: ' + roomLabel(e2.map, e2.room);
        if (has(text)) return;
        add(text, { kind: 'room', n: roomKey(e2.map, e2.room) });
      }
      if (raw.includes('(Item: ')) {
        const n = extractValue(raw, '(Item: ');
        if (n > 0) add('Item: ' + itemName(n), { kind: 'item', n });
      } else if (e.action && raw.includes('this room]: ')) {
        add('cmd: ' + mid(raw, instr(1, raw, 'this room]: ') + 'this room: '.length));
      }
    };
    if (e.action) { actionRefs(e.raw); continue; }
    const code = exitTypeCode(e.type);    // map changes keep their own type here
    switch (code) {
      case 2: case 3: case 17: {
        const n = Math.trunc(numbersIn(e.type));
        if (n > 0) add('Item: ' + itemName(n), { kind: 'item', n });
        break;
      }
      case 22: case 24: {
        for (const k of ['pre-', 'post-']) {
          const n = extractValue(e.type, k);
          if (n > 0) add('Spell: ' + spellName(n), { kind: 'spell', n });
        }
        break;
      }
      case 10:
        add('cmd: ' + mid(e.type, '(Text: '.length + 1, e.type.length - '(Text: '.length - 1));
        break;
      case 12:
        actionRefs(e.type);
        break;
    }
  }

  if (!o.noLairs && String(row.Lair || '').length > 1) {
    for (const n of lairMobs(String(row.Lair))) {
      const m = by.monster.get(n);
      // TODO phase 4/7: " - n dmg/rnd" from GetPreCalculatedMonsterDamage.
      if (m) add(`Monster: ${m.Name}(${m.Number})`, { kind: 'monster', n });
    }
  }
  return out;
}

// ExtractNumbersFromString (the first number in a string).
function numbersIn(s) {
  let out = '', dot = false;
  for (const c of String(s ?? '')) {
    if (c >= '0' && c <= '9') out += c;
    else if (c === '.') { if (out && !dot) { out += c; dot = true; } }
    else if (c === '-') { if (!out) out = c; }
    else if (out === '-') out = '';
    else if (out) break;
  }
  return Number(out) || 0;
}

const BOGUS_GREET = /^(heh|nothing|yada|hehe|shit):/i;

// modMain.AddRoomNPCCommandRefs: an NPC's greet commands. Commands that lead
// to a teleport get their own "Teleport: (NPC)" row; the rest share one
// "Greet:" row that opens the greet tree.
export function npcCommandRefs(npc, currentMap) {
  const m = by.monster.get(npc);
  const out = [];
  if (!m || m.GreetTXT <= 0) return out;
  const tb = by.textblock.get(m.GreetTXT);
  if (!tb) return out;
  const data = String(tb.Action ?? '');
  if (BOGUS_GREET.test(data) || data === '') return out;

  const greets = [], keys = new Set();
  let pos = instr(1, data, ':');
  if (!pos) return out;
  let command = mid(data, 1, pos - 1);
  pos++;
  while (pos < data.length) {
    command = command.replaceAll('*', '').replaceAll('|', ' OR ');
    let x2 = instr(pos, data, '\n');
    if (!x2) x2 = data.length + 1;
    const line = mid(data, pos, x2 - pos);
    if (line !== '' && vbVal(line) >= 1 && command !== '') {
      const sub = vbVal(line);
      let t = textblockTeleport(sub);
      if (!t) {
        const link = (by.textblock.get(sub) || {}).LinkTo;
        if (link > 0) t = textblockTeleport(link);
      }
      if (t && t.room > 0) {
        const map = t.map || currentMap;
        const key = roomKey(map, t.room);
        if (!keys.has(key)) {
          keys.add(key);
          out.push({ text: `Teleport: (NPC) ${command} --> ${roomLabel(map, t.room)}`, ref: { kind: 'room', n: key } });
        }
      } else greets.push(command);
    }
    // next_line:
    for (;;) {
      pos = instr(pos, data, '\n') + 1;
      if (pos === 1) { pos = data.length; break; }
      let c = instr(pos, data, ':');
      if (!c) c = data.length + 1;
      if (c === pos) continue;
      command = mid(data, pos, c - pos);
      pos = c + 1;
      break;
    }
  }
  if (greets.length) out.push({ text: 'Greet: ' + greets.join(', '), ref: { kind: 'textblock', n: m.GreetTXT, mode: 'greet' } });
  return out;
}

// ---------------------------------------------------------------- leads here

// modMMudDatabase.GetMonsterMapNumber: the map a monster is most often summoned on.
export function monsterMapNumber(m) {
  const s = String(m?.['Summoned By'] ?? '').trim();
  if (!s) return 0;
  const counts = new Map();
  for (const x of s.matchAll(/Room\s+(\d+)\/(\d+)/gi)) {
    const k = x[1];
    if (!counts.has(k)) counts.set(k, { n: 0, pos: s.toLowerCase().indexOf(x[0].toLowerCase()) });
    counts.get(k).n++;
  }
  let best = null, bestKey = '';
  for (const [k, v] of counts) if (!best || v.n > best.n || (v.n === best.n && v.pos < best.pos)) { best = v; bestKey = k; }
  return best ? Math.max(0, Number(bestKey)) : 0;
}

// GetCurrentSpellMinMax as cmdMapLeadsHere calls it (no level given, so
// level-scaled spells are taken at GetMaxLevel, 255).
export function spellMinMax(sp, level = 0) {
  const r = getCurrentSpellMinMax(sp, false, level);
  return { min: r.nMin, max: r.nMax };
}

// frmMain.cmdMapLeadsHere_Click: rooms whose exits or commands reach a room,
// spells that teleport to it, and monsters whose greet commands do.
// onlyInGame is MME's "OnlyInGame" setting (default on).
export function leadsHere(map, room, { onlyInGame = settings.onlyInGame } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of db.Rooms) {
    const key = roomKey(r['Map Number'], r['Room Number']);
    let match = false;
    for (const e of roomExits(r)) {
      if (e && !e.action && e.map === map && e.room === room) { match = true; break; }
    }
    if (!match && r.CMD > 0 && !seen.has(key)) {
      match = textblockHasTeleport(r.CMD, room, map, r['Map Number'] !== map);
    }
    if (match && !seen.has(key)) {
      seen.add(key);
      out.push({ text: `Room: ${r.Name} (${key})`, ref: { kind: 'room', n: key } });
    }
  }

  for (const sp of db.Spells) {
    if (onlyInGame && String(sp['Casted By'] || '').length < 3 && sp.Learnable === 0) continue;
    let hit = false;
    for (let x = 0; x < 20 && !hit && ('Abil-' + x) in sp; x++) {
      const abil = sp['Abil-' + x], val = sp['AbilVal-' + x];
      if (abil === A.TeleportRoom) {
        let tmap = 0;
        for (let y = 0; ('Abil-' + y) in sp; y++) if (sp['Abil-' + y] === A.TeleportMap) { tmap = sp['AbilVal-' + y]; break; }
        if (tmap > 0 && tmap === map) {
          if (val === 0) { const mm = spellMinMax(sp); hit = room >= mm.min && room <= mm.max; }
          else hit = room === val;
        }
      } else if (abil === A.TextBlock) {
        if (val === 0) {
          const mm = spellMinMax(sp);
          if (mm.max > mm.min) for (let t = mm.min; t <= mm.max && !hit; t++) hit = textblockHasTeleport(t, room, map, true);
        } else hit = textblockHasTeleport(val, room, map, true);
      }
    }
    if (hit) out.push({ text: `Spell: ${sp.Name} (${sp.Number})`, ref: { kind: 'spell', n: sp.Number } });
  }

  for (const m of db.Monsters) {
    if (onlyInGame && m['In Game'] === 0) continue;
    if (!(m.GreetTXT > 0)) continue;
    const tb = by.textblock.get(m.GreetTXT);
    if (!tb || !tb.Action) continue;
    const mm = monsterMapNumber(m);
    const strict = !(mm > 0 && mm === map);
    const data = String(tb.Action);
    let hit = false;
    for (const line of data.split('\n')) {
      const c = line.indexOf(':');
      if (c < 0) continue;
      const n = vbVal(line.slice(c + 1));
      if (n < 1) continue;
      if (textblockHasTeleport(n, room, map, strict)) { hit = true; break; }
      const link = (by.textblock.get(n) || {}).LinkTo;
      if (link > 0 && textblockHasTeleport(link, room, map, strict)) { hit = true; break; }
    }
    if (hit) out.push({ text: `Monster: ${m.Name} (${m.Number})`, ref: { kind: 'monster', n: m.Number } });
  }
  return out;
}

// ---------------------------------------------------------------- finders

// frmMain.cmdMapFindText_Click: the next room (in table order) whose name
// contains the text, after `after` ("map/room") if given.
export function findRoomByName(text, after = null) {
  const q = String(text).toLowerCase();
  if (!q) return null;
  let i = 0;
  if (after) {
    const at = db.Rooms.findIndex(r => roomKey(r['Map Number'], r['Room Number']) === after);
    if (at >= 0) i = at + 1;
  }
  for (; i < db.Rooms.length; i++) if (String(db.Rooms[i].Name).toLowerCase().includes(q)) return db.Rooms[i];
  return null;
}

// Every room whose name contains the text (for the search list).
export function searchRooms(text, limit = 500) {
  const q = String(text).toLowerCase().trim();
  const out = [];
  if (!q) return out;
  for (const r of db.Rooms) {
    if (String(r.Name).toLowerCase().includes(q)) { out.push(r); if (out.length >= limit) break; }
  }
  return out;
}

// The exits MegaMUD can see, as a bitmask over DIRS (FindRoomWithDirections:
// hidden, text, remote and timed exits don't count).
export function visibleExitMask(row) {
  let mask = 0;
  for (const e of roomExits(row)) {
    if (!e || e.action) continue;
    if (e.code === 6 || e.code === 10 || e.code === 12 || e.code === 16) continue;
    mask |= 1 << e.i;
  }
  return mask;
}

// frmMain.FindRoomWithDirections: rooms named like `name` whose visible exits
// are exactly `mask`. Stops past 100, as MME does.
export function findRoomsWithExits(name, mask, exact = false) {
  const q = String(name).trim();
  const out = { rooms: [], truncated: false };
  if (q.length < 3 || !mask) return out;
  for (const r of db.Rooms) {
    const n = String(r.Name);
    if (exact ? n.trim() !== q : !n.toLowerCase().includes(q.toLowerCase())) continue;
    if (visibleExitMask(r) !== mask) continue;
    if (out.rooms.length > 100) { out.truncated = true; break; }
    out.rooms.push(r);
  }
  return out;
}

// frmMain.LoadPresets' default presets (50 slots; the rest are "unset" 1/1).
export const DEFAULT_PRESETS = [
  [1, 2140, 'Newhaven'], [1, 224, 'Silvermere'], [1, 2327, 'Blue Tower'], [10, 271, 'Aged Titan'],
  [17, 2269, 'Arlysia'], [12, 5, 'Dusty Village'], [6, 552, 'Gnome Village'], [6, 1255, 'Khazarad'],
  [16, 454, 'Lost City'], [2, 2523, 'Rhudar'],
  [12, 2368, 'Ancient Fortress'], [3, 560, 'Ancient Ruin'], [7, 1176, 'Black Fortress'], [3, 669, 'Black Wastelands'],
  [17, 241, 'Blackwood Graveyard'], [8, 491, 'Dark-Elf Castle'], [2, 1110, 'Gnoll Encampment'], [12, 1919, 'Great Pyramid'],
  [12, 1798, 'Hydra'], [1, 1917, 'Labyrinth'], [7, 884, 'Lava Fields'], [16, 272, 'Ocean/Sandbar'],
  [12, 2303, 'Sandstone Cavern'], [12, 2099, 'Saracen Fort'], [3, 497, 'Northern Forests'], [12, 1173, 'Small Pyramid'],
  [16, 1083, 'Stone Encampment'], [16, 1179, 'Storm Fortress'], [16, 1, 'Tasloi Village'], [16, 1990, 'Volcano'],
].map(([map, room, name]) => ({ map, room, name }));
while (DEFAULT_PRESETS.length < 50) DEFAULT_PRESETS.push({ map: 1, room: 1, name: 'unset' });
