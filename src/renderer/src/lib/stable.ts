/**
 * The Stable's rows grouped (2026-10-31): a party's members of ours together.
 * See `StableView`.
 */
import type { SessionId } from '@shared/ipc';
import { rosterOf, sameName, type PartyRoster } from '@shared/partyRoster';

/**
 * A row of the Stable, or a party's rows (2026-10-31): characters of ours on
 * one party roster, two or more of them in the realm, are one block, the
 * leader first and the rest in the roster's order; everybody else is a row
 * of their own. In the order the rail has them, a party where its first
 * member would be.
 */
export type StableBlock =
  { kind: 'solo'; id: SessionId } | { kind: 'party'; roster: PartyRoster; ids: SessionId[] };

export function stableBlocks(
  rows: ReadonlyArray<{ id: SessionId; server: string }>,
  nameOf: (id: SessionId) => string | null,
  rosters: readonly PartyRoster[]
): StableBlock[] {
  const rosterFor = new Map<SessionId, PartyRoster>();
  for (const row of rows) {
    const roster = rosterOf(rosters, row.server, nameOf(row.id));
    if (roster !== null) rosterFor.set(row.id, roster);
  }
  const blocks: StableBlock[] = [];
  const placed = new Set<SessionId>();
  for (const row of rows) {
    if (placed.has(row.id)) continue;
    const roster = rosterFor.get(row.id);
    const mates =
      roster === undefined ? [] : rows.filter((other) => rosterFor.get(other.id) === roster);
    if (roster === undefined || mates.length < 2) {
      placed.add(row.id);
      blocks.push({ kind: 'solo', id: row.id });
      continue;
    }
    const rank = (id: SessionId): number => {
      const name = nameOf(id) ?? '';
      if (roster.leader !== null && sameName(roster.leader, name)) return -1;
      const at = roster.members.findIndex((member) => sameName(member.name, name));
      return at < 0 ? roster.members.length : at;
    };
    const ids = mates.map((mate) => mate.id).sort((a, b) => rank(a) - rank(b));
    for (const id of ids) placed.add(id);
    blocks.push({ kind: 'party', roster, ids });
  }
  return blocks;
}
