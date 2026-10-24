import { DEFAULT_INTERNAL } from '../../../shared/internal';
import { NO_FIGHTS } from '../../../shared/fights';
import { NO_TALK } from '../TalkLog';
import { NO_REALM_PLAYERS } from '../../../shared/players';
import { NO_BELONGINGS } from '../../../shared/belongings';
import { NO_LORE } from '../../../shared/lore';
import { NO_PARTY, type Party } from '../../../shared/character';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { SessionHost } from '../SessionHost';
import { DeadSocket } from '../../net/__tests__/deadSocket';
import { setTuning } from '../../app/tuning';
import { t } from '../../app/i18n';
import type { MegaEngine } from '../MegaEngine';
import { goOnline } from '../../megamud/script/game';
import { defaultSettings } from '../../../shared/megamud/settings';
import { Push, type Addressed, type Notice, type SessionId } from '../../../shared/ipc';
import { DEFAULT_CONFIG, type AppConfig } from '../../../shared/config';
import type { ConnectionTarget, StreamChunk } from '../../../shared/types';

/**
 * Real sockets, two of them, because the bug this file exists to catch is
 * cross-talk: one character's bytes, state or keystrokes reaching another's
 * surface. That is the defining failure of the multi-session refactor and the
 * one least likely to be noticed by playing — it looks like a glitch until the
 * day it looks like the wrong character casting.
 */
let server: net.Server;
let port: number;
let host: SessionHost | null = null;
let accepted: net.Socket[] = [];
/** What each accepted socket received, in the order they were accepted. */
let received: string[] = [];

const config: AppConfig = {
  ...DEFAULT_CONFIG,
  // No files: this is about routing, and a test that writes logs is a test that
  // fails on a full disk.
  logging: { ...DEFAULT_CONFIG.logging, enabled: false, capture: false }
};

interface Sent {
  channel: string;
  message: Addressed<unknown>;
}

let attachedSends: Sent[] = [];
let allSends: Sent[] = [];
/**
 * How many times the roster was republished.
 *
 * Counted separately from `allSends`, which only records *addressed* pushes:
 * the roster is the one thing a window is told that is not about one character,
 * and it is now per window, so it does not travel as an `Addressed<T>` at all.
 */
let rosterPublishes = 0;
let notices: Notice[] = [];
/** The addresses sessions were keyed on for their realm's players, per dial. */
let dialledRealms: ConnectionTarget[] = [];
/** Whether these sessions want a lost connection dialled back. See `Reconnect`. */
let autoReconnect = false;
/** Where each session's backscroll is written, fresh per test. */
let backscrollDir = '';

