/**
 * The ported MegaMUD engine (`src/main/megamud/`) run for one connection:
 * raw text in, commands out, its clocks kept, and its paths planned by our
 * world graph (docs/megamud/engine-port.md, Walking).
 *
 * **Every character runs on it** (2026-10-14). The old automation stands
 * down (`SessionManager.configure`); the login, the display, the map and the
 * planners stay ours.
 *
 * **Paths.** MegaMUD walks paths whose steps name the room each is taken
 * from by its signature (`roomSignature`: the name's hash in the top twelve bits,
 * two bits an exit). A room's signature is learned whenever the engine and
 * our tracker stand in it together; until then it is worked out from the
 * realm data, and a room whose exits the realm data cannot say how the game
 * prints is given MegaMUD's own "relearn" mark (step flag `0x80`), which
 * the walk fills in the first time through ("[Path step updated]").
 */

import { stricmp, typedDirection } from '../megamud/cstr';
import {
  findClass,
  type ItemRec,
  type MegaData,
  type MonsterRec,
  type SpellRec
} from '../megamud/data';
import { applyItemRule } from '../megamud/fromWorld';
import { bbsSetup } from '../megamud/bbs';
import { grantPlayers, loadCharacter } from '../megamud/character';
import { newTerminal, parseData, type TerminalState } from '../megamud/input/ParseData';
import { typedCommand } from '../megamud/input/typed';
import { disconnect, menuCommand, playerCommand, playerKey } from '../megamud/move/buttons';
import { blessCommand } from '../megamud/player/cast';
import { clearDetours, goTo, headFor, startWalking } from '../megamud/move/destinations';
import { clearPath, copyPath, freeSteps } from '../megamud/move/path';
import { depositAll } from '../megamud/items/all';
import { connected, connectFailed, connectionClosed } from '../megamud/script/game';
import { reEngage } from '../megamud/script/modes';
import { queue, send, wake } from '../megamud/script/send';
import { startRun } from '../megamud/script/run';
import { tuning } from '../app/tuning';
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
import { setTask, Task } from '../megamud/script/task';
import {
  monsterRecords,
  rememberItem,
  rememberPlayers,
  rememberRule,
  ruleOnto,
  rememberStance,
  savedItems,
  savedStances
} from '../megamud/saved';
import { ITEM_FLAG_BITS, itemKey, type ItemRule } from '../../shared/itemRules';
import type { MonsterRule, Relationship } from '../../shared/monsterRules';
import type { PlayerFacts } from '../../shared/players';
import type { LearnedItem, LearnedMark } from '../world/MegaLearned';
import type { ActiveBuff, Affliction } from '../../shared/character';
import type { MegaSettings } from '../../shared/megamud/settings';
import { MEGA_TOGGLES, type MegaToggle, type MegaToggles } from '../../shared/megamud/toggles';
import type { MegaChoices } from '../../shared/ipc';
import type { BotCommand, PlayerGrant } from '../../shared/remotes';
import { IDLE_WALK, type WalkProgress } from '../../shared/walk';
import { NO_LOOP, type LoopProgress } from '../../shared/loops';
import {
  asRoomReference,
  DIRECTIONS,
  forcibleBy,
  mobKey,
  roomId,
  spellLasts,
  type RequirementKind,
  type Route,
  type RouteStep,
  type RoomId,
  type WorldRoom
} from '../../shared/world';
import type { WorldGraph } from '../world/WorldGraph';
import { State } from '../megamud/states';
import { SpellFlag, ItemFlag, StepFlag, RouteFlag, Exit, Darkness } from '../megamud/flags';

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
  /**
   * The shortest walkable way between two rooms, planned off main's thread
   * (`RoutePlanner`); a string when there is nothing to plan on.
   */
  plan(from: RoomId, to: RoomId): Promise<Route> | string;
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
  /**
   * A step of its path is about to go into `to`: what is kept beside the
   * engine queues a command for that room first (`MegaEngine.queue`), which
   * holds the step until it is sent. See `SessionHost.beforeStep`.
   */
  beforeStep?(to: RoomId): void;
  /** The character is in the game (`0x47b070`'s first prompt), after its own `On entry` start. */
  enteredGame?(): void;
  /**
   * Ours: what a refused way needs (the key to a door, an item an exit asks
   * for) fetched by the item errand, and `then` taken up once it is carried.
   */
  fetchFirst?(items: ReadonlyArray<{ id: number; name: string }>, then: AfterFetch): void;
  /**
   * Ours: an item on the floor taken whatever the item rules say, because it
   * opens a way of this realm and the pack lacks it (`movement.collectKeys`).
   */
  opensAWay?(name: string): boolean;
}

/** What a fetch for a refused way takes up once the pack holds what it needed. */
export type AfterFetch = { walkTo: RoomId } | { loop: string };

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
  /** The planner's step each path step walks (null for a lever's pull), for `clearWay`. */
  walked: (RouteStep | null)[];
  /** The room it ends in. */
  end: RoomId | null;
  loop: MadeLoop | null;
}

export interface MegaEngineSetup {
  settings: MegaSettings;
  data: MegaData;
  /** The app's per-player remote grants (`automation.remotes.players`). */
  grants: Readonly<Record<string, PlayerGrant>>;
  /** Join When Invited (`automation.remotes.autoJoin`): joining a player granted `join` who invites. */
  joinWhenInvited?: boolean;
  /** The player's own commands others may ask for (`automation.remotes.commands`). */
  botCommands?: readonly BotCommand[];
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
  /** The monsters this character marked before (`0x471060`'s list, `MegaLearned`). */
  marks?: readonly LearnedMark[];
  keep(lessons: EngineLessons): void;
}

