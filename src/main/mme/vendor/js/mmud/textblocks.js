// Textblocks (the TBInfo table): command parsing, teleports, and the command /
// "executed by" trees MME shows in frmResults. Pure: every function reads
// textblocks through `tbs` (a Map of Number -> row, by.textblock by default).
//
// A textblock's Action is lines of "command:action:action..." separated by
// "\n". Room/NPC command blocks put the typed command first ("ask:4158");
// executed blocks have no command and every ":"-separated piece is an action
// ("checkitem 570 657:message 54:teleport 12 3").

import { by, itemName, monsterName, spellName, className, raceName, roomKey } from '../db.js';
import { abilityName } from './enums.js';

// ---------------------------------------------------------------- VB helpers
// The ported routines lean on VB's 1-based string functions; keeping them
// makes the ports line up with the originals.

// InStr(start, s, find): 1-based position, 0 when not found.
export const instr = (start, s, find, textCompare = false) => {
  if (textCompare) { s = s.toLowerCase(); find = find.toLowerCase(); }
  return s.indexOf(find, start - 1) + 1;
};
// Mid(s, start[, len]), 1-based.
export const mid = (s, start, len) => (len == null ? s.slice(start - 1) : s.slice(start - 1, start - 1 + Math.max(0, len)));

// Val(s): the leading number, 0 if none.
export function vbVal(s) {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))/.exec(String(s ?? ''));
  return m ? Number(m[1]) : 0;
}

const isDigit = c => c >= '0' && c <= '9';

// modSyntaxsFunc.ExtractValueFromString: the number following sSearchText
// (case-insensitive), skipping spaces and "*" before it.
export function extractValue(whole, search) {
  whole = String(whole ?? '');
  let x = instr(1, whole, search, true);
  if (!x) return 0;
  x += search.length;
  let y = x;
  while (y <= whole.length) {
    const c = mid(whole, y, 1);
    if (isDigit(c)) { /* keep going */ }
    else if (c === ' ' || c === '*') { if (y > x) break; x++; }
    else break;
    y++;
  }
  return y > x ? vbVal(mid(whole, x, y - x)) : 0;
}

// modMMudFunc.ExtractTextCommand: "(Text: go crimson, enter crimson)" -> "go crimson"
// (from after the first space up to the first comma).
export function extractTextCommand(whole) {
  whole = String(whole ?? '');
  let x = instr(1, whole, ' ') + 1;
  if (x === 1) return whole;
  let cmd = '';
  while (x < whole.length) {
    const c = mid(whole, x, 1);
    if (c === ',' && cmd !== '') break;
    cmd += c;
    x++;
  }
  return cmd === '' ? whole : cmd;
}

const tidy = s => s.replaceAll('*', '').replaceAll('|', ' OR ');
const action = (n, tbs) => {
  const tb = tbs.get(n);
  return tb ? String(tb.Action ?? '').replace(/\0/g, '') : null;
};

// modMMudDatabase.GetTextblockCMDS: the commands a room/NPC textblock accepts,
// "cmd1, cmd2, ...".
export function textblockCMDS(n, maxLength = 0, tbs = by.textblock) {
  if (!n) return 'none';
  const s = action(n, tbs);
  if (s == null) return `Textblock ${n} not found.`;
  if (s === '') return 'none';
  let x1 = instr(1, s, ':');
  if (!x1) return 'none';
  let out = mid(s, 1, x1 - 1);
  x1++;
  while (x1 < s.length) {
    x1 = instr(x1, s, '\n') + 1;
    if (x1 === 1) break;
    const x2 = instr(x1, s, ':');
    if (!x2) break;
    out += ', ' + mid(s, x1, x2 - x1);
    x1 = x2 + 1;
  }
  out = tidy(out);
  if (maxLength > 0 && out.length > maxLength) out = out.slice(0, maxLength - 1) + '+';
  return out;
}

