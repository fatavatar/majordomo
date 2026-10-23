/**
 * The watch every store in this directory does, written once.
 *
 * `ConfigStore` explains at length why watching a file here means an owned
 * `setInterval` over `stat` rather than `fs.watch` or `fs.watchFile`: the first
 * loses the file the moment an editor saves by writing a temp file and renaming
 * over the target — vim, JetBrains and, in this tree, Dropbox — and the second
 * establishes its baseline with an *asynchronous* stat, so an edit landing
 * during startup is absorbed and never reported. Both failure modes are silent.
 *
 * That reasoning is not per store, so the mechanism should not be either. What
 * differs between them is only what counts as a revision: one file's size and
 * mtime, or a whole tree's listing. A signature is therefore a string the
 * caller composes, and this compares it against the one the current values were
 * actually read from — never against the previous poll, so a write racing a
 * read is picked up on the next tick instead of being mistaken for the
 * starting state.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { tuning } from '../app/tuning';

/**
 * How close to a read a file's mtime has to be for the mtime to say nothing.
 *
 * A file's mtime moves in ticks, not instants: on this machine a rewrite made
 * straight after a write kept the same mtime 183 times in 200 (2026-10-18),
 * and a coarse filesystem ticks once in two seconds. So a save landing in the
 * tick the store read in, the same length as what it replaced, left mtime and
 * size as they were and was never noticed — the ConfigStore test's
 * `size: 14` → `size: 20`, which failed whenever the two writes shared a
 * tick. Git calls such an entry *racy* and compares the contents instead;
 * `fileStamp` does the same, for a file whose mtime is within this of the
 * read, and only for that file.
 */
const RACY_MS = 2_000;

/**
 * One file's revision, for a `signature`: its mtime and size, and its
 * contents as well where the mtime is too close to `settledAt` to tell two
 * saves apart (`RACY_MS`). Throws where there is no such file, which the
 * caller or `Poller` absorbs.
 *
 * The contents are read only for a file written about when it was last read
 * — one just saved — so the poll stays a `stat` for every other: a home's
 * 252 files are 420 KB, which hashed twice a second would be the cost this
 * mechanism exists to avoid. Consistent across polls, because `settledAt`
 * is the read's own moment and not the poll's: a racy file is compared by
 * contents on every poll until the next read, never by contents on one and
 * by mtime on the next.
 */
export function fileStamp(file: string, settledAt: number): string {
  const stat = fs.statSync(file);
  const plain = `${stat.mtimeMs}:${stat.size}`;
  if (stat.mtimeMs < settledAt - RACY_MS) return plain;
  return `${plain}:${createHash('sha1').update(fs.readFileSync(file)).digest('hex')}`;
}

export interface PollerOptions {
  /**
   * Identifies what is on disk right now. Cheap: it runs twice a second.
   *
   * Must describe everything a reload would notice — for a tree that means a
   * file appearing or disappearing as well as one changing, or a deleted
   * character would go on being offered until the next restart. A file's part
   * is `fileStamp(file, settledAt)`, `settledAt` being when the current values
   * were read, so a save in the same mtime tick as that read is still seen.
   */
  signature(settledAt: number): string;
  /** Re-read. Called after the debounce, never during construction. */
  reload(): void;
}

export class Poller {
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;

  /** The revision the current values were read from. */
  private seen = '';
  /** When they were read, which `fileStamp` measures an mtime against. */
  private settledAt = 0;

  constructor(private readonly options: PollerOptions) {}

  /** Records what the caller has just read, so the next poll compares to it. */
  settle(): void {
    this.settledAt = Date.now();
    this.seen = this.safeSignature();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), tuning().files.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
  }

  /** One check. Exposed so a test need not wait out an interval. */
  poll(): void {
    if (this.safeSignature() === this.seen) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.options.reload();
    }, tuning().files.debounceMs);
    this.debounce.unref?.();
  }

  /**
   * A signature that throws is not a reason to stop watching.
   *
   * A directory can be removed and put back — that is what a sync client does
   * to one — and a watcher that died the first time it happened would leave the
   * client reporting values nobody can change any more.
   */
  private safeSignature(): string {
    try {
      return this.options.signature(this.settledAt);
    } catch {
      return 'unreadable';
    }
  }
}
