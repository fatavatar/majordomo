import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  BUSY_PHASES,
  editorInput,
  IDLE_FLUSH_MS,
  SessionManager,
  type RealmData,
  type RealmFinds,
  type SessionAct,
  type SessionSink
} from '../SessionManager';
import type { MegaEngine, MegaEngineHost } from '../MegaEngine';
import type { ResumableMovement } from '../MovementBook';
import { pendingPump } from '../../megamud/script/send';
import { NO_LOOP, type Loop, type LoopProgress } from '../../../shared/loops';
import { IDLE_WALK, type WalkProgress } from '../../../shared/walk';
import { DEFAULT_CONFIG, type AutomationConfig, type RetreatConfig } from '../../../shared/config';
import { blankTrigger } from '../../../shared/messageTriggers';
import { WorldGraph } from '../../world/WorldGraph';
import { t } from '../../app/i18n';
import { PlayerBook } from '../../world/PlayerBook';
import { PROMPT_REPAINT } from '../../net/stream-quirks';
import { ABANDON_MS } from '../TerminalFeed';
import type { StreamLine, StreamChunk } from '../../../shared/types';
import type { AutomationSnapshot } from '../../../shared/automation';
import type { CharacterState } from '../../../shared/character';
import type { StandDown } from '../../automation/LoginAutomator';
import type { Find, Sighting } from '../../../shared/finds';
import type { FightSink, MeasureAsk, MeasuredOutput } from '../../../shared/fights';
import { DEFAULT_INTERNAL } from '../../../shared/internal';
import { defaultSettings } from '../../../shared/megamud/settings';
import { setTuning, tuning } from '../../app/tuning';
import type { RewriteDesign } from '../../../shared/rewrites';
import type { RewritesUiConfig } from '../../../shared/config';
import type { Route } from '../../../shared/world';
import { MonsterFlag } from '../../megamud/flags';

/**
 * These drive a real socket rather than a mocked client: framing sits directly
 * on top of the transport, and a chunk boundary landing inside a terminator is
 * exactly the case a mock would paper over.
 */
let server: net.Server;
let port: number;
let manager: SessionManager | null = null;

/**
 * Every socket the server has accepted, in order. A test that reconnects needs
 * the *second* one, so this is a list rather than a single latch.
 */
let accepted: net.Socket[] = [];

