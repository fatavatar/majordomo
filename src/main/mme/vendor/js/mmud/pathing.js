// MegaMUD pathing (frmMegaMUDPathing + the MegaMUD helpers in modMain):
// room checksums, recording a path one step at a time, the .mp file it
// saves, and reading MegaMUD's rooms.md / .mp files. DOM-free.
//
// A MegaMUD room checksum is 8 hex digits: a 3-digit hash of the room name
// (Get_MegaMUD_RoomHash) and a 5-digit code of its visible exits
// (Get_MegaMUD_ExitsCode). A path step is "<checksum>:<flags>:<command>".

import { itemName } from '../db.js';
import { vbVal, extractValue, extractTextCommand } from './textblocks.js';
import { getRoom, roomExits, exitTypeCode, EXIT } from './roommap.js';

// frmMegaMUDPath.MegaRoomFlags
export const STEPF = Object.freeze({
  NONE: 0x0, DARK: 0x1, REST: 0x2, DONTREST: 0x4, NOLIGHT: 0x8, STASH: 0x10, NOATTACK: 0x40,
  RELEARN: 0x80, SUSPECT: 0x100, DISARM: 0x200, CANPICK: 0x400, CYCLED: 0x8000, MASK: 0xffff,
});

const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');

// modMain.Get_MegaMUD_RoomHash: sum of (position * char code) over the room
// name, +1 for a whirling vortex and +2 for an obsidian obelisk in the room,
// low 12 bits as 3 hex digits.
export function megaRoomHash(name, vortex = false, obelisk = false) {
  let t = 0;
  for (let i = 0; i < name.length; i++) t += (i + 1) * (name.charCodeAt(i) & 0xff);
  if (vortex) t += 1;
  if (obelisk) t += 2;
  return hex(t & 0xfff, 3);
}

// The vortex / obelisk check MME makes on a room's placed items.
export function placedMarkers(row) {
  const out = { vortex: false, obelisk: false };
  if (vbVal(row.Placed) > 0) {
    for (const s of String(row.Placed).split(', ')) {
      if (vbVal(s) <= 0) continue;
      const n = itemName(vbVal(s), true).toLowerCase();
      if (n.includes('whirling vortex')) out.vortex = true;
      if (n.includes('obsidian obelisk')) out.obelisk = true;
    }
  }
  return out;
}

export function megaRoomHashFor(row) {
  if (!row) return 'FFF';
  const p = placedMarkers(row);
  return megaRoomHash(String(row.Name), p.vortex, p.obelisk);
}

// modMain.Get_MegaMUD_ExitsCode: five hex digits for U/D, SE/SW, NE/NW, E/W,
// N/S. The first of each pair counts 1 and the second 4, doubled for a door
// (key, door or gate); hidden, text and action exits aren't seen.
const EXIT_VAL = [1, 4, 1, 4, 1, 4, 1, 4, 1, 4];
const EXIT_POS = [5, 5, 4, 4, 3, 3, 2, 2, 1, 1];
export function megaExitsCode(row) {
  if (!row) return '';
  const calc = [0, 0, 0, 0, 0, 0];
  for (const e of roomExits(row)) {
    if (!e || e.action || !(e.map > 0 && e.room > 0)) continue;
    const code = exitTypeCode(e.type);
    if (code === EXIT.HIDDEN || code === EXIT.TEXT || code === EXIT.ACTION) continue;
    const door = code === EXIT.KEY || code === EXIT.DOOR || code === EXIT.GATE;
    calc[EXIT_POS[e.i]] += EXIT_VAL[e.i] * (door ? 2 : 1);
  }
  return calc.slice(1).map(n => n.toString(16).toUpperCase()).join('');
}

export function megaChecksum(map, room) {
  const row = getRoom(map, room);
  return megaRoomHashFor(row) + megaExitsCode(row);
}

// ---------------------------------------------------------------- recording

// A path being recorded (frmMegaMUDPath's text box, history and positions).
export function newPath(map = 0, room = 0) {
  return {
    start: { map, room },        // nLocalMapStart*
    current: { map, room },      // nLastMapRecorded / nLastRoomRecorded
    steps: [],                   // the lines of txtMapMove
    item: '',                    // a required item (MME keeps it as a ":item:" first line)
    history: [],                 // [{text, map, room}]
    picklocks: 300,              // txtPickLock: pick a lock instead of using the key below this
  };
}

