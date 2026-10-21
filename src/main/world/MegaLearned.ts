/**
 * What the MegaMUD engine learns in play that no other store of ours holds:
 * items it has met (their weight, and whether a weapon or worn where) and the
 * room signatures (`0x8130`) it learned where it and our tracker stood
 * together, so a path is not relearned on every launch.
 *
 * MegaMUD keeps its databases in memory, marks those it changed in play
 * (`0xe24c` players, `0xe254` monsters, `0xe258` items) and writes the marked
 * ones on the way out (`0x43bfa0`). The decision is MegaMUD's; where it goes
 * is ours: a monster's stance to the realm lore (`RealmLore.learnStance`), a
 * player to nothing at all (our tracker already writes what it sees of them
 * to `PlayerBook`), and the rest here — a realm-keyed JSON file beside the
 * others, written lazily by temp file and rename, as `RealmLore` is.
 *
 * **Keyed by realm**, as `RealmLore` is: an item's weight is a fact about the
 * world, and two characters on one realm learn it once between them.
 *
 * The first version of this file (13 October 2026) kept MegaMUD's own records
 * whole. It is read once more on the way in: its items and signatures are
 * kept, its monsters' stances handed to the lore (`takeStances`), and its
 * players dropped.
 */
import fs from 'node:fs';
import path from 'node:path';

import { t } from '../app/i18n';
import { tuning } from '../app/tuning';
import { RELATIONSHIPS, type Relationship } from '../../shared/monsterRules';
import { errorMessage } from '../../shared/values';
import type { RoomId } from '../../shared/world';
import { realmKey } from './RealmLore';

/** An item as the engine learned it. Null where it has not found out. */
export interface LearnedItem {
  name: string;
  weight: number | null;
  /** Worn where (MegaMUD's location number), when known to be worn. */
  slot: number | null;
  weapon: boolean;
}

/** What one realm's engine learned that is kept here. */
/**
 * A monster's marks as MegaMUD keeps them (`0x471060`): its name and its
 * immunity flags, and the spells it is immune to (`combat/immunity.ts`).
 */
export type LearnedMark = [string, number] | [string, number, string[]];

export interface MegaLearnedData {
  items: LearnedItem[];
  signatures: [RoomId, number][];
  /**
   * The monsters each character has marked, by the character's name: what
   * they are immune to names that character's own spells and weapon, so one
   * character's marks are not another's.
   */
  marks: Record<string, LearnedMark[]>;
}

export interface MegaLearnedOptions {
  /** Where the file lives. Created on demand. */
  file: string;
  /** How long to wait before writing after a change. */
  saveDelayMs?: number;
  /** Reported when the file cannot be read or written. Never silent. */
  notify?(message: string): void;
}

const VERSION = 2;

interface LearnedFile {
  v: number;
  realms: Record<string, MegaLearnedData>;
}

interface RealmTables {
  items: Map<string, LearnedItem>;
  signatures: Map<RoomId, number>;
  marks: Map<string, LearnedMark[]>;
}

/** MegaMUD's relationship numbers, as the first version kept them. */
const RELATIONSHIP_OF: Record<number, Relationship> = {
  2: 'friend',
  3: 'avoid',
  4: 'enemy',
  5: 'escape',
  6: 'hangup'
};

