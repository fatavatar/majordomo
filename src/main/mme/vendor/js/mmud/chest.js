// What a container can hold, and how likely each item is:
// frmMain.cmdSundryChests_Click + modMMudDatabase.GetChestItems.
//
// A container (ItemType 8) casts a spell (CastsSp) whose TextBlock ability
// names a textblock; that textblock's "random N" commands lead to textblocks
// of "percent:giveitem X / random Y" lines. Percent prefixes are cumulative
// thresholds, so each line's chance is the difference from the previous one.
// MME keeps the sums in Currency (4 decimals, banker's rounding); so do we.

import { by } from '../db.js';
import { cur, vbRound } from './vb.js';
import { vbVal, extractValue } from './textblocks.js';

const CONTAINER = 8, A_CASTSSP = 43, A_TEXTBLOCK = 148;

// The textblock action text a container's spell runs, or null.
export function chestTextblock(item, tbs = by.textblock, spells = by.spell) {
  if (typeof item === 'number') item = by.item.get(item);
  if (!item || item.ItemType !== CONTAINER) return null;
  for (let x = 0; x < 20; x++) {
    if (item['Abil-' + x] !== A_CASTSSP || !(item['AbilVal-' + x] > 0)) continue;
    const sp = spells.get(item['AbilVal-' + x]);
    if (!sp) continue;
    for (let y = 0; y < 10; y++) {
      if (sp['Abil-' + y] !== A_TEXTBLOCK) continue;
      const v = sp['AbilVal-' + y];
      const tbNum = v === 0 ? (sp.MinBase > 0 ? sp.MinBase : sp.MaxBase) : v;
      const tb = tbs.get(tbNum);
      if (tb && tb.Action) return String(tb.Action).toLowerCase();
    }
  }
  return null;
}

// GetChestItems: adds to `chest` (Map item -> {pct, fail}) from textblock n.
function getChestItems(chest, n, nest, pctMod, tbs) {
  const tb = tbs.get(n);
  if (!tb || !tb.Action) return;
  const data = String(tb.Action).toLowerCase();
  if (nest.n > 5) return;
  nest.n++;
  if (pctMod <= 0) pctMod = 1;

  const items = new Map();     // item -> summed percent, in first-seen order
  let pos = 1, per2 = 0;
  const instr = (start, s) => { const i = data.indexOf(s, start - 1); return i < 0 ? 0 : i + 1; };
  const mid = (start, len) => data.substr(start - 1, len);
  while (pos < data.length) {
    let x = instr(pos, ':');
    if (x > pos) {
      const per1 = vbVal(mid(pos, x - pos));
      const pct = cur((per1 - per2) / 100);
      per2 = per1;
      pos = x + 1;
      x = instr(pos, '\n');
      if (x <= 0) x = data.length;           // (MME drops the last char of an unterminated last line)
      const line = mid(pos, x - pos);
      pos = x;

      for (let y = line.indexOf('giveitem '); y >= 0; y = line.indexOf('giveitem ', y + 1)) {
        const item = extractValue(line.slice(y), 'giveitem ');
        items.set(item, cur((items.get(item) || 0) + pct));
      }
      for (let y = line.indexOf('random '); y >= 0; y = line.indexOf('random ', y + 1)) {
        const next = extractValue(line.slice(y), 'random ');
        if (next > 0) getChestItems(chest, next, nest, cur(pct * pctMod), tbs);
      }
    } else pos++;
  }

  for (const [item, pct] of items) {
    if (!(item > 0)) continue;
    const e = chest.get(item);
    if (e) {
      e.pct = cur(e.pct + cur(e.fail * pct * pctMod));
      e.fail = cur(e.fail * (1 - pct));
    } else {
      const p = cur(pct * pctMod);
      chest.set(item, { pct: p, fail: cur(1 - p) });
    }
  }
  nest.n--;
}

// [{ item, pct }] sorted by chance, highest first (pct is a percentage rounded
// to 1 decimal, as MME lists it); null if the item isn't a container with
// chest data.
export function chestContents(item, tbs = by.textblock, spells = by.spell) {
  const data = chestTextblock(item, tbs, spells);
  if (data == null) return null;
  const chest = new Map(), nest = { n: 0 };
  let pos = 0;
  for (let i = data.indexOf('random ', pos); i >= 0; i = data.indexOf('random ', pos)) {
    pos = i + 'random '.length;
    let x = pos;
    while (x < data.length && data[x] >= '0' && data[x] <= '9') x++;
    if (x > pos) getChestItems(chest, Number(data.slice(pos, x)), nest, 0, tbs);
  }
  return [...chest].filter(([item]) => item > 0)
    .map(([item, e]) => ({ item, pct: vbRound(e.pct * 100, 1) }))
    .sort((a, b) => b.pct - a.pct);
}
