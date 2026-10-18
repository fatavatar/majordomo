/**
 * The state megamud.exe keeps per connection: one struct its code reaches
 * through a register and tests field by field. Each field here is one of the
 * struct's, named for what it was read to mean, its offset in the comment.
 * A field only partly understood is named `probably…`, and one not
 * understood `unknown_<offset>` (docs/megamud/engine-port.md). Settings are
 * inherited from `SettingsFields`, named as the decompiled struct names them.
 *
 * Times: `now` is the struct's clock (`0x32290`), `_time64` seconds, stamped
 * by the once-a-second timer and a few other places; every timing test reads
 * the stamp, never a live clock. `tick()` is `GetTickCount64`.
 */
import type { BotCommand } from '../../shared/remotes';
import type { ItemRec, MegaData, MonsterRec, PlayerRec, RoomRec } from './data';
import type { MegaSettings } from '../../shared/megamud/settings';
import { StateFields } from './StateFields';
import type { Pending } from './script/send';
import { EntityType, Stance } from './flags';

/** One entry in the room's contents (`0x471190`, 0x48 bytes). */
export interface RoomEntity {
  /** +0x00: 0 not yet known, 1 player, 2 monster, 3 item (as `0x471a10` sorts them). */
  type: number;
  /** +0x04: what it is to us: 2 charmed/white, 3 cyan, 4–6 hostile. */
  kind: number;
  /** +0x08: its attack priority (`0x474a90`); 999 and -999 are pinned. */
  priority: number;
  /** +0x0c: how many (an item stack). */
  count: number;
  /** +0x10, 30 characters. */
  name: string;
  /** +0x30: its player record, when it is a player. */
  player: PlayerRec | null;
  /** +0x34: its monster record, when it is a known monster. */
  mon: MonsterRec | null;
  /** +0x38: its item record, when it is an item. */
  item: ItemRec | null;
  /** +0x3c: `EntityFlag` bits. */
  flags: number;
  /** +0x40. */
  f40: number;
  /** +0x44. */
  f44: number;
}

/**
 * One ability monitor (`[AbilMon]` `MonitorN`, 0x108 bytes): when ability
 * `ability`'s value (or one part of it) compares to `value`, cast `spell` or
 * send `command`. Checked every `interval` seconds, around rests and
 * meditations, after a spell, or when a line starts with `message`.
 */
export interface AbilityMonitor {
  /** +0x00 */
  disabled: number;
  /** +0x04 */
  ability: number;
  /** +0x08: 0 the total, 1 granted, 2 worn, 3 spells, 4 race, 5 class. */
  part: number;
  /** +0x0c: fires when the value is 0 below, 1 equal to, 2 above `value`. */
  compare: number;
  /** +0x10 */
  value: number;
  /** +0x14: 0 cast `spell`, 1 send `command`. */
  useCommand: number;
  /** +0x18, 7 characters: a spell's short name. */
  spell: string;
  /** +0x1f, 81 characters. */
  command: string;
  /** +0x70, 81 characters (`MonitorNMsg`): a line starting with it triggers a check. */
  message: string;
  /** +0xc4: when to check: `MonitorWhen` bits (`Every` is each `interval` seconds). */
  when: number;
  /** +0xc8: seconds between checks (5 at least). */
  interval: number;
  /** +0xcc: "Re-check value after action": firing checks its chain again. */
  chainOn: number;
  /** +0xd0: chained to the monitor before it. */
  chained: number;
  /** +0xd4: its command jumps the pending list. */
  urgent: number;
  /** +0xd8: `MonitorState`. */
  state: number;
  /** +0xdc: a check is due. */
  due: number;
  /** +0xe0: since when (seconds). */
  dueAt: number;
  /** +0xe8: due because its chain fired. */
  byChain: number;
  /** +0xf0: when the next timed check is (seconds; 0 not set). */
  nextAt: number;
  /** +0xf8: the value last read. */
  lastValue: number;
  /** +0xfc: `abil` asks gone unanswered. */
  noReply: number;
  /** +0x100: told that the ability has no separate part. */
  warnedPart: number;
}

export function newMonitor(): AbilityMonitor {
  return {
    disabled: 0,
    ability: 0,
    part: 0,
    compare: 0,
    value: 0,
    useCommand: 0,
    spell: '',
    command: '',
    message: '',
    when: 0,
    interval: 0,
    chainOn: 0,
    chained: 0,
    urgent: 0,
    state: 0,
    due: 0,
    dueAt: 0,
    byChain: 0,
    nextAt: 0,
    lastValue: 0,
    noReply: 0,
    warnedPart: 0
  };
}

/** One rule (`[Rules]` `RN`, 0x38 bytes). */
export interface Rule {
  /** +0x00: 0 a rule's name, 1 or 2 a condition, 3 or 4 an action. */
  kind: number;
  /**
   * +0x04: a condition's value: 1 HP %, 2 mana %, 3 the weakest member's HP %,
   * 4 members here, 5 monsters here, 6 `text` is here, 7 the room is `text`;
   * an action: 0 rest, 1 rest to full HP, 2 rest to full mana, 3 run, 4 hang
   * up, 0xe send `text`.
   */
  what: number;
  /** +0x08: a condition's test: 0 =, 1 ≠, 2 >, 3 ≥, 4 <, 5 ≤ (`text` as a number). */
  test: number;
  /** +0x0c, 41 characters. */
  text: string;
}