/** A name's key: MegaMUD finds its records without regard to case. */
function nameKey(name: string): string {
  return name.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asItem(raw: unknown, version: number): LearnedItem | null {
  if (!isRecord(raw) || typeof raw['name'] !== 'string') return null;
  if (version < 2) {
    // MegaMUD's item record: weight -1 unknown, type 1 a weapon, location where worn.
    const weight = typeof raw['weight'] === 'number' && raw['weight'] >= 0 ? raw['weight'] : null;
    const weapon = raw['type'] === 1;
    const location = typeof raw['location'] === 'number' ? raw['location'] : 0;
    return { name: raw['name'], weight, slot: !weapon && location > 0 ? location : null, weapon };
  }
  return {
    name: raw['name'],
    weight: typeof raw['weight'] === 'number' ? raw['weight'] : null,
    slot: typeof raw['slot'] === 'number' ? raw['slot'] : null,
    weapon: raw['weapon'] === true
  };
}

export class MegaLearned {
  private readonly realms = new Map<string, RealmTables>();
  /** Stances found in a first-version file, for the lore. See `takeStances`. */
  private legacyStances: { realm: string; mob: string; relationship: Relationship }[] = [];
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
    if (!tables) return { items: [], signatures: [], marks: {} };
    return structuredClone({
      items: [...tables.items.values()],
      signatures: [...tables.signatures],
      marks: Object.fromEntries(tables.marks)
    });
  }

  /** Items and signatures the engine learned, kept over what is on file. */
  keep(realm: string, learned: Partial<MegaLearnedData>): void {
    this.load();
    if (this.suspended) return;
    const key = realmKey(realm);
    let tables = this.realms.get(key);
    if (!tables) {
      tables = { items: new Map(), signatures: new Map(), marks: new Map() };
      this.realms.set(key, tables);
    }
    for (const item of learned.items ?? []) tables.items.set(nameKey(item.name), { ...item });
    for (const [room, sig] of learned.signatures ?? []) tables.signatures.set(room, sig);
    // A character's marks are its whole list, as MegaMUD holds it.
    for (const [who, marks] of Object.entries(learned.marks ?? {})) {
      tables.marks.set(
        nameKey(who),
        marks.map((mark): LearnedMark =>
          mark[2] === undefined ? [mark[0], mark[1]] : [mark[0], mark[1], [...mark[2]]]
        )
      );
    }
    this.schedule();
  }

  /**
   * The monsters' stances a first-version file held, taken once, for the
   * caller to hand to the realm lore; the file is then rewritten without them.
   */
  takeStances(): { realm: string; mob: string; relationship: Relationship }[] {
    this.load();
    const taken = this.legacyStances;
    this.legacyStances = [];
    return taken;
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
    const file = isRecord(parsed) ? parsed : {};
    const version = typeof file['v'] === 'number' ? file['v'] : VERSION;
    for (const [realm, data] of Object.entries(isRecord(file['realms']) ? file['realms'] : {})) {
      if (!isRecord(data)) continue;
      const tables: RealmTables = { items: new Map(), signatures: new Map(), marks: new Map() };
      for (const raw of Array.isArray(data['items']) ? data['items'] : []) {
        const item = asItem(raw, version);
        if (item) tables.items.set(nameKey(item.name), item);
      }
      for (const pair of Array.isArray(data['signatures']) ? data['signatures'] : []) {
        if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'number') {
          tables.signatures.set(pair[0] as RoomId, pair[1]);
        }
      }
      if (isRecord(data['marks'])) {
        for (const [who, list] of Object.entries(data['marks'])) {
          if (!Array.isArray(list)) continue;
          const marks = list.filter(
            (pair): pair is LearnedMark =>
              Array.isArray(pair) &&
              typeof pair[0] === 'string' &&
              typeof pair[1] === 'number' &&
              (pair[2] === undefined ||
                (Array.isArray(pair[2]) && pair[2].every((spell) => typeof spell === 'string')))
          );
          tables.marks.set(nameKey(who), marks);
        }
      }
      if (version < 2) {
        for (const mon of Array.isArray(data['monsters']) ? data['monsters'] : []) {
          if (!isRecord(mon) || typeof mon['name'] !== 'string') continue;
          const relationship = RELATIONSHIP_OF[Number(mon['relationship'])];
          if (relationship && RELATIONSHIPS.includes(relationship)) {
            this.legacyStances.push({ realm, mob: mon['name'], relationship });
          }
        }
      }
      this.realms.set(realm, tables);
    }
    // A first-version file is rewritten in this one's shape.
    if (version < VERSION) this.schedule();
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
    const realms: LearnedFile['realms'] = {};
    for (const [realm, tables] of [...this.realms].sort(([a], [b]) => (a < b ? -1 : 1))) {
      realms[realm] = {
        items: [...tables.items.values()].sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0
        ),
        signatures: [...tables.signatures].sort(([a], [b]) => (a < b ? -1 : 1)),
        marks: Object.fromEntries([...tables.marks].sort(([a], [b]) => (a < b ? -1 : 1)))
      };
    }
    const temporary = `${this.options.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
      fs.writeFileSync(
        temporary,
        `${JSON.stringify({ v: VERSION, realms } satisfies LearnedFile, null, 2)}\n`
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
