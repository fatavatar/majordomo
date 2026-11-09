/**
 * Tab groups (2026-11-09): characters whose tabs are joined in the rail and
 * shown together, a row each, status beside console. They replace the Stable,
 * which showed every character in the realm whether wanted or not, and the
 * split panes, which only the palette and a chord knew about: a character is
 * added to the view on screen, or taken out of it, and that is the grouping.
 *
 * A character is in one group at most. A group keeps the ids it was given
 * while a member is closed, so reopening one puts it back where it was; it is
 * shown as a group while two or more of it are loaded. Per browser, as a card
 * layout is: what one screen has room to watch is that screen's choice.
 */
import type { SessionId } from '@shared/ipc';

import { readStored, writeStored } from './storage';

export interface TabGroup {
  id: string;
  members: SessionId[];
}

const KEY = 'mudengine.tabGroups';

export function parseGroups(stored: string): TabGroup[] {
  const parsed = JSON.parse(stored) as unknown;
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<SessionId>();
  const groups: TabGroup[] = [];
  for (const entry of parsed as Array<{ id?: unknown; members?: unknown }>) {
    if (typeof entry?.id !== 'string' || !Array.isArray(entry.members)) continue;
    // One group a character: a later claim on one already placed is dropped.
    const members = entry.members.filter(
      (id): id is SessionId => typeof id === 'string' && !seen.has(id)
    );
    for (const id of members) seen.add(id);
    if (members.length >= 2) groups.push({ id: entry.id, members });
  }
  return groups;
}

export const readGroups = (): TabGroup[] => readStored(KEY, parseGroups, () => []);

export function writeGroups(groups: readonly TabGroup[]): void {
  writeStored(KEY, JSON.stringify(groups));
}

/** The group a character is in, loaded or not. */
export function groupOf(groups: readonly TabGroup[], id: SessionId): TabGroup | null {
  return groups.find((group) => group.members.includes(id)) ?? null;
}

/** A character taken out of its group, and a group left with one member undone. */
export function withRemoved(groups: readonly TabGroup[], id: SessionId): TabGroup[] {
  return groups
    .map((group) =>
      group.members.includes(id)
        ? { ...group, members: group.members.filter((member) => member !== id) }
        : group
    )
    .filter((group) => group.members.length >= 2);
}

/**
 * `id` added to the view `shown` is in: its group, or a new one of the two.
 * `id` leaves any group it was in first, which can undo that one.
 */
export function withAdded(
  groups: readonly TabGroup[],
  shown: SessionId,
  id: SessionId,
  newId: () => string
): TabGroup[] {
  if (id === shown) return [...groups];
  const rest = withRemoved(groups, id);
  const into = groupOf(rest, shown);
  if (into !== null) {
    return rest.map((group) =>
      group === into ? { ...group, members: [...group.members, id] } : group
    );
  }
  return [...rest, { id: newId(), members: [shown, id] }];
}

/**
 * The groups as the rail draws them: each one's loaded members in the rail's
 * order, where two or more of them are loaded.
 */
export function shownGroups(
  groups: readonly TabGroup[],
  order: readonly SessionId[]
): SessionId[][] {
  return groups
    .map((group) => order.filter((id) => group.members.includes(id)))
    .filter((members) => members.length >= 2);
}

/**
 * The rail's order with each group's tabs together, where its first member
 * stands: a group is one block in the rail, and a tab dragged is dragged
 * within the order as it is drawn.
 */
export function railOrder<T extends { id: SessionId }>(
  sessions: readonly T[],
  groups: readonly SessionId[][]
): T[] {
  const placed = new Set<SessionId>();
  const out: T[] = [];
  for (const entry of sessions) {
    if (placed.has(entry.id)) continue;
    const group = groups.find((members) => members.includes(entry.id));
    for (const id of group ?? [entry.id]) {
      const member = sessions.find((other) => other.id === id);
      if (member === undefined) continue;
      placed.add(id);
      out.push(member);
    }
  }
  return out;
}
