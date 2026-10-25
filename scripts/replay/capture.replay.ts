/**
 * A capture played back through the client's own session, to see what the
 * MegaMUD engine thought it was doing: `npm run replay -- <capture>`.
 *
 * The character's session is built as the client builds it (its profile, its
 * realm's world and tables, its MegaMUD settings and loops), connected to a
 * local server that writes the capture's bytes back at the times they arrived,
 * on a clock that jumps from one to the next. What the engine says it is doing
 * (its status bar's activity), its `{D…}` step traces and the fields that gate
 * its steps (`state`) are written beside the lines, with what it sends and what
 * the recorded session sent, so where the two part is plain.
 *
 * The engine answers a realm that is replaying, not listening: once the replay
 * sends something the recording did not, what follows was the answer to the
 * recording's command, and a command it waits on an answer to never gets one
 * (2026-10-17: Archer's replay asked `stat` the recording never answered, and
 * stood waiting). So a replay answers what the engine makes of a stretch of
 * lines, read up to the first parting; why the live engine did what it did is
 * the capture's own record of it, its `live` lines.
 *
 * The home is copied (without its logs) into a scratch directory first, so
 * nothing the stores migrate or write lands on the real one.
 *
 *   REPLAY_CAPTURE  the `.mudcap.jsonl` (or the first argument after `--`)
 *   REPLAY_HOME     the client's home (default: the one the client uses)
 *   REPLAY_FROM     HH:MM:SS UTC to start reporting at (default: the start)
 *   REPLAY_TO       HH:MM:SS UTC to stop at (default: the end)
 *   REPLAY_OUT      where the report goes (default: `out-replay/<capture>.replay.txt`)
 *   REPLAY_ACTS     what the player did in the app, for a capture from before
 *                   those were recorded: a JSON list of `SessionAct`s, each
 *                   with `at` (HH:MM:SS UTC), e.g.
 *                   `[{"at":"20:29:00","act":"startMoving","loop":"Mermex"}]`
 *   REPLAY_REBUILD  set: the engine is handed freshly built databases at every
 *                   settings act, as a live client hands them after what they
 *                   are built from has changed (2026-10-25: Fatty's songs)
 *
 * Since 2026-10-18 a capture records those itself (`act`), and the engine's
 * own log as it played (`engine`): shown here as `live …` beside the replay's.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { it, vi } from 'vitest';

import { homeAt } from '../../src/main/app/home';
import { setTuning } from '../../src/main/app/tuning';
import { ConfigStore } from '../../src/main/config/ConfigStore';
import { InternalStore } from '../../src/main/config/InternalStore';
import { LoopStore } from '../../src/main/config/LoopStore';
import { ProfileStore } from '../../src/main/config/ProfileStore';
import {
  ITEM_TABLE,
  MESSAGE_TABLE,
  MONSTER_TABLE,
  RealmTableStore,
  type RealmTable,
  type TableKind
} from '../../src/main/config/RealmTableStore';
import { ServerStore } from '../../src/main/config/ServerStore';
import { megaDataFrom } from '../../src/main/megamud/fromWorld';
import type { EngineLogKind } from '../../src/main/session/MegaEngine';
import {
  SessionManager,
  type SessionAct,
  type SessionSink
} from '../../src/main/session/SessionManager';
import { RealmLibrary } from '../../src/main/world/RealmLibrary';
import { DEFAULT_INTERNAL } from '../../src/shared/internal';
import { mergeItemRules } from '../../src/shared/itemRules';
import { mergeLoops } from '../../src/shared/loops';
import { megamudFromConfig } from '../../src/shared/megamud/fromConfig';

/** The files of a home a session is built from; the rest (logs, backscroll, talk) is left. */
const HOME_PARTS = [
  'global',
  'servers',
  'profiles',
  'realms',
  'internal.yaml',
  'megamud-learned.json',
  'mob-lore.json',
  'worlds.json'
];

interface Entry {
  t: number;
  k: string;
  s?: string;
  raw?: string;
  src?: string;
}

function argument(): string {
  const asked = process.env.REPLAY_CAPTURE ?? '';
  if (asked !== '') return asked;
  const after = process.argv.indexOf('--');
  const found = process.argv.slice(after === -1 ? 2 : after + 1).find((a) => a.endsWith('.jsonl'));
  if (found === undefined) throw new Error('No capture: REPLAY_CAPTURE=<file.mudcap.jsonl>');
  return found;
}

function defaultHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(xdg, 'mudengine');
}

/** HH:MM:SS of a moment, in UTC as the capture's file names are. */
function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

