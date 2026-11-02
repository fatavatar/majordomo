/**
 * The Electron binary a script launches, fetched first if it is not there.
 *
 * Since Electron 42 the package fetches its binary the first time it is
 * *used* rather than in a `postinstall` script, so `npm ci` leaves
 * `node_modules/electron/dist` empty (Electron 42 breaking changes: "electron
 * no longer downloads itself via postinstall"). The package's `index.js`
 * answers the binary's path and downloads it if it is missing, so requiring it
 * is how a script both finds the binary and makes sure there is one. The
 * scripts used to name `node_modules/electron/dist/electron` themselves,
 * which a fresh clone no longer has -- and which on macOS was never the
 * binary, that being inside `Electron.app`.
 *
 * Required, never imported, and only here: under plain Node `electron` is the
 * npm package, whose export is that path.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The absolute path of the Electron executable, downloaded if need be. */
export function electronBinary() {
  return require('electron');
}