beforeEach(async () => {
  accepted = [];
  server = net.createServer((socket) => {
    socket.on('error', () => {});
    accepted.push(socket);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
});

afterEach(async () => {
  manager?.dispose();
  manager = null;
  for (const socket of accepted) socket.destroy();
  accepted = [];
  setTuning(DEFAULT_INTERNAL.tuning);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The nth accepted socket, once it exists. */
async function client(index = 0): Promise<net.Socket> {
  await until(() => accepted.length > index);
  return accepted[index]!;
}

/**
 * A route under way, as the escape reads it: only a character the client is
 * taking somewhere runs (todo 03). For the tests about which way out, where a
 * real walk would send steps of its own into the wire under test.
 */
function underWay(session: SessionManager): void {
  vi.spyOn(session, 'movement', 'get').mockReturnValue({
    kind: 'route',
    moving: true,
    resumable: false
  });
}

function collect(): {
  sink: SessionSink;
  lines: StreamLine[];
  notices: string[];
  traces: AutomationSnapshot[];
  raw: Buffer[];
  drops: Array<StandDown | null>;
} {
  const lines: StreamLine[] = [];
  const notices: string[] = [];
  const traces: AutomationSnapshot[] = [];
  const raw: Buffer[] = [];
  /** One entry per socket that went *unasked*. See `SessionSink.dropped`. */
  const drops: Array<StandDown | null> = [];
  return {
    lines,
    notices,
    traces,
    raw,
    drops,
    sink: {
      bytes: (payload) => raw.push(payload),
      data: () => {},
      line: (line) => lines.push(line),
      block: () => {},
      character: () => {},
      command: () => {},
      state: () => {},
      dropped: (why) => drops.push(why),
      telnet: () => {},
      notice: (message) => notices.push(message),
      automation: (snapshot) => traces.push(snapshot)
    }
  };
}

/** Waits until `predicate` holds or the timeout elapses. */
async function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * The trigger line has been read, and the client has had its chance to act.
 *
 * A negative assertion needs both halves, and a fixed sleep is only the second
 * of them: a status line the client never saw — a framing regression, a pattern
 * that stopped matching — passed as though the feature had correctly declined.
 * Waiting for the health figure to reach `character` proves the line landed.
 *
 * `publishLine` classifies, feeds and only then calls `act`, all in one
 * synchronous call, so observing the figure from a poll means the decision has
 * already been made or declined. The short settle after it covers anything
 * deferred a turn, and is a twelfth of the sleep it replaces.
 */
async function settled(hp: number): Promise<void> {
  await until(() => manager!.character.vitals.hp === hp);
  await new Promise((resolve) => setTimeout(resolve, 25));
}

/** A realm with nothing imported and no coins renamed, for `configureRealm`. */
const NO_REALM: RealmData = { messages: [], monsters: [], items: [], coins: {} };

describe('the raw byte record', () => {
  /*
   * The tap the capture is built on, and it went unwired for four phases: the
   * `bytes` event existed on `TelnetClient`, `SessionCapture.bytes()` existed
   * and was documented in that file's header, and nothing connected them. The
   * cost was not theoretical — the first disagreement about what the server
   * actually sent, and in what order, had no file to settle it from.
   */
  it('publishes payload bytes undecoded, so an encoding fault survives them', async () => {
    const { sink, raw } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    // Shade and block glyphs: invalid UTF-8, wrong in Latin-1, and exactly what
    // this server opens with. Decoded text could not prove they arrived.
    socket.write(Buffer.from([0xb0, 0xdb, 0xdb, 0xb1]));
    await until(() => raw.length > 0);
    expect(Buffer.concat(raw)).toEqual(Buffer.from([0xb0, 0xdb, 0xdb, 0xb1]));
  });

  it('strips Telnet framing from what it publishes, keeping the payload', async () => {
    const { sink, raw } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    // IAC WILL ECHO around a payload: negotiation is not payload, and a record
    // that mixed the two could not be replayed through the parser.
    socket.write(Buffer.from([0xff, 0xfb, 0x01, 0x41, 0x42]));
    await until(() => Buffer.concat(raw).length >= 2);
    expect(Buffer.concat(raw)).toEqual(Buffer.from([0x41, 0x42]));
  });
});

describe('SessionManager line framing', () => {
  it('frames server output into lines', async () => {
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('one\r\ntwo\r\n');

    await until(() => lines.length >= 2);
    expect(lines.map((line) => line.plain)).toEqual(['one', 'two']);
    expect(lines.every((line) => line.terminator === 'newline')).toBe(true);
  });

  it('frames the in-place status-line repaint as its own line', async () => {
    // The case that makes this game family different: the server rewrites its
    // status line with ESC[79D ESC[K instead of sending a newline.
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write(`[HP=100/MA=50]:${PROMPT_REPAINT}You are in a room.\r\n`);

    await until(() => lines.length >= 2);
    expect(lines[0]?.plain).toBe('[HP=100/MA=50]:');
    expect(lines[0]?.terminator).toBe('repaint');
    expect(lines[1]?.plain).toBe('You are in a room.');
  });

  it('reassembles a line split across two writes', async () => {
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('Obvious exits: ');
    await new Promise((resolve) => setTimeout(resolve, 40));
    socket.write('north, south\r\n');

    await until(() => lines.some((line) => line.terminator === 'newline'));
    expect(lines.at(-1)?.plain).toBe('Obvious exits: north, south');
  });

  it('frames a finished prompt the moment it arrives, not after the quiet period', async () => {
    /*
     * The status line carries the vitals and credits the next queued command,
     * and nothing follows a finished `]:` on the wire but this client's own
     * echo (a 50MB GreaterMUD capture, 2026-09-11: 27,166 prompt-ending
     * chunks, every continuation an echo). Waiting out the quiet period read
     * every prompt a median 127ms late and half of them the whole 150ms.
     */
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    const sent = Date.now();
    socket.write(
      `You are in a room.\r\n${PROMPT_REPAINT}\x1b[0;36m[HP=\x1b[1;36m100\x1b[0;36m/MA=\x1b[1;36m50\x1b[0;36m]:`
    );

    await until(() => manager!.character.vitals.hp === 100);
    expect(Date.now() - sent).toBeLessThan(IDLE_FLUSH_MS);
    expect(lines.at(-1)?.plain).toBe('[HP=100/MA=50]:');
    expect(lines.at(-1)?.terminator).toBe('flush');
  });

  it('still waits when something follows the colon, and once the realm puts its state there', async () => {
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    // The echo glued to the prompt is not a finished prompt: the quiet period
    // frames it, as it always did.
    socket.write('[HP=100/MA=50]:n');
    await new Promise((resolve) => setTimeout(resolve, IDLE_FLUSH_MS / 3));
    expect(lines.filter((line) => line.plain.startsWith('[HP='))).toHaveLength(0);
    await until(() => manager!.character.vitals.hp === 100);
    expect(lines.at(-1)?.plain).toBe('[HP=100/MA=50]:n');

    // A realm that writes its state after the colon: from then on a bare `]:`
    // waits for whatever the realm puts after it.
    socket.write(`${PROMPT_REPAINT}[HP=90/MA=50]: (Resting)`);
    await until(() => manager!.character.vitals.hp === 90);
    socket.write(`${PROMPT_REPAINT}[HP=80/MA=50]:`);
    await new Promise((resolve) => setTimeout(resolve, IDLE_FLUSH_MS / 3));
    expect(manager!.character.vitals.hp).toBe(90);
    await until(() => manager!.character.vitals.hp === 80);
  });

  it('waits for the second half of a prompt the server writes in two pieces', async () => {
    /*
     * The bearfather BBS writes `[HP=40/40,…,S= (Resting)` and then ` ]:` a
     * tenth of a second later — longer than the quiet period a quarter of
     * the time (2026-09-09: 130 of 504 prompts). Flushed between the two, the
     * halves were two lines neither of which was a status line, and every such
     * prompt's vitals and resting state were lost. A prompt that has opened
     * and not closed has not ended, however quiet the socket is.
     */
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('\x1b[0;36m[HP=40/40,MA=7/8,Exp=0,Need=2500,$=0,S= (Resting)');
    await new Promise((resolve) => setTimeout(resolve, IDLE_FLUSH_MS * 1.5));
    expect(lines).toHaveLength(0);
    socket.write(' ]:');

    await until(() => manager!.character.vitals.hp === 40);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.plain).toBe('[HP=40/40,MA=7/8,Exp=0,Need=2500,$=0,S= (Resting) ]:');
    expect(manager.character.vitals.resting).toBe(true);
  });

  it('frames what the realm appends to a finished prompt without waiting the prompt hold', async () => {
    /*
     * The realm writes what it volunteers straight onto the prompt row with no
     * terminator between them — `[HP=127/MA=156]:Broadcast from Mist "dame"`,
     * captures/025 line 313 — so the sentence is only ever framed by the idle
     * flush. Where the prompt itself is one `STATUS_LINE` does not accept —
     * `[hp=` lower-cased, captures/076, 43 times — the buffered text read as a
     * prompt *still arriving*, so it waited `promptHoldMs`; and because the
     * flush is re-armed by every chunk, a realm that kept talking pushed the
     * deadline out again each time. The broadcast reached the Talk card
     * seconds after it was said, or not until the room went quiet.
     *
     * The hold is left long here so that finishing quickly is the assertion:
     * arriving well inside it proves the tail is no longer held for a prompt.
     */
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      session: {
        ...DEFAULT_INTERNAL.tuning.session,
        promptHoldMs: IDLE_FLUSH_MS * 20,
        // Not a prompt either, so it is the sentence hold it must beat.
        sentenceHoldMs: IDLE_FLUSH_MS * 2
      }
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('[hp=127/ma=156]:Broadcast from Mist "dame"');

    // The positive control is the line arriving at all, well inside the hold.
    await until(() => lines.length >= 1, IDLE_FLUSH_MS * 8);
    expect(lines[0]?.plain).toBe('[hp=127/ma=156]:Broadcast from Mist "dame"');
  });

  it('gives up on a prompt the server never finishes', async () => {
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      session: { ...DEFAULT_INTERNAL.tuning.session, promptHoldMs: IDLE_FLUSH_MS * 2 }
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('[HP=4');
    await until(() => lines.length >= 1, IDLE_FLUSH_MS * 4);
    expect(lines[0]?.plain).toBe('[HP=4');
    expect(lines[0]?.terminator).toBe('flush');
  });

  it('waits for the rest of a sentence the wire cut in half', async () => {
    /*
     * bearfather relays a MajorMUD door over the internet and paused 178ms in
     * the middle of a room name (2026-09-17, `Intersection of River St. &
     * Mystic Alle` then `y`). The quiet period framed the half as a line, the
     * room-name rule accepted it, `Also here:` was destroyed with it, and the
     * fragment was written into the character's memory as a place that does
     * not exist; the walk then stopped, unable to say where it was. Measured
     * over 670 sessions, 25 server sentences were cut this way — room exits, a
     * monster's arrival, `who` rows split mid-name. The quiet period is a
     * prompt's, and this tail is not one.
     */
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('\x1b[1;36mIntersection of River St. & Mystic Alle');
    await new Promise((resolve) => setTimeout(resolve, IDLE_FLUSH_MS * 1.5));
    expect(lines).toHaveLength(0);

    // The positive control the absence above needs: the rest arrives and the
    // whole name is framed once, on its own terminator rather than the clock.
    socket.write('y\r\n');
    await until(() => lines.length >= 1);
    expect(lines[0]?.plain).toBe('Intersection of River St. & Mystic Alley');
    expect(lines[0]?.terminator).toBe('newline');
  });

  it('still releases a prompt at the quiet period, however long a sentence waits', async () => {
    /*
     * The hold is for tails that are not prompts, and login is the reason the
     * flush exists at all: every prompt these realms have asked ends at `:` or
     * `?` — bearfather's `(N)onstop, (Q)uit, or (C)ontinue?` among them. The
     * sentence hold is left long so that answering quickly is the assertion.
     */
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      session: { ...DEFAULT_INTERNAL.tuning.session, sentenceHoldMs: IDLE_FLUSH_MS * 20 }
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('(N)onstop, (Q)uit, or (C)ontinue?');
    await until(() => lines.length >= 1, IDLE_FLUSH_MS * 4);
    expect(lines[0]?.plain).toBe('(N)onstop, (Q)uit, or (C)ontinue?');
    expect(lines[0]?.terminator).toBe('flush');
  });

  it('releases a trailing prompt once the server goes quiet', async () => {
    // The login prompt never gets a terminator: the server sends it and waits.
    // Without the idle flush the line the player is staring at is invisible to
    // every consumer until the socket closes.
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('Please enter your username or "new":');

    await until(() => lines.length >= 1);
    expect(lines[0]?.plain).toBe('Please enter your username or "new":');
    expect(lines[0]?.terminator).toBe('flush');
  });

  it('does not re-emit a prompt it has already released', async () => {
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('Password:');
    await until(() => lines.length >= 1);

    manager.disconnect();
    // One whole flush period after the disconnect: if it had armed another
    // timer, that is when the second copy would arrive.
    await new Promise((resolve) => setTimeout(resolve, IDLE_FLUSH_MS * 2));
    expect(lines.filter((line) => line.plain === 'Password:')).toHaveLength(1);
  });

  it('strips ANSI into `plain` while keeping it in `text`', async () => {
    // Grammar first, colour second: rules match plain text, and the attributes
    // stay available alongside as a confidence signal.
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('\x1b[0;32mObvious exits: \x1b[1;33mnorth\x1b[0m\r\n');

    await until(() => lines.length >= 1);
    expect(lines[0]?.plain).toBe('Obvious exits: north');
    expect(lines[0]?.text).toContain('\x1b[1;33m');
  });

  it('numbers lines monotonically and restarts them per connection', async () => {
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('a\r\nb\r\n');
    await until(() => lines.length >= 2);
    expect(lines.map((line) => line.seq)).toEqual([1, 2]);

    expect(manager.lines).toHaveLength(2);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    expect(manager.lines).toHaveLength(0);
  });

  it('does not let a partial line leak between connections', async () => {
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('half a line');
    await until(() => lines.length >= 1);
    lines.length = 0;

    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const second = await client(1);
    second.write(' rest\r\n');

    await until(() => lines.length >= 1);
    expect(lines[0]?.plain).toBe(' rest');
  });

  it('keeps the retained line log bounded', async () => {
    const { sink } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write(Array.from({ length: 700 }, (_, i) => `line ${i}\r\n`).join(''));

    await until(() => manager!.lines.length === 500);
    expect(manager.lines).toHaveLength(500);
    // Oldest dropped, newest kept.
    expect(manager.lines.at(-1)?.plain).toBe('line 699');
  });
});

describe('SessionManager lifecycle', () => {
  it('publishes nothing after dispose', async () => {
    // A pending prompt must not be flushed into a sink whose owner has gone
    // away — that is how a torn-down window gets written to.
    const { sink, lines } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('a prompt with no newline');

    manager.dispose();
    const seen = lines.length;
    // The pending prompt would be released by the idle flush, so the wait is
    // one whole flush period rather than a number chosen to feel safe.
    await new Promise((resolve) => setTimeout(resolve, IDLE_FLUSH_MS * 2));
    expect(lines).toHaveLength(seen);

    manager = null;
  });
});

/*
 * Which closes are a *loss*, which is the whole safety property auto-reconnect
 * rests on. Every deliberate close arrives at the same `close` event, and this
 * is the only place that can tell them apart — so a mistake here is a client
 * that either abandons a character mid-dungeon or dials somebody back into a
 * realm they walked out of, with their password.
 */
describe('telling a lost socket from one that was closed', () => {
  it('reports the far end hanging up, with no reason to stand down', async () => {
    const { sink, drops } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.destroy();
    await until(() => drops.length > 0);
    expect(drops).toEqual([null]);
  });

  it('reports nothing at all when this client asked for the disconnect', async () => {
    const { sink, drops } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    await client();

    manager.disconnect();
    await until(() => manager!.state.phase === 'closed');
    expect(drops).toEqual([]);
  });

  /*
   * The player typed their way out and the BBS then hung up on them. At the
   * socket layer that is identical to a dead link; one line above it, it is
   * the one close that must never be dialled back — automatic login would put
   * them straight back in the realm they just left.
   */
  it('carries the reason when the player had left the realm on purpose', async () => {
    const { sink, drops } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    // MajorMUD's completed exit, as bearfather writes it (2026-09-17).
    socket.write('You will exit after a period of silent meditation.\r\n');
    socket.write(
      'Your character has been saved. If you have any comments or suggestions, please\r\n'
    );
    // The block has to be classified before the socket goes, or the latch this
    // reads has not been set — which is the ordering the real stream has too.
    await until(() => manager!.lines.some((line) => /has been saved/.test(line.plain)));
    socket.destroy();

    await until(() => drops.length > 0);
    expect(drops).toEqual(['left-realm']);
  });

  /*
   * The request is not the leaving: the realm refuses exits and interrupts
   * them. A link lost before one completes is a loss, and is dialled back.
   */
  it('carries no reason for an exit the realm never completed', async () => {
    const { sink, drops } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('You will exit after a period of silent meditation.\r\n');
    await until(() => manager!.lines.some((line) => /silent meditation/.test(line.plain)));
    socket.destroy();

    await until(() => drops.length > 0);
    expect(drops).toEqual([null]);
  });

  it('carries the reason when the realm refused the login', async () => {
    const { sink, drops } = collect();
    manager = new SessionManager(sink, undefined, DEFAULT_CONFIG.automation, {
      enabled: true,
      username: 'vaelor',
      password: 'wrong',
      steps: []
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('Invalid username/password!\r\n');
    await until(() => manager!.lines.some((line) => /Invalid username/.test(line.plain)));
    socket.destroy();

    await until(() => drops.length > 0);
    expect(drops).toEqual(['login-refused']);
  });
});

describe('answering the login', () => {
  /**
   * The sequence, and what the server says next once each answer arrives.
   * Every prompt is sent *unterminated*: the server says its piece and waits,
   * which is why the idle flush has to release it before anything can answer.
   */
  const EXCHANGE: Array<{ prompt: string; expect: string }> = [
    { prompt: 'Please enter your username or "new": ', expect: 'vaelor' },
    { prompt: 'Please enter your password: ', expect: 'secret' },
    { prompt: 'Please enter your selection: ', expect: 'P' },
    { prompt: 'Please select a realm: ', expect: '1' },
    { prompt: '[PARADIGM]: ', expect: 'E' }
  ];

  it('answers every prompt without waiting out the acknowledgement timeout', async () => {
    /*
     * The regression this exists for: a login produces no status line, so when
     * only the status line released queue credit, the third answer sat until
     * `ackTimeoutMs` expired and logging in took four and a half seconds. A
     * prompt *is* the acknowledgement — the server has finished with the last
     * command and is waiting — so the window must reopen on one.
     *
     * A window of 2 against a 5s timeout makes the difference unmissable: with
     * prompts acking, the whole exchange finishes in well under a second; with
     * only status lines acking, it could not finish inside this test's budget.
     */
    const { sink } = collect();
    manager = new SessionManager(
      sink,
      undefined,
      {
        ...DEFAULT_CONFIG.automation,
        pacing: { window: 2, minGapMs: 50, ackTimeoutMs: 5000 }
      },
      {
        enabled: true,
        username: 'vaelor',
        password: 'secret',
        steps: [
          // The account is two rows of the script like any other now: every
          // BBS asks for it and every BBS words the question differently.
          { when: 'Please enter your username', send: '{user}' },
          { when: 'Please enter your password', send: '{password}' },
          { when: 'Please enter your selection', send: 'P' },
          { when: 'Please select a realm', send: '1' },
          { when: 'Please select a character', send: '1' },
          { when: '[PARADIGM]', send: 'E' }
        ]
      }
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    const received: string[] = [];
    socket.on('data', (chunk) => {
      for (const answer of chunk.toString('latin1').split('\r\n')) {
        if (answer.length > 0) received.push(answer);
      }
    });

    const started = Date.now();
    for (const [index, step] of EXCHANGE.entries()) {
      socket.write(step.prompt);
      await until(() => received.length > index, 4000);
    }

    expect(received).toEqual(EXCHANGE.map((step) => step.expect));
    // Generous, but far below even one ackTimeoutMs: the point is that nothing
    // in the sequence blocked on the timeout.
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

/*
 * The realm names its own data at its menu — `[MAJORMUD]:`, `[PARADIGM]:` —
 * and that word chooses which of the two bundled worlds the next session
 * walks (`shared/worlds.ts`). This session's world was bound before anything
 * was dialled, so the word is told to the sink to be remembered and, when it
 * disagrees with what is loaded, said once.
 */
describe("the realm's own word for its data", () => {
  /** A one-room stand-in for a bundled world, named as `build-world.mjs` names it. */
  function bundled(world: 'majormud' | 'paradigm'): WorldGraph {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-world-'));
    const file = path.join(dir, 'rooms.jsonl.gz');
    fs.writeFileSync(
      file,
      zlib.gzipSync(
        [
          JSON.stringify({ v: 27, source: world, world, rooms: 1, generatedAt: 'x' }),
          JSON.stringify({ m: 1, r: 1, n: 'Town Square', x: {} })
        ].join('\n') + '\n'
      )
    );
    const graph = WorldGraph.load(file);
    fs.rmSync(dir, { recursive: true, force: true });
    return graph;
  }

  it('tells the sink once, and says when this session is walking the other world', async () => {
    const { sink, notices } = collect();
    const told: string[] = [];
    manager = new SessionManager(
      { ...sink, realmTold: (realm) => told.push(realm) },
      bundled('paradigm')
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();

    // Unterminated, as the real prompt is; the idle flush releases it.
    socket.write('[MAJORMUD]: ');
    await until(() => told.length > 0);
    expect(told).toEqual(['majormud']);
    await until(() => notices.some((notice) => /says it is MajorMUD/.test(notice)));
    expect(notices.filter((notice) => /says it is MajorMUD/.test(notice))).toHaveLength(1);
    expect(notices.join(' ')).toMatch(/loaded for this session is Paradigm/);

    // The prompt arrives on every line at the menu; the word is told once.
    socket.write('[MAJORMUD]: ');
    await new Promise((resolve) => setTimeout(resolve, ABANDON_MS + 50));
    expect(told).toEqual(['majormud']);
  });

  it('says nothing when the realm and the loaded world agree', async () => {
    const { sink, notices } = collect();
    const told: string[] = [];
    manager = new SessionManager(
      { ...sink, realmTold: (realm) => told.push(realm) },
      bundled('paradigm')
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();

    socket.write('[PARADIGM]: ');
    await until(() => told.length > 0);
    expect(told).toEqual(['paradigm']);
    expect(notices.some((notice) => /says it is/.test(notice))).toBe(false);
  });

  it("says nothing about a player's own database, which names no bundled world", async () => {
    const { sink, notices } = collect();
    const told: string[] = [];
    manager = new SessionManager({ ...sink, realmTold: (realm) => told.push(realm) }, haven());
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();

    socket.write('[MAJORMUD]: ');
    await until(() => told.length > 0);
    expect(notices.some((notice) => /says it is/.test(notice))).toBe(false);
  });
});

describe("the shadow of the server's input line", () => {
  /*
   * The buffer that decides whether automation may send has to hold what the
   * *server* holds, and a control byte is not text. Measured in
   * `logs/2026-08-30_20-57-36_main.mudcap.jsonl`: twenty Escapes and an Enter
   * were answered with a bare room reprint, exactly as an empty line is.
   */
  it('keeps what the server would keep', () => {
    expect(editorInput('north')).toBe('north');
    expect(editorInput('n\r')).toBe('n\r');
    // The erases are modelled by the caller, so they survive this.
    expect(editorInput('no\x7f')).toBe('no\x7f');
  });

  it('keeps nothing of the keys the server keeps nothing of', () => {
    // Escape, on its own and twenty times over.
    expect(editorInput('\x1b')).toBe('');
    expect(editorInput('\x1b'.repeat(20) + '\r')).toBe('\r');
    // An arrow key, which is where dropping only the introducer would leave
    // `[A` behind and hold automation just as thoroughly.
    expect(editorInput('\x1b[A')).toBe('');
    expect(editorInput('\x1b[1;5C')).toBe('');
    // A function key (SS3), Tab, and a Ctrl chord.
    expect(editorInput('\x1bOP')).toBe('');
    expect(editorInput('\t')).toBe('');
    expect(editorInput('\x01')).toBe('');
  });

  /* A sequence the chunk ends inside is consumed whole rather than leaving
     half of something the server is not holding at all. */
  it('consumes a sequence the chunk ends inside', () => {
    expect(editorInput('n\x1b[')).toBe('n');
    expect(editorInput('n\x1b')).toBe('n');
  });
});

describe('the decision trace', () => {
  /** Drives the fixture to the realm, which is what makes the probe fire. */
  async function reachTheRealm(socket: net.Socket): Promise<void> {
    socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
  }

  it('publishes the first change immediately rather than after the interval', async () => {
    // A trace you have to wait a beat for is a worse trace.
    const { sink, traces } = collect();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    await reachTheRealm(socket);

    await until(() => traces.length > 0);
    expect(traces.length).toBeGreaterThan(0);
  });
});

describe('credentials in the record', () => {
  /**
   * The session capture records every outbound command verbatim, which is what
   * makes it useful for pattern work and exactly why the answer to a password
   * prompt must be filtered before it gets there.
   */
  function withCommands(): { sink: SessionSink; commands: string[] } {
    const commands: string[] = [];
    const { sink } = collect();
    return { commands, sink: { ...sink, command: (command) => commands.push(command) } };
  }

  it('never writes down the answer to a password prompt', async () => {
    const { sink, commands } = withCommands();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('Please enter your password:\r\n');
    await until(() => manager!.character.phase !== 'unknown' || true);
    // Whoever answers -- automator or a person typing -- it is the prompt that
    // makes the next command a secret, not who sent it.
    await new Promise((r) => setTimeout(r, 50));
    manager.send('hunter2\r');

    await until(() => commands.length > 0);
    expect(commands).not.toContain('hunter2');
    expect(commands[0]).toMatch(/^•+$/);
  });

  it('redacts one command, not every command after it', async () => {
    const { sink, commands } = withCommands();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('Please enter your password:\r\n');
    await new Promise((r) => setTimeout(r, 50));
    manager.send('hunter2\r');
    manager.send('look\r');

    await until(() => commands.length >= 2);
    expect(commands[1]).toBe('look');
  });

  it('redacts the password the automator sends, not the command after it', async () => {
    /*
     * The bug this exists for, found by reading a real capture: the flag was
     * armed *after* the login automator saw the block, and the automator
     * answers synchronously from inside that call. So the password went into
     * the file verbatim and the menu selection after it was starred out --
     * which looks entirely correct until you read the file.
     */
    const commands: string[] = [];
    const { sink } = collect();
    manager = new SessionManager(
      { ...sink, command: (command) => commands.push(command) },
      undefined,
      {
        ...DEFAULT_CONFIG.automation,
        pacing: { window: 2, minGapMs: 10, ackTimeoutMs: 5000 }
      },
      {
        enabled: true,
        username: 'vaelor',
        password: 'secret',
        steps: [
          // The account is two rows of the script like any other now: every
          // BBS asks for it and every BBS words the question differently.
          { when: 'Please enter your username', send: '{user}' },
          { when: 'Please enter your password', send: '{password}' },
          { when: 'Please enter your selection', send: 'P' },
          { when: 'Please select a realm', send: '1' },
          { when: 'Please select a character', send: '1' },
          { when: '[PARADIGM]', send: 'E' }
        ]
      }
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('Please enter your username or "new": ');
    await until(() => commands.length >= 1, 4000);
    socket.write('Please enter your password: ');
    await until(() => commands.length >= 2, 4000);
    socket.write('Please enter your selection: ');
    await until(() => commands.length >= 3, 4000);

    expect(commands[0]).toBe('vaelor');
    expect(commands[1]).toMatch(/^•+$/);
    expect(commands[2]).toBe('P');
    expect(commands.join(' ')).not.toContain('secret');
  });

  it('redacts the configured password at a prompt the classifier did not read', async () => {
    /*
     * The prompt is the primary key, and it is also the weak point: a BBS
     * front-end the classifier has never met produces no `prompt-password`
     * block, so a manual login there would have written the password down
     * verbatim. The configured credential is the one thing known without
     * reading the prompt -- and only an exact match counts, so the command
     * after it is recorded as itself.
     */
    const commands: string[] = [];
    const { sink } = collect();
    manager = new SessionManager(
      { ...sink, command: (command) => commands.push(command) },
      undefined,
      DEFAULT_CONFIG.automation,
      { ...DEFAULT_CONFIG.connection.login, username: 'vaelor', password: 'hunter2' }
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    // Not a shape the classifier knows, so nothing arms the prompt-keyed redaction.
    socket.write('Secret word? ');
    await new Promise((r) => setTimeout(r, 50));
    manager.send('hunter2\r');
    manager.send('look\r');

    await until(() => commands.length >= 2);
    expect(commands[0]).toMatch(/^•+$/);
    expect(commands[1]).toBe('look');
    expect(commands.join(' ')).not.toContain('hunter2');
  });

  /*
   * The case neither of the other two arms reaches.
   *
   * An unrecognised BBS asks for both on one line, so the script answers with
   * `login {user} {password}`: the classifier types nothing, and the command is
   * not *equal* to the configured password. `Intent.secret` is the third arm,
   * set where the automator fills the placeholder in and carried on the intent
   * so the queue holding it cannot spend the mask on somebody else's line.
   */
  it('redacts a filled template at a prompt the classifier did not read', async () => {
    const commands: string[] = [];
    const { sink } = collect();
    manager = new SessionManager(
      { ...sink, command: (command) => commands.push(command) },
      undefined,
      DEFAULT_CONFIG.automation,
      {
        ...DEFAULT_CONFIG.connection.login,
        enabled: true,
        username: 'vaelor',
        password: 'hunter2',
        steps: [{ when: 'Account', send: 'login {user} {password}' }]
      }
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    // No newline: the idle flush releases it, which is what makes it a prompt.
    socket.write('Account: ');
    await until(() => commands.length >= 1, 4000);

    expect(commands[0]).toMatch(/^•+$/);
    expect(commands.join(' ')).not.toContain('hunter2');
    // The username is not a secret, but it went out inside the same command,
    // so the whole line is masked rather than half of it.
    expect(commands.join(' ')).not.toContain('vaelor');
  });

  it('redacts the answers to the account-creation password prompts too', async () => {
    /*
     * Found by the corrected `check:secrets`: a 2026-08-26 capture held a
     * password twice, typed at `Please enter the password you would like to
     * use:` and again at `Please confirm your new password:`, two days after
     * the login prompt was keyed on. The answer here is deliberately *not* a
     * configured password, so this proves the prompt path and not the match.
     */
    const { sink, commands } = withCommands();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    const socket = await client();
    socket.write('Please enter the password you would like to use:\r\n');
    await new Promise((r) => setTimeout(r, 50));
    manager.send('brandnew1\r');
    socket.write('Please confirm your new password:\r\n');
    await new Promise((r) => setTimeout(r, 50));
    manager.send('brandnew1\r');
    manager.send('look\r');

    await until(() => commands.length >= 3);
    expect(commands[0]).toMatch(/^•+$/);
    expect(commands[1]).toMatch(/^•+$/);
    expect(commands[2]).toBe('look');
    expect(commands.join(' ')).not.toContain('brandnew1');
  });

  it('leaves ordinary commands alone', async () => {
    const { sink, commands } = withCommands();
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });

    await client();
    manager.send('who\r');
    await until(() => commands.length > 0);
    expect(commands[0]).toBe('who');
  });
});

describe('connecting twice', () => {
  it('refuses a second attempt while the first is still in flight', async () => {
    // `connect` tears down whatever is open before it dials, so a second call
    // arriving mid-handshake kills a connection that was about to succeed.
    // React's StrictMode made that the *normal* case in development: it mounts
    // the renderer twice, and both mounts said "ready".
    expect(BUSY_PHASES.has('connecting')).toBe(true);
    expect(BUSY_PHASES.has('resolving')).toBe(true);
  });

  it('does not treat being connected as a reason to refuse', async () => {
    // Dialling while connected is how you switch servers, and the palette
    // offers it.
    expect(BUSY_PHASES.has('connected')).toBe(false);
  });
});

/*
 * The panic button, and why it mostly refuses.
 *
 * "Disconnect when health is low" is what every MegaMUD-era client offers, and
 * on this server family an unclean disconnect costs a percentage of *maximum*
 * HP — fatal at exactly the health that makes somebody want it. So the feature
 * exists and the interesting behaviour is the refusal.
 */
describe('hanging up to escape', () => {
  const safety = (
    over: Partial<(typeof DEFAULT_CONFIG)['automation']['safety']['hangUp']> = {}
  ) => ({
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
    safety: {
      ...DEFAULT_CONFIG.automation.safety,
      hangUp: {
        enabled: true,
        belowHealth: 0.3,
        // The charged realm, which is where the refusals below live.
        penalties: true,
        onPlayerInRoom: false,
        ...over
      }
    }
  });

  /*
   * A maximum, then a status line low enough to trip it.
   *
   * `health` is the one command that reports current and maximum together, so
   * it is the cheapest way to give the tracker a maximum — and without one the
   * fraction is unknown and nothing may fire, which is itself a case below.
   */
  const knowMaximum = (socket: net.Socket): void => {
    socket.write('Health: 100/100 [100%]\r\n');
  };
  const hurt = async (socket: net.Socket): Promise<void> => {
    knowMaximum(socket);
    socket.write('[HP=100]:\r\n');
    // The fall has to arrive as a *change*, so the healthy line lands first.
    await until(() => manager!.character.vitals.hp === 100);
    socket.write('[HP=10]:\r\n');
  };

  /* Unknown is not zero: a maximum that has not arrived must never trip this. */
  it('does not hang up on a health figure with no maximum behind it', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, safety());
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=10]:\r\n');

    await settled(10);
    expect(notices.some((notice) => /Hanging up/.test(notice))).toBe(false);
    expect(manager?.state.phase).toBe('connected');
  });

  it('does nothing at all while it is switched off', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, safety({ enabled: false }));
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    await hurt(await client());

    await settled(10);
    expect(notices.some((notice) => /anging up/.test(notice))).toBe(false);
    expect(manager?.state.phase).toBe('connected');
  });

  /* The master switch outranks it: with automation off, nothing automated acts. */
  it('does nothing while automation as a whole is off', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, { ...safety(), enabled: false });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    await hurt(await client());

    await settled(10);
    expect(notices.some((notice) => /anging up/.test(notice))).toBe(false);
  });
});

/*
 * Running away is the escape that works: walking out breaks combat and carries
 * none of the penalty an unclean disconnect does, which is exactly why the
 * hangup refusal tells you to do this instead.
 *
 * **What it sends is a direction, and these tests assert the direction.** They
 * used to assert the word `flee`, and passed for four phases while the server
 * answered every one of them `Your command had no effect.` — a test that
 * watches for a token rather than for an effect grades the client on its
 * intentions. Each of these now gives the character a room with exits in it,
 * because a room is where a way out comes from.
 */
describe('running away', () => {
  const escaping = (
    over: Partial<(typeof DEFAULT_CONFIG)['automation']['safety']['retreat']> = {}
  ) => ({
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
    safety: {
      ...DEFAULT_CONFIG.automation.safety,
      retreat: {
        ...DEFAULT_CONFIG.automation.safety.retreat,
        enabled: true,
        belowHealth: 0.3,
        whenOutnumbered: 0,
        cooldownMs: 3000,
        ...over
      } as RetreatConfig
    }
  });

  /**
   * Any sentence the escape says when it acts, and the one it says when it
   * cannot. One matcher, so a test asserting *nothing happened* cannot pass
   * because the wording moved to a different rung.
   */
  const RAN = /Running \w+:|Retreating \w+,|Not running:/;

  /** A room with two ways out of it, which is what an escape needs. */
  const ROOM = 'Rat Cellar\r\nObvious exits: north, south\r\n';

  /* An escape out of combat is a wasted move that puts the character in a room
     it did not choose. */
  it('does not run when nothing is fighting it', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, escaping());
    underWay(manager);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('Health: 100/100 [100%]\r\n');
    socket.write(ROOM);
    socket.write('[HP=10]:\r\n');

    await settled(10);
    expect(notices.some((notice) => RAN.test(notice))).toBe(false);
  });

  it('does not run above the threshold', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, escaping());
    underWay(manager);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('Health: 100/100 [100%]\r\n');
    socket.write(ROOM);
    socket.write('*Combat Engaged*\r\n');
    await until(() => manager!.character.inCombat);
    socket.write('[HP=90]:\r\n');

    await settled(90);
    expect(notices.some((notice) => RAN.test(notice))).toBe(false);
  });

  /* MegaMUD's ManaRun%: a caster with an empty pool is losing whatever the
     health bar says. The prompt states both figures, and the mana one is the
     trigger here — the health stays full throughout. */

  it('does not count one attacker as being outnumbered', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, escaping({ whenOutnumbered: 2 }));
    underWay(manager);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('Health: 100/100 [100%]\r\n');
    socket.write(ROOM);
    socket.write('*Combat Engaged*\r\n');
    socket.write('The orc rogue slashes you for 1 damage!\r\n');
    await until(() => manager!.character.combat.blows > 0);
    socket.write('[HP=98]:\r\n');

    await settled(98);
    expect(notices.some((notice) => RAN.test(notice))).toBe(false);
  });

  /* And an escape, which does produce a command, is still recorded as a
     decision: the command says what was sent, and this says why — and, since
     there are four ways to know an exit, which of them answered. */

  it('does nothing while it is switched off', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, escaping({ enabled: false }));
    underWay(manager);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('Health: 100/100 [100%]\r\n');
    socket.write(ROOM);
    socket.write('*Combat Engaged*\r\n');
    await until(() => manager!.character.inCombat);
    socket.write('[HP=10]:\r\n');

    await settled(10);
    expect(notices.some((notice) => RAN.test(notice))).toBe(false);
  });
});

