/**
 * Owns one live game session: the transport, its observable state, and a
 * bounded diagnostic log. Everything it publishes goes through a sink supplied
 * by the caller, so it has no direct dependency on Electron's IPC.
 */
import { CommandQueue, type Intent } from '../automation/CommandQueue';
import { IDLE_WALK, type WalkProgress } from '../../shared/walk';
import { playerKey } from '../../shared/players';
import { splitOntoChannel } from '../../shared/talk';
import { macroLength, parseMacro } from '../../shared/macro';
import {
  capabilitiesOf,
  HAZARD_ABILITY,
  poisonRefusesRest,
  type Capabilities
} from '../../shared/abilities';
import { trainingCost } from '../../shared/training';
import { carriedCount } from '../../shared/supplies';
import type { TrainerChoice } from '../../shared/world';
import { MASKED_COMMAND } from '../../shared/automation';
import type { AutomationSnapshot, SafetyDecision, SentCommand } from '../../shared/automation';
import { LoginAutomator, type StandDown } from '../automation/LoginAutomator';
import type { MessageTrigger } from '../../shared/messageTriggers';
import { mergeItemRules, type ItemRule } from '../../shared/itemRules';
import { withRealmMonsters, type MonsterRule } from '../../shared/monsterRules';
import { AutoKeys, type KeyedWay } from '../automation/AutoKeys';
import { StatsReporter, type KeepKey } from '../stats/StatsReporter';
import { statsSnapshot } from '../stats/snapshot';
import { version as APP_VERSION } from '../../../package.json';
import type { MegaChoices } from '../../shared/ipc';
import type { RemoteName } from '../../shared/remotes';
import { NO_LOOP, type LoopProgress } from '../../shared/loops';
import {
  movementOf,
  type Movement,
  type MovementStart,
  type WalkStart
} from '../../shared/movement';
import { AutoHunt } from '../automation/AutoHunt';
import { ItemErrand, type ItemSources } from '../automation/ItemErrand';
import { QuestRunner } from '../automation/QuestRunner';
import { AFTER_WORD } from '../automation/PackAfter';
import { bareName } from '../../shared/items';
import { chargedInCopper, coinReader, type CoinNames } from '../../shared/coins';
import { Wards } from '../automation/Wards';
import type { Loop } from '../../shared/loops';
import { splitStop } from '../../shared/loops';
import {
  hazardAvoided,
  nameAnswersTo,
  parseLair,
  roomAddress,
  roomId,
  type WorldRoom,
  type RoomId,
  type Route
} from '../../shared/world';
import { actionsFor } from './actions';
import { CharacterTracker } from '../parse/CharacterTracker';
import { Classifier } from '../parse/Classifier';
import { LineTokenizer, plainText, stripAnsi } from '../net/LineTokenizer';
import { DialCancelled, TelnetClient } from '../net/TelnetClient';
import { LinkWatch } from './LinkWatch';
import { isPrompt, type Block } from '../../shared/blocks';
import {
  bankKey,
  ownAlignment,
  packRows,
  type AbilitySums,
  type CharacterState,
  type RealmFamily as RealmWord,
  type SessionPhase
} from '../../shared/character';
import type { RouteOptions, Traveller, WorldGraph } from '../world/WorldGraph';
import { planRoute } from '../world/RoutePlanner';
import type { Wearer } from '../../shared/gear';
import { preferredEdges } from '../world/loopDraft';

/** No preferred corridors: one value, so a session with none re-renders nothing. */
const NO_EDGES: ReadonlySet<string> = new Set();
/** The item errand's phrase and the listing asked after it, so both can be taken back. */
const COLLECT_SAY_KEY = 'collect:say';
const COLLECT_AFTER_KEY = 'collect:after';
import { NO_LORE, type MobLore } from '../../shared/lore';
import { NO_SPELL_LORE, type SpellLore } from '../../shared/spell-messages';
import { NO_SHIPPED_SENTENCES, type ShippedSentences } from '../../shared/sentences';
import { NO_REALM_PLAYERS, type RealmPlayers } from '../../shared/players';
import { NO_BELONGINGS, type BelongingsSink } from '../../shared/belongings';
import { NO_FIGHTS, type FightSink } from '../../shared/fights';
import { describeDiscovery, discoveryKey, type Discovery } from '../../shared/memory';
import { findKey, type Find, type Sighting } from '../../shared/finds';
import {
  asksHere,
  countersNow,
  countersRefuse,
  planSpan,
  questReading,
  rollChance,
  stepKilled,
  stepSaid,
  type PlanCash,
  type PlanItem,
  type PlanStep,
  type Quest,
  type QuestErrand,
  type QuestPlan,
  type QuestRunProgress,
  type QuestSeen,
  type QuestStep,
  type QuestWatched,
  type RoomAsk
} from '../../shared/quests';
import {
  identityOf,
  resetSignals,
  type CharacterIdentity,
  type ResetSignal
} from '../../shared/reset';
import { DEFAULT_INTERNAL, type InternalConfig } from '../../shared/internal';
import {
  familiesDisagree,
  familyToldBy,
  REALM_FAMILY_LABEL,
  type RealmFamilies,
  type RealmFamily
} from '../../shared/realm';
import { SHIPPED_WORLD_LABEL, worldOfRealm } from '../../shared/worlds';
import {
  ATTACK_COMMANDS,
  commandOf,
  GREATERMUD_ONLY,
  opensStatScreen,
  type CommandName
} from '../../shared/commands';
import { STATUS_LINE } from '../parse/patterns';
import {
  figuresOf,
  isFullStatline,
  statlineMatcher,
  STATLINE_MAX_CELLS,
  withReading
} from '../../shared/statline';
import { toAnsi } from '../../shared/template';
import { promptOpened, TerminalFeed } from './TerminalFeed';
import { Rewriter } from './Rewriter';
import {
  DEFAULT_CONFIG,
  type AutomationConfig,
  type CombatConfig,
  type LocateMethod,
  type LoginConfig,
  type StatsReportConfig,
  type StatsTarget,
  type SupplyItem,
  type RewritesUiConfig
} from '../../shared/config';
import { errorMessage } from '../../shared/values';
import { sameTarget } from '../../shared/types';
import { t } from '../app/i18n';
import type {
  ConnectionEnd,
  ConnectionPhase,
  ConnectionState,
  ConnectionTarget,
  StreamChunk,
  StreamLine,
  TelnetEvent,
  TerminalMark,
  TerminalSize
} from '../../shared/types';
import { tuning } from '../app/tuning';
import {
  appraiseRoom,
  EMPTY_ROOM_VERDICT,
  lairPass,
  type LairPass,
  passShare,
  prowessSheetOf,
  roomVerdictKey,
  weighVerdicts,
  wieldedWeapon,
  type RoomVerdict,
  type Verdict
} from '../../shared/verdict';
import { statedNow } from '../../shared/stated';
import { LairCosts } from '../world/LairCosts';
import { inTheFight } from '../../shared/guards';
import { attacksOnSight } from '../../shared/mobs';
import {
  dodge,
  regeneration,
  swing,
  type ProwessSheet,
  type ProwessWeapon
} from '../../shared/prowess';
import {
  castsToKill,
  chooseAttackSpell,
  healPower,
  type SpellChoiceInput
} from '../../shared/spellchoice';
import {
  addFiller,
  compareSpots,
  estimateSpot,
  moveDelayMs,
  orderRing,
  respawnSeconds,
  sizeLoop,
  type FillerInput,
  type HealingCast,
  type HuntingAdvice,
  type HuntingAssumptions,
  type HuntingConstants,
  type HuntingRoom,
  type HuntingSpot,
  type SpotCharacter,
  type SpotEstimate,
  type SpotInput,
  type SpotMob
} from '../../shared/hunting';
import {
  afflictionsOf,
  protectionOf,
  ROUND_SECONDS,
  scaledPower,
  weighRoom,
  type MenacePlayer
} from '../../shared/menace';
import { resolveSpell, spellCost, spellServes } from '../../shared/spellcraft';
import {
  simulateFight,
  SURVIVAL_HORIZONS,
  type Survival,
  type SurvivalFoe,
  type SurvivalHeal
} from '../../shared/survival';
import type { MegaToggle } from '../../shared/megamud/toggles';
import {
  MegaEngine,
  type AfterFetch,
  type FleeGoto,
  type MegaAlert,
  type MegaEngineSetup
} from './MegaEngine';
import type { ResumableMovement } from './MovementBook';
import { WindowCommand } from '../../shared/megamud/toggles';

/**
 * The part of a chunk of keystrokes the server's line editor would keep.
 *
 * `send`'s shadow buffer exists to answer one question — *does the player have
 * a half-typed line on the wire* — and automation stands down entirely while
 * the answer is yes. So the buffer has to hold what the **server** holds, and
 * a control byte is not text: a terminal sends `\x1b` for Escape, `\x1b[A` for
 * an arrow key and `\t` for Tab, and none of them leaves a character in the
 * server's line.
 *
 * Measured, in the capture that produced this function
 * (`logs/2026-08-30_20-57-36_main.mudcap.jsonl`, t=66056): twenty Escapes and
 * an Enter were answered with a bare room reprint — which is exactly what an
 * *empty* line is answered with. The server had kept none of them. This client
 * had kept all twenty, so `outbound` never emptied, `noteTyping(true)` stood
 * automation down, and the attack decided the millisecond a hostile walked
 * into the room (t=43603) sat in the queue for **twenty-two seconds** while
 * the monster hit the character sixteen times. Nothing on screen said why: the
 * hold is invisible, and the only thing that released it was the player
 * pressing Enter.
 *
 * The terminator is kept, because the commit loop is what reads it, and so is
 * the erase pair, which is modelled rather than dropped.
 */
export function editorInput(data: string): string {
  let kept = '';
  for (let i = 0; i < data.length; i += 1) {
    const ch = data[i]!;
    if (ch === '\x1b') {
      // The whole sequence, dropped as one. Dropping only the introducer
      // would leave `[A` behind, which is the same bug wearing the arrow
      // key's hat.
      i = endOfEscape(data, i);
      continue;
    }
    // The terminator and the two erases are modelled by the caller.
    if (ch === '\r' || ch === '\n' || ch === '\b' || ch === '\x7f') kept += ch;
    // Every other C0 control — Tab, a Ctrl chord, a stray NUL — leaves no
    // text behind for anything to be glued onto.
    else if (ch >= ' ') kept += ch;
  }
  return kept;
}

/**
 * The index of the last byte of the escape sequence beginning at `start`.
 *
 * CSI (`ESC [`) and SS3 (`ESC O`) run to a final byte in `@`–`~`, which is how
 * every arrow, function and editing key this client's own terminal emits is
 * shaped. Anything else after ESC is a two-byte sequence. A sequence the chunk
 * ends inside is consumed whole: the shadow buffer must never be left holding
 * half of something the server is not holding at all.
 */
function endOfEscape(data: string, start: number): number {
  const next = data[start + 1];
  if (next === undefined) return data.length;
  if (next !== '[' && next !== 'O') return start + 1;
  for (let i = start + 2; i < data.length; i += 1) {
    const ch = data[i]!;
    if (ch >= '@' && ch <= '~') return i;
  }
  return data.length;
}

/**
 * Silence after which a partial line is released as one.
 *
 * A prompt is a line that ends because the server stopped talking: MajorMUD's
 * `Please enter your username or "new":` and its in-game status line both
 * arrive with no terminator at all, and the server then waits. Without an idle
 * flush the single most interesting line on screen — the one the player is
 * staring at — never reaches a consumer until the socket closes, which makes
 * login automation impossible.
 *
 * `megamind-client` solves the same problem by reaching into its partial-line
 * buffer and classifying it in place. A timer is the same idea with one stream
 * API instead of two, and it reports the terminator honestly as `flush`.
 *
 * The trade-off: a line genuinely fragmented across a 150 ms gap is split.
 * That is rare at TCP level within one server write, and `flush` tells a
 * consumer not to treat the boundary as authoritative.
 */
export const IDLE_FLUSH_MS = 150;

/**
 * Whether the tail ends where a prompt ends, and so is a line the server has
 * finished rather than one it is still in the middle of.
 *
 * The quiet period exists for prompts alone, and 150ms of silence only means
 * *ended* for a line that was going to end by going quiet. Over the internet
 * it does not mean that for anything else: bearfather's BBS paused 178ms
 * between `Intersection of River St. & Mystic Alle` and its `y`, and the
 * fragment framed as a whole line became a room, was learned into the
 * character's memory as a place, and stopped the walk. Every prompt this
 * client has answered ends at `:` or `?` — `Please enter your username or
 * "new":`, `(N)onstop, (Q)uit, or (C)ontinue?`, `[HP=33]:` — and every
 * sentence the wire cut ended mid-word. `STATUS_LINE` carries the realms that
 * put a state after the colon, and the echo glued onto a finished prompt.
 *
 * See `mudengine-wire` § Line framing is not CRLF for the measurement.
 */
function endsLikePrompt(plain: string): boolean {
  return /[:?]\s*$/.test(plain) || STATUS_LINE.test(plain);
}

/**
 * Somewhere to keep what a character learns about its realm.
 *
 * Narrow on purpose: the session layer decides *when* something has been
 * learned and says so, and knows nothing about where it is written down. The
 * implementation is `WorldMemory` in `src/main/world/`.
 */
/** A realm's imported tables. See `RealmTableStore`. */
export interface RealmTables {
  messages: readonly MessageTrigger[];
  monsters: readonly MonsterRule[];
  items: readonly ItemRule[];
}

/** A realm with no directory: nothing imported. */
export const NO_REALM_TABLES: RealmTables = { messages: [], monsters: [], items: [] };

/** What `configureRealm` is told: the tables, and what the realm calls its coins. */
export interface RealmData extends RealmTables {
  coins: CoinNames;
}

export interface RealmMemory {
  /** Records it, or returns null if this was already known. */
  learn(discovery: Discovery): Discovery | null;
  /** Strikes one out by its `discoveryKey`. Whether there was one to strike. */
  forget(key: string): boolean;
  readonly all: readonly Discovery[];
}

/**
 * Where what a `search` turns up in this realm is written down.
 *
 * The same seam `RealmMemory` is, for the same reason: this is the session
 * layer, it says what was found, and the file handling belongs to whoever
 * decided where the file goes. The implementation is `FindBook`.
 *
 * Realm-keyed rather than character-keyed — a room hiding a rusty key is a fact
 * about the world, like a shop's stock — so one store answers for every
 * character on a realm. It is handed over at construction beside `memory`,
 * which is the record it most resembles and which keys the same way.
 */
export interface RealmFinds {
  /** Counts one search of a room and writes down what it turned up. Returns the first sightings. */
  search(room: RoomId, found: readonly Sighting[]): Find[];
  /** Strikes one out by its `findKey`. Whether there was one to strike. */
  forget(key: string): boolean;
  readonly all: readonly Find[];
}

/** A realm nothing is written down for, which is what every test wants. */
const NO_FINDS: RealmFinds = {
  search: () => [],
  forget: () => false,
  all: []
};

export interface SessionSink {
  data(chunk: StreamChunk): void;
  /**
   * Raw payload bytes, Telnet framing removed and *not yet decoded*.
   *
   * The one record that can settle a disagreement about what the server
   * actually sent and in what order. `data` is already decoded and
   * quirk-adjusted, so an encoding fault or a reordering argued from it is
   * argued from the client's own interpretation rather than from the wire.
   */
  bytes?(payload: Buffer): void;
  /** One framed line of server output. See `LineTokenizer` for why this is not CRLF. */
  line(line: StreamLine): void;
  /** One classified line. Facts only — see docs/legacy-assessment.md §6. */
  block(block: Block): void;
  /** Character and room state, republished only when it actually changed. */
  character(state: CharacterState): void;
  state(state: ConnectionState): void;
  /**
   * The socket went and this client never asked it to.
   *
   * Separate from `state` because a `closed` phase cannot tell the two apart:
   * the player pressing Disconnect, the low-health hang-up, switching realms
   * and a dead link all arrive at that phase, and only this side knows which.
   * The alternative on offer was matching the notice's wording, and copy is
   * not a protocol.
   *
   * `why` is the reason dialling back would undo something somebody meant —
   * see `LoginAutomator.standDown` — or null when the connection was simply
   * lost.
   *
   * **Required**, unlike the other diagnostics on this sink. It is the only
   * channel auto-reconnect has, and a second implementation that forgot it
   * would be a client that silently never dials a dropped character back —
   * with no compile error to say so. The reason it was optional ("nothing in a
   * test needs it") was answered by the test file, which implements it.
   */
  dropped(why: StandDown | null): void;
  /**
   * The MegaMUD engine dials back, on its own redial rules (`Comms.Redial…`):
   * through the host, as a dial anybody asked for, so the log and capture
   * turn over per connection. Without it the manager dials itself.
   */
  redial?(target: ConnectionTarget): void;
  /** The engine's redial began or stopped waiting: see `megaRedialing`. */
  retrying?(): void;
  telnet(event: TelnetEvent): void;
  /** An engine message to surface inline in the terminal. */
  notice(message: string): void;
  /**
   * The decoded stream, whole — every byte the server sent, escape sequences
   * intact, before the feed decided what the terminal is shown. For the
   * capture and the session log, which are records of what happened rather
   * than of what was painted; `data` is what was painted.
   */
  decoded?(text: string): void;
  /**
   * Everything this character has learned about the realm, after learning
   * something new.
   *
   * The whole list rather than the one addition, for the same reason a `who`
   * listing replaces the roster: a window that missed a push would otherwise
   * hold a record with a hole in it and no way to notice.
   */
  learned?(discoveries: Discovery[]): void;
  /**
   * Everything a `search` has turned up in this realm, after one turned up
   * something. The whole list, for the reason `learned` sends the whole list.
   */
  finds?(finds: Find[]): void;
  /**
   * The character in the realm may not be the character these records are
   * about. Reported, never acted on: see `SessionManager.watchForReset`.
   */
  reset?(notice: {
    signals: ResetSignal[];
    before: CharacterIdentity;
    after: CharacterIdentity;
  }): void;
  /**
   * The rank each quest has been seen to reach from what the player typed.
   * The whole map, for the reason `learned` sends the whole record.
   */
  questSaid?(progress: QuestWatched): void;
  /** How a run of a quest's plan is going, on every change. See `QuestRunner`. */
  questRun?(progress: QuestRunProgress): void;
  /**
   * A command the client committed to the wire, reassembled from keystrokes.
   * One place does this, so a capture and the tracker cannot disagree.
   */
  command?(command: string, source: 'user' | 'automation'): void;
  /** How a route walk is going, when one is running. */
  walk?(progress: WalkProgress): void;
  /**
   * A walk was started toward this room — the palette's recent destinations.
   *
   * A hook rather than a store, for the reason `memory` is an interface: this
   * is the session layer, and where the file goes belongs to whoever decided
   * where the files go. Absent in every test and in the anonymous case, where
   * walking somewhere and forgetting it is better than refusing to walk.
   */
  destination?(room: RoomId, name: string): void;
  /** Loop progress — where the loop is, for the HUD. */
  loop?(progress: LoopProgress): void;
  /**
   * The decision trace: what automation queued, sent and decided.
   *
   * Coalesced by the caller rather than published per change — during a combat
   * burst the queue changes many times a second, and chrome must never be able
   * to pace the stream.
   */
  automation?(snapshot: AutomationSnapshot): void;
  /**
   * The room appraised — every monster's verdict and what clearing the room
   * is expected to cost — on change. The same `Verdict` auto-combat ranks on.
   */
  verdict?(appraisal: RoomVerdict): void;
  /**
   * What the things standing in this room can be asked, for this character as
   * it stands — on change, and keyed like the verdict. See `asksHere`.
   */
  asks?(offers: readonly RoomAsk[]): void;
  /**
   * The realm named its own data — `[MAJORMUD]:`, `[PARADIGM]:` at its menu —
   * once per connection. A hook rather than a store, like `destination`: which
   * bundled world that word chooses for this address next time is written
   * down by whoever decided where the files go (`WorldBook`).
   */
  realmTold?(realm: RealmWord): void;
}

/** The rooms holding one lair signature, as the hunting survey groups them. */
interface HuntGroup {
  rooms: HuntingRoom[];
  sample: WorldRoom;
  via: 'lair' | 'resident';
  spawns: number | null;
}

/** What pricing a group costs to work out and what it depends on: the character, never the room. */
interface HuntPrice {
  mobs: SpotMob[];
  clock: HuntingSpot['clock'];
  respawn: number | null;
}

/** One group priced against the character, before any loop is drawn round it. */
interface HuntPriced extends HuntPrice {
  key: string;
  group: HuntGroup;
  /** Every room of the group, nearest first. */
  rooms: HuntingRoom[];
}

/** What one of MegaMUD's alerts says, one literal key each for the coverage test. */
function megaAlertText(which: MegaAlert): string {
  switch (which) {
    case 'idle':
      return t('session.megamud.alert.idle');
    case 'train':
      return t('session.megamud.alert.train');
    case 'lowHp':
      return t('session.megamud.alert.lowHp');
    case 'hangup':
      return t('session.megamud.alert.hangup');
    case 'playerEntered':
      return t('session.megamud.alert.playerEntered');
    case 'telepath':
      return t('session.megamud.alert.telepath');
    case 'page':
      return t('session.megamud.alert.page');
    case 'say':
      return t('session.megamud.alert.say');
    case 'gangpath':
      return t('session.megamud.alert.gangpath');
    case 'gossip':
      return t('session.megamud.alert.gossip');
    case 'auction':
      return t('session.megamud.alert.auction');
    case 'broadcast':
      return t('session.megamud.alert.broadcast');
    default: {
      const unreachable: never = which;
      return unreachable;
    }
  }
}

export class SessionManager {
  private readonly client = new TelnetClient();
  private readonly telnetLog: TelnetEvent[] = [];
  /**
   * Framing runs alongside the terminal feed, not in front of it. The terminal
   * gets every chunk the moment it arrives; the tokenizer's buffering can never
   * delay a paint, which is the whole reason parsing and rendering are separate
   * consumers of the same stream.
   */
  private readonly tokenizer = new LineTokenizer();
  private readonly classifier: Classifier;
  private readonly tracker: CharacterTracker;
  /**
   * What the terminal is shown, line by line. See `TerminalFeed` for why the
   * terminal is fed framed lines now and what that costs.
   */
  private readonly feed: TerminalFeed;
  private readonly world: WorldGraph | undefined;
  /**
   * Which lineage's arithmetic *this server* runs, once the wire has said so.
   *
   * A second field beside the realm data's own family rather than a
   * reconciliation of the two, because they are two different facts and the
   * shipped configuration has them disagreeing legitimately: a Paradigm-built
   * world file is the map for a GreaterMUD default realm. Neither may overwrite
   * the other; a disagreement is said out loud and kept.
   *
   * Set once and never revised — the tells are positive statements about what
   * this server has, and a session does not change server mid-connection.
   * Cleared with the rest of the per-connection state on `reset`, because a
   * different realm may be a different family.
   */
  private serverFamily: RealmFamily | null = null;
  /** What the last pushed appraisal drew as, so a status line that moves no figure pushes nothing. */
  private lastVerdictKey = '';
  private lastAsksKey = '';
  /** So the disagreement is stated once a session and not once a block. */
  private familyStated = false;
  /** The realm's own word for its data, once the menu has said it. See `noteRealmWord`. */
  private realmTold: RealmWord | null = null;
  /** The last `fitness` answer and the state it was for; dropped when the family moves. */
  private fitted: { state: CharacterState; key: string } | null = null;
  /** What each room's lair costs this character, remembered per fitness. See `lairDanger`. */
  private readonly lairCosts = new LairCosts((room) => this.weighLair(room));
  /**
   * The hunting survey's pricing pass, remembered until the character's
   * fitness moves (todo 00, 2026-09-13). Weighing 1,260 groups costs main
   * ~140ms and depends on the sheet, the weapon, the class and the spells —
   * not on the room — while the card re-asks on every move it makes. Keyed
   * like `LairCosts`, the casting half added; dropped with the realm.
   */
  private huntPrices: { key: string; world: WorldGraph; groups: Map<string, HuntPrice> } | null =
    null;
  /** The fight record, which the survey asks what this character deals a round. */
  private readonly fightRecord: FightSink;
  private internal: InternalConfig = DEFAULT_INTERNAL;
  private readonly lineLog: StreamLine[] = [];
  private seq = 0;
  private lineSeq = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  /** When the tail now buffered first looked like a prompt still being written. */
  private promptOpenedAt: number | null = null;
  /**
   * Whether this realm writes its state after the prompt's colon
   * (`[HP=10/40]: (Resting)`). Then the colon is not where a prompt ends, and
   * `tailIsWholePrompt` may not frame one at it.
   */
  private promptTrails = false;
  /** Keystrokes since the last committed command. */
  private outbound = '';
  /** The command the last status line echoed, which the lines after it answer. */
  private answering: string | null = null;
  /**
   * The phase last seen, so *leaving the realm* is read as the transition it
   * is rather than as a state to be checked for on every line. See
   * `leftTheRealm`.
   */
  private phaseWas: SessionPhase = 'unknown';
  /**
   * Gang alerts already sent, by attacker, so a fight producing a blow line
   * per round is one broadcast per attacker per five-minute window — the
   * server's own window, because that is the clock the alert is about.
   */
  private readonly pvpSaid = new Map<string, number>();
  /** The room's last fight run and what it was run on, so a status line that moves nothing reruns nothing. */
  private ran: { key: string; survival: Survival | null } | null = null;
  /** The same for the fight an opening would make (`opening`). */
  private ranOpening: { key: string; survival: Survival | null } | null = null;
  /** Talk-box lines queued this session, so each one's commands can be named together. */
  private macros = 0;
  /** What the realm menu said a hang-up costs on the realm chosen (todo 01). */
  /**
   * Whether the standing-down notice has been said for the stretch of being on
   * the ground in progress. Cleared by the first state that is not, so a
   * second knockdown says it again: it is a fact about the moment, not a
   * lesson about the realm.
   */
  private saidMortallyWounded = false;
  /**
   * Where a route the player was walking still owes them, across a lost
   * connection. See `pickUpAfterLoss`.
   *
   * Taken from `Walker.journey` at the moment the socket goes and only for a
   * loss — a deliberate disconnect is the player ending the session — and
   * spent the first time the character is back in the realm and placed, or
   * dropped when anything supersedes it: a new walk, leaving the realm, a dial
   * to a different realm. The loop keeps its own place (`LoopRunner.carried`);
   * this is the one journey with nobody else holding its destination.
   */
  private journey: { to: RoomId; name: string; run: boolean } | null = null;
  /**
   * What was done, or refused, to keep this character alive.
   *
   * Kept apart from the rule trace because a safety action is not a rule, and
   * apart from the sent log because hanging up produces no command at all —
   * which is exactly why it needs recording somewhere. "Why did the bot run?"
   * has to be answerable, and so does "why did it not hang up?".
   */
  private readonly safetyLog: SafetyDecision[] = [];
  private lastSize: TerminalSize = { cols: 80, rows: 24 };

  /**
   * Who asked for the hang-up now in flight, latched by `disconnect`.
   *
   * Cleared by every dial, so a `client` left over from last night's
   * low-health hang-up cannot be read as the reason for tomorrow's loss.
   */
  private endedBy: ConnectionEnd | null = null;
  /** The engine is hanging up for the player's Disconnect: see `disconnect`. */
  private megaHangingUp = false;

  private current: ConnectionState = {
    phase: 'idle',
    target: null,
    connectedAt: null,
    detail: null,
    endedBy: null,
    negotiated: {
      localEnabled: [],
      remoteEnabled: [],
      binary: false,
      suppressGoAhead: false,
      remoteEcho: false
    }
  };

  readonly queue: CommandQueue;
  /** What the arbiter actually sent, newest last. Bounded; this is a trace. */
  private readonly sentLog: SentCommand[] = [];
  private automationTimer: NodeJS.Timeout | null = null;
  /**
   * The next command answers a password prompt, so it must not be written down.
   *
   * A property of the *prompt*, not of who answers it: the automator and a
   * person typing are equally in need of this, and keying on the automator
   * would have left manual login credentials in the capture file. The session
   * capture records every outbound command verbatim, which is exactly what
   * makes it useful and exactly why this has to be filtered before it gets
   * there.
   */
  private awaitingPassword = false;
  /**
   * The configured password, so a command that *is* it is redacted even when
   * no prompt armed anything.
   *
   * The prompt is the right primary key — a hand-typed password answers the
   * same prompt the automator does — and it is also the weak point: a BBS
   * front-end whose password prompt the classifier has never met produces no
   * `prompt-password` block, and a manual login there would have written the
   * password down verbatim. What `connection.login` holds is known without
   * reading the prompt. Exact match only — a substring search over every
   * command is `check:secrets`' job, offline, where a false positive costs a
   * look rather than a command in the record.
   */
  private secret = '';
  private automationConfig: AutomationConfig;
  /** The character's own combat settings, before the realm's monster table is laid under them. */
  private statedCombat: CombatConfig;
  /** The realm's monster table. See `configureMonsters`. */
  private realmMonsters: readonly MonsterRule[] = [];
  /** The realm's item table (`servers/<id>/items.yaml`), for the MegaMUD engine. */
  private realmItems: readonly ItemRule[] = [];
  private readonly login: LoginAutomator;
  /** Where this character should be at all, and the lap that puts it there — todo 05. */
  private readonly hunt: AutoHunt;
  /** Going to get the item a route's door wants — todo 07. */
  private readonly itemErrand: ItemErrand;
  /** Carrying a quest's plan, step by step (todos 102–103). */
  private readonly questRunner: QuestRunner;
  /** Keeping a room's ward up off a carried item (todo 105). */
  private readonly wards: Wards;
  /** Posting this character's readings to its realm's mudstats board. See `StatsReporter`. */
  private readonly stats: StatsReporter;
  /** Bending down for the key to the door in front of you. See `AutoKeys`. */
  private readonly keys: AutoKeys;
  /**
   * Followers who said `@wait` and have not yet said `@ok`, lower-cased.
   *
   * A set, not a flag: two followers may fall behind independently, and the
   * loop walks on only when the *last* of them has stood back up. Forgotten on
   * connect — a reconnect is a new session, and a `@wait` from the old one
   * must not hold a loop nobody asked it to.
   */
  private readonly waitingFollowers = new Set<string>();
  /**
   * Members under `party.waitForMembersBelow` on the listing, lower-cased —
   * MegaMUD's *Wait For Party Members*, read as a `@wait` nobody had to say
   * (`paceForHealth`). Kept apart from `waitingFollowers` because the listing,
   * not an `@ok`, is what lets them go. `hurtWaitSpent` is the limit having
   * run out on them: the lap walks on until every one is back over the line.
   */
  private hurtFollowers = new Set<string>();
  /**
   * Commands this realm does not have, so automation may not send them.
   *
   * An unrecognised command on this server family is **spoken aloud in the
   * room** rather than refused (docs/game-behaviour.md) — so asking twice is
   * not a wasted command, it is the client broadcasting to everybody standing
   * there, once per ask, for as long as whatever asks keeps asking. One
   * `You say "rm"` used to retire `rm` and nothing else; every other word the
   * realm spoke aloud was asked again on the next tick.
   *
   * Filled from two directions, and both are needed:
   *
   * - **The wire.** Any word the realm's own command table names
   *   (`commandOf`) that comes back as `command-not-understood` is put here.
   *   A word the table does *not* name says nothing and is left alone: a text
   *   exit is room data — `go manhole` is missing from every realm's command
   *   table by construction — and refusing one in this room is not a fact
   *   about the next.
   * - **The lineage.** Once a tell has said the server is MajorMUD, every
   *   `GREATERMUD_ONLY` command is unavailable *without being tried*, which is
   *   the whole point: the first try is the broadcast.
   *
   * Command **names**, so every spelling the server accepts is covered by one
   * entry — the server does no prefix matching and `rm`, `roo` and `room` are
   * one command to it.
   *
   * Per *connection*, cleared by `useRealm` — keyed on the address actually
   * dialled, the same reason the player book is. A character can be dialled at
   * a saved realm other than its own from the palette, so a word retired on a
   * MajorMUD board must not stay retired when the next connection is to
   * GreaterMUD. The cost of not knowing it is the same realm is one refusal
   * per connection.
   */
  private readonly unavailable = new Set<CommandName>();
  /** The words already spoken about, so a refusal is said once and not per ask. */
  private readonly saidUnavailable = new Set<CommandName>();
  /**
   * Which word this realm answers *where am I standing* with, or `'none'` for
   * neither. A realm setting, not a guess — see `LocateMethod` and
   * `locateWord`.
   */
  private locateMethod: LocateMethod;

