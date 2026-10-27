import fs from 'node:fs';
import path from 'node:path';

import { readRoster, sameName, type PartyRoster } from '../../shared/partyRoster';
import { errorMessage } from '../../shared/values';
import { t } from '../app/i18n';

/**
 * The Party card's rosters (2026-10-27), kept in main so Regroup can act on
 * them with no window open, and so every window draws the same one.
 *
 * Written as the player edits a roster on the card, or a member says
 * `@forget`: a handful of writes a session.
 */
export interface PartyBookOptions {
  /** Where the file lives. Created on demand. */
  file: string;
  /** Reported when the file cannot be read or written. Never silent. */
  notify?(message: string): void;
  /** Every roster, after any change. */
  changed?(rosters: PartyRoster[]): void;
}

interface PartyFile {
  v: number;
  rosters: PartyRoster[];
}

export class PartyBook {
  private kept: PartyRoster[] = [];
  private loaded = false;
  /** True once the file was found unreadable; nothing is written over it. */
  private suspended = false;

  constructor(private readonly options: PartyBookOptions) {}

  get all(): PartyRoster[] {
    this.load();
    return this.kept;
  }

  /**
   * A roster added or replaced by its id. A name is in one roster per realm,
   * so a member it names is taken out of any other on the same realm, and a
   * roster left with nobody is dropped. A roster with no members is removed.
   */
  save(value: unknown): PartyRoster[] {
    this.load();
    const roster = readRoster(value);
    if (roster === null) return this.kept;
    const named = (name: string): boolean =>
      roster.members.some((member) => sameName(member.name, name));
    const others = this.kept
      .filter((entry) => entry.id !== roster.id)
      .map((entry) => {
        if (entry.realm !== roster.realm) return entry;
        const members = entry.members.filter((member) => !named(member.name));
        if (members.length === entry.members.length) return entry;
        return {
          ...entry,
          members,
          leader: entry.leader !== null && named(entry.leader) ? null : entry.leader,
          forgotten: entry.forgotten.filter((name) => !named(name))
        };
      })
      .filter((entry) => entry.members.length > 0);
    this.commit(roster.members.length > 0 ? [...others, roster] : others);
    return this.kept;
  }

  remove(id: string): PartyRoster[] {
    this.load();
    this.commit(this.kept.filter((entry) => entry.id !== id));
    return this.kept;
  }

  /**
   * `@forget` from `name` on `realm`: left out of its roster's regrouping
   * until the player puts them back. Nothing when no roster names them.
   */
  forget(realm: string, name: string): void {
    this.load();
    let touched = false;
    const next = this.kept.map((entry) => {
      if (entry.realm !== realm) return entry;
      const member = entry.members.find((m) => sameName(m.name, name));
      if (!member || entry.forgotten.some((f) => sameName(f, name))) return entry;
      touched = true;
      return { ...entry, forgotten: [...entry.forgotten, member.name] };
    });
    if (touched) this.commit(next);
  }

  private commit(next: PartyRoster[]): void {
    if (JSON.stringify(next) === JSON.stringify(this.kept)) return;
    this.kept = next;
    this.write();
    this.options.changed?.(this.kept);
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
        t('notices.session.party.readError', {
          file: this.options.file,
          message: errorMessage(error)
        })
      );
      return;
    }
    const rosters =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)['rosters']
        : null;
    if (!Array.isArray(rosters)) return;
    for (const value of rosters) {
      const roster = readRoster(value);
      if (roster !== null && roster.members.length > 0) this.kept.push(roster);
    }
  }

  /** Temp file and rename, like every other file this client owns. */
  private write(): void {
    if (this.suspended) return;
    const temporary = `${this.options.file}.tmp`;
    const file: PartyFile = { v: 1, rosters: this.kept };
    try {
      fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
      fs.writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`);
      fs.renameSync(temporary, this.options.file);
    } catch (error) {
      this.options.notify?.(
        t('notices.session.party.writeError', {
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