/*
 * The client's own status line in the prompt's place (`ui.statline`): read
 * off the prompt as it arrives, drawn over exactly the prompt's bytes, and
 * refused out loud when it would not fit the row.
 */
describe('the status line the player designed', () => {
  const design: RewriteDesign = {
    name: 'Mine',
    entity: 'statline',
    enabled: true,
    template: 'HP {hp}/{hpMax}{state}'
  };
  const rewrites = (statline: RewriteDesign): RewritesUiConfig => ({
    bands: { hp: [], mana: [] },
    designs: [statline]
  });
  const PROMPT = '\x1b[1;32m[HP=100/150,MA=50/50 (Resting) ]:\x1b[0m';

  it('draws it over the prompt the moment the prompt arrives', async () => {
    const painted: string[] = [];
    const { sink } = collect();
    manager = new SessionManager({ ...sink, data: (chunk) => painted.push(chunk.text) });
    manager.configure(DEFAULT_CONFIG.automation, DEFAULT_CONFIG.connection.login, rewrites(design));
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write(PROMPT);
    await until(() => manager!.character.vitals.hp === 100);
    const shown = painted.join('');
    expect(shown).toContain('HP 100/150 (Resting)');
    expect(shown).not.toContain('[HP=100/150');
  });

  it("refuses one wider than the row, once, and draws the realm's own", async () => {
    const painted: string[] = [];
    const { sink, notices } = collect();
    manager = new SessionManager({ ...sink, data: (chunk) => painted.push(chunk.text) });
    manager.configure(
      DEFAULT_CONFIG.automation,
      DEFAULT_CONFIG.connection.login,
      rewrites({ ...design, template: `${'x'.repeat(80)}{hp}` })
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write(PROMPT);
    /*
     * Waited on the **paint**, not on the vitals.
     *
     * The two arrive by different paths and the paint is the later one: a
     * prompt still arriving is held (`PARTIAL_DELAY_MS`) while the tracker has
     * already read the figures off it, so `hp === 100` says nothing about
     * whether the row has been written yet. Under a loaded suite this failed
     * about one run in three, on the assertion below rather than on the one it
     * was really about.
     */
    await until(() => painted.join('').includes('[HP=100/150'));
    /*
     * Matched on the sentence, not on the bare figure.
     *
     * 83 is the width the design comes to — and it is also two digits that
     * turn up inside the ephemeral port the kernel handed this test's server,
     * which `connecting` and `connected` both print. A filter on `'83'` alone
     * counted those two notices as refusals on roughly one run in four, and
     * which run failed was decided by the port allocator rather than by
     * anything the client did.
     */
    expect(notices.filter((notice) => notice.includes('83 cells'))).toHaveLength(1);
  });
});

/*
 * A listing the client draws itself (`ui.rewrites`): the pack's lines are
 * withheld and the table drawn at the prompt that ends them, with the equip
 * gate's glyph beside each row.
 */
describe('a listing the player has the client draw', () => {
  it('draws the pack as a table in place of the listing, at the prompt', async () => {
    const painted: StreamChunk[] = [];
    const { sink } = collect();
    manager = new SessionManager({ ...sink, data: (chunk) => painted.push(chunk) });
    // Automation off: its own `rm` on arrival opens a quiet window this host
    // never answers, and a listing inside one is withheld as that answer.
    manager.configure(
      { ...DEFAULT_CONFIG.automation, enabled: false },
      DEFAULT_CONFIG.connection.login,
      {
        ...DEFAULT_CONFIG.ui.rewrites,
        designs: DEFAULT_CONFIG.ui.rewrites.designs.map((design) =>
          design.entity === 'inventory' ? { ...design, enabled: true } : design
        )
      }
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=148/MA=5]:' + PROMPT_REPAINT);
    await until(() => manager!.character.vitals.hp === 148);
    socket.write(
      'i\r\n' +
        'You are carrying rope and grapple, 6 torch.\r\n' +
        'You have the following keys: bone key.\r\n' +
        'Wealth: 47000 copper farthings\r\n' +
        'Encumbrance: 1744/4128 - Medium [42%]\r\n' +
        '[HP=148/MA=5]:'
    );
    await until(() => manager!.character.inventory.keys.length === 1);
    await until(() => painted.some((chunk) => chunk.text.includes('Keys:')));
    const shown = painted.map((chunk) => chunk.text).join('');
    const plain = shown.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).not.toContain('You are carrying');
    expect(plain).toContain('Keys: bone key');
    expect(plain).toContain('4 platinum, 70 gold');
    expect(plain).toContain('6 torch');
    // The header names the columns; the rows line up under them.
    expect(plain).toMatch(/Item\s+Wt/);
    expect(plain.indexOf('Keys:')).toBeGreaterThan(plain.indexOf('6 torch'));
    expect(plain.lastIndexOf('[HP=148/MA=5]:')).toBeGreaterThan(plain.indexOf('Keys:'));
    // Every carried thing carries the pack card's control, sent as the realm's verb.
    const marks = painted.flatMap((chunk) => chunk.marks ?? []);
    const actions = marks.flatMap((entry) => entry.mark.inline ?? []).filter((g) => g.commands);
    expect(actions.map((g) => g.commands?.[0])).toEqual(['wear rope and grapple', 'wear torch']);
  });
});