/** What the engine learned since it last said: MegaMUD's marked databases, in our shapes. */
export interface EngineLessons {
  stances: [string, Relationship][];
  items: LearnedItem[];
  signatures: [RoomId, number][];
  /** The marks list whole, when it changed; null when not. */
  marks: LearnedMark[] | null;
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

/** The session field each toolbar toggle shows. */
const TOGGLE_FIELD = {
  noHangup: 'MegaMud_NoHangup',
  allOff: 'allOff',
  combat: 'MegaMud_AutoCombat',
  preAttack: 'MegaMud_AutoPreAttack',
  melee: 'preferMelee',
  nuke: 'MegaMud_AutoNuke',
  heal: 'MegaMud_AutoHeal',
  bless: 'MegaMud_AutoBless',
  light: 'MegaMud_AutoLight',
  get: 'MegaMud_AutoGet',
  cash: 'MegaMud_AutoCash',
  sneak: 'MegaMud_AutoSneak',
  hide: 'MegaMud_AutoHide',
  search: 'MegaMud_AutoSearch',
  afk: 'active'
} as const satisfies Record<MegaToggle, keyof Session>;

/** The fields the toggles flip, Auto-Track's among them, kept across a settings reload. */
const TOGGLE_FIELDS = [...Object.values(TOGGLE_FIELD), 'MegaMud_AutoTrack'] as const;

/** MegaMUD's once-a-second timer (`WM_TIMER` 100, set to 1000 ms). */
const SECOND_MS = 1000;
/**
 * How often the network thread's quiet checks run here. Its own loop sleeps
 * 10 ms between reads (`0x42c910`); every check it makes is a second or more
 * apart, so a quarter of a second loses nothing.
 */
const QUIET_POLL_MS = 250;

/** The afflictions MegaMUD has a cure command for, by its session's flag. */
const CURED_AFFLICTIONS = ['blind', 'poisoned', 'diseased', 'held'] as const;
type CuredAffliction = (typeof CURED_AFFLICTIONS)[number];
/**
 * The session flag each takes. Disease takes ours, which only the cures read:
 * MegaMUD rests while its own is up, for a row a realm's Messages.md marks
 * diseased, and Fatty stood still through every disease ours heard (2026-10-16).
 */
const AFFLICTION_FLAG = {
  blind: 'blind',
  poisoned: 'poisoned',
  diseased: 'diseaseHeard',
  held: 'held'
} as const satisfies Record<CuredAffliction, keyof Session>;

/** How long a walk waits on the realm saying where the character is. */
const LOCATE_WAIT_MS = 5000;

/** Ours, not MegaMUD's: `automation.safety.fleeGoto`, the `sys goto` escape. See `useFlee`. */
export interface FleeGoto {
  belowHealth: number;
  destination: string;
}
/** How long a way planned is used again before it is planned afresh. */
const PLAN_KEPT_MS = 60_000;

/** How many MegaMUD path steps a route is written as: each step, and each lever pulled on the way. */
function pathLength(route: Route): number {
  return route.steps.reduce((n, step) => n + 1 + (step.pull?.say.length ?? 0), 0);
}

/**
 * How many times the levers in an exit's own room are pulled, and the exit
 * searched for, before the door code has it: the old walker's budget
 * (`walk.leverTries`, `walk.searchTries`, both 2 when retired).
 */
const LEVER_TRIES = 2;
const SEARCH_TRIES = 2;

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
    /** Put aside for a way being planned (`route`), not for the room being located. */
    planning: boolean;
  } | null = null;
  /**
   * Ways planned (`plan`), by `from>to`: the route answered, or `pending`
   * while the planner's thread works on it.
   */
  private readonly plans = new Map<string, { route: Route; at: number } | 'pending'>();
  /** A loop asked for while its legs were being planned: started once they are. */
  private loopWaiting: string | null = null;
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
  /**
   * The room a walk was asked for by its map and number, with its signature:
   * other rooms share a signature (a name and its exits), and the walk heads
   * for this one rather than the nearest of them (2026-10-16).
   */
  private goingTo: { sig: number; room: RoomId } | null = null;
  private loopRun: { name: string; startedAt: number; lapBegunAt: number | null } | null = null;
  /** The character's `[Alerts]`: the sound each alert plays. */
  private alerts: Readonly<Record<string, unknown>>;
  /** Where what is learned is kept; null when nowhere. */
  private readonly memory: EngineMemory | null;
  /** The databases this engine's copy was taken from, so new ones are seen. */
  private dataFrom: MegaData;
  /** Our monster and item tables as last put on, to put on a new copy too. */
  private monsterRules: readonly MonsterRule[] = [];
  private itemRules: readonly ItemRule[] = [];
  /** What was queued for an action kept beside the engine, told when it is sent. See `queue`. */
  private sentHooks: { command: string; onSent: () => void }[] = [];
  /** Items an errand has lent Auto-Get, by key, with the bit as it was. See `alsoTake`. */
  private readonly lentItems = new Map<string, number>();
  /** Monsters a quest has lent as enemies, by key, with each record as it was. See `alsoFight`. */
  private readonly lentMonsters = new Map<
    string,
    { rec: MonsterRec; relationship: number; flags: number }[]
  >();
  /** Signatures learned since they were last kept. */
  private readonly unkept = new Map<RoomId, number>();
  /** When our tracker had each of the ten blessing slots put up, at the last look; null when down. */
  private readonly blessUp: (number | null)[] = [];
  /** Whether our tracker had the HP and mana regeneration spells up, at the last look. */
  private regenUp: [boolean, boolean] = [false, false];
  /** The `sys goto` escape when on (`useFlee`), and one armed and waiting for the fight to end. */
  private flee: FleeGoto | null = null;
  private fleeArmed: { destination: string; at: number } | null = null;
  /** Sent, and not to be again until health is back above the line. */
  private fleeSpent = false;
  /** The marks list as last kept (`keepLearned`). */
  private marksKept = '[]';
  /** The afflictions our tracker had on, at the last look (`afflictions`). */
  private afflicted: Partial<Record<CuredAffliction, boolean>> = {};

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
      isRoom: (sig) => this.isRoom(sig),
      isStepRoom: (p, i) => this.isStepRoom(p, i),
      opensAWay: (name) => this.host.opensAWay?.(name) ?? false,
      forcible: (dir) => this.forcible(dir),
      clearWay: (p, i, dir) => this.clearWay(p, i, dir),
      readPath: (name) => this.readPath(name),
      saveSteps: (p) => this.saveSteps(p),
      blessingsCleared: () => this.blessingsCleared(),
      beforeStep: () => this.beforeStep(),
      echo: (text) => this.sent(text)
    };
    this.memory = setup.memory ?? null;
    this.dataFrom = setup.data;
    this.alerts = setup.settings.live['Alerts'] ?? {};
    // A copy: the data read is shared between sessions, and the engine changes it as it learns.
    this.s = new Session(engineHost, structuredClone(setup.data));
    loadCharacter(this.s, setup.settings);
    bbsSetup(this.s, (key) => setup.bbs?.[key]);
    this.s.now = engineHost.clock();
    const memory = setup.memory;
    this.recall();
    if (memory) {
      rememberPlayers(this.s, memory.players);
      // MegaMUD's marks list lives as long as its window does; ours outlives a restart.
      this.s.monsterMarks = (memory.marks ?? []).map(([name, flags]) => ({ name, flags }));
    }
    this.marksKept = JSON.stringify(this.s.monsterMarks);
    grantPlayers(this.s, setup.grants, setup.joinWhenInvited);
    this.s.botCommands = setup.botCommands ?? [];
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
            this.fleeTick();
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
    this.monsterRules = rules;
    for (const rule of rules) rememberRule(this.s, rule);
    // What an errand has lent stays lent through the table changing under it.
    for (const mob of this.lentMonsters.keys()) this.fightOnto(mob);
    findLongestFirst(this.s);
  }

  /**
   * Our item table put on MegaMUD's item records as its item details would
   * have edited them, an item the records do not name added: a table edited
   * while the character plays reaches it, as the monster table does.
   */
  useItems(rules: readonly ItemRule[]): void {
    this.itemRules = rules;
    for (const rule of rules) applyItemRule(this.itemRecord(rule.item), rule, this.host.world());
    for (const name of this.lentItems.keys()) this.takeOnto(name);
  }

  /**
   * An item picked up while an action kept beside the engine wants it (an
   * item errand's drop, `ItemErrand.alsoTake`): its record's Auto-Get set,
   * and put back as it was when the errand lets it go. Never the file.
   */
  alsoTake(name: string, on: boolean): void {
    const key = itemKey(name);
    if (on) {
      if (this.lentItems.has(key)) return;
      this.lentItems.set(key, this.itemRecord(name).flags & ITEM_FLAG_BITS.collect);
      this.takeOnto(key);
      return;
    }
    const was = this.lentItems.get(key);
    if (was === undefined) return;
    this.lentItems.delete(key);
    const rec = this.s.data.items.find((item) => itemKey(item.name) === key);
    if (rec) rec.flags = (rec.flags & ~ITEM_FLAG_BITS.collect) | was;
  }

  /** An item's record, by name or key; one the records do not name is added. */
  private itemRecord(name: string): ItemRec {
    const key = itemKey(name);
    const find = (): ItemRec | undefined =>
      this.s.data.items.find((item) => itemKey(item.name) === key);
    const found = find();
    if (found) return found;
    rememberItem(this.s, { name, weight: null, slot: null, weapon: false });
    return find()!;
  }

  private takeOnto(key: string): void {
    const rec = this.s.data.items.find((item) => itemKey(item.name) === key);
    if (rec) rec.flags |= ITEM_FLAG_BITS.collect;
  }

  /**
   * A monster fought while a quest wants it dead (`QuestRunner`'s
   * `fightFor`): an enemy, and put back as it was when the quest lets it go.
   * Never the file.
   */
  alsoFight(mob: string, on: boolean): void {
    const key = mobKey(mob);
    if (on) {
      if (this.lentMonsters.has(key)) return;
      const records = monsterRecords(this.s, mob);
      this.lentMonsters.set(
        key,
        records.map((rec) => ({ rec, relationship: rec.relationship, flags: rec.flags }))
      );
      this.fightOnto(key);
      findLongestFirst(this.s);
      return;
    }
    const was = this.lentMonsters.get(key);
    if (was === undefined) return;
    this.lentMonsters.delete(key);
    for (const { rec, relationship, flags } of was) {
      rec.relationship = relationship;
      rec.flags = flags;
    }
  }

  private fightOnto(key: string): void {
    for (const { rec } of this.lentMonsters.get(key) ?? []) {
      ruleOnto(rec, { mob: key, relationship: 'enemy', notHostile: false });
    }
  }

  /**
   * The settings changed (`megamud.ini` edited): put on the running session,
   * as MegaMUD's settings dialog changes the struct in place, the path
   * walked and the loop kept.
   */
  reload(setup: MegaEngineSetup): void {
    this.alerts = setup.settings.live['Alerts'] ?? {};
    this.toggled = '';
    const s = this.s;
    const kept = [s.MegaMud_CurPath, s.MegaMud_SelPath, s.MegaMud_CurPathStep] as const;
    const { rules, ruleAt, events, eventNext, monitors } = s;
    // The toggles as they stand: MegaMUD's dialog edits them in place, and
    // they are the toolbar's, not the file's.
    const toggles = TOGGLE_FIELDS.map((field) => s[field]);
    // And what the monsters and players here were marked with: a settings
    // change is not a character opened afresh, which is when MegaMUD lets
    // them go (`0x4721d0`). Every save wiped what was learned (2026-10-14).
    const marks = [s.monsterMarks, s.playerMarks] as const;
    loadCharacter(s, setup.settings);
    [s.monsterMarks, s.playerMarks] = marks;
    bbsSetup(s, (key) => setup.bbs?.[key]);
    [s.MegaMud_CurPath, s.MegaMud_SelPath, s.MegaMud_CurPathStep] = kept;
    TOGGLE_FIELDS.forEach((field, i) => (s[field] = toggles[i]!));
    if (s.rulesChanged !== 0) [s.rules, s.ruleAt] = [rules, ruleAt];
    if (s.eventsChanged !== 0) [s.events, s.eventNext] = [events, eventNext];
    if (s.monitorsChanged !== 0) s.monitors = monitors;
    grantPlayers(s, setup.grants, setup.joinWhenInvited);
    s.botCommands = setup.botCommands ?? [];
    if (setup.data !== this.dataFrom) this.newData(setup.data);
    this.noteToggles();
  }

  /**
   * New databases for a running engine — the realm's data arrived or changed
   * after the engine started, which MegaMUD would have read at its next
   * start. A fresh copy with what the engine knows put back on it: the
   * players and rooms it has met, what our stores remember, our tables; and
   * what it is carrying and looking at found again by name.
   */
  private newData(data: MegaData): void {
    const s = this.s;
    const was = s.data;
    this.dataFrom = data;
    s.data = structuredClone(data);
    s.data.players = was.players;
    s.data.rooms = was.rooms;
    this.recall();
    this.useMonsters(this.monsterRules);
    this.useItems(this.itemRules);
    const item = (rec: ItemRec | null): ItemRec | null =>
      rec === null ? null : (s.data.items.find((i) => i.name === rec.name) ?? rec);
    for (const c of s.inventory) c.item = item(c.item);
    for (const e of s.room) {
      e.item = item(e.item);
      if (e.mon !== null) {
        const name = e.mon.name;
        e.mon = s.data.monsters.find((m) => m.name === name) ?? e.mon;
      }
    }
  }

  /** What our stores remember of monsters and items, put on the databases. */
  private recall(): void {
    if (this.memory === null) return;
    for (const [name, relationship] of this.memory.stances)
      rememberStance(this.s, name, relationship);
    for (const item of this.memory.items) rememberItem(this.s, item);
  }

  /**
   * The databases MegaMUD marked changed (`playersChanged` players, `monstersChanged`
   * monsters, `itemsChanged` items) and the signatures learned since, handed to be
   * kept: `0x43bfa0`, which MegaMUD runs on the way out, run here as soon as
   * something is marked, and on the way out as well.
   */
  private keepLearned(): void {
    const s = this.s;
    if (this.memory === null) return;
    const marks = JSON.stringify(s.monsterMarks);
    const marked = marks !== this.marksKept;
    if (
      s.playersChanged === 0 &&
      s.monstersChanged === 0 &&
      s.itemsChanged === 0 &&
      this.unkept.size === 0 &&
      !marked
    )
      return;
    const lessons: EngineLessons = {
      stances: s.monstersChanged !== 0 ? savedStances(s) : [],
      items: s.itemsChanged !== 0 ? savedItems(s) : [],
      signatures: [...this.unkept],
      marks: marked ? s.monsterMarks.map((m): LearnedMark => [m.name, m.flags]) : null
    };
    this.marksKept = marks;
    // Players are our tracker's to keep (`PlayerBook`): the mark is only cleared.
    s.playersChanged = 0;
    s.monstersChanged = 0;
    s.itemsChanged = 0;
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
    s.now = s.host.clock();
    this.markLasting();
    const spellOf = (command: string): SpellRec | null =>
      command === '' ? null : findSpell(s, command);
    // Our tracker's buff for a lasting spell of this character's own.
    const upFor = (spell: SpellRec | null): ActiveBuff | undefined =>
      spell === null || (spell.flags & SpellFlag.Timed) === 0
        ? undefined
        : up.find(
            (b) =>
              b.by === null &&
              (stricmp(b.spell, spell.name) === 0 ||
                (b.candidates ?? []).some((name) => stricmp(name, spell.name) === 0))
          );
    for (let i = 0; i < 10; i += 1) {
      const spell = spellOf(blessCommand(s, i));
      const at = upFor(spell)?.appliedAt ?? null;
      const was = this.blessUp[i] ?? null;
      this.blessUp[i] = at;
      if (at !== null && at !== was) {
        s.blessCastAt[i] = s.now;
        s.blessSeenAt[i] = s.now;
        if (s.debug !== 0) s.host.trace(`{bless-up:${spell!.name}}`);
        if (s.state === State.Blessing && s.blessSlot === i) {
          s.castAnswered += 1;
          s.castTook += 1;
          forgetAwaited(s, 0x10);
          setState(s, State.Nothing);
        }
      } else if (at === null && was !== null) {
        s.blessCastAt[i] = 0;
        if (s.debug !== 0 && spell) s.host.trace(`{bless-down:${spell.name}}`);
      }
    }
    /*
     * The regeneration spells the same way, for the same reason: MegaMUD
     * knows `RegenCmd` and `FluxCmd` are working only while a row marked
     * hp- or mana-regen is up, and a realm's Messages.md may have none for
     * them. Skinny's has none for divine restoration, so every stat sheet,
     * which takes the regen as ended, had him cast `rsto` again (2026-10-14).
     */
    const regenWas = this.regenUp;
    this.regenUp = [
      upFor(spellOf(s.Spells_RegenCmd)) !== undefined,
      upFor(spellOf(s.Spells_FluxCmd)) !== undefined
    ];
    if (this.regenUp[0]) s.hpRegen = 1;
    else if (regenWas[0]) s.hpRegen = 0;
    if (this.regenUp[1]) s.manaRegen = 1;
    else if (regenWas[1]) s.manaRegen = 0;
  }

  /**
   * Our tracker's afflictions, beside its buffs and for their reason: MegaMUD
   * knows it is blind, poisoned, diseased or held only by a Messages.md row
   * with that effect, and a realm's rows can say otherwise. Skinny's names
   * `You are diseased` as losing HP, so `DiseaseCmd` was never cast for it
   * (2026-10-14). The tracker reads the realm's own sentences for each, so an
   * affliction it has on is on, and one it has seen end is ended; a disease
   * only for curing (`AFFLICTION_FLAG`).
   */
  afflictions(now: Readonly<Record<CuredAffliction, Affliction>>): void {
    const s = this.s;
    for (const name of CURED_AFFLICTIONS) {
      const on = now[name] === 'yes';
      if (on) s[AFFLICTION_FLAG[name]] = 1;
      else if (this.afflicted[name] === true) s[AFFLICTION_FLAG[name]] = 0;
      this.afflicted[name] = on;
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
      if ((spell.flags & SpellFlag.Timed) !== 0) continue;
      const known = world.spellNamed(spell.name);
      if (known !== null && spellLasts(known, (id) => world.spellById(id)))
        spell.flags |= SpellFlag.Timed;
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
    if (this.regenUp[0]) s.hpRegen = 1;
    for (const name of CURED_AFFLICTIONS)
      if (this.afflicted[name] === true) s[AFFLICTION_FLAG[name]] = 1;
    for (let i = 0; i < 10; i += 1) {
      if ((this.blessUp[i] ?? null) !== null) s.blessCastAt[i] = s.now;
    }
  }

  /**
   * A stat sheet wanted, as MegaMUD wants one after a level or a death
   * (`statDue`): sent by `0x40d0e0` when its scheduler next may, out of a fight.
   */
  wantStat(): void {
    if (this.s.statDue === 0) this.s.statDue = 1;
  }

  /**
   * Waiting to dial back (`dialState` 3, task 9), as `0x4653d0` counts down
   * `Comms.RedialPause` after a drop, a full game or a stuck log-on.
   */
  get redialing(): boolean {
    return this.s.dialState === 3 && this.s.task === Task.Redial;
  }

  /** Seconds until that redial, 0 when none is waited on. */
  get redialIn(): number {
    return this.redialing ? Math.max(0, this.s.redialAt - this.s.host.clock()) : 0;
  }

  /** A dial failed: redialled by MegaMUD's rule for that (`0x4b71d0`). */
  connectFailed(): void {
    this.act(() => connectFailed(this.s));
  }

  /** The redial waited on called off, the player's Disconnect: offline, idle (task `0x14`). */
  cancelRedial(): void {
    if (!this.redialing) return;
    this.s.dialState = 0;
    setTask(this.s, Task.Terminated);
    this.noteToggles();
  }

  /** Text from the socket. */
  received(text: string): void {
    dataArrived(this.quiet, Date.now());
    this.safely(() => {
      this.s.now = this.s.host.clock();
      parseData(this.s, this.t, text);
    });
    this.noteRoom();
    // Into the game with nowhere known: ask once, before anything wants a way.
    const entered = this.s.inGame !== 0 && !this.wasInGame;
    if (entered && this.host.here() === null) this.host.locate();
    this.wasInGame = this.s.inGame !== 0;
    if (this.parked !== null && !this.parked.planning && this.host.here() !== null)
      this.safely(() => this.unpark());
    this.noteToggles();
    if (entered) this.host.enteredGame?.();
  }

  /** Whether the character is in the game (`0x47b070`'s first prompt seen, not since left). */
  get inGame(): boolean {
    return this.s.inGame !== 0;
  }

  /**
   * The toggles as MegaMUD's window draws them (`0x460d50`), which this
   * character's toolbar shows, and whether it is walking: with All Off on,
   * every other toggle reads off and Go is not to be pressed.
   */
  get toggles(): MegaToggles {
    const s = this.s;
    const allOff = s.allOff !== 0;
    const on = {} as Record<MegaToggle, boolean>;
    for (const [name, field] of Object.entries(TOGGLE_FIELD) as [MegaToggle, keyof Session][]) {
      // No Hangup is not one of All Off's: it is drawn with Connect (`0x460d50`).
      const own = name === 'noHangup' || name === 'allOff';
      on[name] = s[field] !== 0 && (own || !allOff);
    }
    // `0x803`'s Go finds nothing to walk without a destination or roaming.
    const somewhere = s.detours[0]!.room !== 0 || s.detours[0]!.path !== '' || s.roaming !== 0;
    return {
      on,
      walking: s.walking !== 0,
      looping: s.looping !== 0,
      canGo: s.inGame !== 0 && !allOff && somewhere
    };
  }

  /**
   * The engine's walk and loop as the cards draw them, in place of the
   * walker's and loop runner's, which stand idle while it walks: the path
   * walked (`0xe39c`) and the step reached, the loop (`loopPath`), and its laps
   * (`laps`, counted as `0x43d2a0` takes the loop up again).
   */
  get progress(): { walk: WalkProgress; loop: LoopProgress } {
    const s = this.s;
    const walking = s.walking !== 0;
    const made = this.madeFor(s.path) ?? null;
    const lap = this.madeFor(s.loopPath)?.loop ?? null;
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
        laps: Math.max(0, s.laps),
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
    if (room === null || asRoomReference(room) === null) return null;
    return this.worldRoom(room)?.name ?? room;
  }

  /** A room's record in the realm's data. */
  private worldRoom(room: RoomId): WorldRoom | undefined {
    const place = asRoomReference(room);
    return place === null ? undefined : this.host.world()?.get(place.map, place.room);
  }

  /** Says so when the walk or the loop moved on: a step, a stop, a lap, a fight. */
  private noteProgress(): void {
    const s = this.s;
    const lap = this.madeFor(s.loopPath)?.loop ?? null;
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
    if (toggle) this.press(toggle.command);
  }

  /** The player at the keyboard: a keystroke or a line, ending an idle AFK (`playerKey`). */
  key(): void {
    this.act(() => playerKey(this.s));
  }

  /** A command the player typed. */
  typed(command: string): void {
    this.playerSent();
    this.act(() => typedCommand(this.s, 0, command));
  }

  /**
   * The player sent a line, a bare Enter among them. MegaMUD sends the
   * player's line itself (`0x48e7f0` → `0x42d9f0`), which stamps the clock
   * its re-prompt counts from: a bare Enter after `LagWait` + 15 seconds
   * with nothing sent (`0x4653d0`). Ours go out past it, so it is stamped here.
   */
  playerSent(): void {
    this.s.now = this.s.host.clock();
    this.s.lastSentAt = this.s.now;
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
    this.sentHooks = [];
    this.safely(() => connectionClosed(this.s));
    this.safely(() => this.keepLearned());
  }

  /**
   * The flee toggle (`automation.safety.fleeGoto`), ours and kept beside
   * MegaMUD's own run: below its health, MegaMUD's run is started to get out
   * of the fight, and once the fight is over `sys goto <destination>` is
   * sent, as the old automation's escape did. Null when off, or on a realm
   * with no `sys goto` (`SessionManager`).
   */
  useFlee(flee: FleeGoto | null): void {
    this.flee = flee !== null && flee.destination.trim() !== '' ? flee : null;
    if (this.flee === null) this.fleeArmed = null;
  }

  private fleeTick(): void {
    const s = this.s;
    const flee = this.flee;
    if (flee === null || s.inGame === 0 || s.Player_MaxHP <= 0) {
      this.fleeArmed = null;
      return;
    }
    const low = s.hp > 0 && s.hp / s.Player_MaxHP <= flee.belowHealth;
    if (!low) this.fleeSpent = false;
    if (this.fleeArmed === null) {
      if (!low || this.fleeSpent) return;
      this.fleeArmed = { destination: flee.destination.trim(), at: Date.now() };
      const pct = Math.floor((s.hp * 100) / s.Player_MaxHP);
      if (s.inCombat !== 0 && s.runCount === 0) {
        startRun(
          s,
          Math.max(1, s.Combat_RunRooms),
          'Running: fleeing',
          `[Run: fleeing at ${pct}% for sys goto ${this.fleeArmed.destination}]`
        );
        wake(s);
      }
      return;
    }
    const armed = this.fleeArmed;
    if (s.inCombat !== 0 || s.runCount !== 0) {
      if (Date.now() - armed.at > tuning().session.retreatPatienceMs) {
        this.fleeArmed = null;
        this.fleeSpent = true;
        s.host.show(`[Flee: still fighting, sys goto ${armed.destination} given up]`);
      }
      return;
    }
    this.fleeArmed = null;
    this.fleeSpent = true;
    s.host.show(`[Flee: sys goto ${armed.destination}]`);
    send(s, `sys goto ${armed.destination}\r`);
  }

  /** The player's Disconnect (`0x7d4`): hung up on purpose, and not redialled. */
  disconnect(): void {
    this.act(() => disconnect(this.s));
  }

  /** Go/Stop (`0x803`), Roam (`0x808`), AFK (`0x809`), Step Back (`0x869`). */
  button(command: number): void {
    this.act(() => menuCommand(this.s, command));
  }

  /** The same, pressed by the player: it may end AFK (`playerCommand`). */
  press(command: number): void {
    this.act(() => playerCommand(this.s, command));
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
    if (p === 'pending') {
      // Started when its legs are planned (`planArrived`).
      this.loopWaiting = name;
      return null;
    }
    if (typeof p === 'string') return p;
    const s = this.s;
    clearDetours(s);
    freeSteps(s.loopPath);
    copyPath(s, s.loopPath, p, 0);
    if (goTo(s, 0, p) === 0) return `Could not head for the loop "${name}".`;
    const first = this.madeFor(p)?.loop?.stops[0];
    this.goingTo = first === undefined ? null : { sig: p.start, room: first };
    startWalking(s);
    headFor(s, 0);
    s.laps = 0;
    this.loopRun = { name, startedAt: Date.now(), lapBegunAt: null };
    this.noteToggles();
    return null;
  }

  /**
   * A command of an action kept beside the engine (a ward, a key off the
   * floor), put on MegaMUD's pending list (`0x48ab60`): its scheduler sends
   * it when it next may, and a walk holds for it.
   */
  queue(command: string, onSent?: () => void): void {
    this.safely(() => {
      queue(this.s, `${command}\r`);
      // Out of the game MegaMUD sends it at once (`0x48ab80`).
      if (onSent !== undefined) {
        if (this.pendingHas(command)) this.sentHooks.push({ command, onSent });
        else onSent();
      }
      wake(this.s);
    });
  }

  /** Whether a command queued here is still on the pending list. */
  pendingHas(command: string): boolean {
    return this.s.pending.some((p) => p.text === `${command}\r`);
  }

  /** A command queued here taken back off the pending list, unsent. */
  unqueue(command: string): void {
    this.s.pending = this.s.pending.filter((p) => p.text !== `${command}\r`);
    this.sentHooks = this.sentHooks.filter((hook) => hook.command !== command);
  }

  /** A pending command went out (`0x48ad60` echoes it): its sender told. */
  private sent(text: string): void {
    const at = this.sentHooks.findIndex((hook) => hook.command === text);
    if (at === -1) return;
    const [hook] = this.sentHooks.splice(at, 1);
    hook!.onSent();
  }

  /** The console's Deposit All (`0x4bc190`): the wealth over what is kept deposited. */
  depositAll(): void {
    this.act(() => depositAll(this.s));
  }

  /** The room the path's next step goes into, for the host to queue what it wants first. */
  private beforeStep(): void {
    if (this.host.beforeStep === undefined) return;
    const made = this.madeFor(this.s.path);
    if (made === undefined) return;
    const to = made.rooms[this.s.path.at + 1] ?? made.end;
    if (to !== null) this.host.beforeStep(to);
  }

  /**
   * A room chosen to walk to (the Go To dialog: `0x43fc60`, `0x43d2a0` with 1).
   *
   * `alone`: the walk is the whole of it, for an action kept beside the
   * engine (a hunt walking to its lair). The Go To dialog's walk takes a loop
   * stopped earlier up again at its end (`0x43d2a0` with no destination left
   * resumes a loop path), so its end would never come; the loop is let go
   * first (2026-10-14).
   */
  walkTo(room: RoomId, run = false, alone = false): string | null {
    const sig = this.signatureOf(room);
    if (sig === null) return 'That room has no signature yet.';
    const s = this.s;
    if (alone) {
      clearPath(s.loopPath);
      s.looping = 0;
    }
    clearDetours(s);
    this.goingTo = { sig, room };
    goTo(s, sig, null);
    headFor(s, 1);
    // The Go-To dialog's Go and Run (`0x43e680`): walked with auto-combat on
    // or off, and the setting before put back on arrival.
    if (s.detourCombat !== -1) reEngage(s);
    const fight = run ? 0 : 1;
    s.detourCombat = fight;
    s.idleCombat = s.MegaMud_AutoCombat;
    s.MegaMud_AutoCombat = fight;
    // A route taken in place of the loop: MegaMUD walks it and then the loop
    // again, but the run the card counted is over.
    this.loopRun = null;
    this.noteToggles();
    return null;
  }

  /** A step run safely, and the toolbar and cards told what it changed. */
  private act(run: () => unknown): void {
    this.safely(run);
    this.noteToggles();
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
    this.outbound.push(this.afterSysGoto(text));
    this.pump();
  }

  /** The line being written so far, for `afterSysGoto`: MegaMUD sends a line in pieces. */
  private lineSoFar = '';

  /**
   * A blank Enter after every `sys goto` line, whoever sent it (the MUD op's
   * escape, its critical HP, a path's town, a remote's `@do`, our flee):
   * the realm moves the character without showing where to, and only a
   * blank line shows the room (2026-10-14). Without it the engine never saw
   * the move, and Fatty's escape went round 94 times at 47 HP.
   */
  private afterSysGoto(text: string): string {
    let out = '';
    for (const ch of text) {
      out += ch;
      if (ch !== '\r') {
        if (ch !== '\x01') this.lineSoFar += ch;
        continue;
      }
      if (/^sys\s+goto\s+\S/i.test(this.lineSoFar.trim())) out += '\r';
      this.lineSoFar = '';
    }
    return out;
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
    const sig = this.s.roomSignature;
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
    const world = this.host.world();
    const rec = this.worldRoom(room);
    const shop = rec?.shop === undefined ? undefined : world?.shop(rec.shop);
    rooms.push({
      signature: sig,
      name: shop?.name.trim() ?? rec?.name ?? room,
      flags: rec?.shop !== undefined ? 2 : 0
    });
  }

  /**
   * What the settings page picks from: the names in the room list, and what
   * is carried as `0x42afc0` offers it (the first nine of a kind: a weapon,
   * one that can backstab, a shield), none while the inventory is not known.
   */
  choices(): MegaChoices {
    const s = this.s;
    const carried = (fits: (item: ItemRec) => boolean): string[] | null =>
      s.weightMax === 0
        ? null
        : s.inventory
            .flatMap((c) => (c.item !== null && fits(c.item) ? [c.item.name] : []))
            .slice(0, 9);
    return {
      rooms: [...new Set((s.data.rooms ?? []).map((r) => r.name))],
      weapons: carried((item) => item.type === 1),
      backstab: carried((item) => item.type === 1 && (item.flags & ItemFlag.Backstab) !== 0),
      shields: carried((item) => item.location === 12),
      statline: {
        hp: s.hp,
        maxHp: s.Player_MaxHP,
        mana: s.mana,
        maxMana: s.Player_MaxMana,
        // 0x8428: the coin carried, as the tab shows it.
        wealth: s.wealth >>> 0,
        exp: s.Player_Exp,
        need: s.Player_Need,
        kai: ((findClass(s.data, s.Player_Class)?.magic ?? 0) & 0xff00) === 0x500
      }
    };
  }

  signatureOf(room: RoomId): number | null {
    const learned = this.learned.get(room);
    if (learned !== undefined) return learned;
    const rec = this.worldRoom(room);
    return rec ? worldSignature(rec) : null;
  }

  /** `SessionHost.isRoom`: here is the room walked to, when one was chosen with this signature. */
  private isRoom(sig: number): boolean {
    const going = this.goingTo;
    if (going === null || going.sig !== sig) return true;
    const here = this.placedHere();
    if (here !== null && here !== going.room) return false;
    this.goingTo = null;
    return true;
  }

  /**
   * `SessionHost.isStepRoom`: here is the room a path of ours takes step `i`
   * from (`p.count`: the room it ends in), where that room is known.
   */
  private isStepRoom(p: PathRec, i: number): boolean {
    const made = this.madeFor(p);
    if (!made) return true;
    const room = i >= p.count ? made.end : made.rooms[i];
    const here = this.placedHere();
    return room === null || room === undefined || here === null || here === room;
  }

  /**
   * `SessionHost.clearWay`: a step of one of our paths whose exit is not
   * open: the levers the realm keeps in this room pulled, else a hidden exit
   * searched for, each a couple of times, the room looked at again after
   * (a bare Enter), where the old walker did both. Only while the exit is not
   * showing, so a lever is not pulled shut again on a lap it stood open.
   */
  private clearWay(p: PathRec, i: number, dir: number): number {
    const s = this.s;
    const exit = s.roomExits[dir];
    // Dark, no exit shows at all: nothing here says this one is shut.
    if (s.darkness >= Darkness.Dark || (exit !== Exit.None && exit !== Exit.ClosedDoor)) return 0;
    const step = this.madeFor(p)?.walked[i];
    const world = this.host.world();
    if (!step || !world || step.direction === 'portal' || this.placedHere() !== step.from) return 0;
    const key = `${p.name}:${i}`;
    if (this.clearing?.key !== key) this.clearing = { key, levers: 0, searches: 0 };
    const tries = this.clearing;
    const levers = world.leversHere(step.from, step.direction);
    if (levers.length > 0 && tries.levers < LEVER_TRIES) {
      tries.levers += 1;
      s.host.show(`[Pulling ${levers.map((lever) => lever.say).join(', ')} to open the way]`);
      for (const lever of levers) queue(s, `${lever.say}\r`);
      queue(s, '\r');
      wake(s);
      return 1;
    }
    const req = step.requirement;
    if (
      exit === Exit.None &&
      req?.kind === 'hidden' &&
      req.searchable === true &&
      tries.searches < SEARCH_TRIES
    ) {
      tries.searches += 1;
      queue(s, `search ${step.direction}\r`);
      queue(s, '\r');
      wake(s);
      return 1;
    }
    return 0;
  }

  private clearing: { key: string; levers: number; searches: number } | null = null;

  /** `SessionHost.forcible`: what the realm states of the exit `dir` from here. */
  private forcible(dir: number): { pick: boolean; bash: boolean } {
    const here = this.placedHere();
    const way = here === null ? undefined : DIRECTIONS[dir];
    const exit = way && this.worldRoom(here!)?.exits.find((x) => x.direction === way);
    const s = this.s;
    return forcibleBy(
      exit?.requirement ?? null,
      s.Player_Picklocks > 0 ? s.Player_Picklocks : null,
      s.Player_Strength > 0 ? s.Player_Strength : null
    );
  }

  /**
   * Where our tracker puts the character, when it agrees with the engine's
   * room: a tracker a room behind or ahead says nothing about which
   * look-alike this is.
   */
  private placedHere(): RoomId | null {
    const here = this.host.here();
    return here !== null && this.signatureOf(here) === this.s.roomSignature ? here : null;
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
    return sig === null
      ? { room: -1, flags: StepFlag.ReLearnRoom, command }
      : { room: sig, flags: 0, command };
  }

  /**
   * A locked exit's key as a MegaMUD path step writes it, `sw[use <key> sw]`:
   * the door code (`0x408870`) sends it when the key is carried, where a step
   * without it picks and bashes. Fatty bashed a gate whose key he carried
   * until he was stopped (2026-10-16).
   */
  private keyText(st: RouteStep): string {
    const req = st.requirement;
    if (req?.kind !== 'key' || req.keyId === undefined) return '';
    const name = this.host.world()?.item(req.keyId)?.name;
    return name === undefined ? '' : `[use ${name} ${st.command}]`;
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
    const walked: (RouteStep | null)[] = [];
    const steps: PathStep[] = [];
    for (const leg of legs) {
      for (const st of leg.steps) {
        /*
         * The levers of a detour the planner put on the way (`RouteStep.pull`,
         * `WorldGraph.leverErrand`), pulled where it says, before the way
         * back: path commands MegaMUD sends where they stand
         * (`typeCommand`), the walk going on after.
         */
        for (const say of st.pull?.say ?? []) {
          rooms.push(st.from);
          walked.push(null);
          steps.push(this.stepFrom(st.from, say));
        }
        rooms.push(st.from);
        walked.push(st);
        /*
         * A step that is not a plain direction written as a MegaMUD path
         * writes it, `@party <command>`: leading a party, MegaMUD says it to
         * the party, sends it and holds the walk for the party
         * (`typeCommand`); alone, it sends the command. A room's own command
         * (`go portal`, a script's teleport) moves only whoever types it:
         * Fatty went through a portal without Skinny (2026-10-14). And a
         * text exit (`Text:` in a compass slot, `go gate`) drops the party's
         * follow on this realm, followers landed or not, measured twice
         * (2026-09-29); MegaMUD's invite scan asks back a member left out
         * (`0x407ee0`, `0x188`).
         */
        const command =
          typedDirection(st.command) === -1 && !st.command.startsWith('@')
            ? `@party ${st.command}`
            : `${st.command}${this.keyText(st)}`;
        const step = this.stepFrom(st.from, command);
        // A trap the realm states: searched for and disarmed first (`0x408870`).
        if (st.requirement?.kind === 'trap') step.flags |= StepFlag.DisarmTrap;
        steps.push(step);
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
    this.made.set(name.toLowerCase(), { path: p, rooms, walked, end: last ?? null, loop: null });
    return p;
  }

  // ------------------------------------------------------------ the host's paths

  /**
   * What a refused way needs, handed to the item errand (`fetchFirst`) with
   * what to take up after: once per ask while its plan is kept, as `route`
   * is asked again and again. Whether it was handed over.
   */
  private fetchFor(needs: Route['needs'], then: AfterFetch): boolean {
    if (needs === undefined || needs.length === 0 || this.host.fetchFirst === undefined)
      return false;
    const key = JSON.stringify(then);
    const asked = this.fetchAsked;
    if (asked !== null && asked.key === key && Date.now() - asked.at < PLAN_KEPT_MS) return true;
    this.fetchAsked = { key, at: Date.now() };
    this.host.show(
      `[Fetching ${needs.map((item) => item.name).join(', ')} first: the way needs it]`
    );
    this.host.fetchFirst(needs, then);
    return true;
  }

  private fetchAsked: { key: string; at: number } | null = null;

  /** `0x43fd90`, ours: the way from here to the room with signature `to`. */
  private route(from: number, to: number): RouteFound {
    const none: RouteFound = { flags: RouteFlag.NoWay, path: null, steps: -1 };
    const here = this.host.here();
    if (here === null) {
      // Not placed: ask the realm and put the walk aside rather than answer
      // "no way", which sends MegaMUD wandering to find a room it knows.
      // Cancelled (0x20) for now; the destinations come back with the answer.
      const gaveUp = this.locateGaveUp;
      this.locateGaveUp = false;
      if (gaveUp || this.parked !== null || !this.host.locate()) return none;
      this.park(false);
      return { flags: RouteFlag.Cancelled, path: null, steps: -1 };
    }
    let best: Route | null = null;
    let pending = false;
    const going = this.goingTo;
    const rooms = going?.sig === to ? [going.room] : this.roomsWith(to).slice(0, 8);
    let unlocks: { needs: Route['needs']; room: RoomId } | null = null;
    for (const room of rooms) {
      if (room === here)
        return { flags: 0, path: this.makePath(this.routeName(), 'route', [], from, to), steps: 0 };
      const plan = this.plan(here, room);
      if (plan === 'pending') pending = true;
      if (typeof plan !== 'string' && plan.blocked && plan.unlocks?.needs !== undefined)
        unlocks ??= { needs: plan.unlocks.needs, room };
      if (typeof plan === 'string' || plan.blocked) continue;
      if (best === null || plan.steps.length < best.steps.length) best = plan;
    }
    if (pending) {
      // Still being planned. A walk heading off (`0x43d2a0` asks under task
      // 0xd) is put aside as it is while the room is located, and taken up
      // again with the answer; anything else asking is woken to ask again.
      if (this.s.task === Task.Thinking && this.parked === null) this.park(true);
      return { flags: RouteFlag.Cancelled, path: null, steps: -1 };
    }
    if (best === null) {
      // Ours: refused for a key or an item the pack lacks, it is fetched and
      // the walk (or the loop whose start this is) taken up again after.
      const loop = this.s.loopPath.start === to ? this.madeFor(this.s.loopPath)?.loop : null;
      const then: AfterFetch | null = loop
        ? { loop: loop.name }
        : unlocks === null
          ? null
          : { walkTo: unlocks.room };
      if (then !== null && this.fetchFor(unlocks?.needs, then))
        return { flags: RouteFlag.Cancelled, path: null, steps: -1 };
      return none;
    }
    const p = this.makePath(this.routeName(), 'route', [best], from, to);
    if (p.steps!.length > 0) p.steps![0]!.room = from;
    return { flags: 0, path: p, steps: p.count };
  }

  /**
   * The way between two rooms: kept from an earlier ask, or asked of the
   * planner's thread and `pending` until it answers (`planArrived`).
   */
  private plan(from: RoomId, to: RoomId): Route | string | 'pending' {
    const key = `${from}>${to}`;
    const kept = this.plans.get(key);
    if (kept === 'pending') return kept;
    if (kept !== undefined && Date.now() - kept.at < PLAN_KEPT_MS) return kept.route;
    const asked = this.host.plan(from, to);
    if (typeof asked === 'string') return asked;
    this.plans.set(key, 'pending');
    asked
      .catch((error: unknown): Route => ({
        steps: [],
        cost: 0,
        blocked: true,
        reason: error instanceof Error ? error.message : String(error)
      }))
      .then((route) => {
        this.plans.set(key, { route, at: Date.now() });
        this.safely(() => this.planArrived());
      });
    return 'pending';
  }

  /** The planner's answers are in: what waited on them asks again. */
  private planArrived(): void {
    if ([...this.plans.values()].includes('pending')) return;
    if (this.parked !== null && this.host.here() !== null) this.unpark();
    const loop = this.loopWaiting;
    this.loopWaiting = null;
    if (loop !== null) {
      const refused = this.startLoop(loop);
      if (refused !== null) this.host.show(`[${refused}]`);
    }
    wake(this.s);
    this.noteToggles();
  }

  private routeName(): string {
    this.routes = (this.routes + 1) % 0x1000000;
    return `~R${this.routes.toString(16).padStart(6, '0')}`;
  }

  /** One of our loops as a MegaMUD loop: start and end its first stop. */
  private loopPath(name: string): PathRec | string | 'pending' {
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
    // Every leg asked for at once, so the planner's thread works on them together.
    const planned = rooms.map((from, i) => {
      const to = rooms[(i + 1) % rooms.length]!;
      return from === to ? null : this.plan(from, to);
    });
    if (planned.includes('pending')) return 'pending';
    for (const [i, plan] of planned.entries()) {
      begins.push(steps);
      const from = rooms[i]!;
      const to = rooms[(i + 1) % rooms.length]!;
      // A stop listed twice in a row: no leg.
      if (plan === null || plan === 'pending') continue;
      if (typeof plan === 'string') return plan;
      if (plan.blocked) {
        if (this.fetchFor(plan.unlocks?.needs, { loop: name }))
          return `The loop "${name}" starts once the pack holds what its way needs.`;
        return plan.reason ?? `No way from ${from} to ${to}.`;
      }
      legs.push(plan);
      steps += pathLength(plan);
    }
    const p = this.makePath(shortName('L', name), name, legs, start, start);
    this.madeFor(p)!.loop = {
      name,
      stops: rooms,
      listed: stops.rooms.length,
      bounce: stops.bounce,
      begins
    };
    if (!this.s.paths.includes(p)) this.s.paths.push(p);
    return p;
  }

  /** The walk put aside, as it stands, until the room is placed or the way planned. */
  private park(planning: boolean): void {
    const s = this.s;
    this.parked = {
      detours: structuredClone(s.detours),
      walking: s.walking,
      looping: s.looping,
      roaming: s.roaming,
      lost: s.lost,
      until: Date.now() + LOCATE_WAIT_MS,
      planning
    };
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
    return this.madeFor({ name })?.path ?? null;
  }

  /** The path made here under a path's name (MegaMUD's are not case-sensitive). */
  private madeFor(p: { name: string }): MadePath | undefined {
    return this.made.get(p.name.toLowerCase());
  }

  /** `0x4888e0`: a relearned step's room kept, for every path through it. */
  private saveSteps(p: PathRec): number {
    const made = this.madeFor(p);
    if (!made || !p.steps) return 0;
    p.steps.forEach((st, i) => {
      const room = made.rooms[i];
      if (room && st.room !== -1 && (st.flags & StepFlag.ReLearnRoom) === 0)
        this.learn(room, st.room);
    });
    made.path.steps = p.steps.map((st) => ({ ...st }));
    return 1;
  }
}
