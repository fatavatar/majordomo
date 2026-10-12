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
import type { MegaData, MonsterRec } from './data';
import { RawFields } from './RawFields';

/** One entry in the room's contents (`0x471190`, 0x48 bytes). */
export interface RoomEntity {
  /** +0x00: 0 player, 2 monster, 3 item (as `0x471a10` sorts them). */
  type: number;
  /** +0x04: what it is to us: 2 charmed/white, 3 cyan, 4–6 hostile. */
  kind: number;
  /** +0x08. */
  f08: number;
  /** +0x0c. */
  f0c: number;
  /** +0x10, 30 characters. */
  name: string;
  /** +0x30. */
  f30: number;
  /** +0x34: its monster record, when it is a known monster. */
  mon: MonsterRec | null;
  /** +0x38. */
  f38: number;
  /** +0x3c: 1 kept, 4 not yet seen in this listing, 8 charmed, 0x10. */
  flags: number;
  /** +0x40. */
  f40: number;
  /** +0x44. */
  f44: number;
}

export function newEntity(): RoomEntity {
  return {
    type: 0,
    kind: 0,
    f08: 0,
    f0c: 0,
    name: '',
    f30: 0,
    mon: null,
    f38: 0,
    flags: 0,
    f40: 0,
    f44: 0
  };
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

  // ------------------------------------------------------------ activity

  /** 0xdb28: the activity state (`states.ts`). */
  state = 0;
  /** 0xdb2c: the state before the last change. */
  stateBefore = 0;
  /** 0xa440: the state the scheduler is waiting to see finish. */
  stateAwaited = 0;
  /** 0x32488: when the state last changed. */
  stateSince = 0;
  /** 0xdb24 */
  f_db24 = 0;

  /** 0xe164: automation on. */
  scripting = 0;
  /** 0xd904: line flags; bit 0, a prompt has been seen since the last command. */
  lineFlags = 0;
  /** 0xd908: lines still awaited before acting. */
  waitLines = 0;
  /** 0xd90c: prompts still awaited before acting. */
  waitPrompt = 0;

  /** 0x30e0c: MegaMUD's debug trace (`{D%d}`, `{P%d}`, …) is on. */
  debug = 0;
  /** 0x105aa: the line being received, without its colours. */
  lineText = '';
  /** 0x205ab: the attribute each character of `lineText` was drawn in. */
  lineAttr: number[] = [];
  /** The status last handed to the host. */
  statusShown = '';

  // ------------------------------------------------------------ room

  /** 0x24f8/0x24ec: the room's contents, in listing order. */
  room: RoomEntity[] = [];
  /** 0x24f4: the selected entry, or -1. */
  roomSelected = -1;

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