describe('a quiet command asked from a card', () => {
  /* The engine's pending list takes a command once (`0x48ab80`): a repeat of a
     question still waiting is not sent, and the palette is told so. */
  it('reports a repeat of a question still waiting as not sent', async () => {
    const { sink } = collect();
    manager = new SessionManager(sink);
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');
    // In the game, so what is queued waits on the engine's pending list.
    (manager as unknown as { mega: MegaEngine }).mega.s.inGame = 1;
    expect(manager.askRemote('Soul', 'health')).toBe(true);
    expect(manager.askRemote('Soul', 'health')).toBe(false);
  });

  /* A card's own probe goes the same way: our queue refused it while the
     engine ran the character, so the Gang card's refresh, the Party card's
     Leave and the pack's Put on were all dropped unsaid (2026-10-16). */
  it('puts a card probe on the engine pending list, once', async () => {
    const { sink } = collect();
    manager = new SessionManager(sink);
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');
    const mega = (manager as unknown as { mega: MegaEngine }).mega;
    mega.s.inGame = 1;
    expect(manager.ask('follow Soul')).toBe(true);
    expect(mega.s.pending.some((p) => p.text === 'follow Soul\r')).toBe(true);
    expect(manager.ask('follow Soul')).toBe(false);
  });
});

/**
 * The three-room world the retreat and death tests place a character in: the
 * lair at 1/3, the road at 1/2 and the haven at 1/1, in a line.
 */
function haven(): WorldGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-haven-'));
  const file = path.join(dir, 'rooms.jsonl.gz');
  const rooms = [
    { m: 1, r: 1, n: 'Haven Hall', x: { n: { m: 1, r: 2 } } },
    { m: 1, r: 2, n: 'Middle Road', x: { s: { m: 1, r: 1 }, n: { m: 1, r: 3 } } },
    // `d` is a text exit: walked as `go manhole`, never as `d` (todo 105).
    {
      m: 1,
      r: 3,
      n: 'Rat Lair',
      x: { s: { m: 1, r: 2 }, d: { m: 1, r: 4, i: 'Text: go manhole, go man, enter manhole' } }
    },
    { m: 1, r: 4, n: 'Sewer', x: { u: { m: 1, r: 3 } } }
  ];
  fs.writeFileSync(
    file,
    zlib.gzipSync(
      [
        JSON.stringify({ v: 1, source: 'test', rooms: 4, generatedAt: 'x' }),
        ...rooms.map((r) => JSON.stringify(r))
      ].join('\n') + '\n'
    )
  );
  const world = WorldGraph.load(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return world;
}

/*
 * The counters the realm's own gates are written on, asked when a plan first
 * crosses one. A room script names its landing per branch — `9/1291`'s `go
 * portal` names `9/1424` on `checkability 133 5` and no room at all below it —
 * so a character the gate refuses lands somewhere the plan never named. The
 * router refuses such an edge once the counters are read; this is the ask that
 * gets them, and it is off the **plan** rather than the way in, because a
 * complete listing settles every counter and takes the quest book's own nodes
 * away from the player.
 */
describe('asking for the quest counters', () => {
  /** Two rooms joined by a corridor, and two joined by a gated portal. */
  function gatedWorld(): WorldGraph {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-gated-'));
    const file = path.join(dir, 'rooms.jsonl.gz');
    const rooms = [
      { m: 1, r: 1, n: 'Shore', x: { e: { m: 1, r: 2 } } },
      {
        m: 1,
        r: 2,
        n: 'Pool Edge',
        x: { w: { m: 1, r: 1 } },
        cmd: [{ say: ['go portal'], to: '2/1', need: ['checkability 133 5'] }]
      },
      { m: 2, r: 1, n: 'Far Cavern', x: {} }
    ];
    fs.writeFileSync(
      file,
      zlib.gzipSync(
        [
          JSON.stringify({ v: 1, source: 'test', rooms: 3, generatedAt: 'x' }),
          ...rooms.map((room) => JSON.stringify(room))
        ].join('\n') + '\n'
      )
    );
    const world = WorldGraph.load(file);
    fs.rmSync(dir, { recursive: true, force: true });
    return world;
  }

  const walking: AutomationConfig = {
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false }
  };

  /** In the realm at the Shore, with the world loaded. */
  async function ashore(world: WorldGraph): Promise<{ socket: net.Socket; wire: () => string }> {
    const { sink } = collect();
    manager = new SessionManager(sink, world, walking);
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
    socket.write('Location:            1,1\r\nShore\r\nObvious exits: east\r\n');
    await until(() => manager!.character.room.number === 1);
    // In the game, so what is queued waits on the engine's pending list.
    (manager as unknown as { mega: MegaEngine }).mega.s.inGame = 1;
    return { socket, wire: () => Buffer.concat(chunks).toString('latin1') };
  }

  /* What a capture replays from: the engine's settings, never its login (2026-10-17). */
  it('records the engine’s settings as it connects, without the login', async () => {
    const acts: SessionAct[] = [];
    const { sink } = collect();
    manager = new SessionManager({ ...sink, acted: (act) => acts.push(act) });
    const settings = defaultSettings();
    settings.live['BBS']!['UserID'] = 'archer';
    settings.live['BBS']!['Password'] = 'hunter2';
    manager.useMegaMud({ settings, data: { monsters: [], items: [], spells: [] }, grants: {} });
    expect(acts).toEqual([]);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const recorded = acts.find((act) => act.act === 'megamud');
    expect(recorded).toBeDefined();
    expect(JSON.stringify(recorded)).not.toContain('hunter2');
    expect(
      recorded?.act === 'megamud' && recorded.settings.live['BBS']?.['UserID']
    ).toBeUndefined();
    manager.stopMoving();
    expect(acts.at(-1)).toEqual({ act: 'stopMoving' });
  });

  /* Fatty's typed `u` read as a step sent the post-rest ahead of its Enter (2026-10-16). */
  it('sends what the engine writes on reading a typed line behind that line', async () => {
    const { wire } = await ashore(gatedWorld());
    const s = (manager as unknown as { mega: MegaEngine }).mega.s;
    s.Health_PostRestCmd = 'eq firestone pendant';
    s.Health_PrePostRest = 1;
    s.owedPostRest = 1;
    manager!.send('e');
    manager!.send('\r');
    await until(() => wire().includes('pendant'));
    expect(wire()).toContain('e\r\neq firestone pendant\r\n');
  });

  /* The engine's pending list rather than the wire: the plan raised the question. */
  const asked = (): boolean =>
    (manager as unknown as { mega: MegaEngine }).mega.s.pending.some((p) => p.text === 'abil\r');

  it('asks when a plan crosses a gate written on one', async () => {
    const world = gatedWorld();
    await ashore(world);
    expect(asked()).toBe(false);

    expect(manager!.walkRoute(world.route('1/1', '2/1'))).toBeNull();
    expect(asked()).toBe(true);
  });

  /* A way with nothing on it the counters could answer asks nothing. */
  it('asks nothing for a plain corridor', async () => {
    const world = gatedWorld();
    await ashore(world);

    expect(manager!.walkRoute(world.route('1/1', '1/2'))).toBeNull();
    await settled(100);
    expect(asked()).toBe(false);
  });
});

/*
 * The plan to a step is priced from where the character stands, and a later
 * ask supersedes one still pricing.
 *
 * The card asks again at every room and every pack change, so the chain an
 * earlier ask started stops at its next leg rather than spending nine A*s on
 * the socket's thread for an answer the card will drop.
 */
describe('the plan to a step', () => {
  /**
   * Two rooms and one quest whose only step is an ask in the second — or,
   * `buying`, one that takes a waterskin the counter in the first sells.
   */
  function questWorld(buying = false): WorldGraph {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-plan-'));
    const file = path.join(dir, 'rooms.jsonl.gz');
    const header = JSON.stringify({
      v: buying ? 47 : 25,
      source: 'test',
      rooms: 2,
      generatedAt: 'x',
      ...(buying
        ? {
            items: [{ id: 283, n: 'waterskin', price: 25, cur: 1 }],
            shops: [{ id: 3, n: 'General Store', items: [283], markup: 100 }]
          }
        : {}),
      quests: [
        {
          id: 134,
          name: 'TestQuest',
          steps: [
            {
              block: 1,
              who: 'Sage',
              room: '1/2',
              say: ['hello'],
              needs: [],
              takes: buying ? [{ id: 283, name: 'waterskin' }] : [],
              gives: [],
              to: 1
            }
          ]
        }
      ]
    });
    const rooms = [
      { m: 1, r: 1, n: 'Shore', x: { e: { m: 1, r: 2 } }, ...(buying ? { s: 3 } : {}) },
      { m: 1, r: 2, n: 'Middle Road', x: { w: { m: 1, r: 1 } } }
    ];
    fs.writeFileSync(
      file,
      zlib.gzipSync([header, ...rooms.map((room) => JSON.stringify(room))].join('\n') + '\n')
    );
    const world = WorldGraph.load(file);
    fs.rmSync(dir, { recursive: true, force: true });
    return world;
  }

  const still: AutomationConfig = {
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false }
  };

  /** Connects and places the character on the shore. */
  async function placed(buying = false): Promise<void> {
    const { sink } = collect();
    manager = new SessionManager(sink, questWorld(buying), still);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
    socket.write('Location:            1,1\r\nShore\r\nObvious exits: east\r\n');
    await until(() => manager!.character.room.number === 1);
  }

  it('prices the step from where the character stands', async () => {
    await placed();
    const plan = await manager!.questPlan(1, null);
    expect(plan?.from).toBe('1/1');
    expect(plan?.steps[0]?.moves).toBe(1);
  });

  // Todo 00: the counter's price on the row, and the whole set against the purse.
  it('prices what it buys, and calls an unread purse unread rather than short', async () => {
    await placed(true);
    const plan = await manager!.questPlan(1, null);
    const source = plan?.steps[0]?.items[0]?.source;
    expect(source).toMatchObject({ how: 'buy', copper: 500 });
    // Charm unread, so priced at its floor: ten percent on.
    expect(plan?.cash).toEqual({ owed: 550, unpriced: 0, purse: null, short: false });
  });

  it('answers null to an ask a later one superseded', async () => {
    await placed();
    const first = manager!.questPlan(1, null);
    const second = manager!.questPlan(1, null);
    expect(await first).toBeNull();
    expect((await second)?.from).toBe('1/1');
  });
});

/*
 * `flee`'s own second, more desperate escape — a fixed `sys goto` in place of
 * `retreat.strategy`'s own afterward, and only where the realm's own `locate`
 * setting says `sys goto` is a command it actually has.
 */
describe('fleeing outright', () => {
  const fleeing = (
    over: Partial<(typeof DEFAULT_CONFIG)['automation']['safety']['fleeGoto']> = {}
  ): AutomationConfig => ({
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
    safety: {
      ...DEFAULT_CONFIG.automation.safety,
      fleeGoto: {
        ...DEFAULT_CONFIG.automation.safety.fleeGoto,
        enabled: true,
        belowHealth: 0.2,
        destination: 'sil',
        ...over
      }
    }
  });
  const wire = (socket: net.Socket): (() => string) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    return () => Buffer.concat(chunks).toString('latin1');
  };

  it('never sends sys goto on a realm that has not answered sys status', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink);
    // Locate left at its default, `rm` — the one fact `fleeGoto` checks besides
    // its own switch and threshold, since `sys goto` is only ever a command on
    // a `sys-status` realm.
    manager.configure(fleeing(), DEFAULT_CONFIG.connection.login);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    const seen = wire(socket);
    socket.write('Health: 100/100 [100%]\r\n');
    socket.write('Rat Cellar\r\nObvious exits: north, south\r\n');
    socket.write('*Combat Engaged*\r\n');
    await until(() => manager!.character.inCombat);
    socket.write('[HP=15]:\r\n');

    await settled(15);
    // Neither half fired: no break-off move and certainly no `sys goto`.
    expect(seen()).not.toMatch(/\b[nsew]\r\n/);
    expect(notices.some((notice) => /Running \w+:|Fleeing to/.test(notice))).toBe(false);
  });

  it('never fires with no destination configured', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink);
    manager.configure(
      fleeing({ destination: '' }),
      DEFAULT_CONFIG.connection.login,
      DEFAULT_CONFIG.ui.rewrites,
      'sys-status'
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    const seen = wire(socket);
    socket.write('Health: 100/100 [100%]\r\n');
    socket.write('Rat Cellar\r\nObvious exits: north, south\r\n');
    socket.write('*Combat Engaged*\r\n');
    await until(() => manager!.character.inCombat);
    socket.write('[HP=15]:\r\n');

    await settled(15);
    expect(seen()).not.toMatch(/\b[nsew]\r\n/);
    expect(notices.some((notice) => /Running \w+:|Fleeing to/.test(notice))).toBe(false);
  });
});

/*
 * An escape *holds* the lap, and then the character is finally allowed to sit
 * down.
 *
 * Diagnosed from the user's own capture
 * (`logs/2026-09-02_09-58-25_festus.mudcap.jsonl`). The escape sent `e` out of
 * a room with a cave worm in it; two seconds after `*Combat Off*` the loop
 * planned its next leg and sent `w` — straight back in. Three round trips, 51
 * HP down to 15, and what ended it was the player typing a direction by hand.
 *
 * And the resting is the other half of the same fault. `mayRest` refuses while
 * a loop is *marching*, so the two seconds between the fight ending and the
 * loop walking off again were the whole window the character had to sit down
 * in — and it spent every one of them under the resting floor, marching.
 *
 * That was first answered by *stopping* the loop, which fixed the corridor and
 * broke the lap: observed on festus the same day, the escape and the rest were
 * both right and then the character simply stood in the corridor for good. A
 * lap ends when the player stops it, when the character dies, or when its
 * stops fail wholesale — never because automation worked. So it is a hold, and
 * a hold that lets go when the reason for it is over.
 */
describe("answering the realm's messages", () => {
  const answering: AutomationConfig = {
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false }
  };
  const wire = (socket: net.Socket): (() => string) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    return () => Buffer.concat(chunks).toString('latin1');
  };

  it('does not answer the same sentence when somebody gossips it', async () => {
    const { sink } = collect();
    manager = new SessionManager(sink);
    manager.configure(answering, DEFAULT_CONFIG.connection.login);
    manager.configureRealm({
      ...NO_REALM,
      messages: [
        { ...blankTrigger(), match: 'You suffer in the desert heat...', response: 'drink water' }
      ]
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    const seen = wire(socket);
    socket.write('Health: 100/100 [100%]\r\n');
    socket.write('Vex gossips: You suffer in the desert heat...\r\n');
    // A status line after it, so the gossip is known to have been read.
    socket.write('[HP=90]:\r\n');
    await settled(90);
    expect(manager.character.vitals.hp).toBe(90);
    expect(seen()).not.toMatch(/drink water/);
  });
});

/*
 * Two characters on one realm, in one client. What one sees somebody wearing
 * is what the other's flyout shows — live, with no restart and no second look.
 */

/*
 * Walking out to the character menu is a character *leaving*, and what comes
 * back through that menu may be somebody else — a reroll, or another
 * character on the same account. Found the expensive way (2026-08-31): a
 * character was rerolled and renamed, walked back in, and every card went on
 * naming the one before it, because nothing was forgotten and the realm-entry
 * probe had already fired for the connection and would not fire again.
 */
describe('leaving the realm for the menu', () => {
  const probing: AutomationConfig = {
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false }
  };

  it('says so, once', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, probing);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=34]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');
    socket.write('You will exit after a period of silent meditation.\r\n');
    socket.write('[PARADIGM]:');
    await until(() => notices.some((notice) => notice === t('session.realm.left')));
    expect(notices.filter((notice) => notice === t('session.realm.left'))).toHaveLength(1);
  });
});

