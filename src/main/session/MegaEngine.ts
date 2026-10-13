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

import { stricmp } from '../megamud/cstr';
import type { MegaData } from '../megamud/data';
import { applyItemRule } from '../megamud/fromWorld';
import { bbsSetup } from '../megamud/bbs';
import { grantPlayers, loadCharacter } from '../megamud/character';
import { newTerminal, parseData, type TerminalState } from '../megamud/input/ParseData';
import { typedCommand } from '../megamud/input/typed';
import { menuCommand } from '../megamud/move/buttons';
import { blessCommand } from '../megamud/player/cast';
import { clearDetours, goTo, headFor, startWalking } from '../megamud/move/destinations';
import { copyPath, freeSteps } from '../megamud/move/path';
import { connected, connectFailed, connectionClosed } from '../megamud/script/game';
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
import { findLongestFirst } from '../megamud/room/checkNames';
import { setTask } from '../megamud/script/task';
import {
  rememberItem,
  rememberPlayers,
  rememberRule,
  rememberStance,
  savedItems,
  savedStances
} from '../megamud/saved';
import { itemKey, type ItemRule } from '../../shared/itemRules';
import type { MonsterRule, Relationship } from '../../shared/monsterRules';
import type { PlayerFacts } from '../../shared/players';
import type { LearnedItem } from '../world/MegaLearned';
import type { ActiveBuff } from '../../shared/character';
import type { MegaSettings } from '../../shared/megamud/settings';
import {
  MEGA_TOGGLES,
  shownToggles,
  type MegaToggle,
  type MegaToggles
} from '../../shared/megamud/toggles';
import type { RemoteName } from '../../shared/remotes';
import { IDLE_WALK, type WalkProgress } from '../../shared/walk';
import { NO_LOOP, type LoopProgress } from '../../shared/loops';
import {
  asRoomReference,
  DIRECTIONS,
  roomId,
  spellLasts,
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
  /** One of MegaMUD's alerts, where it would play its sound. See `MegaEngine.alert`. */
  alert?(which: MegaAlert): void;
  /** Its toggles changed (`0x460d50` redraws the toolbar): see `MegaEngine.toggles`. */
  toggled?(): void;
  /** Its walk or loop moved on, as the cards draw them: see `MegaEngine.progress`. */
  progressed?(walk: WalkProgress, loop: LoopProgress): void;
  /** It began or stopped waiting to dial back: see `MegaEngine.redialing`. */
  redialChanged?(): void;
}

/** One of our loops made a MegaMUD loop: its stops, and the step each leg to the next begins at. */
interface MadeLoop {
  name: string;
  /** The stops as walked, a bounce loop's way back included. */
  stops: RoomId[];
  /** How many stops the loop itself lists: past them, a bounce loop is on its way back. */
  listed: number;
  bounce: boolean;
  /** `begins[i]`: the step the leg out of stop `i` begins at. */
  begins: number[];
}

/** A path the engine made from one of our routes or loops, with the room each step is taken from. */
interface MadePath {
  path: PathRec;
  rooms: (RoomId | null)[];
  /** The room it ends in. */
  end: RoomId | null;
  loop: MadeLoop | null;
}

export interface MegaEngineSetup {
  settings: MegaSettings;
  data: MegaData;
  /** The app's per-player remote grants (`automation.remotes.players`). */
  grants: Readonly<Record<string, { allow: readonly RemoteName[]; deny: readonly RemoteName[] }>>;
  /** Signatures learned before, by room. */
  learned?: ReadonlyMap<RoomId, number>;
  /** What it knows from before, from our stores, and where what it learns goes. */
  memory?: EngineMemory;
  /** The realm's `BBS.INI` keys we hold elsewhere: `RunicName` from its `coins:`. */
  bbs?: Readonly<Record<string, string>>;
}

/**
 * What the engine starts from beside the realm's `.md` data, out of our own
 * stores, and where what it learns in play is kept (see `megamud/saved.ts`).
 */
export interface EngineMemory {
  /** Monsters' stances learned before (`RealmLore`), by name. */
  stances: ReadonlyMap<string, Relationship>;
  /** The players this realm has seen (`PlayerBook`). */
  players: readonly PlayerFacts[];
  /** Items learned before (`MegaLearned`). */
  items: readonly LearnedItem[];
  /** Room signatures learned before (`MegaLearned`). */
  signatures: readonly [RoomId, number][];
  keep(lessons: EngineLessons): void;
}

