/**
 * `IpcApi` over a WebSocket: the bridge for a window served over HTTP.
 *
 * The preload is the desktop's bridge and this is the browser tab's, and the
 * two are the same builder (`bridgeOver` in `src/shared/ipc.ts`) over two
 * carriers, so every `Invoke`, `Send` and `Push` channel is on both. The
 * envelope is `src/shared/rpc.ts`; the server side is
 * `src/main/host/WebHost.ts`.
 *
 * Five things the desktop asks main for are answered in the window here,
 * because main in web mode is on another machine:
 *
 * - **the clipboard** — `navigator.clipboard`, which a browser tab may use
 *   on a user gesture and which the desktop avoids for reasons that do not
 *   apply here (`Invoke.copyText`'s note);
 * - **the realm picker** — the window's own, over `Invoke.browseHome`
 *   (`lib/pickers.ts`), because the disk is the client's and not the
 *   viewer's;
 * - **a saved file** — the debug report is written on the client's disk as
 *   on the desktop, then fetched into the browser's downloads over the link
 *   main hands back (`Host.deliver`);
 * - **the Explorer's own window** — a pop-up of this tab's, the page with
 *   `?explorer=` naming the character (2026-10-29), as `Invoke.explorerWindow`
 *   opens a window on the desktop;
 * - **a lost socket** — `lib/webLink.ts` dials again and the client sends
 *   what was missed, so the window carries on as it was. Only a client that
 *   no longer knows the tab makes `onRenewed` remount the window, which
 *   re-attaches every character and replays the backscroll main kept
 *   (upstream 4e94f8bf).
 *
 * A call made while the link is down waits for it and goes when it is back,
 * except a key: one typed once the window is covered goes nowhere, and one
 * older than `webLostCoverMs` when the link comes back is not sent, since
 * keys typed into a dead link would arrive as a burst of moves.
 */
import { EXPLORER_WINDOW_PARAM } from '@shared/explorer';
import {
  bridgeOver,
  Invoke,
  Push,
  Send,
  type DebugSave,
  type IpcApi,
  type Notice
} from '@shared/ipc';
import { trimArgs, type RpcOutbound } from '@shared/rpc';
import { t } from './i18n';
import { hasRealmPicker, pickRealm } from './pickers';
import { openWebLink } from './webLink';

type Listener = (payload: unknown) => void;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** The keys a player types: each goes stale while the link is down (the header's reason). */
const TYPED: ReadonlySet<string> = new Set([Send.input, Send.macro]);

/**
 * @param onRenewed The client no longer knows this tab; the window remounts.
 * @param signal Ends the bridge: its timers, its listeners and its socket.
 */
export function createWebBridge(onRenewed: () => void, signal: AbortSignal): IpcApi {
  const listeners = new Map<string, Set<Listener>>();
  const pending = new Map<number, Pending>();
  let nextId = 1;

  /** A notice into the console, from the window itself. Same shape as main's. */
  const notice = (message: string): void => {
    const payload: Notice = { session: null, message };
    for (const listener of listeners.get(Push.notice) ?? []) listener(payload);
  };

  const take = (message: RpcOutbound): void => {
    if (message.k === 'push') {
      for (const listener of listeners.get(message.c) ?? []) listener(message.p);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if ('e' in message) entry.reject(new Error(message.e));
    else entry.resolve(message.r);
  };

  const link = openWebLink(
    {
      frame: take,
      /*
       * Every call still waiting is left waiting, deliberately: rejecting
       * them surfaced each as an uncaught rejection, since on the desktop the
       * bridge cannot fail and none of the callers catches. The remount drops
       * the callers, and a promise that never settles under them costs nothing.
       */
      renewed: () => {
        pending.clear();
        onRenewed();
      }
    },
    signal
  );

  const send = (channel: string, ...args: unknown[]): void => {
    const request = { k: 'send', c: channel, a: trimArgs(args) } as const;
    if (!TYPED.has(channel)) link.send(request);
    // A key typed into a covered window goes nowhere (the header's reason).
    else if (!link.covered) link.send(request, true);
  };

  const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      link.send({ k: 'invoke', id, c: channel, a: trimArgs(args) });
    });

  const subscribe = <T>(channel: string, handler: (payload: T) => void): (() => void) => {
    const listener: Listener = (payload) => handler(payload as T);
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };

  /**
   * The Explorer this tab popped out, one for every character, which it
   * changes itself. Kept by the tab that opened it: a pop-up is the opener's
   * to raise, and a tab reloaded since has none, so its links open the
   * Explorer over the console.
   */
  let explorer: Window | null = null;

  /** A file main wrote and offered, saved into the browser's downloads (upstream 8db9a39c). */
  const download = (link: string | null): void => {
    if (link === null) return;
    const anchor = document.createElement('a');
    anchor.href = link;
    anchor.download = '';
    anchor.click();
  };

  return bridgeOver(
    { invoke, send, subscribe },
    {
      host: 'web',
      // Written on the client's disk as on the desktop, then fetched here.
      saveDebug: async (session) => {
        const saved = await invoke<DebugSave>(Invoke.saveDebug, session);
        if ('path' in saved) download(saved.download);
        return saved;
      },
      // The tab is on the viewer's machine and main is not, so raising *this*
      // window means this window. The browser grants it off a notification click.
      raiseWindow: async () => {
        window.focus();
      },
      // Opened on the press that asked, before anything is awaited, or the browser blocks it.
      explorerWindow: async (session, create) => {
        if (explorer !== null && !explorer.closed) {
          explorer.focus();
          return true;
        }
        if (!create) return false;
        const page = new URL(location.href);
        page.search = new URLSearchParams({ [EXPLORER_WINDOW_PARAM]: session }).toString();
        page.hash = '';
        const size = `width=${Math.min(1440, screen.availWidth)},height=${Math.round(screen.availHeight * 0.9)}`;
        explorer = window.open(page.toString(), 'majordomo-explorer', `popup,${size}`);
        return explorer !== null;
      },
      /*
       * The window's clipboard, not main's — see the header. Writing works on
       * the gesture that asked for it; reading is the tab's permission to
       * grant, and a browser that will not grant it is answered with nothing
       * and a notice saying the chord the browser handles itself still works.
       */
      copyText: async (text) => {
        if (text.length === 0) return;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          notice(t('web.clipboard.writeRefused'));
        }
      },
      pasteText: async () => {
        try {
          return await navigator.clipboard.readText();
        } catch {
          notice(t('web.clipboard.readRefused'));
          return '';
        }
      },
      /*
       * The window's own picker over the client's disk (`lib/pickers.ts`),
       * never the channel: main in web mode has no dialog to put up, and a
       * `<input type="file">` would browse the wrong machine.
       */
      chooseRealm: () => {
        if (!hasRealmPicker()) {
          notice(t('web.picker.unavailable'));
          return Promise.resolve(null);
        }
        return pickRealm();
      }
    }
  );
}