/** One timed event (`[Schedule]` `EventN`, 0x70 bytes). */
export interface TimedEvent {
  /** +0x04: 1 log on, 2 log off, 3 relog, 4 detour to a room, 5 a command, 6 change loop. */
  type: number;
  /**
   * +0x08: the hour it is due daily; or -1 every `minute` minutes, -2 every
   * `minute` seconds, -3 every `minute` hours.
   */
  hour: number;
  /** +0x0c: the minute it is due, or the interval. */
  minute: number;
  /** +0x10, 81 characters: the room, command or loop. */
  text: string;
  /** +0x68: when it is next due (seconds; 0 not worked out yet). */
  dueAt: number;
}

/** One player online (`0x4c0f00`, 0x48 bytes). */
export interface WhoEntry {
  /** +0x04: what it is to us, as a room entry's kind (3 unknown). */
  kind: number;
  /** +0x10, 31 characters. */
  name: string;
  /** +0x30: its player record. */
  player: PlayerRec | null;
  /** +0x40: when it was last tracked (seconds). */
  trackedAt?: number;
}

/**
 * `0x43fd90`'s answer: `flags` 0 found, else `RouteFlag` bits; the
 * path to take first (`special` -3 to -8 for a MUD op's `sys goto`), and the
 * steps to go.
 */
export interface RouteFound {
  flags: number;
  path: PathRec | null;
  special?: number;
  steps: number;
  /** 0x5664f0, 0x5664f4: the levels the way allows. */
  minLevel?: number;
  maxLevel?: number;
  /** 0x5664f8: the gold it costs. */
  gold?: number;
  /** 0x566500: the item it needs. */
  item?: string;
  /** 0x566520: the room the restriction is on. */
  via?: number;
}

/** `0x99999999`: a path step taken from any room (roaming steps, `0x409170`). */
export const ANY_ROOM = 0x99999999 | 0;

/** One step of a path (a `.mp` file's `room:flags:command` line, `0x482fc0`). */
export interface PathStep {
  /** +0x00: the signature (`roomSignature`) of the room it is taken from; -1 not learned yet. */
  room: number;
  /** +0x04: `StepFlag` bits, the Path Steps dialog's and MegaMUD's own. */
  flags: number;
  /** +0x06: what is typed: a direction, or a command (`[key]` text for a door). */
  command: string;
}

/**
 * A path, `0x84` bytes: the one walked (`0xe39c`), the loop (`loopPath`), and
 * the paths known (`0x7f20`). The walked path's name is `MegaMud.CurPath`
 * and its step `MegaMud.CurPathStep`; the loop's name `MegaMud.SelPath`.
 */
export interface PathRec {
  /** +0x04: its title. */
  title: string;
  /** +0x08: who recorded it. */
  author: string;
  /** +0x0c, 14 characters: its file. */
  name: string;
  /** +0x39, 14 characters: the path to take when a door's `[fail]` stops this one. */
  retry: string;
  /** +0x47, 14 characters: the path that follows this one. */
  next: string;
  /** +0x58: the signature of the room it starts from. */
  start: number;
  /** +0x5c: the room it ends in (the start, for a loop). */
  end: number;
  /** +0x6c: how many steps. */
  count: number;
  /** +0x70: the step reached. */
  at: number;
  /** +0x74: the step record reached (a byte offset in MegaMUD, an index here). */
  step: number;
  /** +0x78: the step record before it. */
  prev: number;
  /** +0x7c/+0x80: the steps, once loaded (`0x482fc0`). */
  steps: PathStep[] | null;
}

export function newPath(): PathRec {
  return {
    title: '',
    author: '',
    name: '',
    retry: '',
    next: '',
    start: 0,
    end: 0,
    count: 0,
    at: 0,
    step: 0,
    prev: 0,
    steps: null
  };
}

/** A path record whose name and step are two of the settings (`0xe3a8`, `0xe40c`; `0xe4b0`). */
function settingsPath<K extends 'MegaMud_CurPath' | 'MegaMud_SelPath'>(
  s: Session,
  name: K,
  at: 'MegaMud_CurPathStep' | null
): PathRec {
  const p = newPath();
  Object.defineProperty(p, 'name', {
    enumerable: true,
    get: () => s[name],
    set: (v: string) => (s[name] = v)
  });
  if (at) {
    Object.defineProperty(p, 'at', {
      enumerable: true,
      get: () => s[at],
      set: (v: number) => (s[at] = v)
    });
  }
  return p;
}

/** One inventory line (`0x452ba0`, 12 bytes). */
export interface Carried {
  /** +0x00: how many. */
  count: number;
  /** +0x04: `CarriedFlag` bits. */
  flags: number;
  /** +0x08: its item record. */
  item: ItemRec | null;
}