/** What the engine learned since it last said: MegaMUD's marked databases, in our shapes. */
export interface EngineLessons {
  stances: [string, Relationship][];
  items: LearnedItem[];
  signatures: [RoomId, number][];
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

/** MegaMUD's alerts (`0x4c0640`'s callers), each the `[Alerts]` key naming its sound. */
export const MEGA_ALERTS = {
  idle: 'AlertIdle',
  train: 'AlertTrain',
  lowHp: 'AlertLowHPs',
  hangup: 'AlertHangup',
  playerEntered: 'AlertPvP',
  telepath: 'AlertTele',
  page: 'AlertPage',
  say: 'AlertTalk',
  gangpath: 'AlertGangpath',
  gossip: 'AlertGossip',
  auction: 'AlertAuction',
  broadcast: 'AlertBroadcast'
} as const;

export type MegaAlert = keyof typeof MEGA_ALERTS;

/** The session fields the toolbar's toggles flip, kept across a settings reload. */
const TOGGLE_FIELDS = [
  'f_a32c',
  'MegaMud_AutoCombat',
  'MegaMud_AutoPreAttack',
  'f_8be8',
  'MegaMud_AutoNuke',
  'MegaMud_AutoHeal',
  'MegaMud_AutoBless',
  'MegaMud_AutoLight',
  'MegaMud_AutoGet',
  'MegaMud_AutoCash',
  'MegaMud_AutoSneak',
  'MegaMud_AutoHide',
  'MegaMud_AutoSearch',
  'MegaMud_AutoTrack',
  'active'
] as const;

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
  private readonly made = new Map<string, MadePath>();
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
  /** The toggles as last said (`noteToggles`). */
  private toggled = '';
  /** The realm's own word on which spells last has been put on the spell list. */
  private lastingMarked = false;
  /** The walk and loop as last said (`noteProgress`). */
  private progressed = '';
  /** Waiting to redial, as last said. */
  private wasRedialing = false;
  /**
   * The run of a loop: when it was started, and when it first stood on the
   * loop itself rather than on the way out to it. Null with no loop taken up.
   */
  private loopRun: { name: string; startedAt: number; lapBegunAt: number | null } | null = null;
  /** The toggles this character's `[Toolbar]` shows. */
  private shown: MegaToggle[];
  /** The character's `[Alerts]`: the sound each alert plays. */
  private alerts: Readonly<Record<string, unknown>>;
  /** Where what is learned is kept; null when nowhere. */
  private readonly memory: EngineMemory | null;
  /** Signatures learned since they were last kept. */
  private readonly unkept = new Map<RoomId, number>();
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
      alert: (which) => this.alert(which),
      message: (text) => this.host.show(`[${text}]`),
      ask: (text) => this.host.ask?.(text) ?? false,
      post: (command) => queueMicrotask(() => !this.disposed && menuCommand(this.s, command)),
      hangUp: () => this.host.hangUp(),
      dial: () => this.host.dial(),
      route: (from, to) => this.route(from, to),
      readPath: (name) => this.readPath(name),
      saveSteps: (p) => this.saveSteps(p),
      blessingsCleared: () => this.blessingsCleared()
    };
    this.memory = setup.memory ?? null;
    this.shown = shownToggles(setup.settings.live['Toolbar']);
    this.alerts = setup.settings.live['Alerts'] ?? {};
    // A copy: the data read is shared between sessions, and the engine changes it as it learns.
    this.s = new Session(engineHost, structuredClone(setup.data));
    loadCharacter(this.s, setup.settings);
    bbsSetup(this.s, (key) => setup.bbs?.[key]);
    this.s.now = engineHost.clock();
    const memory = setup.memory;
    if (memory) {
      for (const [name, relationship] of memory.stances) rememberStance(this.s, name, relationship);
      for (const item of memory.items) rememberItem(this.s, item);
      rememberPlayers(this.s, memory.players);
    }
    grantPlayers(this.s, setup.grants);
    findLongestFirst(this.s);
    for (const [room, sig] of memory?.signatures ?? []) this.learn(room, sig);
    for (const [room, sig] of setup.learned ?? []) this.learn(room, sig);
    this.unkept.clear();
    this.quiet = newQuietClock(Date.now());
    this.timers.push(
      setInterval(
        () =>
          this.safely(() => {
            secondTick(this.s);
            this.keepLearned();
            this.noteToggles();
          }),
        SECOND_MS
      ),
      setInterval(() => this.safely(() => quietTick(this.s, this.t, this.quiet)), QUIET_POLL_MS),
      setInterval(() => this.safely(() => this.parkedTimeout()), QUIET_POLL_MS)
    );
  }

  /**
   * Our monster table, the realm's rows with the character's own laid over
   * them, written onto MegaMUD's monster records over what the realm's
   * `Monsters.md` and the lore said: the player's word is the last.
   */
  useMonsters(rules: readonly MonsterRule[]): void {
    for (const rule of rules) rememberRule(this.s, rule);
    findLongestFirst(this.s);
  }

  /**
   * Our item table put on MegaMUD's item records as its item details would
   * have edited them, an item the records do not name added: a table edited
   * while the character plays reaches it, as the monster table does.
   */
  useItems(rules: readonly ItemRule[]): void {
    for (const rule of rules) {
      let rec = this.s.data.items.find((item) => itemKey(item.name) === rule.item);
      if (!rec) {
        rememberItem(this.s, { name: rule.item, weight: null, slot: null, weapon: false });
        rec = this.s.data.items.find((item) => itemKey(item.name) === rule.item)!;
      }
      applyItemRule(rec, rule, this.host.world());
    }
  }

  /**
   * The settings changed (`megamud.ini` edited): put on the running session,
   * as MegaMUD's settings dialog changes the struct in place, the path
   * walked and the loop kept.
   */
  reload(setup: MegaEngineSetup): void {
    this.shown = shownToggles(setup.settings.live['Toolbar']);
    this.alerts = setup.settings.live['Alerts'] ?? {};
    this.toggled = '';
    const s = this.s;
    const kept = [s.MegaMud_CurPath, s.MegaMud_SelPath, s.MegaMud_CurPathStep] as const;
    const { rules, ruleAt, events, eventNext, monitors } = s;
    // The toggles as they stand: MegaMUD's dialog edits them in place, and
    // they are the toolbar's, not the file's.
    const toggles = TOGGLE_FIELDS.map((field) => s[field]);
    loadCharacter(s, setup.settings);
    bbsSetup(s, (key) => setup.bbs?.[key]);
    [s.MegaMud_CurPath, s.MegaMud_SelPath, s.MegaMud_CurPathStep] = kept;
    TOGGLE_FIELDS.forEach((field, i) => (s[field] = toggles[i]!));
    if (s.rulesChanged !== 0) [s.rules, s.ruleAt] = [rules, ruleAt];
    if (s.eventsChanged !== 0) [s.events, s.eventNext] = [events, eventNext];
    if (s.monitorsChanged !== 0) s.monitors = monitors;
    grantPlayers(s, setup.grants);
    this.noteToggles();
  }

  /**
   * The databases MegaMUD marked changed (`0xe24c` players, `0xe254`
   * monsters, `0xe258` items) and the signatures learned since, handed to be
   * kept: `0x43bfa0`, which MegaMUD runs on the way out, run here as soon as
   * something is marked, and on the way out as well.
   */
  private keepLearned(): void {
    const s = this.s;
    if (this.memory === null) return;
    if (s.f_e24c === 0 && s.f_e254 === 0 && s.f_e258 === 0 && this.unkept.size === 0) return;
    const lessons: EngineLessons = {
      stances: s.f_e254 !== 0 ? savedStances(s) : [],
      items: s.f_e258 !== 0 ? savedItems(s) : [],
      signatures: [...this.unkept]
    };
    // Players are our tracker's to keep (`PlayerBook`): the mark is only cleared.
    s.f_e24c = 0;
    s.f_e254 = 0;
    s.f_e258 = 0;
    this.unkept.clear();
    this.memory.keep(lessons);
  }

  dispose(): void {
    this.safely(() => this.keepLearned());
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
    this.markLasting();
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

  /**
   * Spells.md's lasting bit (`2`, which a blessing needs) set on every spell
   * the realm's own spell table says lasts, once that table is loaded. A
   * MegaMUD database can miss it: the shipped one has necropotence, which
   * lasts, without it, so it was never cast as a blessing (2026-10-13).
   */
  private markLasting(): void {
    if (this.lastingMarked) return;
    const world = this.host.world();
    if (!world) return;
    this.lastingMarked = true;
    for (const spell of this.s.data.spells) {
      if ((spell.flags & 2) !== 0) continue;
      const known = world.spellNamed(spell.name);
      if (known !== null && spellLasts(known)) spell.flags |= 2;
    }
  }

  /**
   * The `stat` display took every blessing as gone. The display goes on to
   * print each effect still up, and our tracker has read it whole before the
   * engine sees it: the blessings it has up are seen again, as each one's
   * row would see it on the display (`0x46a920`).
   */
  private blessingsCleared(): void {
    const s = this.s;
    for (let i = 0; i < 10; i += 1) {
      if (this.blessUp[i] !== null && this.blessUp[i] !== undefined) s.blessCastAt[i] = s.now;
    }
  }

  /**
   * A stat sheet wanted, as MegaMUD wants one after a level or a death
   * (`0xe29c`): sent by `0x40d0e0` when its scheduler next may, out of a fight.
   */
  wantStat(): void {
    if (this.s.f_e29c === 0) this.s.f_e29c = 1;
  }

  /**
   * Waiting to dial back (`0xe544` 3, task 9), as `0x4653d0` counts down
   * `Comms.RedialPause` after a drop, a full game or a stuck log-on.
   */
  get redialing(): boolean {
    return this.s.f_e544 === 3 && this.s.task === 9;
  }

  /** Seconds until that redial, 0 when none is waited on. */
  get redialIn(): number {
    return this.redialing ? Math.max(0, this.s.f_32298 - this.s.host.clock()) : 0;
  }

  /** A dial failed: redialled by MegaMUD's rule for that (`0x4b71d0`). */
  connectFailed(): void {
    this.safely(() => connectFailed(this.s));
    this.noteToggles();
  }

  /** The redial waited on called off, the player's Disconnect: offline, idle (task `0x14`). */
  cancelRedial(): void {
    if (!this.redialing) return;
    this.s.f_e544 = 0;
    setTask(this.s, 0x14);
    this.noteToggles();
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
    this.noteToggles();
  }

  /**
   * The toggles as MegaMUD's window draws them (`0x460d50`), which this
   * character's toolbar shows, and whether it is walking: with All Off on,
   * every other toggle reads off and Go is not to be pressed.
   */
  get toggles(): MegaToggles {
    const s = this.s;
    const allOff = s.f_a32c !== 0;
    const lit = (value: number): boolean => !allOff && value !== 0;
    const on: Record<MegaToggle, boolean> = {
      allOff,
      combat: lit(s.MegaMud_AutoCombat),
      preAttack: lit(s.MegaMud_AutoPreAttack),
      melee: lit(s.f_8be8),
      nuke: lit(s.MegaMud_AutoNuke),
      heal: lit(s.MegaMud_AutoHeal),
      bless: lit(s.MegaMud_AutoBless),
      light: lit(s.MegaMud_AutoLight),
      get: lit(s.MegaMud_AutoGet),
      cash: lit(s.MegaMud_AutoCash),
      sneak: lit(s.MegaMud_AutoSneak),
      hide: lit(s.MegaMud_AutoHide),
      search: lit(s.MegaMud_AutoSearch),
      afk: lit(s.active)
    };
    // `0x803`'s Go finds nothing to walk without a destination or roaming.
    const somewhere = s.detours[0]!.room !== 0 || s.detours[0]!.path !== '' || s.roaming !== 0;
    return {
      on,
      shown: this.shown,
      walking: s.walking !== 0,
      looping: s.looping !== 0,
      canGo: s.inGame !== 0 && !allOff && somewhere
    };
  }

  /**
   * The engine's walk and loop as the cards draw them, in place of the
   * walker's and loop runner's, which stand idle while it walks: the path
   * walked (`0xe39c`) and the step reached, the loop (`0xe4a4`), and its laps
   * (`0xdb44`, counted as `0x43d2a0` takes the loop up again).
   */
  get progress(): { walk: WalkProgress; loop: LoopProgress } {
    const s = this.s;
    const walking = s.walking !== 0;
    const made = this.made.get(s.path.name.toLowerCase()) ?? null;
    const lap = this.made.get(s.loopPath.name.toLowerCase())?.loop ?? null;
    const run = this.loopRun !== null && lap !== null && lap.name === this.loopRun.name;
    const holding = s.inCombat !== 0 ? 'fight' : s.resting !== 0 ? 'resting' : null;

    let loop: LoopProgress = NO_LOOP;
    if (run && lap !== null) {
      const onLoop = made?.loop === lap;
      // The stop the leg being walked leads to, as the loop lists it.
      const leg = onLoop ? lap.begins.findLastIndex((at) => at <= s.path.at) : -1;
      const next = onLoop ? (Math.max(leg, 0) + 1) % lap.stops.length : 0;
      const back = lap.bounce && next >= lap.listed;
      // One-based, as the loop runner counts.
      const stop = (back ? lap.stops.length - next : next) + 1;
      loop = {
        status: walking ? 'running' : 'stopped',
        name: lap.name,
        stop,
        stops: lap.listed,
        stopName: this.roomName(lap.stops[next] ?? null),
        remainingStops: onLoop ? lap.stops.slice(next) : [...lap.stops],
        stopNames: lap.stops.slice(0, lap.listed).map((room) => this.roomName(room) ?? room),
        laps: Math.max(0, s.f_db44),
        reason: null,
        hold: walking && holding !== null ? (holding === 'fight' ? 'fight' : 'health') : null,
        startedAt: this.loopRun!.startedAt,
        lapBegunAt: this.loopRun!.lapBegunAt,
        expAtStart: null,
        forward: !back,
        bounce: lap.bounce
      };
    }

    let walk: WalkProgress = IDLE_WALK;
    const steps = made?.path.steps ?? null;
    if (made !== null && steps !== null && s.lost === 0 && s.roaming === 0) {
      const at = s.path.at;
      // A lap's leg runs to its next stop; a route to its end.
      const legEnd = made.loop
        ? (made.loop.begins.find((begin) => begin > at) ?? made.rooms.length)
        : made.rooms.length;
      const rooms = made.rooms.slice(at, legEnd).filter((room): room is RoomId => room !== null);
      const end = made.loop ? (made.rooms[legEnd] ?? made.end) : made.end;
      if (end !== null && rooms.at(-1) !== end) rooms.push(end);
      const arrived = at >= made.path.count;
      const status = walking ? 'walking' : arrived ? 'arrived' : 'stopped';
      if (walking || !run) {
        const to = made.rooms[at + 1] ?? made.end;
        walk = {
          status,
          asked: made.loop === null && !run,
          done: Math.min(at, made.path.count),
          total: made.path.count,
          destination: this.roomName(end),
          destinationRoom: end === null ? null : asRoomReference(end),
          step:
            walking && steps[at] !== undefined
              ? {
                  command: steps[at].command,
                  name: this.roomName(to) ?? '',
                  note: null,
                  to: to === null ? null : asRoomReference(to)
                }
              : null,
          path: walking ? rooms : [],
          ahead: walking ? rooms.slice(1).map((room) => this.roomName(room) ?? room) : [],
          reason: null,
          hold: walking ? holding : null
        };
      }
    }
    return { walk, loop };
  }

  /** A room's name, from the realm's data. */
  private roomName(room: RoomId | null): string | null {
    const place = room === null ? null : asRoomReference(room);
    if (place === null) return null;
    return this.host.world()?.get(place.map, place.room)?.name ?? room;
  }

  /** Says so when the walk or the loop moved on: a step, a stop, a lap, a fight. */
  private noteProgress(): void {
    const s = this.s;
    const lap = this.made.get(s.loopPath.name.toLowerCase())?.loop ?? null;
    // A loop MegaMUD took up itself (a remote's `@loop`, a destination done) is a run too.
    if (this.loopRun === null && s.looping !== 0 && lap !== null) {
      this.loopRun = { name: lap.name, startedAt: Date.now(), lapBegunAt: null };
    }
    if (this.loopRun !== null && this.loopRun.lapBegunAt === null && s.looping !== 0) {
      this.loopRun.lapBegunAt = Date.now();
    }
    const { walk, loop } = this.progress;
    const now = JSON.stringify([walk, loop]);
    if (now === this.progressed) return;
    this.progressed = now;
    this.host.progressed?.(walk, loop);
  }

  /** Says so when the toggles or the walking moved since last said: a press, a mode's defaults, a remote, a step. */
  private noteToggles(): void {
    this.noteProgress();
    if (this.redialing !== this.wasRedialing) {
      this.wasRedialing = this.redialing;
      this.host.redialChanged?.();
    }
    const { on, walking, looping, canGo } = this.toggles;
    const now = JSON.stringify([on, walking, looping, canGo]);
    if (now === this.toggled) return;
    this.toggled = now;
    this.host.toggled?.();
  }

  /**
   * `0x4c0640`: one of MegaMUD's alerts. It plays the sound `[Alerts]` names
   * for it — with sound on, a sound named, and (with `AlertWhenAfk`) only
   * while AFK; here the host is told where it would.
   */
  private alert(which: string): void {
    const key = (MEGA_ALERTS as Record<string, string>)[which];
    if (key === undefined) return;
    const s = this.s;
    if (s.MegaMud_Sound === 0 || (s.Alerts_AlertWhenAfk === 1 && s.active === 0)) return;
    if (String(this.alerts[key] ?? '').trim() === '') return;
    this.host.alert?.(which as MegaAlert);
  }

  /** A toolbar toggle pressed: its window command. */
  toggle(name: MegaToggle): void {
    const toggle = MEGA_TOGGLES.find((t) => t.name === name);
    if (toggle) this.button(toggle.command);
  }

  /** A command the player typed. */
  typed(command: string): void {
    this.playerSent();
    this.safely(() => typedCommand(this.s, 0, command));
    this.noteToggles();
  }

  /**
   * The player sent a line, a bare Enter among them. MegaMUD sends the
   * player's line itself (`0x48e7f0` → `0x42d9f0`), which stamps the clock
   * its re-prompt counts from: a bare Enter after `LagWait` + 15 seconds
   * with nothing sent (`0x4653d0`). Ours go out past it, so it is stamped here.
   */
  playerSent(): void {
    this.s.now = Math.floor(Date.now() / 1000);
    this.s.f_322a0 = this.s.now;
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
    this.safely(() => this.keepLearned());
  }

  /** Go/Stop (`0x803`), Roam (`0x808`), AFK (`0x809`), Step Back (`0x869`). */
  button(command: number): void {
    this.safely(() => menuCommand(this.s, command));
    this.noteToggles();
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
    this.loopRun = { name, startedAt: Date.now(), lapBegunAt: null };
    this.noteToggles();
    return null;
  }

  /** A room chosen to walk to (the Go To dialog: `0x43fc60`, `0x43d2a0` with 1). */
  walkTo(room: RoomId): string | null {
    const sig = this.signatureOf(room);
    if (sig === null) return 'That room has no signature yet.';
    clearDetours(this.s);
    goTo(this.s, sig, null);
    headFor(this.s, 1);
    // A route taken in place of the loop: MegaMUD walks it and then the loop
    // again, but the run the card counted is over.
    this.loopRun = null;
    this.noteToggles();
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
    if (was !== sig) this.unkept.set(room, sig);
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
   * learned, and every path's start and end. A shop is marked one (flag 2)
   * and named as the realm names the shop, which is what an item's
   * *Bought/sold* holds (`megamud/fromWorld.ts`).
   */
  private know(room: RoomId, sig: number): void {
    const rooms = (this.s.data.rooms ??= []);
    if (rooms.some((r) => r.signature === sig)) return;
    const [map, number] = room.split('/').map(Number);
    const world = this.host.world();
    const rec = world?.get(map!, number!);
    const shop = rec?.shop === undefined ? undefined : world?.shop(rec.shop);
    rooms.push({
      signature: sig,
      name: shop?.name.trim() ?? rec?.name ?? room,
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
    this.made.set(name.toLowerCase(), { path: p, rooms, end: last ?? null, loop: null });
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
    const begins: number[] = [];
    let steps = 0;
    for (let i = 0; i < rooms.length; i += 1) {
      begins.push(steps);
      const from = rooms[i]!;
      const to = rooms[(i + 1) % rooms.length]!;
      if (from === to) continue;
      const plan = this.host.plan(from, to);
      if (typeof plan === 'string') return plan;
      if (plan.blocked) return plan.reason ?? `No way from ${from} to ${to}.`;
      legs.push(plan);
      steps += plan.steps.length;
    }
    const p = this.makePath(shortName('L', name), name, legs, start, start);
    this.made.get(p.name.toLowerCase())!.loop = {
      name,
      stops: rooms,
      listed: stops.rooms.length,
      bounce: stops.bounce,
      begins
    };
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
