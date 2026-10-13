/**
 * The ported MegaMUD engine (`src/main/megamud/`) run for one connection:
 * raw text in, commands out, its clocks kept, and its paths planned by our
 * world graph (docs/megamud/engine-port.md, Walking).
 *
 * **On for a character with a `megamud.ini`** beside its profile. The old
 * automation stands down for it (`SessionManager.configure`); the login,
 * the display, the map and the planners stay ours.
 *
 * **Paths.** MegaMUD walks paths whose steps name the room each is taken
 * from by its signature (`0x8130`: the name's hash in the top twelve bits,
 * two bits an exit). A room's signature is learned whenever the engine and
 * our tracker stand in it together; until then it is worked out from the
 * realm data, and a room whose exits the realm data cannot say how the game
 * prints is given MegaMUD's own "relearn" mark (step flag `0x80`), which
 * the walk fills in the first time through ("[Path step updated]").
 */
import fs from 'node:fs';
import path from 'node:path';

import { stricmp } from '../megamud/cstr';
import { coinItems, messagesFrom, readData, type MegaData } from '../megamud/data';
import { bbsSetup } from '../megamud/bbs';
import { grantPlayers, loadCharacter } from '../megamud/character';
import { newTerminal, parseData, type TerminalState } from '../megamud/input/ParseData';
import { typedCommand } from '../megamud/input/typed';
import { menuCommand } from '../megamud/move/buttons';
import { blessCommand } from '../megamud/player/cast';
import { clearDetours, goTo, headFor, startWalking } from '../megamud/move/destinations';
import { copyPath, freeSteps } from '../megamud/move/path';
import { connected, connectionClosed } from '../megamud/script/game';
import { forgetAwaited, setState } from '../megamud/script/state';
import {
  dataArrived,
  newQuietClock,
  quietTick,
  secondTick,
  type QuietClock
} from '../megamud/script/timer';
import {
  newPath,
  Session,
  type PathRec,
  type PathStep,
  type RouteFound,
  type SessionHost
} from '../megamud/Session';
import { findSpell } from '../megamud/spells/lookup';
import type { ActiveBuff } from '../../shared/character';
import type { MegaSettings } from '../../shared/megamud/settings';
import type { RemoteName } from '../../shared/remotes';
import {
  DIRECTIONS,
  roomId,
  type RequirementKind,
  type Route,
  type RoomId,
  type WorldRoom
} from '../../shared/world';
import type { WorldGraph } from '../world/WorldGraph';

/** What the engine needs from the session it runs in. */
export interface MegaEngineHost {
  /** To the socket, as typed. */
  write(text: string): void;
  /** A line of MegaMUD's own on the console. */
  show(text: string): void;
  /** The engine closes the connection. */
  hangUp(): void;
  /** The engine dials again (after its redial pause). */
  dial(): void;
  /** Where our tracker places the character, when it is sure. */
  here(): RoomId | null;
  /**
   * Asks the realm where the character is (its locate command, `rm` or
   * `sys status`), for our tracker to place the room from the reply. False
   * when the realm has none, or has refused it.
   */
  locate(): boolean;
  world(): WorldGraph | undefined;
  /** The shortest walkable way between two rooms. */
  plan(from: RoomId, to: RoomId): Route | string;
  /** A loop's stops as rooms, or why not. */
  loopRooms(name: string): { rooms: RoomId[]; bounce: boolean } | string;
  /** MegaMUD's yes-or-no questions; no when absent. */
  ask?(text: string): boolean;
}

export interface MegaEngineSetup {
  settings: MegaSettings;
  data: MegaData;
  /** The app's per-player remote grants (`automation.remotes.players`). */
  grants: Readonly<Record<string, { allow: readonly RemoteName[]; deny: readonly RemoteName[] }>>;
  /** Signatures learned before, by room. */
  learned?: ReadonlyMap<RoomId, number>;
}

/**
 * MegaMUD's databases from a character's data folder: `Monsters.md`,
 * `Items.md`, `Spells.md`, `Classes.md`, `Races.md` and `Messages.md`, each
 * looked for in the folder and its `Default` (MegaMUD's own layout). A file
 * not found is empty: MegaMUD learns monsters and items as it meets them.
 */