// modMMudDatabase.GetTextblockCMDLine: what a command does (the rest of its line).
export function textblockCMDLine(command, data, n, tbs = by.textblock) {
  if (!n && !data) return 'unknown';
  if (!data) { data = action(n, tbs); if (data == null) return 'unknown'; }
  if (!command.endsWith(':')) command += ':';
  let x1 = instr(1, data, command);
  if (!x1) return 'none';
  x1 += command.length;
  let y = instr(x1, data, '\n');
  if (!y) y = data.length;
  return tidy(mid(data, x1, y - x1));
}

// modMMudDatabase.GetTextblockCMDText: the command that leads to a given
// action ("teleport 12 3" -> "pull lever").
export function textblockCMDText(command, data, n, tbs = by.textblock) {
  if (!n && !data) return '';
  if (!data) { data = action(n, tbs); if (data == null) return ''; }
  const x1 = instr(1, data, command);
  if (!x1) return '';
  let line = mid(data, 1, x1);
  while (line.includes('\n')) line = line.slice(line.indexOf('\n') + 1);
  if (line.includes(':')) line = line.slice(0, line.indexOf(':'));
  return tidy(line);
}

// modMMudDatabase.GetTextblockTrigger: how textblock n reaches textblock value.
export function textblockTrigger(n, value, tbs = by.textblock) {
  if (!n) return 'none';
  const tb = tbs.get(n);
  if (!tb) return `Textblock ${n} not found.`;
  const a = String(tb.Action ?? '');
  if (tb.LinkTo === value) return '[dialog link]';
  if (a.includes('random ' + value)) return `[random ${value}]`;
  if (a.includes('text ' + value)) return `[text ${value}]`;
  const p = instr(1, a, ':' + value);
  if (p) {
    let cmd = a.slice(0, p - 1);
    let x1 = 1, z;
    while (x1 < cmd.length) {
      z = instr(x1, cmd, '\n');
      if (!z) { z = x1; break; }
      x1 = z + 1;
    }
    if (z == null) z = 1;
    cmd = cmd.slice(z - 1);
    return `[ask monster ${cmd}]`;
  }
  return '';
}

// The "teleport <room> [map]" scan shared by TextBlockHasTeleport,
// GetTextblockTeleport and frmMap.MapGetRoomLoc. Returns {room, map} (map 0
// when the command doesn't name one) or null. MapGetRoomLoc's copy misses a
// map named at the very end of a line; TextBlockHasTeleport's fix for that is
// used everywhere here. (A bare "teleport <room>" ending a line is still
// missed, as in MME; no textblock in the data has one.)
export function parseTeleport(line) {
  let x = instr(1, line, 'teleport ');
  if (!x) return null;
  let y = x + 'teleport '.length;
  x = y;
  let room = 0, map = 0;
  while (y <= line.length) {
    const c = mid(line, y, 1);
    if (isDigit(c)) { /* digits */ }
    else if (c === ' ') {
      if (y > x && room === 0) { room = vbVal(mid(line, x, y - x)); x = y + 1; }
      else { map = vbVal(mid(line, x, y - x)); break; }
    } else {
      if (y > x && room === 0) room = vbVal(mid(line, x, y - x));
      else map = vbVal(mid(line, x, y - x));
      break;
    }
    y++;
  }
  if (y > line.length && y > x && room > 0 && map === 0) map = vbVal(mid(line, x, y - x));
  return room ? { room, map } : null;
}

const lines = s => {
  const out = [];
  let pos = 1;
  while (pos < s.length) {
    let x = instr(pos, s, '\n');
    if (!x) x = s.length + 1;
    out.push(mid(s, pos, x - pos));
    pos = x + 1;
  }
  return out;
};

