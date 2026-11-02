import { useCallback, useEffect, useState } from 'react';

import type { SessionId } from '@shared/ipc';

import {
  SETTINGS_DEFAULTS,
  SETTINGS_GLOBAL,
  SETTINGS_MANAGE_SERVERS,
  SETTINGS_NEW_CHARACTER
} from '../components/SettingsScreen';

export interface SettingsScreenState {
  open: boolean;
  /** Where it opens: a character's id, one of the screen's own pages, or null for wherever it was. */
  at: string | null;
  close(): void;
  /** Open settings wherever it was — the palette and the shortcut. */
  openSettings(): void;
  /** Open settings on one named character — a tab's own menu. */
  editCharacter(id: SessionId): void;
  /** Open settings on an empty character — the `+` at the head of the rail. */
  newCharacter(): void;
  /** Open settings straight to the servers list — the palette's own way in. */
  manageServers(): void;
  /**
   * Open settings on the client's own — the gear at the head of the tab rail.
   *
   * Beside the `+` because that is where somebody already is when they want to
   * change something about the client rather than about a character, and
   * because a settings screen reachable only by a chord is one most people
   * never find. Also in the palette, for the same reason.
   */
  editGlobal(): void;
  /** And the other half of that file: what a new realm and character start with. */
  editDefaults(): void;
}

/**
 * The settings screen: whether it is open, and on what.
 *
 * `mustMakeCharacter` holds it open on the new-character form while there is
 * no character at all; `returnFocus` hands the keyboard back on the way out.
 */
export function useSettingsScreen(
  mustMakeCharacter: boolean,
  returnFocus: () => void
): SettingsScreenState {
  const [open, setOpen] = useState(false);
  /*
   * Which character the settings screen opens on.
   *
   * `null` means "wherever it was", which is what `Ctrl/Cmd ,` and the palette
   * want — reopening the screen on the character you were last editing. A tab's
   * own menu names one, because "edit *this* character" is the whole point of
   * reaching it from the tab rather than from the palette.
   */
  const [at, setAt] = useState<string | null>(null);

  /*
   * A character is step one; there is no "before you have one".
   *
   * With no characters there is no session and no console, so the client's only
   * job is to help make one — and the way in is the new-character form, opened
   * here rather than described in a notice somebody has to find. The anonymous
   * session this replaced was retired 2026-08-29 (see `NO_SESSION`).
   *
   * It used to be offered **once per launch** and was closeable, on the
   * reasoning that closing it is a choice. It is not one: behind it is an empty
   * window with no rail, no tab and nothing that says what to do, which is
   * where a fresh installation put somebody who clicked outside the form. So
   * while there is no character the screen is open and `required`, and the
   * latch that made the offer once is gone with the choice it was protecting.
   */
  useEffect(() => {
    if (!mustMakeCharacter) return;
    setAt(SETTINGS_NEW_CHARACTER);
    setOpen(true);
  }, [mustMakeCharacter]);

  /**
   * Settings is a form, so it hands the keyboard back to the game on the way
   * out — Escape, the close button, or a click on the scrim. The one surface
   * that holds the caret while a character is standing somewhere is the one
   * that has to be reliable about giving it back.
   */
  const close = useCallback(() => {
    // Nothing to hand the keyboard back *to*: there is no console behind this
    // screen until there is a character. The screen draws no close and answers
    // no Escape while that holds; this is the same refusal at the palette's
    // and the shortcut's door.
    if (mustMakeCharacter) return;
    setOpen(false);
    returnFocus();
  }, [mustMakeCharacter, returnFocus]);

  const openOn = useCallback((where: string | null) => {
    setAt(where);
    setOpen(true);
  }, []);
  const openSettings = useCallback(() => openOn(null), [openOn]);
  const editCharacter = useCallback((id: SessionId) => openOn(id), [openOn]);
  const newCharacter = useCallback(() => openOn(SETTINGS_NEW_CHARACTER), [openOn]);
  const manageServers = useCallback(() => openOn(SETTINGS_MANAGE_SERVERS), [openOn]);
  const editGlobal = useCallback(() => openOn(SETTINGS_GLOBAL), [openOn]);
  const editDefaults = useCallback(() => openOn(SETTINGS_DEFAULTS), [openOn]);

  return {
    open,
    at,
    close,
    openSettings,
    editCharacter,
    newCharacter,
    manageServers,
    editGlobal,
    editDefaults
  };
}
