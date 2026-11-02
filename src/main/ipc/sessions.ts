/**
 * The window and its characters, over IPC: a window mounting, typed input,
 * macros and resizes, the Combat Stats card's resets, connecting and
 * hanging up, the stream and debug feeds, a character popped out to a
 * window of its own and back, profiles loaded, attached and closed, and the
 * options file and the home's folders shown.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { EMPTY_AUTOMATION } from '../../shared/automation';
import { EMPTY_CHARACTER } from '../../shared/character';
import { formatDebugReport } from '../../shared/debug';
import { isExplorerFocus } from '../../shared/explorer';
import { fileSlug } from '../../shared/files';
import { DEFAULT_INTERNAL } from '../../shared/internal';
import {
  type AttachSnapshot,
  type BackscrollPage,
  DebugSave,
  type HomeListing,
  Invoke,
  Push,
  type Revealed,
  Send,
  type SessionId
} from '../../shared/ipc';
import { NO_LOOP } from '../../shared/loops';
import { IDLE_QUEST_RUN } from '../../shared/quests';
import { NO_ROUND } from '../../shared/roundTimer';
import { isCombatTally } from '../../shared/tally';
import { asConnectionTarget, type TerminalSize } from '../../shared/types';
import { errorMessage } from '../../shared/values';
import { EMPTY_ROOM_VERDICT } from '../../shared/verdict';
import { IDLE_WALK } from '../../shared/walk';
import { listHome } from '../app/browse';
import { t } from '../app/i18n';
import { tuning } from '../app/tuning';
import type { IpcContext } from '../client';
import type { Transport } from '../host/Host';
import { REALM_EXTENSIONS } from '../world/RealmSource';

export function registerSessionsIpc(transport: Transport, ctx: IpcContext): void {
  const { handle, on } = transport;

  on(Send.clientReady, (caller) => {
    /*
     * Replay to the window that just mounted, not to all of them: this is the
     * state a fresh renderer is missing, and the others already have it.
     */
    if (ctx.host) caller.send(Push.sessions, ctx.rosterFor(caller));
    caller.send(Push.profiles, ctx.profileSummaries());
    if (ctx.parties) caller.send(Push.partyRosters, ctx.parties.all);
    if (ctx.config) {
      caller.send(Push.config, ctx.config.snapshot);
    }
    ctx.reportSoftwareCompositing(caller);

    /*
     * Connect on launch, and only on launch.
     *
     * `clientReady` is "a renderer is mounted and can receive output", and a
     * renderer can mount more than once: React's StrictMode deliberately runs
     * every effect twice in development, a reload or hot update mounts a fresh
     * one, and — now — a second window mounts another. Treating each of those
     * as a reason to dial meant `npm run dev` opened two connections a
     * millisecond apart; the second tore down the first mid-handshake and the
     * server dropped it, which read as the server refusing the first connection
     * every time the app started.
     *
     * Autoconnect is a property of *starting the app*, so it is latched here by
     * session id rather than guarded further down. A window appearing is never
     * a reason to reconnect behind the player's back, even if it worked.
     */
    if (ctx.launched) return;
    ctx.launched = true;

    /*
     * Nothing to dial without a character, and nothing said here either:
     * `syncSessions` already said it, once. Two identical lines on the same
     * launch is how a message people ought to read becomes one they learn to
     * scroll past.
     */
    for (const profile of ctx.profiles?.profiles ?? []) {
      if (!profile.autoConnect || ctx.autoConnected.has(profile.id)) continue;
      ctx.autoConnected.add(profile.id);
      void ctx.host?.connect(profile.id, profile.target);
    }
  });
  // The Combat Stats card's Reset, and a baseline a window kept from before
  // main kept them, taken while main has none (2026-10-17).
  on(Send.statsReset, (_caller, session: SessionId) => {
    ctx.host?.get(session)?.manager.resetStats();
  });
  on(Send.expReset, (_caller, session: SessionId) => {
    ctx.host?.get(session)?.manager.resetExp();
  });
  on(Send.statsBase, (_caller, session: SessionId, base: unknown) => {
    if (isCombatTally(base)) ctx.host?.get(session)?.manager.adoptStatsBase(base);
  }); // Between a character's popped-out Explorer and the window showing it (2026-10-29).
  on(Send.explorerFocus, (_caller, session: SessionId, focus: unknown) => {
    if (ctx.host?.has(session) && (focus === null || isExplorerFocus(focus))) {
      ctx.push(Push.explorerFocus, { session, payload: focus });
    }
  });
  on(Send.explorerWalk, (_caller, session: SessionId, room: unknown) => {
    if (ctx.host?.has(session) && typeof room === 'string') {
      ctx.push(Push.explorerWalk, { session, payload: room });
    }
  });
  on(Send.input, (_caller, session: SessionId, data: string) => {
    ctx.host?.get(session)?.manager.typedInput(data);
  });
  // Parsed again in main; a payload that is not a string is not a line.
  on(Send.macro, (_caller, session: SessionId, line: unknown) => {
    if (typeof line !== 'string') return;
    const manager = ctx.host?.get(session)?.manager;
    manager?.keyPressed();
    manager?.sendMacro(line);
  });
  on(Send.dropMacro, (_caller, session: SessionId) => {
    ctx.host?.get(session)?.manager.dropTyped();
  });
  on(Send.resize, (_caller, session: SessionId, size: TerminalSize) => {
    ctx.host?.get(session)?.manager.resize(size);
  });
  // Whether this window is showing the per-line diagnostics feed. Per window,
  // like attachment: the flag lives in the registry so a destroyed window
  // takes its interest with it.
  on(Send.diagnostics, (caller, showing: boolean) => {
    ctx.windows.setDiagnostics(caller.windowId, showing === true);
  });
  // The debug view's own feed. See `Send.debugFeed` for why it is not this
  // window's diagnostics flag.
  on(Send.debugFeed, (caller, showing: boolean) => {
    ctx.windows.setDebugging(caller.windowId, showing === true);
  });
  // ------------------------------------------------------------- per session

  /*
   * Where a character connects is a property of the character, so the renderer
   * does not have to know an address to dial one. An explicit target is the
   * ad-hoc path — the palette's saved servers — and it is not written back to
   * the profile: connecting somewhere once is not the same as moving house.
   */
  handle(Invoke.connect, (_caller, session: SessionId, target?: unknown) => {
    /*
     * An explicit target is parsed before it reaches the socket layer, where a
     * malformed port is a throw rather than a refusal. Omitting it is the
     * ordinary path — the character's own file says where it plays.
     */
    const asked = target === undefined ? null : asConnectionTarget(target);
    if (target !== undefined && asked === null) {
      ctx.notice(t('app.connect.invalidTarget'), session);
      return ctx.host?.get(session)?.manager.state ?? null;
    }
    /*
     * No target and no file to say where this character plays is a refusal,
     * not a fallback onto the global `connection:` block: that block is what a
     * *new realm* starts with, and a tab that quietly dialled it would be a tab
     * dialling somewhere the player never chose. Reachable only for a session
     * whose file has gone while it was connected.
     */
    const where = asked ?? ctx.profileFor(session)?.target ?? null;
    if (where === null) {
      ctx.notice(t('app.connect.noCharacterFile', { id: session }), session);
      return ctx.host?.get(session)?.manager.state ?? null;
    }
    return ctx.host?.connect(session, where);
  }); /*
   * Through the host rather than straight at the manager, because pressing
   * Disconnect also calls off a redial that is already scheduled. A character
   * sitting at a closed socket with a retry pending has nothing for the manager
   * to close, and this is the one way to say *stop trying*. See `Reconnect`.
   */
  handle(Invoke.disconnect, (_caller, session: SessionId) => ctx.host?.disconnect(session) ?? null);
  handle(
    Invoke.getState,
    (_caller, session: SessionId) => ctx.host?.get(session)?.manager.state ?? null
  );
  handle(
    Invoke.getTelnetLog,
    (_caller, session: SessionId) => ctx.host?.get(session)?.manager.log ?? []
  );
  handle(
    Invoke.getLines,
    (_caller, session: SessionId) => ctx.host?.get(session)?.manager.lines ?? []
  );
  handle(Invoke.getDebug, (_caller, session: SessionId) => {
    const slot = ctx.host?.get(session);
    if (!slot) return { records: [], dropped: 0 };
    return { records: [...slot.debug.all], dropped: slot.debug.lost };
  });
  /*
   * The bug report, written by main.
   *
   * Main writes it for the reason main owns the clipboard: the window has no
   * filesystem. It goes into the same `logs/` directory the session logs and
   * captures do, which is the directory `npm run check:secrets` already walks —
   * a report saved anywhere else would be one nobody can promise carries no
   * password, and this is a file whose whole purpose is being sent to somebody
   * else.
   *
   * Named after the character and the moment, because a player reporting two
   * problems in an evening has to be able to say which file is which.
   */
  handle(Invoke.saveDebug, async (caller, session: SessionId): Promise<DebugSave> => {
    const slot = ctx.host?.get(session);
    if (!slot) return { error: t('app.debug.noSession') };
    const who = ctx.labelOf(session);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = ctx.logDirectory();
    const file = path.join(directory, `debug-${fileSlug(who.name)}-${stamp}.txt`);
    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        file,
        formatDebugReport(
          {
            title: t('app.debug.reportTitle'),
            version: ctx.appVersion(),
            platform: `${process.platform} ${process.arch}, ${ctx.platform.runtime}`,
            character: who.name,
            realm: who.server.length > 0 ? who.server : t('app.debug.realmUnknown'),
            at: Date.now(),
            dropped: slot.debug.lost
          },
          slot.debug.all
        ),
        'utf8'
      );
      return { path: file, download: ctx.platform.deliver(caller, file) };
    } catch (error) {
      // Said out loud rather than swallowed: a save button that quietly did
      // nothing is worse than one that reports why it could not.
      return { error: errorMessage(error) };
    }
  });
  handle(
    Invoke.getCharacter,
    (_caller, session: SessionId) => ctx.host?.get(session)?.manager.character ?? EMPTY_CHARACTER
  );
  handle(
    Invoke.getWalk,
    (_caller, session: SessionId) => ctx.host?.get(session)?.manager.walkProgress ?? IDLE_WALK
  );
  handle(
    Invoke.getAutomation,
    (_caller, session: SessionId) => ctx.host?.get(session)?.manager.automation ?? EMPTY_AUTOMATION
  );
  // ------------------------------------------------------ sessions & windows

  handle(Invoke.listSessions, (caller) => ctx.rosterFor(caller));
  /*
   * Moving a character between windows.
   *
   * The session does not move — it never moves, it is in main — so this is a
   * change of *which rail has a tab for it* and nothing else. No socket is
   * touched, no state is rebuilt, and the backscroll replays on attach exactly
   * as it does for a renderer reload (docs/profiles.md §7.4).
   */
  handle(Invoke.popOut, (caller, session: SessionId) => {
    /*
     * A host with no second window refuses, in words the tab can show. The
     * window does not offer the command there either (`api.host`), and both
     * halves exist on purpose: a command that is found and does nothing is
     * worse than one that cannot be found.
     */
    if (ctx.platform.windows === null) return t('app.window.noSecondWindow');
    if (!ctx.workspace || !ctx.host?.has(session)) return t('app.profiles.noSuchCharacter');
    // The last character in a window has nowhere useful to go: popping it out
    // would leave an empty window behind and a new one with one tab, which is
    // the same arrangement with an extra frame around it.
    if (caller.windowId !== -1 && ctx.summariesFor(caller.windowId).length <= 1) {
      return t('app.window.onlyCharacterHere');
    }
    const popped = ctx.platform.windows.open([session]);
    if (popped === null) return t('app.window.createFailed');
    ctx.publishRosters();
    return null;
  });
  /*
   * Everybody back here, and close whatever is left empty.
   *
   * Addressed to the *asking* window rather than to the main one: somebody who
   * ran this from a pop-out meant that window, and moving their characters to a
   * window they are not looking at would be the client deciding for them.
   */
  /*
   * A window asking to be brought forward, which only ever happens because
   * somebody clicked a desktop notification about a character in it. Nothing
   * is refused out loud: a host with no windows to raise is a browser tab,
   * which raises itself and never reaches this handler.
   */
  handle(Invoke.raiseWindow, (caller) => {
    if (ctx.platform.windows === null || caller.windowId === -1) return;
    ctx.platform.windows.focus(caller.windowId);
  });
  handle(Invoke.explorerWindow, (_caller, session: SessionId, create: unknown) => {
    if (ctx.platform.windows === null || !ctx.host?.has(session)) return false;
    return ctx.platform.windows.explorer(session, create === true);
  });
  handle(Invoke.gatherWindows, (caller) => {
    if (ctx.platform.windows === null) return t('app.window.noSecondWindow');
    if (!ctx.workspace || !ctx.host) return t('app.window.nothingToGather');
    if (caller.windowId === -1) return t('app.window.unknownCaller');
    for (const entry of ctx.host.summaries) ctx.workspace.move(entry.id, caller.windowId);
    ctx.workspace.save();
    ctx.publishRosters();
    for (const windowId of ctx.windows.ids()) {
      if (windowId === caller.windowId) continue;
      if (ctx.summariesFor(windowId).length === 0) ctx.platform.windows.close(windowId);
    }
    return null;
  });
  /*
   * The rail was dragged into a new order.
   *
   * The *session* does not move, the same way popping out does not move one:
   * this changes which order a window's tabs are drawn in and nothing else. The
   * asking window is the one reordered — a rail belongs to the window it is
   * drawn in — and `Workspace.reorder` honours only the tabs that window
   * actually owns, so a stale list arriving from a renderer cannot adopt
   * somebody else's character.
   *
   * Republished afterwards rather than trusted: the renderer's optimistic
   * order and main's answer must be the same list, and main's is the one that
   * was written down.
   */
  handle(Invoke.reorderSessions, (caller, order: SessionId[]) => {
    if (!ctx.workspace) return;
    if (caller.windowId === -1) return;
    ctx.workspace.reorder(ctx.railOf(caller.windowId), order);
    ctx.workspace.save();
    ctx.publishRosters();
  });
  handle(Invoke.popIn, (_caller, session: SessionId) => {
    if (ctx.platform.windows === null) return t('app.window.noSecondWindow');
    if (!ctx.workspace || !ctx.host?.has(session)) return t('app.profiles.noSuchCharacter');
    const main = ctx.platform.mainWindowId();
    if (main === null) return t('app.window.noMainWindow');
    const from = ctx.workspace.windowOf(session);
    ctx.workspace.move(session, main);
    ctx.workspace.save();
    ctx.publishRosters();
    // A window with nothing left in it is a frame around nothing.
    if (from !== null && from !== main && ctx.summariesFor(from).length === 0) {
      ctx.platform.windows.close(from);
    }
    ctx.platform.windows.focus(main);
    return null;
  });
  handle(Invoke.listProfiles, () => ctx.profileSummaries());
  handle(Invoke.loadProfile, (_caller, id: SessionId) => {
    if (!ctx.profileFor(id)) return;
    ctx.unloaded.delete(id);
    ctx.host?.ensure(id);
    ctx.publishRosters();
  });
  /*
   * Closing a character's tab. Refuses while it is holding a socket unless the
   * caller has already asked the player: a tab closed by a stray click must not
   * be able to drop a character in a dangerous room.
   */
  handle(Invoke.unloadProfile, (_caller, id: SessionId, force?: boolean) => {
    const slot = ctx.host?.get(id);
    if (!slot) return null;

    if (!force && !ctx.DORMANT_PHASES.has(slot.manager.state.phase)) {
      return t('app.profiles.stillConnected', { name: ctx.profileFor(id)?.name ?? id });
    }

    ctx.unloaded.add(id);
    ctx.host?.remove(id);
    ctx.publishRosters();
    return null;
  });
  /*
   * Attaching registers the window and returns the retained output in one
   * synchronous step, so nothing can arrive between the two and be lost. The
   * renderer holds live chunks until this resolves and writes them after the
   * replay — otherwise the catch-up would land on top of output newer than it.
   */
  handle(Invoke.attach, (caller, session: SessionId): AttachSnapshot => {
    /*
     * Looks the session up; never creates it. Sessions come from profiles now,
     * so a window attaching to an id nobody defines must get an empty view
     * rather than conjure a character out of a stale tab.
     */
    const slot = ctx.host?.get(session);
    if (slot) ctx.windows.attach(caller.windowId, session);
    const manager = slot?.manager;
    const tail = slot?.backscroll.tail(tuning().records.backscrollAttachLines);
    return {
      backscroll: tail?.text ?? '',
      backscrollFrom: tail?.from ?? 0,
      backscrollEarlier: tail !== undefined && tail.from > (slot?.backscroll.first ?? 0),
      lines: manager?.lines ?? [],
      state: manager?.state ?? ctx.IDLE_STATE,
      character: manager?.character ?? EMPTY_CHARACTER,
      walk: manager?.walkProgress ?? IDLE_WALK,
      round: manager?.roundTimer ?? NO_ROUND,
      loop: manager?.loopProgress ?? NO_LOOP,
      automation: manager?.automation ?? EMPTY_AUTOMATION,
      verdict: manager?.verdict ?? EMPTY_ROOM_VERDICT,
      asks: [...(manager?.asks ?? [])],
      telnet: manager?.log ?? [],
      learned: manager?.learned ?? [],
      finds: manager?.foundHere ?? [],
      questSaid: { ...(manager?.questProgress ?? {}) },
      questRun: manager?.questRunProgress ?? IDLE_QUEST_RUN,
      // The Talk card's history. Only for a session that exists: attach never
      // creates one, so it must not conjure a log for a stale id either.
      talk: slot ? ctx.talkFor(session).backlog() : []
    };
  });
  handle(
    Invoke.backscrollBefore,
    (_caller, session: SessionId, at: number, lines: number): BackscrollPage =>
      ctx.host?.get(session)?.backscroll.before(at, lines) ?? { text: '', from: 0, more: false }
  );
  handle(Invoke.detach, (caller, session: SessionId) => {
    ctx.windows.detach(caller.windowId, session);
  });
  // ----------------------------------------------------------------- app level

  handle(Invoke.getConfig, () => ctx.config?.snapshot ?? ctx.fallbackSnapshot());
  handle(Invoke.getInternal, () => ctx.internal?.config ?? DEFAULT_INTERNAL);
  handle(Invoke.revealConfig, (): Promise<Revealed> =>
    ctx.reveal(ctx.config?.path ?? ctx.home.options, 'file')
  );
  handle(Invoke.revealProfiles, (): Promise<Revealed> => {
    ctx.profiles?.ensureDirectory();
    return ctx.reveal(ctx.home.profilesDir, 'directory');
  });
  /*
   * A directory under the home, for the window that cannot open one. Names
   * and sizes, never contents — the reasoning is in `app/browse.ts`, and the
   * confinement to the home root is enforced there on the resolved path.
   * Whether a file could be a realm is decided by the same list the desktop's
   * picker filters on, so the two answer alike.
   */
  handle(Invoke.browseHome, (_caller, target: unknown): Promise<HomeListing> =>
    listHome(
      ctx.home.root,
      typeof target === 'string' ? target : null,
      (name) => {
        const extension = path.extname(name).slice(1).toLowerCase();
        return (REALM_EXTENSIONS as readonly string[]).includes(extension);
      },
      {
        outside: () => t('app.home.outside'),
        unreadable: (at, message) => t('app.home.unreadable', { path: at, message })
      }
    )
  );
}