it('replays a capture through the engine', { timeout: 30 * 60_000 }, async () => {
  const capturePath = path.resolve(argument());
  const realHome = path.resolve(process.env.REPLAY_HOME ?? defaultHome());
  const lines = fs
    .readFileSync(capturePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Entry & { session?: string; startedAt?: string });
  const meta = lines.find((e) => e.k === 'meta');
  if (!meta?.session || !meta.startedAt) throw new Error('The capture has no meta line');
  const started = Date.parse(meta.startedAt);
  const day = meta.startedAt.slice(0, 10);
  const injected = (
    JSON.parse(process.env.REPLAY_ACTS ?? '[]') as (SessionAct & { at: string })[]
  ).map(({ at, ...act }) => ({ t: Date.parse(`${day}T${at}Z`) - started, k: 'act', ...act }));
  const entries = [
    ...(lines.filter((e) => ['in', 'out', 'act', 'engine'].includes(e.k)) as Entry[]),
    ...(injected as Entry[])
  ].sort((a, b) => a.t - b.t);
  const from = process.env.REPLAY_FROM ?? '';
  const to = process.env.REPLAY_TO ?? '';
  const reporting = (at: number): boolean =>
    (from === '' || clock(at) >= from) && (to === '' || clock(at) <= to);

  // A scratch home: what the stores read, never the real one they might write.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-replay-'));
  for (const part of HOME_PARTS) {
    const source = path.join(realHome, part);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(scratch, part), { recursive: true });
  }
  const home = homeAt(scratch);
  const quiet = (): void => {};

  const internal = new InternalStore({ file: home.internal, template: '', onError: quiet });
  setTuning(internal.config?.tuning ?? DEFAULT_INTERNAL.tuning);
  const config = new ConfigStore({ override: home.options, searchPaths: [home.options] });
  const servers = new ServerStore(home, quiet);
  const loops = new LoopStore(home, quiet);
  // The servers and the global loops, folded into the options as the client does (`publishTree`).
  config.setExtras({ servers: servers.servers, loops: loops.globalLoops });
  const profiles = new ProfileStore({
    directory: home.profilesDir,
    base: () => config.source ?? {},
    loopsFor: (id, serverName) => {
      const serverId = servers.idFor(serverName);
      return mergeLoops(
        serverId === undefined ? [] : loops.forServer(serverId),
        loops.forProfile(id)
      );
    }
  });
  profiles.refresh();
  const profile = profiles.profiles.find((p) => p.id === meta.session);
  if (profile === undefined) {
    throw new Error(
      `No profile ${meta.session} in ${realHome}: ${JSON.stringify(profiles.snapshot.errors ?? [])} ${profiles.profiles.map((p) => p.id).join(',')}`
    );
  }
  const password = profile.config.connection.login.password;
  const masked = (text: string): string =>
    password === '' ? text : text.split(password).join('********');

  // Its realm: the world, and the tables imported for it.
  const serverId = servers.idFor(profile.serverName);
  const tables = <T extends RealmTable>(kind: TableKind<T>): T | null =>
    serverId === undefined ? null : new RealmTableStore<T>(home, kind, quiet).forServer(serverId);
  const messages = tables(MESSAGE_TABLE)?.triggers ?? [];
  const monsters = tables(MONSTER_TABLE)?.monsters ?? [];
  const items = tables(ITEM_TABLE)?.items ?? [];
  let database = profile.database ?? '';
  // A container's home names its database where the container mounts it.
  if (database !== '' && !fs.existsSync(database)) {
    const beside = path.join(realHome, path.basename(database));
    if (fs.existsSync(beside)) database = beside;
  }
  const resources = path.resolve('resources');
  const realms = new RealmLibrary({
    shippedDir: path.join(resources, 'world'),
    resourcesDir: resources,
    // Kept between replays, keyed as the client keys it (the file's identity):
    // converting the realm was a fifth of a short replay (2026-10-25).
    cacheDir: path.join(os.tmpdir(), 'mudengine-replay-realms'),
    notify: quiet
  });
  const world = realms.load(database).graph;

  const automation = profile.config.automation;
  const runic = profile.config.connection.coins.runic;
  const settings = structuredClone(
    profile.megamudOn
      ? profile.megamud
      : megamudFromConfig(automation, (spell) => world?.spellNamed(spell)?.short ?? spell)
  );
  const { username } = profile.config.connection.login;
  if (username !== '') settings.live['BBS']!['UserID'] = username;
  if (password !== '') settings.live['BBS']!['Password'] = password;

  const report: string[] = [];
  const note = (at: number, kind: string, text: string): void => {
    if (reporting(at)) report.push(`${clock(at)}  ${kind.padEnd(8)} ${masked(text)}`);
  };
  /** A line of the engine's own log (`EngineLogKind`), the replay's or (`live`) the capture's. */
  const logged = (at: number, kind: string, text: string, live = false): void =>
    note(at, live ? `live-${kind}` : kind, text);

  vi.useFakeTimers({
    now: started,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
  });

  // The realm: the capture's bytes, written as the replay reaches their time.
  let socket: net.Socket | null = null;
  const server = net.createServer((accepted) => {
    socket = accepted;
    accepted.on('error', quiet);
    accepted.on('data', (chunk) => {
      for (const sent of chunk.toString('latin1').split(/\r\n|\r/)) {
        if (sent !== '') note(Date.now(), 'replay>', sent);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  const sink = new Proxy({} as SessionSink, {
    get: (_target, key) => {
      // No cards here, so none of what only the cards draw (the room's verdict).
      if (key === 'verdict') return undefined;
      if (key === 'notice') return (message: string) => note(Date.now(), 'notice', message);
      if (key === 'engineLog')
        return (kind: EngineLogKind, text: string) => logged(Date.now(), kind, text);
      return quiet;
    }
  });
  const manager = new SessionManager(sink, world, automation, profile.config.connection.login);
  manager.configure(
    automation,
    profile.config.connection.login,
    profile.config.ui.rewrites,
    profile.config.connection.locate
  );
  manager.configureInternal(internal.config ?? DEFAULT_INTERNAL);
  manager.configureRealm({ messages, monsters, items, coins: profile.config.connection.coins });
  const setup = {
    settings,
    data: megaDataFrom(
      world,
      { items: mergeItemRules(items, automation.loot.itemDetails), messages },
      runic
    ),
    grants: automation.remotes.players,
    joinWhenInvited: automation.remotes.autoJoin,
    botCommands: automation.remotes.commands,
    bbs: { ...profile.config.connection.bbs, ...(runic !== undefined ? { RunicName: runic } : {}) }
  };
  manager.useMegaMud(setup);

  await manager.connect({ host: '127.0.0.1', port, encoding: profile.target.encoding });
  for (let i = 0; i < 200 && socket === null; i += 1) await new Promise((r) => setImmediate(r));
  if (socket === null) throw new Error('The session did not connect');
  const wire = socket as net.Socket;
  // The recorded chunks go straight to the client's reading of its socket, as
  // they were recorded (2026-10-25): through the loopback, every chunk waited
  // on the kernel and the event loop, a third of a replay spent idle. What
  // the client sends still goes over the wire to the server above.
  const client = (manager as unknown as { client: { ingest(chunk: Buffer): void } }).client;

  /** What the player did in the app, done again through the same door. */
  const perform = (act: SessionAct): void => {
    switch (act.act) {
      case 'walkPlan':
        manager.walkPlan(act.route, act.run);
        break;
      case 'collectThenWalk':
        manager.collectThenWalk(act.items, act.route, act.run);
        break;
      case 'startMoving':
        manager.startMoving(act.loop);
        break;
      case 'startLoop':
        manager.startLoop(act.loop);
        break;
      case 'stopMoving':
        manager.stopMoving();
        break;
      case 'stepBack':
        manager.stepBack();
        break;
      case 'megaToggle':
        manager.megaToggle(act.name);
        break;
      case 'megaAnswer':
        manager.megaAnswer(act.question, act.yes);
        break;
      case 'depositAll':
        manager.depositAll();
        break;
      case 'buyItem':
        manager.buyNow(act.item, act.remove);
        break;
      case 'megamud': {
        // Recorded without the login, which the profile has.
        const recorded = structuredClone(act.settings);
        recorded.live['BBS'] = { ...recorded.live['BBS'], ...settings.live['BBS'] };
        // A live client builds its databases again when what they are built
        // from changes, and the engine takes them at the next settings act:
        // `REPLAY_REBUILD` hands it fresh ones at every act, as that does.
        manager.useMegaMud({
          ...setup,
          settings: recorded,
          ...(process.env.REPLAY_REBUILD ? { data: structuredClone(setup.data) } : {})
        });
        break;
      }
    }
  };

  const end = to === '' ? Infinity : Date.parse(`${meta.startedAt.slice(0, 10)}T${to}Z`);
  for (const entry of entries) {
    const at = started + entry.t;
    if (at > end) break;
    if (at > Date.now()) await vi.advanceTimersByTimeAsync(at - Date.now());
    if (entry.k === 'engine') {
      logged(at, (entry as Entry & { kind?: string }).kind ?? 'doing', entry.s ?? '', true);
      continue;
    }
    if (entry.k === 'act') {
      const act = entry as unknown as SessionAct;
      note(at, 'act', act.act === 'megamud' ? 'megamud settings' : JSON.stringify(act));
      perform(act);
      continue;
    }
    if (entry.k === 'out') {
      note(at, entry.src === 'user' ? 'typed' : 'recorded', entry.s ?? '');
      // The player's own lines are the player's: typed into the replay too.
      if (entry.src === 'user') manager.send(`${entry.s ?? ''}\r`);
      continue;
    }
    const bytes = Buffer.from(entry.raw ?? '', 'base64');
    client.ingest(bytes);
    // A turn of the loop, so the server hears any answer before the next chunk.
    await new Promise((r) => setImmediate(r));
    for (const line of bytes
      .toString('latin1')
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .split(/\r\n/)) {
      if (line.trim() !== '') note(at, 'realm', line);
    }
  }

  manager.dispose();
  wire.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.useRealTimers();
  for (const store of [servers, loops, profiles] as { dispose?: () => void }[]) store.dispose?.();
  fs.rmSync(scratch, { recursive: true, force: true });

  // Never beside the capture: that is the real home's logs.
  const out =
    process.env.REPLAY_OUT ??
    path.resolve(
      'out-replay',
      path.basename(capturePath).replace(/\.mudcap\.jsonl$/, '.replay.txt')
    );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${report.join('\n')}\n`);
  console.log(`${report.length} lines: ${out}`);
});