/** One party member (`0x8918 + i * 0x58`). */
export interface PartyMember {
  /** +0x00 */
  name: string;
  /** +0x0c: its HP, percent of its maximum. */
  hpPct: number;
  /** +0x10: its HP, as last reported. */
  hp: number;
  /** +0x14: its maximum HP. */
  maxHp: number;
  /** +0x18: its mana, percent of its maximum. */
  manaPct: number;
  /** +0x1c: its mana. */
  mana: number;
  /** +0x20: its maximum mana. */
  maxMana: number;
  /** +0x24: its class. */
  cls: number;
  /** +0x28: `PartyFlag` bits. */
  flags28: number;
  /** +0x4a: when it left the realm. */
  leftAt?: number;
  /** +0x38: what it is attacking, 30 characters (`Party.AttackLate`; `0x42bef0` clears it). */
  target: string;
}

export function newMember(): PartyMember {
  return {
    name: '',
    hpPct: 0,
    hp: 0,
    maxHp: 0,
    manaPct: 0,
    mana: 0,
    maxMana: 0,
    cls: 0,
    flags28: 0,
    target: ''
  };
}

export function newEntity(): RoomEntity {
  return {
    type: EntityType.NotKnown,
    kind: Stance.Unknown,
    priority: 0,
    count: 0,
    name: '',
    player: null,
    mon: null,
    item: null,
    flags: 0,
    f40: 0,
    f44: 0
  };
}

/** A line and the attribute of each of its characters. */
export interface LineBuf {
  text: string;
  attr: number[];
}

/** What the engine sends, logs and reads the time from. */
export interface SessionHost {
  /**
   * The socket write under `0x42d9f0`. A `\x01` (a macro's `~`) is a
   * half-second pause before the rest (`0x42e1c0`).
   */
  write(text: string): void;
  /** `0x4bd580`: MegaMUD's trace (the `{D%d}` lines and the bracketed notes). */
  trace(text: string): void;
  /** `0x4aab70`: the activity log ("Resting because …"). */
  activity(text: string): void;
  /** `0x4bd3c0`: a line shown to the player. */
  show(text: string): void;
  /** `_time64(NULL)`. */
  clock(): number;
  /** `GetTickCount64()`. */
  tickMs(): number;
  /** The status text (`0x4ac2a0`), when it changes. */
  status?(text: string): void;
  /** A command shown as sent (`Display.ShowSend`, and pending commands). */
  echo?(text: string): void;
  /** One of MegaMUD's alert sounds (`0x4c0640`). */
  alert?(which: string): void;
  /** The task changed (`0x4aac80`). */
  task?(task: number): void;
  /** The task's caption (the status bar's first pane, `0x4aac80`'s text). */
  caption?(): string;
  /** C's `rand()`, 0 to 32767 (Math.random when absent). */
  rand?(): number;
  /** `0x45fa60`: a move arrived (its direction), for the map to follow (ours). */
  arrived?(step: number): void;
  /**
   * Ours: a path's step is about to go out. What is kept beside the engine
   * (a ward the room ahead wants) queues its command here, and a command
   * queued holds the step as any pending command does (2026-10-14).
   */
  beforeStep?(): void;
  /**
   * The `stat` display took every blessing as gone (`0x494e70`); MegaMUD
   * sees the ones still up again on the display's own lines, by their
   * Messages.md rows. Ours: the blessings our tracker has up, put back.
   */
  blessingsCleared?(): void;
  /** Ours: a line the handlers have read (`ParseData`), whole or the prompt left over. */
  lineRead?(line: string): void;
  /**
   * `0x43fd90`: the way from one room to another (signatures), over the
   * paths known; our world graph's in place of MegaMUD's path search.
   */
  route?(from: number, to: number): RouteFound;
  /**
   * Ours: whether the room here is the one `sig` stands for. A room the
   * player chose by its map and number is that room, not another with its
   * name and exits (and so its signature); true when nothing says otherwise.
   */
  isRoom?(sig: number): boolean;
  /**
   * Ours: whether the room here is step `i`'s of path `p` (`p.count`: the
   * room it ends in), for a path whose steps' rooms are known by their map
   * and number; true when nothing says otherwise.
   */
  isStepRoom?(p: PathRec, i: number): boolean;
  /**
   * Ours: the room here is not step `i`'s of path `p` by MegaMUD's own check,
   * the room looked at again (`0x409170`): the realm asked where the
   * character is, so the check that follows reads a room the realm placed.
   */
  uncertain?(p: PathRec, i: number): void;
  /**
   * Ours: whether the closed exit `dir` from here gives to picking or
   * bashing, by what the realm states of it; both when nothing is known.
   */
  forcible?(dir: number): { pick: boolean; bash: boolean };
  /**
   * Ours: step `i` of path `p`, out by `dir`, made ready where the realm
   * says how (levers in this room, a hidden exit searched for); 1 when
   * something was sent and the step waits, 0 for MegaMUD's door code.
   */
  clearWay?(p: PathRec, i: number, dir: number): number;
  /**
   * Ours: an item here taken as one needed for a path, whatever its record
   * says, because it opens a way of the realm the pack lacks.
   */
  opensAWay?(name: string): boolean;
  /**
   * `0x482fc0`'s file: a path by its name (a `route`'s among them); the
   * paths known (`Session.paths`) are looked in when this is absent or null.
   */
  readPath?(name: string): PathRec | null;
  /** `0x4888e0`: a path whose steps changed, written back; nonzero when it was. */
  saveSteps?(path: PathRec): number;
  /** `0x4bf9e0`: a yes-or-no question put to the player (no when absent). */
  ask?(text: string): boolean;
  /** `0x4bf7e0`: a message box. */
  message?(text: string): void;
  /** `0x460b90`: a menu command posted to the window, run after this message (`menuCommand`). */
  post?(command: number): void;
  /** `0x4b6fe0`'s `closesocket`: the engine hangs up (`connectionClosed` follows from the host). */
  hangUp?(): void;
  /** `0x45a6b0`: the connect started again (task 2, after the redial pause). */
  dial?(): void;
}

