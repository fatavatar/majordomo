import { useCallback, useState, type RefObject } from 'react';

import type { SessionId } from '@shared/ipc';

import type { TerminalHandle } from '../components/TerminalView';
import { readStored, writeStored } from '../lib/storage';
import { useOverridablePreference } from './usePreference';

/** Whether the cards are tucked away or pinned out, per browser; and the beat a switch is given to settle. */
const TUCK_KEY = 'mudengine.tuckCards';
export const TUCK_SETTLE_MS = 160;

export interface CardRail {
  /** The HUD's own toggle, remembered, and overridden by `ui.showHud` in the options file. */
  hudPreference: 'on' | 'off';
  setHudPreference(value: 'on' | 'off'): void;
  /**
   * The HUD is on because the player asked for it, not because the character
   * happens to be in the realm.
   *
   * It used to require both, so the whole rail vanished the moment a character
   * dropped — and with two on screen that reads as damage rather than as
   * "offline": one has an instrument beside it and the other has a blank
   * column, with nothing on screen saying which. It also moved the console's
   * width, which re-wraps a scrollback nobody asked to re-wrap.
   *
   * So the rail keeps its space and says what it is waiting for instead.
   */
  hudOpen: boolean;
  /** The diagnostics cards shown, for this run of the client only. */
  railOpen: boolean;
  /**
   * The rail takes no typed input, so opening it leaves focus in the terminal
   * and there is nothing to hand back on close.
   */
  toggleRail(): void;
  /**
   * The HUD appears on its own, without the diagnostics rail.
   *
   * Vitals and Room are what the player reads while playing; putting them
   * behind a toggle labelled "diagnostics" meant they were never seen. The rail
   * is therefore present whenever there is *either* HUD content or diagnostics
   * to show, and each half decides for itself.
   */
  railVisible: boolean;
  /** The cards tucked away or pinned out, as last chosen. */
  tuckPreference: 'tucked' | 'out';
  /** The rail shown, and tucked into its strip. */
  tucked: boolean;
  /**
   * Pinned or tucked in one step (2026-10-31): the workspace's width
   * animation held off, so the console is resized once rather than every
   * frame of a slide — a terminal re-wraps its scrollback at each width it is
   * given, which read as the window scrolling and left a console part-way up
   * its history — and every console that was following the game brought back
   * to its newest line once it has been fitted to the new width.
   */
  setTucked(next: boolean): void;
  /**
   * Characters other than the shown one whose *pinned* floats include the
   * Stream card. The per-line feed is sent only while something in this window
   * shows it (see `wantsLineFeed`), and a pinned stream float is the one
   * consumer the shown character's layout cannot answer for — uncounted, it
   * would quietly freeze whenever the rail was closed.
   */
  pinnedStreams: ReadonlySet<SessionId>;
  noteStreamFloat(sid: SessionId, has: boolean): void;
}

/**
 * The card rail: the HUD, the diagnostics cards, tucked or pinned out, and
 * which pinned floats show a stream.
 *
 * `terminals` are the consoles a tuck refits, and `setResizing` holds the
 * workspace's width animation off while it does.
 */
export function useCardRail(
  showHud: boolean,
  terminals: RefObject<Map<SessionId, TerminalHandle>>,
  setResizing: (resizing: boolean) => void
): CardRail {
  /**
   * Same precedence as density and theme: the palette toggle is remembered, and
   * an edit to `ui.showHud` in the options file overrides the memory.
   */
  const [hudPreference, setHudPreference] = useOverridablePreference(
    'mudengine.hud',
    showHud ? 'on' : 'off',
    (value): value is 'on' | 'off' => value === 'on' || value === 'off'
  );
  /**
   * The diagnostics cards, for this run of the client only.
   *
   * Deliberately *not* remembered and deliberately not configurable — the one
   * piece of chrome here that is neither. Link, traffic and stream readouts are
   * what you open when something looks wrong on the wire; they are a tool
   * reached for, used, and put down, not part of how a player has arranged
   * their instrument. Left remembered, an evening's debugging becomes the
   * client's permanent shape, and the cost is paid on the rail every launch
   * afterwards by somebody who has forgotten they ever asked.
   *
   * So the client always starts with them hidden, the palette toggle shows them
   * for as long as this window is open, and closing the client puts them away.
   * `ui.showDiagnostics` was removed with this rather than being left to mean
   * nothing: a setting that cannot take effect is worse than one not offered.
   */
  const [railOpen, setRailOpen] = useState(false);
  const toggleRail = useCallback(() => setRailOpen((open) => !open), []);
  /**
   * The cards tucked away into a strip, out while the pointer is on them
   * (2026-10-31), or pinned out beside the console: a pin on the rail itself,
   * remembered per browser as a layout is. Not a setting: it is a choice made
   * where the cards are, and undone there.
   */
  const [tuckPreference, setTuckState] = useState<'tucked' | 'out'>(() =>
    readStored(
      TUCK_KEY,
      (stored) => (stored === 'tucked' ? 'tucked' : 'out'),
      () => 'out'
    )
  );
  const hudOpen = hudPreference === 'on';
  const railVisible = hudOpen || railOpen;
  const tucked = railVisible && tuckPreference === 'tucked';
  const setTucked = useCallback(
    (next: boolean): void => {
      const following = [...(terminals.current?.values() ?? [])].filter((handle) =>
        handle.following()
      );
      setResizing(true);
      setTuckState(next ? 'tucked' : 'out');
      writeStored(TUCK_KEY, next ? 'tucked' : 'out');
      window.setTimeout(() => {
        for (const handle of following) handle.jumpToLatest();
        setResizing(false);
      }, TUCK_SETTLE_MS);
    },
    [terminals, setResizing]
  );

  const [pinnedStreams, setPinnedStreams] = useState<ReadonlySet<SessionId>>(() => new Set());
  const noteStreamFloat = useCallback((sid: SessionId, has: boolean) => {
    setPinnedStreams((prev) => {
      if (prev.has(sid) === has) return prev;
      const next = new Set(prev);
      if (has) next.add(sid);
      else next.delete(sid);
      return next;
    });
  }, []);

  return {
    hudPreference,
    setHudPreference,
    hudOpen,
    railOpen,
    toggleRail,
    railVisible,
    tuckPreference,
    tucked,
    setTucked,
    pinnedStreams,
    noteStreamFloat
  };
}
