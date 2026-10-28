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
import { CAST_IMMUNITY, refreshImmunities } from '../megamud/combat/immunity';
import { grantPlayers, loadCharacter, profileChanged, reloadCharacter } from '../megamud/character';
import { newTerminal, parseData, type TerminalState } from '../megamud/input/ParseData';
import { typedCommand } from '../megamud/input/typed';
import {
  connectPressed,
  disconnect,
  menuCommand,
  playerCommand,
  playerKey
} from '../megamud/move/buttons';
import { blessCommand } from '../megamud/player/cast';
import { clearDetours, goTo, headFor, startWalking } from '../megamud/move/destinations';
import { clearPath, copyPath, freeSteps, stepsShown } from '../megamud/move/path';
import { depositAll } from '../megamud/items/all';
import { connected, connectFailed, connectionClosed } from '../megamud/script/game';
import { reEngage } from '../megamud/script/modes';
import { queue, send, wake } from '../megamud/script/send';
import { combatOff } from '../megamud/combat/engaged';
import { startRun } from '../megamud/script/run';
import { keepSchedule } from '../megamud/script/events';
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
import { caption, setTask, Task } from '../megamud/script/task';
import {
  monsterIndex,
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
import type { MegaCount } from '../../shared/tally';
import type { LearnedItem, LearnedMark } from '../world/MegaLearned';
import {
  byEngine,
  type ActiveBuff,
  type Affliction,
  type AfflictionCause
} from '../../shared/character';
import type { MegaSettings } from '../../shared/megamud/settings';
import { MEGA_TOGGLES, type MegaToggle, type MegaToggles } from '../../shared/megamud/toggles';
import type { MegaChoices, MegaNames } from '../../shared/ipc';
import type { BotCommand, PlayerGrant } from '../../shared/remotes';
import { IDLE_WALK, type WalkProgress } from '../../shared/walk';
import { NO_LOOP, type LoopProgress } from '../../shared/loops';
import { doorSpell } from '../../shared/spellcraft';
import {
  asRoomReference,
  DIRECTIONS,
  forcibleBy,
  mobKey,
  roomId,
  spellLasts,
  type Route,
  type RouteStep,
  type RoomId,
  type WorldRoom
} from '../../shared/world';
import type { WorldGraph } from '../world/WorldGraph';
import { State } from '../megamud/states';
import {
  SpellFlag,
  ItemFlag,
  StepFlag,
  RouteFlag,
  RoomFlag,
  Exit,
  Darkness
} from '../megamud/flags';
import { worldSignature } from '../world/megamudSignature';

/**
 * The engine's fields that decide whether it walks, rests or waits: each
 * change to them goes to `MegaEngineHost.logged` as `gates`, so a
 * capture says why a character stood still (2026-10-17: Archer stood a
 * minute after his webs dissolved, and nothing recorded why).
 */
const GATES = [
  'state',
  'task',
  'walking',
  'looping',
  'inCombat',
  'held',
  'blind',
  'confused',
  'attackPrevented',
  'restUntilOff',
  'partyWait',
  'holdingLeader',
  'mustRest',
  'restReason',
  'resting',
  'meditating',
  'runCount',
  'rescueCount',
  'partyAskPending'
] as const satisfies readonly (keyof Session)[];

/**
 * What the engine's own log says (`MegaEngineHost.logged`): `doing`, its
 * status bar's activity (`0x4aab70`); `gates`, what changed of `GATES`;
 * `step`, MegaMUD's debug step marks (`{D17}`, `{L12}`, …), on whenever
 * something keeps the log; `said`, a line of its own on the console.
 */
export type EngineLogKind = 'doing' | 'gates' | 'step' | 'said';

/** What the engine needs from the session it runs in. */
export interface MegaEngineHost {
  /** To the socket, as typed. */
  write(text: string): void;
  /** A line of MegaMUD's own on the console. */
  show(text: string): void;
  /**
   * The engine turned one of its afflictions on or off (`noteAfflictions`),
   * with what turned it on, for the character's own record of them.
   */
  afflicted?(name: SharedAffliction, on: boolean, cause: AfflictionCause | null): void;
  /** A party member said `@forget` (`SessionHost.partyForgot`). */
  partyForgot?(name: string): void;
  /** A leader's `@party` already done by this character itself (`SessionHost.partyAlreadyDone`). */
  partyAlreadyDone?(leader: string, command: string): boolean;
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
   * The way between two rooms, planned off main's thread (`RoutePlanner`); a
   * string when there is nothing to plan on. `walking` is what for: a walk
   * to a room, planned as the route panel plans one, or a loop's leg, as the
   * loop was drawn (2026-10-18).
   */
  plan(from: RoomId, to: RoomId, walking: PlanFor): Promise<Route> | string;
  /** A loop's stops as rooms, with the commands typed at each, or why not. */
  loopRooms(
    name: string
  ): { rooms: RoomId[]; bounce: boolean; commands: (readonly string[])[] } | string;
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
  /**
   * The engine's own log, everything it would say with MegaMUD's debug on
   * (`EngineLogKind`), for a capture to keep beside the lines it answered.
   * With it, the debug step marks go here and not to the console.
   */
  logged?(kind: EngineLogKind, text: string): void;
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
  /** Ours: an item left on the floor for a party member whose errand is fetching it. */
  leaveFor?(name: string): boolean;
  /** Ours: a purchase is drawing on the purse, so no coin is discarded until it is made. */
  keepCoins?(): boolean;
  /** Ours: what MegaMUD's statistics window counts, for the character's tally. */
  counted?(count: MegaCount): void;
}

/** What `MegaEngine.statsReport` gives: what only the engine works out. */
export interface EngineStats {
  status: string;
  path: string | null;
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
  /**
   * The loop as it stood when its path was made — its stops, their
   * commands and its bounce — so a loop edited since is made again
   * (2026-10-23).
   */
  drawn: string;
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

/**
 * The afflictions MegaMUD keeps a session flag for, one record of them with
 * our tracker's (2026-10-18): what either reads goes into the other
 * (`afflictions`, `noteAfflictions`), so the character's afflictions are what
 * the engine acts on, with what set each.
 */
const SHARED_AFFLICTIONS = ['blind', 'poisoned', 'diseased', 'held', 'confused'] as const;
export type SharedAffliction = (typeof SHARED_AFFLICTIONS)[number];
/**
 * The session flag each of ours takes. Disease takes ours, which only the
 * cures read: MegaMUD rests while its own is up, for a row a realm's
 * Messages.md marks diseased, and Fatty stood still through every disease ours
 * heard (2026-10-16).
 */
const AFFLICTION_FLAG = {
  blind: 'blind',
  poisoned: 'poisoned',
  diseased: 'diseaseHeard',
  held: 'held',
  confused: 'confused'
} as const satisfies Record<SharedAffliction, keyof Session>;

/** How long a walk waits on the realm saying where the character is. */
const LOCATE_WAIT_MS = 5000;

/** A MUD op's `sys goto <place>` line. */
const SYS_GOTO = /^sys\s+goto\s+\S/i;

/** Ours, not MegaMUD's: `automation.safety.fleeGoto`, the `sys goto` escape. See `useFlee`. */
export interface FleeGoto {
  belowHealth: number;
  destination: string;
}
/** What a way is planned for: a walk to a room (`route`), or a loop's leg (`lap`). */
export type PlanFor = 'route' | 'lap';

/** A plan kept: what for, and between which rooms. */
const planKey = (walking: PlanFor, from: RoomId, to: RoomId): string => `${walking}:${from}>${to}`;

/** How long a way planned is used again before it is planned afresh. */
const PLAN_KEPT_MS = 60_000;

/** How many MegaMUD path steps a route is written as: each step, and each lever pulled on the way. */
function pathLength(route: Route): number {
  return route.steps.reduce((n, step) => n + 1 + (step.pull?.say.length ?? 0), 0);
}

/**
 * How many times the levers in an exit's own room are pulled before the door
 * code has it: the old walker's budget (`walk.leverTries`, 2 when retired). A
 * hidden exit the realm says a search reveals has none: see `clearWay`.
 */
const LEVER_TRIES = 2;

/** A loop's stops walked out and back where it bounces: the far end once, the start not again. */
function bounced<T>(stops: readonly T[], bounce: boolean): T[] {
  return bounce ? [...stops, ...stops.slice(1, -1).reverse()] : [...stops];
}

/** A loop's area as MegaMUD names its loops, `Area: Room-map room`; null where it states none. */
function loopArea(name: string): string | null {
  const at = name.indexOf(':');
  return at > 0 ? name.slice(0, at).trim() : null;
}

/** What MegaMUD's weapon and shield boxes take (`0x42afc0`): a weapon, one that backstabs, a shield. */
const isWeapon = (item: ItemRec): boolean => item.type === 1;
const canBackstab = (item: ItemRec): boolean =>
  isWeapon(item) && (item.flags & ItemFlag.Backstab) !== 0;
const isShield = (item: ItemRec): boolean => item.location === 12;

/**
 * What a character's MegaMUD databases name, for its settings boxes to
 * suggest as they are typed in (ours, 2026-10-24): every item, and each of
 * the kinds `0x42afc0` picks from the inventory, out of the whole database,
 * so a box can be filled with what is not carried yet.
 */
export function megaNames(data: MegaData): MegaNames {
  const named = (fits: (item: ItemRec) => boolean): string[] =>
    [...new Set(data.items.filter(fits).map((item) => item.name))].sort((a, b) =>
      a.localeCompare(b)
    );
  return {
    items: named(() => true),
    weapons: named(isWeapon),
    backstab: named(canBackstab),
    shields: named(isShield)
  };
}

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
    /**
     * Put aside until the realm's answer is read (`lostInDark`): our tracker
     * holds a room already, the one it guessed in the dark, and that is not
     * the answer being waited for.
     */
    answer: boolean;
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
   * The room a walk was asked for by its map and number, with its signature:
   * other rooms share a signature (a name and its exits), and the walk heads
   * for this one rather than the nearest of them (2026-10-16).
   */
  private goingTo: { sig: number; room: RoomId } | null = null;
  /**
   * Stand-in signatures for rooms walked to whose own the realm data cannot
   * work out (an exit of a kind it cannot say how the game lists) and that
   * have not been stood in yet: MegaMUD heads for a signature, and the walk
   * was refused (2026-10-16) though our planner knows the way by the room's
   * number. A code of 3 in an exit's two bits never comes off an exits line
   * (a plain exit is 1, a door 2), so no room the game shows has one. Each
   * is swapped for the room's own when the character stands there
   * (`noteRoom`), before MegaMUD next asks whether it has arrived.
   */
  private readonly standIns = new Map<number, RoomId>();
  /**
   * The run of a loop: when it was started, and when it first stood on the
   * loop itself rather than on the way out to it. Null with no loop taken up.
   */
  private loopRun: { name: string; startedAt: number; lapBegunAt: number | null } | null = null;
  /** Runs begun and Auto-Flee's sys gotos sent, for the window's tab alerts (`noteRun`). */
  private ran = 0;
  private fled = 0;
  private wasRunning = false;
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
  private afflicted: Partial<Record<SharedAffliction, boolean>> = {};
  /** The engine's afflictions as last told to the host (`noteAfflictions`). */
  private flagged: Partial<Record<SharedAffliction, boolean>> = {};

  constructor(
    private readonly host: MegaEngineHost,
    setup: MegaEngineSetup
  ) {
    const engineHost: SessionHost = {
      write: (text) => this.write(text),
      // A debug step mark (`{…}`) is for the log alone; MegaMUD's other notes are shown too.
      trace: (text) => {
        if (text.startsWith('{') && this.host.logged !== undefined) {
          this.host.logged('step', text);
          return;
        }
        this.said(text);
      },
      activity: (text) => this.host.logged?.('doing', text),
      partyForgot: (name) => this.host.partyForgot?.(name),
      partyAlreadyDone: (leader, command) => this.host.partyAlreadyDone?.(leader, command) ?? false,
      show: (text) => this.said(text),
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
      uncertain: (p, i) => this.uncertain(p, i),
      lostInDark: () => this.lostInDark(),
      walkAside: () => this.parked,
      opensAWay: (name) => this.host.opensAWay?.(name) ?? false,
      leaveFor: (name) => this.host.leaveFor?.(name) ?? false,
      keepCoins: () => this.host.keepCoins?.() ?? false,
      counted: (count) => this.host.counted?.(count),
      caption: () => caption(this.s),
      forcible: (dir) => this.forcible(dir),
      clearWay: (p, i, dir) => this.clearWay(p, i, dir),
      readPath: (name) => this.readPath(name),
      saveSteps: (p) => this.saveSteps(p),
      blessingsCleared: () => this.blessingsCleared(),
      lineRead: (line) => this.noteAfflictions(line),
      beforeStep: () => this.beforeStep(),
      echo: (text) => this.sent(text)
    };
    this.memory = setup.memory ?? null;
    this.dataFrom = setup.data;
    this.alerts = setup.settings.live['Alerts'] ?? {};
    // A copy: the data read is shared between sessions, and the engine changes it as it learns.
    this.s = new Session(engineHost, structuredClone(setup.data));
    loadCharacter(this.s, setup.settings);
    // MegaMUD's debug marks, for the log: they only ever print (`logged`), never steer.
    if (host.logged !== undefined) this.s.debug = 1;
    bbsSetup(this.s, (key) => setup.bbs?.[key]);
    this.s.now = engineHost.clock();
    const memory = setup.memory;
    this.recall();
    if (memory) {
      rememberPlayers(this.s, memory.players);
      // MegaMUD's marks list lives as long as its window does; ours outlives a restart.
      // A rung's immunity saved before marks named their spell is not known
      // to be any spell's, and is let go (`combat/immunity.ts`).
      this.s.monsterMarks = (memory.marks ?? []).map(([name, flags, spells]) => ({
        name,
        flags: flags & ~CAST_IMMUNITY,
        ...(spells && spells.length > 0 ? { spells: [...spells] } : {})
      }));
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
            this.noteGates();
            this.noteAfflictions(null);
            this.fleeTick();
            this.keepLearned();
            this.noteToggles();
          }),
        SECOND_MS
      ),
      setInterval(
        () =>
          this.safely(() => {
            quietTick(this.s, this.t, this.quiet);
            if (this.noteRun()) this.noteToggles();
          }),
        QUIET_POLL_MS
      ),
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
    const index = monsterIndex(this.s);
    for (const rule of rules) rememberRule(this.s, rule, index);
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
    // The records by key, found once: see `monsterIndex`.
    const index = new Map<string, ItemRec>();
    for (const item of this.s.data.items) {
      const key = itemKey(item.name);
      if (!index.has(key)) index.set(key, item);
    }
    for (const rule of rules) {
      applyItemRule(this.itemRecord(rule.item, index), rule, this.host.world());
    }
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

  /**
   * An item's record, by name or key; one the records do not name is added.
   * Through `index`, the first record of each key, for a pass over a table.
   */
  private itemRecord(name: string, index?: Map<string, ItemRec>): ItemRec {
    const key = itemKey(name);
    const find = (): ItemRec | undefined =>
      this.s.data.items.find((item) => itemKey(item.name) === key);
    const found = index ? index.get(key) : find();
    if (found) return found;
    rememberItem(this.s, { name, weight: null, slot: null, weapon: false });
    const added = find()!;
    if (index && !index.has(key)) index.set(key, added);
    return added;
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
   * The settings changed (the profile's `megamud:` saved): put on the running session,
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
    const profile = s.Profiles_ActiveProfile;
    reloadCharacter(s, setup.settings);
    // Another profile chosen in the settings is a profile put on (`@profile`).
    if (s.Profiles_ActiveProfile !== profile) profileChanged(s);
    [s.monsterMarks, s.playerMarks] = marks;
    // The spells the rungs cast may have changed under the immunities.
    refreshImmunities(s);
    bbsSetup(s, (key) => setup.bbs?.[key]);
    [s.MegaMud_CurPath, s.MegaMud_SelPath, s.MegaMud_CurPathStep] = kept;
    TOGGLE_FIELDS.forEach((field, i) => (s[field] = toggles[i]!));
    if (s.rulesChanged !== 0) [s.rules, s.ruleAt] = [rules, ruleAt];
    if (s.eventsChanged !== 0) [s.events, s.eventNext] = [events, eventNext];
    else keepSchedule(s, events);
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
    // The spells the spellbook showed, and those the realm says last marked
    // again on the fresh copy (2026-10-25): Fatty's songs, lasting only by
    // the spell they cast, lost the mark on a settings save and were never
    // cast again.
    const known = new Set(
      was.spells.filter((spell) => (spell.flags & SpellFlag.Known) !== 0).map((spell) => spell.name)
    );
    for (const spell of s.data.spells) if (known.has(spell.name)) spell.flags |= SpellFlag.Known;
    this.lastingMarked = false;
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
      marks: marked
        ? s.monsterMarks.map((m): LearnedMark =>
            m.spells?.length ? [m.name, m.flags, m.spells] : [m.name, m.flags]
          )
        : null
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
  afflictions(
    now: Readonly<Record<SharedAffliction, Affliction>>,
    causes: Readonly<Partial<Record<SharedAffliction, AfflictionCause>>> = {}
  ): void {
    const s = this.s;
    for (const name of SHARED_AFFLICTIONS) {
      // One the engine set itself, told back, is not our tracker's reading:
      // taken as ours, an ended disease of MegaMUD's own stayed on as ours.
      const on = now[name] === 'yes' && !byEngine(causes[name]);
      if (on) s[AFFLICTION_FLAG[name]] = 1;
      else if (this.afflicted[name] === true) s[AFFLICTION_FLAG[name]] = 0;
      this.afflicted[name] = on;
      // Known to our tracker already: nothing to tell it back.
      this.flagged[name] = this.engineHas(name);
    }
  }

  /** Whether the engine has an affliction on: disease by either of its flags. */
  private engineHas(name: SharedAffliction): boolean {
    const s = this.s;
    if (name === 'diseased') return s.diseased !== 0 || s.diseaseHeard !== 0;
    return s[AFFLICTION_FLAG[name]] !== 0;
  }

  /**
   * The engine's afflictions that changed since last told, told to the host
   * with the line that changed them (`line`, null away from one): a
   * Messages.md row's when one matched it (`msgSpell`), else MegaMUD's own
   * reading of it. So the character shows what the engine acts on, and why.
   */
  private noteAfflictions(line: string | null): void {
    if (this.host.afflicted === undefined) return;
    const s = this.s;
    for (const name of SHARED_AFFLICTIONS) {
      const on = this.engineHas(name);
      if (on === (this.flagged[name] ?? false)) continue;
      this.flagged[name] = on;
      const row = line !== null && s.msgSpell !== '' ? s.msgSpell : null;
      this.host.afflicted(
        name,
        on,
        on
          ? {
              line: (line ?? '').trim(),
              at: Date.now(),
              how: row !== null ? 'message' : 'engine',
              ...(row !== null ? { spell: row } : {})
            }
          : null
      );
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
      // By its number first: a name can be another spell's too, and
      // "divine intervention" is also a lasting one's, which held mudrev's
      // `intr` to the round timer (2026-10-21).
      const byId = spell.id > 0 ? world.spellById(spell.id) : null;
      const known =
        byId !== null && byId.name.toLowerCase() === spell.name.toLowerCase()
          ? byId
          : world.spellNamed(spell.name);
      if (known !== null && spellLasts(known, (id) => world.spellById(id)))
        spell.flags |= SpellFlag.Timed;
    }
  }

  /**
   * The spells the character's spellbook lists, as our tracker last read it:
   * which of the spells sharing a short word is this character's
   * (`findSpell`). Kept apart from `Known`, which MegaMUD clears to ask again.
   */
  knowSpellbook(names: readonly string[]): void {
    const next = new Set(names.map((name) => name.toLowerCase()));
    const was = this.s.spellbookNames;
    if (next.size === was.size && [...next].every((name) => was.has(name))) return;
    this.s.spellbookNames = next;
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
    for (const name of SHARED_AFFLICTIONS)
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

  /**
   * The player's Connect (`connectPressed`): a redial MegaMUD had stopped as
   * unsafe overridden, and the last hang-up's leftovers cleared before the
   * dial. Whether it overrode a stop.
   */
  connectPressed(): boolean {
    let overrode = false;
    this.safely(() => {
      overrode = connectPressed(this.s, false);
    });
    return overrode;
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
    // A room seen: out of the dark the realm placed us in.
    if (this.s.darkness === Darkness.Lit) this.placedInDark = null;
    if (this.noteRun()) this.noteToggles();
    // Into the game with nowhere known: ask once, before anything wants a way.
    const entered = this.s.inGame !== 0 && !this.wasInGame;
    if (entered && this.host.here() === null) this.host.locate();
    this.wasInGame = this.s.inGame !== 0;
    if (
      this.parked !== null &&
      !this.parked.planning &&
      !this.parked.answer &&
      this.host.here() !== null
    )
      this.safely(() => this.unpark());
    this.noteToggles();
    this.noteGates();
    this.noteAfflictions(null);
    if (entered) this.host.enteredGame?.();
  }

  /** The gates as last told (`GATES`). */
  private gates: Partial<Record<(typeof GATES)[number], unknown>> = {};

  /** What changed of the gates, told as `state 0→46, held 1→0`. */
  private noteGates(): void {
    if (this.host.logged === undefined) return;
    const moved: string[] = [];
    for (const key of GATES) {
      const now = this.s[key];
      if (now === this.gates[key]) continue;
      if (key in this.gates)
        moved.push(`${key} ${JSON.stringify(this.gates[key])}→${JSON.stringify(now)}`);
      this.gates[key] = now;
    }
    if (moved.length > 0) this.host.logged('gates', moved.join(', '));
  }

  /** A line of MegaMUD's own, to the console and the log. */
  private said(text: string): void {
    this.host.logged?.('said', text);
    this.host.show(text);
  }

  /** Whether the character is in the game (`0x47b070`'s first prompt seen, not since left). */
  get inGame(): boolean {
    return this.s.inGame !== 0;
  }

  /**
   * What the engine alone knows of the character, for its realm's mudstats
   * board (`StatsReporter`): the experience meter's figures (`0x4a7250`, as
   * `@exp` gives them), the task's caption (`0x4aac80`, as `@status`), and
   * the path walked with the steps left (as `@path`, our loop's name for its
   * file). Null where the engine has nothing to say.
   */
  statsReport(): EngineStats {
    const s = this.s;
    // The loop by its run, as the loop card names it: MegaMUD's own path
    // name (`MegaMud_CurPath`) is never set for a path made here, and is the
    // route's, not the loop's, on the way to its start or a detour.
    const lap = this.madeFor(s.loopPath)?.loop ?? null;
    const loop = this.loopRun?.name ?? (s.looping !== 0 ? (lap?.name ?? null) : null);
    const made = this.madeFor(s.path);
    const walking = s.walking !== 0 && s.path.steps !== null;
    const n = stepsShown(s);
    const to =
      loop !== null && made?.loop?.name !== loop ? 'loop' : s.looping === 0 ? 'go' : 'lap end';
    const steps = n < 0 ? `? steps to ${to}` : `${n} step${n === 1 ? '' : 's'} to ${to}`;
    let path: string | null = null;
    if (loop !== null) {
      path = walking ? `${loop} - ${steps}` : loop;
    } else if (walking || s.MegaMud_CurPath !== '') {
      const name = made ? null : s.path.title || s.MegaMud_CurPath || null;
      const head = [name, s.destination].filter((part) => part).join(' -> ');
      path = head === '' ? null : walking ? `${head} - ${steps}` : head;
    }
    return { status: caption(s), path };
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
      canGo: s.inGame !== 0 && !allOff && somewhere,
      ran: this.ran,
      fled: this.fled
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

  /**
   * A run begun (`runCount` from none), whatever began it — a run percent, a
   * backstab refused, a player to flee, Auto-Flee's first step — counted for
   * the window's `ran` alert, one of the four that light a tab (2026-10-17).
   */
  private noteRun(): boolean {
    const running = this.s.runCount > 0;
    const begun = running && !this.wasRunning;
    this.wasRunning = running;
    if (begun) this.ran += 1;
    return begun;
  }

  /**
   * Says so when the toggles or the walking moved since last said: a press, a mode's defaults, a remote, a step.
   */
  private noteToggles(): void {
    this.noteRun();
    this.noteProgress();
    if (this.redialing !== this.wasRedialing) {
      this.wasRedialing = this.redialing;
      this.host.redialChanged?.();
    }
    const { on, walking, looping, canGo, ran, fled } = this.toggles;
    const now = JSON.stringify([on, walking, looping, canGo, ran, fled]);
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

  /**
   * Out of the fight, now: `break`, and the fight forgotten, as a member's
   * `@OI!` takes this character off its target (`oi`). Ours, for a Muster's
   * `sys goto` (2026-10-27), which would otherwise land the character still
   * fighting what it left behind.
   */
  breakCombat(): void {
    this.act(() => {
      const s = this.s;
      if (s.inCombat === 0) return;
      send(s, 'break\r');
      typedCommand(s, 0, 'break');
      combatOff(s);
      s.target = '';
    });
  }

  /**
   * Ours (2026-10-27): a command on its way to the realm, from anyone. A
   * `sys goto` calls off a run still to be made, as MegaMUD's own at
   * critical HP does (`criticalHp`): the realm takes the character away from
   * what it was running from. Only a step spends a run, so one left
   * outstanding once the walk was let go stood for good, and the blessings
   * (D25), which wait out a run, were never cast again: Fatty, sent from the
   * green dragon caverns to Khazarad by a `@do sys goto kha`, sang nothing
   * for eight hours, until Combat was pressed off and on.
   */
  commandSent(command: string): void {
    if (!SYS_GOTO.test(command.trim())) return;
    this.act(() => {
      this.s.runCount = 0;
      this.s.runByChoice = 0;
    });
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
    this.fled += 1;
    this.noteToggles();
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

  /** What is said before `@party` and the other party lines (BBS.INI `SpeechPrefix`). */
  get speechPrefix(): string {
    return this.s.speechPrefix;
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
  walkTo(room: RoomId, run = false, alone = false, planned?: Route): string | null {
    /*
     * A way already planned and shown — the route panel's, a quest leg's — is
     * the way walked, kept as this walk's plan from where it starts (2026-10-18).
     * Asked afresh, the planner's thread planned it for the lap's traveller:
     * Archer was shown the slums and the Black House's key and walked the
     * Dragontooth Hills instead. Off that way, the walk plans as it always did.
     */
    const start = planned?.steps[0]?.from;
    if (planned !== undefined && start !== undefined && !planned.blocked)
      this.plans.set(planKey('route', start, room), { route: planned, at: Date.now() });
    const sig = this.signatureOf(room) ?? this.standInFor(room);
    const s = this.s;
    if (alone) {
      clearPath(s.loopPath);
      s.looping = 0;
    }
    clearDetours(s);
    this.goingTo = { sig, room };
    goTo(s, sig, null);
    headFor(s, 1);
    // The Go-To dialog's Go and Run (`0x43e680`), and the setting before put
    // back on arrival. Go walks with the player's own setting rather than
    // MegaMUD's auto-combat on (ours, 2026-10-25: a route is walked for every
    // leg and errand, not only when the player sets out to fight its way).
    if (s.detourCombat !== -1) reEngage(s);
    const fight = run ? 0 : s.MegaMud_AutoCombat;
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
      if (SYS_GOTO.test(this.lineSoFar.trim())) out += '\r';
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
    for (const [standIn, room] of this.standIns)
      if (room === here) this.replaceStandIn(standIn, sig);
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
    const rooms = s.data.rooms ?? [];
    return {
      rooms: [...new Set(rooms.map((r) => r.name))],
      banks: [
        ...new Set(rooms.filter((r) => ((r.flags ?? 0) & RoomFlag.Bank) !== 0).map((r) => r.name))
      ],
      weapons: carried(isWeapon),
      backstab: carried(canBackstab),
      shields: carried(isShield),
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

  /** The stand-in signature for a room with none worked out (`standIns`). */
  private standInFor(room: RoomId): number {
    for (const [sig, at] of this.standIns) if (at === room) return sig;
    let h = 0x811c9dc5;
    for (let i = 0; i < room.length; i += 1) h = Math.imul(h ^ room.charCodeAt(i), 0x01000193);
    // North's two bits 3; never -1 (all bits), MegaMUD's "no room".
    let sig = (h & ~3) | 3;
    while (sig === -1 || this.standIns.has(sig)) sig = (sig - 4) | 0;
    this.standIns.set(sig, room);
    return sig;
  }

  /** A stand-in signature replaced by the room's own wherever the walk holds it. */
  private replaceStandIn(standIn: number, sig: number): void {
    this.standIns.delete(standIn);
    const s = this.s;
    for (const d of s.detours) if (d.room === standIn) d.room = sig;
    const paths = [s.path, s.loopPath, ...s.paths, ...[...this.made.values()].map((m) => m.path)];
    for (const p of paths) {
      if (p.start === standIn) p.start = sig;
      if (p.end === standIn) p.end = sig;
    }
    if (this.goingTo?.sig === standIn) this.goingTo.sig = sig;
    const rooms = s.data.rooms ?? [];
    const at = rooms.findIndex((r) => r.signature === standIn);
    if (at !== -1) {
      if (rooms.some((r) => r.signature === sig)) rooms.splice(at, 1);
      else rooms[at]!.signature = sig;
    }
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
   * `SessionHost.uncertain`: MegaMUD's step check finds this is not the
   * step's room, so the realm is asked where the character is (`locate`,
   * `sys status` or `rm`), once a step, and our tracker takes the answer
   * before the check is made again (2026-10-18). Without it a tracker sure of
   * the wrong room stayed sure: nothing asks while it has one.
   */
  private uncertain(p: PathRec, i: number): void {
    const key = `${p.name}:${i}`;
    if (this.askedWhere === key) return;
    this.askedWhere = key;
    if (this.host.locate()) this.host.logged?.('doing', 'Asking the realm where we are');
  }

  /** The path step whose room was last asked about (`uncertain`). */
  private askedWhere: string | null = null;

  /**
   * `SessionHost.lostInDark`: a walk lost in the dark asks the realm where
   * the character is and is put aside until it answers, then planned again
   * from there (`located`) — where MegaMUD tries the exits blind. Not twice
   * from the room the realm last named: refused again there, the way the
   * data gives is not the realm's, and MegaMUD's own search is what is left.
   */
  private lostInDark(): number {
    const s = this.s;
    if (this.parked !== null || s.walking === 0) return 0;
    const here = this.host.here();
    if (here !== null && here === this.placedInDark) return 0;
    if (!this.host.locate()) return 0;
    this.host.logged?.('doing', 'Lost in the dark: asking the realm where we are');
    s.lost = 0;
    this.park(false, true);
    s.walking = 0;
    s.looping = 0;
    s.roaming = 0;
    return 1;
  }

  /** The room the realm named for a walk lost in the dark (`lostInDark`). */
  private placedInDark: RoomId | null = null;

  /**
   * The realm has said where the character is, and our tracker has taken it:
   * a walk put aside for the answer (`lostInDark`) is planned again from
   * there.
   */
  located(): void {
    const parked = this.parked;
    if (parked === null || !parked.answer) return;
    parked.answer = false;
    this.placedInDark = this.host.here();
    if (this.placedInDark !== null) this.safely(() => this.unpark());
  }

  /**
   * `SessionHost.clearWay`: a step of one of our paths whose exit is not
   * open: the levers the realm keeps in this room pulled a couple of times,
   * else a hidden exit searched for, the room looked at again after (a bare
   * Enter), where the old walker did both. Only while the exit is not showing,
   * so a lever is not pulled shut again on a lap it stood open.
   *
   * A hidden exit the realm marks searchable is searched for until it shows,
   * and the step held until then, as the old walker came to (2026-09-06): a
   * search is a roll of a skill, and two that failed are not the realm being
   * wrong. Bounded at two, the step went on into the wall: Archer, in the
   * Closet off the keep's hallway on 2026-10-18, searched west twice, then
   * walked into it some thirty times until two searches typed by hand found
   * the concealed door.
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
    if (exit === Exit.None && req?.kind === 'hidden' && req.searchable === true) {
      if (tries.searches === 0) s.host.show(`[Searching ${step.direction} for the hidden exit]`);
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
  private forcible(dir: number): { pick: boolean; bash: boolean; knock: string | null } {
    const here = this.placedHere();
    const way = here === null ? undefined : DIRECTIONS[dir];
    const exit = way && this.worldRoom(here!)?.exits.find((x) => x.direction === way);
    const s = this.s;
    const world = this.host.world();
    const spell = world
      ? doorSpell(
          world.allSpells(),
          (known) => s.spellbookNames.has(known.name.toLowerCase()),
          s.Player_Level
        )
      : null;
    const may = forcibleBy(
      exit?.requirement ?? null,
      s.Player_Picklocks > 0 ? s.Player_Picklocks : null,
      s.Player_Strength > 0 ? s.Player_Strength : null,
      spell?.power ?? null
    );
    const word = spell?.spell.short ?? null;
    return { pick: may.pick, bash: may.bash, knock: may.knock && word ? word : null };
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

  /**
   * `legs` walked one after another as one path; `said[i]`, where given, the
   * commands typed in its room before leg `i` sets out (a loop's stop's own).
   */
  private makePath(
    name: string,
    title: string,
    legs: Route[],
    start: number,
    end: number,
    said: readonly ({ at: RoomId; say: readonly string[] } | null)[] = []
  ): PathRec {
    const p = newPath();
    p.name = name;
    p.title = title.slice(0, 0x50);
    p.author = 'mudengine';
    const rooms: (RoomId | null)[] = [];
    const walked: (RouteStep | null)[] = [];
    const steps: PathStep[] = [];
    for (const [i, leg] of legs.entries()) {
      /*
       * Ours (2026-10-23): a stop's commands (`LoopStop.commands`, `touch
       * hammer` where the frost giant is summoned), as path steps that do not
       * move, like the levers below: MegaMUD types each and looks at the room
       * again, so what it brings is fought before the leg sets out.
       */
      for (const say of said[i]?.say ?? []) {
        rooms.push(said[i]!.at);
        walked.push(null);
        steps.push(this.stepFrom(said[i]!.at, say));
      }
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
    const standIn = this.standIns.get(to);
    const rooms =
      going?.sig === to
        ? [going.room]
        : standIn !== undefined
          ? [standIn]
          : this.roomsWith(to).slice(0, 8);
    let unlocks: { needs: Route['needs']; room: RoomId } | null = null;
    /** Why the first way refused was refused, the planner's own sentence. */
    let why: string | null = null;
    for (const room of rooms) {
      if (room === here)
        return { flags: 0, path: this.makePath(this.routeName(), 'route', [], from, to), steps: 0 };
      const plan = this.plan(here, room, 'route');
      if (plan === 'pending') pending = true;
      if (typeof plan !== 'string' && plan.blocked && plan.unlocks?.needs !== undefined)
        unlocks ??= { needs: plan.unlocks.needs, room };
      if (typeof plan === 'string' || plan.blocked) {
        why ??= typeof plan === 'string' ? plan : (plan.reason ?? null);
        continue;
      }
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
      // Ours: why, beside MegaMUD's *There are no paths defined* (2026-10-19).
      if (why !== null) this.host.show(`[${why}]`);
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
  private plan(from: RoomId, to: RoomId, walking: PlanFor): Route | string | 'pending' {
    const key = planKey(walking, from, to);
    const kept = this.plans.get(key);
    if (kept === 'pending') return kept;
    if (kept !== undefined && Date.now() - kept.at < PLAN_KEPT_MS) return kept.route;
    const asked = this.host.plan(from, to, walking);
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
    if (this.parked !== null && !this.parked.answer && this.host.here() !== null) this.unpark();
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
    const stops = this.host.loopRooms(name);
    if (typeof stops === 'string') return stops;
    const drawn = JSON.stringify(stops);
    const known = this.made.get(shortName('L', name).toLowerCase());
    if (known?.loop?.drawn === drawn) return known.path;
    const rooms = bounced(stops.rooms, stops.bounce);
    const commands = bounced(stops.commands, stops.bounce);
    if (rooms.length < 2) return `The loop "${name}" has fewer than two stops.`;
    const start = this.signatureOf(rooms[0]!) ?? this.standInFor(rooms[0]!);
    const legs: Route[] = [];
    const said: ({ at: RoomId; say: readonly string[] } | null)[] = [];
    const begins: number[] = [];
    let steps = 0;
    // Every leg asked for at once, so the planner's thread works on them together.
    const planned = rooms.map((from, i) => {
      const to = rooms[(i + 1) % rooms.length]!;
      return from === to ? null : this.plan(from, to, 'lap');
    });
    if (planned.includes('pending')) return 'pending';
    for (const [i, plan] of planned.entries()) {
      begins.push(steps);
      const from = rooms[i]!;
      const to = rooms[(i + 1) % rooms.length]!;
      const say = commands[i] ?? [];
      if (plan === 'pending') continue;
      if (typeof plan === 'string') return plan;
      if (plan !== null && plan.blocked) {
        if (this.fetchFor(plan.unlocks?.needs, { loop: name }))
          return `The loop "${name}" starts once the pack holds what its way needs.`;
        return plan.reason ?? `No way from ${from} to ${to}.`;
      }
      // A stop listed twice in a row: no leg, but its commands are still typed.
      if (plan === null && say.length === 0) continue;
      const leg = plan ?? { steps: [], cost: 0, blocked: false };
      legs.push(leg);
      said.push(say.length > 0 ? { at: from, say } : null);
      steps += say.length + pathLength(leg);
    }
    const p = this.makePath(shortName('L', name), name, legs, start, start, said);
    this.madeFor(p)!.loop = {
      name,
      stops: rooms,
      listed: stops.rooms.length,
      bounce: stops.bounce,
      begins,
      drawn
    };
    // The path made before an edit gives way to this one.
    this.s.paths = [...this.s.paths.filter((other) => other.name !== p.name), p];
    return p;
  }

  /**
   * A loop as MegaMUD's own path file (2026-10-19), for MegaMUD to walk: the
   * path `loopPath` makes for this character — its legs planned as a lap's,
   * the levers, keys and party commands on its steps — written as
   * `0x4888e0` writes one. The start room's line is MegaMUD's room record
   * (`[code:area:name]`), which `0x482fc0` files under the room's signature
   * when MegaMUD has none for it, so the loop is placed on its first load.
   *
   * A leg the planner refuses is said, never fetched for: an export is not
   * a walk. Nor is a start no signature can be worked out for, which MegaMUD
   * could never find itself in.
   */
  async exportLoop(name: string): Promise<{ file: string; text: string } | string> {
    const stops = this.host.loopRooms(name);
    if (typeof stops === 'string') return stops;
    const rooms = bounced(stops.rooms, stops.bounce);
    if (rooms.length < 2) return `The loop "${name}" has fewer than two stops.`;
    const start = this.signatureOf(rooms[0]!);
    if (start === null) return `MegaMUD has no way to know the loop's first room, ${rooms[0]}.`;
    // Every leg planned first, as the lap's would be, so `loopPath` finds them all.
    const legs = rooms.map((from, i): [RoomId, RoomId] => [from, rooms[(i + 1) % rooms.length]!]);
    for (const [from, to] of legs) {
      if (from === to) continue;
      const asked = this.host.plan(from, to, 'lap');
      if (typeof asked === 'string') return asked;
      const route = await asked.catch((error: unknown): Route => ({
        steps: [],
        cost: 0,
        blocked: true,
        reason: error instanceof Error ? error.message : String(error)
      }));
      if (route.blocked) return route.reason ?? `No way from ${from} to ${to}.`;
      this.plans.set(planKey('lap', from, to), { route, at: Date.now() });
    }
    const p = this.loopPath(name);
    if (typeof p === 'string')
      return p === 'pending' ? `The loop "${name}" is still being planned.` : p;
    const room = this.worldRoom(rooms[0]!);
    const roomName = (room?.name ?? rooms[0]!).slice(0, 0x28);
    // MegaMUD's own short code for a room is four letters of its name (`ACRY`, Ancient Crypt).
    const code =
      roomName
        .split(/\s+/)
        .map((word) => word.replace(/[^A-Za-z]/g, ''))
        .join('')
        .slice(0, 4)
        .toUpperCase() || 'MUDE';
    const area = (loopArea(name) ?? 'mudengine').slice(0, 0x14);
    const hex = (n: number, width: number): string =>
      (n >>> 0).toString(16).toUpperCase().padStart(width, '0');
    const steps = (p.steps ?? []).map(
      (st) => `${hex(st.room, 8)}:${hex(st.flags & ~StepFlag.Resynced & 0xffff, 4)}:${st.command}`
    );
    const lines = [
      `[${name.slice(0, 0x50)}][mudengine]`,
      `[${code}:${area}:${roomName}]`,
      `${hex(start, 8)}:${hex(start, 8)}:${steps.length}:-1:0:::`,
      ...steps
    ];
    const base =
      name
        .replace(/^[^:]*:\s*/, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 4)
        .toUpperCase() || 'MUDE';
    return { file: `${base}LOOP.mp`, text: `${lines.join('\r\n')}\r\n` };
  }

  /** The walk put aside, as it stands, until the room is placed or the way planned. */
  private park(planning: boolean, answer = false): void {
    const s = this.s;
    this.parked = {
      detours: structuredClone(s.detours),
      walking: s.walking,
      looping: s.looping,
      roaming: s.roaming,
      lost: s.lost,
      until: Date.now() + LOCATE_WAIT_MS,
      planning,
      answer
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

  /**
   * The items the walk now under way needs (2026-10-20): the key a door on
   * it asks for, the item an exit on it asks for, an item a step uses — what
   * `movement.collectKeys` takes off a floor. Read off the planner's steps
   * the path and the loop were made from (`MadePath.walked`), so a route
   * through the black star key's door wants that key and no other; none
   * while nothing is walked, the player at the keys.
   */
  walkNeeds(): ReadonlySet<number> {
    const s = this.s;
    const needs = new Set<number>();
    const from = (p: PathRec): void => {
      for (const st of this.madeFor(p)?.walked ?? []) {
        if (st === null) continue;
        const req = st.requirement;
        if ((req?.kind === 'key' || req?.kind === 'item') && req.keyId !== undefined)
          needs.add(req.keyId);
        if (st.invoke !== undefined) needs.add(st.invoke.id);
      }
    };
    if (s.walking !== 0) from(s.path);
    if (s.looping !== 0) from(s.loopPath);
    return needs;
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