// frmMegaMUDPath.txtMapMove_KeyPress: record a move from the current room.
// Returns { ok, to: {map, room} } after appending the step, or
//   { ok: false, reason }                        can't go that way
//   { ok: false, needActions: n, exit }          a hidden exit needs n actions first;
//                                                call again with opts.actions = [...]
// opts.actions: the actions entered for a hidden "needs n actions" exit ("" = done).
export function recordMove(path, map, room, dir, opts = {}) {
  const row = getRoom(map, room);
  if (!row) return { ok: false, reason: `Room ${map}/${room} not found.` };
  const raw = String(row[dir] ?? '');
  if (raw.startsWith('Action') || vbVal(raw) === 0) return { ok: false, reason: 'No exit that way.' };
  const e = roomExits(row)[['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'U', 'D'].indexOf(dir)];
  if (!getRoom(e.map, e.room)) return { ok: false, reason: 'Error going in that direction.' };

  if (!path.start.map) path.start = { map, room };
  const checksum = megaRoomHashFor(row) + megaExitsCode(row);
  let look = dir, flags = 0;
  const actions = [];
  let code = exitTypeCode(e.type);
  if (e.map !== map) code = EXIT.MAPCHANGE;
  let warning = '';

  switch (code) {
    case EXIT.ACTION: return { ok: false, reason: 'That exit is a remote action.' };
    case EXIT.ITEM: {
      const n = Math.trunc(numbers(e.type));
      if (n > 0) {
        const name = itemName(n);
        if (path.item && path.item.toLowerCase() !== name.toLowerCase()) {
          warning = `This path already requires ${path.item} and this step needs ${name} too. `
            + 'MegaMUD supports one required item per path, so it was not added.';
        } else path.item = name;
      }
      break;
    }
    case EXIT.KEY: {
      const n = Math.trunc(numbers(e.type));
      if (n > 0) look = `${look}[use ${itemName(n)} ${look}]`;
      if (/\[or \d.* picklocks/.test(e.type)) {
        const at = e.type.toLowerCase().indexOf('[or ');
        const need = Math.trunc(numbers(e.type.slice(at + 3)));
        if (need > 0 && need < path.picklocks) flags += STEPF.CANPICK;
      }
      break;
    }
    case EXIT.HIDDEN:
      if (e.type.toLowerCase().includes('action')) {
        const need = extractValue(e.type, 'needs ');
        if (need > 0) {
          if (!opts.actions) return { ok: false, needActions: need, exit: e };
          for (const a of opts.actions.slice(0, need)) { if (!a || a === '0') break; actions.push(a); }
        } else look = `${look} -- ${e.type}`;
      } else if (!e.type.toLowerCase().includes('passable')) {
        look = `${look}[search ${look}]`;
      }
      break;
    case EXIT.TRAP: flags += STEPF.DISARM; break;
    case EXIT.TEXT: look = extractTextCommand(e.type); break;
  }

  let line = `${checksum}:${hex(flags, 4)}:${look}`;
  if (actions.length) line += `[${actions.join(',')}]`;
  path.steps.push(line);
  path.history.push({ text: `${look} - ${row.Name} (${map}/${room})`, map, room });
  path.current = { map: e.map, room: e.room };
  return { ok: true, to: { map: e.map, room: e.room }, warning };
}

// cmdMapCommand_Click / GotoLocation's teleport: a typed command from a room
// ("@party " in front for a room command teleport). to = where it leads, if known.
export function recordCommand(path, map, room, command, to = null) {
  const row = getRoom(map, room);
  if (!path.start.map) path.start = { map, room };
  path.steps.push(`${megaRoomHashFor(row) + megaExitsCode(row)}:0000:${command}`);
  path.history.push({ text: `${command} - ${row ? row.Name : '?'} (${map}/${room})`, map, room });
  if (to) path.current = { ...to };
}

// cmdUndoStep_Click: drop the last line and go back to the last history room.
export function undoStep(path) {
  path.steps.pop();
  const h = path.history.pop();
  if (h) path.current = { map: h.map, room: h.room };
  return h || null;
}

// The text box, as MME shows it (a required item as a ":item:" first line).
export function pathText(path) {
  return [path.item ? `:${path.item}:` : null, ...path.steps].filter(l => l != null).join('\n');
}

// Read the text box back after manual edits.
export function setPathText(path, text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  path.item = '';
  if (lines.length && lines[0].length > 2 && lines[0].startsWith(':') && lines[0].endsWith(':')) {
    path.item = lines.shift().replaceAll(':', '');
  }
  path.steps = lines;
}

// ---------------------------------------------------------------- the .mp file

// cmdMapAddMegaCodes_Click: the MegaMUD .mp file for a recorded path.
//   start/end: { code, group, name } from rooms.md (or entered by hand)
//   loopName:  set when the path ends where it starts
// Returns { text, fileName, startChecksum, endChecksum, loop }.
export function pathFile(path, { start, end, loopName = '', author = 'Custom' } = {}) {
  const startRow = getRoom(path.start.map, path.start.room);
  const endRow = getRoom(path.current.map, path.current.room);
  const startChecksum = megaRoomHashFor(startRow) + megaExitsCode(startRow);
  const endChecksum = megaRoomHashFor(endRow) + megaExitsCode(endRow);
  const loop = startChecksum === endChecksum;
  const steps = path.steps.filter(s => s.trim() !== '');
  const header = [
    `[${loop ? loopName : ''}][${author}]`,
    start ? `[${start.code}:${start.group}:${start.name}]` : '',
    !loop && end ? `[${end.code}:${end.group}:${end.name}]` : '',
    `${startChecksum}:${endChecksum}:${steps.length}:-1:0:${path.item}::`,
  ];
  const startCode = start?.code || megaRoomHashFor(startRow) + '9';
  const endCode = end?.code || megaRoomHashFor(endRow) + '9';
  const text = [...header.filter(h => h.trim() !== ''), ...steps].map(l => l + '\r\n').join('');
  return { text, fileName: loop ? `${startCode}LOOP.mp` : `${startCode}${endCode}.mp`, startChecksum, endChecksum, loop };
}

// ---------------------------------------------------------------- MegaMUD files

// modMain.MegaRooms_ParseFile: rooms.md lines
//   98040005:00000000:0:0:0:ARBD:Albion River System:Alba River Bottoms, Decline-14 5714
// into checksum -> [{code, group, name}] (a name may contain ":").
export function parseRoomsMD(text, into = new Map()) {
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    const a = line.split(':');
    if (a.length < 8) continue;
    const info = { code: a[5], group: a[6], name: a.slice(7).join(':') };
    const key = a[0].toUpperCase();
    const list = into.get(key);
    if (!list) into.set(key, [info]);
    else if (!list.some(v => v.code === info.code && v.group === info.group && v.name === info.name)) list.push(info);
  }
  return into;
}

// frmMain.MapMegaScanPath: where a room checksum appears in a .mp path file.
// Returns null, or { step, start, end, loop, pathName } as MME reports it.
export function scanPathFile(text, checksum) {
  let codeFrom = '', groupFrom = '', roomFrom = '', codeTo = '', groupTo = '', roomTo = '';
  let step = 0, pathName = '', n = 0;
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (line !== '') n++;
    if (n === 1 && line.startsWith('[') && !line.startsWith('[]')) pathName = line.slice(1, line.indexOf(']', 1));
    const a = line.split(':');
    if (a.length < 3) continue;
    step++;
    const isHead = a[0].length === 5 && a[0].startsWith('[') && a[2].endsWith(']') && a[1].length > 0 && a[2].length > 1;
    if (isHead && !codeFrom) { codeFrom = a[0].slice(-4); groupFrom = a[1]; roomFrom = a[2].slice(0, -1); step = 0; }
    else if (isHead && !codeTo) { codeTo = a[0].slice(-4); groupTo = a[1]; roomTo = a[2].slice(0, -1); step = 0; }
    if (a[0].toUpperCase() === checksum.toUpperCase()) {
      let start = groupFrom || roomFrom ? `Start: [${groupFrom}] - ${roomFrom} (${codeFrom})` : `Start: UNKNOWN ${codeFrom}`;
      let end = '', loop = false;
      if (!groupTo && !roomTo) {
        if (!start.includes('UNKNOWN')) {
          end = start;
          start = 'Loop: ' + (pathName || groupFrom);
          loop = true;
        }
      } else end = `End: [${groupTo}] - ${roomTo} (${codeTo})`;
      return { step: step - 1, start, end, loop, pathName };
    }
  }
  return null;
}

// ExtractNumbersFromString
function numbers(s) {
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

