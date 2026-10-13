/**
 * What MegaMUD's database writers save of each record, read 2026-10-13:
 * monsters (`0x46fa70`), items (`0x45a240`) and players (`0x494640`), called
 * by `0x43bfa0` for each database marked changed. The writing itself is this
 * client's (`MegaLearned`); which records go, and what is done to them on
 * the way, is MegaMUD's.
 *
 * - **Monsters and items** go when they carry `0x40000000` (set by
 *   `newMonster`/`newItem` and by whatever changes one in play) and are not
 *   deleted (`0x80000000`). One with no number is given the next above every
 *   other record's, and no lower than 10000. Their flags go masked as the
 *   loader masks them.
 * - **Players** all go. One never stamped as seen is stamped now; one not
 *   seen for `Other.DelPlayers` days (and not kept, `0x200`) is removed
 *   instead. Flag 1 ("details wanted") is set, and cleared again when race,
 *   class and kind are all known; the session's own bits (`0xc000`) are not
 *   kept, nor a kind of 7.
 */
import type { ItemRec, MonsterRec, PlayerRec } from './data';
import type { Session } from './Session';

const CHANGED = 0x40000000;
const DELETED = 0x80000000;
const FIRST_LEARNED_ID = 10000;
const SECONDS_A_DAY = 0x15180;

/** `0x46fa70`/`0x45a240`'s numbering of a record with none: past every other, from 10000. */
function number<T extends { id: number }>(rec: T, all: readonly T[]): void {
  if (rec.id !== 0) return;
  for (const other of all) if (other !== rec && rec.id <= other.id) rec.id = other.id + 1;
  if (rec.id < FIRST_LEARNED_ID + 1) rec.id = FIRST_LEARNED_ID;
}

function changed(flags: number): boolean {
  return (flags & DELETED) === 0 && (flags & CHANGED) !== 0;
}

/** `0x46fa70`: the monsters to save. */
export function savedMonsters(s: Session): MonsterRec[] {
  const all = s.data.monsters;
  return all
    .filter((rec) => changed(rec.flags))
    .map((rec) => {
      number(rec, all);
      return { ...rec, flags: rec.flags & 0x3fffffff };
    });
}

/** `0x45a240`: the items to save. */
export function savedItems(s: Session): ItemRec[] {
  const all = s.data.items;
  return all
    .filter((rec) => changed(rec.flags))
    .map((rec) => {
      number(rec, all);
      return { ...rec, flags: rec.flags & 0x38ffffff };
    });
}

/**
 * `0x494640`: the players to save, and those removed for not being seen in
 * `Other.DelPlayers` days (taken off the list, as the writer does).
 * `kept` is a player's record as it was last saved, for the kind a 7 keeps.
 */
export function savedPlayers(
  s: Session,
  kept: (name: string) => PlayerRec | undefined
): { players: PlayerRec[]; removed: string[] } {
  const players: PlayerRec[] = [];
  const removed: string[] = [];
  for (const rec of [...(s.data.players ?? [])]) {
    if (rec.flags < 0 || (rec.flags & DELETED) !== 0) continue;
    if (rec.seenAt === 0) rec.seenAt = s.now;
    const days = Math.trunc((s.now - rec.seenAt) / SECONDS_A_DAY);
    if (
      s.now > rec.seenAt &&
      (rec.flags & 0x200) === 0 &&
      s.Other_DelPlayers >= 1 &&
      days > s.Other_DelPlayers
    ) {
      rec.flags |= DELETED;
      s.host.trace(`[Inactive player "${rec.name}" removed (not seen for ${days} days)]`);
      removed.push(rec.name);
      continue;
    }
    rec.flags |= 1;
    if (rec.race !== 0 && rec.cls !== 0 && rec.kind !== 0) rec.flags &= ~1;
    players.push({
      ...rec,
      flags: rec.flags & 0xffff3fff,
      kind: rec.kind === 7 ? (kept(rec.name)?.kind ?? 0) : rec.kind
    });
  }
  if (removed.length > 0) {
    s.data.players = (s.data.players ?? []).filter((rec) => (rec.flags & DELETED) === 0);
  }
  return { players, removed };
}