export function readMegaData(dirs: readonly string[], runic = 'runic coin'): MegaData {
  const find = (name: string): Buffer | undefined => {
    for (const dir of dirs) {
      for (const at of [path.join(dir, name), path.join(dir, 'Default', name)]) {
        try {
          if (fs.statSync(at).isFile()) return fs.readFileSync(at);
        } catch {
          // Not here.
        }
      }
    }
    return undefined;
  };
  const data = readData({
    monsters: find('Monsters.md'),
    items: find('Items.md'),
    spells: find('Spells.md'),
    classes: find('Classes.md'),
    races: find('Races.md'),
    runic
  });
  const messages = find('Messages.md');
  if (messages) data.messages = messagesFrom(messages.toString('latin1'));
  if (data.items.length === 0) data.items = coinItems(runic);
  return data;
}

/** `0x498a60`'s hash of a room's name, the signature's top twelve bits. */
export function nameHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1)
    hash = (hash + (i + 1) * (name.charCodeAt(i) & 0xff)) | 0;
  return (hash << 20) | 0;
}

/** Exits the game lists as plain ones, whatever stops a character using them. */
const PLAIN: ReadonlySet<RequirementKind> = new Set([
  'level',
  'class',
  'race',
  'alignment',
  'ability',
  'trap'
]);

/**
 * A room's signature as the exits line would give it (`0x438f90`'s
 * `finish`), from the realm data: a plain exit 1, a door or gate 2, a hidden
 * one 0. Null when an exit's kind leaves it unsure how the game lists it.
 */
export function worldSignature(room: WorldRoom): number | null {
  const codes = new Array<number>(10).fill(0);
  for (const exit of room.exits) {
    const dir = DIRECTIONS.indexOf(exit.direction);
    if (dir === -1) continue;
    const kind = exit.requirement?.kind ?? null;
    let code: number;
    if (kind === null || PLAIN.has(kind)) code = 1;
    else if (kind === 'door' || kind === 'key') code = 2;
    else if (kind === 'hidden') code = 0;
    else return null;
    codes[dir] = Math.max(codes[dir]!, code);
  }
  let code = 0;
  codes.forEach((v, dir) => (code |= v << (dir * 2)));
  let sig = ((nameHash(room.name) & 0xfff00000) | code) >>> 0;
  if (sig === 0xb7200050) sig = 0xb7200055;
  return sig | 0;
}

/** MegaMUD's once-a-second timer (`WM_TIMER` 100, set to 1000 ms). */
const SECOND_MS = 1000;
/**
 * How often the network thread's quiet checks run here. Its own loop sleeps
 * 10 ms between reads (`0x42c910`); every check it makes is a second or more
 * apart, so a quarter of a second loses nothing.
 */
const QUIET_POLL_MS = 250;

/** How long a walk waits on the realm saying where the character is. */
const LOCATE_WAIT_MS = 5000;