describe('what the realm knows about a player, between characters', () => {
  it('shows one character what another saw somebody wearing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-players-'));
    const book = new PlayerBook({ file: path.join(dir, 'players.json'), saveDelayMs: 0 });
    const vaelor = collect();
    const rand = collect();
    const pushed: CharacterState[] = [];
    rand.sink.character = (state) => pushed.push(state);

    manager = new SessionManager(
      vaelor.sink,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      book.forRealm('test:1')
    );
    const other = new SessionManager(
      rand.sink,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      book.forRealm('test:1')
    );
    try {
      await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
      await other.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
      const socket = await client(0);
      socket.write(
        [
          '[ Soul Guardian ](Valor)',
          'He is equipped with:',
          '',
          'silk gloves                    (Hands)',
          '[HP=334/KAI=27]:',
          ''
        ].join('\r\n')
      );

      await until(() => other.character.players['soul']?.equipment != null);
      expect(other.character.players['soul']).toMatchObject({
        equipment: [{ name: 'silk gloves', slot: 'Hands' }],
        gang: 'Valor',
        // The book says what Soul wears, not whether Rand has seen them.
        online: false
      });
      // And the window with Rand's tab was told.
      expect(pushed.at(-1)?.players['soul']?.equipment).toEqual([
        { name: 'silk gloves', slot: 'Hands' }
      ]);

      // Written down, so a restart starts from it.
      book.flush();
      const written = JSON.parse(fs.readFileSync(path.join(dir, 'players.json'), 'utf8')) as {
        realms: Record<string, Record<string, { equipment: unknown }>>;
      };
      expect(written.realms['test-1']?.['soul']?.equipment).toEqual([
        { name: 'silk gloves', slot: 'Hands' }
      ]);
    } finally {
      other.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/*
 * skinny behind Fatty, 2026-09-25: rested because the leader had, and said
 * `@wait` on the step out of it, still reading `(Resting)` after Fatty climbed
 * away — `just left upwards` was read as a monster, so Fatty stayed resting
 * too. A follower asks its leader to stop for what would stop its own walk.
 */

/*
 * A leader's crossing of a `Text:` exit end to end, over a real socket (PR #35).
 * The hold itself is `Walker.test.ts`'s: `1/3 → 1/4` is a route's last step.
 */
describe('a party relay crossing a text exit', () => {
  // Lines, not raw text: `.@party go manhole` ends in the bytes of `go manhole`.
  const wire = (socket: net.Socket): (() => string[]) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    return () => Buffer.concat(chunks).toString('latin1').split('\r\n');
  };

  const relayConfig = (): AutomationConfig => ({
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    pacing: { window: 20, minGapMs: 0, ackTimeoutMs: 3000 }
  });

  /** The party listing: Vaelor (self, leading) and Pip, both frontrank. */
  const partyListing =
    [
      'The following people are in your travel party:',
      '  Vaelor                        (Mystic)     [M:100%] [H:100%]  - Frontrank',
      '  Pip                            (Warrior)             [H:100%]  - Frontrank',
      '[HP=100/MA=50]:'
    ].join('\r\n') + PROMPT_REPAINT;

  /** Connected at Rat Lair (1/3), leading Pip, who is standing there too. */
  async function atTheCrossing(world: WorldGraph, config: AutomationConfig): Promise<net.Socket> {
    manager = new SessionManager(collect().sink, world, config);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('Welcome back, Vaelor!\r\n');
    socket.write('Health: 100/100 [100%]\r\n');
    socket.write(
      'Location:            1,3\r\nRat Lair\r\nAlso here: Pip.\r\nObvious exits: south\r\n'
    );
    await until(() => manager!.character.room.number === 3);
    socket.write(partyListing);
    await until(() => manager!.character.party.members.length === 2);
    return socket;
  }

  it('does not relay or invite for a hand-typed crossing', async () => {
    const world = haven();
    const socket = await atTheCrossing(world, relayConfig());
    const lines = wire(socket);

    manager!.send('go manhole\r\n');
    await until(() => lines().includes('go manhole'));
    expect(lines().some((line) => line.includes('@party'))).toBe(false);
  });
});

/*
 * The reaction to a player opening on this character — MegaMUD's NotifyGang,
 * from the evidence the client already reads: `<Name> moves to attack you!`
 * puts the attacker in `attackers` and starts the five-minute clock, and the
 * pvp block is what acts on the same moment. The roster is what makes Vaelor
 * a player rather than a monster's realm-data name.
 */
describe('a player opening on this character', () => {
  const pvpConfig = (over: Partial<(typeof DEFAULT_CONFIG)['automation']['safety']['pvp']> = {}) =>
    ({
      ...DEFAULT_CONFIG.automation,
      enabled: true,
      idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
      safety: {
        ...DEFAULT_CONFIG.automation.safety,
        pvp: { notifyGang: false, action: 'none' as const, ...over }
      }
    }) as AutomationConfig;

  async function attacked(socket: net.Socket): Promise<void> {
    socket.write('[HP=62]:\r\n');
    await until(() => manager!.character.phase === 'in-game');
    // A room with a way out of it: the pvp reaction runs the same escape the
    // health floor does, and that escape sends a direction or nothing.
    socket.write('Town Square\r\nObvious exits: west\r\n');
    await until(() => manager!.character.room.exits.length > 0);
    socket.write('Vaelor just entered the Realm.\r\n');
    await until(() => manager!.character.online.some((who) => who.name === 'Vaelor'));
    socket.write('Vaelor moves to attack you!\r\n');
    await until(() => manager!.character.combat.attackers.length > 0);
  }

  it('does nothing at all while both halves are off', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, pvpConfig());
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    const received: Buffer[] = [];
    socket.on('data', (chunk) => received.push(chunk));

    await attacked(socket);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const wire = Buffer.concat(received).toString('latin1');
    expect(wire).not.toContain('bg ');
    expect(wire).not.toMatch(/\bw\r\n/);
    expect(notices.some((notice) => /Telling the gang|Running \w+:/.test(notice))).toBe(false);
  });
});

/**
 * The clock behind the modules that decide on a number and own none of their
 * own.
 *
 * Everything automated here hangs off a state change, and a state change needs
 * a status line — which a standing, idle character gets only when the server's
 * own regeneration moves a vital, once every thirty seconds. So a decision that
 * became right while the wire said nothing was not taken until the wire spoke,
 * or until the player pressed Enter. Measured 2026-09-02
 * (`logs/2026-09-02_09-08-19_festus.mudcap.jsonl`): a heal came off its
 * six-second cooldown at 97.6s and went out at 120.5s, on the player's own
 * keystroke — twenty-three seconds of *should have cast, did not*.
 *
 * A settings change is the same shape and the fastest way to state it: the
 * threshold that arrives is new, the character it applies to has not moved, and
 * nothing is coming from the server to notice it on.
 */
describe('re-deciding with nothing new from the wire', () => {
  const health = (restBelow: number): AutomationConfig => ({
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
    health: { ...DEFAULT_CONFIG.automation.health, restBelow }
  });

  /*
   * And not before the character is in the realm, where there is nothing to
   * decide about.
   *
   * The positive control is the phase reaching `authenticating`: `unknown` is
   * what a freshly connected session already is, so waiting for "not in-game"
   * would have passed just as well on a menu prompt the client never framed —
   * and the assertion below is an absence, which is exactly the shape that
   * needs the trigger to have been *observed*.
   *
   * Nothing feeds it a health figure first, deliberately: walking out to a menu
   * is a character *leaving*, so `noteRealmPhase` clears the vitals on the way
   * past and there is no number left for a threshold to act on either way. What
   * this states is that the tick does not run at a menu at all.
   */
  it('decides nothing at a login menu', async () => {
    const { sink } = collect();
    manager = new SessionManager(sink, undefined, health(0.5));
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.write('Please select a character: ');
    await until(() => manager!.character.phase === 'authenticating');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(Buffer.concat(chunks).toString('latin1')).not.toContain('rest\r\n');
  });
});

/**
 * Giving up on a step nothing answered, and everything that was waiting on it.
 *
 * Reported 2026-09-03 as a console reading *"A step went unanswered"* in the
 * middle of a walk whose rooms were arriving normally. The message was true —
 * a step really had been lost, somewhere back up the log — and the defect was
 * what happened next: `pendingMoves` falls only when a room or a refusal
 * answers the step, six things gate on it, and exactly one of them
 * (auto-combat) had a clock. So the client said one sentence, hit back again,
 * and left the character unable to run away, walk a route or run a loop for
 * the rest of the session with nothing further said.
 *
 * Driven end to end because that is where it lives: the claim is made on the
 * command path, the bound is in `Expectations`, and the recovery is read by
 * `Walker.start` — three files, none of which can see the failure alone.
 */
describe('a step the server never answers', () => {
  const life = 300;

  beforeEach(() => {
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      parse: { ...DEFAULT_INTERNAL.tuning.parse, staleMoveMs: life }
    });
  });
  afterEach(() => setTuning(DEFAULT_INTERNAL.tuning));

  /** In the realm, with one move sent and nothing coming back for it. */
  async function lostAStep(): Promise<{ socket: net.Socket; notices: string[] }> {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, {
      ...DEFAULT_CONFIG.automation,
      enabled: false
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('Guild Street\r\nObvious exits: north, south\r\n[HP=56/MA=12]:' + PROMPT_REPAINT);
    await until(() => manager!.character.room.name === 'Guild Street');

    manager.send('n\r');
    // The claim really was made, so what follows is a bound lapsing rather
    // than a command the tracker never saw.
    await until(() => manager!.character.room.name === 'Guild Street');
    return { socket, notices };
  }

  it('gives up on it, and says which step, once', async () => {
    const { socket, notices } = await lostAStep();

    // Nothing answers the move. The bound lapses on the next line off the wire,
    // because what the server owes this client is a fact about the wire.
    await new Promise((resolve) => setTimeout(resolve, life + 50));
    socket.write('[HP=56/MA=12]:' + PROMPT_REPAINT);
    await until(() => notices.some((notice) => notice.includes('“n”')));

    const said = notices.filter((notice) => notice.includes('“n”'));
    expect(said).toHaveLength(1);
    // Said in whole seconds off the tuning key rather than as a bare number.
    expect(said[0]).toMatch(/0s/);
  });

  /* And a step that *is* answered costs nothing: the claim goes when the room
     comes, and no notice is raised. */
  it('says nothing at all when the room arrives', async () => {
    const { socket, notices } = await lostAStep();
    socket.write(
      'Guild Street\r\nObvious exits: north, south, east\r\n[HP=56/MA=12]:' + PROMPT_REPAINT
    );
    await until(() => manager!.character.room.exits.length === 3);
    await new Promise((resolve) => setTimeout(resolve, life + 50));
    socket.write('[HP=56/MA=12]:' + PROMPT_REPAINT);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(notices.filter((notice) => notice.includes('given up waiting'))).toEqual([]);
  });
});

/*
 * A word this realm does not have, learned from the realm saying it out loud.
 *
 * `You say "<command>"` is this server family's answer to a word its dispatch
 * table has no entry for — speech in the room, seen by everybody standing
 * there. It used to retire `rm` and nothing else, so every other word the
 * realm spoke aloud was asked again on the next tick and said again.
 */
describe('a command this realm has no word for', () => {
  const dial = () => ({ host: '127.0.0.1', port, encoding: 'cp437' as const });

  /*
   * How the MajorMUD lineage actually refuses it — measured on
   * bbs.bearfather.net 2026-09-05, where `rm` came back `Your command had no
   * effect.` privately rather than being spoken in the room. The sentence
   * names nothing, so the word is the status line's own echo.
   */
  it('learns it from MajorMUD’s quiet refusal, off the status line’s echo', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink);
    await manager.connect(dial());
    const socket = await client();
    socket.write('[HP=40/MA=7]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');

    socket.write('[HP=40/MA=7]:rm' + PROMPT_REPAINT);
    socket.write('Your command had no effect.\r\n');
    await until(() => notices.includes(t('session.loop.locateUnavailable', { command: 'rm' })));

    // And that is the lineage as well, so `ab` is never tried either.
    expect(manager.queue.enqueue({ command: 'ab', priority: 'probe' })).toBe(false);
    // `pro` is not on the list — MajorMUD answers it, it just carries no
    // coordinates — so it is left alone.
    expect(manager.queue.enqueue({ command: 'pro', priority: 'probe' })).toBe(true);

    /*
     * The limit that makes it safe: the same sentence answers a word the realm
     * *does* have that did nothing — `med` for a class with no mana — so it
     * must not retire an arbitrary command the way a spoken refusal can.
     */
    socket.write('[HP=40/MA=7]:sea' + PROMPT_REPAINT);
    socket.write('Your command had no effect.\r\n');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(manager.queue.enqueue({ command: 'sea', priority: 'probe' })).toBe(true);
  });

  /*
   * A command confusion threw away — todo 02, reported 2026-09-06.
   *
   * `ActionFigure.CheckConfusion` discards whatever was sent at the top of
   * `Player.HandleCommand`, so nothing ran. Two facts follow and both are
   * driven from the echo, because the sentence names nothing: no room is
   * coming, and the decision that produced the command still holds. In the
   * report a loop's `e` was fumbled, nothing re-sent it, and the walk waited
   * out its eight-second deadline and gave up.
   */
  it('sends an automated command again when the realm throws it away', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink);
    await manager.connect(dial());
    const socket = await client();
    socket.write('[HP=134/MA=24]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');

    const written: string[] = [];
    socket.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));
    manager.queue.enqueue({ command: 'e', priority: 'movement' });
    await until(() => written.join('').includes('e'));

    socket.write('[HP=134/MA=24]:e' + PROMPT_REPAINT);
    socket.write('You fumble in confusion!\r\n');
    await until(() => notices.includes(t('automation.queue.fumbledResend', { command: 'e' })));

    /*
     * And sent again once the server's own fumble delay has passed. The
     * prompts are what release the acknowledgement credit the entry probe is
     * holding, exactly as they do in a real session.
     */
    for (let tick = 0; tick < 8; tick += 1) {
      socket.write('[HP=134/MA=24]:' + PROMPT_REPAINT);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(written.filter((chunk) => chunk.trim() === 'e')).toHaveLength(2);
  });

  /*
   * Not a person's own typing. The queue never sees it, and the echo is what
   * says which of the two the fumbled command was.
   */
  it('does not replay an automated command when the player’s own was fumbled', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink);
    await manager.connect(dial());
    const socket = await client();
    socket.write('[HP=134/MA=24]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');

    manager.queue.enqueue({ command: 'e', priority: 'movement' });
    await new Promise((resolve) => setTimeout(resolve, 25));

    socket.write('[HP=134/MA=24]:bank' + PROMPT_REPAINT);
    socket.write('You fumble in confusion!\r\n');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(notices.some((line) => line.includes('threw away'))).toBe(false);
  });
});

/*
 * The realm setting that says which word asks *where am I*, or whether to ask
 * at all — and, load-bearingly, that the setting is not just consulted by the
 * walker-desync path but actually changes what the shipped `onEnterRealm`
 * list sends: that list spells the entry probe `rm` because Paradigm is what
 * it ships for, and a realm configured away from `rm` must not have the
 * literal word tried on arrival just because the list still says so.
 */
