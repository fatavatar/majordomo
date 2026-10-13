/**
 * What the MegaMUD engine learns in play, kept between sessions.
 *
 * MegaMUD keeps its databases in memory, marks each one it changed while
 * playing — a monster or item seen for the first time, a player met, a
 * monster's experience or an item's weight worked out (`0xe24c` players,
 * `0xe254` monsters, `0xe258` items) — and on the way out writes the marked
 * ones back to their `.md` files (`0x43bfa0`, called from the end of
 * `0x466d00`). The logic is MegaMUD's; the storage is this client's own, as
 * its other learned files are: a realm-keyed JSON file beside them, written
 * lazily by temp file and rename. MegaMUD's own files are only ever read.
 *
 * Records are kept whole, by name (monsters, items, players) — the engine
 * lays them over the realm's `.md` data when it starts — and room signatures
 * by room, so a path learned once is not relearned on every launch.
 *
 * **Keyed by realm**, as `RealmLore` is: a monster's experience is a fact
 * about the world, and two characters on one realm learn it once between
 * them.
 */
import fs from 'node:fs';
import path from 'node:path';

import { t } from '../app/i18n';
import { tuning } from '../app/tuning';
import type { ItemRec, MonsterRec, PlayerRec } from '../megamud/data';
import type { RoomId } from '../../shared/world';
import { errorMessage } from '../../shared/values';
import { realmKey } from './RealmLore';

/** What one realm's engine has learned. */
export interface MegaLearnedData {
  monsters: MonsterRec[];
  items: ItemRec[];
  players: PlayerRec[];
  /** Room signatures (`0x8130`) learned where the engine and our tracker stood together. */
  signatures: [RoomId, number][];
  /** Players MegaMUD removed for not being seen in `Other.DelPlayers` days (`0x494640`). */
  removedPlayers?: string[];
}

export interface MegaLearnedOptions {
  /** Where the file lives. Created on demand. */
  file: string;
  /** How long to wait before writing after a change. */
  saveDelayMs?: number;
  /** Reported when the file cannot be read or written. Never silent. */
  notify?(message: string): void;
}

interface LearnedFile {
  v: number;
  realms: Record<string, MegaLearnedData>;
}

interface RealmTables {
  monsters: Map<string, MonsterRec>;
  items: Map<string, ItemRec>;
  players: Map<string, PlayerRec>;
  signatures: Map<RoomId, number>;
}

function emptyTables(): RealmTables {
  return { monsters: new Map(), items: new Map(), players: new Map(), signatures: new Map() };
}

/** A name's key: MegaMUD finds its records without regard to case. */
function nameKey(name: string): string {
  return name.toLowerCase();
}

function records<T extends { name: string }>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (rec): rec is T =>
      typeof rec === 'object' && rec !== null && typeof (rec as T).name === 'string'
  );
}

export class MegaLearned {
  private readonly realms = new Map<string, RealmTables>();
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private loaded = false;
  /** True once the file was found unparseable; nothing is written over it. */
  private suspended = false;

  constructor(private readonly options: MegaLearnedOptions) {}

  /** What this realm's engine learned before; empty when nothing. */
  forRealm(realm: string): MegaLearnedData {
    this.load();
    const tables = this.realms.get(realmKey(realm));
    if (!tables) return { monsters: [], items: [], players: [], signatures: [] };
    return structuredClone({
      monsters: [...tables.monsters.values()],
      items: [...tables.items.values()],
      players: [...tables.players.values()],
      signatures: [...tables.signatures]
    });
  }

  /** Records and signatures the engine changed, kept over what is on file. */
  keep(realm: string, learned: MegaLearnedData): void {
    this.load();
    if (this.suspended) return;
    const key = realmKey(realm);
    let tables = this.realms.get(key);
    if (!tables) this.realms.set(key, (tables = emptyTables()));
    for (const rec of learned.monsters)
      tables.monsters.set(nameKey(rec.name), structuredClone(rec));
    for (const rec of learned.items) tables.items.set(nameKey(rec.name), structuredClone(rec));
    for (const rec of learned.players) tables.players.set(nameKey(rec.name), structuredClone(rec));
    for (const name of learned.removedPlayers ?? []) tables.players.delete(nameKey(name));
    for (const [room, sig] of learned.signatures) tables.signatures.set(room, sig);
    this.schedule();
  }

  /** Read once, on the first question asked; see `RealmLore.load`. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    let raw: string;
    try {
      raw = fs.readFileSync(this.options.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.options.notify?.(
          t('notices.world.megaLearned.readError', {
            file: this.options.file,
            message: errorMessage(error)
          })
        );
      }
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // Kept, not replaced, and retried on the next question: see `RealmLore.load`.
      this.loaded = false;
      if (!this.suspended) {
        this.suspended = true;
        this.options.notify?.(
          t('notices.world.megaLearned.parseSuspended', {
            fileName: path.basename(this.options.file),
            message: errorMessage(error)
          })
        );
      }
      return;
    }
    this.suspended = false;
    const file = parsed as Partial<LearnedFile>;
    for (const [realm, data] of Object.entries(file.realms ?? {})) {
      if (typeof data !== 'object' || data === null) continue;
      const tables = emptyTables();
      for (const rec of records<MonsterRec>(data.monsters)) {
        tables.monsters.set(nameKey(rec.name), rec);
      }
      for (const rec of records<ItemRec>(data.items)) tables.items.set(nameKey(rec.name), rec);
      for (const rec of records<PlayerRec>(data.players)) {
        tables.players.set(nameKey(rec.name), rec);
      }
      for (const pair of Array.isArray(data.signatures) ? data.signatures : []) {
        if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'number') {
          tables.signatures.set(pair[0] as RoomId, pair[1]);
        }
      }
      this.realms.set(realm, tables);
    }
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, this.options.saveDelayMs ?? tuning().records.loreSaveDelayMs);
    this.timer.unref?.();
  }

  /** Writes what has been learned, by temp file and rename. */
  save(): void {
    if (this.suspended || !this.dirty) return;
    this.dirty = false;
    const byName = <T extends { name: string }>(a: T, b: T): number =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    const realms: LearnedFile['realms'] = {};
    for (const [realm, tables] of [...this.realms].sort(([a], [b]) => (a < b ? -1 : 1))) {
      realms[realm] = {
        monsters: [...tables.monsters.values()].sort(byName),
        items: [...tables.items.values()].sort(byName),
        players: [...tables.players.values()].sort(byName),
        signatures: [...tables.signatures].sort(([a], [b]) => (a < b ? -1 : 1))
      };
    }
    const temporary = `${this.options.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
      fs.writeFileSync(
        temporary,
        `${JSON.stringify({ v: 1, realms } satisfies LearnedFile, null, 2)}\n`
      );
      fs.renameSync(temporary, this.options.file);
    } catch (error) {
      this.dirty = true;
      this.options.notify?.(
        t('notices.world.megaLearned.writeError', {
          file: this.options.file,
          message: errorMessage(error)
        })
      );
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // See `RealmLore.save`.
      }
    }
  }

  /** Writes anything outstanding and stops the timer. Called on quit. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.save();
  }
}