// modMMudDatabase.TextBlockHasTeleport. strict: the map must be named and
// match; otherwise only a named map that differs rules it out.
export function textblockHasTeleport(n, findRoom, findMap = 0, strict = false, tbs = by.textblock) {
  if (n <= 0) return false;
  const s = action(n, tbs);
  if (s == null) return false;
  for (const line of lines(s)) {
    const t = parseTeleport(line);
    if (!t || t.room !== findRoom) continue;
    if (findMap > 0 && t.map > 0 && t.map !== findMap) continue;
    if (strict && t.map !== findMap) continue;
    return true;
  }
  return false;
}

// modMMudDatabase.GetTextblockTeleport: the first teleport in a textblock.
export function textblockTeleport(n, tbs = by.textblock) {
  if (n <= 0) return null;
  const s = action(n, tbs);
  if (s == null) return null;
  for (const line of lines(s)) {
    const t = parseTeleport(line);
    if (t) return t;
  }
  return null;
}

// Every "teleport" in a room command textblock with the command that triggers
// it, as frmMap.MapGetRoomLoc lists them: [{command, map, room}] (map falls
// back to the room's own map), de-duplicated by destination.
export function roomTeleports(n, currentMap, tbs = by.textblock) {
  const s = action(n, tbs);
  if (!s) return [];
  const out = [], seen = new Set();
  for (const line of lines(s)) {
    const t = parseTeleport(line);
    if (!t) continue;
    const map = t.map || currentMap;
    const key = roomKey(map, t.room);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ command: tidy(line.slice(0, Math.max(0, line.indexOf(':')))), map, room: t.room });
  }
  return out;
}

// ---------------------------------------------------------------- trees
// frmResults' TreeView, as plain nodes:
//   { text, icon, ref: {kind, n} | null, bold, kids: [] }
// icon is one of MME's tree images: STAR ARROW PAPER MONSTER ROOM BOLT MONEY ITEM REDARROW.
// ref is what clicking the node opens (frmResults.tvwResults_NodeClick).

const node = (text, icon, ref = null, bold = false) => ({ text, icon, ref, bold, kids: [] });
const NEST_MAX = 3000;     // MME asks to continue every 500 nested blocks; we just stop here

// Loop check used by AddCommandNode / AddExecutionNode: does an ancestor of
// the last node in `path` (not counting the root) already show this textblock? MME tests with InStr, so
// "Textblock 12" also matched "Textblock 123"; this matches the whole number.
function inAncestors(path, re) {
  for (let i = path.length - 2; i >= 1; i--) if (re.test(path[i].text)) return true;
  return false;
}
const tbRe = (label, n) => new RegExp(label + ' ' + n + '(?!\\d)');

const coin = cmd => {
  switch (cmd.slice(-1).toUpperCase()) {
    case 'R': return ' runic';
    case 'P': return ' platinum';
    case 'G': return ' gold';
    case 'S': return ' silver';
    default: return ' copper';
  }
};
const commas = n => Number(n).toLocaleString('en-US');
const EXIT_NAMES = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'U', 'D'];

// frmResults.CreateCommandTree: what a textblock does.
//   mode 'plain'  a textblock run by something else (actions only)
//   mode 'room'   a room's command block ("Command: x" per line)
//   mode 'greet'  an NPC greet block ("Command: x --> Textblock n")
// hideTB is chkHideTextblocks; defaultMap is the map teleports without one
// land on (frmResults.nDefaultMap: the map MME was showing).
export function commandTree(n, { mode = 'plain', hideTB = false, defaultMap = 0, tbs = by.textblock } = {}) {
  const root = node(`Textblock ${n} has the following commands ...`, 'PAPER', { kind: 'textblock', n });
  if (!tbs.get(n)) { root.text = `Textblock ${n} not found.`; return root; }
  const st = { nest: 0, hideTB, defaultMap, tbs };
  addCommandNode(st, n, [root], mode === 'room', false, mode === 'greet');
  return root;
}

