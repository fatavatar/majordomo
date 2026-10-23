// Which MajorMUD engine the loaded database describes. MME branches its
// formulas on bGreaterMUD / nNMRVer / nGlobalDatVer (modMMudFunc.bas); ported
// code reads the same facts from here.
//
// Only stock formulas are ported so far. Code that MME branches on bGreaterMUD
// should keep the branch point, `if (engine.greater) { ... }`, with a TODO for
// the GreaterMUD side rather than silently dropping it.

export const engine = {
  greater: false,      // GreaterMUD / Paramud database
  nmrVersion: 0,       // e.g. 1.83 for "v1.8.3"
  datLabel: '',        // e.g. "v1.11p"
  datVersion: 0,       // e.g. 1.11
  maxSwings: 5,
  disableKai: false,
};

// ExtractNumbersFromString (modSyntaxsFunc.bas): digits from the first run,
// keeping only the first decimal point, so "v1.8.3" reads as 1.83 and
// "v1.11p" as 1.11.
export function extractNumber(s) {
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

export function detectEngine(info) {
  info = info || {};
  engine.datLabel = info['Dat File Version'] || '';
  engine.datVersion = extractNumber(engine.datLabel);
  engine.nmrVersion = extractNumber(info['NMR Version']);
  engine.disableKai = engine.nmrVersion >= 1.83 && info.DisableKai === 1;
  engine.greater = info.Legit === 2;          // frmMain.LoadInfo
  engine.maxSwings = 5;                        // MAX_SWINGS; GreaterMUD > 1.85 allows 6
  if (engine.greater && engine.datVersion > 1.85) engine.maxSwings = 6;
  return engine;
}
