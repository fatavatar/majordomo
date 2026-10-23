// The game database: every table from the .mdb, one plain object per row,
// keyed by the database's own column names (so `tabItems!Encum` in the VB6
// becomes `item.Encum` here).

export const db = {
  info: null,          // the single Info row
  Classes: [], Items: [], Lairs: [], Monsters: [], Races: [],
  Rooms: [], Shops: [], Spells: [], TBInfo: [],
};

// Lookup maps, built once after load.
export const by = {
  item: new Map(), monster: new Map(), spell: new Map(), shop: new Map(),
  cls: new Map(), race: new Map(), textblock: new Map(),
  room: new Map(),     // "map/room" -> row
};

export const roomKey = (map, room) => map + '/' + room;

function hydrate({ cols, rows }) {
  return rows.map(r => {
    const o = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = r[i];
    return o;
  });
}

// Fetch every table listed in data/manifest.json. `fetchJSON` is injectable
// so the tests can read files from disk instead.
export async function loadDB(base = 'data/', fetchJSON = defaultFetch) {
  const manifest = await fetchJSON(base + 'manifest.json');
  const names = Object.keys(manifest.tables);
  const tables = await Promise.all(names.map(n => fetchJSON(base + manifest.tables[n].file)));
  names.forEach((n, i) => {
    const rows = hydrate(tables[i]);
    if (n === 'Info') db.info = rows[0] || {};
    else db[n] = rows;
  });
  db.manifest = manifest;
  index();
  return db;
}

async function defaultFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function index() {
  const put = (m, list, key = 'Number') => { m.clear(); for (const r of list) m.set(r[key], r); };
  put(by.item, db.Items);
  put(by.monster, db.Monsters);
  put(by.spell, db.Spells);
  put(by.shop, db.Shops);
  put(by.cls, db.Classes);
  put(by.race, db.Races);
  put(by.textblock, db.TBInfo);
  by.room.clear();
  for (const r of db.Rooms) by.room.set(roomKey(r['Map Number'], r['Room Number']), r);
}

// ---------------------------------------------------------------- row helpers

// Numbered column groups: list(row, 'ClassRest-') -> [v0, v1, ...] for as many
// as the row has.
export function list(row, prefix) {
  const out = [];
  for (let i = 0; (prefix + i) in row; i++) out.push(row[prefix + i]);
  return out;
}

// [{abil, val}] for every non-zero ability slot (Abil-N / AbilVal-N).
export function abilities(row) {
  const out = [];
  for (let i = 0; ('Abil-' + i) in row; i++) {
    const abil = row['Abil-' + i];
    if (abil) out.push({ abil, val: row['AbilVal-' + i] || 0 });
  }
  return out;
}

// Sum of one ability's values on a row (an ability may appear in several slots).
export function abilityValue(row, abil) {
  let v = 0;
  for (let i = 0; ('Abil-' + i) in row; i++) if (row['Abil-' + i] === abil) v += row['AbilVal-' + i] || 0;
  return v;
}

export const hasAbility = (row, abil) => {
  for (let i = 0; ('Abil-' + i) in row; i++) if (row['Abil-' + i] === abil) return true;
  return false;
};

// Names, as MME's GetXName(n, bNoNumber) formats them.
const named = (m, what) => (n, noNumber) => {
  const r = m.get(n);
  if (!r) return n ? `${what} #${n}` : '';
  return noNumber ? r.Name : `${r.Name} (${n})`;
};
export const itemName = named(by.item, 'item');
export const monsterName = named(by.monster, 'monster');
export const spellName = named(by.spell, 'spell');
export const shopName = named(by.shop, 'shop');
export const className = named(by.cls, 'class');
export const raceName = named(by.race, 'race');
export const roomName = (map, room) => (by.room.get(roomKey(map, room)) || {}).Name || `room ${map}/${room}`;