beforeEach(async () => {
  backscrollDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-host-'));
  accepted = [];
  received = [];
  attachedSends = [];
  allSends = [];
  rosterPublishes = 0;
  notices = [];
  dialledRealms = [];
  autoReconnect = false;

  server = net.createServer((socket) => {
    const index = accepted.length;
    accepted.push(socket);
    received.push('');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      received[index] += chunk.toString('latin1');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;

  host = new SessionHost({
    worldFor: () => undefined,
    loreFor: () => NO_LORE,
    // Nothing to learn against without a realm, which is what these run with.
    memoryFor: () => undefined,
    fightsFor: () => NO_FIGHTS,
    talkFor: () => NO_TALK,
    backscrollFor: (id) => path.join(backscrollDir, `${id}.log`),
    playersFor: () => NO_REALM_PLAYERS,
    destinationsFor: () => ({ remember: () => {}, matching: () => [] }),
    playersAt: (target) => {
      dialledRealms.push(target);
      return NO_REALM_PLAYERS;
    },
    // Nowhere to write, like every other record in these runs.
    belongingsAt: () => NO_BELONGINGS,
    internal: () => DEFAULT_INTERNAL,
    publishRoster: () => {
      rosterPublishes += 1;
    },
    configFor: () => config,
    autoReconnect: () => autoReconnect,
    label: (id) => ({ name: id, server: 'test', accent: 'cyan' }),
    logDirectory: () => '',
    toAttached: (channel, message) => attachedSends.push({ channel, message }),
    // The tests observe the feed as if every window had asked for it.
    toDiagnostics: (channel, message) => attachedSends.push({ channel, message }),
    toDebugging: (channel, message) => attachedSends.push({ channel, message }),
    toAll: (channel, payload) => {
      if (payload && typeof payload === 'object' && 'session' in payload) {
        allSends.push({ channel, message: payload as Addressed<unknown> });
      }
    },
    notice: (notice) => notices.push(notice)
  });
});

afterEach(async () => {
  host?.disposeAll();
  host = null;
  fs.rmSync(backscrollDir, { recursive: true, force: true });
  for (const socket of accepted) socket.destroy();
  accepted = [];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function target() {
  return { host: '127.0.0.1', port, encoding: 'cp437' as const };
}

async function until(predicate: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The decoded text this channel delivered for one session. */
function textFor(session: SessionId): string {
  return attachedSends
    .filter((sent) => sent.channel === Push.data && sent.message.session === session)
    .map((sent) => (sent.message.payload as StreamChunk).text)
    .join('');
}

describe('SessionHost', () => {
  /*
   * The backscroll outlives the process (todo 06, 2026-09-17): what the
   * console showed is written down per character, and the next launch's
   * first attach replays it ahead of anything new.
   */
  it('opens a session on the backscroll the last launch wrote, and writes on from it', async () => {
    const file = path.join(backscrollDir, 'thorn.log');
    fs.writeFileSync(file, 'yesterday\r\n', 'utf8');
    expect(host!.ensure('thorn').backscroll.text).toBe('yesterday\r\n');

    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);
    accepted[0]!.write('today\r\n');
    await until(() => textFor('thorn').includes('today'));
    expect(host!.ensure('thorn').backscroll.text.startsWith('yesterday\r\n')).toBe(true);
    expect(host!.ensure('thorn').backscroll.text).toContain('today\r\n');

    // The write is deferred; removing the session is the flush quitting makes.
    host!.remove('thorn');
    const written = fs.readFileSync(file, 'utf8');
    expect(written.startsWith('yesterday\r\n')).toBe(true);
    expect(written).toContain('today\r\n');
  });

  it('gives each session its own output, and never the other one', async () => {
    await host!.connect('thorn', target());
    await host!.connect('mara', target());
    await until(() => accepted.length === 2);

    accepted[0]!.write('thorn sees this\r\n');
    accepted[1]!.write('mara sees that\r\n');
    await until(() => textFor('thorn').includes('this') && textFor('mara').includes('that'));

    expect(textFor('thorn')).toContain('thorn sees this');
    expect(textFor('thorn')).not.toContain('mara');
    expect(textFor('mara')).toContain('mara sees that');
    expect(textFor('mara')).not.toContain('thorn');
  });

  /*
   * A character can be dialled at a saved realm other than its own, and what
   * it learns about the players there is *that* realm's — keyed on where the
   * socket goes, not on where the character's file says it lives.
   */
  it('keys what a session learns about players on the address it dialled', async () => {
    const where = { ...target(), port };
    await host!.connect('thorn', where);
    await until(() => accepted.length === 1);
    expect(dialledRealms).toEqual([where]);
  });

  it('sends a keystroke to one socket only', async () => {
    await host!.connect('thorn', target());
    await host!.connect('mara', target());
    await until(() => accepted.length === 2);

    host!.get('thorn')!.manager.send('north\r');
    await until(() => received[0]!.includes('north'));

    expect(received[0]).toContain('north');
    // A keystroke arriving at the wrong character is the failure the addressed
    // contract exists to make impossible; this is the runtime half of it.
    expect(received[1]).not.toContain('north');
  });

  it('leaves one session connected when the other disconnects', async () => {
    await host!.connect('thorn', target());
    await host!.connect('mara', target());
    await until(() => accepted.length === 2);

    host!.get('thorn')!.manager.disconnect();
    await until(() => host!.get('thorn')!.manager.state.phase !== 'connected');

    expect(host!.connectedIds).toEqual(['mara']);
  });

  it('retains each session backscroll separately, for replay on attach', async () => {
    await host!.connect('thorn', target());
    await host!.connect('mara', target());
    await until(() => accepted.length === 2);

    accepted[0]!.write('thorn output\r\n');
    accepted[1]!.write('mara output\r\n');
    await until(
      () =>
        host!.get('thorn')!.backscroll.text.includes('thorn') &&
        host!.get('mara')!.backscroll.text.includes('mara')
    );

    expect(host!.get('thorn')!.backscroll.text).not.toContain('mara');
    expect(host!.get('mara')!.backscroll.text).not.toContain('thorn');
  });

  it('returns the same slot rather than opening a character twice', () => {
    const first = host!.ensure('thorn');
    const second = host!.ensure('thorn');
    // The same character logged in twice is never useful, and the server drops
    // one of them.
    expect(second).toBe(first);
    expect(host!.ids).toEqual(['thorn']);
  });

  /*
   * Bowel's collect-keys took the gate key Archer's *Collect it first* had
   * come for (2026-10-19). Left for the fetcher, and only by a party both
   * name: a stranger's errand leaves nothing on the floor.
   */
  it('leaves an item for the party member whose errand is fetching it', () => {
    const archer = host!.ensure('archer').manager;
    const bowel = host!.ensure('bowel').manager;
    const party = (...names: string[]): Party => ({
      ...NO_PARTY,
      members: names.map((name) => ({ name }) as Party['members'][number])
    });
    const as = (manager: typeof archer, name: string, members: string[]) =>
      vi
        .spyOn(manager, 'character', 'get')
        .mockReturnValue({ ...manager.character, name, party: party(...members) });
    as(archer, 'Archer', ['Bowel', 'Archer']);
    as(bowel, 'Bowel', ['Bowel', 'Archer']);
    vi.spyOn(archer, 'errandWants').mockImplementation((item) => item === 'gate key');
    const leaves = (manager: typeof archer, item: string): boolean =>
      (manager as unknown as { leaveFor(item: string): boolean }).leaveFor(item);
    expect(leaves(bowel, 'gate key')).toBe(true);
    expect(leaves(bowel, 'moldy key')).toBe(false);
    // Archer's own errand takes it.
    expect(leaves(archer, 'gate key')).toBe(false);
    // Out of the party, the key is Bowel's to take.
    as(bowel, 'Bowel', []);
    expect(leaves(bowel, 'gate key')).toBe(false);
  });

  it('addresses every coalesced fact it publishes', async () => {
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);
    accepted[0]!.write('[HP=30]:\r\n');
    await until(() => allSends.some((sent) => sent.channel === Push.state));

    // Nothing reaches a window without saying which character it came from.
    expect(allSends.every((sent) => typeof sent.message.session === 'string')).toBe(true);
    expect(allSends.every((sent) => sent.message.session === 'thorn')).toBe(true);
  });

  /* A window has to be told when the roster changes, or a character that just
     connected has no tab until something else happens to republish it. */
  it('republishes the roster when a character connects', async () => {
    const before = rosterPublishes;
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);
    expect(rosterPublishes).toBeGreaterThan(before);
  });

  it('reports which characters are still connected, for the quit confirmation', async () => {
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);
    expect(host!.connectedIds).toEqual(['thorn']);

    host!.disposeAll();
    expect(host!.ids).toEqual([]);
  });

  it('addresses its notices to the session that caused them', async () => {
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((notice) => notice.session === 'thorn')).toBe(true);
  });

  /*
   * Auto-reconnect, end to end through a real socket that the far end kills.
   *
   * The unit tests over `Reconnect` prove the ladder; what only this can prove
   * is that a socket dying reaches it at all — that the manager reports the
   * loss, the host redials through the same path a dial somebody asked for
   * takes, and the character comes back on a *new* connection rather than a
   * revived one.
   */
  it('dials a character back when the far end drops the socket', async () => {
    autoReconnect = true;
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);

    accepted[0]!.destroy();
    // The first attempt is immediate, so no wait beyond the socket's own close.
    await until(() => accepted.length === 2);
    expect(host!.get('thorn')?.manager.state.phase).toBe('connected');
  });

  it('leaves a character alone when the disconnect was asked for', async () => {
    autoReconnect = true;
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);

    host!.disconnect('thorn');
    await until(() => host!.get('thorn')?.manager.state.phase === 'closed');
    // Long enough that the immediate rung would have fired several times over.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(accepted).toHaveLength(1);
  });

  /*
   * The one way somebody can say *stop trying*. A character sitting at a closed
   * socket with a retry pending has nothing for the manager to close, so
   * without the host calling the timer off the button would look inert and the
   * client would dial straight back in.
   */
  it('calls a pending retry off when Disconnect is pressed', async () => {
    autoReconnect = true;
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);

    accepted[0]!.destroy();
    await until(() => accepted.length === 2);
    accepted[1]!.destroy();
    await until(() => host!.get('thorn')?.manager.state.phase === 'closed');

    host!.disconnect('thorn');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(accepted).toHaveLength(2);
    expect(host!.get('thorn')?.reconnect.pending).toBe(false);
  });

  /*
   * A character the MegaMUD engine runs is dialled back by MegaMUD's own
   * rules, never by both (2026-10-13): out of the game it does not redial,
   * and auto-reconnect stands down.
   */
  it('leaves a MegaMUD character’s redial to the engine', async () => {
    autoReconnect = true;
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);
    host!.get('thorn')!.manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });

    accepted[0]!.destroy();
    await until(() => host!.get('thorn')?.manager.state.phase === 'closed');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(accepted).toHaveLength(1);
    expect(host!.get('thorn')?.reconnect.pending).toBe(false);
  });

  it('dials back through the host when the engine redials, and Disconnect calls it off', async () => {
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);
    const manager = host!.get('thorn')!.manager;
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    const mega = (manager as unknown as { mega: MegaEngine }).mega;
    mega.s.Comms_RedialPause = 0;
    goOnline(mega.s, 1);
    mega.s.inGame = 1;

    accepted[0]!.destroy();
    await until(() => accepted.length === 2, 4000);
    expect(manager.state.phase).toBe('connected');

    goOnline(mega.s, 1);
    mega.s.inGame = 1;
    mega.s.Comms_RedialPause = 60;
    accepted[1]!.destroy();
    await until(() => manager.megaRedialing);
    expect(host!.summaries.find((row) => row.id === 'thorn')?.retrying).toBe(true);
    host!.disconnect('thorn');
    expect(manager.megaRedialing).toBe(false);
  });

  it('does not dial back a character that never asked for it', async () => {
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);

    accepted[0]!.destroy();
    await until(() => host!.get('thorn')?.manager.state.phase === 'closed');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(accepted).toHaveLength(1);
  });
});

