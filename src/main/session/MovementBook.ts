import fs from 'node:fs';
import path from 'node:path';

import type { RoomId } from '../../shared/world';
import { errorMessage } from '../../shared/values';
import { t } from '../app/i18n';

/**
 * What each character was walking when its session went away, so it is taken
 * up again when the character is next in the game (2026-10-14): a server
 * stopped and started, a Disconnect and a Connect, a dropped line. MegaMUD
 * itself only starts what its `On entry` setting names (`StartTask`,
 * `0x47b070`); a loop or a route the player started is ours to remember.
 *
 * Keyed by character. Written as it changes, which is when a loop or a
 * route starts or ends: a handful of writes an hour, each a few bytes.
 */
export type ResumableMovement = { loop: string } | { to: RoomId; run: boolean };

export interface MovementBookOptions {
  /** Where the file lives. Created on demand. */
  file: string;
  /** Reported when the file cannot be read or written. Never silent. */
  notify?(message: string): void;
}

interface MovementFile {
  v: number;
  characters: Record<string, ResumableMovement>;
}

export class MovementBook {
  private readonly kept = new Map<string, ResumableMovement>();
  private loaded = false;
  /** True once the file was found unreadable; nothing is written over it. */
  private suspended = false;

  constructor(private readonly options: MovementBookOptions) {}

  get(id: string): ResumableMovement | null {
    this.load();
    return this.kept.get(id) ?? null;
  }

  set(id: string, movement: ResumableMovement | null): void {
    this.load();
    const was = this.kept.get(id) ?? null;
    if (JSON.stringify(was) === JSON.stringify(movement)) return;
    if (movement === null) this.kept.delete(id);
    else this.kept.set(id, movement);
    this.save();
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.options.file, 'utf8'));
    } catch (error) {
      // Not there yet is the ordinary first run.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.suspended = true;
      this.options.notify?.(
        t('notices.session.movement.readError', {
          file: this.options.file,
          message: errorMessage(error)
        })
      );
      return;
    }
    const characters =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)['characters']
        : null;
    if (typeof characters !== 'object' || characters === null) return;
    for (const [id, value] of Object.entries(characters)) {
      const movement = readMovement(value);
      if (movement !== null) this.kept.set(id, movement);
    }
  }

  /** Temp file and rename, like every other file this client owns. */
  private save(): void {
    if (this.suspended) return;
    const temporary = `${this.options.file}.tmp`;
    const file: MovementFile = { v: 1, characters: Object.fromEntries(this.kept) };
    try {
      fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
      fs.writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`);
      fs.renameSync(temporary, this.options.file);
    } catch (error) {
      this.options.notify?.(
        t('notices.session.movement.writeError', {
          file: this.options.file,
          message: errorMessage(error)
        })
      );
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // A warning was given; a temp file that will not go away is not a crash.
      }
    }
  }
}

/** One character's row, or null. Every field is checked; none is coerced. */
function readMovement(value: unknown): ResumableMovement | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const loop = record['loop'];
  if (typeof loop === 'string' && loop.trim() !== '') return { loop: loop.trim() };
  const to = record['to'];
  if (typeof to === 'string' && to.trim() !== '') {
    return { to: to.trim() as RoomId, run: record['run'] === true };
  }
  return null;
}
