// App-wide events and settings.
//
// Events:
//   'char'    the active character changed (detail.switched when a different one was loaded)
//   'filter'  the global filter was toggled or its settings changed
//   'compare' a compare / saved list changed

const bus = new EventTarget();
export const emit = (name, detail = {}) => {
  const e = new Event(name);
  e.detail = detail;
  bus.dispatchEvent(e);
};
export const on = (name, fn) => {
  const h = e => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
};

// User settings (MME's settings.ini [Settings]); per-browser.
const KEY = 'mme.settings';
export const settings = {
  globalFilter: false,       // chkGlobalFilter: limit lists to what the active character can use
  showShopsFirst: false,     // "Show shops first in item references"
  jumpOnAdd: false,          // "Jump to Equip/Lists on Add"
  onlyInGame: true,
  mapSwapButtons: false,     // bMapSwapButtons
  use2ndWrist: true,          // bOnlyInGame: hide records that aren't in the game
  // frmSettings' exp/hr options (cephModelA..D, cephDMG/Mana/Move/XP, cephRecovery,
  // cephShowAll): see js/mmud/exphr.js EXPHR_DEFAULTS / normaliseExpHrConfig
  exphr: { models: { A: true, B: true, C: true, D: true }, xp: 1, dmg: 1, mana: 1, move: 1, recoveryOnly: false, showAll: false },
};
try { Object.assign(settings, JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}')); } catch { /* defaults */ }

export function setSetting(k, v) {
  settings[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* unavailable */ }
  emit(k === 'globalFilter' ? 'filter' : 'settings', { key: k });
}

// Session view state other modules read. monstersByLair: the Monsters tab's
// optMonsterFilter(1) ("By Lair"), which brings the party boxes into play for
// damage in/out. Change it with setView() so listeners recompute.
export const view = { monstersByLair: false };
export function setView(k, v) {
  if (view[k] === v) return;
  view[k] = v;
  emit('filter', { key: k });
}

// Session-only state shared between tabs (not saved, as in MME).
export const session = {
  // EQ "Empty lists": per-slot item lists that replace the full ones until the
  // global filter is next toggled; items equipped meanwhile join their slot's list.
  eqCustom: null,
};