/*
 * Upstream 74005e34: Paradigm restarted, and for 15 s of every 30 the tab's Connect did
 * nothing while a dial waited on a host that was not answering.
 */
describe('a Connect while a dial waits on the socket', () => {
  /** The next dial goes to a host that never answers; the ones after it are real. */
  function silentOnce(): DeadSocket {
    const silent = new DeadSocket();
    const real = net.createConnection.bind(net);
    vi.spyOn(net, 'createConnection')
      .mockImplementationOnce(() => silent as unknown as net.Socket)
      .mockImplementation(real as typeof net.createConnection);
    return silent;
  }
  afterEach(() => {
    vi.restoreAllMocks();
    setTuning(DEFAULT_INTERNAL.tuning);
  });

  it('gives the silent dial up and dials once more', async () => {
    const silent = silentOnce();
    void host!.connect('thorn', target());
    expect(host!.get('thorn')!.manager.state.phase).toBe('connecting');

    await host!.connect('thorn', target());
    await until(() => host!.get('thorn')!.manager.state.phase === 'connected');
    expect(silent.destroyed).toBe(true);
    expect(accepted).toHaveLength(1);
    expect(notices.some((n) => n.message === t('notices.session.dialAgain'))).toBe(true);
  });

  it('takes no key while the dial waits, and owes nothing for one', async () => {
    const silentForMs = 100;
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      reconnect: { ...DEFAULT_INTERNAL.tuning.reconnect, silentForMs }
    });
    const deadLink = t('session.connection.deadLink', { seconds: Math.round(silentForMs / 1000) });
    const silent = silentOnce();
    void host!.connect('thorn', target());
    void host!.connect('mara', target());
    await until(() => host!.get('mara')!.manager.state.phase === 'connected');
    expect(host!.get('thorn')!.manager.state.phase).toBe('connecting');

    // Thorn's key first: had it armed the watch, it would have fired first.
    host!.get('thorn')!.manager.send('\r');
    host!.get('mara')!.manager.send('look\r');
    // The positive control: a key on an open socket the far end never answers.
    await until(() => notices.some((n) => n.session === 'mara' && n.message === deadLink));
    expect(notices.some((n) => n.session === 'thorn' && n.message === deadLink)).toBe(false);
    expect(silent.written).toEqual([]);
  });

  it('keeps reconnecting when the dial a Connect made fails', async () => {
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      reconnect: { ...DEFAULT_INTERNAL.tuning.reconnect, stepMs: 50, maxDelayMs: 100 }
    });
    autoReconnect = true;
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);

    // The realm goes: every dial is refused until it is back.
    vi.spyOn(net, 'createConnection').mockImplementation(() => {
      const refused = new DeadSocket();
      queueMicrotask(() => refused.emit('error', new Error('connect ECONNREFUSED')));
      return refused as unknown as net.Socket;
    });
    accepted[0]!.destroy();
    await until(() => host!.get('thorn')!.manager.state.phase === 'error');

    const state = await host!.connect('thorn', target());
    expect(state.phase).toBe('error');
    // Still on the ladder: Stop reconnecting is what ends it.
    expect(host!.get('thorn')!.reconnect.pending).toBe(true);

    vi.restoreAllMocks();
    await until(() => host!.get('thorn')!.manager.state.phase === 'connected');
    expect(accepted).toHaveLength(2);
    expect(host!.get('thorn')!.reconnect.pending).toBe(false);
  });

  it('dials now during a reconnect, and the reconnect stops', async () => {
    autoReconnect = true;
    await host!.connect('thorn', target());
    await until(() => accepted.length === 1);

    const silent = silentOnce();
    accepted[0]!.destroy();
    // The first rung is immediate, and it goes to the host that does not answer.
    await until(() => vi.mocked(net.createConnection).mock.calls.length === 1);
    expect(host!.get('thorn')!.reconnect.pending).toBe(true);

    await host!.connect('thorn', target());
    await until(() => host!.get('thorn')!.manager.state.phase === 'connected');
    expect(silent.destroyed).toBe(true);
    expect(accepted).toHaveLength(2);
    expect(host!.get('thorn')!.reconnect.pending).toBe(false);
  });
});
