/**
 * The options file's typography and skin, put on the page.
 *
 * Every window of the client wears them, the main one and the Explorer popped
 * out of it (2026-10-29), so they are set here once rather than by each.
 */
import { useEffect, useMemo } from 'react';

import {
  resolveTerminalFonts,
  resolveUiFonts,
  toCssFontStack,
  type AppConfig
} from '@shared/config';

/** Publishes `config`'s fonts and skin on the root; resolves to the console's font stack. */
export function usePageLook(config: AppConfig): { terminalFonts: string } {
  const terminalFonts = useMemo(
    () => toCssFontStack(resolveTerminalFonts(config.terminal.font.family)),
    [config.terminal.font.family]
  );

  const uiFonts = useMemo(
    () => toCssFontStack(resolveUiFonts(config.ui.font.family)),
    [config.ui.font.family]
  );

  /**
   * Chrome typography is published as tokens rather than passed down as props:
   * `tokens.css` is the only place literal values live, and every component
   * already reads `--font-ui-family` from there, so a config reload repaints
   * the whole shell without a single component knowing about the config.
   */
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--font-ui-family', uiFonts);
    root.setProperty('--font-ui-base', `${config.ui.font.size}px`);
    // The slate must not inherit chrome typography: `ui.font` may legitimately
    // be proportional, and the terminal cell never may. This also makes the
    // resolved console stack observable from the DOM, which xterm's canvas
    // renderer otherwise hides.
    root.setProperty('--font-terminal', terminalFonts);
  }, [uiFonts, config.ui.font.size, terminalFonts]);

  /*
   * The skin the chrome wears (2026-10-24), as an attribute the skin's
   * stylesheet keys off (`styles/skins/`), the way density is; and as
   * `SkinContext`, for the cards a skin lays out its own way.
   */
  useEffect(() => {
    document.documentElement.dataset['skin'] = config.ui.skin;
  }, [config.ui.skin]);

  return { terminalFonts };
}