// frmResults.AddCommandNode. path = the chain of nodes from the root to the
// node children are added under.
function addCommandNode(st, n, path, roomCommands, random, greet) {
  const cur = path[path.length - 1];
  const add = (parent, nd) => { parent.kids.push(nd); return nd; };

  if (path.length > 1) {
    const label = inAncestors(path, tbRe('Textblock', n)) ? 'Textblock' : inAncestors(path, tbRe('random:', n)) ? 'random:' : '';
    if (label) { add(cur, node(`Loop detected (${label} ${n}) ... quitting.`, 'STAR')); return; }
  }
  if (++st.nest > NEST_MAX) {
    if (st.nest === NEST_MAX + 1) add(path[0], node('Too many references ... quitting.', 'STAR'));
    return;
  }

  const tb = st.tbs.get(n);
  if (!tb) {
    add(cur, node('Textblock not found, could be because it required items not in the game.', 'STAR'));
    return;
  }
  const data = String(tb.Action ?? '');
  if (data === '\0' || data === '') return nada();

  function nada() {
    if (!st.hideTB) add(cur, node('Dialog', 'PAPER'));
    if (tb.LinkTo > 0) {
      let at = cur;
      if (!st.hideTB) at = add(cur, node(`Link to Textblock ${tb.LinkTo}`, 'PAPER', { kind: 'textblock', n: tb.LinkTo }));
      addCommandNode(st, tb.LinkTo, at === cur ? path : [...path, at], false, false, false);
    }
  }

  // total lines, only caring whether there's more than one
  let totalLines = 0;
  let pos = 1;
  if (instr(pos, data, '\n') > 0) {
    while (pos < data.length + 1 && totalLines < 2) {
      const x2 = instr(pos, data, '\n');
      if (!x2) { if (data.length - pos > 1) totalLines++; break; }
      if (x2 !== pos) totalLines++;
      pos = x2 + 1;
    }
  } else totalLines = 1;

  let command = '';
  pos = 0;
  if (greet || roomCommands || random) {
    pos = instr(1, data, ':');
    if (!pos) return nada();
    command = mid(data, 1, pos - 1);
  }

  let pct1 = 0, pct2 = 0, currLine = 0;
  pos++;
  while (pos < data.length) {
    if (random) {
      pct2 = pct1;
      pct1 = vbVal(command);
      command = (pct1 - pct2) + '%';
    }
    command = tidy(command);

    let at = cur, atPath = path;
    if (roomCommands || greet) {
      at = add(cur, node((random ? '' : 'Command: ') + command, 'STAR'));
      atPath = [...path, at];
    } else if (random) {
      at = add(cur, node(command, 'STAR'));
      atPath = [...path, at];
    }

    let x2 = instr(pos, data, '\n');
    if (!x2) x2 = data.length + 1;
    const line = mid(data, pos, x2 - pos);

    if (line !== '') {
      if (!roomCommands && !greet && !random && totalLines > 1) {
        at = add(cur, node(`Line ${++currLine}`, 'PAPER'));
        atPath = [...path, at];
      }
      if (greet) {
        at.text += ' --> Textblock ' + vbVal(line);
        at.ref = { kind: 'textblock', n: vbVal(line) };
        addCommandNode(st, vbVal(line), atPath, false, false, false);
      } else {
        lineCommands(st, line, at, atPath);
      }
    }

    // next_line:
    for (;;) {
      pos = instr(pos, data, '\n') + 1;
      if (pos === 1) return;
      if (greet || roomCommands || random) {
        let c = instr(pos, data, ':');
        if (!c) c = data.length + 1;
        if (c === pos) continue;
        command = mid(data, pos, c - pos);
        pos = c + 1;
      }
      break;
    }
  }
}

