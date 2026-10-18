/**
 * Copies MMUD Explorer's game logic from mudtool into this tree (2026-10-18).
 *
 * mudtool (`../mudtool`, the web port of syntax53/MMUD-Explorer) is where
 * that logic is written and tested; here it is a verbatim copy under
 * `src/main/mme/vendor/`, read only through `src/main/mme/Explorer.ts`. A
 * copy rather than a path out of the tree because a build sees this tree
 * alone (the Docker image is built from it). It is never edited here: a
 * change is made in mudtool and copied again.
 *
 *   npm run sync:mme [-- <path to mudtool>]
 *
 * The DOM-free half only: `js/db.js`, `js/char.js`, `js/state.js`,
 * `js/mmud/*.js` and `js/hooks/combat.js`, at the paths they import each
 * other by, and mudtool's pinned v1.11p test fixture for this tree's tests.
 * `VERSION` names the commit copied, and says so when the copy had changes
 * mudtool had not committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const source = path.resolve(process.argv[2] ?? '../mudtool');
const target = path.resolve('src/main/mme/vendor');

const FILES = ['js/db.js', 'js/char.js', 'js/state.js', 'js/hooks/combat.js'];
const DIRS = ['js/mmud'];
const FIXTURE = 'test/fixtures/v1.11p';

if (!fs.existsSync(path.join(source, 'js', 'mmud'))) {
  console.error(`No mudtool at ${source}: pass its path.`);
  process.exit(1);
}

const copy = (rel) => {
  const to = path.join(target, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(source, rel), to);
};

// Afresh, so a file mudtool removed does not linger here: every `.js`, and
// none of the `.d.ts` beside them, which are this tree's own (the types
// `Explorer.ts` reads the copy through).
const removeScripts = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) removeScripts(at);
    else if (entry.name.endsWith('.js')) fs.rmSync(at);
  }
};
removeScripts(path.join(target, 'js'));
fs.rmSync(path.join(target, 'fixtures'), { recursive: true, force: true });
let count = 0;
for (const rel of FILES) {
  copy(rel);
  count += 1;
}
for (const dir of DIRS) {
  for (const name of fs.readdirSync(path.join(source, dir)).sort()) {
    if (!name.endsWith('.js')) continue;
    copy(path.join(dir, name));
    count += 1;
  }
}
for (const name of fs.readdirSync(path.join(source, FIXTURE)).sort()) {
  const to = path.join(target, 'fixtures', 'v1.11p', name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(source, FIXTURE, name), to);
}

const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
let version = 'unknown';
try {
  const commit = git('rev-parse', 'HEAD');
  const subject = git('log', '-1', '--format=%s');
  const dirty = git('status', '--porcelain', '--', 'js', 'test/fixtures') !== '';
  version = `${commit}${dirty ? ' (with uncommitted changes)' : ''}\n${subject}\n`;
} catch {
  // Not a git checkout: the copy is still made, and says it cannot tell.
}
fs.writeFileSync(path.join(target, 'VERSION'), version);
console.log(`Copied ${count} files from ${source}: ${version.split('\n')[0]}`);
