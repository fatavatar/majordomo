/**
 * MMUD Explorer in a window of its own (2026-10-29): the page with
 * `?explorer=<character>` draws this instead of the client.
 *
 * Asked for so the Explorer can sit beside the console rather than over it,
 * one window for every character: its chooser changes which, and so does
 * asking for another character's Explorer in the main window.
 * It is the same `ExplorerScreen` with the same calls (`useExplorer`), so the
 * two never differ; what this window has of its own is how it learns the
 * character, which is the push every window gets (`Push.character`) after the
 * attach snapshot, and what it hands the main window: Walk here, as
 * `Send.explorerWalk`, since the route panel is the console's. It holds no
 * tab and no console, so it attaches only to read the character and lets go.
 */
import { useCallback, useEffect, useState } from 'react';

import { EMPTY_CHARACTER, type CharacterState } from '@shared/character';
import { EXPLORER_WINDOW_PARAM } from '@shared/explorer';
import type { InternalConfig } from '@shared/internal';
import type { ProfileSummary, SessionId } from '@shared/ipc';
import ExplorerScreen, { type ExplorerScreenProps } from './components/ExplorerScreen';
import { useConfig } from './hooks/useConfig';
import { useExplorer } from './hooks/useExplorer';
import { usePageLook } from './hooks/usePageLook';
import { useTheme } from './hooks/useTheme';
import { t } from './lib/i18n';
import { setTuning } from './lib/tuning';

export default function ExplorerWindow({ session: opened }: { session: SessionId }) {
  const api = window.mudengine;
  const { config } = useConfig();
  usePageLook(config);
  // The character it is for, which its chooser or the main window changes (2026-10-29).
  const [session, setSession] = useState<SessionId>(opened);
  const choose = useCallback((id: SessionId) => {
    setSession(id);
    // A reload opens on the character chosen.
    const page = new URL(location.href);
    page.searchParams.set(EXPLORER_WINDOW_PARAM, id);
    history.replaceState(null, '', page);
  }, []);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  useEffect(() => {
    void api.listProfiles().then(setProfiles);
    return api.onProfiles(setProfiles);
  }, [api]);
  useTheme(
    profiles.find((profile) => profile.id === session)?.theme ?? config.ui.theme,
    config.ui.console.keepDark,
    config.ui.console.darkTheme,
    config.ui.console.palette
  );
  useEffect(() => {
    const take = (next: InternalConfig): void => setTuning(next.tuning.view);
    void api.getInternal().then(take);
    return api.onInternal(take);
  }, [api]);

  // The character as attached, then as every window is sent it.
  const [character, setCharacter] = useState<CharacterState | null>(null);
  const [shownOnce, setShownOnce] = useState(false);
  useEffect(() => {
    let live = true;
    setCharacter(null);
    void api.attach(session).then((snapshot) => {
      if (live) setCharacter((was) => was ?? snapshot.character);
      setShownOnce(true);
      void api.detach(session);
    });
    const off = api.onCharacter(({ session: id, payload }) => {
      if (id === session) setCharacter(payload);
    });
    return () => {
      live = false;
      off();
    };
  }, [api, session]);

  /*
   * The Explorer asked for in the main window, by its command or a Gear or
   * Reference link: that character's, on the entry where one is named.
   */
  const [focus, setFocus] = useState<ExplorerScreenProps['focus']>(null);
  useEffect(
    () =>
      api.onExplorerFocus(({ session: id, payload }) => {
        choose(id);
        if (payload !== null) setFocus({ ...payload, at: Date.now() });
        window.focus();
      }),
    [api, choose]
  );
  // Listening now, after every subscription above: a browser tab is sent no push until it says so.
  useEffect(() => api.clientReady(), [api]);

  const nameOf = (id: SessionId): string =>
    profiles.find((profile) => profile.id === id)?.name ?? id;
  const characterName = character?.name ?? nameOf(session);
  useEffect(() => {
    document.title = t('explorer.windowTitle', { characterName });
  }, [characterName]);
  // The chooser: every character loaded, and this one whatever it is.
  const characters = profiles
    .filter((profile) => profile.loaded || profile.id === session)
    .map((profile) => ({ id: profile.id, name: profile.name }));

  const calls = useExplorer(api, session, character ?? EMPTY_CHARACTER);
  const walkTo = useCallback((room: string) => api.explorerWalk(session, room), [api, session]);
  const close = useCallback(() => window.close(), []);
  if (!shownOnce) return null;
  return (
    <ExplorerScreen
      {...calls}
      characterName={characterName}
      characters={characters.length > 0 ? characters : [{ id: session, name: characterName }]}
      focus={focus}
      onCharacter={choose}
      onClose={close}
      open
      session={session}
      walkTo={walkTo}
      windowed
    />
  );
}