// The per-action part of AddCommandNode: one node per ":"-separated action,
// repeats of the same action collapsed into "(xN)".
function lineCommands(st, line, at, atPath) {
  const add = nd => { at.kids.push(nd); return nd; };
  let linePos = instr(1, line, ':');
  if (!linePos) linePos = line.length + 1;
  let repeats = 1, repeatNode = null, last = '';
  let cmd = mid(line, 1, linePos - 1);
  const finish = () => { if (repeats > 1 && repeatNode) repeatNode.text += ` (x${repeats})`; repeatNode = null; repeats = 1; };

  while (linePos < line.length + 2) {
    let skip = false;
    if (cmd === last) { repeats++; skip = true; }
    else finish();

    if (!skip) {
      last = cmd;
      let nd = null;
      let value;
      if (cmd.includes('cast ')) {
        value = extractValue(cmd, 'cast ');
        if (value > 0) nd = add(node('Cast: ' + spellName(value), 'BOLT', { kind: 'spell', n: value }, true));
      } else if (cmd.includes('item ')) {
        value = extractValue(cmd, 'item ');
        if (value > 0) {
          const y = cmd.indexOf('item ');
          nd = add(node(`Item, ${cmd.slice(0, y)}: ${itemName(value)}`, 'ITEM', { kind: 'item', n: value }, true));
        } else if (cmd.includes('clearitem 0')) {
          nd = add(node('<Clear all items from room>', 'REDARROW', null, true));
        }
      } else if (cmd.includes('ability ') && !cmd.includes('testability')) {
        value = extractValue(cmd, 'ability ');
        if (value > 0) {
          const y = cmd.indexOf('ability ');
          nd = add(node(`Ability, ${cmd.slice(0, y)}: ${abilityName(value, true)} (${cmd})`, 'ARROW'));
        }
      } else if (cmd.includes('class ')) {
        value = extractValue(cmd, 'class ');
        if (value > 0) nd = add(node('Class: ' + className(value, true), 'REDARROW', { kind: 'class', n: value }, true));
      } else if (cmd.includes('race ')) {
        value = extractValue(cmd, 'race ');
        if (value > 0) nd = add(node('Race: ' + raceName(value, true), 'REDARROW', { kind: 'race', n: value }, true));
      } else if (cmd.includes('addexp ')) {
        value = extractValue(cmd, 'addexp ');
        if (value > 0) nd = add(node('AddExp: ' + commas(value), 'ARROW', null, true));
      } else if (cmd.includes('learnspell ')) {
        value = extractValue(cmd, 'learnspell ');
        if (value > 0) nd = add(node('Learnspell: ' + spellName(value), 'BOLT', { kind: 'spell', n: value }, true));
      } else if (cmd.includes('checkspell ')) {
        value = extractValue(cmd, 'checkspell ');
        if (value > 0) nd = add(node('Checkspell: ' + spellName(value), 'BOLT', { kind: 'spell', n: value }, true));
        let v2 = extractValue(cmd, 'checkspell ' + value);
        if (!v2) v2 = extractValue(cmd, 'checkspell  ' + value);
        if (v2 > 0) addCommandNode(st, v2, nd ? [...atPath, nd] : atPath, false, false, false);
      } else if (cmd.includes('summon ')) {
        value = extractValue(cmd, 'summon ');
        if (value > 0) nd = add(node('Summon: ' + monsterName(value), 'MONSTER', { kind: 'monster', n: value }, true));
      } else if (cmd.includes('random ')) {
        value = extractValue(cmd, 'random ');
        if (value > 0) nd = add(node('random: ' + value, 'PAPER', { kind: 'textblock', n: value }));
        addCommandNode(st, value, nd ? [...atPath, nd] : atPath, false, true, false);
      } else if (cmd.includes('price ')) {
        value = extractValue(cmd, 'price ');
        if (value > 0) nd = add(node('Cost: ' + commas(value) + coin(cmd), 'MONEY', null, true));
      } else if (cmd.includes('givecoins ')) {
        value = extractValue(cmd, 'givecoins ');
        if (value > 0) nd = add(node('Givecoins: ' + commas(value) + coin(cmd), 'MONEY', null, true));
      } else if (cmd.includes('teleport ')) {
        const t = commandTeleport(cmd);
        const map = t.map || st.defaultMap;
        if (t.room && map) nd = add(node('Teleport: ' + roomLabel(map, t.room), 'ROOM', { kind: 'room', n: roomKey(map, t.room) }, true));
        else nd = add(node(cmd, 'PAPER'));
      } else if (cmd.includes('remoteaction ')) {
        const r = remoteAction(cmd);
        const map = st.defaultMap;
        if (r.room && map) nd = add(node(`Remote Action${r.exit}: ${roomLabel(map, r.room)}`, 'ROOM', { kind: 'room', n: roomKey(map, r.room) }, true));
        else nd = add(node(cmd, 'PAPER'));
      } else if (cmd.includes('testskill ')) {
        value = testskillBlock(cmd);
        nd = add(node(cmd, 'PAPER'));
        if (value) addCommandNode(st, value, [...atPath, nd], false, false, false);
      } else if (!st.hideTB || /minlevel/i.test(cmd) || /align/i.test(cmd)) {
        nd = add(node(cmd, 'PAPER'));
      }
      repeatNode = nd;
    }

    // next_cmd:
    for (;;) {
      linePos = instr(linePos, line, ':') + 1;
      if (linePos === 1) { finish(); return; }
      let y2 = instr(linePos, line, ':');
      if (!y2) y2 = line.length + 1;
      if (y2 === linePos) continue;
      cmd = mid(line, linePos, y2 - linePos);
      linePos++;
      break;
    }
  }
}