describe('the locate setting', () => {
  const dial = () => ({ host: '127.0.0.1', port, encoding: 'cp437' as const });

  /*
   * The Room card's own locate button, addressed by `Invoke.locate` rather
   * than the generic `ask` — see `ipc.ts`: which word is the realm's setting,
   * so the card asks main to send *a* locate word rather than naming one.
   */
  it("sends the button's own probe in whichever word is configured", async () => {
    const { sink } = collect();
    manager = new SessionManager(sink);
    manager.configure(
      { ...DEFAULT_CONFIG.automation },
      DEFAULT_CONFIG.connection.login,
      DEFAULT_CONFIG.ui.rewrites,
      'sys-status'
    );
    await manager.connect(dial());
    const socket = await client();
    const received: Buffer[] = [];
    socket.on('data', (chunk) => received.push(chunk));
    socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');

    expect(manager.askWhereIAm()).toBe(true);
    await until(() => /(^|\n)sys status\r\n/.test(Buffer.concat(received).toString('latin1')));
  });

  it('asks nothing, and says so by refusing, when configured to none', async () => {
    const { sink } = collect();
    manager = new SessionManager(sink);
    manager.configure(
      { ...DEFAULT_CONFIG.automation },
      DEFAULT_CONFIG.connection.login,
      DEFAULT_CONFIG.ui.rewrites,
      'none'
    );
    await manager.connect(dial());
    const socket = await client();
    socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');

    expect(manager.askWhereIAm()).toBe(false);
  });

  /*
   * `ensureLocated` — what a Goto pick or a Loop's play button spends before
   * `planFromHere` gets a chance to refuse an ambiguous room outright.
   */
  describe('resolving an ambiguous room before something plans from it', () => {
    it('returns at once when the room is already known', async () => {
      const { sink } = collect();
      manager = new SessionManager(sink);
      manager.configure(
        { ...DEFAULT_CONFIG.automation },
        DEFAULT_CONFIG.connection.login,
        DEFAULT_CONFIG.ui.rewrites,
        'sys-status'
      );
      await manager.connect(dial());
      const socket = await client();
      socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT + 'Room 796  Map: 16\r\n');
      await until(() => manager!.character.room.map === 16);

      const started = Date.now();
      expect(await manager.ensureLocated(3000)).toBe(true);
      // Not a real wait: nothing was sent for it to wait on.
      expect(Date.now() - started).toBeLessThan(150);
    });

    it('asks the realm and resolves once the configured word answers', async () => {
      const { sink } = collect();
      manager = new SessionManager(sink);
      manager.configure(
        { ...DEFAULT_CONFIG.automation },
        DEFAULT_CONFIG.connection.login,
        DEFAULT_CONFIG.ui.rewrites,
        'sys-status'
      );
      await manager.connect(dial());
      const socket = await client();
      // In the realm, but no room has printed yet -- the ordinary shape of
      // "ambiguous": nothing here says where the character is standing.
      socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
      await until(() => manager!.character.phase === 'in-game');
      expect(manager.character.room.map).toBeNull();

      const waited = manager.ensureLocated(3000);
      socket.write('Room 796  Map: 16\r\n');
      expect(await waited).toBe(true);
      expect(manager.character.room.map).toBe(16);
      expect(manager.character.room.number).toBe(796);
    });

    it('gives up and returns false once the timeout passes', async () => {
      const { sink } = collect();
      manager = new SessionManager(sink);
      manager.configure(
        { ...DEFAULT_CONFIG.automation },
        DEFAULT_CONFIG.connection.login,
        DEFAULT_CONFIG.ui.rewrites,
        'sys-status'
      );
      await manager.connect(dial());
      const socket = await client();
      socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
      await until(() => manager!.character.phase === 'in-game');

      expect(await manager.ensureLocated(300)).toBe(false);
    });

    it('returns false at once when there is nothing to ask', async () => {
      const { sink } = collect();
      manager = new SessionManager(sink);
      manager.configure(
        { ...DEFAULT_CONFIG.automation },
        DEFAULT_CONFIG.connection.login,
        DEFAULT_CONFIG.ui.rewrites,
        'none'
      );
      await manager.connect(dial());
      const socket = await client();
      socket.write('[HP=100/MA=50]:' + PROMPT_REPAINT);
      await until(() => manager!.character.phase === 'in-game');

      const started = Date.now();
      expect(await manager.ensureLocated(3000)).toBe(false);
      // The realm has nothing to ask, so this must not spend the timeout.
      expect(Date.now() - started).toBeLessThan(150);
    });
  });
});

/*
 * What this character costs to move, as the router prices it — todo 00,
 * 2026-09-06.
 *
 * The whole of that todo is the router learning to read seven conditions, and
 * every one of them is worthless if the facts never arrive: a price computed
 * against `raceId: undefined` is the flat discouragement it replaced, and it
 * would look identical in `WorldGraph`'s own tests, which hand the traveller
 * in. `travellerNow` is the join, and until now nothing exercised it — the
 * class join shipped with todo 03 untested at this level for the same reason.
 *
 * So this drives the four facts in over the wire, in the blocks the server
 * actually prints them in, and asks the manager for the traveller.
 */
describe('what this character costs to move', () => {
  /**
   * One room, and the tables the joins read: the `Races` and `Classes` rows a
   * stat sheet's words resolve against, and the two item rows a pack's names
   * do.
   */
  const tabled = (): WorldGraph => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-traveller-'));
    const file = path.join(dir, 'rooms.jsonl.gz');
    fs.writeFileSync(
      file,
      zlib.gzipSync(
        [
          JSON.stringify({
            v: 23,
            source: 'test',
            rooms: 1,
            generatedAt: 'x',
            races: [{ id: 13, n: 'Kang' }],
            classes: [{ id: 3, n: 'Paladin' }],
            items: [
              { id: 191, n: 'rope and grapple' },
              { id: 1124, n: 'bone key' }
            ]
          }),
          JSON.stringify({ m: 1, r: 1, n: 'Only Room', x: {} })
        ].join('\n') + '\n'
      )
    );
    const world = WorldGraph.load(file);
    fs.rmSync(dir, { recursive: true, force: true });
    return world;
  };

  it('joins the sheet, the roster and the pack to what the router prices', async () => {
    const world = tabled();
    const { sink } = collect();
    manager = new SessionManager(sink, world, {
      ...DEFAULT_CONFIG.automation,
      enabled: false
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=148/MA=5]:' + PROMPT_REPAINT);

    // The sheet, which names the class and the race in the realm's own words.
    socket.write(
      'Name: Festus Marcus                    Lives/CP:      9/1\r\n' +
        'Race: Kang        Exp: 792666          Perception:     62\r\n' +
        'Class: Paladin    Level: 10            Stealth:         0\r\n' +
        'Hits:   148/148   Armour Class:  46/5  Thievery:        0\r\n' +
        'Mana:     5/26    Spellcasting: 66     Traps:           0\r\n'
    );
    // The status line is what closes a block, exactly as it does on the wire.
    socket.write('[HP=148/MA=5]:' + PROMPT_REPAINT);
    await until(() => manager!.character.race === 'Kang');

    // The pack, and the keys, which the server prints as two listings.
    socket.write(
      'You are carrying rope and grapple, 6 torch.\r\n' +
        'You have the following keys: bone key.\r\n' +
        'Wealth: 47000 copper farthings\r\n' +
        'Encumbrance: 1744/4128 - Medium [42%]\r\n'
    );
    socket.write('[HP=148/MA=5]:' + PROMPT_REPAINT);
    await until(() => manager!.character.inventory.keys.length === 1);

    // The roster, which is the only place the character's own standing appears.
    socket.write(
      '         Current Adventurers\r\n' +
        '         ===================\r\n' +
        '\r\n' +
        '    Good Festus Marcus         -  Squire \r\n'
    );
    socket.write('[HP=148/MA=5]:' + PROMPT_REPAINT);
    await until(() => manager!.character.online.length > 0);

    const traveller = manager.travellerNow(manager.character);
    expect(traveller.classId).toBe(3);
    expect(traveller.raceId).toBe(13);
    expect(traveller.alignment).toBe('Good');
    // Both listings, and only the names this realm can place: `6 torch` is not
    // in its item table and says nothing rather than guessing a row.
    expect(traveller.keys?.slice().sort((a, b) => a - b)).toEqual([191, 1124]);
    // And that the list is an answer rather than a silence, which is what lets
    // the router treat a missing item as a wall.
    expect(traveller.packKnown).toBe(true);
    expect(manager.character.inventory.listedAt).not.toBeNull();
  });

  /*
   * And the negative, which is the state every session starts in: nothing has
   * been read, so every one of them is *nobody has said* — which the router
   * discourages and never prunes.
   */
  it('says nothing about a character nothing has been read for', async () => {
    const world = tabled();
    const { sink } = collect();
    manager = new SessionManager(sink, world, {
      ...DEFAULT_CONFIG.automation,
      enabled: false
    });
    const traveller = manager.travellerNow(manager.character);
    expect(traveller.classId).toBeNull();
    expect(traveller.raceId).toBeNull();
    expect(traveller.alignment).toBeNull();
    expect(traveller.keys).toEqual([]);
    /*
     * And the empty pack is a **silence**, not a claim. This is the state every
     * session starts in, and it is the one an `items: []` alone cannot tell
     * from a character genuinely carrying nothing — get it backwards and the
     * 157 exits gated on a rope shut against everybody who has never typed `i`.
     */
    expect(traveller.packKnown).toBe(false);
  });

  /*
   * And which of the two door skills the walker will spend: it picks only
   * under Auto-Pick Locks and bashes only under Auto-Bash Doors, so a route
   * planned on a switched-off skill walks up to a door and stops there. The
   * lap's traveller is the same statement, so a leg is priced alike.
   */
  it('tells the router which door skills the walker may use', () => {
    const world = tabled();
    const { sink } = collect();
    manager = new SessionManager(sink, world, {
      ...DEFAULT_CONFIG.automation,
      enabled: false,
      movement: { ...DEFAULT_CONFIG.automation.movement, pickLocks: false, bashDoors: true }
    });
    expect(manager.travellerNow(manager.character).forcing).toEqual({ pick: false, bash: true });
    expect(manager.lapTraveller(manager.character).forcing).toEqual({ pick: false, bash: true });
  });

  /*
   * And the ways and places routes keep out of (todo 806), from the file, with
   * nothing allowed: only a route the player chose on the panel may cross one,
   * and never a lap's leg.
   */
  /*
   * A way through what the player keeps out of is walked only once they have
   * picked it over the way round (todo 806, on review): the palette's *Go to*
   * walked the way through unasked. The panel takes `keptOut` off the way it
   * walks; anything still carrying it is a choice nobody made.
   */
  it('refuses to walk a way through what is kept out of that nobody chose', () => {
    const world = tabled();
    const { sink } = collect();
    manager = new SessionManager(sink, world, {
      ...DEFAULT_CONFIG.automation,
      enabled: false
    });
    const round: Route = { steps: [], cost: 0, blocked: true };
    const through: Route = {
      steps: [
        {
          from: '1/1',
          to: '3/1',
          direction: 'portal',
          command: 'go vortex',
          name: 'Black Wasteland',
          requirement: null,
          dark: false,
          keptOut: 'vortex'
        }
      ],
      cost: 1,
      blocked: false,
      keptOut: { words: ['vortex'], round }
    };
    expect(manager.walkPlan(through)).toEqual({ refused: expect.stringContaining('vortex') });
    expect(manager.collectThenWalk([{ id: 1, name: 'rope' }], through)).toContain('vortex');
  });

  it('tells the router what to keep out of', () => {
    const world = tabled();
    const { sink } = collect();
    manager = new SessionManager(sink, world, {
      ...DEFAULT_CONFIG.automation,
      enabled: false,
      movement: { ...DEFAULT_CONFIG.automation.movement, keepOutOf: ['vortex'] }
    });
    expect(manager.travellerNow(manager.character).keepOut).toEqual({
      words: ['vortex'],
      allowed: []
    });
    expect(manager.lapTraveller(manager.character).keepOut).toEqual({
      words: ['vortex'],
      allowed: []
    });
  });
});

/**
 * A socket that is open is not a connection that is alive.
 *
 * The rule and its arithmetic are `LinkWatch.test.ts`'s; what is asserted here
 * is the wiring nothing else can prove: that the deadline reaches the real
 * socket, and that the close it produces arrives as a **loss** — which is the
 * only kind `Reconnect` dials back. The fake host here never answers anything,
 * which is precisely the failure being reproduced.
 */
describe('SessionManager dead link', () => {
  /** Short enough for a test; the shipped fifteen seconds is pinned elsewhere. */
  function silentFor(ms: number): void {
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      reconnect: { ...DEFAULT_INTERNAL.tuning.reconnect, silentForMs: ms }
    });
  }

  it('hangs up a command that goes unanswered, as a loss', async () => {
    const { sink, notices, drops } = collect();
    silentFor(60);
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    await client();

    manager.send('who\r\n');

    await until(() => drops.length > 0);
    // `null`, not a stand-down: nobody typed their way out, the link died.
    expect(drops).toEqual([null]);
    expect(notices.some((notice) => /treating the connection as lost/.test(notice))).toBe(true);
    expect(manager.state.phase).toBe('closed');
    // This client hung up; the far end closed nothing.
    expect(notices).toContain('Hung up on a connection that had stopped answering.');
    expect(notices.some((notice) => /closed by remote host/i.test(notice))).toBe(false);
  });

  /*
   * 2026-09-18: every line after the close re-armed the clock, and the
   * console repeated the dead-link sentence every 45 seconds for seven hours.
   */
  it('owes nothing for a line sent after the socket has gone', async () => {
    const { sink, notices, drops } = collect();
    silentFor(60);
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    await client();

    manager.send('who\r\n');
    await until(() => drops.length > 0);
    const dead = (): number =>
      notices.filter((notice) => /treating the connection as lost/.test(notice)).length;
    expect(dead()).toBe(1);

    manager.send('\r');
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(dead()).toBe(1);
  });

  it('is answered by the server saying anything at all', async () => {
    const { sink, drops, lines } = collect();
    silentFor(120);
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();

    manager.send('who\r\n');
    socket.write('nobody is here\r\n');

    // The positive control: the line landed, so the clock was reset by a byte
    // that arrived rather than by the deadline never having been armed.
    await until(() => lines.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(drops).toEqual([]);
    expect(manager.state.phase).toBe('connected');
  });

  it('does not arm on a half-typed line', async () => {
    const { sink, drops, raw } = collect();
    silentFor(60);
    manager = new SessionManager(sink);
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    const typed: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => typed.push(chunk));

    // A server doing its own echo answers nothing until Enter, so somebody who
    // started typing and walked away must not be hung up on.
    manager.send('wh');

    await until(() => Buffer.concat(typed).toString('latin1') === 'wh');
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(drops).toEqual([]);
    expect(raw).toEqual([]);
    expect(manager.state.phase).toBe('connected');
  });
});

/**
 * What a `search` turns up, written down against the room it was in.
 *
 * Driven through the real socket like everything else here, because the fact
 * being asserted is a *sequence*: the room has to resolve before the search
 * answers, or the find has no room to be written against — and that ordering is
 * exactly what a mocked tracker would paper over.
 */
