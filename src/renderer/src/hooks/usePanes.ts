import { useCallback, useEffect, useMemo, useState } from 'react';

import { NO_SESSION, type SessionId, type SessionSummary } from '@shared/ipc';

import { inRealm, useLeftOut } from '../components/StableView';
import type { RailView } from '../components/TabRail';
import { readShown, writeShown } from '../lib/shownPanes';

export interface Panes {
  /** The characters on screen, one per pane: never one that is no longer loaded. */
  panes: SessionId[];
  /** Which pane the keyboard is talking to. */
  paneAt: number;
  /** The character being shown: the Stable's row with the keyboard while it is shown, else the pane's. */
  session: SessionId;
  /** The Stable shown in place of the panes, while there is anybody to show in it. */
  stableOn: boolean;
  /** The Stable's rows: the characters in the realm, less those left out. */
  stableRows: SessionSummary[];
  /** The characters out of the realm, who get no row. */
  stableAway: SessionSummary[];
  /** The characters left out of it. */
  stableLeftOut: SessionSummary[];
  /** The character on screen was opened from the Stable, so Escape goes back to it. */
  fromStable: boolean;
  leaveOut(session: SessionId): void;
  bringBack(session: SessionId): void;
  /**
   * Show a different character.
   *
   * Sends nothing. The state is already here — every character's facts arrive
   * whether or not its terminal is on screen — so a switch is a change of view
   * and never a command. A bare Enter to "refresh" would be a command the player
   * did not type, and in this game a bare Enter is a full room description that
   * re-triggers everything listening for one.
   */
  showSession(id: SessionId): void;
  /** The Stable shown, and the row the keyboard was last talking to kept. */
  showStable(): void;
  /** The keyboard to a character already on screen: its pane, or its row of the Stable. */
  focusPane(id: SessionId): void;
  /** Another pane, with the keyboard; the caller has checked that it fits. */
  placePane(id: SessionId): void;
  /** The pane with the keyboard closed, while another is left. */
  closePane(): void;
}

/**
 * The characters on screen, one per pane, and which pane the keyboard is
 * talking to; or the Stable, every character in the realm at once, shown in
 * their place.
 *
 * Flat and at most four: a recursive split tree needs a layout algebra, drag
 * handles and a serialisation format, and pays that back for someone tiling
 * six documents rather than watching four characters. See docs/profiles.md
 * §7.3.
 */
export function usePanes(
  sessions: readonly SessionSummary[],
  views: Readonly<Record<SessionId, Pick<RailView, 'state'> | undefined>>
): Panes {
  // Seeded from the last panes drawn, so a remount after a lost web socket, a
  // reload or a relaunch comes back to them (upstream 3a3eb4aa).
  const [shown] = useState(readShown);
  const [paneIds, setPaneIds] = useState<SessionId[]>(shown.panes);
  const [focusedPane, setFocusedPane] = useState(shown.at);

  /**
   * The panes, filtered to characters that are still loaded.
   *
   * Derived rather than corrected in place: a character closing while it is on
   * screen must not leave a pane pointing at an id nothing answers to, and
   * there is always at least one pane while there is at least one character.
   */
  const panes = useMemo(() => {
    const live = paneIds.filter((id) => sessions.some((entry) => entry.id === id));
    if (live.length > 0) return live;
    return sessions.length > 0 ? [sessions[0]!.id] : [];
  }, [paneIds, sessions]);

  const paneAt = Math.min(focusedPane, Math.max(0, panes.length - 1));

  /*
   * The Stable (2026-10-31): every character in the realm at once, one row
   * each beside its own console, shown instead of the panes. The row the
   * keyboard is talking to is the character being shown while it is, so the
   * status rail, the palette and every hotkey follow a click on a row as they
   * follow a tab; and a character opened from it comes back to it on Escape.
   */
  const [stable, setStable] = useState(shown.stable);
  const [stableFocus, setStableFocus] = useState<SessionId | null>(null);
  const [fromStable, setFromStable] = useState(false);
  const stableOn = stable && sessions.length > 0;
  // The characters left out of it, which get no row (`useLeftOut`).
  const { leftOut, leaveOut, bringBack } = useLeftOut();
  const rowKey = sessions
    .filter((entry) => inRealm(views[entry.id]) && !leftOut.includes(entry.id))
    .map((entry) => entry.id)
    .join('\n');
  const stableRows = useMemo(() => {
    const ids = rowKey.split('\n');
    return sessions.filter((entry) => ids.includes(entry.id));
  }, [sessions, rowKey]);
  const stableAway = useMemo(
    () => sessions.filter((entry) => !stableRows.includes(entry) && !leftOut.includes(entry.id)),
    [sessions, stableRows, leftOut]
  );
  const stableLeftOut = useMemo(
    () => sessions.filter((entry) => leftOut.includes(entry.id)),
    [sessions, leftOut]
  );
  // The row with the keyboard, or the first row: never a character with no row,
  // which a character just left out would otherwise stay as (2026-11-01).
  const focusedRow =
    stableFocus !== null && stableRows.some((entry) => entry.id === stableFocus)
      ? stableFocus
      : (stableRows[0]?.id ?? null);
  const session = stableOn && focusedRow !== null ? focusedRow : (panes[paneAt] ?? NO_SESSION);
  // Nothing is written before the roster arrives, or a reload would forget
  // the choice it is about to restore.
  useEffect(() => {
    if (panes.length > 0) writeShown({ panes, at: paneAt, stable });
  }, [panes, paneAt, stable]);

  const showSession = useCallback(
    (id: SessionId) => {
      // From the Stable, a character opened is one Escape comes back from.
      if (stableOn) {
        setStable(false);
        setFromStable(true);
      }
      // Already on screen? Then this is a request to type at it, not to move it.
      const at = panes.indexOf(id);
      if (at >= 0) {
        setFocusedPane(at);
        return;
      }
      setPaneIds(panes.map((current, index) => (index === paneAt ? id : current)));
    },
    [paneAt, panes, stableOn]
  );
  const showStable = useCallback(() => {
    setStable(true);
    setFromStable(false);
  }, []);

  const focusPane = useCallback(
    (id: SessionId) => {
      // A row of the Stable is the character being shown while it is.
      if (stableOn) {
        setStableFocus(id);
        return;
      }
      const at = panes.indexOf(id);
      if (at >= 0) setFocusedPane(at);
    },
    [panes, stableOn]
  );

  const placePane = useCallback(
    (id: SessionId) => {
      setPaneIds([...panes, id]);
      setFocusedPane(panes.length);
    },
    [panes]
  );

  const closePane = useCallback(() => {
    if (panes.length < 2) return;
    setPaneIds(panes.filter((_, index) => index !== paneAt));
    setFocusedPane(Math.max(0, paneAt - 1));
  }, [paneAt, panes]);

  return {
    panes,
    paneAt,
    session,
    stableOn,
    stableRows,
    stableAway,
    stableLeftOut,
    fromStable,
    leaveOut,
    bringBack,
    showSession,
    showStable,
    focusPane,
    placePane,
    closePane
  };
}