/** Walking a path, roaming or importing one: the engine is taking the character somewhere. */
export function moving(s: Session): boolean {
  return s.walking !== 0 || s.roaming !== 0 || s.importing !== 0;
}

/** That, or AFK (`active`): the engine is acting for the player. */
export function automated(s: Session): boolean {
  return s.active !== 0 || moving(s);
}

/** The arena's room signature, where nobody is attacked for real (as `breaks off combat` reads it). */
export const ARENA = 0x67110001;

export class Session extends StateFields {
  constructor(
    readonly host: SessionHost,
    public data: MegaData
  ) {
    super();
  }

  // ------------------------------------------------------------ clock

  /** 0x32290: the clock stamp, seconds. */
  now = 0;

  // ------------------------------------------------------------ round timer

  /** 0x32628: where in the 5-second round (ms, 0–4999) rounds begin. */
  roundAnchor = 0;
  /** 0x3262c: round events sampled (up to 32). */
  roundSamples = 0;
  /** 0x32630: the last event's distance past the round's start, ms. */
  roundDrift = 0;
  /** 0x32634: events in a row that were off the round by 150–2500 ms. */
  roundOffCount = 0;
  /** 0x32638: events in a row far off the round (over 2500 ms). */
  roundJumps = 0;
  /** 0x3263c: the phase the far-off events agree on. */
  roundJumpPhase = 0;
  /** 0x32640: events in a row slipping 150–2500 ms. */
  roundSlips = 0;
  /** 0x32644: the phase the slipping events agree on. */
  roundSlipPhase = 0;
  /** 0x32648: rounds are synced (1). */
  roundSynced = 0;
  /** 0x3264c: the last round event's kind (1 combat, 2 experience, 3 spelllock, 4 probe). */
  roundEventKind = 0;
  /** 0x32650: confidence in the round's timing, 0–100. */
  roundConfidence = 0;
  /** 0x32654: round events counted. */
  roundEvents = 0;
  /** 0x32658: when the last round event came, ms. */
  roundEventAt = 0;
  /** 0x32308: when a spell was last cast, seconds (the clock). */
  castAt = 0;
  /** 0x32660: a cast is stamped this round. */
  castStamped = 0;
  /** 0x32668: when a spell was last cast, ms. */
  castTick = 0;
  /** 0x32670: the game said a spell was already cast this round. */
  spellLock = 0;
  /** 0x32678: when the spell lock was seen, ms. */
  spellLockAt = 0;
  /** 0x32680: the lock was lifted by a new round. */
  spellLockLifted = 0;
  /** 0x32684: spell locks seen since the last round event. */
  spellLocks = 0;
  /** 0x32688: three or more locks without a round event. */
  spellLockStuck = 0;

  // ------------------------------------------------------------ rules

  /** 0x22d0/0x22d8: the rules (`[Rules]`, `0x49c820`). */
  rules: Rule[] = [];
  /** 0x22a0: the rule the next pass starts at. */
  ruleAt = 0;
  /** 0x22a4: the name of the rule being read. */
  ruleName = '';
  /** 0xe248: they changed since they were saved. */
  rulesChanged = 0;

  // ------------------------------------------------------------ timed events

  /** 0x2358/0x236c: the timed events (`[Schedule]`, `0x437870`). */
  events: TimedEvent[] = [];
  /** 0x2354: the next one due (-1 none). */
  eventNext = -1;
  /** 0xe274: they changed since they were saved. */
  eventsChanged = 0;

  // ------------------------------------------------------------ ability monitors

  /** 0x237c/0x2384: the ability monitors (`[AbilMon]`, `0x404140`), chains in order. */
  monitors: AbilityMonitor[] = [];
  /** 0xe278: they changed since they were saved. */
  monitorsChanged = 0;
  /** 0x238c: the monitor whose `abil N` reply is awaited (-1 none). */
  monitorAsked = -1;
  /** 0x2390: an `abil N` reply is awaited. */
  abilAsking = 0;
  /** 0x2394: the reply has given a value. */
  abilGot = 0;
  /** 0x2398: it gave the parts (granted, worn, …) separately. */
  abilParts = 0;
  /** 0x239c: the reply's values: the total, granted, worn, spells, race, class. */
  abilValues: number[] = [0, 0, 0, 0, 0, 0];
  /** 0x23b4: an `abil` reply not asked for (the player's own) is being read. */
  abilUnasked = 0;
  /** 0x23b8: its ability. */
  abilUnaskedNo = 0;
  /** 0x23c0: when an `abil` was last asked (seconds). */
  abilAskedAt = 0;
  /** 0x23c8: since when a reply has been awaited (seconds; 0 none). */
  abilWaitSince = 0;
  /**
   * 0x23d0: why the monitors were not checked (`{am-b}`): 1 a reply awaited,
   * 2 one not asked for being read, 3 one being read, 4 just read, 5 asked
   * this second, 6 they cannot be.
   */
  monitorBlocked = 0;
  /** 0x23d4: resting, as the timer last saw. */
  monitorSawRest = 0;
  /** 0x23f0: meditating, as the timer last saw. */
  monitorSawMeditate = 0;
  /** 0x2408: the `abil` being sent is not counted as a repeat. */
  abilSending = 0;
  /** 0x240c: a monitor's command is being queued (1, or 2 urgent). */
  monitorQueuing = 0;
  /**
   * 0x2410…0x243c: the last reply read, reused by a chained monitor of the
   * same ability within two seconds (valid until anything is sent).
   */
  lastAbil = { valid: 0, ability: 0, monitor: -1, parts: 0, at: 0, values: [0, 0, 0, 0, 0, 0] };