// AddCommandNode's teleport scan (runs one character past the end, so a map
// at the end of the action is read).
function commandTeleport(cmd) {
  let x = instr(1, cmd, 'teleport ') + 'teleport '.length;
  let y = x, room = 0, map = 0;
  while (y <= cmd.length + 1) {
    const c = mid(cmd, y, 1);
    if (isDigit(c)) { /* digits */ }
    else if (c === ' ') {
      if (y > x && room === 0) { room = vbVal(mid(cmd, x, y - x)); x = y + 1; }
      else { map = vbVal(mid(cmd, x, y - x)); break; }
    } else {
      if (y > x && room === 0) room = vbVal(mid(cmd, x, y - x));
      else map = vbVal(mid(cmd, x, y - x));
      break;
    }
    y++;
  }
  return { room, map };
}

// "remoteaction <room> <message> <var> <exit>": the room and which exit it
// acts on.
function remoteAction(cmd) {
  let x = instr(1, cmd, 'remoteaction ') + 'remoteaction '.length;
  let y = x, room = 0, exit = '';
  while (y <= cmd.length + 1) {
    const c = mid(cmd, y, 1);
    if (isDigit(c)) { /* digits */ }
    else if (c === ' ') {
      if (y > x && room === 0) {
        room = vbVal(mid(cmd, x, y - x));
        x = instr(y + 1, cmd, ' ');          // after the message
        if (!x) break;
        x = instr(x + 1, cmd, ' ');          // after the first variable
        if (!x) break;
        y = x + 1;
        x = x + 1;
      }
    } else {
      if (y > x && room === 0) room = vbVal(mid(cmd, x, y - x));
      else if (y > x) {
        const d = vbVal(mid(cmd, x, y - x));
        if (d >= 0 && d <= 9) exit = ` (on the ${EXIT_NAMES[d]} exit)`;
      }
      break;
    }
    y++;
  }
  return { room, exit };
}

// "testskill <stat> <amount> <textblock>": the textblock run on failure.
function testskillBlock(cmd) {
  let x = instr(1, cmd, 'testskill ') + 'testskill '.length;
  x = instr(x, cmd, ' ') + 1;
  if (x === 1) return 0;
  x = instr(x, cmd, ' ') + 1;
  if (x === 1) return 0;
  let y = x;
  while (y <= cmd.length + 1 && isDigit(mid(cmd, y, 1))) y++;
  return y > x ? vbVal(mid(cmd, x, y - x)) : 0;
}