  /**
   * The command the configured method sends, or null where it has none to
   * send — the method is `'none'`, or the wire has already refused the word
   * this connection.
   *
   * The refusal half is still derived from `unavailable` rather than stored a
   * second time: two copies of one fact agree only until one of them is
   * edited.
   */
  private get locateWord(): string | null {
    if (this.locateMethod === 'none') return null;
    if (this.locateMethod === 'sys-status') {
      return this.unavailable.has('Sys') ? null : 'sys status';
    }
    return this.unavailable.has('Room') ? null : 'rm';
  }

  /**
   * Ask the realm where the character is standing.
   *
   * `rm` (GreaterMUD/Paradigm) or `sys status` (MajorMUD) answers with
   * coordinates — the only exact statement of position this server makes —
   * and the tracker takes them outright (`user-profile`/`user-location`).
   * Which of the two, or neither, is `locateMethod`: a realm whose word is
   * not `rm` said so once in its own settings rather than have the client
   * find out by trying it first, which on the MajorMUD lineage is *said out
   * loud in the room*.
   *
   * If the configured word is refused anyway — a setting can be wrong — the
   * first refusal retires it for the connection the same way an unconfigured
   * `rm` always did, and whoever asked falls back to what it does anyway —
   * waiting for the next room block and re-deriving. That fallback is the
   * whole client on a realm with no working locate command, which is why the
   * reckoning above it had to be right rather than merely recoverable.
   *
   * **Public**, in addition to those two callers, for the Room card's own
   * locate button (`Invoke.locate`): a window may ask *that* a location be
   * asked for, but never *which word* — main is what read the realm's
   * setting, so main is what has to pick.
   */
  askWhereIAm(): boolean {
    return this.megaLocate();
  }