  /** 0x23d8 (on), 0x23e0 (since, seconds), 0x23e8 (checked, ms): the monitors watching a rest. */
  restMonitor = { on: 0, since: 0, checkedAt: 0 };
  /** 0x23f4 (on), 0x23f8 (since, seconds), 0x2400 (checked, ms): the monitors watching a meditation. */
  meditateMonitor = { on: 0, since: 0, checkedAt: 0 };

  // ------------------------------------------------------------ light

  /** 0xdca4: how dark the room is (0 lit, 1 dim, 2 dark, 3 dark by the path's own mark). */
  darkness = 0;

  // ------------------------------------------------------------ vitals

  /** 0xd894 */
  hp = 0;
  /** 0xd8a0 */
  mana = 0;
  /** 0xd8a4: mana at the previous reading. */
  manaPrev = 0;
  /** 0xd898: HP at the previous reading. */
  hpPrev = 0;
  /** 0xd828: when the last mana tick was measured. */
  lastTickAt = 0;
  /** 0xd834: the last mana tick; -999 until one is measured. */
  lastTick = -999;
  /** 0xd838: the next reading only re-baselines (a cast spent mana). */
  skipTick = 0;
  /** 0xe210: the flux monitor asks for the mana regen again. */
  fluxRecast = 0;

  /** 0xd8ac: the armour class, from `stat`. */
  armourClass = 0;
  /** 0xd8b0: the damage resistance beside it. */
  damageResist = 0;
  /** 0xd870: experience (64-bit). */
  exp = 0;
  /** 0xd878: experience still needed for the next level, or -1 when not known. */
  expToLevel = -1;
  /**
   * 0x30e00: the rate the end of a lap tests against `Comms.MinExpRate`
   * (`0x409577`). Only the defaults write it (-1, `0x448712`), so MegaMUD's
   * lap never hangs up on it; at 0 it hung up on every lap (2026-10-16).
   */
  lapExpRate = -1;
  /**
   * 0x327a4: 99, as every write leaves it (`0x448692`, `0x449ac9` and three
   * more), under which a `~` in a macro is sent as itself rather than as
   * `\x01` (2026-10-16).
   */
  tildeMode = 99;

  // ------------------------------------------------------------ activity

  /** 0xdb28: the activity state (`states.ts`). */
  state = 0;
  /** 0xdb2c: the state before the last change. */
  stateBefore = 0;
  /** 0xa440: the state the scheduler is waiting to see finish. */
  stateAwaited = 0;
  /** 0x32488: when the state last changed. */
  stateSince = 0;
  /** 0xdb24: what MegaMUD is doing at the top level (`Task` in `script/task.ts`, set by `0x4aac80`). */
  task = 0;
  /** 0xdb14: the line handler being run (`0x479b20`'s parse step), for the trace. */
  parseStep = 0;
  /** 0x31824: the last `{P…}` traced. */
  lastPromptTrace = '';

  /** 0xe164: in the game: set by the first prompt after the connection reached it (`0x47b070`). */
  inGame = 0;
  /** 0xe168: automation on (the caption's ACTIVE rather than MANUAL). */
  active = 0;
  /** 0xe15c: the connection has reached the game (`0x42de00` with 1); cleared on leaving it. */
  online = 0;
  /** 0xd904: what the reader has seen of the realm's output (`LineFlag`). */
  lineFlags = 0;
  /** 0xd908: lines still awaited before acting. */
  waitLines = 0;
  /** 0xd90c: prompts still awaited before acting. */
  waitPrompt = 0;
  /**
   * Ours: the commands sent whose echo has not come back, oldest first, with
   * when each went (`tickMs`). Lines before a command's echo are not its
   * answer (`echoAwaited`).
   */
  echoes: { text: string; at: number }[] = [];

  /** 0x30e0c: MegaMUD's debug trace (`{D%d}`, `{P%d}`, …) is on. */
  debug = 0;
  /**
   * 0x105aa/0x205ab: the line being received and, beside it, the attribute
   * each character was drawn in. Handlers may cut it (the status line takes
   * its prompt off the front), so it is passed by reference.
   */
  line: LineBuf = { text: '', attr: [] };
  /** The status last handed to the host. */
  statusShown = '';

  // ------------------------------------------------------------ sending