describe('SessionManager finds', () => {
  /** A find log with nothing in it, and a record of what reached it. */
  function log(): {
    finds: RealmFinds;
    rows: Array<Sighting & { room: string }>;
    searches: string[];
  } {
    const rows: Array<Sighting & { room: string }> = [];
    const searches: string[] = [];
    const row = (sighting: Sighting & { room: string }): Find => ({
      ...sighting,
      seen: 1,
      hits: 1,
      searched: searches.filter((room) => room === sighting.room).length
    });
    return {
      rows,
      searches,
      finds: {
        search: (room, found) => {
          searches.push(room);
          const fresh = found.map((sighting) => ({ ...sighting, room }));
          rows.push(...fresh);
          return fresh.map(row);
        },
        forget: () => false,
        get all() {
          return rows.map(row);
        }
      }
    };
  }

  /** Puts the character in a room the realm can place, with the world loaded. */
  async function standing(sink: SessionSink, finds: RealmFinds): Promise<net.Socket> {
    manager = new SessionManager(
      sink,
      undefined,
      { ...DEFAULT_CONFIG.automation, enabled: false },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      finds
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write(
      'Newhaven, Village Entrance\r\n' +
        'Obvious exits: north\r\n' +
        '[HP=100/MA=50]:rm\r\n' +
        'Location: 1,2140\r\n' +
        '[HP=100/MA=50]:'
    );
    await until(() => manager!.character.room.map !== null);
    return socket;
  }

  it('writes down what a search turned up, in the room it was in', async () => {
    const { sink, notices } = collect();
    const { finds, rows } = log();
    const socket = await standing(sink, finds);

    manager!.send('search\r');
    socket.write('You notice 4 copper farthings, scroll of minor healing here.\r\n[HP=100/MA=50]:');

    await until(() => rows.length >= 2);
    expect(rows.map((row) => row.name)).toContain('scroll of minor healing');
    // Cash carries its worth in copper and a thing does not: that is the field
    // the alert asks about and the one the card draws money with.
    const cash = rows.find((row) => row.copper !== null);
    expect(cash?.copper).toBe(4);
    expect(rows.every((row) => row.room === '1/2140')).toBe(true);
    // Recorded, not announced: the rows above are the positive control, written
    // in the same call that once raised a notice per find.
    expect(notices.some((notice) => notice.includes('scroll of minor healing'))).toBe(false);
  });

  it('counts a search that found nothing, and not one asked of an exit', async () => {
    const { sink, lines } = collect();
    const { finds, rows, searches } = log();
    const socket = await standing(sink, finds);
    const heard: Buffer[] = [];
    socket.on('data', (chunk) => heard.push(chunk));
    /*
     * One exchange at a time, as the realm has them: the slot a bare search
     * arms is armed by the send, so an answer written before its command is on
     * the wire, or a command sent before the last answer is read, is a search
     * the classifier cannot pair.
     */
    const ask = async (command: string, answer: string): Promise<void> => {
      const before = Buffer.concat(heard).length;
      manager!.send(`${command}\r`);
      await until(() => Buffer.concat(heard).subarray(before).toString('latin1').includes(command));
      socket.write(`${answer}\r\n[HP=100/MA=50]:`);
      await until(() => lines.some((line) => line.text.startsWith(answer)));
    };

    await ask('search north', 'You notice nothing different to the north.');
    await ask('search', 'Your search revealed nothing.');
    await ask('search', 'You notice a rusty key here.');

    // The find is the positive control: once it is written, both answers
    // before it have been read, and only the bare search's was counted.
    await until(() => rows.length >= 1);
    expect(searches).toEqual(['1/2140', '1/2140']);
  });

  it('writes nothing down for a room it cannot place', async () => {
    const { sink } = collect();
    const { finds, rows } = log();
    manager = new SessionManager(
      sink,
      undefined,
      { ...DEFAULT_CONFIG.automation, enabled: false },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      finds
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    // A room, but no `Location:` — so the client is standing somewhere it is
    // guessing at, and a row nobody can walk back to is worse than none.
    socket.write('Somewhere\r\nObvious exits: north\r\n[HP=100/MA=50]:');
    await until(() => manager!.character.phase === 'in-game');

    manager.send('search\r');
    socket.write('You notice a rusty key here.\r\n[HP=100/MA=50]:');

    /*
     * The positive control: the find *was* read, and the room *was* refused.
     * Asserting the absence alone would pass equally well on a search the
     * client never classified.
     */
    await until(() => manager!.character.room.hidden.length > 0);
    expect(manager.character.room.map).toBeNull();
    expect(rows).toEqual([]);
  });
});

/*
 * Healbot against three dark goblins, 2026-09-22
 * (`2026-09-22_22-34-44_healbot.mudcap.jsonl`), played back a round at a time.
 *
 * Three things went wrong together. Attacks went out in bursts — one per
 * goblin as each swung — because a heal ended the fight and nothing held
 * hitting back to one attack at a time. The engagements that answered them
 * bound nothing, so the character stood in a running fight with no target and
 * did it again the next round. And when one of those attacks reached the
 * server after its goblin had died, `You say "a short dark goblin"` retired
 * the attack verb for the rest of the connection, and combat stopped.
 */
describe('the fight of 2026-09-22', () => {
  const ROOM =
    'Darkwood Forest\r\nAlso here: nasty dark goblin, dark goblin, short dark goblin.\r\n' +
    'Obvious exits: north, west, southeast\r\n';
  const fighting = (): AutomationConfig => ({
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
    combat: { ...DEFAULT_CONFIG.automation.combat, enabled: true }
  });
  const wire = (socket: net.Socket): (() => string) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    return () => Buffer.concat(chunks).toString('latin1');
  };

  async function inTheForest(): Promise<{
    socket: net.Socket;
    seen: () => string;
    notices: string[];
  }> {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, fighting());
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    const seen = wire(socket);
    socket.write(`[HP=240/MA=214]:\r\n${ROOM}[HP=240/MA=214]:\r\n`);
    await until(() => manager!.character.room.occupants.length === 3);
    return { socket, seen, notices };
  }

  /*
   * The player (2026-09-23): *ALWAYS be sending enter after a monster dies,
   * leaves the room, or enters the room*. Fifteen dogs walked in on skinny,
   * were counted as one, and the character sat down and walked off after the
   * first kill. A burst of arrivals is every one of them on the list, and one
   * Enter once the burst is in.
   */
  it('counts every monster that walks in', async () => {
    const { socket } = await inTheForest();
    const before = manager!.character.room.occupants.length;
    socket.write(
      'A dark goblin moves into the room from the north.\r\n'.repeat(3) + '[HP=240/MA=214]:\r\n'
    );
    await until(() => manager!.character.room.occupants.length === before + 3);
  });

  it('counts a monster that walks out', async () => {
    const { socket } = await inTheForest();
    const before = manager!.character.room.occupants.length;
    socket.write('The dark goblin leaves to the north.\r\n[HP=240/MA=214]:\r\n');
    await until(() => manager!.character.room.occupants.length === before - 1);
  });
});

/*
 * Off the GreaterMUD lineage `prowess.swing` declines by design, and every
 * row of the survey was a fight nobody could price — ranked nearest first, so
 * a Paladin with 74,000 fights on record was shown the lairs round the bank
 * (2026-09-19, Festus on Paradigm). The record measures what the arithmetic
 * cannot: damage a round, against the monster's health.
 */
describe('the hunting survey prices a kill off the fight record', () => {
  /** A town and two lairs in a line, from a realm that names no family. */
  const lairs = (): WorldGraph => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-hunt-'));
    const file = path.join(dir, 'rooms.jsonl.gz');
    const rooms = [
      { m: 1, r: 1, n: 'Town Square', x: { e: { m: 1, r: 2 } } },
      {
        m: 1,
        r: 2,
        n: 'Goblin Warren',
        x: { w: { m: 1, r: 1 }, e: { m: 1, r: 3 } },
        lair: '(Max 1): 7,',
        dl: 2
      },
      { m: 1, r: 3, n: 'Orc Pit', x: { w: { m: 1, r: 2 } }, lair: '(Max 1): 8,', dl: 2 }
    ];
    const mob = (n: string, id: number, hp: number, xp: number, dr = 0) => ({
      n,
      hp,
      i: [id],
      d: 'h',
      ac: 20,
      ...(dr > 0 ? { dr } : {}),
      xp,
      pf: [{ a: [[1, 1, 200, 3, 9, 1000, 0]], c: [] }]
    });
    const header = {
      v: 32,
      source: 'test',
      rooms: rooms.length,
      generatedAt: 'x',
      mobs: [mob('goblin', 7, 200, 300), mob('orc', 8, 300, 400, 300)]
    };
    fs.writeFileSync(
      file,
      zlib.gzipSync(
        [JSON.stringify(header), ...rooms.map((room) => JSON.stringify(room))].join('\n') + '\n'
      )
    );
    const world = WorldGraph.load(file);
    fs.rmSync(dir, { recursive: true, force: true });
    return world;
  };

  /** A record that measured fifty a round, and what it was asked with. */
  function record(): { fights: FightSink; asked: Array<{ level: number; ask: MeasureAsk }> } {
    const asked: Array<{ level: number; ask: MeasureAsk }> = [];
    return {
      asked,
      fights: {
        record: () => {},
        measured: (level, ask): MeasuredOutput => {
          asked.push({ level, ask });
          return { perRound: 50, fights: 40, fromLevel: level };
        }
      }
    };
  }

  async function surveyed(fights: FightSink | undefined, sheet: string[] = []): Promise<void> {
    const { sink } = collect();
    manager = new SessionManager(
      sink,
      lairs(),
      { ...DEFAULT_CONFIG.automation, enabled: false },
      DEFAULT_CONFIG.connection.login,
      undefined,
      undefined,
      fights
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=148/MA=5]:' + PROMPT_REPAINT);
    socket.write(
      'Name: Festus Marcus                    Lives/CP:      9/1\r\n' +
        'Race: Kang        Exp: 792666          Perception:     62\r\n' +
        'Class: Paladin    Level: 10            Stealth:         0\r\n' +
        'Hits:   148/148   Armour Class:  46/5  Thievery:        0\r\n' +
        'Mana:     5/26    Spellcasting: 66     Traps:           0\r\n'
    );
    socket.write('[HP=148/MA=5]:' + PROMPT_REPAINT);
    if (sheet.length > 0) {
      socket.write(sheet.map((row) => `${row}\r\n`).join('') + '[HP=148/MA=5]:' + PROMPT_REPAINT);
      await until(() => manager!.character.stated != null);
    }
    socket.write('Location:            1,1\r\nTown Square\r\nObvious exits: east\r\n');
    await until(
      () => manager!.character.progress.level === 10 && manager!.character.room.number !== null
    );
  }

  it('prices the rounds as the monster’s health over the measured round', async () => {
    const { fights, asked } = record();
    await surveyed(fights);
    const advice = manager!.huntingGrounds(null);

    expect(asked.at(-1)).toEqual({
      level: 10,
      ask: {
        least: DEFAULT_INTERNAL.tuning.hunting.measuredFightsMin,
        roundMs: 5000,
        openerRounds: 1
      }
    });
    expect(advice.assumptions.measured).toEqual({ perRound: 50, fights: 40, fromLevel: 10 });
    const rows = [...advice.spots, ...advice.unmeasured];
    const goblin = rows.find((spot) => spot.mobs[0]?.name === 'goblin');
    expect(goblin?.mobs[0]?.rounds).toBe(4);
    expect(goblin?.estimate.unknown).not.toContain('rounds');
  });

  it('lists past the measured few rather than cutting the realm at them', async () => {
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      hunting: { ...DEFAULT_INTERNAL.tuning.hunting, maxSpots: 1 }
    });
    await surveyed(record().fights);
    const advice = manager!.huntingGrounds(null);
    expect(advice.spots).toHaveLength(1);
    expect(advice.unmeasured).toHaveLength(1);

    // And measures the one a reader opened, so what it would walk is a ring.
    const rough = advice.unmeasured[0]!.key;
    const opened = manager!.huntingGrounds(null, rough);
    expect(opened.spots.map((spot) => spot.key)).toContain(rough);
    expect(opened.unmeasured).toHaveLength(0);
  });

  /*
   * Caught on review: a swing that lands nothing is a refusal, not a decline,
   * and the record priced it anyway — a lair the character cannot hurt,
   * ranked by what it pays. `stat all` states the blow on GreaterMUD (`rm`
   * answering is the tell), and the orc's resistance takes all of it.
   */
  it('lets a refusal stand where the arithmetic priced the fight and found no way to win', async () => {
    const { fights, asked } = record();
    await surveyed(fights, [
      'Name: Festus                                     Illu:           25',
      'HP Regen:   6/18       AC vs Evil:  68           Cold Resist:     0',
      'MA Regen:   3/3        Shadow:       0           Water Resist:    0',
      'Attacks:',
      'Type        Swings   Accy   Min   Max   QnD(Total)   Avg/Rnd(+xtra)',
      'Attack       3.584    105     8    25     0(3)            65(67)  '
    ]);
    const advice = manager!.huntingGrounds(null);
    const rows = [...advice.spots, ...advice.unmeasured];
    // Positive control: the swing priced the goblin itself.
    expect(rows.find((spot) => spot.mobs[0]?.name === 'goblin')?.mobs[0]?.rounds).not.toBeNull();
    const orc = rows.find((spot) => spot.mobs[0]?.name === 'orc');
    expect(orc?.estimate.unknown).toContain('rounds');
    expect(advice.assumptions.measured).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it('leaves the rounds unknown, and says nothing measured, with no record to ask', async () => {
    await surveyed(undefined);
    const advice = manager!.huntingGrounds(null);
    const rows = [...advice.spots, ...advice.unmeasured];
    // Positive control: both lairs were reached and kept.
    expect(rows).toHaveLength(2);
    expect(rows.every((spot) => spot.estimate.unknown.includes('rounds'))).toBe(true);
    expect(advice.assumptions.measured).toBeNull();
  });
});

/*
 * The monster table acting (roadmap step 3, 2026-09-23): MegaMUD's Flee and
 * Hangup relationships, from the realm's table laid under the character's own
 * rows. Neither waits on a fight or on the health switches.
 */
describe('monsters the table says to run from or hang up on', () => {
  const OOZE_ROOM =
    'Rat Cellar\r\nAlso here: gigantic black ooze.\r\nObvious exits: north, south\r\n[HP=100]:\r\n';

  const automation = (over: Partial<(typeof DEFAULT_CONFIG)['automation']> = {}) => ({
    ...DEFAULT_CONFIG.automation,
    enabled: true,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
    ...over
  });

  it('does nothing about a monster the table does not name', async () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, automation());
    manager.configureRealm({
      ...NO_REALM,
      monsters: [{ mob: 'giant rat', relationship: 'escape' }]
    });
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write(OOZE_ROOM);
    await settled(100);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(notices.some((notice) => /Running/.test(notice))).toBe(false);
  });
});

/*
 * A talk-box line of several commands (todo 04): `s;recover corpse;2d,6s`.
 * Queued at the player's own band and sent a prompt at a time, because the
 * realm drops the twentieth command it is handed at once, and each one goes
 * out down the path a keystroke takes, so it is the player's.
 */