  /**
   * Resolves the character's own room before something that needs it plans
   * from it, when it is not already known.
   *
   * `planFromHere` and `Invoke.routeTo` both refuse outright rather than
   * guess — a route planned from the wrong room is a confidently wrong plan,
   * which costs more than the wait this spends to avoid one. Until now the
   * refusal was the whole of it: picking a Goto destination or pressing play
   * on a Loop while the room was ambiguous sent the player to the Room card's
   * own locate button and back to try again. This is that button, pressed on
   * the player's behalf at the one moment a plan actually needs the answer.
   *
   * **Two ways out cost nothing.** Already known: returns immediately,
   * true — the ordinary case, so a resolved room never waits on this at all.
   * Nothing to ask: `askWhereIAm` returns false when the realm is configured
   * for `'none'`, or the wire has already refused the configured word this
   * connection — either way there is no answer coming, and counting down
   * `locateResolveMs` for one would only make the refusal slower to arrive.
   *
   * **Polled rather than awaited on an event.** The room becomes known from
   * inside a block reducer with no promise of its own to hand out, and a
   * one-off waiter built for this single call site would be a second way to
   * learn the same fact the tracker already publishes on every line. A plan
   * asked for is asked for once, so the poll's own interval costs nothing
   * anybody is watching.
   */
  async ensureLocated(timeoutMs = tuning().session.locateResolveMs): Promise<boolean> {
    const known = (): boolean => {
      const room = this.tracker.current.room;
      return room.map !== null && room.number !== null;
    };
    if (known()) return true;
    if (!this.askWhereIAm()) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (known()) return true;
    }
    return false;
  }

  /**
   * The character's own persisted record, as `useRealm` handed it over — the
   * same instance the tracker writes through. Held here so the blessing
   * watchdog can read the measured durations at the point of use.
   */
  private belongings: BelongingsSink = NO_BELONGINGS;

  /**
   * Edges the live server refused this session (`from|direction`). Handed to
   * every route as `Traveller.refused`, and forgotten on disconnect: a server
   * restart may open what this session saw shut, and the permanent record
   * (`WorldMemory`) deliberately never reaches the pathfinder.
   */
  private readonly refusedEdges = new Set<string>();
  /**
   * The refused edges that are **shut** rather than absent, and have not yet
   * been given back once.
   *
   * The bound on `unrefuseWhatTheRoomPrints`. `refusedEdges` used to be
   * monotonic and that was its bound; taking entries out again needs a new one
   * or a corridor that both prints and refuses cycles — refused, un-refused on
   * the next room block, replanned, refused — at a route search and a move per
   * turn. `There is no exit in that direction!` has four causes
   * (docs/greatermud/movement.md) and two of them are exits the server may
   * still list, so that is not hypothetical.
   *
   * An entry is deleted when it is given back, so each edge is given back at
   * most once per session: the server printing it is a fact worth one retry,
   * and a way that is refused *again* after the room listed it is one the room
   * is not the authority on.
   */
  private readonly shutEdges = new Set<string>();
  /** The corridors of this character's preferred routes; null until asked, and after the loops change. */
  private preferred: ReadonlySet<string> | null = null;
  /** Stops listening to the realm's player book. See `useRealm`. */
  private forgetPlayers: () => void = () => {};
  /**
   * Whether this session has already asked about a suspected reset.
   *
   * Once, and the remembered identity moves on either way: a prompt that came
   * back on the next status line is a dialog somebody dismisses without
   * reading, which is the same as no dialog at all.
   */
  private askedAboutReset = false;
  /**
   * The rank each quest's counter has been *seen* to reach, and **when**.
   *
   * Per session: it is a record of this sitting's actions. The clock is what
   * lets it be ranked against the realm's own count rather than simply losing
   * to it — a listing read before the act is older evidence than the act. See
   * `questReading`.
   */
  private questSaid: Record<number, QuestSeen> = {};
  /** Which ask for a plan is current; an earlier chain stops at its next leg. */
  private planAsked = 0;
  /**
   * Whether the far end is still answering. See `LinkWatch`.
   *
   * Owned here rather than by `Reconnect`, which never hears about a socket
   * that stays open: this is the piece that turns a link that died quietly into
   * the `close` event everything downstream already knows what to do with.
   */
  private readonly link: LinkWatch;
  /** `link` hung this socket up, so its close is not the far end's doing. */
  private hungUpDead = false;

  constructor(
    private readonly sink: SessionSink,
    world?: WorldGraph,
    automation: AutomationConfig = DEFAULT_CONFIG.automation,
    login: LoginConfig = DEFAULT_CONFIG.connection.login,
    /*
     * What is known about monsters on *this character's* realm, and what
     * fighting them teaches. Defaults to knowing nothing, which is the honest
     * state for a client with no realm data and the one every test wants.
     */
    lore: MobLore = NO_LORE,
    /**
     * Where what this character learns about the realm is kept.
     *
     * An interface, not the store: this is the session layer, and the file
     * handling belongs to whoever decided where the file goes. Absent in every
     * test and in the anonymous single-session case, where learning something
     * and forgetting it is better than refusing to play.
     */
    private readonly memory?: RealmMemory,
    /**
     * Where fights are written down.
     *
     * Absent in every test and in the anonymous single-session case, where
     * there is no character file to keep a record beside. See
     * `shared/fights.ts` for why the record exists at all before anything reads
     * it.
     */
    fights: FightSink = NO_FIGHTS,
    /**
     * What the realm knows about the other players on it, shared by every
     * character dialling the same address. Defaults to a realm that knows
     * nothing, which is what every test wants.
     */
    players: RealmPlayers = NO_REALM_PLAYERS,
    /**
     * The realm's sentences for an effect landing and ending, shipped and
     * learned. Per realm like the lore beside it, and defaulting to none for
     * the same reason.
     */
    spellLore: SpellLore = NO_SPELL_LORE,
    /**
     * Where what a `search` turns up in this realm is written down.
     *
     * Keyed like `memory`'s shared half: what a room hides is the realm's, not
     * this character's. Last in the list on purpose — every argument above it
     * is passed positionally by the host and by two dozen tests — and
     * defaulting to a realm nothing is written down for, which is what those
     * tests want.
     */
    private readonly finds: RealmFinds = NO_FINDS,
    /**
     * The server's own words for an emote and for a monster dying, shipped
     * (`resources/world/actions.csv`, `death-messages.csv`) and shared by
     * every session. Defaulting to none, which reads exactly as the frames
     * alone did.
     */
    sentences: ShippedSentences = NO_SHIPPED_SENTENCES,
    /**
     * Which word this realm answers *where am I standing* with. See
     * `LocateMethod`. Defaulting to `'rm'`, which is what every realm answered
     * before this was a setting rather than a guess.
     */
    locate: LocateMethod = DEFAULT_CONFIG.connection.locate
  ) {
    this.locateMethod = locate;
    this.fightRecord = fights;
    this.tracker = new CharacterTracker(
      world,
      lore,
      (discovery) => this.remember(discovery),
      fights,
      players,
      spellLore
    );
    this.useRealm(players);
    /*
     * The classifier is handed the two things that can say where a monster's
     * name ends inside a combat line — the room it is standing in and the
     * realm's monster table — as a lookup rather than as either object, which
     * is the shape `classifyOccupant` already takes for the same reason.
     *
     * Read through the tracker rather than copied: the occupant list changes
     * with every room and every arrival, and a snapshot taken at construction
     * would name monsters from a room the character left an hour ago.
     */
    this.classifier = new Classifier(
      {
        present: () => this.tracker.current.room.occupants.map((who) => who.name),
        mob: (name) => world?.mob(name),
        self: () => this.tracker.current.name
      },
      // And the spell message table, for the whole-line sentences no frame
      // reads; a lookup because what has been learned changes as the session runs.
      (text) => spellLore.match(text),
      /*
       * And how this realm's monsters die: what its own wire taught (todo 04)
       * **beside** the server's own table, which may name several.
       *
       * Both, not the wire instead of the table (2026-09-14). They are not
       * rivals — a learned name and a shipped one are the same fact at two
       * granularities — and the one answer the wire had taught hid the four
       * the table names, which is what let a sentence every dark monk in the
       * room answers to be read as naming exactly one of them. A sentence
       * several monsters here could have said is settled by the room or by
       * nothing; see `Classifier.asDeathSentence`.
       */
      (text) => {
        const learned = lore.deathOf?.(text) ?? [];
        const shipped = sentences.deaths.mobsOf(text);
        if (learned.length === 0) return shipped;
        return [...new Set([...learned, ...shipped])];
      },
      // And the realm's emotes, off the server's action table.
      (text) => sentences.actions.match(text),
      // And, last, the server's own message table, fitted whole (todo 109).
      (text) => sentences.messages.match(text),
      // And which of its rows a confusing spell prints when it throws a
      // command away, so a fumble in any of the realm's words is read as one.
      (row) => world?.confusionMessages().has(row) ?? false
    );
    this.world = world;
    // A different realm is a different set of corridors; the preferred ones
    // are derived again the next time a route is planned.
    this.preferred = null;
    this.feed = new TerminalFeed(
      {
        isQuiet: (word) =>
          this.internal.terminal.quiet.enabled &&
          this.internal.terminal.quiet.commands.includes(word),
        isStatus: (plain) => STATUS_LINE.test(plain),
        now: () => Date.now(),
        design: (plain) => this.designPrompt(plain),
        // Not while a refusal stands: holding a prompt for a line that will
        // not be drawn is a delay for nothing.
        designing: () => this.rewriter.promptDesign() !== null && !this.designTooWideSaid,
        // The listings the client draws itself, from the batch the classifier
        // assembled and what the tracker had published before it.
        rewrites: (type) => this.rewriter.wants(type),
        rewrite: (block) =>
          this.rewriter.render(block, {
            state: this.tracker.current,
            world: this.world,
            wearer: this.wearerNow()
          })
      },
      // A held tail released by its timer, outside any chunk: painted as a
      // chunk of its own.
      (released) => {
        this.seq += 1;
        this.sink.data({
          seq: this.seq,
          at: Date.now(),
          text: released.text,
          ...(released.marks.length > 0 ? { marks: released.marks } : {})
        });
      }
    );

    /*
     * The arbiter. Everything automated goes through here, and nothing else may
     * write to the socket on automation's behalf — docs/legacy-assessment.md §6.
     */
    this.automationConfig = automation;
    this.statedCombat = automation.combat;
    this.queue = new CommandQueue(automation, {
      send: (command, intent) => {
        /*
         * The player's own line, paced (todo 04): the path a keystroke takes,
         * so it is observed and recorded as typed. Safe inside a drain: the
         * queue sends only with no typing hold standing, so `send`'s own
         * `noteTyping(false)` returns at once.
         */
        if (intent.typed === true) {
          this.send(`${command}\r`);
          return;
        }
        /*
         * An empty line is not a command, and the typed path has always said
         * so (`send` skips all three of these for a bare Enter). Filing one
         * would clear the slots that interpret the *previous* command — the
         * classifier's `lastCommand`, the tracker's aimed-at and unmodelled
         * slots — for a line the server keeps nothing of either. The walker's
         * nudge is the one thing that sends one.
         *
         * But it is still a **room block this client asked for**, and the one
         * fact that has to survive the gate is that one is coming: the nudge's
         * reprint was otherwise read as the arrival of the step sent behind it,
         * and the walk ran a room ahead of the character (2026-09-02,
         * `Expectations.noteReread`). That is what the `else` files, and it is
         * a door of its own precisely so this gate does not have to widen.
         */
        if (command.length > 0) {
          this.tracker.observeCommand(command);
          this.login.observeCommand(command);
          // The classifier needs it too: the server echoes what we send, and
          // `You say "<command>"` is only interpretable next to it.
          this.classifier.observeCommand(command);
        } else {
          this.tracker.observeReread();
        }
        /*
         * The arbiter's own `train stats` — the stat screen driver's proposal
         * — arms the hold a round trip early exactly as a typed one does
         * below, and for the same reason: the server answers it with no
         * prompt, and the next drain would otherwise send into the form. Safe
         * from inside this callback: one drain sends one command, and the
         * hold empties what it would have scheduled next.
         */
        if (opensStatScreen(command)) this.holdForStatScreen(t('session.stats.asked'));
        // `intent.secret` is the login's own answer about *this* command; the
        // latch below is about the last prompt, and the queue may hold the two
        // apart. See `Intent.secret`.
        const reported = this.reportable(command, intent.secret === true);
        this.sink.command?.(reported, 'automation');
        this.noteSent(command, 'automation');
        this.recordSent({
          at: Date.now(),
          command: reported,
          priority: intent.priority,
          ...(intent.reason === undefined ? {} : { reason: intent.reason })
        });
        this.client.send(`${command}\r\n`);
        // A command is on the wire, so an answer is owed and the dead-link
        // clock starts. Beside the idle clock rather than inside it: that one
        // counts what this client has sent, this one counts what the far end
        // has failed to say back.
        this.link.noteSent();
      },
      notice: (message) => this.sink.notice(message),
      /*
       * The emergency exception to the typing hold (see `CommandQueue.drain`):
       * committing the player's half-typed line goes through `send` — the
       * path a keystroke takes — so the partial command is observed, reported
       * and redacted exactly as if the player had pressed Enter themselves,
       * and the shadow buffer empties the way the server's buffer does.
       */
      clearTypedLine: () => this.send('\r'),
      unavailable: (command) => this.wordUnavailable(command),
      connected: () => this.client.connected
    });

    this.link = new LinkWatch({
      dead: (seconds) => {
        // Said before the socket goes, so the console reads in the order it
        // happened: this is why the connection dropped, then that it dropped.
        // A safety feature that acts without saying so is one nobody can tell
        // from a bug.
        this.sink.notice(t('session.connection.deadLink', { seconds }));
        // Hung up as a *loss*, not a disconnect: `close` reports `graceful`
        // false, so the loop is held rather than stopped and `Reconnect` dials
        // back if this character asked it to. Whether it does is not decided
        // here.
        this.hungUpDead = true;
        this.client.abandon();
      }
    });

    /*
     * The light, asked by the walker before every step (`beforeStep`) and by
     * the state on every arrival. Its refusals go to the safety trace, because
     * a torch not lit in a dark room is a decision somebody will ask about.
     */
    /*
     * And the ward a room wants, kept up off the pack (todo 105): the realm
     * says which spell stops a room's effect and which item's use casts it,
     * and this uses the item before the step and again when the spell
     * lapses. The stated countdowns are the router's; this module's own clock
     * is the walk's.
     */
    this.wards = new Wards(
      automation.health,
      automation.enabled,
      this.keptQueue,
      {
        hazardAt: (room) => {
          const world = this.world;
          const found = world?.byId(room);
          if (world === undefined || found === undefined || found.spell === undefined) return null;
          const spell = world.spellById(found.spell);
          const hazard = spell?.hazard;
          return spell === null || spell === undefined || hazard === undefined
            ? null
            : { spell, hazard };
        },
        itemsCasting: (spell) => this.world?.itemsCasting(spell) ?? [],
        spellById: (id) => this.world?.spellById(id) ?? null,
        spellsUp: (state) => this.spellsUp(state)
      },
      { notice: (message) => this.sink.notice(message) }
    );
    /*
     * And the key to the door in front of the character, which is the other
     * thing a route cannot ask for itself: a keyed edge is pruned before any
     * step exists to be refused at. It reads the pack through the same
     * statement the router does (`packContents`), so the two cannot disagree
     * about whether the key is already held.
     */
    /*
     * And the realm's mudstats board, where this character posts its readings
     * (`logging.stats`), its key read off the telepath the board sends it.
     */
    this.stats = new StatsReporter(
      {
        snapshot: () => {
          const state = this.tracker.current;
          if (state.phase !== 'in-game') return null;
          return statsSnapshot(state, this.mega?.statsReport() ?? null, APP_VERSION);
        },
        playerName: () => {
          const state = this.tracker.current;
          return state.phase === 'in-game' ? state.name : null;
        },
        notice: (text) => this.sink.notice(text)
      },
      `mudengine ${APP_VERSION}`
    );
    this.keys = new AutoKeys(
      automation.movement,
      automation.enabled,
      this.keptQueue,
      {
        ways: (state) => this.keyedWaysHere(state),
        carried: (state) => this.packContents(state),
        idOf: (name) => this.world?.itemIdNamed(name) ?? null
      },
      {
        notice: (message) => this.sink.notice(message),
        /*
         * Standing still, which here means two facts. A move on the wire makes
         * `state.room` the room being *left*, so its floor belongs to
         * somewhere else — the refusal `Walker.start` and `LoopRunner.advance`
         * both make. A walk marching sends its step from the `movement` band,
         * which outranks the `probe` this proposes in, so a `get` behind it is
         * spent in the room after this one.
         */
        busy: () =>
          this.tracker.pendingMoves > 0 ||
          // MegaMUD's All Off.
          this.mega?.toggles.on.allOff === true,
        // The engine takes it off any floor (`opensAWay`), this one among them.
        engineTakes: () => this.mega !== null
      }
    );
    /*
     * And where the character should be at all (todo 05): the survey's best
     * lair within reach, walked to as a journey the card draws and then run as
     * a loop that is filed nowhere. Its planner is the errand's, with one
     * difference that is the whole point — the walk is a **route the player
     * asked for** rather than a leg, because a lair three maps away is a
     * journey and a journey drawn as nothing is a character crossing the realm
     * under a card that says *stopped*.
     */
    this.hunt = new AutoHunt(
      automation.hunting,
      automation.walk,
      automation.health,
      automation.enabled,
      {
        here: () => roomAddress(this.tracker.current.room),
        survey: (radius) => this.huntingGrounds(radius),
        routeTo: (room) => this.planFromHere(room),
        // The engine's Go To.
        walk: (route) => this.megaWalk(route),
        runLoop: (loop) => {
          const answer = this.startLoop(loop);
          return 'refused' in answer ? answer.refused : null;
        },
        // The lap's **name**, so the hunt can tell its own from one the player
        // started while it was running. See `HuntPlanner.runningLoop`.
        runningLoop: () => this.runningLoopName(),
        stopLoop: () => this.stopLapAndWalk(),
        moveInFlight: () => this.tracker.pendingMoves > 0,
        walking: () => this.walkingNow(),
        /*
         * Nothing else in the middle of something. The escapes, and **the
         * errands** — each of which has phases where nothing is walking and
         * nothing is looping (a shop errand waiting for its listing, a trainer
         * errand waiting for the level to move), during which a hunt would
         * otherwise survey and walk the character away from what it came for.
         * And MegaMUD's All Off: nothing of the engine's moves, so nothing here
         * starts.
         */
        busy: () =>
          this.mega?.toggles.on.allOff === true ||
          this.megaBuying !== null ||
          this.itemErrand.running ||
          this.questRunner.running
      },
      {
        notice: (message) => this.sink.notice(message),
        decided: (decision) => this.noteSafety(decision)
      }
    );
    /*
     * And going to get the thing a door wants (todo 07): bought where the
     * realm names a counter, hunted where it names a monster, and the route
     * the player asked for walked once the pack holds it.
     */
    this.itemErrand = new ItemErrand(
      {
        here: () => roomAddress(this.tracker.current.room),
        sourcesOf: (item, to) => this.itemSources(item, to),
        // Ours on the engine (`megaBuy`), and the engine's for the rest of what moves.
        buy: (row) => this.megaBuy(row),
        buying: () => this.megaBuying !== null,
        runLoop: (loop) => {
          // `startLoop` replaces whatever lap was running, which is right — one
          // movement at a time — and worth saying, because the lap it replaces
          // is the player's and it is not coming back on its own.
          const running = this.runningLoopName();
          if (running !== null) {
            this.sink.notice(t('automation.collect.replacingLap', { loopName: running }));
          }
          const answer = this.startLoop(loop);
          return 'refused' in answer ? answer.refused : null;
        },
        looping: () => this.runningLoopName() !== null,
        stopLoop: () => this.stopLapAndWalk(),
        alsoTake: (name) => this.mega?.alsoTake(name, true),
        stopTaking: (name) => this.mega?.alsoTake(name, false),
        // The route the player asked for: the engine plans its own way from
        // wherever the errand ended.
        walk: (route, run) => this.walkRoute(route, run),
        // The player's own list is what makes a found key worth keeping.
        kept: (name) =>
          this.automationConfig.supplies.items.some((row) => nameAnswersTo(name, row.name)),
        // To the room where the item is asked for (todo 806), walked alone.
        walkTo: (room) => {
          if (roomAddress(this.tracker.current.room) === room) return null;
          return this.mega?.walkTo(room, false, true) ?? t('session.megamud.noEngine');
        },
        walking: () => this.walkingNow(),
        // The phrase in the `probe` band, as the quest run's act, and seen by
        // the quest book like any act this client sends for the player.
        say: (command, onSent) =>
          this.keptQueue.enqueue({
            command,
            priority: 'probe',
            coalesceKey: COLLECT_SAY_KEY,
            // Lapses as the quest run's act does, so a phrase that never goes
            // out ends the errand rather than holding it (`saying`).
            expiresAt: Date.now() + tuning().quests.expiresMs,
            reason: t('automation.collect.reasonSay', { command }),
            onSent: () => {
              onSent();
              this.noteQuestSaid(command);
            }
          }),
        listPack: (onSent) =>
          this.keptQueue.enqueue({
            command: AFTER_WORD,
            priority: 'probe',
            coalesceKey: COLLECT_AFTER_KEY,
            expiresAt: Date.now() + tuning().quests.expiresMs,
            reason: t('automation.collect.reasonPackAfter'),
            onSent
          }),
        saying: () => this.keptQueue.queued((intent) => intent.coalesceKey === COLLECT_SAY_KEY),
        takeBack: () =>
          this.keptQueue.cancel(
            (intent) =>
              intent.coalesceKey === COLLECT_SAY_KEY || intent.coalesceKey === COLLECT_AFTER_KEY
          )
      },
      {
        notice: (message) => this.sink.notice(message),
        decided: (decision) => this.noteSafety(decision)
      }
    );
    /*
     * And carrying a quest's plan (todos 102–103): the errands above, the
     * walker and auto-combat, driven one step at a time by the plan the card
     * drew. Its legs are an errand's — quiet, held for health, not owed
     * across a lost connection — and it holds the lap as the errands do.
     */
    this.questRunner = new QuestRunner(
      automation.quests,
      automation.enabled,
      this.keptQueue,
      {
        here: () => roomAddress(this.tracker.current.room),
        /*
         * `abil` is GreaterMUD's alone, and the family is told by the banner
         * or by the listing having answered at all: a realm that has printed
         * its counters once prints them.
         */
        printsCounters: () =>
          this.serverFamily === 'greatermud' || this.tracker.current.abilities !== null,
        routeTo: (room) => this.planFromHere(room),
        walk: (route) => this.megaWalk(route),
        stopWalking: () => {
          if (this.walkingNow()) this.mega?.button(WindowCommand.GoStop);
        },
        moveInFlight: () => this.tracker.pendingMoves > 0,
        walking: () => this.walkingNow(),
        busy: () => this.mega?.toggles.on.allOff === true,
        looping: () => this.runningLoopName() !== null,
        hold: () => this.megaHold(),
        release: () => this.megaRelease(),
        buy: (row) => this.megaBuy(row),
        buying: () => this.megaBuying !== null,
        // MegaMUD restocks itself, on its loop's start detour (`0x406f20`).
        restock: () => null,
        hunt: (item) => this.itemErrand.collect([item], null, this.tracker.current),
        hunting: () => this.itemErrand.running,
        abandonErrands: (reason) => {
          if (this.megaBuying !== null) this.megaBuyGiveUp(reason);
          this.itemErrand.abandon(reason);
        },
        fightFor: (mob) => this.mega?.alsoFight(mob, true),
        stopFighting: (mob) => this.mega?.alsoFight(mob, false),
        warding: (on) => this.wards.lend(on),
        said: (command) => this.noteQuestSaid(command),
        watched: () => this.questSaid
      },
      {
        notice: (message) => this.sink.notice(message),
        decided: (decision) => this.noteSafety(decision),
        progress: (progress) => this.sink.questRun?.(progress)
      }
    );
    /*
     * Answering the login is on the *player's* behalf, so it goes through the
     * arbiter at `user` priority and outranks anything automated.
     */
    this.secret = login.password;
    this.login = new LoginAutomator(login, this.queue, {
      notice: (message) => this.sink.notice(message)
    });
    /*
     * Raw bytes first, and deliberately before `data`.
     *
     * The capture is what a disagreement about ordering gets settled from, so
     * what it records has to be the order the socket delivered — not the order
     * the decode and framing pipeline produced. Nothing else listens; this is a
     * recording tap, and it must never be given work that could delay a paint.
     */
    this.client.on('bytes', (payload) => this.sink.bytes?.(payload));

    this.client.on('data', (text) => {
      const at = Date.now();
      // Whatever was owed has been answered. Every byte counts here, unlike
      // the keep-alive's clock below: this asks whether anything is on the
      // other end of the socket, and an unprompted status-line repaint is as
      // good an answer to that as a reply to a command.
      this.link.noteReceived();
      this.feed.arrived();
      this.sink.decoded?.(text);
      /*
       * Framed first, painted second — and both in this call. The terminal is
       * fed lines now rather than the raw chunk, so that a line can be
       * withheld by what it is; what keeps the old guarantee is that every
       * line terminated in this chunk is emitted before this handler
       * returns, and the unterminated tail with it unless a quiet command is
       * being answered. A parser fault costs the line its type, never its
       * paint: `publishLine` guards the classifier.
       */
      for (const framed of this.tokenizer.push(text)) this.publishLine(framed, at);
      this.feed.partial(this.tokenizer.buffered);
      this.paint(at);
      /*
       * A prompt the server has finished writing is framed now, not after
       * the quiet period: it carries the vitals and credits the next queued
       * command, and nothing follows a finished `]:` on the wire but this
       * client's own echo (`mudengine-wire` § Line framing, 2026-09-11).
       */
      if (this.tailIsWholePrompt()) this.flushPending();
      else this.armIdleFlush();
      // After our own reading, so the engine learns rooms our tracker has
      // placed and the buffs it has seen go up and down.
      this.mega?.buffs(this.tracker.current.buffs);
      this.mega?.afflictions(this.tracker.current.afflictions);
      this.mega?.received(text);
      /*
       * Deliberately *not* `routines.noteSent()`: the keep-alive counts this
       * client's own silence, and bytes arriving are not it. This realm
       * repaints its status line unprompted every thirty seconds, so counting
       * them reset a forty-five second clock forever — see `Routines.noteSent`
       * for the capture.
       */
    });

    this.client.on('telnet', (event) => {
      this.telnetLog.push(event);
      if (this.telnetLog.length > tuning().session.telnetLogLimit) this.telnetLog.shift();
      this.sink.telnet(event);
      // Negotiation changes what the state pane shows, so republish.
      this.patch({});
    });

    this.client.on('close', (graceful) => {
      this.flushPending();
      this.mega?.closed();
      // Nothing is owed across a closed socket, and a deadline left armed
      // would hang up the *next* connection this session opens.
      this.link.reset();
      /*
       * Whether this close is a *loss*: nobody on this side asked for it.
       * `graceful` is the whole test of who asked, and `login.standDown` is
       * the latch that says the player typed their way out before the far end
       * hung up. They are the two facts `Reconnect.lost` reads first, so what
       * is carried here is never something that stood down there.
       *
       * The carry follows the **loss**, not the dial. Whether the character
       * is dialled back is `Reconnect`'s and the profile's — auto-reconnect
       * off, the ladder giving up, a realm that keeps dropping — and none of
       * that changes what was underway when the link went. A character
       * dialled back by hand an hour later gets the lap it was running, said
       * out loud on the way (`heldOffline`, then `walkingOnAfterReconnect`),
       * with the Loop card reading `offline` the whole time it is owed and
       * its Stop the way to say otherwise. Pressing Disconnect at the closed
       * socket does not put it down: that is *stop trying to dial*, which
       * `SessionHost` answers, and the socket it would close is already gone.
       */
      const lost = !graceful && this.login.standDown === null;
      this.journey = null;
      this.dropTyped();
      this.queue.clear();
      /*
       * The character is no longer in the realm, and saying otherwise is a lie
       * the HUD acts on: it went on reporting vitals and a room for a character
       * whose socket had closed. Identity survives — the offline card and the
       * tab still have a name to show.
       */
      if (this.tracker.leaveRealm()) {
        this.publishCharacter();
      }
      // A dead link hung up here is still a loss, but the far end did not
      // close it, and saying it did sent the player to blame the realm.
      const detail = graceful
        ? t('session.connection.disconnected')
        : this.hungUpDead
          ? t('session.connection.hungUp')
          : t('session.connection.closedByRemote');
      this.hungUpDead = false;
      /*
       * Who ended it, for the window. `lost` is already the whole test of
       * whether anybody here asked; what it does not say is *which* of the two
       * here asked, and the latch does. Somebody who typed their way out to the
       * BBS menu arrives ungracefully and is still the player.
       */
      const endedBy: ConnectionEnd = lost ? 'realm' : (this.endedBy ?? 'player');
      this.endedBy = null;
      this.patch({ phase: 'closed', connectedAt: null, detail, endedBy });
      this.sink.notice(detail);
      /*
       * A socket that went without this client asking is a *loss*, and a loss
       * is the only thing anything dials back. `graceful` is the whole test:
       * the player's Disconnect, the low-health hang-up, dialling a second
       * realm and quitting all route through `TelnetClient.disconnect()` and
       * reach here as one.
       *
       * `login.standDown` is the other half. Somebody who typed their way out
       * to the menu and then logged off the BBS also arrives here ungracefully
       * — the far end hung up — and dialling them back would put them in the
       * realm they just walked out of, with their password if automatic login
       * is on. That latch already exists to stop the login sequence for
       * exactly this; it is read rather than copied.
       */
      if (!graceful) this.sink.dropped(this.login.standDown);
    });

    this.client.on('error', (error) => {
      this.patch({ phase: 'error', detail: error.message });
      this.sink.notice(t('session.connection.socketError', { message: error.message }));
    });
  }

  get state(): ConnectionState {
    return this.current;
  }

  get log(): TelnetEvent[] {
    return [...this.telnetLog];
  }

  get lines(): StreamLine[] {
    return [...this.lineLog];
  }

  get character(): CharacterState {
    return this.tracker.current;
  }

  /**
   * Which lineage's arithmetic the *server* runs, as the wire stated it.
   *
   * Not `CharacterState.realm`, which is the `[MAJORMUD]:` / `[PARADIGM]:`
   * menu prompt — a different fact over a different union, since `paradigm` is
   * a database and there is no Paradigm arithmetic. Exposed for the queries
   * main answers out of the realm file, which have to read a column the way
   * this server reads it. Null until the wire has said.
   */
  get family(): RealmFamily | null {
    return this.serverFamily;
  }

  /**
   * This character's level, for a query out of the realm file that has to
   * answer *for this character* — a room spell whose effect the realm gates
   * on level (todo 01). Null until a status line or a sheet has said, which
   * `hazardFor` reads as *keep the whole hazard*.
   */
  get level(): number | null {
    return this.tracker.current.progress.level;
  }

  /** The lapse the notice quotes, in whole seconds. Read, never captured. */
  private get staleMoveSeconds(): number {
    return Math.round(tuning().parse.staleMoveMs / 1000);
  }

  /** What this character has learned about the realm the data does not have. */
  get learned(): Discovery[] {
    return [...(this.memory?.all ?? [])];
  }

  /**
   * Writes down a way through the realm the realm data does not have, once.
   *
   * Said out loud the first time and never again, which is what the store's
   * de-duplication buys: walking a new corridor every day should not announce
   * it every day. It is worth saying at all because the alternative is a file
   * quietly filling up with observations nobody knows were made — and because
   * the client having *noticed* is the part a player would otherwise assume
   * had not happened.
   */
  private remember(discovery: Discovery): void {
    const fresh = this.memory?.learn(discovery);
    if (!fresh) return;
    this.sink.notice(t('session.memory.learned', { discovery: describeDiscovery(fresh) }));
    this.sink.learned?.(this.learned);
  }

  /**
   * Strikes an observation out because the player says it is wrong.
   *
   * The player's call, not the client's: nothing automatic can tell a
   * mistyped direction the server accepted from a genuine way through. Said
   * out loud like learning was, so the record and the terminal agree, and
   * republished so every window showing the card sees it go.
   */
  forget(discovery: Pick<Discovery, 'from' | 'command'>): boolean {
    const struck = this.memory?.forget(discoveryKey(discovery)) ?? false;
    if (!struck) return false;
    this.sink.notice(
      t('session.memory.forgot', { command: discovery.command, from: discovery.from })
    );
    this.sink.learned?.(this.learned);
    return true;
  }

  /**
   * Counts the search just answered here and writes down what it turned up,
   * saying so once a find.
   *
   * Both answers count — `Your search revealed nothing.` is the search a rate
   * most needs — and the listing is read after `apply`, so an empty answer
   * reads the empty floor the tracker has just written. Silent about a
   * repeat: a lair searched every lap should not announce the same key every
   * lap. The rows still move, and the card is told whenever this room has
   * any, because every one of their rates just changed.
   *
   * A room the client cannot place is **not** written down. A find whose room
   * is a guess is a row nobody can walk back to, and the map cannot mark it;
   * refusing rather than guessing is the standing rule, and the search is still
   * on screen where the player can see it.
   */
  private recordSearch(): void {
    const state = this.tracker.current;
    const { room } = state;
    if (room.map === null || room.number === null) return;
    const where = roomId(room.map, room.number);
    /*
     * The realm's name for the room where the wire has not printed one, and the
     * id where neither has. A row has to read without the database open beside
     * it, and `1/2150` is a worse answer than `Bank of Godfrey` but a far
     * better one than an empty cell.
     */
    const roomName = room.name ?? this.world?.byId(where)?.name ?? where;
    const at = Date.now();
    const found: Sighting[] = room.hidden.map((item) => ({
      roomName,
      name: item.name,
      // Absent is *not one*: the server counts stacks and says nothing about
      // a single thing. See `Find.quantity`.
      quantity: item.count ?? null,
      copper: null,
      at
    }));

    const cash = room.hiddenCash;
    if (cash !== null) {
      found.push({
        roomName,
        // The server's own phrase where it printed one, so a row reads as the
        // line did: `4 copper farthings`, not a reconstruction of it.
        name: cash.rawText ?? t('session.finds.coins'),
        quantity: null,
        copper: cash.totalCopper,
        at
      });
    }

    // Recorded silently: the search's own line is on screen, and the Room
    // card's Found tab is where the record is read.
    this.finds.search(where, found);
    const all = this.finds.all;
    if (all.some((find) => find.room === where)) this.sink.finds?.([...all]);
  }

  /**
   * Strikes a find out because the player says it is wrong.
   *
   * The player's call for the reason `forget` above is theirs: the client
   * cannot tell a room it mis-resolved from one that really hides a thing, and
   * a record that cannot be corrected is one that stops being read.
   */
  forgetFind(find: Pick<Find, 'room' | 'name'>): boolean {
    if (!this.finds.forget(findKey(find))) return false;
    this.sink.notice(t('session.finds.forgot', { what: find.name, room: find.room }));
    this.sink.finds?.([...this.finds.all]);
    return true;
  }

  /**
   * A typed line that reaches a quest step, so the book moves as the character
   * plays rather than only when somebody spends an `abil`.
   *
   * Reported 2026-09-07: `ask markus letter` advanced the quest and the card
   * said nothing until an `abil` was typed. Nothing on the wire announces a
   * counter moving — that is the whole reason `abil` exists — so the only fact
   * available at the moment it happens is the **player's own action**, and this
   * is that fact and no more. It never touches `CharacterState.abilities`,
   * which is the realm's own count and stays the realm's: what crosses is a
   * separate reading the card ranks *under* it.
   *
   * The step must name its asker and the line must carry both the asker and one
   * of the words that reach the step — see `stepSaid` for why the pair, and why
   * this does not claim the ask succeeded. **Where the character is standing
   * and what `abil` last stated are handed over too**, because one asker and
   * one phrase routinely reach several steps: `ask old man prophecy` reaches
   * four, three of them in a room on another map, and taking the first
   * credited the Good quest to somebody doing the Phoenix one (2026-09-15).
   */
  private noteQuestSaid(command: string): void {
    const quests = this.world?.quests();
    if (quests === undefined || quests.length === 0) return;
    // Where the character is standing, for a step the realm scripts onto a room
    // rather than onto somebody: the room is that step's anchor (todo 12).
    this.noteQuestReached(
      stepSaid(quests, command, roomAddress(this.tracker.current.room), this.countersNow())
    );
  }

  /**
   * A monster this character watched die, which is the other way a step runs.
   *
   * Reported 2026-09-15: the dread mystic died in the Meditation Chamber and
   * the quest book stayed at one of nine. A boss's `DeathSpell` chains into a
   * text block and that block is a quest step (realm format 37) — so *kill the
   * dread mystic* is the whole act, there is nothing to say and nobody to say
   * it to, and `noteQuestSaid` above could never reach the kind. The death is
   * the fact available at the moment it happens, exactly as the typed line is
   * for an ask, and it is read the same way and ranked the same way.
   *
   * Taken from the tracker rather than read off the block here, because
   * *whether* a monster died is a judgement `FightTracker` makes — from the
   * room's own death sentence, or from the experience line against the thing
   * this character was hitting — and the name is the realm's row, not the
   * spelling the room hung a modifier on.
   */
  private noteQuestKilled(name: string): void {
    const quests = this.world?.quests();
    if (quests === undefined || quests.length === 0) return;
    this.noteQuestReached(
      stepKilled(quests, name, roomAddress(this.tracker.current.room), this.countersNow())
    );
  }

  /**
   * The counters as they stand: what `abil` last listed, walked forward by
   * what has been watched since. See `countersNow` for why the listing alone
   * is a photograph, and every reader of a counter here takes this one.
   */
  private countersNow(): AbilitySums | null {
    return countersNow(this.tracker.current.abilities, this.questSaid);
  }

  /**
   * The book has been seen to reach a rank. Both readings land here.
   *
   * **Only ever forward.** A keyword answered again at a later rank, or a boss
   * killed a second time, must not walk the book backwards — and `giveability`
   * is upward-only on the server too, so forward is what the counter does.
   *
   * **And a step the counters refuse did not run.** Neither reading claims the
   * ask succeeded, and until 2026-09-15 that risk was contained by the listing
   * always outranking them; now that a later observation can raise the book
   * above a listing, the listing is put to the one use it is exact for — a
   * *complete* one that fails this step's own counter gates says the server
   * cannot have run it, whatever the player typed. Unknown refuses nothing, as
   * everywhere: no listing, or half of one, and the act is taken as before.
   */
  private noteQuestReached(found: { quest: Quest; step: QuestStep } | null): void {
    if (found === null || found.step.to === undefined) return;
    const known = this.questSaid[found.quest.id];
    if (known !== undefined && known.to >= found.step.to) return;
    if (countersRefuse(found.step, this.countersNow())) return;
    const seen: QuestSeen = { to: found.step.to, at: Date.now() };
    this.questSaid = { ...this.questSaid, [found.quest.id]: seen };
    this.sink.questSaid?.(this.questSaid);
  }

  /** What this character has been seen to do about each quest. See `noteQuestReached`. */
  get questProgress(): QuestWatched {
    return this.questSaid;
  }

  /** Everything a search has turned up in this realm. See `RealmFinds`. */
  get foundHere(): Find[] {
    return [...this.finds.all];
  }

  async connect(target: ConnectionTarget): Promise<ConnectionState> {
    this.telnetLog.length = 0;
    this.lineLog.length = 0;
    this.lineSeq = 0;
    this.tokenizer.reset();
    this.promptTrails = false;
    this.feed.reset();
    this.promptOpenedAt = null;
    this.classifier.reset();
    this.tracker.reset();
    this.statlineSaid = { reported: null, exact: null };
    this.queue.clear();
    this.sentLog.length = 0;
    this.link.reset();
    this.hungUpDead = false;
    this.askedAboutReset = false;
    // A new session's own actions, not the last one's.
    this.questSaid = {};
    // A refusal arriving before the new session's first prompt is nobody's.
    this.answering = null;
    this.askedAbilities = false;
    this.wards.reset();
    this.hunt.reset();
    this.itemErrand.reset();
    this.afterFetch = null;
    this.questRunner.reset();
    this.keys.reset();
    /*
     * The loop and the player's route are the two things a new connection
     * does not put down — *when it is the same realm*. A loop is a list of
     * rooms in one realm and a journey ends in one, so a dial to a different
     * address puts both down and says so; `Reconnect` dials the address last
     * dialled, so a loss carried this far comes back to the realm it was
     * running on. `target` is the last address dialled, kept through `closed`.
     *
     * A loop that is not carried — stopped, idle, or running on a socket that
     * has not closed yet — is reset as before, and the followers' `@wait` with
     * it: a `@wait` from a session that ended must not hold a loop nobody
     * asked it to. With a carried loop the set stays, because the followers
     * who said it are still where they were and have not said `@ok`.
     */
    const sameRealm = this.current.target !== null && sameTarget(this.current.target, target);
    if (!sameRealm) {
      /*
       * **A different realm drops the lap whatever state it is in.** Its stops
       * are room ids in a world this character is no longer in, and its place
       * round them means nothing there.
       *
       * This used to read `if (carried) stop(...)`, which worked while a
       * *stopped* lap was one nothing carried. Since a stop keeps its place
       * (`src/shared/movement.ts`) a stopped lap is carried too, and `stop()`
       * early-returns on one — so the guard neither said anything nor cleared
       * `offline`, `carried` stayed true, and the `reset()` below was skipped:
       * the old realm's lap survived into the new one with the old world's
       * rooms in it, and the card offered play on it.
       */
      if (this.journey !== null) {
        this.sink.notice(
          t('session.walk.notResumed', {
            destination: this.journey.name,
            reason: t('session.loop.stoppedRealmChanged')
          })
        );
        this.journey = null;
      }
    }
    this.forgetFollowers();
    this.refusedEdges.clear();
    this.shutEdges.clear();
    this.realmMismatchSaid = false;
    this.pvpSaid.clear();
    this.safetyLog.length = 0;
    this.login.reset();
    this.outbound = '';
    this.phaseWas = 'unknown';
    this.realmTold = null;
    this.awaitingPassword = false;
    this.cancelIdleFlush();
    this.endedBy = null;
    this.patch({ phase: 'connecting', target, detail: null, connectedAt: null, endedBy: null });
    this.sink.notice(
      t('session.connection.connecting', {
        host: target.host,
        port: target.port,
        encoding: target.encoding
      })
    );

    try {
      await this.client.connect(target);
      // Report the geometry the renderer last measured, so the server sizes its
      // output correctly from the first screen rather than after a resize.
      this.client.resize(this.lastSize);
      this.patch({ phase: 'connected', connectedAt: Date.now(), detail: null });
      this.mega?.connected();
      this.sink.notice(t('session.connection.connected', { host: target.host, port: target.port }));
    } catch (error) {
      if (error instanceof DialCancelled) return this.current; // `close` reports it
      const detail = errorMessage(error);
      this.patch({ phase: 'error', detail });
      this.sink.notice(t('session.connection.failed', { detail }));
      // MegaMUD's own rule for a dial that failed (`Comms.RedialConnect`).
      this.mega?.connectFailed();
    }

    return this.current;
  }

  /**
   * Hang up on purpose, and record who asked.
   *
   * `by` reaches the window as `ConnectionState.endedBy`, because the three
   * ways a connection ends are three different facts to somebody who is not at
   * the keyboard: they pressed Disconnect, the client hung up for them, or the
   * realm went. Only the socket's own `close` knows whether it was graceful,
   * so this latches the answer and the handler reads it.
   */
  disconnect(by: ConnectionEnd = 'player'): ConnectionState {
    if (!this.client.connected) return this.current;
    if (this.megaHangingUp) by = 'player';
    else if (by === 'player' && this.mega) {
      /*
       * The engine told first, as MegaMUD's own Disconnect is (`0x7d4`): it
       * logs off and hangs up through `hangUp` back into here, and marks the
       * close as the player's so it does not redial it as a lost carrier.
       */
      this.megaHangingUp = true;
      try {
        this.mega.disconnect();
      } finally {
        this.megaHangingUp = false;
      }
      if (this.current.phase === 'closing' || !this.client.connected) return this.current;
    }
    this.endedBy = by;
    this.patch({ phase: 'closing' });
    this.client.disconnect();
    return this.current;
  }

  /** The player's keyboard: what they typed sent, and the engine told they are at it. */
  typedInput(data: string): void {
    this.send(data);
    this.keyPressed();
  }

  /**
   * The player at the keyboard, which MegaMUD's idle clock and its User input
   * cancels AFK mode answer to (`playerKey`). Only the player's own keys: a
   * line the client sends for them, clearing an abandoned one, is not.
   */
  keyPressed(): void {
    this.mega?.key();
  }

  send(data: string): void {
    /*
     * A pasted run split onto the channel the player has already named.
     *
     * Typing `-` and pasting three lines put `-a`, then `b`, then `c` on the
     * wire: one broadcast and two bare commands said out loud in the room
     * (todo 03). The realm's input line cannot know a paste happened, and the
     * only thing that knows a channel was named is the half-line already on
     * it — which is `this.outbound`, kept here for the queue.
     *
     * Rewritten before anything else looks at `data`, so the tracker, the
     * classifier, the capture and the queue all see the lines that actually
     * reach the socket. `splitOntoChannel` answers `null` for a single line,
     * a run with no channel named and a run whose extra lines are all blank,
     * which is every ordinary keystroke.
     */
    const outgoing = splitOntoChannel(this.outbound, data) ?? data;

    /*
     * The shadow of the server's input line. Movement is the strongest
     * room-resolution signal there is, so the tracker needs to know what was
     * typed — and the queue needs to know whether a *partial* line is on the
     * wire, because anything automation sends while one is would be glued
     * onto it by the server. Erases are honoured for the same reason the
     * buffer exists at all: this must hold what the server's line editor
     * holds, or it answers the "is the line clear" question about a line the
     * player has already backspaced away. `editorInput` is the other half of
     * that rule: a control byte the server keeps nothing of must not leave a
     * line here that stands automation down for twenty seconds.
     */
    if (this.outbound.length === 0) this.typingSince = Date.now();
    for (const ch of editorInput(outgoing)) {
      if (ch === '\x7f' || ch === '\b') this.outbound = this.outbound.slice(0, -1);
      else this.outbound += ch;
    }

    /*
     * Whether a whole line went out, rather than a keystroke on the way to
     * one. Only a line arms the dead-link clock: a half-typed one produces no
     * answer at all while the server is doing its own echo, so arming on a
     * keystroke would hang up on somebody who started typing and went to make
     * tea. A bare Enter counts — it is what the keep-alive sends.
     */
    let committed = false;

    // A chunk can carry a whole command and its terminator at once — a paste,
    // or a caller sending `who\r` in one go — so this loops rather than
    // assuming one keystroke per call.
    for (;;) {
      const newline = this.outbound.search(/[\r\n]/);
      if (newline === -1) break;
      const command = this.outbound.slice(0, newline).trim();
      this.outbound = this.outbound.slice(newline + 1).replace(/^\n/, '');
      committed = true;
      /*
       * While the stat screen has the keyboard a committed line is a field's
       * contents, not a command: nothing here is a step, a re-read or a word
       * the classifier should pair an echo with. Ten bare Enters walking that
       * form to SAVE were each filed as a re-read of the room, and each was
       * reported unanswered eight seconds later — nine notices about nothing
       * (live, 2026-09-12, todo 10). The hold is the one fact that says so.
       */
      if (this.queue.holding !== null) {
        // Nothing to observe; the bytes still go out below.
      } else if (command.length > 0) {
        /*
         * The tracker is the one thing here that knows the command table, the
         * walker's hint and this room's own text exits, so it is what says
         * whether this was a step — `go manhole` is a move and `gossip` is
         * not, and neither is decidable from the word.
         */
        this.tracker.observeCommand(command);
        this.login.observeCommand(command);
        this.classifier.observeCommand(command);
        /*
         * The earliest moment the client can know the command prompt is about
         * to go away, and it is a whole round trip earlier than the screen
         * itself. That margin is the point: the server answers `train stats`
         * with no prompt at all, so the acknowledgement window the queue paces
         * on is already open and the next drain would send into the form.
         *
         * Armed off what the player *typed*, so it is armed before the bytes
         * this call is about reach the socket. A `train stats` the realm
         * refuses (not at a trainer, wrong case) is answered with a prompt,
         * which releases it — so being wrong here costs one round trip of
         * automation and says so.
         */
        if (opensStatScreen(command)) this.holdForStatScreen(t('session.stats.asked'));
        this.noteSent(command, 'user');
        this.megaBehindTyped(() => this.mega?.typed(command));
        this.noteQuestSaid(command);
      } else {
        // The player pressing Return on an empty line reprints the room just
        // as the walker's nudge does, and the block it produces has to be
        // attributed to it for the same reason. Same gate, same door.
        this.tracker.observeReread();
        this.megaBehindTyped(() => this.mega?.playerSent());
      }
      this.sink.command?.(this.reportable(command), 'user');
    }

    // A line this long is not a command; drop it rather than growing forever.
    if (this.outbound.length > tuning().session.outboundLineLimit) this.outbound = '';

    /*
     * The player's bytes go on the wire **before** the queue hears about
     * them. `noteTyping(false)` releases held commands synchronously, and
     * with this line below it the released command reached the socket ahead
     * of the very Enter that released it — the server read `dance` + the
     * automated attack as one line and said `dancepu thin carrion beast` out
     * loud in the room (captured live, 2026-08-26, 14:22 session). Writes on
     * one socket keep their order, so sending the keystroke first is the
     * whole fix.
     */
    this.client.send(outgoing);

    // A line typed at a closed socket went nowhere, so nothing is owed for it.
    if (committed && this.client.connected) this.link.noteSent();
    /*
     * A half-typed line stands automation down; a committed or erased one
     * hands the floor straight back. State, not a timer — the grace this
     * replaces released mid-word whenever the player paused, which is how an
     * automated `pu thin kobold thief` landed inside a half-typed `l` and the
     * server said `lpu thin kobold thief` out loud in the room.
     */
    this.queue.noteTyping(this.outbound.length > 0);
    // And the server holds its answers behind that line, so no claim ages.
    this.tracker.noteTyping(this.outbound.length > 0);
    // The line committed or erased: what the engine wrote meanwhile goes now.
    if (this.outbound.length === 0 && this.megaHeld !== '') this.releaseMega();
  }

  /**
   * A talk-box line that stands for several commands (todo 04), parsed here
   * again rather than trusted off the wire. Each goes into the queue at the
   * player's own band and out through `send` when its turn comes, one prompt
   * at a time: written at once, fifteen commands fill the realm's queue and
   * the automation behind them is told to slow down (`Intent.typed`).
   */
  sendMacro(line: string): void {
    const steps = parseMacro(line);
    if (steps === null) {
      this.send(`${line}\r`);
      return;
    }
    const count = macroLength(steps);
    const limit = tuning().session.macroCommands;
    if (count > limit) {
      this.sink.notice(t('session.macro.tooMany', { count, limit }));
      return;
    }
    const holding = this.queue.holding;
    if (holding !== null || !this.client.connected) {
      this.sink.notice(
        holding !== null ? t('session.macro.held', { reason: holding }) : t('session.macro.offline')
      );
      return;
    }
    const batch = `macro:${(this.macros += 1)}:`;
    let n = 0;
    for (const step of steps) {
      for (let i = 0; i < step.times; i += 1) {
        n += 1;
        const taken = this.queue.enqueue({
          command: step.command,
          priority: 'user',
          typed: true,
          // Unique per command: a second `s` is a different move.
          coalesceKey: `${batch}${n}`,
          reason: t('session.macro.reason', { line })
        });
        if (!taken) {
          /*
           * The line's own earlier command can close the queue: a `train
           * stats` goes out inside `enqueue` and holds it. What is still
           * waiting of the line goes too; what went out has gone.
           */
          this.queue.cancel((intent) => intent.coalesceKey?.startsWith(batch) === true);
          const reason = this.queue.holding;
          this.sink.notice(
            reason !== null
              ? t('session.macro.restHeld', { command: step.command, reason })
              : t('session.macro.restRefused', { command: step.command })
          );
          this.publishAutomation();
          return;
        }
      }
    }
    this.publishAutomation();
  }

  /**
   * What is still waiting of the talk box's lines, gone and said. The box's
   * own Drop, and a death: the rest of a path walked from a temple is a walk
   * nobody asked for.
   */
  dropTyped(died = false): void {
    const count = this.queue.cancel((intent) => intent.typed === true);
    if (count === 0) return;
    // The box's count is read off the snapshot, and nothing else may move soon.
    this.publishAutomation();
    if (died) {
      this.sink.notice(
        count === 1
          ? t('session.macro.droppedDied.one', { count })
          : t('session.macro.droppedDied.many', { count })
      );
    } else {
      this.sink.notice(
        count === 1
          ? t('session.macro.dropped.one', { count })
          : t('session.macro.dropped.many', { count })
      );
    }
  }

  resize(size: TerminalSize): void {
    this.lastSize = size;
    this.client.resize(size);
  }

  /**
   * Watches the one phase change that means a character has gone.
   *
   * `in-game` to anything else, on a connection that is still up, is the menu:
   * `quit` from inside the realm, and the prompt that follows it. It is the
   * transition rather than the state because a menu is also where a session
   * *starts*, and standing every module down through a login would be a
   * client that turned itself off on the way in.
   *
   * The socket closing is not this. It publishes outside the block path
   * (`client.on('close')`), tears its own half down, and `connect` resets
   * everything before the next session — which is also what re-arms this,
   * so a reconnect's own `authenticating` is not read as somebody leaving.
   */
  private noteRealmPhase(state: CharacterState): void {
    const was = this.phaseWas;
    this.phaseWas = state.phase;
    if (was === 'in-game' && state.phase !== 'in-game') this.leftTheRealm();
    this.noteRealmWord(state);
  }

  /**
   * The realm has said which data it runs, and whether this session is
   * walking it.
   *
   * `CharacterState.realm` is the menu prompt's own word, and it is the one
   * place the wire says which of the two bundled worlds this is
   * (`shared/worlds.ts`). Told to the sink once per connection so the address
   * is remembered; and compared with the world this session was built on,
   * because that was chosen before anything was dialled. A disagreement is
   * said once and not resolved here — the world is bound for the session's
   * life — so the sentence says what to do about it. A player's own database
   * names no bundled world and is theirs: nothing is said about it.
   */
  private noteRealmWord(state: CharacterState): void {
    if (state.realm === null || state.realm === this.realmTold) return;
    this.realmTold = state.realm;
    this.sink.realmTold?.(state.realm);
    const wanted = worldOfRealm(state.realm);
    const loaded = this.world?.info.world ?? null;
    if (wanted === null || loaded === null || wanted === loaded) return;
    this.sink.notice(
      t('session.realm.worldDisagrees', {
        realm: SHIPPED_WORLD_LABEL[wanted],
        world: SHIPPED_WORLD_LABEL[loaded]
      })
    );
  }

  /**
   * The character walked out to the menu, so everything about it is put down.
   *
   * `CharacterTracker.forgetCharacter` forgets the *facts*; this forgets the
   * *decisions taken from them*, and the two have to happen together. The half
   * that was missing was the third one: `Routines` had already fired its
   * realm-entry probe for this connection and would not fire it again, so a
   * character rerolled at the menu and walked back in kept the old one's name
   * on every card — with `st` and `i`, the two commands that would have
   * corrected it, sitting in the entry probe and never sent (2026-08-31).
   *
   * The queue is cleared for the reason the socket-close path clears it:
   * intents raised for a character standing in the realm must not be sent into
   * a menu, or into whoever logs in next.
   *
   * `LoginAutomator` is deliberately **not** reset. It stands down on
   * `user-exits-realm` on purpose, and re-arming it here would answer the
   * character-selection menu with the credentials of a login already made.
   */
  private leftTheRealm(): void {
    this.sink.notice(t('session.realm.left'));
    this.dropTyped();
    this.queue.clear();
    // A journey owed across a loss is owed to a character standing in the
    // realm; one who walked out to the menu has ended it. So is a route a
    // supply errand is shopping on behalf of, and the choice to cross it.
    this.journey = null;

    // A refusal arriving before the new session's first prompt is nobody's.
    this.answering = null;
    this.askedAbilities = false;
    this.wards.reset();
    this.hunt.reset();
    this.itemErrand.reset();
    this.afterFetch = null;
    this.questRunner.reset();
    this.keys.reset();
    this.pvpSaid.clear();
    /*
     * An edge the realm refused was refused for *this* character — a door it
     * could not open, an exit its class may not use — so the blacklist goes
     * with it rather than costing the next character corridors it can walk.
     */
    this.refusedEdges.clear();
    this.shutEdges.clear();
    this.realmMismatchSaid = false;
    /*
     * The traces stay. They are the record of what was decided just before the
     * character left, and leaving the realm is very often what a player does
     * straight after the thing they want to read about.
     */
    this.publishAutomation();
  }

  /** Applies a config reload to the arbiter and the standing routines. */
  /**
   * Tells the terminal feed a command went out — only in the realm.
   *
   * The feed keeps a FIFO of sent commands and pops one per status line, and
   * that arithmetic only holds where every command gets a status line. A
   * login answer does not: the username, the password and the menu picks go
   * out through the same queue before any prompt exists, and with them in the
   * FIFO the first quiet command never reached its head — captured by the
   * smoke run, whose fake host answered `rm` and watched the console show it.
   */
  private noteSent(command: string, from: 'user' | 'automation'): void {
    if (this.tracker.current.phase !== 'in-game') return;
    this.feed.sent(command, from);
  }

  /**
   * A probe asked for from a card: on the engine's pending list, as the
   * actions kept beside it are (`keptQueue`), and not `send`, deliberately —
   * that is what makes it an automation command, sent when MegaMUD's
   * scheduler may, and quiet in the console when `internal.yaml` names it.
   *
   * It went to our own queue, which refuses everything but the player's own
   * while the engine runs the character (`configure`), so every card's press
   * was dropped unsaid (2026-10-16).
   */
  ask(command: string): boolean {
    return this.keptQueue.enqueue({
      command,
      priority: 'probe',
      coalesceKey: `ask:${command}`,
      reason: t('session.probe.askedFromCard')
    });
  }

  /**
   * The console's `Deposit All`, pressed: MegaMUD's own (`0x4bc190`), the
   * wealth over what it keeps deposited (2026-10-14).
   */
  depositAll(): boolean {
    if (this.mega === null) return false;
    this.mega.depositAll();
    return true;
  }

  /**
   * Asks another player's client something, on this character's behalf: a
   * telepath with the remote command, on the engine's pending list. Only in
   * the realm: a telepath typed at a menu is a menu answer.
   */
  askRemote(who: string, name: RemoteName): boolean {
    if (this.tracker.current.phase !== 'in-game') return false;
    // A repeat of a question still waiting is coalesced into it, and said so.
    return this.keptQueue.enqueue({
      command: `/${who} @${name}`,
      priority: 'user',
      coalesceKey: `remote:${name}:${playerKey(who)}`,
      reason: t('automation.remotes.reasonAsking', { who, body: `@${name}` })
    });
  }

  /** The client's own settings — which of its commands are quiet. Hot-reloaded. */
  /** The realm's mudstats board, this character's key, and whether and how often it posts. */
  configureStats(target: StatsTarget, report: StatsReportConfig): void {
    this.stats.configure(target, report);
  }

  /** Links this character to its realm's board, keeping the key with `keep`. What happened. */
  statsLink(keep: KeepKey): Promise<string> {
    return this.stats.link(keep);
  }

  /** Retires this character's key at the board and forgets it. What happened. */
  statsUnlink(keep: KeepKey): Promise<string> {
    return this.stats.unlink(keep);
  }

  /** What the board says of this character's key. */
  statsStatus(): Promise<string> {
    return this.stats.status();
  }

  configureInternal(internal: InternalConfig): void {
    this.internal = internal;
  }

  /**
   * What this session is told about its realm beyond the options: the tables
   * imported for it and what it calls its coins. Hot-reloaded, and separate
   * from `configure` because it is the realm's rather than the character's —
   * it arrives from the realm's own files. One door, because the three always
   * arrive together.
   */
  configureRealm(realm: RealmData): void {
    this.useCoins(realm.coins);
    this.useMonsters(realm.monsters);
    this.realmItems = realm.items;
    this.mega?.useItems(this.megaItems());
  }

  /**
   * The realm's monster table (`servers/<id>/monsters.yaml`), laid under the
   * character's own `combat.monsters`. Only the two modules handed the combat
   * settings are told again; everything else reads `automationConfig` when it
   * decides.
   */
  private useMonsters(rows: readonly MonsterRule[]): void {
    this.realmMonsters = rows;
    const automation = {
      ...this.automationConfig,
      combat: withRealmMonsters(this.statedCombat, rows)
    };
    this.automationConfig = automation;
    this.mega?.useMonsters(automation.combat.monsters);
  }

  /** Nobody waiting any more: a new realm, or a loop reset. */
  private forgetFollowers(): void {
    this.waitingFollowers.clear();
    this.hurtFollowers.clear();
    this.clearFollowerWaitLimit();
  }

  /** The give-up clock on a `@wait` — MegaMUD's *If Leading Wait No Longer Than*. */
  private followerWaitTimer: NodeJS.Timeout | null = null;

  private clearFollowerWaitLimit(): void {
    if (this.followerWaitTimer === null) return;
    clearTimeout(this.followerWaitTimer);
    this.followerWaitTimer = null;
  }

  /**
   * What this realm calls its coins (`server.yaml` `coins:`): read as the
   * stock names on the way in, and asked for by the realm's word on the way
   * out. See `CoinReader`.
   */
  private useCoins(names: CoinNames): void {
    const reader = coinReader(names);
    this.classifier.useCoins(reader);
  }

  /**
   * The ported MegaMUD engine, for a character with a `megamud.ini`: while
   * it runs, the automation below stands down (see `MegaEngine`).
   */
  private mega: MegaEngine | null = null;
  /** The last `configure`, applied again when the engine comes or goes. */
  private configured: Parameters<SessionManager['configure']> | null = null;
  /** What the engine has written since its last return, for the tracker. */
  private megaLine = '';
  /** The question MegaMUD is waiting on the player for, if any. See `megaAsk`. */
  private megaQuestion: string | null = null;
  /** The question the player said yes to, for the engine to be told when it asks again. */
  private megaAgreed: string | null = null;
  /** The player's last action on the engine, run again after a yes. */
  private megaRetry: (() => unknown) | null = null;
  /**
   * What the engine wrote while the player had a line half typed, held back
   * from the socket: the realm would glue it onto that line (an Enter of the
   * engine's sending the half of `gossip hel` typed so far). Sent when the
   * line is committed or erased, or once it has been left `abandonedLineMs`,
   * as the old queue's typing hold did.
   */
  private megaHeld = '';
  private megaHeldTimer: NodeJS.Timeout | null = null;
  /** When the half-typed line on the wire was begun; 0 with none. */
  private typingSince = 0;
  /** When the engine was last asked for a stat sheet for our tracker, and the ask held back. */
  private megaSheetAt: number | null = null;
  private megaSheetTimer: NodeJS.Timeout | null = null;
  /** The engine's loop run's start, and the experience the character had then. */
  private megaLoopRun: { startedAt: number | null; exp: number | null } = {
    startedAt: null,
    exp: null
  };
  /**
   * Loops handed to the engine that are filed nowhere — a hunt's, sized to
   * the lair it chose (`huntLoop`) — by name, for its `loopRooms` to find.
   */
  private readonly megaLoops = new Map<string, Loop>();
  /**
   * Where the actions kept beside the engine propose their commands (a ward,
   * a key off the floor): the engine's pending list for a character it runs,
   * which its scheduler sends when it may and which holds its walk. Sent is
   * taken as said when it is put on the list.
   */
  private readonly keptQueue: Pick<CommandQueue, 'enqueue' | 'cancel' | 'queued'> = {
    enqueue: (intent) => {
      if (this.mega === null) return false;
      // MegaMUD's list takes a command once (`0x48ab80`): a repeat is not sent.
      if (this.mega.pendingHas(intent.command)) return false;
      this.megaQueued.push(intent);
      this.mega.queue(intent.command, () => {
        this.megaQueued = this.megaQueued.filter((each) => each !== intent);
        intent.onSent?.();
      });
      return true;
    },
    cancel: (match) => {
      if (this.mega === null) return 0;
      const gone = this.megaQueued.filter(match);
      for (const intent of gone) this.mega.unqueue(intent.command);
      this.megaQueued = this.megaQueued.filter((intent) => !gone.includes(intent));
      return gone.length;
    },
    queued: (match) => {
      const mega = this.mega;
      if (mega === null) return false;
      this.megaQueued = this.megaQueued.filter((intent) => mega.pendingHas(intent.command));
      return this.megaQueued.some(match);
    }
  };
  /** What the actions kept beside the engine have on its pending list, unsent. */
  private megaQueued: Intent[] = [];
  /**
   * An errand's purchase on the engine (an item errand's counter, a quest
   * plan's): the walk to the counter, then a `buy` at a time until the pack
   * holds the row's minimum. MegaMUD buys only on a loop's start detour
   * (`0x406f20`), so this is ours, and its replies are MegaMUD's to read
   * (`0x453a70`). Null with none.
   */
  private megaBuying: {
    row: SupplyItem;
    room: RoomId;
    shop: string;
    /** Walking there, or at the counter. */
    at: boolean;
    /** When the last `buy` went out, and what was carried then; null before one. */
    asked: { at: number; had: number } | null;
  } | null = null;
  /** The engine's walk as last published, to tell a walk ending (`megaWalkEnded`). */
  private megaWalkWas: WalkProgress['status'] = 'idle';
  /** Whether a loop or a walk was going as last published, to tell one stopping in the game. */
  private megaMovingWas = false;
  /**
   * What this character is walking, kept where it outlives the session
   * (`MovementBook`) and taken up again when it is next in the game
   * (2026-10-14). Nothing kept in a test.
   */
  private resumable: {
    kept: ResumableMovement | null;
    keep(movement: ResumableMovement | null): void;
  } = { kept: null, keep: () => undefined };

  /**
   * The engine's own walk (its Go To, not a lap's leg) came to an end: told
   * to what walked for itself, as the walker's `ended` tells them, so a hunt
   * that walked to its lair starts the lap there (2026-10-14).
   */
  private megaWalkEnded(walk: WalkProgress): void {
    const arrived = walk.status === 'arrived';
    const reason = arrived ? null : walk.reason;
    const buying = this.megaBuying;
    if (buying !== null && !buying.at) {
      if (arrived && roomAddress(this.tracker.current.room) === buying.room) buying.at = true;
      else this.megaBuyGiveUp(reason ?? t('automation.hunt.whyStopped'));
    }
    this.hunt.onWalkEnded(arrived, reason, this.tracker.current);
    this.questRunner.onWalkEnded(arrived, reason, this.tracker.current);
  }

  /** An errand's purchase handed to the engine: walked to the counter, then bought. */
  private megaBuy(row: SupplyItem): string | null {
    if (this.mega === null) return t('session.megamud.noEngine');
    if (this.megaBuying !== null) return t('automation.collect.refusalBusy');
    const place = this.shopRoom(row);
    if (typeof place === 'string') return place;
    const here = roomAddress(this.tracker.current.room) === place.room;
    if (!here) {
      const refused = this.mega.walkTo(place.room, false, true);
      if (refused !== null) return refused;
    }
    this.megaBuying = { row, room: place.room, shop: place.name, at: here, asked: null };
    this.megaBuyTick(this.tracker.current);
    return null;
  }

  /**
   * At the counter, a `buy` at a time until the pack holds the minimum; one
   * that `tuning.supplies.buyTimeoutMs` after it went out added nothing to the
   * pack is taken as refused, and the purchase given up.
   */
  private megaBuyTick(state: CharacterState): void {
    const buying = this.megaBuying;
    if (buying === null || !buying.at || this.mega === null) return;
    const have = carriedCount(state, buying.row.name);
    if (have >= Math.max(1, buying.row.min)) {
      this.megaBuying = null;
      return;
    }
    const command = `buy ${buying.row.name}`;
    if (this.mega.pendingHas(command)) return;
    const asked = buying.asked;
    if (asked !== null) {
      if (have > asked.had) buying.asked = null;
      else if (Date.now() - asked.at < tuning().supplies.buyTimeoutMs) return;
      else {
        this.megaBuyGiveUp(t('automation.collect.whyNotSold', { shop: buying.shop }));
        return;
      }
    }
    if (buying.asked === null) {
      buying.asked = { at: Number.POSITIVE_INFINITY, had: have };
      this.mega.queue(command, () => {
        if (this.megaBuying === buying && buying.asked !== null) buying.asked.at = Date.now();
      });
    }
  }

  private megaBuyGiveUp(why: string): void {
    const buying = this.megaBuying;
    if (buying === null) return;
    this.megaBuying = null;
    this.sink.notice(
      t('automation.collect.megaNotBought', { item: buying.row.name, shop: buying.shop, why })
    );
  }

  /** The lap a quest run stood down, by name, to take up again when it lets go. See `megaHold`. */
  private megaHeldLap: string | null = null;

  /**
   * A quest run holds the lap: the engine's stopped, and taken up again by
   * name at the release. By name, because the run's own legs are walked
   * alone and let the stopped loop go (`MegaEngine.walkTo`).
   */
  private megaHold(): void {
    const running = this.runningLoopName();
    if (this.mega === null || running === null) return;
    this.mega.button(WindowCommand.GoStop);
    this.megaHeldLap = running;
  }

  private megaRelease(): void {
    const held = this.megaHeldLap;
    this.megaHeldLap = null;
    if (this.mega === null || held === null || this.mega.walking) return;
    const refused = this.mega.startLoop(held);
    if (refused !== null) this.sink.notice(refused);
  }

  /** The engine's lap running, by name; null with none. */
  private runningLoopName(): string | null {
    const loop = this.mega?.progress.loop;
    return loop?.status === 'running' ? (loop.name ?? null) : null;
  }

  /**
   * A walk that is not the lap's has the character: the engine walks a lap
   * without a break between its legs, so its Go To alone is a walk here.
   */
  private walkingNow(): boolean {
    if (this.mega === null) return false;
    const { walk, loop } = this.mega.progress;
    return walk.status === 'walking' && loop.status !== 'running';
  }

  /** Stops the lap and the walk: the engine's Go/Stop. */
  private stopLapAndWalk(): void {
    if (this.mega?.walking === true) this.mega.button(WindowCommand.GoStop);
  }

  /** A route walked by the engine, as its Go To to the room it ends in, and only that. */
  private megaWalk(route: Route): string | null {
    const end = route.steps.at(-1)?.to;
    if (this.mega === null || end === undefined) return null;
    return this.mega.walkTo(end, false, true);
  }

  /**
   * The engine's walk and loop to the cards, the map and the palette, in
   * place of the walker's and loop runner's: the experience at the run's
   * start is ours to know, read off the tracker as `LoopRunner` reads it.
   */
  private megaProgressed(walk: WalkProgress, loop: LoopProgress): void {
    if (loop.startedAt !== this.megaLoopRun.startedAt) {
      this.megaLoopRun = {
        startedAt: loop.startedAt,
        exp: loop.startedAt === null ? null : this.tracker.current.progress.exp
      };
    }
    this.sink.walk?.(walk);
    this.sink.loop?.({ ...loop, expAtStart: this.megaLoopRun.exp });
    const was = this.megaWalkWas;
    this.megaWalkWas = walk.status;
    if (was === 'walking' && walk.status !== 'walking' && loop.status !== 'running') {
      this.megaWalkEnded(walk);
    }
    const moving = walk.status === 'walking' || loop.status === 'running';
    const movingWas = this.megaMovingWas;
    this.megaMovingWas = moving;
    if (loop.status === 'running' && loop.name !== null) this.keepMovement({ loop: loop.name });
    /*
     * Stopped in the game: a Stop, an arrival, a death; it is over. Stopped
     * out of it is a Disconnect, a hang-up or a dropped line (MegaMUD leaves
     * the game first, `0x42de00`), and is taken up again on the way back in.
     */
    else if (movingWas && !moving && this.mega?.inGame === true) this.keepMovement(null);
  }

  /** What this character is walking, kept for when it is next in the game. */
  private keepMovement(movement: ResumableMovement | null): void {
    if (JSON.stringify(this.resumable.kept) === JSON.stringify(movement)) return;
    this.resumable.kept = movement;
    this.resumable.keep(movement);
  }

  /** Where what this character is walking is kept: what it was walking, and where to write. */
  useMovementBook(
    kept: ResumableMovement | null,
    keep: (m: ResumableMovement | null) => void
  ): void {
    this.resumable = { kept, keep };
  }

  /**
   * In the game again: the loop or the route that was going when the session
   * went away taken up again, unless MegaMUD's own `On entry` started
   * something or All Off is on. A loop no longer filed anywhere (a hunt's,
   * whose hunt surveys afresh) is let go.
   */
  private megaEnteredGame(): void {
    const kept = this.resumable.kept;
    const mega = this.mega;
    if (kept === null || mega === null || mega.walking || mega.toggles.on.allOff) return;
    if ('loop' in kept) {
      const loop = this.loopNamed(kept.loop) ?? this.megaLoops.get(kept.loop);
      if (loop === undefined) {
        this.sink.notice(t('session.move.resumeGone', { loopName: kept.loop }));
        this.keepMovement(null);
        return;
      }
      const answer = this.startLoop(loop);
      this.sink.notice(
        'refused' in answer
          ? t('session.move.resumeRefused', { reason: answer.refused })
          : t('session.move.resumingLoop', { loopName: kept.loop })
      );
      return;
    }
    // Alone, as the route was first walked (`walkRoute`).
    const refused = this.megaAct(() => mega.walkTo(kept.to, kept.run, true));
    this.sink.notice(
      refused === null
        ? t('session.move.resumingWalk', {
            destination: this.world?.byId(kept.to)?.name ?? kept.to
          })
        : t('session.move.resumeRefused', { reason: refused })
    );
  }

  /**
   * The tracker wants a stat sheet to settle a buff's ending, and with the
   * routines standing down for the engine it is the engine's to send: its
   * own wish for one (`statDue`), sent when its scheduler next may, out of a
   * fight. The bless bridge (`MegaEngine.buffs`) reads what the sheet says.
   * At most once per `tuning.spells.sheetAskMs`, as `Routines.askSheet`.
   */
  private megaAskSheet(): void {
    const floor = tuning().spells.sheetAskMs;
    const now = Date.now();
    if (this.megaSheetAt !== null && now - this.megaSheetAt < floor) {
      this.megaSheetTimer ??= setTimeout(
        () => {
          this.megaSheetTimer = null;
          this.megaAskSheet();
        },
        floor - (now - this.megaSheetAt)
      );
      this.megaSheetTimer.unref?.();
      return;
    }
    this.megaSheetAt = now;
    this.mega?.wantStat();
  }

  /**
   * The flee toggle for the engine: on, and on a realm that answers
   * `sys status`, so `sys goto` is a command it knows (`considerEscape`'s gate).
   */
  private megaFlee(): FleeGoto | null {
    const flee = this.automationConfig.safety.fleeGoto;
    if (!flee.enabled || this.locateMethod !== 'sys-status') return null;
    return { belowHealth: flee.belowHealth, destination: flee.destination };
  }

  /** Runs the MegaMUD engine for this character, or stops it (null). */
  useMegaMud(setup: MegaEngineSetup | null): void {
    if (this.mega !== null && setup !== null) {
      this.mega.reload(setup);
      return;
    }
    const learned = this.mega?.learned;
    const had = this.mega !== null;
    this.mega?.dispose();
    this.mega = null;
    // Nothing walking any more, for the cards.
    if (had && setup === null) {
      this.sink.walk?.(IDLE_WALK);
      this.sink.loop?.(NO_LOOP);
    }
    this.megaLine = '';
    this.megaHeld = '';
    this.megaQuestion = null;
    this.megaAgreed = null;
    this.megaRetry = null;
    if (setup !== null) {
      this.mega = new MegaEngine(
        {
          write: (text) => this.megaWrite(text),
          show: (text) => this.megaShow(text),
          hangUp: () => this.disconnect('client'),
          dial: () => {
            const target = this.current.target;
            if (target === null || this.client.connected) return;
            if (this.sink.redial) this.sink.redial(target);
            else void this.connect(target);
          },
          redialChanged: () => {
            const seconds = this.mega?.redialIn ?? 0;
            if (this.mega?.redialing === true) {
              this.sink.notice(t('session.megamud.redialing', { seconds }));
            }
            this.sink.retrying?.();
          },
          here: () => roomAddress(this.tracker.current.room),
          // The ward the room ahead wants, before the engine's step into it.
          beforeStep: (to) => this.wards.beforeStep(to, this.tracker.current),
          locate: () => this.megaLocate(),
          toggled: () => this.publishAutomation(),
          progressed: (walk, loop) => this.megaProgressed(walk, loop),
          // After the engine's own handling of the prompt, not inside it.
          enteredGame: () => queueMicrotask(() => this.megaEnteredGame()),
          ask: (text) => this.megaAsk(text),
          // Where MegaMUD would play the sound its `[Alerts]` names.
          alert: (which) => this.sink.notice(megaAlertText(which)),
          world: () => this.world,
          // With the way a refusal for a key would take once it is carried,
          // which the engine fetches (`fetchFirst`).
          plan: (from, to) =>
            this.world
              ? planRoute(this.world, from, to, this.lapTraveller(this.tracker.current), {
                  unlocks: true
                })
              : t('session.loop.noRealmData'),
          fetchFirst: (items, then) => this.megaFetchFirst(items, then),
          opensAWay: (name) => this.opensAWay(name),
          loopRooms: (name) => {
            const loop = this.loopNamed(name) ?? this.megaLoops.get(name);
            if (loop === undefined) return t('session.move.noSuchLoop', { name });
            const rooms: RoomId[] = [];
            for (const stop of loop.stops) {
              const found = this.findStop(splitStop(stop));
              if (typeof found === 'string') return found;
              rooms.push(roomId(found.map, found.room));
            }
            return { rooms, bounce: loop.bounce === true };
          }
        },
        { ...setup, learned: setup.learned ?? learned }
      );
      this.mega.useMonsters(this.automationConfig.combat.monsters);
      this.mega.useItems(this.megaItems());
      this.mega.useFlee(this.megaFlee());
      if (this.client.connected) this.mega.connected();
    }
    if (this.configured !== null) this.configure(...this.configured);
  }

  /**
   * The engine is waiting out `Comms.RedialPause` (or `CleanupPeriod`) to
   * dial back: for the rail, as `Reconnect.pending` is for ours.
   */
  get megaRedialing(): boolean {
    return this.mega?.redialing ?? false;
  }

  /** Stop trying: the engine's redial called off, as Disconnect calls ours off. */
  stopRedial(): void {
    this.mega?.cancelRedial();
  }

  /** The realm's item table with this character's own rows laid over it, field by field. */
  private megaItems(): ItemRule[] {
    return mergeItemRules(this.realmItems, this.automationConfig.loot.itemDetails);
  }

  /** Whether the MegaMUD engine runs this character. */
  get megaMud(): boolean {
    return this.mega !== null;
  }

  /**
   * The realm's locate command for the MegaMUD engine's character, straight
   * to the socket: the queue it would otherwise go through stands down with
   * the automation the engine replaces.
   */
  private megaLocate(): boolean {
    const word = this.locateWord;
    if (word === null || !this.client.connected) return false;
    this.megaWrite(`${word}\r`);
    return true;
  }

  /**
   * The engine reading a line the player committed, whose Enter is not on the
   * wire yet: the realm still holds the typed text, so what the engine writes
   * meanwhile waits behind it. A typed `u` read as a step sent the post-rest
   * `eq firestone pendant` first, and the realm said `ueq firestone pendant`
   * out loud (Fatty, 2026-10-16).
   */
  private megaBehindTyped(read: () => void): void {
    this.megaReadingTyped = true;
    try {
      read();
    } finally {
      this.megaReadingTyped = false;
    }
  }

  private megaReadingTyped = false;

  /** The engine's writes, observed as automation's commands are. */
  private megaWrite(text: string): void {
    const abandonedAt = this.typingSince + tuning().queue.abandonedLineMs;
    if (this.megaReadingTyped || (this.outbound.length > 0 && Date.now() < abandonedAt)) {
      this.megaHeld += text;
      this.megaHeldTimer ??= setTimeout(
        () => this.releaseMega(),
        Math.max(0, abandonedAt - Date.now())
      );
      return;
    }
    this.megaLine += text;
    for (;;) {
      const end = this.megaLine.indexOf('\r');
      if (end === -1) break;
      const command = this.megaLine.slice(0, end).trim();
      this.megaLine = this.megaLine.slice(end + 1);
      if (command.length > 0) {
        this.tracker.observeCommand(command);
        this.classifier.observeCommand(command);
        this.sink.command?.(this.reportable(command), 'automation');
        this.noteSent(command, 'automation');
      } else {
        this.tracker.observeReread();
      }
      this.link.noteSent();
    }
    this.client.send(text);
  }

  /** The engine's writes held behind a half-typed line, sent now. */
  private releaseMega(): void {
    if (this.megaHeldTimer !== null) clearTimeout(this.megaHeldTimer);
    this.megaHeldTimer = null;
    const held = this.megaHeld;
    this.megaHeld = '';
    if (held !== '' && this.client.connected) this.megaWrite(held);
  }

  /** One of MegaMUD's own lines, on the console. */
  private megaShow(text: string): void {
    this.seq += 1;
    this.sink.data({ seq: this.seq, at: Date.now(), text: `\r\n\x1b[36m${text}\x1b[0m\r\n` });
  }

  configure(
    stated: AutomationConfig,
    login: LoginConfig,
    rewrites: RewritesUiConfig = DEFAULT_CONFIG.ui.rewrites,
    locate: LocateMethod = DEFAULT_CONFIG.connection.locate
  ): void {
    this.configured = [stated, login, rewrites, locate];
    /*
     * The actions kept beside the engine (`docs/megamud/engine-port.md`,
     * *Kept, outside the loop*) answer to the file's own switch rather than
     * to the standing down below: a hunt hands the engine a loop as a player
     * does (2026-10-14).
     */
    const kept = stated.enabled;
    // The MegaMUD engine decides for itself: nothing here acts beside it.
    if (this.mega !== null) {
      stated = { ...stated, enabled: false, remotes: { ...stated.remotes, enabled: false } };
    }
    // The realm's monster table under the character's own rows: every module
    // below is handed what this character actually does about each monster.
    this.statedCombat = stated.combat;
    const automation = {
      ...stated,
      combat: withRealmMonsters(stated.combat, this.realmMonsters)
    };
    this.automationConfig = automation;
    this.mega?.useMonsters(automation.combat.monsters);
    this.mega?.useItems(this.megaItems());
    this.locateMethod = locate;
    this.mega?.useFlee(this.megaFlee());
    this.rewriter.configure(rewrites);
    // A new design gets to be refused once, out loud, if it is too wide. By
    // value: every reload resolves a fresh object for an unchanged file.
    const template = this.rewriter.promptDesign()?.template ?? null;
    if (template !== this.promptTemplate) this.designTooWideSaid = false;
    this.promptTemplate = template;
    // The loops may have changed, and with them the routes this character
    // prefers; derived again the next time a route is planned.
    this.preferred = null;
    this.queue.configure(automation);
    this.wards.configure(automation.health, kept);
    this.questRunner.configure(automation.quests, kept);
    this.hunt.configure(automation.hunting, automation.walk, automation.health, kept);
    this.keys.configure(automation.movement, kept);
    this.login.configure(login);
    this.secret = login.password;
  }

  /**
   * The realm said a word out loud, so it does not have it.
   *
   * `You say "<command>"` is this server family's answer to a word its
   * dispatch table has no entry for — speech in the room, seen by everybody
   * standing there — so the fact is worth keeping and worth acting on. It
   * used to be kept for `rm` alone; every other word the realm spoke was
   * asked again on the next tick and said again, out loud, all evening.
   *
   * **Only words the realm's own table names.** `commandOf` is the filter,
   * and it is the whole discrimination: a word the table does not have is
   * either a text exit (`go manhole`, which is room data and is *supposed* to
   * be absent from every command table) or the player's typo, and neither is
   * a fact about this realm's vocabulary. Retiring `go manhole` would take a
   * real way through the realm away from every room that has one.
   *
   * Said once per command and never per ask, because the refusal is a decision
   * somebody who turned a feature on needs to be able to read — and a line per
   * probe is the console talking over the room.
   */
  private noteWordMissing(spoken: string | undefined): void {
    const name = commandOf(spoken ?? '');
    if (name === null || this.unavailable.has(name)) return;
    /*
     * **Nor an attack verb the realm has already answered.** This family
     * speaks an attack on a monster that is not there exactly as it speaks a
     * word it lacks, and one such line — an attack that reached the server a
     * moment after its goblin died — retired `a` for the connection and ended
     * combat for good (healbot, 2026-09-22). A verb `*Combat Engaged*` has
     * answered exists; the tracker reads the sentence as the name being gone.
     */
    if (ATTACK_COMMANDS.has(name) && this.tracker.hasEngagedWith(name)) return;
    this.unavailable.add(name);
    // `rm` refused is an ordered answer all the same: what was sent before it
    // is not coming (todo 10).
    if (name === 'Room') {
      for (const lost of this.tracker.locateRefused()) {
        this.sink.notice(t('session.walk.claimSettledByLocate', { command: lost.command }));
      }
    }
    this.sayUnavailable(name, spoken ?? name);
  }

  /**
   * `Your command had no effect.` — the MajorMUD lineage's answer to a word it
   * does not have.
   *
   * Measured on `bbs.bearfather.net` 2026-09-05 (majorMUD v1.11p-WG3NT): `rm`
   * at the prompt, that sentence back, privately, twice. It is **not** what
   * docs/game-behaviour.md said MajorMUD does — that document read
   * GreaterMUD's `You say "<command>"` onto the other lineage, and a reading is
   * not a capture. So the whole learned half of `unavailable` was keyed on a
   * sentence the realm this client most needs it for never sends.
   *
   * **Only a `GREATERMUD_ONLY` word, and that limit is the point.** The same
   * sentence answers a word the realm *does* have that did nothing — `med` for
   * a class with no mana, which `Recovery.noteNoEffect` exists for — so it
   * cannot retire an arbitrary command the way `command-not-understood` can.
   * For a command whose absence is what separates the two lineages it is
   * decisive; for anything else it says only that this attempt did nothing.
   *
   * The sentence names nothing, so the command is the status line's own echo
   * (`answering`), which is the slot `Recovery` already reads for exactly this.
   */
  private noteNoEffectMissing(spoken: string | null): void {
    const name = commandOf(spoken ?? '');
    if (name === null || !GREATERMUD_ONLY.has(name)) return;
    if (this.unavailable.has(name)) return;
    this.unavailable.add(name);
    // `rm` refused is an ordered answer all the same: what was sent before it
    // is not coming (todo 10).
    if (name === 'Room') {
      for (const lost of this.tracker.locateRefused()) {
        this.sink.notice(t('session.walk.claimSettledByLocate', { command: lost.command }));
      }
    }
    this.sayUnavailable(name, spoken ?? name);
  }

  /**
   * Whether automation may not send this command here — `CommandQueue`'s
   * `unavailable`.
   *
   * Two sources, and the second is the one that saves the broadcast: a word
   * the realm has already spoken aloud, and — once a tell has said this server
   * is MajorMUD — every `GREATERMUD_ONLY` command, refused **before** it is
   * tried. The first try is the broadcast, so a client that has been told
   * which lineage it is talking to must not spend it.
   *
   * A word the realm's table does not name is never refused here. It is a text
   * exit or a typo, and `Walker` and the errand both legitimately send phrases
   * this table has no entry for.
   */
  private wordUnavailable(command: string): boolean {
    const name = commandOf(command);
    if (name === null) return false;
    if (this.unavailable.has(name)) return true;
    if (this.serverFamily !== 'majormud' || !GREATERMUD_ONLY.has(name)) return false;
    this.unavailable.add(name);
    this.sayUnavailable(name, command);
    return true;
  }

  /**
   * Says a word is not available here, once.
   *
   * The locate keeps its own sentence, because it is the one whose absence
   * changes what the client can do rather than merely what it will send: a
   * realm with no `rm` is one where the whole of knowing where the character
   * stands is dead reckoning, and somebody watching a loop needs to be told
   * that rather than left to infer it from a missing command.
   */
  private sayUnavailable(name: CommandName, spoken: string): void {
    if (this.saidUnavailable.has(name)) return;
    this.saidUnavailable.add(name);
    this.sink.notice(
      name === 'Room'
        ? t('session.loop.locateUnavailable', { command: spoken })
        : t('session.realm.commandUnavailable', { command: spoken })
    );
  }

  /**
   * Which lineage this server belongs to, from a block already being read.
   *
   * Free: `exp` and `rm` are both commands the client already sends, and the
   * three tells `familyToldBy` reads are positive statements — *this server
   * has `rm`*, *this server printed a level table* — so nothing is concluded
   * from an absence. See `shared/realm.ts` for why that matters: an `exp`
   * summary with no table yet is not evidence of GreaterMUD, and a fold that
   * counted absences would answer confidently on the first prompt of every
   * session.
   *
   * Said out loud, once, and only when it is **news**: a server whose family
   * matches the realm data's is the ordinary case and needs no sentence. A
   * disagreement does, because it is the shipped configuration today — a
   * Paradigm-built world file is the map for a GreaterMUD default realm — and
   * because everything computed downstream has to pick one of the two. The
   * client does not pick. It says which is which and lets both stand.
   */
  private noteFamily(block: Block, answering: string | null = null): void {
    if (this.serverFamily !== null) return;
    const reading = familyToldBy(block, answering);
    if (reading === null) return;
    this.serverFamily = reading.family;
    // The parser needs it too: the lair's respawn clock is resolved where the
    // room is (`CharacterTracker.attachRealm`). See `CharacterTracker.useFamily`.
    this.tracker.useFamily(reading.family);
    this.fitted = null;
    if (this.familyStated) return;

    const data = this.world?.info.family ?? null;
    const families: RealmFamilies = { data, server: reading.family };
    if (data === null || !familiesDisagree(families)) return;
    this.familyStated = true;
    this.sink.notice(
      t('session.realm.familyDisagrees', {
        server: REALM_FAMILY_LABEL[reading.family],
        data: REALM_FAMILY_LABEL[data],
        source: this.world?.info.source ?? ''
      })
    );
  }

  /**
   * What the realm about to be dialled knows about its players.
   *
   * The host calls this with the *dialled* address before `connect`, because a
   * character can be dialled at a saved realm other than its own and what it
   * learns there is that realm's. The previous realm is unsubscribed first, so
   * a session never absorbs two realms' players at once.
   *
   * What another character on this realm learns about a player — a look, a
   * gang listing — lands here and is republished, so the flyout on this tab
   * says what the realm knows and not what this socket happened to see.
   * Nothing else is told: no rule reads the registry, and a fact absorbed is
   * not a fact this character observed.
   */
  useRealm(players: RealmPlayers, belongings: BelongingsSink = NO_BELONGINGS): void {
    this.forgetPlayers();
    // A different realm may have the words this one refused. See `unavailable`.
    this.unavailable.clear();
    this.saidUnavailable.clear();
    // And a different realm may be a different family. The tells are cheap and
    // arrive again; carrying the last realm's answer forward would not.
    this.serverFamily = null;
    this.fitted = null;
    this.familyStated = false;
    this.tracker.useRealm(players);
    // A vault and a kit are the server's, so they are re-keyed with the roster
    // and not with the character. See `SessionHostOptions.belongingsAt`.
    this.tracker.useBelongings(belongings);
    this.belongings = belongings;
    this.forgetPlayers = players.subscribe((batch) => {
      if (this.tracker.absorbPlayers(batch)) this.publishCharacter();
    });
  }

  dispose(): void {
    this.stats.dispose();
    if (this.megaHeldTimer !== null) clearTimeout(this.megaHeldTimer);
    if (this.megaSheetTimer !== null) clearTimeout(this.megaSheetTimer);
    this.mega?.dispose();
    this.mega = null;
    this.clearFollowerWaitLimit();
    this.cancelIdleFlush();
    this.forgetPlayers();
    this.feed.dispose();
    if (this.automationTimer) clearTimeout(this.automationTimer);
    this.automationTimer = null;
    this.queue.dispose();
    this.link.dispose();
    this.client.disconnect();
    this.client.removeAllListeners();
  }

  /** Restarts the quiet-period timer that releases a trailing prompt. */
  private armIdleFlush(): void {
    this.cancelIdleFlush();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.flushPending();
    }, this.idleFlushDelay());
    // Never the reason a process stays alive.
    this.idleTimer.unref?.();
  }

  /**
   * How long the quiet period is, given what is buffered.
   *
   * A prompt is a line that ends because the server went quiet — but a
   * prompt that has opened its bracket and not closed it has not ended, and
   * the server has not gone quiet, whatever the clock says. The bearfather
   * BBS writes `[HP=40/40,…,S= (Resting)` and then ` ]:` about a tenth of a
   * second later, longer than `IDLE_FLUSH_MS` a quarter of the time, and a
   * flush between the two framed the halves as two lines neither of which
   * read as a status line: the vitals and the resting state on every such
   * prompt were lost. So an opened prompt waits `promptHoldMs` from when it
   * was first seen opening, which is the bound on a prompt the server never
   * finishes, and never less than the ordinary quiet period. A finished
   * prompt is released as it always was.
   *
   * And a tail that is not a prompt at all waits `sentenceHoldMs`, because
   * the quiet period is a prompt's and nothing else's: see
   * {@link endsLikePrompt} for the half-written room name that became a room.
   */
  private idleFlushDelay(): number {
    const plain = stripAnsi(this.tokenizer.buffered).trimStart();
    if (!promptOpened(plain) || STATUS_LINE.test(plain)) {
      this.promptOpenedAt = null;
      return endsLikePrompt(plain) ? IDLE_FLUSH_MS : tuning().session.sentenceHoldMs;
    }
    const now = Date.now();
    this.promptOpenedAt ??= now;
    return Math.max(IDLE_FLUSH_MS, tuning().session.promptHoldMs - (now - this.promptOpenedAt));
  }

  /**
   * Whether the unterminated tail is a status line the server has finished:
   * the colon closes it and nothing follows. `STATUS_LINE` accepts `]` alone
   * and a state after the colon, and neither of those is a finished prompt.
   */
  private tailIsWholePrompt(): boolean {
    if (this.promptTrails) return false;
    const plain = stripAnsi(this.tokenizer.buffered).trimStart();
    const match = STATUS_LINE.exec(plain);
    return match !== null && match[0].endsWith(':') && match[0].length === plain.trimEnd().length;
  }

  private cancelIdleFlush(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private flushPending(): void {
    this.cancelIdleFlush();
    this.promptOpenedAt = null;
    const at = Date.now();
    for (const framed of this.tokenizer.flush()) this.publishLine(framed, at);
    this.paint(at);
  }

  /** Pushes whatever the feed decided the terminal sees, if anything. */
  private paint(at: number): void {
    const emitted = this.feed.take();
    if (emitted.text.length === 0) return;
    this.seq += 1;
    this.sink.data({
      seq: this.seq,
      at,
      text: emitted.text,
      ...(emitted.marks.length > 0 ? { marks: emitted.marks } : {})
    });
  }

  /**
   * Stamps a framed line with identity, publishes it, feeds the terminal, and
   * only then acts on what it was.
   *
   * **The feed sees the line before anything acts on it**, and that order is
   * load-bearing. Acting on a status line is what sends the next queued
   * command — the entry probe's `rm` goes out from inside the handling of the
   * prompt that acknowledged the realm — and a command sent *before* the
   * feed has seen that prompt is popped by it, as though the prompt had
   * answered it. It had not; it preceded it. Classify, feed, then act.
   *
   * A classifier fault costs the line its type and never its paint, and is
   * reported once: a parser defect must not cost a paint or the raw stream.
   */
  private publishLine(
    framed: { text: string; terminator: StreamLine['terminator'] },
    at: number
  ): void {
    // Whatever was opening has been framed; the next tail is a new one.
    this.promptOpenedAt = null;
    this.lineSeq += 1;
    const line: StreamLine = {
      seq: this.lineSeq,
      at,
      text: framed.text,
      plain: plainText(framed),
      terminator: framed.terminator
    };

    this.lineLog.push(line);
    if (this.lineLog.length > tuning().session.lineLogLimit) this.lineLog.shift();
    this.sink.line(line);

    let classified: ReturnType<Classifier['classify']> | null = null;
    const batchWas = this.classifier.batchType;
    try {
      classified = this.classifier.classify(line);
    } catch (error) {
      this.reportParserFault(error);
    }

    this.feed.line(
      line.text,
      line.terminator,
      line.plain,
      classified?.block.type ?? null,
      classified ? this.markFor(classified.block) : undefined,
      classified
        ? {
            block: classified.block,
            batchWas,
            batchNow: this.classifier.batchType,
            ...(classified.batch ? { closed: classified.batch } : {})
          }
        : undefined
    );
    if (!classified) return;
    if (classified.block.type === 'status-line' && !this.promptTrails) {
      this.promptTrails =
        STATUS_LINE.exec(line.plain.trimStart())?.groups?.['stateB'] !== undefined;
    }

    /*
     * Whether this line is inside a listing the classifier is collecting — the
     * header that opened one included, and the line that closed one. Every
     * line of a batch reaches the tracker typed by the single-line table as
     * well, and `You have no keys.` inside an `i` typed `unknown` read as an
     * effect landing (2026-09-12). The classifier knows; the tracker is told.
     */
    const collecting = batchWas !== null || this.classifier.batchType !== null;
    try {
      this.act(classified.block, classified.batch, collecting);
      /*
       * One framed line, several facts: the server printed a sentence after
       * the prompt without a repaint between them (`tailAfterPrompt`). They
       * are acted on *after* the prompt, in the order the server wrote them,
       * because the prompt is what releases the next queued command and a fact
       * arriving before its own acknowledgement would be attributed to the
       * command ahead of it.
       */
      for (const tail of classified.tails ?? []) this.act(tail, undefined, collecting);
    } catch (error) {
      this.reportParserFault(error);
    }
  }

  /** Reported once per session: the terminal keeps painting either way. */
  private parserFaultReported = false;

  private reportParserFault(error: unknown): void {
    if (this.parserFaultReported) return;
    this.parserFaultReported = true;
    this.sink.notice(t('session.parser.fault', { message: errorMessage(error) }));
  }

  /** Everything that happens because of what a line was. */

  private act(
    block: Block,
    batch: ReturnType<Classifier['classify']>['batch'],
    collecting = false
  ): void {
    this.sink.block(block);
    if (batch) this.sink.block(batch);
    /*
     * Armed *before* the automator sees the block, because it answers the
     * prompt synchronously from inside that call. Arming afterwards redacts the
     * command after the password -- the menu selection -- and writes the
     * password itself down verbatim, which is the exact opposite of the intent
     * and looks correct at a glance.
     *
     * Every prompt that asks for a password arms it, not only the login's. The
     * account-creation path prints `Please enter the password you would like
     * to use:` and then `Please confirm your new password:`, the server echoes
     * `*` for each keystroke at both, and a capture from 2026-08-26 held both
     * answers verbatim because only the login prompt was keyed on here.
     */
    if (block.type === 'prompt-password' || block.type === 'prompt-new-password') {
      this.awaitingPassword = true;
    }

    /*
     * The telnet field screen, and the way back out of it.
     *
     * Ahead of every module, because none of them may propose anything while
     * it is up and the queue is what stops them. The release is **any** prompt,
     * not the status line alone: `SAVE` comes back through `Player.Enters` to
     * the realm's own prompt and `QUIT` comes back to the character menu, and
     * both mean the same thing — there is a command line again.
     */
    if (block.type === 'user-stats-screen') this.holdForStatScreen(t('session.stats.screen'));
    // A telepath may be the code the realm's mudstats board sent (`StatsReporter.link`).
    if (block.type === 'conversation-telepath' && block.groups['message'] !== undefined) {
      this.stats.heard(block.groups['message']);
    }
    /*
     * And the exit sentence releases it too (todo 115): `SAVE` prints the
     * suicide-password paragraph and the room *before* the prompt, and the
     * staleness refresh that `user-stats-assigned` triggers (`st` for the
     * sheet the form rewrote) went to a queue still held and was dropped —
     * the client kept the old figures for the session.
     */
    else if (isPrompt(block.type) || block.type === 'user-stats-assigned') this.releaseStatScreen();

    this.login.onBlock(block);
    /*
     * An unrecognised command is not refused by this server — it is *said out
     * loud*. Captured live: `exits`, `time`, `stats` and `gold` all came back
     * as `You say "..."`.
     *
     * That fact is worth having and it is **not printed here**. It used to be
     * echoed into the stream as a notice, one line under the line it was about
     * — the server had already said the words, in the room, in full, and the
     * client repeated them back with a frame around them. `command-not-
     * understood` is `warning` in `NOTABLE`, so the Alerts card raises it,
     * keeps it, and lets it be gone back to; a notice in the console says the
     * same thing louder, in the one place the design forbids chrome, and
     * scrolls away regardless.
     *
     * One thing *is* acted on, and it is the automation's own word rather
     * than the player's: a realm with no locate command has just said so, in
     * front of everybody in the room. Asking again would say it again. Told
     * out loud once, because a client that quietly stops asking where it is
     * looks exactly like one that has stopped needing to.
     */
    if (block.type === 'command-not-understood') this.noteWordMissing(block.groups['message']);

    this.noteFamily(block, this.answering);

    /*
     * A death is a teleport, so everything that was on its way somewhere stops.
     *
     * Before the walker, for the reason `leftTheRealm` states: stopping a walk
     * calls `ended`, and a loop still running books that as a failed leg,
     * skips the stop it could not reach and plans the *next* one — out of the
     * temple, back towards whatever killed the character, with nothing on
     * screen saying a death was what happened. The walker stops itself on this
     * same block, which is right: a plain walk has to end on a death whether
     * anything else is watching or not.
     */
    if (block.type === 'user-dies') {
      this.wards.died();
    }

    this.noticeRealmMismatch(block);
    /*
     * A party forming or breaking up is the moment its roster becomes worth
     * having — and the moment it is emptiest, because nothing has asked. The
     * members' own numbers are asked of a joiner by `Remotes`.
     */
    this.publishAutomation();

    // Both are applied, deliberately not short-circuited: `||` would skip the
    // batch whenever the line that completed it also changed state — and the
    // line that completes a stat sheet is the status line, which always does.
    const lineChanged = this.tracker.apply(block, undefined, collecting);
    const batchChanged = batch ? this.tracker.apply(batch, batch.rows) : false;
    const changed = lineChanged || batchChanged;
    // The tracker records that a stat sheet would settle a buff ending; the
    // routine is what asks for one. Facts fan out, actions funnel in.
    if (this.tracker.takeSheetRequest()) {
      if (this.mega !== null) this.megaAskSheet();
    }
    /*
     * A pack listing is the fact a requested deposit is waiting on: it is what
     * restates the purse, and the figure the deposit names is composed from it
     * *here* rather than beside the `i` that asked for it. After `apply`, which
     * is what makes `current` the listing's own figure rather than the one the
     * client believed a moment ago — the whole of the bug this shape replaced.
     */
    if (batch?.type === 'user-inventory') {
      // And the quest run and the item errand, which read only the listing
      // their own ask answered.
      this.questRunner.noteListing(this.answering);
      this.itemErrand.noteListing(this.answering);
    }

    /*
     * What the search turned up, written down against the room it was in.
     *
     * **After `apply`**, and that is the whole of why this is here rather than
     * beside `AutoLoot` in the `onBlock` fan-out above: `room.hidden` is set by
     * this very block, so the pre-apply state a module is handed still holds
     * the last room's answer. `CharacterTracker` has already done the parsing
     * — the item's name, its count, the coins normalised into copper — so this
     * reads the fact rather than splitting the line a second time.
     */
    if (
      block.type === 'room-hidden-items' ||
      // The bare search's empty answer; `to the north` asked about an exit.
      (block.type === 'user-search-failed' && block.groups['direction'] === undefined)
    ) {
      this.recordSearch();
    }

    /*
     * And what died, for the quest steps a monster's death runs.
     *
     * After `apply` for the same reason and with one of its own: the tracker is
     * what decides a death happened, so the slot it writes cannot be read
     * before it has run. The room is unchanged by a kill, so `current` is the
     * room the corpse is in either way.
     */
    for (const dead of this.tracker.takeDeaths()) this.noteQuestKilled(dead);
    /*
     * The round clock the one heal or blessing a round is kept to: blows
     * either way mark the rounds, and the server's own refusal spends one.
     */
    if (
      block.type === 'user-hits' ||
      block.type === 'user-misses' ||
      block.type === 'mob-hits' ||
      block.type === 'mob-misses'
    ) {
    } else if (block.type === 'spell-refused') {
      // The refusal switches the fight off too; the `*Combat Off*` answering
      // it is `AutoCombat.fightBrokenBy`'s, and the fight is engaged again.
    }

    /*
     * A prompt is an acknowledgement: the server has finished with the last
     * command and is waiting for input. Acking only on the *in-game* status
     * line meant the login sequence had nothing to ack it at all, so after
     * `window` answers the queue sat on the 3s timeout — the whole reason
     * logging in took four and a half seconds.
     *
     * **A prompt, not the whole `session` domain** (todo 07). The domain also
     * holds `command-echo`, which is the server repeating a command it has
     * not finished with — so every command handed back its own credit, the
     * window never closed, and fifteen went out between two prompts.
     * `GMUDInGameState.Process` queues fifteen and then says *Why don't you
     * slow down for a few seconds?*, which is exactly what the transcript
     * shows. See `isPrompt`.
     */
    if (isPrompt(block.type)) this.queue.notePrompt();
    /*
     * Which command the next answer is about: the status line's own echo.
     *
     * The server prints the command it is answering after the prompt —
     * `[HP=334/KAI=0]:med` — and everything up to the next prompt is that
     * command's answer. So `Your command had no effect.` is attributed to the
     * echo before it, never to the queue's bookkeeping, which counts prompts
     * and cannot tell the player's `l` from automation's `med` sent in the
     * same breath. Read here because the refusal is a fact about the wire; a
     * module that proposes a verb is told and decides for itself.
     */
    if (block.type === 'status-line') this.answering = echoedCommand(block.text);
    /*
     * A command typed ahead of the prompt is echoed on a bare line instead —
     * `captures/009:141`: `hid` at the prompt, `bs k` on its own line, then
     * the refusal, which is the second command's. The classifier already
     * knows an echo of something this client sent, so it moves the answer
     * along with it.
     */ else if (block.type === 'command-echo') this.answering = block.text.trim();
    else if (block.type === 'command-no-effect') {
      this.noteNoEffectMissing(this.answering);
    } else if (block.type === 'command-fumbled') {
      /*
       * The server threw the command away before it looked at it — todo 02.
       *
       * Two things follow, and they are separate facts. **No room is coming**
       * for it, so the expectation it queued goes, exactly as a refused
       * `go manhole`'s does; leaving it is how dead reckoning is poisoned.
       * And **the decision that produced it is still the right decision**, so
       * the arbiter puts it back at the head, after the delay the server's own
       * fumble branch imposes.
       *
       * Both read `this.answering` — the status line's echo — because the
       * sentence names nothing, and it is what makes this apply to what the
       * queue sent and not to a keystroke: the resend is refused unless the
       * fumbled command is one the queue itself sent, a talk-box line's
       * included.
       */
      this.tracker.noteFumbled(this.answering);
      if (this.queue.resendLast(this.answering)) {
        this.sink.notice(t('automation.queue.fumbledResend', { command: this.answering ?? '' }));
      }
    }
    this.settleClaims();
    // Republish only on a real change: during a combat burst most lines say
    // nothing new, and a HUD re-render per line is exactly the stall the
    // architecture exists to prevent.
    if (changed) this.reactToState();
  }

  /**
   * Everything that decides on this character's behalf, given what it is now.
   *
   * The fan-out a changed line runs, as a method rather than inline in `act`
   * so a change that is not a line's — the realm's message table saying a
   * condition started or ended (`MessageTriggers`) — runs the same decisions
   * in the same order rather than waiting for the next status line.
   */
  private reactToState(): void {
    const state = this.tracker.current;
    this.publishCharacter();
    /*
     * Walking out to the menu is a character *leaving*, and what is kept
     * beside the engine is about the one that was here: before they read the
     * new state.
     */
    this.noteRealmPhase(state);
    // Every command is refused on the ground (todo 20): said, and nothing proposed.
    if (state.mortallyWounded) {
      this.sayMortallyWounded(state);
      return;
    }
    this.saidMortallyWounded = false;
    this.unrefuseWhatTheRoomPrints(state);
    this.noteStatline(state);
    /*
     * What is kept beside the MegaMUD engine (`docs/megamud/engine-port.md`,
     * *Kept, outside the loop*); everything else is the engine's.
     */
    // The ward the room the character stands in wants, when its spell lapsed (todo 105).
    this.wards.onCharacter(state, roomAddress(state.room));
    // And the key to a way out of this room, off this room's floor.
    this.keys.onCharacter(state);
    // Where the character should be at all, when nothing else has it.
    this.hunt.onCharacter(state);
    // And whether the thing a door wants is in the pack yet (todo 07).
    this.megaBuyTick(state);
    this.itemErrand.onCharacter(state);
    // And what the engine's walk or loop waited on that fetch for.
    this.takeUpAfterFetch(state);
    // And the quest run, which drives the errands above one step at a time.
    this.questRunner.onCharacter(state);
  }

  /**
   * Whether sitting this character down is the client's to propose at all.
   *
   * One statement of the gate, read by the block path and by the tick, because
   * two halves of one gate in two files agree until one of them is edited —
   * which is exactly what `AutoCombat.quarry` was pulled together to stop.
   *
   * Three refusals, and every one of them is *somebody else is already moving
   * this character*:
   *
   * - **An escape in flight.** A character on its way out of a room is not one
   *   to sit down in it.
   * - **A walk in progress.** Nothing told `Recovery` a walk was running, so a
   *   character walking at low health was sat down by it and stood straight
   *   back up by the walker's next step — two subsystems spending commands
   *   undoing each other out of the budget the walk itself is spent from.
   * - **A loop between legs.** `Walker.walking` is false during the dwell a
   *   loop takes at each stop, so the same undoing came back one rung up: sit
   *   down at the stop, stand up on the next leg, once per stop for as long as
   *   the lap runs. A loop that *should* stop for health has a pair of
   *   thresholds of its own (`restBelow`/`restTo`) and reports it as
   *   a `health` hold — so a held loop is exactly when resting is right, and a
   *   marching one is exactly when it is not. This became worth stating when
   *   `restTo` widened the band: before it, only a character under
   *   `restBelow` was affected.
   */
  /**
   * The spells the server has stated up on this character with a countdown
   * still running, as the realm's ids (todo 105). Only a stated clock — the
   * Paramud `st` sheet's timer — because a buff recorded without one may
   * have lapsed, and the router prices on nothing that may have. Every name
   * a buff could be is resolved, as `Blessings.sameSpell` resolves one.
   */
  private spellsUp(state: CharacterState): number[] {
    const world = this.world;
    if (world === undefined || state.buffs.length === 0) return [];
    const now = Date.now();
    const up: number[] = [];
    for (const buff of state.buffs) {
      if (buff.expiresAt === undefined || buff.expiresAt <= now) continue;
      for (const name of [buff.spell, ...(buff.candidates ?? [])]) {
        const id = world.spellNamed(name)?.id;
        if (id !== undefined && !up.includes(id)) up.push(id);
      }
    }
    return up;
  }

  /**
   * Re-decide, with nothing new to decide from.
   *
   * The four modules here are the ones whose answer can change while the wire
   * says nothing at all — because what changed is a **clock of their own**: a
   * heal or a potion coming off its cooldown, a cure's thirty seconds while
   * the affliction is still stated, a `rest` whose in-flight window has
   * lapsed. Every one of them re-derives its whole decision from the state it
   * is handed and refuses for itself, so a tick on which nothing has moved
   * proposes nothing; they are idempotent by construction, which is what makes
   * a second caller safe at all.
   *
   * What is **not** driven from here, and why:
   *
   * - **`Blessings`** already owns this exact clock for this exact reason, and
   *   two things ticking one module would recast a buff twice as often as its
   *   interval says.
   * - **The walker, the loop, the rules, auto-combat and both escapes.** Every
   *   one of those decides from a fact the wire delivers — a room, a blow, a
   *   roster — and a fact that has not arrived has not changed. Re-running
   *   them against a stale state is how a client acts twice on one event.
   * - **Shedding, searching and banking**, which are driven by a pack or a
   *   room listing rather than by a number on a clock.
   *
   * The order is the block path's order with the clockless modules removed,
   * and the priority argument that puts `blessings.urgent` ahead of the heal
   * is meaningless here for the reason `Blessings` states about its own tick:
   * on a tick where nothing else is being decided there is nothing to be ahead
   * of.
   */
  /**
   * What the server still owes, settled: the probe, the ordered answer and the
   * write-off. Run on every block and on the reconsider tick, because both of
   * its clocks are clocks: a probe asked only when the next line arrived went
   * out after a silence long enough to have written the step off, and the
   * probe then kept alive a claim the arriving room was then credited to.
   * `mudengine-wire` § A step unanswered is probed has the rule.
   */
  private settleClaims(): void {
    /*
     * **What the server still owes this client is a fact about the wire, so it
     * is read off every line rather than off the ones that moved the HUD.**
     *
     * Both halves of it used to sit inside `act`'s `if (changed)`, among the
     * things that *decide* — and the answer to a step is not a decision. A
     * refusal (`There is no exit in that direction!`) answers a move and
     * changes nothing else, so the client learned the step had landed only on
     * whatever line happened to change something next.
     *
     * `expireStaleClaims` is the other half, and it is the one the report was
     * actually about. A step nothing ever answers used to stay outstanding for
     * the rest of the session, and six things gate on that: running away,
     * `Walker.start`, a loop's next leg, the walk home and auto-combat. Exactly
     * one of them — auto-combat — had a clock, so it recovered after eight
     * seconds, said so, and left the character unable to run, walk or loop for
     * the whole evening with nothing further said. The bound moved to the claim
     * itself so they all recover together, and this is where it is said out
     * loud: once, naming the command, because "a step went unanswered" is a
     * sentence a player can only agree with.
     */
    /*
     * Before the flat clock, the probe (todo 10). A step unanswered for
     * `staleProbeMs` has `rm` sent after it; the server answers in order, so
     * a `Location:` arriving with the step still unanswered proves the step
     * produced nothing and drops it at once, while a probe still unanswered
     * proves the server is slow and the step waits — up to `staleMoveMaxMs`.
     * A `n` answered nine seconds late cost a loop its place, five `rm`s and
     * a stop, all for a room that then arrived.
     */
    for (const lost of this.tracker.takeSettledByLocate()) {
      this.sink.notice(
        lost.moved
          ? t('session.walk.claimSettledByLocate', { command: lost.command })
          : t('session.walk.readSettledByLocate', { command: lost.command })
      );
    }
    if (this.locateWord !== null) {
      const probed = this.tracker.staleProbe(Date.now());
      // The engine's pending list, as a card's probe is (`ask`): our own queue
      // refuses it while the engine runs the character.
      const asked =
        probed !== null &&
        this.keptQueue.enqueue({
          command: this.locateWord,
          priority: 'probe',
          coalesceKey: 'stale-probe',
          expiresAt: Date.now() + tuning().parse.staleMoveMaxMs,
          reason: t('session.walk.probeReason')
        });
      if (probed !== null && asked) {
        const seconds = Math.round(tuning().parse.staleProbeMs / 1000);
        this.sink.notice(
          probed.length === 0
            ? t('session.walk.claimProbedUntyped', { seconds })
            : t('session.walk.claimProbed', { command: probed, seconds })
        );
      }
    }
    const lapsed = this.tracker.expireStaleClaims(Date.now());
    // Several bare re-reads lapsing together are one sentence, not one each.
    const bareReads = lapsed.filter((lost) => !lost.moved && lost.command.length === 0).length;
    for (const lost of lapsed) {
      const seconds = this.staleMoveSeconds;
      /*
       * Five literal keys rather than one composed sentence, because
       * `i18n-coverage.test.ts` reads the key straight after `t(` — and
       * because only a **move** held anything. `pendingMoves` counts moves
       * alone, so a lapsed peek or bare Enter gated neither the escape nor the
       * walker nor a loop, and saying it had was a sentence that was false
       * about once a session (a bare Enter goes unanswered about once in three
       * thousand).
       */
      if (lost.moved) {
        this.sink.notice(
          lost.command.length === 0
            ? t('session.walk.claimLapsedUntyped', { seconds })
            : t('session.walk.claimLapsed', { command: lost.command, seconds })
        );
      } else if (lost.command.length > 0) {
        this.sink.notice(t('session.walk.readLapsed', { command: lost.command, seconds }));
      } else if (bareReads === 1) {
        this.sink.notice(t('session.walk.readLapsedUntyped', { seconds }));
      }
    }
    if (bareReads > 1) {
      this.sink.notice(
        t('session.walk.readLapsedSeveral', { count: bareReads, seconds: this.staleMoveSeconds })
      );
    }
  }

  /**
   * A glyph for a line that names a place: a bank's name gets a bank.
   *
   * Only a room's name line, and only when every room bearing that name is the
   * same kind of place — `placeNamed` refuses otherwise, because a glyph is a
   * claim and the name line arrives before the room resolves. Off entirely
   * when the internal file says the console is not to be decorated.
   */
  /** Said once per connection; a second `rm` in the same wrong realm adds nothing. */
  private realmMismatchSaid = false;
  /** What `noteStatline` last said about the prompt's shape, so each change is said once. */
  private statlineSaid: { reported: string | null; exact: boolean | null } = {
    reported: null,
    exact: null
  };
  /** The prompt row's template as last configured, so a too-wide refusal is said once per design. */
  private promptTemplate: string | null = null;
  private designTooWideSaid = false;
  /** The prompt row and the listings this player has the client draw itself (`ui.rewrites`). */
  private readonly rewriter = new Rewriter();

  /**
   * Who this character is, in the realm's own row ids — the join `wearerIn`
   * in `client.ts` makes for the pack card, made here for the console's
   * rewritten listing, through the same `WorldGraph` lookups so a Paladin
   * cannot be one class to the card and another to the console.
   */
  private wearerNow(): Wearer {
    const state = this.tracker.current;
    const world = this.world;
    return {
      classId: world && state.className ? world.classId(state.className) : null,
      raceId: world && state.race ? world.raceId(state.race) : null,
      level: state.progress.level,
      strength: state.progress.strength,
      classNames: world?.namedClasses() ?? {},
      raceNames: world?.namedRaces() ?? {}
    };
  }

  /**
   * The client's own status line in the prompt's place.
   *
   * Read from the prompt itself, through the reader the tracker uses, because
   * the tracker has not seen this prompt yet: the feed paints a tail the
   * moment it arrives, ahead of framing. What the prompt does not carry — a
   * maximum under `full`, the level, the room — is the last state's. A line
   * wider than the prompt row is refused and said once per design, since a
   * wrapped prompt leaves its first row behind on every repaint.
   */
  private designPrompt(plain: string): { rendered: string; from: number; to: number } | null {
    if (this.rewriter.promptDesign() === null) return null;
    const from = plain.length - plain.trimStart().length;
    const prompt = this.tracker.readPrompt(plain.slice(from));
    if (!prompt) return null;
    const drawn = this.rewriter.prompt(withReading(figuresOf(this.tracker.current), prompt.read));
    if (!drawn) return null;
    if (drawn.cells > STATLINE_MAX_CELLS) {
      if (!this.designTooWideSaid) {
        this.designTooWideSaid = true;
        this.sink.notice(
          t('session.statline.tooWide', { cells: drawn.cells, max: STATLINE_MAX_CELLS })
        );
      }
      return null;
    }
    return { rendered: toAnsi(drawn.segments), from, to: from + prompt.length };
  }

  /**
   * What the realm said the prompt is, said once per report, and a prompt
   * that stops fitting it, said once per lapse.
   *
   * The report names the pattern the prompt is read by from here on — the
   * exact matcher, or the tolerant pattern for `full` and for a template this
   * client cannot build from — because a silent fallback is the failure the
   * whole feature exists to remove. The first prompt to fit is confirmed once;
   * a prompt that stops fitting is the tracker's cue to ask `pro` again
   * (`takeStatlineRequest`, taken in `onBlock`).
   */
  private noteStatline(state: CharacterState): void {
    const now = state.statline;
    const said = this.statlineSaid;
    if (now.reported !== said.reported && now.reported !== null) {
      if (isFullStatline(now.reported)) this.sink.notice(t('session.statline.full'));
      else if (statlineMatcher(now.reported) === null) {
        this.sink.notice(t('session.statline.loose', { statline: now.reported }));
      } else this.sink.notice(t('session.statline.exact', { statline: now.reported }));
    }
    if (now.exact === true && said.exact === null) {
      this.sink.notice(t('session.statline.verified'));
    } else if (now.exact === false && said.exact !== false) {
      this.sink.notice(t('session.statline.mismatch'));
    }
    this.statlineSaid = now;
  }

  /**
   * The realm said where the character is, and the realm *data* has no such
   * room: the wrong map is loaded for this server.
   *
   * Found by playing: a profile named a Paradigm database while the server
   * ran stock GreaterMUD, `rm` answered `Location: 1,289`, the data had no
   * room 1/289, and every route from there failed with nothing to say why.
   * Said out loud, because "the wrong map" beats "no map" only when it is
   * announced (CLAUDE.md, "A character can name its own realm").
   */
  private noticeRealmMismatch(block: Block): void {
    if (
      (block.type !== 'user-profile' && block.type !== 'user-location') ||
      this.realmMismatchSaid ||
      !this.world
    )
      return;
    const map = block.groups['map'];
    const room = block.groups['room'];
    if (map === undefined || room === undefined) return;
    if (this.world.byId(`${map}/${room}`)) return;
    this.realmMismatchSaid = true;
    this.sink.notice(t('session.world.realmMismatch', { map, room }));
  }

  /** The loops this character's options define, by name. */
  loopNamed(name: string): Loop | undefined {
    return this.automationConfig.loops.find((entry) => entry.name === name);
  }

  /** The palette's view: each loop by name, with how many stops it visits. */
  get loopList(): Array<{ name: string; stops: number }> {
    return this.automationConfig.loops.map((entry) => ({
      name: entry.name,
      stops: entry.stops.length
    }));
  }

  /**
   * Takes an edge back out of `refusedEdges` the moment the server prints it.
   *
   * `refusedEdges` is a *guess* — the server refused a step, so routes avoid
   * that corridor for the session — and nothing ever took an entry out of it
   * again. That is right for a corridor the realm data invented and wrong for
   * every other reason a step can be refused, of which the reported one is a
   * shut gate: the way opens the moment somebody pulls its levers by hand, and
   * every route went on avoiding it until the character reconnected (todo 04,
   * *"routes will avoid it"*).
   *
   * The room's own `Obvious exits:` line is the authority — the same source
   * `Walker.mustSearchFirst` reads to decide a hidden exit has been found —
   * and a fact printed by the server outranks a guess this client made. So an
   * exit the room lists is not refused, whatever was written down about it.
   *
   * Cheap: it runs only where the room prints something *and* something is
   * refused, which after a healthy session is never.
   */
  private unrefuseWhatTheRoomPrints(state: CharacterState): void {
    if (this.shutEdges.size === 0) return;
    const { map, number } = state.room;
    if (map === null || number === null) return;
    const here = roomId(map, number);
    for (const exit of state.room.exits) {
      const key = `${here}|${exit.direction}`;
      // Spent whether or not the edge was still refused, so the offer is made
      // once per edge per session and cannot become a cycle.
      if (!this.shutEdges.delete(key)) continue;
      if (!this.refusedEdges.delete(key)) continue;
      this.sink.notice(t('session.walk.exitBackOpen', { direction: exit.direction }));
    }
  }

  /**
   * A route from where this character is standing to `to`, or the reason
   * there is none.
   *
   * The one statement of what this character costs to move: its level, what
   * it can force or pick, and **the purse**, because a toll gate is priced and
   * a route planned without it walks a penniless character up to one, over and
   * over. `refusedEdges` goes with it, so a corridor the server has already
   * said does not exist is not planned through twice in one session.
   *
   * Shared by the loop's next leg and by a route picking itself back up after
   * a fight, because those two answering the question differently is the
   * "two halves of one gate in two files" failure this codebase keeps
   * relearning — and the purse is exactly the argument it was left out of
   * once already. `shortest` is a lap's leg: see `lapTraveller`.
   */
  private planFromHere(
    to: RoomId,
    options: RouteOptions = {},
    shortest = false,
    /**
     * The kept-out words this plan may cross: nothing, unless the caller is
     * planning the player's own journey again (`allowingFor`).
     */
    allowing: readonly string[] = []
  ): Route | string {
    const state = this.tracker.current;
    const here = state.room;
    if (here.map === null || here.number === null) return t('session.loop.unknownRoom');
    const traveller = shortest
      ? this.lapTraveller(state)
      : this.travellerNow(state, true, allowing);
    const plan =
      this.world?.route(roomId(here.map, here.number), to, traveller, options) ??
      t('session.loop.noRealmData');
    if (typeof plan !== 'string') this.askCountersFor(plan);
    return plan;
  }

  /**
   * One `abil`, the first time a plan crosses a gate the counters would answer.
   *
   * The realm writes a room script's landing per branch — `9/1291`'s `go
   * portal` names `9/1424` on `checkability 133 5` and no room at all on the
   * two branches below it — so a character the gate refuses is put somewhere
   * the plan never named. `edgePenalty` refuses such an edge outright once the
   * counters are read, and reads *nobody has said* as the old price; this is
   * what turns the second into the first.
   *
   * **A gate, whichever of the realm's two shapes wrote it.** `Requirement.
   * abilities` holds the exit table's `Ability: 204 w/value 1 to 999` as well
   * as the script's verbs, so this reads both by reading one field. An
   * `AbilityExit` does not misplace the character — the server simply refuses
   * the step — but it stops the walk exactly as dead, nine exits' worth, and
   * the listing is what turns a 286-step plan into a refusal with a reason.
   *
   * **Asked off the plan rather than on the way in**, though it is one command
   * in the cheapest band. A *complete* listing enumerates, so it settles every
   * counter at once and the quest book stops offering its nodes as the
   * player's own marks — right where the realm has spoken, and an answer
   * nobody asked for where it has not. A plan that crosses such a gate is the
   * moment the client genuinely needs the number.
   *
   * One-shot inside `Routines`, so every plan after the first costs nothing,
   * and it is the plan that is read rather than the route walked: a leg, a
   * resume and the panel's own press all come through here.
   */

  /**
   * The counters (`abil`), asked once a connection when a plan crosses a gate
   * written on one and nobody has read them yet: a complete listing settles
   * every counter, so it is not spent on a character who never goes near one.
   * On the engine's pending list, as the actions kept beside it are.
   */
  private askCountersFor(route: Route): void {
    const state = this.tracker.current;
    if (state.abilities !== null || this.askedAbilities) return;
    if (!route.steps.some((step) => (step.requirement?.abilities?.length ?? 0) > 0)) return;
    this.askedAbilities = true;
    this.keptQueue.enqueue({
      command: 'abil',
      priority: 'probe',
      coalesceKey: 'probe:abil',
      reason: t('automation.routines.reasonAbilities')
    });
  }

  /** Whether the counters were asked for this connection. See `askCountersFor`. */
  private askedAbilities = false;

  /**
   * What this character costs to move, as the router prices it.
   *
   * One statement, read by every route this session plans — the loop's leg,
   * a route picking itself up after a fight, the way home from a retreat —
   * and by the route panel through main. The stats off the sheet, the purse,
   * the corridors the server refused this session, and the corridors of the
   * routes this character prefers (`preferredEdges`), unless the caller is
   * the builder, whose drafts plan plainly so what is drawn is what the
   * reduction reproduces.
   */
  travellerNow(
    state: CharacterState,
    preferring = true,
    /** Kept-out words this walk may cross anyway. See `planFromHere`. */
    allowing: readonly string[] = []
  ): Traveller {
    const pack = this.packContents(state);
    return {
      level: state.progress.level ?? null,
      strength: state.progress.strength ?? null,
      pickSkill: state.progress.picklocks ?? undefined,
      // And which of the two the walker will spend: a door planned on a skill
      // whose switch is off is a door the walk stops at. The MegaMUD engine's
      // own Other tab's: it picks with Pick locks instead of bashing and
      // bashes every other locked door (`0x408870`, 2026-10-16).
      forcing: { pick: (this.mega?.s.Other_CanPickLocks ?? 0) !== 0, bash: true },
      // And the ways and places routes keep out of (todo 806): pruned for a
      // walk nobody watches, offered beside the way round on the panel.
      keepOut: { words: this.automationConfig.movement.keepOutOf, allowed: allowing },
      wealth: state.inventory.wealth,
      /*
       * The join between the sheet's word and the realm's row id, made here
       * for the reason every other figure on this object is: one statement,
       * read by the loop's leg, the pick-up after a fight, the way home and
       * main's route panel alike. `wearerIn` in `main/index.ts` makes the same
       * join for what a character may *wear*; both go through
       * `WorldGraph.classId` so a Paladin cannot be one class to a helm and
       * another to a corridor.
       */
      classId: this.world && state.className ? this.world.classId(state.className) : null,
      // The same join one column across, for a race-gated exit.
      raceId: this.world && state.race ? this.world.raceId(state.race) : null,
      /*
       * The one fact here that is not off the stat sheet: the sheet carries no
       * standing, so the roster's own row for this character is the only place
       * it appears. Null for the first seconds of every session, which the
       * router treats as *nobody has said* and never as neutral.
       */
      alignment: ownAlignment(state),
      /*
       * And the quest counters, for a scripted way through gated on one. Null
       * until `abil` has answered (`Routines.askAbilities`), which the router
       * reads as *nobody has said* and never as the gate passing.
       */
      counters: state.abilities,
      // And the wards the server has stated up with a clock still running,
      // for a room spell one of them stops (todo 105).
      spellsUp: this.spellsUp(state),
      ...pack,
      refused: this.refusedEdges,
      ...(preferring ? { preferred: this.preferredEdges() } : {}),
      // What waits in each room, against this character as they stand now.
      danger: (room) => this.lairDanger(room, state),
      // And the same figure before the division, for the walker's rest
      // before a trap: a reserve in hit points, not a share of a bar that
      // was read at planning time.
      lairDamage: (room) => this.lairCost(room, state),
      /*
       * And what the room itself does to whoever stands in it — with the pack
       * resolved **once**, here, rather than per call: this runs for every room
       * the A* expands that casts anything, and `packContents` walks the whole
       * listing and normalises every name. `danger` is spared it because
       * `LairCosts` remembers per room; this has nothing to remember, so the
       * one thing it depends on is hoisted instead.
       */
      hazard: (room) => this.roomHazard(room, state, pack.keys)
    };
  }

  /**
   * What a lap's leg costs to move: the distance, and whether each way can be
   * passed at all — never what is waiting on it.
   *
   * A loop is walked for the monsters on it, so pricing them re-routes the
   * lap around its own purpose. Kept: the gates (doors, keys, levels, class,
   * counters), the edges the server refused, and a room whose spell moves the
   * character, which is not a way to arrive anywhere. Dropped: the lair, the
   * room's damage, the preferred corridors. See `mudengine-automation` ›
   * *A lap walks the shortest way*.
   */
  lapTraveller(state: CharacterState): Traveller {
    const priced = this.travellerNow(state, false);
    const relocates = (room: WorldRoom): number | null =>
      this.world?.hazardOf(room, state.progress.level)?.relocates === true
        ? (priced.hazard?.(room) ?? null)
        : null;
    return { ...priced, danger: undefined, hazard: relocates };
  }

  /**
   * What a room's own spell is expected to cost this character, as a share of
   * the health it has now (`Traveller.hazard`, todo 01).
   *
   * `lairDanger`'s shape, one column across, and simpler for one reason: the
   * damage is a figure the realm states rather than one this client computes,
   * so there is nothing to remember and no fitness string to invalidate. What
   * varies is the pack — a log raft turns eight hundred and forty-five rooms
   * of the Silver River from a wall into a corridor — and the bar, and both
   * are read at the call.
   */
  private roomHazard(room: WorldRoom, state: CharacterState, carrying?: number[]): number | null {
    if (!this.world) return null;
    // The character's own level: the realm gates some effects on it, and a
    // sandstorm that cannot catch this character is not a price it pays.
    const hazard = this.world.hazardOf(room, state.progress.level);
    if (hazard === null) return null;
    // Carrying what stops it is not *unknown*, it is *free*: the room costs a
    // plain step, which is what it is for that character.
    if (hazardAvoided(hazard, carrying ?? this.packContents(state).keys, this.spellsUp(state)))
      return null;
    /*
     * **A room that moves you is a wall, exactly as an exit that casts one
     * is** (`edgePenalty`'s `spellEffect === 'relocates'`). The walker's next
     * command goes out from wherever the plan says it is standing, and a room
     * that puts it somewhere the exit table does not name breaks every step
     * after it. 1,557 rooms of the shipped realm cast one. `deadlyShare` and
     * not `wallCost` because this is a *share*, and `dangerPenalty` turns a
     * share at the wall into the wall — one place decides that number.
     */
    if (hazard.relocates === true) return tuning().world.deadlyShare;
    const health = state.vitals.hp ?? state.vitals.hpMax;
    if (health === null || !(health > 0)) return null;
    /*
     * A chain the reader could not follow prices as a *discouragement* rather
     * than as nothing: `graveyard summon` and `fire trigger` end in verbs this
     * client cannot evaluate, and walking such a room for free is exactly what
     * put a route down the Silver River. `unreadHazardShare` is what a step
     * through one is worth as a share of the bar — small, and never zero.
     */
    /*
     * The worse of the two, not one or the other: `unread` means the chain
     * carried on past what this reader could follow, so a spell that does a
     * readable ten and then something unreadable is *at least* the ten. Taking
     * the damage alone would let the unread half read as nothing.
     */
    const read = hazard.damage === undefined ? null : hazard.damage / health;
    // A chain that can put a monster in the room is priced on the same
    // discouragement: what it does is what a lair does, and how much is a
    // number this cannot weigh without knowing what turns up.
    const unread =
      hazard.unread === true || hazard.summons === true ? tuning().world.unreadHazardShare : null;
    if (read === null) return unread;
    return unread === null ? read : Math.max(read, unread);
  }

  /**
   * What a room's lair is expected to cost this character, as a share of
   * maximum health, for the router (`Traveller.danger`, `dangerPenalty`).
   *
   * Todo 13: a route was planned through whatever the shortest corridor held,
   * a boss included, because nothing priced the monsters. The arithmetic is
   * the room appraisal's (`appraiseRoom`), run on the lair's monsters instead
   * of the room's occupants, so the Room card and the router cannot disagree
   * about how hard a monster is. Remembered per room until the character's
   * own figures move — a level gained, a helm put on — which `fitness` says
   * (`LairCosts`). Null where nothing can be weighed, and the router prices
   * null as nothing: an unread sheet must not turn every lair into a wall.
   */
  private lairDanger(room: WorldRoom, state: CharacterState): number | null {
    if (!this.world || !room.lair) return null;
    /*
     * The damage is remembered per room; the share is taken against the
     * health the character has *now*, at every call, because that is the
     * number a pass is measured against — a route planned at a third of the
     * bar has to be three times as careful as one planned at the top of it,
     * and the loop plans every leg afresh. Unread health prices nothing.
     */
    /*
     * **And a pass nobody can say will happen is capped below the wall**
     * (`passShare`, `tuning.world.unsureShare`). `attacksOnSight` answers
     * `null` for a conditional monster met by a character whose standing has
     * not been read; counted in at its full share it reaches `deadlyShare`,
     * and a corridor is then closed on a fact nobody has read — the one thing
     * `edgePenalty` was fixed not to do for a gate it cannot evaluate.
     */
    return passShare(
      this.lairPassHere(room, state),
      state.vitals.hp ?? state.vitals.hpMax,
      tuning().world.unsureShare
    );
  }

  /**
   * What one pass through a room's lair is expected to take, in hit points.
   *
   * **Uncapped, deliberately**: this is what the walker reserves health
   * against before a trap, and a reserve shaded by how sure the *router* is
   * would be the router's caution spent as the walker's safety margin.
   */
  private lairCost(room: WorldRoom, state: CharacterState): number | null {
    return this.lairPassHere(room, state)?.damage ?? null;
  }

  /** The weighed pass for a room, remembered until the character's fitness moves. */
  private lairPassHere(room: WorldRoom, state: CharacterState): LairPass | null {
    if (!this.world || !room.lair) return null;
    return this.lairCosts.at(this.fitness(state), roomId(room.map, room.room));
  }

  /**
   * The figures a lair's cost depends on, as one string, so a change to any
   * of them drops every remembered room. The sheet, the weapon in hand, the
   * class row, the standing (which decides who attacks on sight), the
   * server's family and what `stat all` still states; not the pack, the purse
   * nor the health itself, which move every room and change no blow.
   */
  private fitness(state: CharacterState): string {
    // Asked once per lair a search expands; a state is never edited in place.
    if (this.fitted?.state === state) return this.fitted.key;
    const { progress } = state;
    const key = [
      progress.level,
      ownAlignment(state),
      progress.armourClass,
      progress.damageResist,
      progress.magicRes,
      progress.agility,
      progress.intellect,
      progress.charm,
      progress.strength,
      state.className,
      JSON.stringify(wieldedWeapon(state.inventory.items)),
      this.serverFamily,
      JSON.stringify(statedNow(state))
    ].join('|');
    this.fitted = { state, key };
    return key;
  }

  /**
   * One room's lair, weighed: what one pass through it is expected to take,
   * in hit points, **and whether the wire settles that it happens at all**.
   * See `lairDanger` for what is remembered and why.
   *
   * Only what attacks on sight counts (`attacksOnSight`, against the
   * character's own standing): a passive monster is walked past, a hostile
   * one gets its round, and one whose disposition nobody has read is priced
   * as hostile — an unknown is never the reassuring answer. What `lairPass`
   * adds is the second half of that sentence: counted in, and marked as
   * unevidenced, so the router discourages the room rather than walling it.
   */
  private weighLair(id: RoomId): LairPass | null {
    const world = this.world;
    if (!world) return null;
    const room = world.byId(id);
    if (!room) return null;
    const lair = world.lair(room, this.serverFamily);
    if (lair === null || lair.mobs.length === 0) return null;
    const state = this.tracker.current;
    const { combat, magery, family } = this.realmClass();
    /*
     * By the rows the lair names, never by name (todo 01, 2026-09-10): a name
     * folds every row sharing it and takes the worst, and the guard post on
     * the Hillside Path was priced as an 830-HP gnoll scout that swings four
     * times a round when the row it names is the 100-HP one that lands a blow
     * in twenty-five. See `WorldGraph.lairEntities`.
     */
    const entities = world.lairEntities(room);
    if (entities.length === 0) return null;
    const verdicts = weighVerdicts(
      entities,
      this.menacePlayer(state),
      tuning().menace,
      prowessSheetOf(state, { combat, magery }),
      wieldedWeapon(state.inventory.items),
      family
    );
    const standing = ownAlignment(state);
    const rounds = tuning().world.passRounds;
    const opens = (index: number): boolean | null =>
      attacksOnSight(entities[index]?.disposition ?? null, standing);
    return lairPass(verdicts, lair.max, rounds, opens);
  }

  /**
   * The trainers that will take this character, cheapest first (todo 18).
   *
   * Addressed at the character because the answer is about *its* level and
   * class, and asked on demand: the picker is the reader and a list stale the
   * moment the character levels has no business on a push.
   *
   * Empty for a level the client has not read. That is the honest answer and
   * not a shortcut: `trainsLevel` compares against a number, and guessing one
   * would offer a room the server refuses — the walk across two maps this
   * whole query exists to avoid.
   */
  trainers(): TrainerChoice[] {
    const state = this.tracker.current;
    const world = this.world;
    const level = state.progress.level;
    if (world === null || world === undefined || level === null) return [];
    const classId = state.className ? world.classId(state.className) : null;
    return world.trainersTaking(level, classId).map((found) => ({
      shop: found.trainer.id,
      name: found.trainer.name,
      map: found.map,
      room: found.room,
      roomName: found.roomName,
      cost: trainingCost(level, found.trainer.markup),
      minLevel: found.trainer.minLevel ?? null,
      maxLevel: found.trainer.maxLevel ?? null
    }));
  }

  /**
   * The order one quest step's several items are best fetched in (todo 01).
   *
   * The card's own question, addressed and asked on demand: the realm states
   * a step's items in the order its opcodes run, which is nobody's walk, and
   * `WorldGraph.errand` answers with the shortest one from where this
   * character is standing through a place for each of them and back to the
   * asker. Priced by **this** traveller, like every other plan main makes —
   * the lair, the room's own spell and the door that wants a strength this
   * character has not got all decide the order, and a walk chosen for
   * somebody else is a walk this one cannot take.
   *
   * Null for a step the realm does not hold, a character the client cannot
   * place, and a step with fewer than two things to go and get: all three are
   * *there is no walk to order here*, and the card then draws the item list
   * exactly as it did before.
   */
  questErrand(block: number): QuestErrand | null {
    const world = this.world;
    if (world === undefined) return null;
    const step = world
      .quests()
      .flatMap((quest) => quest.steps)
      .find((other) => other.block === block);
    if (step === undefined) return null;
    const here = roomAddress(this.tracker.current.room);
    if (here === null) return null;
    return world.errand(step, here, this.travellerNow(this.tracker.current));
  }

  /**
   * The plan to reach one step of a quest from where this character stands:
   * the steps still to do up to it, each with what it gathers, where it
   * happens and whether the way there exists (`WorldGraph.planStep`).
   *
   * **Paced across the event loop**, one step per turn, the way `FightLog`
   * folds a long file: each step is an A* per leg and a chain to its ninth
   * rank is nine of them, which held the socket's thread for over a second
   * on Paradigm when it was one call. A refusal answers nothing: no world, or
   * a block no quest holds.
   *
   * Where the counter stands is `questReading`, the card's own ranking with
   * the card's own mark handed in, so the plan and the track cannot start
   * from two different ranks. The traveller carries the counter the
   * character *will* hold at each step, since the way into a chain's later
   * rooms is routinely gated on the rank the step before hands out.
   */
  async questPlan(block: number, marked: number | null): Promise<QuestPlan | null> {
    const world = this.world;
    if (world === undefined) return null;
    const quest = world.quests().find((each) => each.steps.some((step) => step.block === block));
    if (quest === undefined) return null;
    // A later ask supersedes this chain: the answer would be thrown away by
    // the card, and nine A*s for it would still be paid on the socket's thread.
    this.planAsked += 1;
    const asked = this.planAsked;
    const state = this.tracker.current;
    const counters = countersNow(state.abilities ?? null, this.questSaid);
    const standing = questReading(quest.id, counters, this.questSaid, marked);
    const fromRank = standing.held ? standing.rank : null;
    // A complete listing that does not name the counter has stated it, at zero.
    const stated = standing.held || counters?.complete === true;
    const here = roomAddress(state.room);
    const carrying = packRows(state.inventory);
    const traveller = this.travellerNow(state);
    const steps: PlanStep[] = [];
    // What earlier legs decided to buy against a spell on the way, so a later
    // leg through the same rooms reads the spell as stopped rather than
    // buying a second waterskin.
    const supplies: number[] = [];
    let at: RoomId | null = here;
    let rank = fromRank ?? 0;
    let moves = 0;
    for (const step of planSpan(quest, block, fromRank)) {
      const before = step.from ?? rank;
      const priced = {
        ...traveller,
        counters: {
          sums: { ...(counters?.sums ?? {}), [quest.id]: before },
          complete: counters?.complete ?? false
        }
      };
      // The hunts are the errand's laps, so the plan reads them on the lap's
      // own traveller, carrying the same counter.
      const lap = { ...this.lapTraveller(state), counters: priced.counters };
      const planned = world.planStep(quest, step, at, carrying, priced, supplies, lap);
      // The odds of the step's roll off this character's own sheet, where
      // the sheet prints the stat the script names (todo 106).
      const chance =
        planned.roll === undefined
          ? null
          : rollChance(statFigure(state, planned.roll.stat), planned.roll.value);
      steps.push(
        planned.roll === undefined || chance === null
          ? planned
          : { ...planned, roll: { ...planned.roll, chance } }
      );
      moves += planned.moves ?? 0;
      for (const item of planned.items) {
        if (item.stops !== undefined && !supplies.includes(item.id)) supplies.push(item.id);
      }
      // The next leg starts where this act happens, reached or not: a plan
      // that stopped pricing at the first blocked room would say nothing
      // about the eight after it.
      if (planned.at !== undefined && world.byId(planned.at.room) !== undefined)
        at = planned.at.room;
      rank = step.to ?? rank;
      await new Promise<void>((next) => setImmediate(next));
      if (asked !== this.planAsked) return null;
    }
    const reachable = steps.some((step) => step.reachable === false)
      ? false
      : steps.every((step) => step.reachable === true)
        ? true
        : null;
    const fromPlace = here === null ? undefined : world.byId(here)?.name.trim();
    const money = this.cashFor(steps, state, here);
    return {
      block,
      ...(here === null ? {} : { from: here }),
      ...(fromPlace === undefined || fromPlace.length === 0 ? {} : { fromPlace }),
      fromRank,
      stated,
      steps: money.steps,
      reachable,
      moves,
      ...(money.cash === undefined ? {} : { cash: money.cash })
    };
  }

  /**
   * The plan's counters priced, and the cash for them found (todo 00): each
   * buy row takes what its counter charges, and the whole is set against the
   * purse and the vaults the record names — the question `Supplies` asks of
   * each purchase as the run makes it, asked once of the whole plan so the
   * card can say before the press that a run would stand at a counter.
   */
  private cashFor(
    steps: PlanStep[],
    state: CharacterState,
    here: RoomId | null
  ): { steps: PlanStep[]; cash?: PlanCash } {
    let owed = 0;
    let unpriced = 0;
    let bought = 0;
    let first: RoomId | null = null;
    const priced = steps.map((step) => ({
      ...step,
      items: step.items.map((item): PlanItem => {
        const source = item.source;
        if (source.how !== 'buy') return item;
        const copper =
          source.at === undefined || item.name === undefined
            ? null
            : this.priceAt(item.name, source.at.room);
        if (item.held !== true) {
          bought += 1;
          first ??= source.at?.room ?? null;
          // A top-up buys what the pack lacks of its ceiling, as `Supplies` does.
          const count =
            item.stock !== undefined && item.name !== undefined
              ? Math.max(0, (item.count ?? 1) - carriedCount(state, item.name))
              : (item.count ?? 1);
          if (copper === null) unpriced += 1;
          else owed += chargedInCopper(copper, state.progress.charm) * count;
        }
        return copper === null ? item : { ...item, source: { ...source, copper } };
      })
    }));
    if (bought === 0) return { steps: priced };
    const purse = state.inventory.wealth;
    const cash: PlanCash = { owed, unpriced, purse, short: false };
    // An unread purse and an unplaced character are unknown, never short.
    if (purse !== null && owed > purse && this.world !== undefined && here !== null) {
      const bank = this.world.cashPlaces(
        state.banks,
        owed - purse,
        here,
        first,
        this.travellerNow(state)
      )[0];
      if (bank === undefined) cash.short = true;
      else {
        cash.bank = {
          name: bank.name,
          room: roomId(bank.map, bank.room),
          place: bank.roomName,
          copper: bank.copper
        };
      }
    }
    return { steps: priced, cash };
  }

  /**
   * Run the plan to one step (todo 102): the card's *Run it*.
   *
   * The plan is drawn afresh here rather than taken from the card, for the
   * reason `walkPlan` redraws a route: it is true from the room it was drawn
   * in, and the press may come a minute later. What the card showed and what
   * is run are the same plan whenever the character has not moved, and the
   * run's own progress says which steps it is on either way. Returns the
   * refusal for the press, or null once it is under way.
   */
  async questRun(block: number, marked: number | null): Promise<string | null> {
    const quest = this.world
      ?.quests()
      .find((each) => each.steps.some((step) => step.block === block));
    if (quest === undefined) return t('automation.quests.refusalUnknownStep', { block });
    const plan = await this.questPlan(block, marked);
    if (plan === null) return t('automation.quests.refusalNoPlan');
    return this.questRunner.start(plan, quest, this.tracker.current);
  }

  /** The card's *Stop*: the run and whatever it started, put down out loud. */
  questStop(): void {
    this.questRunner.stop(t('automation.quests.whyStopped'));
  }

  /** How the quest run is going, for a window that has just attached. */
  get questRunProgress(): QuestRunProgress {
    return this.questRunner.progress;
  }

  /**
   * Where the realm says an item comes from, from where the character stands
   * and on the way to `to` (todo 07; re-ranked 2026-09-16): the counters that
   * stock it, least out of the way first, and the rooms anywhere in the realm
   * whose lair or resident is a monster that drops it, nearest first.
   *
   * **The counters are `WorldGraph.buyingPlaces`' answer, taken whole.** This
   * used to rank the realm's shop **names** by how near each one's room was,
   * and it had two ways of being wrong at once: a name standing in several
   * rooms was priced at infinity and sank to the bottom of the list whatever
   * was in it, and the winner was then handed on as a name for the shopping
   * errand to resolve — which refused it for the ambiguity this had just
   * created. Nearness was the wrong question besides: what matters is how far
   * off the road the stop is, and the router answers that.
   *
   * **The lairs are `WorldGraph.droppingPlaces`' answer, realm-wide**, never
   * the survey's: the survey ranks by what a lair *pays* and leaves out the
   * trivial, which is exactly the sort of monster that carries a key. And
   * **priced with the lap's own traveller**, since the loop that walks them is
   * planned with it (`mudengine-automation` › *A lap walks the shortest way*):
   * ranked on `travellerNow`, the lair's own danger walled the very rooms the
   * errand was going to fight in. The counters keep the route's prices, as a
   * shopping leg does.
   */
  private itemSources(item: { id: number; name: string }, to: RoomId | null): ItemSources {
    const world = this.world;
    const state = this.tracker.current;
    const here = roomAddress(state.room);
    if (world === undefined || here === null)
      return { shops: [], asks: [], droppers: [], lairs: [] };
    const traveller = this.travellerNow(state);
    const shops = world.buyingPlaces(item.id, here, to, traveller);
    // And where saying something gets it, walked as the counter is (todo 806).
    const asks = world.itemAsks(item.id, here, traveller);
    const { maxLoopRooms, clusterRadius } = tuning().hunting;
    const ring = { rooms: maxLoopRooms, radius: clusterRadius };
    return { shops, asks, ...world.droppingPlaces(item, here, this.lapTraveller(state), ring) };
  }

  /**
   * Where this character should hunt (todo 05; revamped 2026-09-13, todo 00).
   *
   * Every lair and placed monster the exits reach — `WorldGraph.withinSteps`,
   * unbounded unless `radius` says otherwise; a sweep, never a route per
   * room — grouped by what spawns and each group priced once with the Room
   * card's arithmetic (`weighVerdicts`) and the realm's own clock through
   * `estimateSpot`. Two exclusions before the ranking, counted and said: a
   * room whose one cycle costs more than `maxDamageShare` of the bar, and
   * one that could not scratch an unarmoured character. The best `maxSpots`
   * are then measured properly (`measuredSpot`) and ranked again, with the
   * one `measure` names; the rest come back unmeasured, since the answer is
   * the realm. Distance is a column, not a bound: the walk there is automated.
   */
  huntingGrounds(radius: number | null, measure: string | null = null): HuntingAdvice {
    const state = this.tracker.current;
    const world = this.world;
    // Every figure the model runs on, named here so each has a reader.
    const {
      roundSeconds,
      restTickSeconds,
      passiveTickSeconds,
      killOverheadMs,
      stepMs,
      greatermudRespawnOffsetSeconds,
      backstabMultiplier,
      maxLoopRooms,
      maxSpots,
      betterSpotRadius,
      maxDamageShare,
      trivialShare,
      trivialLevelMargin,
      clusterRadius,
      fillerRadius,
      sizeTolerance,
      measuredFightsMin
    } = tuning().hunting;
    const c: HuntingConstants = {
      roundSeconds,
      restTickSeconds,
      passiveTickSeconds,
      killOverheadMs,
      stepMs,
      greatermudRespawnOffsetSeconds,
      backstabMultiplier,
      maxLoopRooms,
      maxSpots,
      betterSpotRadius,
      maxDamageShare,
      trivialShare,
      trivialLevelMargin,
      clusterRadius,
      fillerRadius,
      sizeTolerance
    };
    const { combat, magery, family } = this.realmClass();
    const sheet = prowessSheetOf(state, { combat, magery });
    const regen = regeneration(sheet, null, family);
    const backstab = commandOf(this.automationConfig.combat.opener.trim()) === 'BackStab';
    /*
     * One step is the server's own movement delay from the pack's weight
     * (`MoveCommand.cs:40`), where the family states one; the measured round
     * otherwise. A full pack slows the whole loop, and the estimate says so.
     */
    const step = moveDelayMs(
      state.inventory.encumbrance,
      state.inventory.encumbranceMax,
      family,
      c.stepMs
    );
    const heal = this.healingCast(state);
    /*
     * `RestCommand.cs:28` refuses a poisoned character, immunity excepted
     * (`poisonRefusesRest`). A cure — a configured spell, an antidote rule, or
     * one the book would yield under `autoChoose` — lifts it for the estimate.
     */
    const poisonHoldsRest =
      poisonRefusesRest(this.capabilities(), family) && !this.curesPoison(state);
    const character: SpotCharacter = {
      hpMax: state.vitals.hpMax,
      restingHealthPerTick: regen?.restingHealth.value ?? null,
      passiveHealthPerTick: regen?.health.value ?? null,
      backstab,
      /*
       * The caster's half (todo 26). A round costs mana only where a round
       * spell is configured — or derived under `autoChoose` — so a melee
       * character carries null here and the cycle is exactly what it was.
       * **Meditating is not resting tripled**: `TimedEventManager` gives a
       * resting character `HPRegen * 3` and a meditating one
       * `GetBaseMARegen()` flat, so the mana rate is the standing rate.
       */
      ...this.castingCost(state),
      meditatingManaPerTick: regen?.meditatingMana?.value ?? null,
      passiveManaPerTick: regen?.mana?.value ?? null,
      stepMs: step,
      heal,
      poisonHoldsRest
    };
    const assumptions: HuntingAssumptions = {
      family,
      hpMax: state.vitals.hpMax,
      restingHealthPerTick: character.restingHealthPerTick,
      backstab,
      stepMs: step,
      heal,
      poisonHoldsRest,
      measured: null,
      constants: c
    };
    const refused = (refusal: string): HuntingAdvice => ({
      from: null,
      radius,
      swept: 0,
      spots: [],
      unmeasured: [],
      excluded: { dangerous: 0, beneath: 0 },
      assumptions,
      refusal
    });
    if (!world || world.size === 0) return refused(t('session.hunt.noRealmData'));
    const here = state.room;
    if (here.map === null || here.number === null) return refused(t('session.hunt.unknownRoom'));
    const from = roomId(here.map, here.number);
    const start = world.byId(from);
    if (!start) return refused(t('session.hunt.unknownRoom'));

    /*
     * **Priced by this traveller** (todo 09): a lair behind a door this
     * character cannot open is not a lair it can hunt, and the survey was
     * offering them — a loop started on one plans a leg, is refused, and
     * stands still. The sweep is still one pass over the rooms; what changed
     * is that an impassable exit is not an exit.
     */
    const reach = world.withinSteps(
      from,
      radius ?? Number.POSITIVE_INFINITY,
      this.travellerNow(state)
    );
    /*
     * Grouped by what spawns, not by name: two rooms naming the same rows at
     * the same cap are one hunting ground with two rooms in it, which is
     * what a loop is made of. `groupOfRoom` is the join a filler is found by.
     */
    const groups = new Map<string, HuntGroup>();
    const groupOfRoom = new Map<RoomId, string>();
    for (const [id, steps] of reach) {
      const room = world.byId(id);
      if (!room) continue;
      let key: string;
      let via: 'lair' | 'resident';
      let spawns: number | null = null;
      if (room.lair) {
        const lair = parseLair(room.lair);
        // The clock is part of what spawns: two rooms naming the same rows on
        // different delays are two hunting grounds, and a price is cached by key.
        key = `lair:${lair.max ?? 1}:${[...lair.ids].sort((a, b) => a - b).join(',')}:${room.delay ?? ''}`;
        via = 'lair';
        spawns = lair.max;
      } else if (room.npcId !== undefined) {
        key = `resident:${room.npcId}`;
        via = 'resident';
      } else {
        continue;
      }
      const entry = groups.get(key) ?? { rooms: [], sample: room, via, spawns };
      entry.rooms.push({ id, map: room.map, room: room.room, name: room.name, steps });
      groups.set(key, entry);
      groupOfRoom.set(id, key);
    }

    const player = this.menacePlayer(state);
    // The same character with nothing on: every blow lands, at its full figure.
    const naked: MenacePlayer = { armourClass: 0, damageResist: 0, magicRes: player.magicRes };
    const weapon = wieldedWeapon(state.inventory.items);
    const weights = tuning().menace;
    /*
     * The caster's rounds (todo 108). `verdictFor` gets a fight's length from
     * the swing, and a Mage's swing is nothing worth counting; where the swing
     * says nothing, the spell the character would cast at *this* monster, at
     * one cast a round over the full pool, says it.
     */
    const casting = this.castingInput(state, sheet, family);
    /*
     * Where the arithmetic *declines* — `swing` is null only on the family
     * gate or an unread accuracy, neither of which reads the target, and a
     * book with no attack spell casts nothing — a kill is priced from what
     * this character has measured dealing a round. Where either *refuses*
     * (no blow lands, the spell is resisted), the refusal stands.
     */
    const blank = { armourClass: null, damageResist: null, dodge: null, health: null };
    const declines =
      swing(sheet, weapon, blank, family) === null &&
      (casting === null ||
        chooseAttackSpell({ ...casting, target: null, excluded: new Set() }).refusal ===
          'no-attack-spells');
    const level = state.progress.level;
    const measured =
      !declines || level === null
        ? null
        : (this.fightRecord.measured?.(level, {
            least: measuredFightsMin,
            roundMs: roundSeconds * 1000,
            openerRounds: backstab ? backstabMultiplier : 1
          }) ?? null);
    const priceKey = [
      this.fitness(state),
      this.automationConfig.spells.attack,
      this.automationConfig.spells.autoChoose,
      this.automationConfig.combat.opener,
      state.spellbook?.length ?? -1,
      state.vitals.manaMax,
      measured === null ? '-' : Math.round(measured.perRound)
    ].join('|');
    if (this.huntPrices?.key !== priceKey || this.huntPrices.world !== world) {
      this.huntPrices = { key: priceKey, world, groups: new Map() };
    }
    const remembered = this.huntPrices.groups;
    /** One group's monsters priced, and its clock: the half a move does not change. */
    const price = (group: HuntGroup): HuntPrice | null => {
      const entities =
        group.via === 'lair'
          ? world.lairEntities(group.sample)
          : world.residentEntities(group.sample);
      if (entities.length === 0) return null;
      const verdicts = weighVerdicts(entities, player, weights, sheet, weapon, family);
      const bare = weighRoom(entities, naked, weights);
      const recorded = (hp: number | null): number | null =>
        measured === null || hp === null || hp <= 0 ? null : hp / measured.perRound;
      const mobs: SpotMob[] = entities.map((entity, index) => ({
        name: entity.name,
        experience: entity.experience ?? null,
        rounds:
          verdicts[index]?.rounds?.value ??
          (casting === null
            ? null
            : (castsToKill(casting, {
                hp: verdicts[index]?.menace?.hp ?? entity.hp ?? null,
                magicRes: entity.magicResist ?? null,
                abilities: entity.abilities
              })?.rounds ?? null)) ??
          recorded(verdicts[index]?.menace?.hp ?? entity.hp ?? null),
        perRound: verdicts[index]?.menace?.perRound ?? null,
        nakedPerRound: bare[index]?.perRound ?? null,
        afflictions: afflictionsOf(entity),
        /*
         * A row the realm gives a clock of its own (todo 09): the Gravedigger
         * is 1,500 points on an hour's regeneration, and a lair holding it was
         * priced as though it came back with the rest of the room.
         * `estimateSpot` weights its experience by how often it is up.
         */
        regenSeconds: entity.regenHours === undefined ? null : entity.regenHours * 3600
      }));
      const clock: HuntingSpot['clock'] =
        group.via === 'lair'
          ? group.sample.delay === undefined
            ? null
            : 'delay'
          : (entities[0]?.regenHours ?? null) === null
            ? null
            : 'regenTime';
      const respawn =
        group.via === 'lair'
          ? respawnSeconds(group.sample.delay ?? null, family, c)
          : entities[0]?.regenHours === undefined
            ? null
            : entities[0].regenHours * 3600;
      return { mobs, clock, respawn };
    };
    const priced = new Map<string, HuntPriced>();
    const excluded = { dangerous: 0, beneath: 0 };
    const survey: HuntingSpot[] = [];
    for (const [key, group] of groups) {
      let known = remembered.get(key);
      if (known === undefined) {
        const fresh = price(group);
        if (fresh === null) continue;
        remembered.set(key, fresh);
        known = fresh;
      }
      const { mobs, clock, respawn } = known;
      const rooms = [...group.rooms].sort((a, b) => a.steps - b.steps);
      const entry: HuntPriced = { key, group, mobs, clock, respawn, rooms };
      /*
       * A first estimate to rank on and to exclude by: the nearest rooms, the
       * ring's length guessed from the sweep's distances — out to the farthest
       * and back, a step between neighbours. The best are then measured.
       */
      const loop = group.via === 'lair' ? rooms.slice(0, c.maxLoopRooms) : rooms.slice(0, 1);
      const guessed =
        loop.length <= 1
          ? 0
          : 2 * (loop[loop.length - 1]!.steps - loop[0]!.steps) + 2 * (loop.length - 1);
      const estimate = estimateSpot(
        {
          rooms: loop.length,
          spawns: group.spawns,
          mobs,
          respawnSeconds: respawn,
          loopSteps: guessed,
          character,
          filler: []
        },
        c
      );
      if (estimate.deadly || estimate.costly) {
        excluded.dangerous += 1;
        continue;
      }
      if (estimate.trivial) {
        excluded.beneath += 1;
        continue;
      }
      priced.set(key, entry);
      survey.push({
        key,
        mobs,
        clock,
        boss: clock === 'regenTime',
        respawnSeconds: respawn,
        spawns: group.spawns,
        rooms: loop,
        filler: [],
        walk: loop,
        roomCount: rooms.length,
        loopSteps: guessed,
        estimate
      });
    }
    survey.sort(compareSpots);
    /*
     * Only the best are measured: a bounded sweep from each of a ring's rooms
     * is under a millisecond and there are thousands of groups, so the survey
     * ranks on the guess and measures `maxSpots` of them. A spot just below
     * the cut could measure into it; the guess is the same shape for all, so
     * the order it gives is the order the measurement mostly keeps. The rest
     * are handed back unmeasured rather than dropped: measuring all 910 of
     * Paradigm's cost 1.1s, and a list cut at twenty-four is not the realm.
     * The one a reader opened is measured too, so what it walks is a ring.
     */
    const rest = survey.slice(c.maxSpots);
    const opened = rest.findIndex((spot) => spot.key === measure);
    const chosen = survey.slice(0, c.maxSpots);
    if (opened !== -1) chosen.push(rest[opened]!);
    const spots = chosen.map((spot) =>
      this.measuredSpot(
        spot,
        priced.get(spot.key)!,
        priced,
        groupOfRoom,
        reach,
        character,
        c,
        world
      )
    );
    spots.sort(compareSpots);
    return {
      from: { id: from, name: start.name },
      radius,
      swept: reach.size,
      spots,
      unmeasured: opened === -1 ? rest : rest.filter((_, at) => at !== opened),
      excluded,
      assumptions: { ...assumptions, measured },
      refusal: null
    };
  }

  /**
   * One surveyed spot, measured: the ring's legs by a bounded sweep from each
   * of its rooms (`orderRing`), its size by the clock (`sizeLoop`), and the
   * clocked lairs of other admissible groups within `fillerRadius` of a ring
   * room added while each raises the rate (`addFiller`). A filler hangs off
   * the ring room it was found from, and the walk lists it there.
   */
  private measuredSpot(
    spot: HuntingSpot,
    own: HuntPriced,
    byKey: ReadonlyMap<string, HuntPriced>,
    groupOfRoom: ReadonlyMap<RoomId, string>,
    reach: ReadonlyMap<RoomId, number>,
    character: SpotCharacter,
    c: HuntingConstants,
    world: WorldGraph
  ): HuntingSpot {
    const candidates =
      own.group.via === 'lair' ? own.rooms.slice(0, c.maxLoopRooms) : own.rooms.slice(0, 1);
    if (candidates.length === 0) return spot;
    const sweeps = new Map<RoomId, Map<RoomId, number>>();
    // Priced by the traveller, as the survey's own sweep is: a ring whose
    // rooms are separated by a door this character cannot open is not a ring
    // it can walk, and the step count would be a fiction either way.
    const priced = this.travellerNow(this.tracker.current);
    for (const room of candidates) {
      sweeps.set(room.id, world.withinSteps(room.id, c.clusterRadius, priced));
    }
    const distance = (a: RoomId, b: RoomId): number | null =>
      sweeps.get(a)?.get(b) ?? sweeps.get(b)?.get(a) ?? null;
    const { order, ringSteps } = orderRing(candidates, distance);
    const base = (rooms: number): SpotInput => ({
      rooms,
      spawns: own.group.spawns,
      mobs: own.mobs,
      respawnSeconds: own.respawn,
      loopSteps: ringSteps(rooms),
      character,
      filler: []
    });
    const sized = sizeLoop(base, candidates.length, c);
    const ring = order.slice(0, sized.rooms);

    const offers: Array<{ room: HuntingRoom; after: number; input: FillerInput }> = [];
    const seen = new Set<RoomId>(candidates.map((room) => room.id));
    for (const [at, room] of ring.entries()) {
      const near = sweeps.get(room.id);
      if (near === undefined) continue;
      for (const [id, steps] of near) {
        if (steps === 0 || steps > c.fillerRadius || seen.has(id)) continue;
        const key = groupOfRoom.get(id);
        if (key === undefined || key === own.key) continue;
        const other = byKey.get(key);
        // A filler is a clocked lair another admissible group holds; a placed
        // boss is its own spot, and a room with no clock is hunted on luck.
        if (other === undefined || other.respawn === null || other.group.via !== 'lair') continue;
        const found = world.byId(id);
        if (!found) continue;
        seen.add(id);
        offers.push({
          room: {
            id,
            map: found.map,
            room: found.room,
            name: found.name,
            steps: reach.get(id) ?? room.steps + steps,
            mobs: other.mobs.map((mob) => mob.name),
            detour: 2 * steps,
            // Its own clock, which the survey already required of a filler —
            // and which the lap needs on the stop to walk the detour only on
            // the laps the room is standing (todo 15, `LoopStop.every`).
            respawnSeconds: other.respawn
          },
          after: at,
          input: {
            spawns: other.group.spawns,
            mobs: other.mobs,
            respawnSeconds: other.respawn,
            detourSteps: 2 * steps
          }
        });
      }
    }
    offers.sort((a, b) => a.input.detourSteps - b.input.detourSteps);
    const filled = addFiller(
      base(sized.rooms),
      offers.map((offer) => offer.input),
      c.maxLoopRooms,
      c
    );
    const taken = filled.taken.map((index) => offers[index]!);
    const walk: HuntingRoom[] = [];
    ring.forEach((room, at) => {
      walk.push(room);
      for (const offer of taken) if (offer.after === at) walk.push(offer.room);
    });
    const estimate: SpotEstimate = filled.estimate;
    return {
      ...spot,
      rooms: ring,
      filler: taken.map((offer) => offer.room),
      walk,
      loopSteps:
        ringSteps(sized.rooms) + taken.reduce((sum, offer) => sum + offer.input.detourSteps, 0),
      estimate
    };
  }

  /**
   * The configured heal, priced from its realm row: what one cast mends and
   * what it costs. Null where nothing is configured, the realm cannot name
   * it, the row carries no heal at all, or the cost is unstated — an unpriced
   * heal costs the estimate nothing, since resting is still the way the cycle
   * recovers.
   *
   * `healPower` is the one reading of what a cast mends, shared with
   * `chooseHealSpell` (todo 01): the survey and the healer must not disagree
   * about what a spell is worth.
   */
  private healingCast(state: CharacterState): HealingCast | null {
    const name = this.automationConfig.spells.heal.trim();
    if (name.length === 0 || this.world === undefined) return null;
    const spell = this.world.spellNamed(name);
    if (spell === null || spell === undefined) return null;
    const level = state.progress.level;
    if (level === null) return null;
    const power = healPower(spell, level);
    const mana = spell.mana ?? null;
    if (power === null || mana === null) return null;
    const hp = (power[0] + power[1]) / 2;
    if (hp <= 0) return null;
    return { hpPerCast: hp, manaPerCast: mana };
  }

  /**
   * Whether anything this character has ends a poison: a configured cure, an
   * antidote rule under `health.potions`, or — under `autoChoose`, where the
   * blank cure box is filled from the book — a spell the read book holds that
   * the realm says serves it. An unread book yields nothing.
   */
  private curesPoison(state: CharacterState): boolean {
    const { spells, health } = this.automationConfig;
    if (spells.cures.poison.trim().length > 0) return true;
    if (health.potions.some((rule) => rule.when === 'poisoned' && rule.name.trim().length > 0)) {
      return true;
    }
    if (!spells.autoChoose || state.spellbook === null || this.world === undefined) return false;
    const world = this.world;
    return state.spellbook.some(
      (known) => spellServes(world.spellNamed(known.name)?.abilities).poisoned
    );
  }

  /**
   * What the pack holds, as `Items` row ids, for a keyed door and an item
   * gate — one question the server answers one way, so one field.
   *
   * **Both halves of the listing**, because the server prints them as two:
   * `You are carrying …` and `You have the following keys: bone key.` are
   * separate lines and separate fields, and a keyed door asked only about
   * the first would find no key in a pack that has one.
   *
   * Only the names the realm places, and only where a name resolves to a
   * single row: twenty of the shipped realm's item names are shared, four
   * of them keys, and a pack that guessed which `iron key` it was carrying
   * would open a door on a coin toss. The pack itself is the maintained
   * listing (`replayPack`), so this is as current as the last `i` plus
   * every pick-up since.
   *
   * **The join itself moved onto the state** (2026-09-15): `Inventory.rows` is
   * made at the tracker's one commit point, so the quest book can tick what is
   * carried without a second reading of the same question in the window — and
   * the A* stopped re-walking the whole pack for every room it expands that
   * casts something.
   *
   * `packKnown` says whether that list is an answer or a silence. MegaMUD asks
   * `i` while it does not know the pack (`refreshInventory`), so it is true
   * soon after entering the realm — but until then, a character must not
   * silently become
   * a character whose every keyed door is a wall.
   *
   * **Its own method because two things ask it** (2026-09-06): the router,
   * through `travellerNow`, and `AutoKeys`, which decides whether to pick a
   * key up off the floor. Those two reading the pack differently is the "two
   * halves of one gate in two files" failure at its worst — the client would
   * bend down for a key it already had, or stand on one it needed.
   */

  /**
   * What the engine's walk or loop is waiting on the item errand for: taken
   * up once the errand lets go with the pack holding every item, dropped
   * (the errand has said why) otherwise.
   */
  private afterFetch: { items: Array<{ id: number; name: string }>; then: AfterFetch } | null =
    null;

  /**
   * A way the engine was refused for want of a key or an item: the errand
   * sent for it (bought, or hunted off its droppers), and the walk or loop
   * started again after. Out of the engine's own call, which the errand's
   * loop would otherwise start inside (2026-10-16).
   */
  private megaFetchFirst(
    items: ReadonlyArray<{ id: number; name: string }>,
    then: AfterFetch
  ): void {
    queueMicrotask(() => {
      const state = this.tracker.current;
      const refused = this.itemErrand.collect([...items], null, state);
      if (refused !== null) {
        this.sink.notice(refused);
        return;
      }
      this.afterFetch = { items: [...items], then };
      this.takeUpAfterFetch(state);
    });
  }

  private takeUpAfterFetch(state: CharacterState): void {
    const owed = this.afterFetch;
    const mega = this.mega;
    if (owed === null || this.itemErrand.running) return;
    this.afterFetch = null;
    if (mega === null || owed.items.some((item) => carriedCount(state, item.name) === 0)) return;
    const then = owed.then;
    const refused = this.megaAct(() =>
      'loop' in then ? mega.startLoop(then.loop) : mega.walkTo(then.walkTo, false, true)
    );
    if (refused !== null) this.sink.notice(refused);
  }

  /**
   * Whether an item on the floor opens a way of this realm the pack lacks —
   * a `Key:` lock's or an `Item:` exit's — for the engine to take it whatever
   * its item rules say (`movement.collectKeys`, as `AutoKeys` reads it).
   */
  private opensAWay(name: string): boolean {
    const world = this.world;
    if (!world || !this.automationConfig.movement.collectKeys) return false;
    const id = world.itemIdNamed(name);
    if (id === null || !this.gateItems(world).has(id)) return false;
    const pack = this.packContents(this.tracker.current);
    return pack.packKnown && !pack.keys.includes(id);
  }

  /** The items some exit of the realm asks for, worked out once per realm. */
  private gateItems(world: WorldGraph): Set<number> {
    if (this.gateItemsOf?.world === world) return this.gateItemsOf.ids;
    const ids = new Set<number>();
    for (const room of world.everyRoom()) {
      for (const exit of room.exits) {
        const req = exit.requirement;
        if ((req?.kind === 'key' || req?.kind === 'item') && req.keyId !== undefined)
          ids.add(req.keyId);
      }
    }
    this.gateItemsOf = { world, ids };
    return ids;
  }

  private gateItemsOf: { world: WorldGraph; ids: Set<number> } | null = null;

  private packContents(state: CharacterState): { keys: number[]; packKnown: boolean } {
    return { keys: state.inventory.rows, packKnown: state.inventory.listedAt !== null };
  }

  /**
   * What the realm says the exits of the room being stood in demand.
   *
   * The **realm's** exit list rather than the printed one, because that is
   * what the router plans through: it holds hidden exits the server never
   * prints, and a key picked up for a door the client has not found yet is
   * still the key the route will want. An unplaced room has no list, which is
   * the refusal every other realm lookup makes rather than guessing.
   */
  private keyedWaysHere(state: CharacterState): KeyedWay[] {
    const { map, number } = state.room;
    if (!this.world || map === null || number === null) return [];
    const room = this.world.get(map, number);
    if (room === undefined) return [];
    const ways: KeyedWay[] = [];
    for (const exit of room.exits) {
      const requirement = exit.requirement;
      if (requirement === null) continue;
      // Both instructions that name an item, because `edgeBlock` reads both
      // the same way: a `Key:` lock and an `Item:` gate ask *is this thing in
      // the pack*, and one of them bending down and the other not would be
      // one gate answered two ways.
      if (requirement.kind !== 'key' && requirement.kind !== 'item') continue;
      if (requirement.keyId === undefined) continue;
      // The realm's own name for the row travels with it, so `AutoKeys` can
      // tell *this floor holds nothing relevant* from *this floor holds
      // something of that name and the realm has three of them* — and say the
      // second one out loud instead of standing there.
      const named = this.world.item(requirement.keyId)?.name;
      ways.push({
        keyId: requirement.keyId,
        direction: exit.direction,
        ...(named === undefined ? {} : { itemName: named })
      });
    }
    return ways;
  }

  /**
   * The corridors of every route this character prefers, derived once from
   * its loops and kept until the loops or the realm change.
   *
   * Derived here rather than in the graph because a stop is resolved the way
   * a loop's stop is (`findStop`), and a route with a stop the realm cannot
   * settle is said out loud once — a preference that silently prefers
   * nothing is a setting somebody edits and then waits to see work. Each leg
   * by `lapTraveller`, so the corridor preferred is the one the lap walks.
   */
  preferredEdges(): ReadonlySet<string> {
    if (this.preferred !== null) return this.preferred;
    if (!this.world) return NO_EDGES;
    const found = preferredEdges(
      this.world,
      this.automationConfig.loops,
      (stop) => {
        const room = this.findStop(stop);
        return typeof room === 'string' ? null : roomId(room.map, room.room);
      },
      this.lapTraveller(this.tracker.current)
    );
    for (const name of found.unresolved) {
      this.sink.notice(t('session.loop.preferUnresolved', { loopName: name }));
    }
    this.preferred = found.edges;
    return found.edges;
  }

  /** Where a loop's stop is, by name and optional coordinates. */
  private findStop(stop: {
    name: string;
    at: { map: number; room: number } | null;
  }): { map: number; room: number } | string {
    if (stop.at) return stop.at;
    const found = this.world?.findByName(stop.name) ?? [];
    if (found.length === 0) return t('session.loop.unknownStopName', { name: stop.name });
    // Thirteen rooms are called Town Gates; a loop that guessed which would
    // walk somewhere the player did not mean.
    if (found.length > 1) {
      return t('session.loop.ambiguousStopName', {
        count: found.length,
        name: stop.name,
        map: found[0]!.map,
        room: found[0]!.room
      });
    }
    return { map: found[0]!.map, room: found[0]!.room };
  }

  /**
   * What the console draws beside a room's name: the glyph for the kind of
   * place it is, and the buttons for what can be done there.
   *
   * Asked on the *name* line, which is before `Obvious exits:` has completed
   * the room and resolved which of the thirteen Town Gates this is — so both
   * halves are answered from the name and both refuse a name whose rooms
   * disagree (`placeNamed`, `exitCommandsNamed`). Guessing here would put a
   * button on screen that sends a command the room does not take, and an
   * unrecognised command on this server is *said out loud* to everybody
   * standing in it.
   *
   * A room with actions and no shop is still worth marking: `go manhole` is a
   * plain room whose only way onward is a command nobody can see. The glyph
   * falls back to `shop` there, because a mark must name an icon and the
   * buttons beside it are already saying what the place offers.
   *
   * **A peeked room gets the glyph and no buttons.** `l n` prints the
   * neighbour in full and nothing in it says the character is not standing
   * there — the settled decision the expectation queue exists for. A glyph
   * against a peeked room is a label and was always tolerable; a *button* is
   * not, because pressing it sends the neighbour's command into the room the
   * character is actually in, and `go manhole` typed where there is no manhole
   * is said out loud to everybody present.
   */
  private markFor(block: Block): TerminalMark | undefined {
    if (!this.internal.terminal.enrich || block.type !== 'room-name') return undefined;
    const name = block.text.trim();
    const place = this.world?.placeNamed(name);
    const kind = place && place.kind !== 'tavern' ? place.kind : undefined;
    /*
     * The vault standing in front of the character, by the name the realm data
     * gives its shop and then by the room's own name — both through `bankKey`,
     * because the bank's header and the realm file need not agree on an
     * article (`The Bank of Godfrey` against `Bank of Godfrey`). A vault that
     * matches neither has not been asked, and offers no withdrawal.
     */
    const banks = this.tracker.current.banks;
    const vault =
      (place?.shop === undefined
        ? undefined
        : banks.find((held) => bankKey(held.name) === bankKey(place.shop))) ??
      banks.find((held) => bankKey(held.name) === bankKey(name));
    const actions = this.tracker.nextRoomIsPeek
      ? []
      : actionsFor(
          kind,
          this.world?.exitCommandsNamed(name) ?? [],
          this.tracker.current.inventory.wealth,
          vault?.copper ?? null
        );
    if (!kind && actions.length === 0) return undefined;
    const mark: TerminalMark = {
      icon: kind ?? 'shop',
      label: place?.shop ?? name
    };
    if (actions.length > 0) mark.actions = actions;
    return mark;
  }

  /** The rounded percentage a safety notice reports, e.g. `43%`. */

  /**
   * A death moves the character, and nothing may go on moving it afterwards.
   *
   * The realm puts a dead character in its area's temple. That is a room
   * nobody chose, several maps from wherever the route, the loop or the
   * retreat was planned — so every one of those is now a plan about a place
   * the character is not, and carrying on with it walks a one-life-lighter
   * character back towards what killed it. **Nothing here is a setting.** The
   * loop is stopped, not unconfigured; auto-combat, resting and the rest are
   * untouched, because standing in a temple deciding to heal is exactly right.
   *
   * Two things go, and they are the two that hold a *destination*:
   *
   * - **A running loop.** Stopped rather than forgotten, like every other
   *   stop: it keeps its place, and pressing play plans afresh from wherever
   *   the character is — which after this is the temple, and far enough from
   *   the lap that `startMoving` asks before walking it back.
   * - **An armed safe-haven retreat.** It is spent when the fight ends, and a
   *   death *is* the fight ending: without this the next status line plans a
   *   route from the temple to a haven chosen for a fight that is already
   *   over. Said out loud, like every other retreat outcome.
   *
   * The walk is the walker's own to end, on the same block — see its
   * `user-dies` case, which stops on the sentence rather than two lines later
   * on the temple's room block, and cancels every queued movement intent with
   * it. What has already reached the wire cannot be recalled; the queue is
   * where the decision is still revisable.
   */
  /**
   * A route the player asked for, with the supply list consulted first.
   *
   * The one path a person's own route takes (`Invoke.walkRoute`), and the
   * second of the two moments a supply errand may start — the first being a
   * running lap. Being about to travel is the whole reason the pack matters,
   * so the check happens here rather than on every status line: a character
   * standing still, freshly killed and stripped in the temple, is not about to
   * travel and has no business being walked to a shop.
   *
   * The errand takes precedence and the route is owed back, so the order is
   * shop, then go. Nothing is queued twice: the errand's walk is already out
   * by the time this returns, and the route is planned afresh from the shop
   * when the errand lets go (`walkOnAfterErrand`).
   */
  /**
   * Collect what the way needs, then walk it (todo 07).
   *
   * The one door for *collect it first* — the route panel's tick beside its
   * *Walk it*, offered on whichever way is on screen where that way names
   * items (`itemsWanted`) — every one of them, fetched in turn. The errand
   * reports its own refusal back to the window that pressed, because a person
   * is looking at the answer.
   */
  collectThenWalk(
    items: Array<{ id: number; name: string }>,
    route: Route,
    run = false
  ): string | null {
    return this.unchosen(route) ?? this.itemErrand.collect(items, route, this.tracker.current, run);
  }

  /**
   * Why a way through what the player keeps out of cannot be walked yet, or
   * null (todo 806). The panel drops `keptOut` once the player picks between
   * the way through and the way round, so a route still carrying it is one
   * nobody chose — the palette's *Go to*, or anything else that walks a plan
   * it did not read — and walking it would make the choice for them.
   */
  private unchosen(route: Route): string | null {
    if (route.keptOut === undefined) return null;
    return t('session.walk.keptOutChoose', { wordList: route.keptOut.words.join(', ') });
  }

  /**
   * The press on the plan the panel is showing — the one door a person's own
   * route comes through (`Invoke.walkRoute`). The engine's Go To plans its
   * own way from wherever the character now stands, so a plan drawn before a
   * move is not walked stale; only a way through something kept out of that
   * the player has not chosen to cross is refused (todo 806). `run` is *Run
   * it* (todo 06).
   */
  walkPlan(route: Route, run = false): WalkStart {
    const unchosen = this.unchosen(route);
    if (unchosen !== null) return { refused: unchosen };
    return this.started(route, run);
  }

  /** `walkRoute`'s answer as the press's union. */
  private started(route: Route, run: boolean): WalkStart {
    const refused = this.walkRoute(route, run);
    return refused === null ? { started: true } : { refused };
  }

  /**
   * A route the player asked for, walked (`run`: with combat off) by MegaMUD's
   * Go To, **alone**: the loop it had loaded let go. MegaMUD takes up whatever
   * loop path it still holds on arriving (`resumeLoop`, `0x43d2a0`), and Stop
   * leaves the path loaded, so a route walked after a lap was stopped — or
   * during one — walked back into that lap (2026-10-16). A loop is taken up
   * again only where a restart or a lost line stopped it (`megaEnteredGame`).
   */
  walkRoute(route: Route, run = false): string | null {
    // MegaMUD's Go To: the room the route ends in, the way its own.
    const end = route.steps.at(-1)?.to;
    if (end === undefined) return null;
    const mega = this.mega;
    if (mega === null) return t('session.megamud.noEngine');
    // The counters, if this way turns on one nobody has read yet.
    this.askCountersFor(route);
    const refused = this.megaAct(() => mega.walkTo(end, run, true));
    if (refused === null) this.keepMovement({ to: end, run });
    return refused;
  }

  /** One room back the way the character came, per press: MegaMUD's Step Back. */
  stepBack(): MovementStart {
    // MegaMUD's Step Back (`0x869`).
    if (this.mega === null) return { refused: t('session.megamud.noEngine') };
    this.mega.press(WindowCommand.StepBack);
    return { started: true };
  }

  /** The engine's walk, as the cards draw it. */
  get walkProgress(): WalkProgress {
    return this.mega?.progress.walk ?? IDLE_WALK;
  }

  /** The engine's loop, as the cards draw it, with the experience at its run's start. */
  get loopProgress(): LoopProgress {
    const loop = this.mega?.progress.loop ?? NO_LOOP;
    return loop === NO_LOOP ? loop : { ...loop, expAtStart: this.megaLoopRun.exp };
  }

  /** What this character is doing about going anywhere: the engine's walk and loop. */
  get movement(): Movement {
    const progress = this.mega?.progress;
    return movementOf(progress?.walk ?? IDLE_WALK, progress?.loop ?? NO_LOOP);
  }

  /** Stop moving: MegaMUD's Go/Stop, whichever of a route and a loop it is walking. */
  stopMoving(): void {
    // MegaMUD's Stop: its Go/Stop button, when it is going.
    if (this.mega?.walking === true) this.mega.button(WindowCommand.GoStop);
    // The one door a person's stop comes through, so it is the one place that
    // can tell a hunt it was stopped *by somebody* rather than by the realm.
    this.hunt.noteStopped();
  }

  /**
   * Start moving: the named loop made MegaMUD's loop (`@loop`), or with none
   * its Go, picking up whatever it was walking.
   */
  startMoving(loopName: string | null): MovementStart {
    const mega = this.mega;
    if (mega === null) return { refused: t('session.megamud.noEngine') };
    // A loop named is made MegaMUD's loop (`@loop`); none is its Go.
    if (loopName !== null) {
      const refused = this.megaAct(() => mega.startLoop(loopName));
      return refused === null ? { started: true } : { refused };
    }
    if (!mega.walking) this.megaAct(() => mega.button(WindowCommand.GoStop));
    return mega.walking ? { started: true } : { refused: t('session.move.nothingToResume') };
  }

  /**
   * A lap asked for, from the palette, the shelf, the card or an action kept
   * beside the engine: made MegaMUD's loop by name, one filed nowhere (a
   * hunt's) kept for the engine to find (`megaLoops`).
   */
  startLoop(loop: Loop): MovementStart {
    const mega = this.mega;
    if (mega === null) return { refused: t('session.megamud.noEngine') };
    if (this.loopNamed(loop.name) === undefined) this.megaLoops.set(loop.name, loop);
    const refused = this.megaAct(() => mega.startLoop(loop.name));
    return refused === null ? { started: true } : { refused };
  }

  /**
   * What the counter in this room charges for one of a thing by this name, in
   * copper before charm — the shelf row the name answers to, priced by the
   * realm (`WorldGraph.priceAt`). Null where the room holds no counter, the
   * shelf no such row, or the realm file no coin.
   */
  private priceAt(name: string, shop: RoomId): number | null {
    const world = this.world;
    const row = world?.byId(shop)?.shop;
    const counter = row === undefined ? undefined : world?.shop(row);
    const line = counter?.items.find((each) => nameAnswersTo(bareName(each.name), bareName(name)));
    if (world === undefined) return null;
    return counter === undefined || line === undefined ? null : world.priceAt(line.id, counter.id);
  }

  /**
   * Where a supply's shop is, settled the way a loop's stop is.
   *
   * The room the list states first — six rooms are called General Store and
   * the one the player chose is the one that counts — and the shop's name
   * through `shopPlace` where it states none, refused where the name is in
   * several rooms or none. A resolved room whose realm row holds no shop is
   * refused too: the list may have been written against a different realm.
   */
  private shopRoom(item: SupplyItem): { room: RoomId; name: string } | string {
    const world = this.world;
    if (world === undefined) return t('session.loop.noRealmData');
    if (item.at !== null) {
      const placed = world.get(item.at.map, item.at.room);
      if (placed === undefined || placed.shop === undefined) {
        return t('session.supplies.noShopAt', { map: item.at.map, room: item.at.room });
      }
      const shop = world.shop(placed.shop);
      return { room: roomId(item.at.map, item.at.room), name: shop?.name ?? placed.name };
    }
    if (item.shop.trim().length === 0) return t('session.supplies.noShopNamed');
    const place = world.shopPlace(item.shop);
    if (place === undefined) return t('session.supplies.shopUnplaced', { shop: item.shop });
    if (place.at === 'several') {
      return t('session.supplies.shopAmbiguous', { shop: item.shop, count: place.count });
    }
    return { room: roomId(place.map, place.room), name: item.shop };
  }

  /**
   * Records one safety decision, bounded.
   *
   * Capped like every other log here: this is a diagnostic somebody reads
   * backwards from whatever just happened, and a session that runs all evening
   * must not grow one.
   */
  /**
   * Stands the arbiter down for as long as a form has the terminal.
   *
   * Cleared rather than paused: what is queued was decided for a character
   * standing in a room, and the character is not standing in one — the server
   * has already run `Player.Exits()` on them. The player's own keystrokes are
   * untouched, as they are everywhere else, and typing into the form is the
   * whole reason they are there; what is left of a talk-box line, which does
   * come through the queue, is dropped and said.
   *
   * Said out loud, once, with the refusal recorded beside every other one: a
   * client that silently stops automating looks exactly like a client that has
   * crashed.
   */
  private holdForStatScreen(because: string): void {
    if (this.queue.holding === null) this.dropTyped();
    if (!this.queue.hold(because)) return;
    this.sink.notice(t('session.stats.held'));
    this.noteSafety({
      at: Date.now(),
      action: 'stat screen',
      because,
      acted: true
    });
  }

  /** A prompt came back, so there is a command line again. */
  private releaseStatScreen(): void {
    if (!this.queue.release()) return;
    this.sink.notice(t('session.stats.released'));
  }

  /**
   * Says the character is on the ground, once per stretch of it.
   *
   * A client that silently stops automating looks exactly like one that has
   * crashed — the reason `holdForStatScreen` says so too — and this is the
   * moment when the player's own intervention, or a party member's `aid`, is
   * the only thing that helps. Recorded beside every other refusal, because a
   * decision nobody can read did not happen.
   */
  private sayMortallyWounded(state: CharacterState): void {
    if (this.saidMortallyWounded) return;
    this.saidMortallyWounded = true;
    this.sink.notice(t('session.safety.mortallyWounded'));
    this.noteSafety({
      at: Date.now(),
      action: 'stand down',
      because: t('session.safety.whyMortallyWounded', {
        hp: state.vitals.hp ?? 0
      }),
      acted: true
    });
  }

  private noteSafety(decision: SafetyDecision): void {
    this.safetyLog.push(decision);
    if (this.safetyLog.length > tuning().session.safetyLogLimit) this.safetyLog.shift();
    this.publishAutomation();
  }

  /** The decision trace, for a renderer that mounted mid-session. */
  get automation(): AutomationSnapshot {
    return {
      queue: this.queue.snapshot,
      // Newest first: a trace is read backwards from whatever just happened.
      sent: [...this.sentLog].reverse(),
      safety: [...this.safetyLog].reverse(),
      ...(this.mega ? { mega: this.mega.toggles } : {}),
      ...(this.megaQuestion !== null ? { megaQuestion: this.megaQuestion } : {})
    };
  }

  /**
   * MegaMUD's yes-or-no questions (its message boxes: a step to relearn, a
   * key or gold or a level the way to a destination needs). MegaMUD waits on
   * the answer; this client cannot, so a question is answered *no* where it
   * is asked and put to the player, and a *yes* is kept for that question and
   * the player's action that asked it run again (`megaAct`), where MegaMUD
   * asks it once more and is told yes. A question asked while walking needs
   * no re-running: MegaMUD asks it again on its next try.
   */
  private megaAsk(text: string): boolean {
    if (this.megaAgreed === text) {
      this.megaAgreed = null;
      return true;
    }
    if (this.megaQuestion !== text) {
      this.megaQuestion = text;
      this.publishAutomation();
    }
    return false;
  }

  /** A player's action on the engine, kept so a question it asks can be answered by running it again. */
  private megaAct<T>(act: () => T): T {
    this.megaRetry = act;
    return act();
  }

  /** The player's answer to the question MegaMUD asked. */
  /** What the settings page picks from, out of the engine running this character. */
  megaChoices(): MegaChoices | null {
    return this.mega?.choices() ?? null;
  }

  megaAnswer(question: string, yes: boolean): void {
    if (this.megaQuestion !== question) return;
    this.megaQuestion = null;
    this.publishAutomation();
    if (!yes || this.mega === null) return;
    this.megaAgreed = question;
    const retry = this.megaRetry;
    if (retry !== null) retry();
  }

  /** One of the MegaMUD engine's toolbar toggles pressed; why not, when it cannot be. */
  megaToggle(name: MegaToggle): string | null {
    if (this.mega === null) return t('session.megamud.noEngine');
    this.mega.toggle(name);
    return null;
  }

  /**
   * What a command may be written down as.
   *
   * Everything that persists an outbound command goes through here: the session
   * capture, and the decision trace the renderer draws. The command itself
   * still reaches the socket unchanged — this is about the record, not the
   * wire.
   */
  private reportable(command: string, carriesCredential = false): string {
    const isSecret =
      carriesCredential || (this.secret.length > 0 && command.trim() === this.secret);
    if (!this.awaitingPassword && !isSecret) return command;
    this.awaitingPassword = false;
    return MASKED_COMMAND;
  }

  private recordSent(entry: SentCommand): void {
    this.sentLog.push(entry);
    if (this.sentLog.length > tuning().session.sentLogLimit) this.sentLog.shift();
    this.publishAutomation();
  }

  /**
   * Publishes the trace at most every `tuning.session.automationPublishMs`.
   *
   * Leading edge, so the first change after a quiet spell is immediate — a
   * trace you have to wait a beat for is a worse trace — and trailing, so the
   * last change in a burst is not lost.
   */
  private publishAutomation(): void {
    if (!this.sink.automation) return;
    if (this.automationTimer) return;
    this.sink.automation(this.automation);
    this.automationTimer = setTimeout(() => {
      this.automationTimer = null;
      this.sink.automation?.(this.automation);
    }, tuning().session.automationPublishMs);
    this.automationTimer.unref?.();
  }

  /**
   * Publishes the character, per change and deliberately *not* coalesced.
   *
   * It was coalesced once, the day the trace was (2026-08-31), and reverted
   * the same day: the renderer derives alerts from **consecutive** states — a
   * vital crossing its threshold, a name joining the roster — and collapsing
   * two states into one erased exactly the transition an alert is. The smoke
   * run caught it: the Party card said somebody was hurt and the Alerts card
   * never heard. The window's own flush (`chromeFlushMs`) is what bounds the
   * render cost, and it batches *renders* while applying every state in
   * order, which is the half a publisher on this side cannot do.
   */
  private publishCharacter(): void {
    this.sink.character(this.tracker.current);
    this.publishVerdict();
    this.publishAsks();
    this.watchForReset();
  }

  /**
   * Whether the character in the realm is still the character this client's
   * records are about.
   *
   * A player who deletes a character and makes a new one keeps the **name**,
   * because the name is the login — so nothing about the connection changes,
   * and every record kept against that name is quietly about somebody who no
   * longer exists: a vault balance, a loadout of kit that is gone, a spellbook,
   * a map, a quest counter.
   *
   * **It reports and nothing more.** The client cannot tell a reset from a
   * realm that renumbered its classes, and deleting the only copy of what
   * somebody learned is not a decision to take from a heuristic. What crosses
   * is both characters and what was noticed; the answer is the player's
   * (`Invoke.forgetCharacter`).
   *
   * Asked **once per session**, and the remembered identity is moved on
   * immediately either way: a prompt that came back on the next status line
   * would be a dialog somebody dismisses without reading, which is the same as
   * no dialog at all.
   */
  private watchForReset(): void {
    if (this.tracker.current.phase !== 'in-game') return;
    const now = identityOf(this.tracker.current, Date.now());
    if (now === null) return;

    const remembered = this.belongings.recallIdentity();
    // Moved on whatever happens next, so this asks once and the record stays
    // current for the session after it.
    this.belongings.rememberIdentity(now);
    if (remembered === null || this.askedAboutReset) return;

    const signals = resetSignals(remembered, now, tuning().session.resetExpDropShare);
    if (signals.length === 0) return;

    this.askedAboutReset = true;
    this.sink.notice(t('session.reset.noticed', { signals: signals.join(', ') }));
    this.sink.reset?.({ signals, before: remembered, after: now });
  }

  /**
   * Throws away what this client kept about the character that was here before.
   *
   * The player's call and only ever the player's — see `watchForReset`. What
   * goes is what is *about a character*: the vault, the loadout, the spellbook,
   * the measured spell durations, the quest counters and the identity itself.
   * What stays is what is about the **realm** — the map this character walked,
   * the shops, the other players — because none of that stopped being true.
   */
  forgetCharacter(): boolean {
    if (!this.belongings.forget()) return false;
    // The four persisted fields are re-seeded from the record that is now
    // empty; the room, the roster and the phase are this session's own and are
    // left exactly as they are.
    this.tracker.forgetBelongings();
    this.publishCharacter();
    this.sink.notice(t('session.reset.forgotten'));
    return true;
  }

  /**
   * The character's own side of the combat arithmetic, for the engine's
   * ranking and the room's appraisal alike: the realm's `CombatLVL` and
   * `MageryLVL` for this class — the stat sheet prints neither — and which
   * lineage's formulas the server runs.
   *
   * Read at the point of use rather than captured, because `this.world`
   * arrives with `useRealm` and the class is not known until a stat sheet
   * has been read. `serverFamily` and not the realm data's, deliberately:
   * this decides which *formulas* run, and the formulas are the server's.
   * The two can legitimately differ — see `noteFamily` — and on the shipped
   * configuration they do.
   */
  /**
   * What this character can do, from the realm's class and race rows.
   *
   * One reading for every module that asks, because the server asks one
   * question: `GetAbility(x)` looks across every container, and a Ninja's
   * picklocks and a Gnome's are the same fact to it. Read at the point of use
   * like `realmClass`, since the world arrives with `useRealm` and neither
   * word is known until a stat sheet has been read.
   *
   * `null` where neither row is known, which every reader treats as *unknown*
   * rather than *no* (todo 22).
   */
  /**
   * What a round costs this character in mana, for the hunting model
   * (todo 26, 2026-09-12).
   *
   * **Only from a spell the player has actually configured.** A character with
   * a blank `spells.attack` fights with `combat.attack`, which costs nothing
   * from the pool — so null here, and the estimate is exactly the melee one.
   * A derived spell under `autoChoose` is not read: it is chosen per target
   * from what is in front of the character, and a hunting estimate is about a
   * room the character is not standing in.
   *
   * Null too where the realm cannot price the spell, which is the standing
   * rule: an unknown cost is never zero, and zeroing it would report a
   * caster's cycle as free.
   */
  private castingCost(state: CharacterState): {
    manaPerRound: number | null;
    manaMax: number | null;
  } {
    const name = this.automationConfig.spells.attack.trim();
    if (name.length > 0) {
      const spell = this.world?.spellNamed(name) ?? null;
      return { manaPerRound: spell?.mana ?? null, manaMax: state.vitals.manaMax };
    }
    /*
     * Under `autoChoose` the round spell is derived, so the survey prices the
     * one the book would yield against an unread monster — the hardest hitter
     * the pool can pay for (todo 108). Null where nothing casts.
     */
    const { combat, magery, family } = this.realmClass();
    const casting = this.castingInput(state, prowessSheetOf(state, { combat, magery }), family);
    if (casting === null) return { manaPerRound: null, manaMax: null };
    const choice = chooseAttackSpell({ ...casting, target: null, excluded: new Set() });
    return {
      manaPerRound: choice.chosen?.cost ?? null,
      manaMax: state.vitals.manaMax
    };
  }

  /**
   * What `chooseAttackSpell` needs to say which spell this character would
   * cast, or null where the character does not cast by derivation: the switch
   * off, the book unread, or no realm to price it against (todo 108).
   */
  private castingInput(
    state: CharacterState,
    sheet: ProwessSheet,
    family: RealmFamily | null
  ): Omit<SpellChoiceInput, 'target' | 'excluded'> | null {
    if (!this.automationConfig.spells.autoChoose) return null;
    if (state.spellbook === null || this.world === undefined) return null;
    const world = this.world;
    return {
      book: state.spellbook,
      realm: (name) => world.spellNamed(name) ?? null,
      level: state.progress.level,
      // The full pool: the survey prices a fight begun rested, not the one in progress.
      mana: state.vitals.manaMax ?? state.vitals.mana,
      sheet,
      family,
      killConfidence: tuning().spells.killConfidence
    };
  }

  private capabilities(): Capabilities {
    const world = this.world;
    const state = this.tracker.current;
    return capabilitiesOf(
      state.className ? (world?.classNamed(state.className)?.abilities ?? null) : null,
      state.race ? (world?.raceAbilities(state.race) ?? null) : null
    );
  }

  private realmClass(): {
    combat: number | null;
    magery: number | null;
    family: RealmFamily | null;
  } {
    const row = this.world?.classNamed(this.tracker.current.className ?? '') ?? null;
    return {
      combat: row?.combat ?? null,
      magery: row?.magery ?? null,
      family: this.serverFamily
    };
  }

  /**
   * *Can I fight this room?* — pushed beside the character, on change.
   *
   * Computed here and not in the renderer because three of its inputs live
   * only in main: the class row, the server's family and the menace prices in
   * `internal.yaml`. And computed here rather than inside `AutoCombat` because
   * the answer is owed to a player with automation **off** — the Room card is
   * for a person deciding whether to open, and the engine's ranking is one
   * consumer of the same function, not its owner. The key keeps a status line
   * that moves no drawn figure from costing a push.
   */
  private publishVerdict(): void {
    const appraisal = this.verdict;
    const key = roomVerdictKey(appraisal);
    if (key === this.lastVerdictKey) return;
    this.lastVerdictKey = key;
    this.sink.verdict?.(appraisal);
  }

  /**
   * *What can I ask the things standing here?* — pushed beside the verdict,
   * on change, and keyed the same way.
   *
   * Computed here for the reason the verdict is: the quest book, the counters
   * `abil` stated, the asks this session watched and the listed pack are four
   * facts that live only in main, and three of them move without the room
   * moving. A join made in the card would need the book over IPC on every
   * room, and would still be looking at the rank from before the `abil` the
   * player just sent.
   */
  private publishAsks(): void {
    const offers = this.asks;
    const key = offers
      .map((ask) => `${ask.who}:${ask.say}:${ask.wants?.join(',') ?? ''}`)
      .join('|');
    if (key === this.lastAsksKey) return;
    this.lastAsksKey = key;
    this.sink.asks?.(offers);
  }

  /**
   * What this room's occupants answer to, for this character. See `asksHere`.
   *
   * The occupants are read **first**, and an empty room leaves before the book
   * is joined or the pack is walked: this runs on every status line, like the
   * verdict beside it, and most rooms have nobody in them.
   */
  get asks(): readonly RoomAsk[] {
    const state = this.tracker.current;
    if (state.phase !== 'in-game') return [];
    const here = state.room.occupants.filter((who) => who.kind !== 'player').map((who) => who.name);
    if (here.length === 0) return [];
    const book = this.world?.quests();
    if (book === undefined || book.length === 0) return [];
    return asksHere(
      book,
      here,
      {
        className: state.className ?? null,
        race: state.race ?? null,
        level: state.progress.level ?? null,
        counters: state.abilities ?? null
      },
      this.questSaid,
      // The pack as an answer or as a silence — never as an empty pack, which
      // would say *you are not carrying this* about a pack nobody has read.
      packRows(state.inventory)
    );
  }

  /** The room as it stands, appraised against the character as it stands. See `appraiseRoom`. */
  get verdict(): RoomVerdict {
    const state = this.tracker.current;
    if (state.phase !== 'in-game' || state.room.occupants.length === 0) return EMPTY_ROOM_VERDICT;
    const { combat, magery, family } = this.realmClass();
    const sheet = prowessSheetOf(state, { combat, magery });
    const weapon = wieldedWeapon(state.inventory.items);
    const appraisal = appraiseRoom(
      state.room.occupants,
      this.menacePlayer(state),
      tuning().menace,
      sheet,
      weapon,
      family
    );
    return { ...appraisal, survival: this.survivalOf(state, sheet, weapon, family) };
  }

  /**
   * The room's fight as it stands, simulated, for the run and the hang-up to
   * read (`src/shared/danger.ts`): `verdict`'s survival without the rest of it.
   */
  fight(): Survival | null {
    return this.fightWith(null);
  }

  /**
   * The fight opening on `target` would make: the room's, with the target in
   * it whether or not it would have started one (upstream 5ffdf91). Undefined
   * where the realm has no world database, so there is nothing to weigh.
   */
  opening(target: string): Survival | null | undefined {
    return this.world === undefined ? undefined : this.fightWith(target);
  }

  private fightWith(also: string | null): Survival | null {
    const state = this.tracker.current;
    if (state.phase !== 'in-game') return null;
    const { combat, magery, family } = this.realmClass();
    const sheet = prowessSheetOf(state, { combat, magery });
    return this.survivalOf(state, sheet, wieldedWeapon(state.inventory.items), family, also);
  }

  /**
   * The room's fight run for this character as it stands (todo 02): what
   * here would fight, the heal the automation would cast, the regeneration
   * tick and the blessings that lapse before it is over. Everything the
   * appraisal cannot see, because only the session holds the configuration
   * and the buffs. `also` joins the fight when an opening on it is being
   * weighed. Run again only when what it is run on moved: the run and the
   * hang-up read it on every status line (upstream 519471e). See
   * `simulateFight` and mudengine-automation › *The verdict is also run as a
   * fight*.
   */
  private survivalOf(
    state: CharacterState,
    sheet: ProwessSheet,
    weapon: ProwessWeapon | null,
    family: RealmFamily | null,
    also: string | null = null
  ): Survival | null {
    const { hp, hpMax, mana, manaMax } = state.vitals;
    if (hp === null || hpMax === null || hpMax <= 0) return null;
    const standing = ownAlignment(state);
    const fighting = new Set(
      [...state.combat.attackers, state.combat.target ?? '', also ?? '']
        .filter((name) => name.length > 0)
        .map((name) => name.toLowerCase())
    );
    /*
     * What would fight: everything the realm says attacks on sight, anything
     * it cannot say about (unknown never reassures), and whatever is already
     * swinging or being swung at. A passive resident standing by is not a
     * foe, or every shop would read as a fight — unless it is certain to
     * protect one, when the server brings it in (`guards.ts`).
     */
    const casting = this.castingInput(state, sheet, family);
    const foes: SurvivalFoe[] = [];
    const casts: Array<{ perRound: number; manaPerRound: number } | null> = [];
    const fights = inTheFight(
      state.room.occupants.filter((who) => who.kind !== 'player'),
      (who) =>
        attacksOnSight(who.disposition, standing) !== false || fighting.has(who.name.toLowerCase()),
      () => true
    );
    for (const who of fights) {
      const subject: SurvivalFoe['subject'] = who.mob ?? {};
      foes.push({ name: who.name, subject });
      const kill =
        casting === null
          ? null
          : castsToKill(casting, {
              hp: subject.hp ?? null,
              magicRes: who.mob?.magicResist ?? null,
              abilities: subject.abilities
            });
      casts.push(
        kill === null || subject.hp === undefined
          ? null
          : { perRound: subject.hp / kill.rounds, manaPerRound: (kill.mana ?? 0) / kill.rounds }
      );
    }
    if (foes.length === 0) return null;

    /*
     * The heal as `AutoHeal` would cast it: the in-combat threshold where one
     * is set, the configured spell's own range at this level, its cost. Only
     * with the mana known — a heal that cannot be budgeted is not modelled,
     * which errs towards the fight being harder than it is.
     */
    const spells = this.automationConfig.spells;
    const below = spells.healBelowInCombat > 0 ? spells.healBelowInCombat : spells.healBelow;
    let heal: SurvivalHeal | null = null;
    if (below > 0 && spells.heal.trim().length > 0 && mana !== null) {
      const found = resolveSpell(
        spells.heal,
        state.spellbook,
        (name) => this.world?.spellNamed(name) ?? null
      );
      const cost = spellCost(found);
      const realm = found.realm;
      const heals = (realm?.abilities ?? []).some(
        ([id, value]) => id === HAZARD_ABILITY.heal && value >= 0
      );
      if (realm !== null && cost !== null && heals && realm.power !== undefined) {
        heal = {
          below,
          to: spells.healTo,
          restores: scaledPower(realm, state.progress.level ?? 0),
          cost,
          minMana: spells.minMana
        };
      }
    }

    const regen = regeneration(sheet, null, family);
    const regenPerRound =
      regen === null ? 0 : (regen.health.value * ROUND_SECONDS) / regen.tickSeconds;
    const now = Date.now();
    const roundCap = tuning().menace.survivalRoundCap;
    const recasts = state.buffs.flatMap((buff) => {
      if (buff.expiresAt === undefined) return [];
      const round = Math.ceil((buff.expiresAt - now) / (ROUND_SECONDS * 1000));
      if (round <= 0 || round > roundCap) return [];
      const cost = this.world?.spellNamed(buff.spell)?.mana ?? null;
      return cost === null || cost <= 0 ? [] : [{ round, cost }];
    });

    const input = {
      hp,
      hpMax,
      mana,
      manaMax,
      player: this.menacePlayer(state),
      sheet,
      weapon,
      family,
      weights: tuning().menace,
      foes,
      casting: casts,
      heal,
      regenPerRound,
      recasts,
      levels: {
        safeAbove: tuning().menace.survivalSafeAbove,
        riskyAbove: tuning().menace.survivalRiskyAbove
      },
      trials: tuning().menace.survivalTrials,
      roundCap,
      // Read part way, for the death risk the run and the hang-up act on.
      horizons: SURVIVAL_HORIZONS
    };
    // The recasts' rounds count down with the clock, so the key is what is drawn from, not the time.
    const key = JSON.stringify({ ...input, recasts: input.recasts.length });
    const kept = also === null ? this.ran : this.ranOpening;
    if (kept?.key === key) return kept.survival;
    const run = { key, survival: simulateFight(input) };
    if (also === null) this.ran = run;
    else this.ranOpening = run;
    return run.survival;
  }

  /**
   * One monster each, by name, for the Reference card's lookup — the same
   * arithmetic as the room's, run on a room of one, so a monster looked up
   * from the console reads exactly as it would standing in front of it.
   *
   * A name the realm cannot place gets no key: the lookup already answers only
   * with the realm's own rows, so an unplaceable name here is one the caller
   * invented rather than one the card will draw.
   */
  appraise(names: readonly string[]): Record<string, Verdict> {
    const state = this.tracker.current;
    const { combat, magery, family } = this.realmClass();
    const sheet = prowessSheetOf(state, { combat, magery });
    const weapon = wieldedWeapon(state.inventory.items);
    const player = this.menacePlayer(state);
    const verdicts: Record<string, Verdict> = {};
    // Weighed as the row the character's own room resolves each name to: a
    // name holding two of the realm's rows was weighed as the worse of them
    // wherever the room says which it is. See `WorldGraph.resolveMobRow`.
    const at =
      state.room.map === null || state.room.number === null
        ? null
        : roomId(state.room.map, state.room.number);
    for (const name of names) {
      const entity = this.world?.buildMobEntity(name, { at });
      if (entity === undefined || entity.source === 'wire') continue;
      const [verdict] = weighVerdicts([entity], player, tuning().menace, sheet, weapon, family);
      if (verdict !== undefined) verdicts[name] = verdict;
    }
    return verdicts;
  }

  /**
   * What a monster's blow or cast is measured against: the sheet's three
   * figures, the protection the server adds that the sheet does not print,
   * and the character's dodge. `AutoCombat.weigh` reads the same.
   */
  private menacePlayer(state: CharacterState): MenacePlayer {
    const { combat, magery, family } = this.realmClass();
    return {
      armourClass: state.progress.armourClass,
      damageResist: state.progress.damageResist,
      magicRes: state.progress.magicRes,
      ...protectionOf(state, (name) => this.world?.spellNamed(name) ?? null),
      dodge: dodge(prowessSheetOf(state, { combat, magery }), family)?.value ?? null
    };
  }

  /** Applies a partial state update, refreshes negotiation, and publishes. */
  private patch(next: Partial<Omit<ConnectionState, 'negotiated'>>): void {
    this.current = {
      ...this.current,
      ...next,
      negotiated: this.client.negotiated
    };
    this.sink.state(this.current);
  }
}