  /** 0xddf4: the last command typed (or sent from the pending list), 256 characters. */
  lastTyped = '';
  /** 0xdef8: when it was typed (`GetTickCount64`). */
  typedAt = 0;
  /** 0x7cf7: the command that relogs (BBS.INI `RelogCmd`). */
  relogCmd = ';relog';
  /** 0x7ce2: the command that logs off the BBS after leaving the game (BBS.INI `LogoffCmd`). */
  logoffCmd = '';
  /** 0x7d0c: the command that turns ANSI on (BBS.INI `AnsiCmd`). */
  ansiCmd = '=a';
  /** 0x7d26: what is typed before a broadcast (BBS.INI `BroadcastPrefix`). */
  broadcastPrefix = "'";
  /** 0x7e68: the longest line the BBS takes (BBS.INI `MaxInputSize`). */
  maxInput = 0x7f;
  /** 0x7e6c: the levels either side a player can be attacked at (BBS.INI `PvpLevel`). */
  pvpLevel = 99;
  /** 0x7e70: the hours a day the BBS allows (BBS.INI `MaxHrsPerDay`). */
  maxHours = 0x18;
  /**
   * 0x7d2b, 0x7d54 (BBS.INI `LogonMsg`, `LogoffMsg`), 0x7da6
   * (`BroadcastMsg`), 0x7dcf, 0x7df8, 0x7e21 (`Global1Msg`…`Global3Msg`,
   * with `Global1Two`… at 0x7e4c–0x7e54: a message follows on the next
   * line): the BBS's own talk lines, at their defaults (`0x41bcf0`).
   */
  bbsTalk: { chat: string[]; broadcast: string; notices: { text: string; more: number }[] } = {
    chat: ['logs ON', 'logs OFF'],
    broadcast: 'Broadcast',
    notices: [
      { text: '--Unused--', more: 0 },
      { text: '--Unused--', more: 0 },
      { text: '--Unused--', more: 0 }
    ]
  };
  /** 0xdf17: the player talk is diverted to (`@divert`), 11 characters. */
  divertTo = '';
  /** 0xdf22: the player `@debug` was asked by, 11 characters. */
  debugTo = '';
  /** 0x8e5a: the AFK reply sent last, 500 characters. */
  afkReplied = '';
  /** Ours: the player's own commands others may ask for (`BotCommand`, `talk/remote.ts`). */
  botCommands: readonly BotCommand[] = [];
  /**
   * 0xdfa0/0xe130: the `@where` replies waiting on the `rm` (`Talk.WhereUseRm`),
   * up to four, each its reply prefix (100 characters).
   */
  whereAsked: string[] = [];
  /** 0xdf98: when the `rm` for them was sent (`GetTickCount64`). */
  whereAskedAt = 0;
  /** 0x80fb: the destination's name, 51 characters. */
  destination = '';
  /** 0x7cb9: the game menu's own prompt (BBS.INI `MenuPrompt`). */
  menuPrompt = '[MAJORMUD]:';
  /** 0x7d7d: the BBS's warning that it is shutting down (BBS.INI `ShutDownMsg`). */
  shutdownMsg = 'Please finish up and log off';
  /** 0xdb94: the last command sent, 256 characters. */
  lastSent = '';
  /** 0xdb90: how many times running it has been sent. */
  sameSent = 0;
  /** The settings the character was loaded with, its config profiles among them (`@profile`). */
  settings: MegaSettings | null = null;
  /** The pending list (`0x5c6d40`…, count `0x2374`). */
  pending: Pending[] = [];
  /** 0x59cb80: the pending command just sent should not set the Pending Cmd state. */
  pendingQuiet = 0;
  /** 0x59cb84: a spell from the pending list waiting for its round (`0x48b370`), 7 characters. */
  waitingSpell = '';
  /** 0x59cb90: what it was to be cast at, 199 characters. */
  waitingSpellTarget = '';
  /** 0x59cb78: when it first had to wait. */
  waitingSpellAt = 0;
  /** 0x14c: the last `@wait`/`@comeback` telepath sent. */
  lastWaitSent = '';
  /** 0x278: the last `@ok` telepath sent. */
  lastResumeSent = '';
  /** 0x7d21: what is said before `@kill`, `@party`, `@panic!` (BBS.INI `SpeechPrefix`). */
  speechPrefix = '.';

  // ------------------------------------------------------------ fight