// GetRoomName(, map, room, False): "Name (map/room)".
export function roomLabel(map, room) {
  if (!map || !room) return '?';
  const r = by.room.get(roomKey(map, room));
  if (!r) return `${map}/${room}`;
  return `${r.Name || '(no name)'} (${map}/${room})`;
}

// frmResults.CreateExecutionTree: what runs a textblock, from its
// "Called From" column, followed back through the textblocks that call it.
export function executionTree(n, { hideTB = false, tbs = by.textblock } = {}) {
  const root = node(`Textblock ${n} is executed by ...`, 'PAPER', { kind: 'textblock', n });
  if (!tbs.get(n)) { root.text = `Textblock ${n} not found.`; return root; }
  const st = { nest: 0, hideTB, tbs, scanned: new Set(), stop: false };
  addExecutionNode(st, n, [root]);
  return root;
}

const CALLERS = ['room ', 'monster #', 'textblock #', 'textblock(rndm) #', 'item #', 'spell #'];

// frmResults.AddExecutionNode
function addExecutionNode(st, n, path) {
  const cur = path[path.length - 1];
  const add = nd => { cur.kids.push(nd); return nd; };
  if (st.hideTB) {
    if (st.scanned.has(n)) return;
    st.scanned.add(n);
  } else if (path.length > 1 && inAncestors(path, tbRe('Textblock', n))) {
    add(node(`Loop detected (Textblock ${n}) ... quitting.`, 'STAR'));
    return;
  }
  if (++st.nest > NEST_MAX) {
    if (st.nest === NEST_MAX + 1) path[0].kids.push(node('Too many references ... quitting.', 'STAR'));
    return;
  }
  const tb = st.tbs.get(n);
  if (!tb) return;
  const loc = String(tb['Called From'] ?? '');
  if (loc.length < 5) return;
  const test = loc.toLowerCase();

  for (let z = 0; z < CALLERS.length; z++) {
    const look = CALLERS[z];
    let x = 1;
    for (;;) {
      const at = instr(x, test, look);
      if (!at) break;
      const y1 = at + look.length;
      let y2 = 0, suffix = '';
      for (;;) {
        const c = mid(test, y1 + y2, 1);
        if (isDigit(c) || c === '/') { y2++; continue; }
        if (c === '+') return;                 // "... +": the list was cut short
        if (c === '(') {
          const x2 = instr(y1 + y2, test, ')');
          if (x2) suffix = ' ' + mid(test, y1 + y2, x2 - y1 - y2 + 1);
        }
        break;
      }
      if (y2 === 0) { x = y1; continue; }
      const raw = mid(test, y1, y2);
      const value = vbVal(raw);
      switch (z) {
        case 0: {        // room
          const [m, r] = raw.split('/').map(Number);
          const name = roomLabel(m, r);
          if (st.hideTB && hasText(path[0], 'Room: ' + name)) return;
          add(node('Room: ' + name + suffix, 'ROOM', { kind: 'room', n: roomKey(m, r) }, true));
          break;
        }
        case 1:
          add(node('Monster: ' + monsterName(value) + suffix, 'MONSTER', { kind: 'monster', n: value }, true));
          break;
        case 2: case 3:
          if (!st.hideTB) {
            const trig = textblockTrigger(value, n, st.tbs);
            const nd = add(node(`Textblock ${value}${suffix}${trig ? ' ' + trig : ''}`, 'PAPER', { kind: 'textblock', n: value }));
            addExecutionNode(st, value, [...path, nd]);
          } else addExecutionNode(st, value, [path[0]]);
          break;
        case 4:
          add(node('Item: ' + itemName(value) + suffix, 'ARROW', { kind: 'item', n: value }, true));
          break;
        case 5:
          add(node('Spell: ' + spellName(value) + suffix, 'ARROW', { kind: 'spell', n: value }, true));
          break;
      }
      x = y1;
    }
  }
}

function hasText(nd, s) {
  if (nd.text.includes(s)) return true;
  return nd.kids.some(k => hasText(k, s));
}