describe('a talk-box line of several commands', () => {
  const paced: AutomationConfig = {
    ...DEFAULT_CONFIG.automation,
    // Off: the player's own line goes whatever the master switch says.
    enabled: false,
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
    pacing: { window: 2, minGapMs: 10, ackTimeoutMs: 30_000 }
  };

  async function inTheRealm(): Promise<{
    socket: net.Socket;
    sent: Array<{ command: string; source: string }>;
    notices: string[];
  }> {
    const sent: Array<{ command: string; source: string }> = [];
    const { sink, notices } = collect();
    manager = new SessionManager(
      { ...sink, command: (command, source) => sent.push({ command, source }) },
      undefined,
      paced
    );
    await manager.connect({ host: '127.0.0.1', port, encoding: 'cp437' });
    const socket = await client();
    socket.write('[HP=100]:' + PROMPT_REPAINT);
    await until(() => manager!.character.phase === 'in-game');
    return { socket, sent, notices };
  }

  it('sends each command in turn, a prompt at a time, as the player’s own', async () => {
    const { socket, sent } = await inTheRealm();
    manager!.sendMacro('smile;2wave');
    await until(() => sent.length === 2);
    // The window is two, so the third waits for the realm to answer.
    expect(manager!.queue.snapshot.pending).toEqual([
      expect.objectContaining({ command: 'wave', priority: 'user', typed: true })
    ]);
    socket.write('[HP=100]:' + PROMPT_REPAINT);
    await until(() => sent.length === 3);
    expect(sent).toEqual([
      { command: 'smile', source: 'user' },
      { command: 'wave', source: 'user' },
      { command: 'wave', source: 'user' }
    ]);
  });

  it('refuses a line for a character that is not connected, out loud', () => {
    const { sink, notices } = collect();
    manager = new SessionManager(sink, undefined, paced);
    manager.sendMacro('smile;wave');
    expect(notices).toContain(t('session.macro.offline'));
    expect(manager.queue.snapshot.depth).toBe(0);
  });

  it('refuses a line that stands for more than the ceiling, out loud', async () => {
    const { sent, notices } = await inTheRealm();
    const count = tuning().session.macroCommands + 1;
    manager!.sendMacro(`${count}s`);
    expect(notices).toContain(
      t('session.macro.tooMany', { count, limit: tuning().session.macroCommands })
    );
    expect(manager!.queue.snapshot.depth).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe('the MegaMUD engine’s monsters', () => {
  /* Skinny's Flee for the forgotten dragon slayer never reached the engine, which fought it (2026-10-13). */
  it('are our monster table: the realm’s rows under the character’s, then and on a change', () => {
    const { sink } = collect();
    manager = new SessionManager(sink, undefined, {
      ...DEFAULT_CONFIG.automation,
      combat: {
        ...DEFAULT_CONFIG.automation.combat,
        monsters: [{ mob: 'forgotten dragon slayer', relationship: 'escape' }]
      }
    });
    manager.configureRealm({
      ...NO_REALM,
      monsters: [{ mob: 'forgotten dragon slayer', relationship: 'friend', notHostile: true }]
    });
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    const mega = (manager as unknown as { mega: MegaEngine }).mega;
    const slayer = () => mega.s.data.monsters.find((m) => m.name === 'forgotten dragon slayer');
    expect(slayer()).toMatchObject({ relationship: 5 });
    expect(slayer()!.flags & MonsterFlag.NotHostile).toBe(0x200);

    manager.configureRealm({
      ...NO_REALM,
      monsters: [{ mob: 'lost soul', relationship: 'friend' }]
    });
    expect(mega.s.data.monsters.find((m) => m.name === 'lost soul')).toMatchObject({
      relationship: 2
    });
  });
});

describe('the MegaMUD engine’s progress', () => {
  /* The cards drew the old loop runner's idle progress while the engine looped (2026-10-13). */
  it('reaches the cards in place of the walker’s, with the experience at the run’s start', () => {
    const { sink } = collect();
    const loops: LoopProgress[] = [];
    const walks: WalkProgress[] = [];
    sink.loop = (progress) => loops.push(progress);
    sink.walk = (progress) => walks.push(progress);
    manager = new SessionManager(sink);
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    const host = (manager as unknown as { mega: { host: MegaEngineHost } }).mega.host;
    const running = { ...NO_LOOP, status: 'running' as const, name: 'Ring', startedAt: 1000 };
    host.progressed!(IDLE_WALK, running);
    expect(loops.at(-1)).toMatchObject({ name: 'Ring', expAtStart: null });
    expect(walks.at(-1)).toBe(IDLE_WALK);

    manager.useMegaMud(null);
    expect(loops.at(-1)!.status).toBe('idle');
  });
});

describe('what the MegaMUD engine was walking, taken up again', () => {
  /*
   * A server restarted, a Disconnect and a Connect: the loop or the route that
   * was going is taken up again in the game (2026-10-14).
   */
  const ring: Loop = { name: 'Ring', stops: [{ room: 'Shore' }, { room: 'Pool Edge' }] };
  const running = { ...NO_LOOP, status: 'running' as const, name: 'Ring', startedAt: 1000 };
  const stopped = { ...running, status: 'stopped' as const };

  /** The session's own loop start, which a resume takes: not the player's `startLoop`. */
  const resumer = () => manager as unknown as { beginLoop: (loop: Loop) => { started: true } };

  function engine(kept: ResumableMovement | null = null) {
    const collected = collect();
    manager = new SessionManager(collected.sink);
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    const written: (ResumableMovement | null)[] = [];
    manager.useMovementBook(kept, (m) => written.push(m));
    const inside = manager as unknown as { mega: MegaEngine; megaLoops: Map<string, Loop> };
    const host = (inside.mega as unknown as { host: MegaEngineHost }).host;
    return { inside, host, written, notices: collected.notices };
  }

  it('keeps a running loop, and lets it go when it stops in the game', () => {
    const { inside, host, written } = engine();
    inside.mega.s.inGame = 1;
    host.progressed!(IDLE_WALK, running);
    expect(written).toEqual([{ loop: 'Ring' }]);
    host.progressed!(IDLE_WALK, stopped);
    expect(written).toEqual([{ loop: 'Ring' }, null]);
  });

  it('keeps it when it stops out of the game: a Disconnect, a hang-up, a dropped line', () => {
    const { inside, host, written } = engine();
    inside.mega.s.inGame = 1;
    host.progressed!(IDLE_WALK, running);
    inside.mega.s.inGame = 0;
    host.progressed!(IDLE_WALK, stopped);
    expect(written).toEqual([{ loop: 'Ring' }]);
  });

  it('takes the loop up again once in the game', async () => {
    const { inside, host, notices } = engine({ loop: 'Ring' });
    inside.megaLoops.set('Ring', ring);
    const start = vi.spyOn(resumer(), 'beginLoop').mockReturnValue({ started: true });
    host.enteredGame!();
    await Promise.resolve();
    expect(start).toHaveBeenCalledWith(ring);
    expect(notices).toContain(t('session.move.resumingLoop', { loopName: 'Ring' }));
  });

  it('walks on to where a route was going', async () => {
    const { inside, host } = engine({ to: '1/2', run: true });
    const walk = vi.spyOn(inside.mega, 'walkTo').mockReturnValue(null);
    host.enteredGame!();
    await Promise.resolve();
    expect(walk).toHaveBeenCalledWith('1/2', true, true);
  });

  /*
   * A route the player walks is walked alone: MegaMUD takes up whatever loop
   * path it still holds on arriving, and Stop leaves it loaded, so a route
   * after a lap walked back into the lap (2026-10-16). Only a restart or a
   * lost line takes a loop up again.
   */
  it('walks a route the player asks for alone, so no stopped lap follows it', () => {
    const { inside, written } = engine();
    inside.mega.s.inGame = 1;
    const walk = vi.spyOn(inside.mega, 'walkTo').mockReturnValue(null);
    const route = { steps: [{ to: '1/2' }] } as unknown as Parameters<
      SessionManager['walkRoute']
    >[0];
    expect(manager!.walkRoute(route)).toBeNull();
    expect(walk).toHaveBeenCalledWith('1/2', false, true);
    expect(written).toEqual([{ to: '1/2', run: false }]);
  });

  it('leaves be what MegaMUD’s own On entry started, and lets a loop filed nowhere go', async () => {
    const walking = engine({ loop: 'Ring' });
    walking.inside.mega.s.walking = 1;
    const start = vi.spyOn(resumer(), 'beginLoop');
    walking.host.enteredGame!();
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();

    const gone = engine({ loop: 'Hunt 3' });
    gone.host.enteredGame!();
    await Promise.resolve();
    expect(gone.written).toEqual([null]);
    expect(gone.notices).toContain(t('session.move.resumeGone', { loopName: 'Hunt 3' }));
  });
});

describe('the actions kept beside the MegaMUD engine', () => {
  /*
   * Auto-hunt walks to its lair and runs a loop it sized and filed nowhere:
   * the engine's Go To and loop for a character it runs (2026-10-14).
   */
  let notices: string[] = [];
  const engine = () => {
    const collected = collect();
    notices = collected.notices;
    manager = new SessionManager(collected.sink);
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    return (manager as unknown as { mega: { host: MegaEngineHost } }).mega.host;
  };

  /* A ward or a key off the floor: MegaMUD's pending list, which holds its walk (2026-10-14). */
  it('put their commands on the engine’s pending list, said sent when it sends them', () => {
    engine();
    type Probe = { command: string; priority: 'probe'; coalesceKey?: string; onSent?: () => void };
    const inside = manager as unknown as {
      keptQueue: {
        enqueue(intent: Probe): boolean;
        cancel(match: (intent: Probe) => boolean): number;
        queued(match: (intent: Probe) => boolean): boolean;
      };
      mega: MegaEngine;
    };
    // In the game: out of it, MegaMUD sends a queued command at once.
    inside.mega.s.inGame = 1;
    const sent = vi.fn();
    const ours = (intent: Probe) => intent.coalesceKey === 'ward';
    inside.keptQueue.enqueue({
      command: 'use amulet',
      priority: 'probe',
      coalesceKey: 'ward',
      onSent: sent
    });
    expect(inside.mega.s.pending.map((p) => p.text)).toEqual(['use amulet\r']);
    expect([sent.mock.calls.length, inside.keptQueue.queued(ours)]).toEqual([0, true]);

    pendingPump(inside.mega.s);
    expect([sent.mock.calls.length, inside.keptQueue.queued(ours)]).toEqual([1, false]);

    inside.keptQueue.enqueue({ command: 'say hi', priority: 'probe', coalesceKey: 'ward' });
    expect(inside.keptQueue.cancel(ours)).toBe(1);
    expect(inside.mega.s.pending).toEqual([]);
  });

  /* MegaMUD buys only on its loop's start detour: an errand's purchase is ours (2026-10-14). */
  it('buy at the counter a buy at a time, done when the pack holds it, given up when nothing came', () => {
    vi.useFakeTimers();
    engine();
    const inside = manager as unknown as {
      mega: MegaEngine;
      megaBuying: unknown;
      megaBuyTick(state: CharacterState): void;
    };
    inside.mega.s.inGame = 1;
    const row = { name: 'torch', min: 1, max: 1, shop: 'General Store', at: null };
    const holding = (names: string[]) =>
      ({
        ...manager!.character,
        inventory: { ...manager!.character.inventory, items: names.map((name) => ({ name })) }
      }) as unknown as CharacterState;
    const counter = () => ({ row, room: '1/1', shop: 'General Store', at: true, asked: null });

    inside.megaBuying = counter();
    inside.megaBuyTick(holding([]));
    expect(inside.mega.s.pending.map((p) => p.text)).toEqual(['buy torch\r']);
    inside.megaBuyTick(holding([]));
    expect(inside.mega.s.pending).toHaveLength(1);
    pendingPump(inside.mega.s);
    inside.megaBuyTick(holding(['torch']));
    expect(inside.megaBuying).toBeNull();

    inside.megaBuying = counter();
    inside.megaBuyTick(holding([]));
    pendingPump(inside.mega.s);
    vi.advanceTimersByTime(tuning().supplies.buyTimeoutMs + 1);
    inside.megaBuyTick(holding([]));
    expect(inside.megaBuying).toBeNull();
    expect(notices.at(-1)).toBe(
      t('automation.collect.megaNotBought', {
        item: 'torch',
        shop: 'General Store',
        why: t('automation.collect.whyNotSold', { shop: 'General Store' })
      })
    );
  });

  /* A quest's legs let the stopped loop go: it is taken up again by name (2026-10-14). */
  it('hold the engine’s lap for a quest run and take it up again by name', () => {
    engine();
    const inside = manager as unknown as {
      mega: MegaEngine;
      runningLoopName(): string | null;
      megaHold(): void;
      megaRelease(): void;
    };
    inside.runningLoopName = () => 'Ring';
    const button = vi.spyOn(inside.mega, 'button').mockImplementation(() => {});
    const start = vi.spyOn(inside.mega, 'startLoop').mockReturnValue(null);
    inside.megaHold();
    expect(button).toHaveBeenCalledWith(0x803);
    inside.megaRelease();
    expect(start).toHaveBeenCalledWith('Ring');
    inside.megaRelease();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('hand the engine a loop filed nowhere, which it then finds by name', () => {
    const host = engine();
    const loop = { name: 'Hunt: Orc Den', stops: [{ room: 'Orc Den' }, { room: 'Orc Pit' }] };
    expect(host.loopRooms('Hunt: Orc Den')).toBe(
      t('session.move.noSuchLoop', { name: 'Hunt: Orc Den' })
    );
    manager!.startLoop(loop);
    expect(host.loopRooms('Hunt: Orc Den')).not.toBe(
      t('session.move.noSuchLoop', { name: 'Hunt: Orc Den' })
    );
  });

  it('are told when the engine’s own walk ends, and not when a lap’s leg does', () => {
    const host = engine();
    const ended = vi.fn();
    (manager as unknown as { hunt: { onWalkEnded: typeof ended } }).hunt.onWalkEnded = ended;
    const walking = { ...IDLE_WALK, status: 'walking' as const };
    const running = { ...NO_LOOP, status: 'running' as const, name: 'Ring', startedAt: 1000 };
    host.progressed!(walking, running);
    host.progressed!({ ...IDLE_WALK, status: 'arrived' }, running);
    expect(ended).not.toHaveBeenCalled();

    host.progressed!(walking, NO_LOOP);
    host.progressed!({ ...IDLE_WALK, status: 'arrived' }, NO_LOOP);
    expect(ended).toHaveBeenCalledWith(true, null, expect.anything());
    host.progressed!(walking, NO_LOOP);
    host.progressed!({ ...IDLE_WALK, status: 'stopped', reason: 'Stopped.' }, NO_LOOP);
    expect(ended).toHaveBeenLastCalledWith(false, 'Stopped.', expect.anything());
  });
});

describe('the MegaMUD engine’s questions', () => {
  /*
   * MegaMUD waits on its message boxes; this client answers no where it asks,
   * holds the question for the player, and on a yes runs the player's action
   * again for MegaMUD to be told yes (2026-10-13).
   */
  it('answers no and holds the question, then a yes runs the action again to a yes', () => {
    const { sink } = collect();
    manager = new SessionManager(sink);
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    const inside = manager as unknown as {
      megaAsk(text: string): boolean;
      megaAct<T>(act: () => T): T;
    };
    const answers: boolean[] = [];
    inside.megaAct(() => answers.push(inside.megaAsk('You need a key to go here.')));
    expect(answers).toEqual([false]);
    expect(manager.automation.megaQuestion).toBe('You need a key to go here.');

    manager.megaAnswer('Something else?', true);
    expect(answers).toEqual([false]);

    manager.megaAnswer('You need a key to go here.', true);
    expect(answers).toEqual([false, true]);
    expect(manager.automation.megaQuestion).toBeUndefined();
  });

  it('leaves it at no on a no', () => {
    const { sink } = collect();
    manager = new SessionManager(sink);
    manager.useMegaMud({
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {}
    });
    const inside = manager as unknown as {
      megaAsk(text: string): boolean;
      megaAct<T>(act: () => T): T;
    };
    let asked = 0;
    inside.megaAct(() => {
      asked += 1;
      return inside.megaAsk('Update it now?');
    });
    manager.megaAnswer('Update it now?', false);
    expect(asked).toBe(1);
    expect(manager.automation.megaQuestion).toBeUndefined();
  });
});