  /** 0xe1d4: combat is engaged (`*Combat Engaged*` until `*Combat Off*`). */
  inCombat = 0;
  /** 0xa588: the spell last sent by command (its short name), 0x51 characters. */
  lastCast = '';
  /** 0xa584: the blessing slot (0–9) being cast, or -1. */
  blessSlot = -1;
  /** 0x323a8: when each blessing slot was last cast (14 slots). */
  blessCastAt: number[] = Array.from({ length: 14 }, () => 0);
  /** 0x32418: when each blessing slot was last seen to take. */
  blessSeenAt: number[] = Array.from({ length: 14 }, () => 0);
  /** 0xe22c: the HP-full spell has been cast since HP last fell below `HpFull%`. */
  hpFullCast = 0;
  /** 0xe230: the mana-full spell has been cast since mana last fell below `ManaFull%`. */
  manaFullCast = 0;
  /** 0xa444: the attack the fight is engaged in (0x11 attack, 0x12 backstab, 9–15 the casts). */
  engagedMode = 0;
  /** 0xdd14: the target a weapon's no-effect was counted against. */
  noEffectTarget = '';
  /** 0xdca8: the monster being fought, 100 characters. */
  target = '';
  /** 0xdd88: the monster fought last, 100 characters. */
  lastTarget = '';
  /** 0xa468: the short name of the spell being cast in the fight, 0x51 characters. */
  castShort = '';
  /** 0xa4b9: that spell's name, 0x51 characters. */
  castName = '';
  /** 0xaf9d: the alt-attack spell, 11 characters. */
  altSpell = '';
  /** 0xafa8: the user-attack spell, 11 characters. */
  userSpell = '';
  /** 0xa528: the target the fight's cast counts belong to; a new one starts them again. */
  countedTarget = '';
  /** 0x71d0: the Messages.md row that matched last (its name), 31 characters. */
  msgSpell = '';
  /** 0x71ef: its `{source}`, 81 characters. */
  msgSource = '';
  /** 0x7240: its `{target}`, 81 characters. */
  msgTarget = '';
  /** 0x7294: its `{dmg}`. */
  msgDamage = 0;
  /** 0x7298…: its `{1}` to `{5}`, 81 characters each; kept until a row sets them again. */
  msgArgs: string[] = ['', '', '', '', ''];
  /** 0xdb84: how many active rows are being rested off (number 2). */
  restUntilOff = 0;
  /** 0x742d: the last message row rested off, 31 characters. */
  lastRestRow = '';
  /** 0xb060: the weapon wielded, 31 characters. */
  weaponWielded = '';
  /** 0x59c2ec: the stash run-away warning was shown. */
  warnedStashRun = false;
  /** 0xe2fc: why it is resting, 100 characters. */
  restReason = '';

  /** 0xa320: auto-combat to restore after a detour (-1 none). */
  detourCombat = -1;
  /** 0xa324: auto-combat to restore when going idle (`NoModeDefs` 1). */
  idleCombat = 0;
  /** 0xe16c: which mode's defaults were applied last (0 idle, 1 active; -1 none yet). */
  modeApplied = -1;
  /** 0xa3d4: the "too few monsters to nuke" warning is still to be shown this session. */
  warnFewMonsters = 1;
  /** 0xdf2d: the reply a `room` (MUD op) is asked for, 100 characters; sent with what it finds. */
  roomReply = '';
  /** 0x59c71c: the specific monster is alive (a global in MegaMUD). */
  spawnAlive = 0;
  /** 0x59c5f0: the specific monster's name. */
  spawnMonster = '';
  /** 0x59c6b8: what is known of its respawn ("Regens in …", "Should be alive!", "Alive now!"). */
  spawnText = '';
  /** 0xdb38: the exit to leave by, as a direction (-1 none). */
  runDirection = -1;

  // ------------------------------------------------------------ inventory

  /** 0x8420/0x8424: what is carried, in the inventory listing's order. */
  inventory: Carried[] = [];
  /**
   * 0x8174 (rooms), 0x819c (paths, 14 characters), 0x8228 (why, 50
   * characters): the detours queued (to a shop "for" an item, and back), the
   * first under way.
   */
  detours: { room: number; path: string; why: string }[] = Array.from({ length: 10 }, () => ({
    room: 0,
    path: '',
    why: ''
  }));
  /** 0x8474: an item being picked up, until the inventory lists it, 31 characters. */
  itemPickingUp = '';
  /** 0x8460: the cash limit's no-bank warning has been shown (`0x406f20`). */
  noBankWarned = 0;

  // ------------------------------------------------------------ paths

  /**
   * 0xe39c: the path walked: 0xe3a0 its title, 0xe3a4 its author, 0xe3a8 its name, 0xe3d5 the
   * retry path, 0xe3e3 the next, 0xe3f4 its start, 0xe3f8 its end, 0xe408
   * its count, 0xe40c the step reached, 0xe410 that step's record, 0xe414
   * the one before, 0xe418 and 0xe41c the steps.
   */
  path: PathRec = settingsPath(this, 'MegaMud_CurPath', 'MegaMud_CurPathStep');
  /** 0xe4a4: the loop, walked again from its start (0xe4fc, 0xe500 its start and end). */
  loopPath: PathRec = settingsPath(this, 'MegaMud_SelPath', null);
  /** 0x7f18/0x7f20: the paths known, by file and title (`0x482bd0`). */
  paths: PathRec[] = [];
  /** 0xe184: walking a path (the Go/Stop button, `0x803`). */
  walking = 0;
  /** 0xe188: looping: the path walked is the loop. */
  looping = 0;
  /** 0xe18c: roaming by allowed exits (the Roam button, `0x808`). */
  roaming = 0;
  /** 0xe190: lost: on no path, roaming until a known room or a path's room. */
  lost = 0;
  /** 0xe178: walking an imported path's commands (`0x4451e0`). */
  importing = 0;
  /** 0x7f24: the imported text's format (1–5; 3 skips past a `:`, 4 is one per line, 5 cuts at `~`). */
  importFormat = 0;
  /** 0x7f28: the imported text. */
  importText = '';
  /** 0x7f2c: where the next imported command starts. */
  importAt = 0;
  /** 0x7f30: where the last one started (a refused move goes back to it). */
  importFrom = 0;
  /** 0xdb30: the direction of the move under way (-1 none). */
  moveDir = 0;
  /** 0xdb40: the steps to go (-1 not known). */
  stepsToGo = 0;
  /** 0xdb70: tries at the step reached while its room is not the one here. */
  stepTries = 0;
  /** 0xa5d9: the item being equipped, 31 characters. */
  equipping = '';

