import { useCallback, useEffect, useMemo, useState } from 'react';

import { NO_SESSION, type SessionId, type SessionSummary } from '@shared/ipc';

import { readShown, writeShown } from '../lib/shownView';
import {
  readGroups,
  railOrder,
  shownGroups,
  withAdded,
  withRemoved,
  writeGroups,
  type TabGroup
} from '../lib/tabGroups';

export interface View {
  /** The character the keyboard is talking to: alone, or its row of the group shown. */
  session: SessionId;
  /** The group on screen, its loaded members in the rail's order; null for one character alone. */
  rows: SessionSummary[] | null;
  /** Every group of two or more loaded members, for the rail to join their tabs. */
  groups: SessionId[][];
  /** The characters in the rail's order, each group's tabs together. */
  order: SessionSummary[];
  /** The character on screen was opened alone from its group, so Escape goes back to it. */
  fromGroup: boolean;
  /**
   * Show a character: its group, the keyboard on its row, or it alone.
   *
   * Sends nothing. The state is already here — every character's facts arrive
   * whether or not its terminal is on screen — so a switch is a change of view
   * and never a command. A bare Enter to "refresh" would be a command the player
   * did not type, and in this game a bare Enter is a full room description that
   * re-triggers everything listening for one.
   */
  showSession(id: SessionId): void;
  /** One character of a group shown alone, which Escape comes back from. */
  openAlone(id: SessionId): void;
  /** Back to the group of the character shown alone. */
  backToGroup(): void;
  /** The keyboard to a row of the group shown. */
  focusRow(id: SessionId): void;
  /** A character added to the view on screen, its tab joined to the group. */
  addToView(id: SessionId): void;
  /** A character taken out of its group, its tab standing alone again. */
  removeFromView(id: SessionId): void;
}

const newGroupId = (): string =>
  `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * What is on screen: one character, or a group of them (`lib/tabGroups.ts`),
 * a row each with the keyboard on one. The one way to put several characters
 * on screen since 2026-11-09, in place of the split panes and the Stable.
 */
export function useView(sessions: readonly SessionSummary[]): View {
  // Seeded from the last view drawn, so a remount after a lost web socket, a
  // reload or a relaunch comes back to it (upstream 3a3eb4aa).
  const [shown] = useState(readShown);
  const [wanted, setWanted] = useState<SessionId | null>(shown.session);
  const [alone, setAlone] = useState(shown.alone);
  const [stored, setStored] = useState<TabGroup[]>(readGroups);
  useEffect(() => writeGroups(stored), [stored]);

  const ids = sessions.map((entry) => entry.id).join('\n');
  const groups = useMemo(
    () => shownGroups(stored, ids === '' ? [] : ids.split('\n')),
    [stored, ids]
  );
  const order = useMemo(() => railOrder(sessions, groups), [sessions, groups]);

  /*
   * The character wanted, while it is loaded; else the first tab. Derived
   * rather than corrected in place: a character closing while it is on screen
   * must not leave the view pointing at an id nothing answers to.
   */
  const session =
    wanted !== null && sessions.some((entry) => entry.id === wanted)
      ? wanted
      : (order[0]?.id ?? NO_SESSION);
  const members = groups.find((group) => group.includes(session)) ?? null;
  const rows = useMemo(
    () =>
      members === null || alone
        ? null
        : members.map((id) => sessions.find((entry) => entry.id === id)!),
    // The members' ids are what the rows read.
    [members?.join('\n'), alone, sessions] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Nothing is written before the roster arrives, or a reload would forget
  // the choice it is about to restore.
  useEffect(() => {
    if (session !== NO_SESSION) writeShown({ session, alone });
  }, [session, alone]);
  /*
   * The first tab stood in for a character nobody had chosen, or one closed,
   * and is kept as the choice (2026-11-10): left to the derivation, dragging
   * another tab to the front switched the character on screen.
   */
  useEffect(() => {
    if (session !== NO_SESSION && wanted !== session) setWanted(session);
  }, [session, wanted]);

  const showSession = useCallback((id: SessionId) => {
    setWanted(id);
    setAlone(false);
  }, []);
  const openAlone = useCallback((id: SessionId) => {
    setWanted(id);
    setAlone(true);
  }, []);
  const backToGroup = useCallback(() => setAlone(false), []);
  const focusRow = useCallback((id: SessionId) => setWanted(id), []);

  const addToView = useCallback(
    (id: SessionId) => {
      setStored((was) => withAdded(was, session, id, newGroupId));
      // The view on screen is the group it joined, the keyboard where it was.
      setAlone(false);
    },
    [session]
  );
  const removeFromView = useCallback(
    (id: SessionId) => {
      // The keyboard stays with the group: on another member, if it was on this one.
      if (id === session && members !== null) {
        setWanted(members.find((member) => member !== id) ?? id);
      }
      setStored((was) => withRemoved(was, id));
    },
    [session, members]
  );

  return {
    session,
    rows,
    groups,
    order,
    fromGroup: alone && members !== null,
    showSession,
    openAlone,
    backToGroup,
    focusRow,
    addToView,
    removeFromView
  };
}
