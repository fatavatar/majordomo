/**
 * How much the logs directory may hold, and the files every session has open.
 *
 * A session log or a capture that reaches `logging.maxBytes` goes on in a new
 * part rather than stopping, and whenever a file is begun the directory is
 * brought back under `logging.keepBytes` by deleting its oldest logs and
 * captures — never one a session still has open. Until 2026-10-18 a file
 * stopped at its cap and the directory had none: Skinny's capture went silent
 * at 14:46 while he played until 19:53, and the directory had grown to 3.6 GB
 * over 660 files.
 */
import fs from 'node:fs';
import path from 'node:path';

/** What counts as a log here: the session logs and the captures, every part. */
const LOG_FILE = /\.(log|mudcap\.jsonl)$/;

/** Every log or capture some session is writing, so a prune never takes one. */
const open = new Set<string>();

export function holding(file: string): void {
  open.add(path.resolve(file));
}

export function released(file: string): void {
  open.delete(path.resolve(file));
}

/**
 * The file a log goes on in once `file` is full: `…_skinny.log` is followed by
 * `…_skinny.2.log`, a capture `…_skinny.mudcap.jsonl` by `…_skinny.2.mudcap.jsonl`.
 */
export function partName(file: string, part: number): string {
  const ext = file.endsWith('.mudcap.jsonl') ? '.mudcap.jsonl' : path.extname(file);
  return `${file.slice(0, file.length - ext.length)}.${part}${ext}`;
}

/**
 * Deletes the oldest logs and captures in `directory` until what is left is at
 * most `keepBytes`. Returns how many it deleted. A file that will not go is
 * left, and so is one in use; failing to prune costs disk, never the session.
 */
export function pruneLogs(directory: string, keepBytes: number): number {
  let names: string[];
  try {
    names = fs.readdirSync(directory);
  } catch {
    return 0;
  }
  const files: { file: string; size: number; at: number }[] = [];
  let total = 0;
  for (const name of names) {
    if (!LOG_FILE.test(name)) continue;
    const file = path.resolve(directory, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      total += stat.size;
      files.push({ file, size: stat.size, at: stat.mtimeMs });
    } catch {
      // Gone between the listing and the look: nothing to count.
    }
  }
  if (total <= keepBytes) return 0;
  files.sort((a, b) => a.at - b.at);
  let deleted = 0;
  for (const { file, size } of files) {
    if (total <= keepBytes) break;
    if (open.has(file)) continue;
    try {
      fs.unlinkSync(file);
      total -= size;
      deleted += 1;
    } catch {
      // In use elsewhere, or not ours to delete: left.
    }
  }
  return deleted;
}
