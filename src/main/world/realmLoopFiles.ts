/**
 * A realm's loops from its database, as files in the realm's loops folder
 * (2026-11-10): written when the database is new or changed, so every
 * character on the realm has them without importing anything.
 *
 * Which files were written is kept beside them (`.from-database.json`), with
 * what each said, so a rebuild replaces only its own: a file the player has
 * since edited is theirs and is left, and so is every loop they made or
 * imported. A loop whose name an edited file already holds is not written
 * again beside it.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

import { loopFileName, type Loop } from '../../shared/loops';
import { readLoops } from '../config/LoopStore';
import { loopFileText } from '../config/SettingsEditor';

export const DATABASE_LOOPS_MANIFEST = '.from-database.json';

/**
 * How the loops are made, raised when that changes so a realm's untouched
 * loops are made again from a database that has not: 2 is an area's bosses
 * left out of a second loop (2026-11-10).
 */
const LOOPS_MADE = 2;

interface Manifest {
  /** The database the loops were built from, and its modification time then. */
  file: string;
  builtAt: number;
  /** `LOOPS_MADE` when they were written; absent before it was kept. */
  made?: number;
  /** Each file written, by its name in the folder, and a hash of what it said. */
  written: Record<string, string>;
}

const hash = (text: string): string => createHash('sha1').update(text).digest('hex');

function manifestIn(dir: string): Manifest | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dir, DATABASE_LOOPS_MANIFEST), 'utf8'));
    return typeof value?.file === 'string' && typeof value?.builtAt === 'number'
      ? {
          file: value.file,
          builtAt: value.builtAt,
          ...(typeof value.made === 'number' ? { made: value.made } : {}),
          written: value.written ?? {}
        }
      : null;
  } catch {
    return null;
  }
}

/** Whether `dir` holds the loops of this database as it now is. */
export function databaseLoopsCurrent(dir: string, file: string, builtAt: number): boolean {
  const manifest = manifestIn(dir);
  return (
    manifest !== null &&
    manifest.file === file &&
    manifest.builtAt === builtAt &&
    manifest.made === LOOPS_MADE
  );
}

/** Replaces the loops last built from a database with `loops`; how many were written. */
export function writeDatabaseLoops(
  dir: string,
  source: { file: string; builtAt: number },
  loops: readonly Loop[],
  comment: string
): number {
  fs.mkdirSync(dir, { recursive: true });
  const kept = new Set<string>();
  for (const [name, said] of Object.entries(manifestIn(dir)?.written ?? {})) {
    const at = path.join(dir, name);
    let text: string;
    try {
      text = fs.readFileSync(at, 'utf8');
    } catch {
      continue;
    }
    if (hash(text) === said) fs.rmSync(at);
  }
  // What is left is the player's: its slugs are taken and its names held.
  const taken = new Set<string>();
  for (const name of fs.readdirSync(dir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    taken.add(name.replace(/\.ya?ml$/i, ''));
    try {
      const slug = name.replace(/\.ya?ml$/i, '');
      for (const loop of readLoops(parse(fs.readFileSync(path.join(dir, name), 'utf8')), slug))
        kept.add(loop.name.toLowerCase());
    } catch {
      // Unreadable: its slug stays taken, and LoopStore says what is wrong.
    }
  }
  const written: Record<string, string> = {};
  for (const loop of loops) {
    if (kept.has(loop.name.toLowerCase())) continue;
    const slug = loopFileName(loop.name, taken);
    taken.add(slug);
    const text = loopFileText(loop, comment);
    fs.writeFileSync(path.join(dir, `${slug}.yaml`), text);
    written[`${slug}.yaml`] = hash(text);
  }
  const manifest: Manifest = { ...source, made: LOOPS_MADE, written };
  fs.writeFileSync(path.join(dir, DATABASE_LOOPS_MANIFEST), `${JSON.stringify(manifest)}\n`);
  return Object.keys(written).length;
}