/**
 * Phases in which a connect attempt should be refused as already in progress.
 *
 * `connected` is deliberately *not* one of them, despite being busy: dialling
 * while connected is how you switch servers, and the palette offers exactly
 * that. What must be refused is a second attempt arriving while the first is
 * still in flight — `connect` tears down whatever is open before it dials, so
 * that would kill a connection seconds from succeeding.
 */
export const BUSY_PHASES: ReadonlySet<ConnectionPhase> = new Set([
  'resolving',
  'connecting',
  'negotiating'
]);

/**
 * The command a status line echoed after its colon, or null for a bare prompt.
 *
 * `[HP=334/KAI=0]:med` is the server's own statement of what it is about to
 * answer. Read off the plain text past the prompt pattern's match, so a
 * `(Resting)` flag the pattern already consumed is never mistaken for a word
 * somebody typed.
 */
export function echoedCommand(plain: string): string | null {
  const match = STATUS_LINE.exec(plain);
  if (!match) return null;
  const echo = plain.slice(match[0].length).trim();
  return echo.length > 0 ? echo : null;
}

/**
 * The sheet's figure for a stat a `testskill` names, or null where the sheet
 * has not said or prints no such figure (todo 106). The script's words are
 * `TextBlockPart.cs`'s own switch: `wisdom` reads the sheet's Willpower,
 * `stealth` its Stealth figure, `magicresistance` its MR. Anything else —
 * `current_hp`, a word a derivative invents — is unknown, never zero.
 */
function statFigure(state: CharacterState, stat: string): number | null {
  const sheet = state.progress;
  switch (stat.toLowerCase()) {
    case 'intellect':
      return sheet.intellect;
    case 'strength':
      return sheet.strength;
    case 'health':
      return sheet.health;
    case 'charm':
      return sheet.charm;
    case 'agility':
      return sheet.agility;
    case 'wisdom':
      return sheet.willpower;
    case 'perception':
      return sheet.perception;
    case 'stealth':
      return sheet.stealthSkill;
    case 'picklocks':
      return sheet.picklocks;
    case 'traps':
      return sheet.traps;
    case 'thievery':
      return sheet.thievery;
    case 'spellcasting':
      return sheet.spellcasting;
    case 'tracking':
      return sheet.tracking;
    case 'magicresistance':
      return sheet.magicRes;
    default:
      return null;
  }
}