  // ------------------------------------------------------------ party

  /** 0x8b28: the party leader's name. */
  leaderName = '';
  /** 0x8918: the party, six records of 0x58 bytes. */
  party: PartyMember[] = Array.from({ length: 6 }, () => newMember());

  // ------------------------------------------------------------ room

  /** 0x24f8/0x24ec: the room's contents, in listing order. */
  room: RoomEntity[] = [];
  /** 0x24f4: the selected entry, or -1. */
  roomSelected = -1;
  /** 0x805c: the room's name, as the exits line confirmed it. */
  roomName = '';
  /** 0x8091: the last room name seen (a bright yellow line), 52 characters. */
  roomNameSeen = '';
  /** 0x8134: that name's hash, in the top twelve bits. */
  roomNameHash = 0;
  /** 0x8130: the room's signature: the name's hash and two bits an exit (`0x4386d0`); `ARENA` the arena. */
  roomSignature = 0;
  /** 0x8164: the room's record in Rooms.md, when it has one. */
  roomRecord: RoomRec | null = null;
  /** 0xd910: what is left of a listing that runs onto the next line, 0x200 characters. */
  listingRest = '';
  /** 0x813c: the room's exits, ten words in `0x4c03b0`'s order (north … down). */
  roomExits: number[] = Array.from({ length: 10 }, () => 0);
  /** 0x2500: a player-shaped name already looked at again, 31 characters. */
  unknownNameAsked = '';
  /** 0x2524: marks remembered for monsters by name (up to 500). */
  monsterMarks: { name: string; flags: number }[] = [];
  /** 0x6b78: marks remembered for players by name (up to 100). */
  playerMarks: { name: string; flags: number }[] = [];
  /** 0x71c0/0x71b8: the players online, from the last `who` and the arrivals since. */
  whoList: WhoEntry[] = [];
  /** 0x7e74: what the realm calls its runic coin. */
  runicName = 'runic coin';

  // ------------------------------------------------------------ conditions

  /** 0xe1ec */
  blind = 0;
  /** 0xe1f0 */
  confused = 0;
  /** 0xe1f4 */
  poisoned = 0;
  /** 0xe1f8: `You are too sick to rest`: poisoned, so resting waits for the cure. */
  tooSickToRest = 0;
  /** 0xe200 */
  diseased = 0;
  /** 0xe204 */
  losingHp = 0;
  /** 0xe208 */
  hpRegen = 0;
  /** 0xe20c */
  manaRegen = 0;
  /** 0xe214: can't move. */
  held = 0;
  /**
   * Ours: diseased by our tracker's reading of the realm (`MegaEngine.afflictions`),
   * which only the cures read. MegaMUD's own `diseased` also rests (`0x40`).
   */
  diseaseHeard = 0;
  /** 0xe1a4: resting (`rest` sent, or the prompt's rest mark). */
  resting = 0;
  /** 0xe1a8 */
  meditating = 0;
  /** 0xe224: resting HP to full: HP fell below `HpRest%` and are not yet back to `HpFull%`. */
  restHpToFull = 0;
  /** 0xe228: resting mana to full, the same with `ManaRest%` and `ManaFull%`. */
  restManaToFull = 0;
  /** 0xe234: the HP when they last reached full (`HpFull%`); falling below it ends the latch. */
  hpFullAt = 0;
  /** 0xe238: the mana when it last reached full. */
  manaFullAt = 0;
  /** 0xe2b0: must rest (can't move, while following). */
  mustRest = 0;
  /** 0xe2f8: holding the party leader (`@wait` sent). */
  holdingLeader = 0;
  /** 0xe1ac: a post-rest command is owed. */
  owedPostRest = 0;
  /** 0xe1b0: a post-meditate command is owed. */
  owedPostMeditate = 0;
  /** 0xe1b4: a post-backstab command is owed. */
  owedPostBackstab = 0;
  /** 0xe1c4: sneaking (`sn` sent, not yet broken). */
  sneaking = 0;
  /** 0xe1cc: hidden. */
  hidden = 0;
  /** 0xe2f0: holding for the party. */
  partyWait = 0;
  /** 0xdf0c: the player being chased, 10 characters. */
  chaseTarget = '';
  /** 0x8894: rooms still to run while rescuing. */
  rescueCount = 0;
  /** 0xe2e8: following somebody. */
  following = 0;
  /** 0xdb7c: rooms still to run. */
  runCount = 0;
  /** 0x8914: party size. */
  partySize = 0;

  /** `_time64` now, stamped onto the struct (`0x4653d0` and others). */
  stamp(): number {
    this.now = this.host.clock();
    return this.now;
  }
}