/** A short, steady name for a path MegaMUD can hold (13 characters). */
function shortName(prefix: string, text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${prefix}${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export class MegaEngine {
  readonly s: Session;
  private readonly t: TerminalState = newTerminal();
  private readonly quiet: QuietClock;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  /** The signatures learned, both ways. */
  readonly learned = new Map<RoomId, number>();
  private readonly learnedRooms = new Map<number, Set<RoomId>>();
  /** Every room's worked-out signature, built once when first needed. */
  private computed: Map<number, RoomId[]> | null = null;
  private computedFor: WorldGraph | undefined;
  /** The paths made for the engine, by name, with the room each step is taken from. */
  private readonly made = new Map<string, { path: PathRec; rooms: (RoomId | null)[] }>();
  private routes = 0;
  /** Writes waiting behind a `~` pause. */
  private outbound: string[] = [];
  private pausing = false;
  private disposed = false;
  /**
   * A walk put aside while the realm is asked where the character is: the
   * destinations and the walking state as they were when the way was asked
   * for, taken up again when our tracker places the room.
   */
  private parked: {
    detours: Session['detours'];
    walking: number;
    looping: number;
    roaming: number;
    lost: number;
    until: number;
  } | null = null;
  /** The next way asked for is answered without asking where first (the ask came to nothing). */
  private locateGaveUp = false;
  /** In the game at the last chunk: entering it is when a room is first wanted. */
  private wasInGame = false;
  /** When our tracker had each of the ten blessing slots put up, at the last look; null when down. */
  private readonly blessUp: (number | null)[] = [];

  constructor(
    private readonly host: MegaEngineHost,
    setup: MegaEngineSetup
  ) {
    const engineHost: SessionHost = {
      write: (text) => this.write(text),
      trace: (text) => this.host.show(text),
      activity: () => {},
      show: (text) => this.host.show(text),
      clock: () => Math.floor(Date.now() / 1000),
      tickMs: () => Date.now(),
      alert: () => {},
      message: (text) => this.host.show(`[${text}]`),
      ask: (text) => this.host.ask?.(text) ?? false,
      post: (command) => queueMicrotask(() => !this.disposed && menuCommand(this.s, command)),
      hangUp: () => this.host.hangUp(),
      dial: () => this.host.dial(),
      route: (from, to) => this.route(from, to),
      readPath: (name) => this.readPath(name),
      saveSteps: (p) => this.saveSteps(p)
    };
    this.s = new Session(engineHost, setup.data);
    loadCharacter(this.s, setup.settings);
    bbsSetup(this.s, () => undefined);
    this.s.now = engineHost.clock();
    grantPlayers(this.s, setup.grants);
    for (const [room, sig] of setup.learned ?? []) this.learn(room, sig);
    this.quiet = newQuietClock(Date.now());
    this.timers.push(
      setInterval(() => this.safely(() => secondTick(this.s)), SECOND_MS),
      setInterval(() => this.safely(() => quietTick(this.s, this.t, this.quiet)), QUIET_POLL_MS),
      setInterval(() => this.safely(() => this.parkedTimeout()), QUIET_POLL_MS)
    );
  }

  /**
   * The settings changed (`megamud.ini` edited): put on the running session,
   * as MegaMUD's settings dialog changes the struct in place, the path
   * walked and the loop kept.
   */
  reload(setup: MegaEngineSetup): void {
    const s = this.s;
    const kept = [s.MegaMud_CurPath, s.MegaMud_SelPath, s.MegaMud_CurPathStep] as const;
    const { rules, ruleAt, events, eventNext, monitors } = s;
    loadCharacter(s, setup.settings);
    [s.MegaMud_CurPath, s.MegaMud_SelPath, s.MegaMud_CurPathStep] = kept;
    if (s.rulesChanged !== 0) [s.rules, s.ruleAt] = [rules, ruleAt];
    if (s.eventsChanged !== 0) [s.events, s.eventNext] = [events, eventNext];
    if (s.monitorsChanged !== 0) s.monitors = monitors;
    grantPlayers(s, setup.grants);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    this.outbound = [];
  }

  /**
   * Our tracker's buffs, before the chunk that may change them reaches the
   * engine. MegaMUD knows a blessing took only by a Messages.md row named
   * after its spell (`0x46a920`) and that it ended by the row's end
   * (`0x46bb70`); a realm's Messages.md names few, and without one a
   * blessing is cast again at every step. The tracker reads every way a buff
   * shows — the cast's own frame, the sentences shipped and learned, the
   * sheet, the wear-off naming the spell — so its list stands in for the
   * rows: a blessing going up (or put up again: a recast renews it) is
   * stamped as cast, and settles one awaited, as a row's start does; one
   * going down is due again, as a row's end makes it. This character's ten only: the party's four wear off on the
   * members' screens.
   */
  buffs(up: readonly ActiveBuff[]): void {
    const s = this.s;
    s.now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 10; i += 1) {
      const command = blessCommand(s, i);
      const spell = command === '' ? null : findSpell(s, command);
      const buff =
        spell === null || (spell.flags & 2) === 0
          ? undefined
          : up.find(
              (b) =>
                b.by === null &&
                (stricmp(b.spell, spell.name) === 0 ||
                  (b.candidates ?? []).some((name) => stricmp(name, spell.name) === 0))
            );
      const at = buff?.appliedAt ?? null;
      const was = this.blessUp[i] ?? null;
      this.blessUp[i] = at;
      if (at !== null && at !== was) {
        s.blessCastAt[i] = s.now;
        s.blessSeenAt[i] = s.now;
        if (s.debug !== 0) s.host.trace(`{bless-up:${spell!.name}}`);
        if (s.state === 0x10 && s.blessSlot === i) {
          s.f_a3e0 += 1;
          s.f_a3e4 += 1;
          forgetAwaited(s, 0x10);
          setState(s, 0);
        }
      } else if (at === null && was !== null) {
        s.blessCastAt[i] = 0;
        if (s.debug !== 0 && spell) s.host.trace(`{bless-down:${spell.name}}`);
      }
    }
  }

  /** Text from the socket. */
  received(text: string): void {
    dataArrived(this.quiet, Date.now());
    this.safely(() => {
      this.s.now = Math.floor(Date.now() / 1000);
      parseData(this.s, this.t, text);
    });
    this.noteRoom();
    // Into the game with nowhere known: ask once, before anything wants a way.
    if (this.s.inGame !== 0 && !this.wasInGame && this.host.here() === null) this.host.locate();
    this.wasInGame = this.s.inGame !== 0;
    if (this.parked !== null && this.host.here() !== null) this.safely(() => this.unpark());
  }

  /** A command the player typed. */
  typed(command: string): void {
    this.safely(() => typedCommand(this.s, 0, command));
  }

  connected(): void {
    this.outbound = [];
    this.parked = null;
    this.wasInGame = false;
    connected(this.s);
  }

  closed(): void {
    this.outbound = [];
    this.parked = null;
    this.safely(() => connectionClosed(this.s));
  }

  /** Go/Stop (`0x803`), Roam (`0x808`), AFK (`0x809`), Step Back (`0x869`). */
  button(command: number): void {
    this.safely(() => menuCommand(this.s, command));
  }

  /** Whether the engine is walking (Go is on). */
  get walking(): boolean {
    return this.s.walking !== 0;
  }

  /**
   * A loop chosen to walk: made the loop and walked to its start, as `@loop`
   * does (`0x4ae4a0`). Null when started, else why not.
   */
  startLoop(name: string): string | null {
    const p = this.loopPath(name);
    if (typeof p === 'string') return p;
    const s = this.s;
    clearDetours(s);
    freeSteps(s.loopPath);
    copyPath(s, s.loopPath, p, 0);
    if (goTo(s, 0, p) === 0) return `Could not head for the loop "${name}".`;
    startWalking(s);
    headFor(s, 0);
    s.f_db44 = 0;
    return null;
  }

  /** A room chosen to walk to (the Go To dialog: `0x43fc60`, `0x43d2a0` with 1). */
  walkTo(room: RoomId): string | null {
    const sig = this.signatureOf(room);
    if (sig === null) return 'That room has no signature yet.';
    clearDetours(this.s);
    goTo(this.s, sig, null);
    headFor(this.s, 1);
    return null;
  }

  private safely(run: () => unknown): void {
    if (this.disposed) return;
    try {
      run();
    } catch (error) {
      this.host.show(
        `[MegaMUD engine fault: ${error instanceof Error ? error.message : String(error)}]`
      );
    }
  }

  /** `0x42e1c0`: written in order, a `\x01` a half-second pause. */
  private write(text: string): void {
    this.outbound.push(text);
    this.pump();
  }

  private pump(): void {
    while (!this.pausing && this.outbound.length > 0) {
      const text = this.outbound[0]!;
      const pause = text.indexOf('\x01');
      if (pause === -1) {
        this.outbound.shift();
        if (text !== '') this.host.write(text);
        continue;
      }
      if (pause > 0) this.host.write(text.slice(0, pause));
      this.outbound[0] = text.slice(pause + 1);
      this.pausing = true;
      setTimeout(() => {
        this.pausing = false;
        if (!this.disposed) this.pump();
      }, 500);
    }
  }

  // ------------------------------------------------------------ signatures

  /** The engine and our tracker both stand in a room: its signature is learned. */
  private noteRoom(): void {
    const sig = this.s.f_8130;
    if (sig === 0) return;
    const here = this.host.here();
    if (here === null) return;
    if (this.learned.get(here) !== sig) this.learn(here, sig);
  }

  private learn(room: RoomId, sig: number): void {
    const was = this.learned.get(room);
    if (was !== undefined) this.learnedRooms.get(was)?.delete(room);
    this.learned.set(room, sig);
    let rooms = this.learnedRooms.get(sig);
    if (!rooms) this.learnedRooms.set(sig, (rooms = new Set()));
    rooms.add(room);
    this.know(room, sig);
  }

  /**
   * A room put in MegaMUD's room list (its Rooms.md), which is what it
   * heads for destinations from (`0x43cb90`): every room whose signature is
   * learned, and every path's start and end. A shop is marked one (flag 2).
   */
  private know(room: RoomId, sig: number): void {
    const rooms = (this.s.data.rooms ??= []);
    if (rooms.some((r) => r.signature === sig)) return;
    const [map, number] = room.split('/').map(Number);
    const rec = this.host.world()?.get(map!, number!);
    rooms.push({
      signature: sig,
      name: rec?.name ?? room,
      flags: rec?.shop !== undefined ? 2 : 0
    });
  }

  signatureOf(room: RoomId): number | null {
    const learned = this.learned.get(room);
    if (learned !== undefined) return learned;
    const [map, number] = room.split('/').map(Number);
    const rec = this.host.world()?.get(map!, number!);
    return rec ? worldSignature(rec) : null;
  }

  /** The rooms with a signature: those learned, else those worked out. */
  private roomsWith(sig: number): RoomId[] {
    const learned = this.learnedRooms.get(sig);
    if (learned && learned.size > 0) return [...learned];
    const world = this.host.world();
    if (!world) return [];
    if (this.computed === null || this.computedFor !== world) {
      this.computed = new Map();
      this.computedFor = world;
      for (const room of world.everyRoom()) {
        const at = worldSignature(room);
        if (at === null) continue;
        const id = roomId(room.map, room.room);
        const list = this.computed.get(at);
        if (list) list.push(id);
        else this.computed.set(at, [id]);
      }
    }
    return (this.computed.get(sig) ?? []).filter((id) => !this.learned.has(id));
  }

  /** A step taken from a room: its signature, or the relearn mark. */
  private stepFrom(room: RoomId | null, command: string): PathStep {
    const sig = room === null ? null : this.signatureOf(room);
    return sig === null ? { room: -1, flags: 0x80, command } : { room: sig, flags: 0, command };
  }

  private makePath(
    name: string,
    title: string,
    legs: Route[],
    start: number,
    end: number
  ): PathRec {
    const p = newPath();
    p.name = name;
    p.title = title.slice(0, 0x50);
    p.author = 'mudengine';
    const rooms: (RoomId | null)[] = [];
    const steps: PathStep[] = [];
    for (const leg of legs) {
      for (const st of leg.steps) {
        rooms.push(st.from);
        steps.push(this.stepFrom(st.from, st.command));
      }
    }
    p.steps = steps;
    p.count = steps.length;
    p.start = start;
    p.end = end;
    const first = legs[0]?.steps[0]?.from;
    const last = legs.at(-1)?.steps.at(-1)?.to;
    if (first !== undefined) this.know(first, start);
    if (last !== undefined) this.know(last, end);
    this.made.set(name.toLowerCase(), { path: p, rooms });
    return p;
  }

  // ------------------------------------------------------------ the host's paths

  /** `0x43fd90`, ours: the way from here to the room with signature `to`. */
  private route(from: number, to: number): RouteFound {
    const none: RouteFound = { flags: 1, path: null, steps: -1 };
    const here = this.host.here();
    if (here === null) {
      // Not placed: ask the realm and put the walk aside rather than answer
      // "no way", which sends MegaMUD wandering to find a room it knows.
      // Cancelled (0x20) for now; the destinations come back with the answer.
      const gaveUp = this.locateGaveUp;
      this.locateGaveUp = false;
      if (gaveUp || this.parked !== null || !this.host.locate()) return none;
      const s = this.s;
      this.parked = {
        detours: structuredClone(s.detours),
        walking: s.walking,
        looping: s.looping,
        roaming: s.roaming,
        lost: s.lost,
        until: Date.now() + LOCATE_WAIT_MS
      };
      return { flags: 0x20, path: null, steps: -1 };
    }
    let best: Route | null = null;
    for (const room of this.roomsWith(to).slice(0, 8)) {
      if (room === here)
        return { flags: 0, path: this.makePath(this.routeName(), 'route', [], from, to), steps: 0 };
      const plan = this.host.plan(here, room);
      if (typeof plan === 'string' || plan.blocked) continue;
      if (best === null || plan.steps.length < best.steps.length) best = plan;
    }
    if (best === null) return none;
    const p = this.makePath(this.routeName(), 'route', [best], from, to);
    if (p.steps!.length > 0) p.steps![0]!.room = from;
    return { flags: 0, path: p, steps: p.count };
  }

  private routeName(): string {
    this.routes = (this.routes + 1) % 0x1000000;
    return `~R${this.routes.toString(16).padStart(6, '0')}`;
  }

  /** One of our loops as a MegaMUD loop: start and end its first stop. */
  private loopPath(name: string): PathRec | string {
    const known = this.made.get(shortName('L', name).toLowerCase());
    if (known) return known.path;
    const stops = this.host.loopRooms(name);
    if (typeof stops === 'string') return stops;
    const rooms = stops.bounce
      ? [...stops.rooms, ...stops.rooms.slice(1, -1).reverse()]
      : stops.rooms;
    if (rooms.length < 2) return `The loop "${name}" has fewer than two stops.`;
    const start = this.signatureOf(rooms[0]!);
    if (start === null) return `The loop "${name}" starts in a room with no signature yet.`;
    const legs: Route[] = [];
    for (let i = 0; i < rooms.length; i += 1) {
      const from = rooms[i]!;
      const to = rooms[(i + 1) % rooms.length]!;
      if (from === to) continue;
      const plan = this.host.plan(from, to);
      if (typeof plan === 'string') return plan;
      if (plan.blocked) return plan.reason ?? `No way from ${from} to ${to}.`;
      legs.push(plan);
    }
    const p = this.makePath(shortName('L', name), name, legs, start, start);
    if (!this.s.paths.includes(p)) this.s.paths.push(p);
    return p;
  }

  /**
   * The walk put aside taken up again (`0x43d2a0` from the walk), now the
   * room is known or the realm has not said; in the second case the way is
   * answered as MegaMUD would without one.
   */
  private unpark(): void {
    const parked = this.parked;
    if (parked === null) return;
    this.parked = null;
    const s = this.s;
    if (this.host.here() === null) this.locateGaveUp = true;
    s.detours = parked.detours;
    s.walking = parked.walking;
    s.looping = parked.looping;
    s.roaming = parked.roaming;
    s.lost = parked.lost;
    headFor(s, 0);
  }

  private parkedTimeout(): void {
    if (this.parked !== null && Date.now() >= this.parked.until) this.unpark();
  }

  /** `0x482fc0`'s file: a path made here, by name. */
  private readPath(name: string): PathRec | null {
    return this.made.get(name.toLowerCase())?.path ?? null;
  }

  /** `0x4888e0`: a relearned step's room kept, for every path through it. */
  private saveSteps(p: PathRec): number {
    const made = this.made.get(p.name.toLowerCase());
    if (!made || !p.steps) return 0;
    p.steps.forEach((st, i) => {
      const room = made.rooms[i];
      if (room && st.room !== -1 && (st.flags & 0x80) === 0) this.learn(room, st.room);
    });
    made.path.steps = p.steps.map((st) => ({ ...st }));
    return 1;
  }
}
