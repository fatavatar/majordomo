/**
 * The state megamud.exe keeps per connection: one struct its code reaches
 * through a register and tests field by field. Each field here is one of the
 * struct's, named for what it was read to mean, its offset in the comment.
 * A field whose meaning has not been read yet keeps the decompile's name,
 * `f_<offset>`, so a line of the decompile ports without a guess
 * (docs/megamud/engine-port.md). Settings are inherited from
 * `SettingsFields`, named as the decompiled struct names them.
 *
 * Times: `now` is the struct's clock (`0x32290`), `_time64` seconds, stamped
 * by the once-a-second timer and a few other places; every timing test reads
 * the stamp, never a live clock. `tick()` is `GetTickCount64`.
 */
import type { ItemRec, MegaData, MonsterRec, PlayerRec, RoomRec } from './data';
import { RawFields } from './RawFields';
import type { Pending } from './script/send';

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
  /** +0x3c: 1 kept, 4 not yet seen in this listing, 8 charmed, 0x10. */
  flags: number;
  /** +0x40. */
  f40: number;
  /** +0x44. */
  f44: number;
}

/** One party member (`0x8918 + i * 0x58`). */
export interface PartyMember {
  /** +0x00 */
  name: string;
  /** +0x28 */
  flags28: number;
  /** +0x38: what it is attacking, 30 characters (`Party.AttackLate`; `0x42bef0` clears it). */
  target: string;
}

export function newMember(): PartyMember {
  return { name: '', flags28: 0, target: '' };
}

export function newEntity(): RoomEntity {
  return {
    type: 0,
    kind: 0,
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
  /** The socket write under `0x42d9f0`. */
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
  /** A move arrived while walking a path (`0x45fa60`'s place): our walker takes it from here. */
  arrived?(step: number): void;
}

export class Session extends RawFields {
  constructor(
    readonly host: SessionHost,
    public data: MegaData
  ) {
    super();
  }

  // ------------------------------------------------------------ clock

  /** 0x32290: the clock stamp, seconds. */
  now = 0;

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
  /** 0xd904: line flags; bit 0, a prompt has been seen since the last command. */
  lineFlags = 0;
  /** 0xd908: lines still awaited before acting. */
  waitLines = 0;
  /** 0xd90c: prompts still awaited before acting. */
  waitPrompt = 0;

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
  /** 0x7cf7: the command that relogs. */
  s_7cf7 = '';
  /** 0xdb94: the last command sent, 256 characters. */
  lastSent = '';
  /** 0xdb90: how many times running it has been sent. */
  sameSent = 0;
  /** The pending list (`0x5c6d40`…, count `0x2374`). */
  pending: Pending[] = [];
  /** 0x59cb80: the pending command just sent should not set the Pending Cmd state. */
  pendingQuiet = 0;
  /** 0x14c: the last `@wait`/`@comeback` telepath sent. */
  lastWaitSent = '';
  /** 0x278: the last `@ok` telepath sent. */
  lastResumeSent = '';
  /** 0x7d21: what is said before `@kill`, `@party`, `@panic!`. */
  s_7d21 = '';

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
  /** 0xdd14 */
  s_dd14 = '';
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
  /** 0xa528 */
  s_a528 = '';
  /** 0xe2fc: why it is resting, 100 characters. */
  restReason = '';

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
  /** 0x8130: the room's signature: the name's hash and two bits an exit (`0x4386d0`). */
  f_8130 = 0;
  /** 0x8164: the room's record in Rooms.md, when it has one. */
  roomRecord: RoomRec | null = null;
  /** 0xd910: what is left of a listing that runs onto the next line, 0x200 characters. */
  s_d910 = '';
  /** 0x813c: the room's exits, ten words in `0x4c03b0`'s order (north … down). */
  roomExits: number[] = Array.from({ length: 10 }, () => 0);
  /** 0x2500: an unknown player-shaped name already asked about, 31 characters. */
  s_2500 = '';
  /** 0x2524: marks remembered for monsters by name (up to 500). */
  monsterMarks: { name: string; flags: number }[] = [];
  /** 0x6b78: marks remembered for players by name (up to 100). */
  playerMarks: { name: string; flags: number }[] = [];
  /** 0x71c0/0x71b8: the players online, from the last `who` (their names, at `+0x10`). */
  whoList: string[] = [];
  /** 0x7e74: what the realm calls its runic coin. */
  runicName = 'runic coin';

  // ------------------------------------------------------------ conditions

  /** 0xe1ec */
  blind = 0;
  /** 0xe1f0 */
  confused = 0;
  /** 0xe1f4 */
  poisoned = 0;
  /** 0xe1f8 */
  f_e1f8 = 0;
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
  /** 0xe1a8 */
  meditating = 0;
  /** 0xe1ac: a post-rest command is owed. */
  owedPostRest = 0;
  /** 0xe1b0: a post-meditate command is owed. */
  owedPostMeditate = 0;
  /** 0xe1b4: a post-backstab command is owed. */
  owedPostBackstab = 0;
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
