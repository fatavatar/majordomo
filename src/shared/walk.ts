/**
 * How a route walk is going.
 *
 * In `shared/` rather than beside the walker because the renderer draws this
 * and the main process produces it, and `shared/` is the only module both may
 * import. Dependency-free, like everything else here.
 */
import type { RoomId } from './world';

export type WalkStatus =
  /** Nothing planned. */
  | 'idle'
  /** A step is in flight and the client is waiting to confirm where it landed. */
  | 'walking'
  /** Every step confirmed. */
  | 'arrived'
  /** Ended early. `reason` says why. */
  | 'stopped';

export interface WalkProgress {
  status: WalkStatus;
  /**
   * Whether this is a journey **the player asked for**, rather than a leg
   * something else is walking: a loop's leg, a supply errand, the walk home
   * from a `safe-haven` retreat.
   *
   * Published because `movementOf` cannot do its job without it. A lap's legs
   * are walks, so after a lap is stopped the walker is left holding a stopped
   * route that is the lap's own footwork — and a card that reported *that* as
   * the route would be reporting the mechanism rather than the thing
   * happening, which is the whole failure the one-face card exists to fix.
   * True for an idle walker, which has walked nothing to be wrong about.
   */
  asked: boolean;
  /** Steps confirmed so far — not steps sent. */
  done: number;
  total: number;
  /** Where the route ends, for display. */
  destination: string | null;
  /**
   * The room the route ends in, so the name can be a control rather than
   * text: a room the character is not in opens in the route panel, as a room
   * clicked on the map does. Null when the route's id did not parse.
   */
  destinationRoom: { map: number; room: number } | null;
  /** The step being attempted, when walking. `to` is the room it leads into. */
  step: {
    command: string;
    name: string;
    note: string | null;
    to: { map: number; room: number } | null;
  } | null;
  /**
   * The rooms the route still runs through, beginning with the one the
   * character is standing in.
   *
   * This is what the map draws the route with, and it is *remaining* rather
   * than whole on purpose: the request was for the way ahead, with the rooms
   * already travelled coming off as they are walked. `done` and `total` say
   * how far through a route is as a fraction; a fraction cannot be drawn on a
   * map, and re-deriving the rooms in the renderer would mean shipping the
   * whole route and the index and asking every consumer to slice it the same
   * way.
   *
   * The first entry is the room the character is in rather than the next one
   * it enters, because a line has two ends: without it the leg out of the
   * current room could not be drawn at all, which is the one leg being walked.
   *
   * Empty unless the walk is `walking`, for `step` and `hold`'s reason — a
   * stopped route drawn on the map is a plan the client is no longer following
   * and a picture that says otherwise is worse than none.
   */
  path: RoomId[];
  /**
   * The rooms still to be entered, **named**, in the order they come.
   *
   * `path` beside it is the same journey as ids, which is what a map draws
   * with; this is the same journey as words, which is what a reader needs.
   * Both, because neither answers the other's question: an id cannot be read
   * and a name cannot be placed.
   *
   * What it is for is the half of a walk the card never showed. A bar says how
   * far along, and the step being sent says what is happening now, and between
   * them they answer *what have I done* and *what am I doing* — leaving *what
   * is left*, which is the one a player actually acts on. Empty while nothing
   * is being walked.
   */
  ahead: string[];
  /**
   * Why it is no longer walking. Null while it still is.
   *
   * Always set when a walk stops, because "the bot stopped and I do not know
   * why" is the state this whole design exists to avoid.
   */
  reason: string | null;
  /**
   * Why the walk is standing still without having stopped. Null while it is
   * actually moving.
   *
   * A **hold is not an ending**, for this reason: a walk that stopped needs replanning from
   * wherever the character is, and one that is merely waiting will go on by
   * itself. Drawing them the same way would make a character recovering look
   * like a character that had given up.
   *
   * `health` is the character sitting the fight's damage off under
   * `automation.health.restBelow` before it travels on. `fight` is a fight
   * running in the room the route is standing in — which is the ordinary way
   * a journey across a realm full of monsters goes, and used to *end* the
   * route (2026-09-02): the character was left wherever the first wanderer
   * met it, and somebody had to notice and ask again.
   *
   * Reported rather than silent — a route that says *29 steps to Bank of
   * Godfrey* and does not move is otherwise indistinguishable from a broken
   * client, which is the failure every safety refusal here is written up to
   * avoid. It is reported *here* and not in the console: the card draws a
   * chip, the server has already said `*Combat Engaged*` in the room, and a
   * line per monster on a twenty-step journey is the chrome talking over it.
   */
  hold: WalkHold;
}

/**
 * Why a walk is standing still. `blind`, `held` and `poisoned` are the
 * afflictions the server has stated and the walk waits out — MegaMUD's
 * `IgnoreBlind` / `IgnorePoison` defaults, which wait. `held` is also taken for a hold the client could not
 * *name*: a step answered by a spell onset and then silence is a step
 * `CheckForHoldPerson` refused, whatever the realm says about that spell.
 *
 * `trap` is the step ahead firing a trap the character is not yet fit to
 * take: the walk rests and then steps through. A health hold by another
 * floor, drawn as resting.
 *
 * `resting` is a `rest` on the wire whose answer has not come back yet: the
 * walk waits a beat rather than breaking it. A rest and a step decided in the
 * same tick are both right at the moment they are made, and the step undid the
 * rest a millisecond later (todo 14). The
 * window is short and ends by itself, so this can never deadlock.
 *
 * `barrier` is a shut door the ladder could not get past *this time round*:
 * every `open`, pick and bash the step was given has been spent and the way
 * is still closed. It is a hold rather than an ending because the reasons it
 * failed are mostly temporary — the character is too hurt to spend another
 * bash, the lock wanted one more roll, somebody else is about to walk through
 * — and a route that ends at a door has to be noticed and asked for again by
 * hand.
 */
export type WalkHold =
  | 'health'
  | 'fight'
  | 'trap'
  | 'blind'
  | 'held'
  | 'poisoned'
  | 'barrier'
  | 'searching'
  | 'resting'
  /** Mana under `meditateBelow`, standing still until `resumeAtMana`. */
  | 'mana'
  /** A room re-read after a monster came, went or died, not yet answered. */
  | 'room'
  /** A room too dark to read, while the light that fixes it is on its way. */
  | 'dark'
  /** Waiting out what the realm's message table says is on the character. */
  | 'condition'
  /** Party members a relayed text exit left behind, not yet here. */
  | 'party'
  | null;

export const IDLE_WALK: WalkProgress = {
  status: 'idle',
  asked: true,
  done: 0,
  total: 0,
  destination: null,
  destinationRoom: null,
  step: null,
  path: [],
  ahead: [],
  reason: null,
  hold: null
};
