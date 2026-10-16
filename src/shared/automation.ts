/**
 * The arbiter's vocabulary, and what it is currently doing.
 *
 * In `shared/` because three parties need it and they cannot all reach into the
 * main process: the queue enforces the priority order, a rule in the options
 * file *names* one of these bands, and the renderer draws the queue's state.
 *
 * It was previously defined twice — once as `PRIORITY` beside the queue, once
 * as a string union in `rules.ts` — which is the same mistake as holding two
 * representations of a direction: the two agree until one of them is edited.
 */
import type { MegaToggles } from './megamud/toggles';

/**
 * Priority bands. Higher wins.
 *
 * `user` sits above everything automated, so a person typing is never queued
 * behind a bot's housekeeping.
 */
export const PRIORITY = {
  /** Get out. Nothing outranks this. */
  emergency: 100,
  combat: 80,
  /** Anything the person at the keyboard asked for, including login answers. */
  user: 60,
  /**
   * Walking a planned route. Below the player, who may be steering; above the
   * housekeeping probe, because the walk is the current task and the probe is a
   * one-off that can wait a step.
   */
  movement: 50,
  /** Asking the realm the questions that populate the HUD. */
  probe: 40,
  /** Keep-alive and other things worth doing only when nothing else is. */
  idle: 20
} as const;

export type Priority = keyof typeof PRIORITY;

/**
 * What a command carrying a credential is shown and written down as.
 *
 * Fixed width, so the length is not recorded either. Here rather than beside
 * either reader because there are two — the record (`SessionManager.reportable`,
 * for the capture and the sent log) and the *queue*, whose pending intents the
 * Automation card and the status rail draw while they wait their turn. A
 * password that is masked in one and printed in the other is a password
 * written down.
 */
export const MASKED_COMMAND = '••••••••';

/** One intent waiting its turn. */
export interface PendingIntent {
  command: string;
  priority: Priority;
  /** Why it was proposed. This is the trace. */
  reason?: string;
  /** The player's own line, paced: a talk-box line of several commands (todo 04). */
  typed?: boolean;
}

export interface QueueSnapshot {
  depth: number;
  /** Sent and not yet acknowledged by a prompt. */
  inFlight: number;
  /** Standing down because the player is typing. */
  suppressed: boolean;
  pending: PendingIntent[];
}

export const EMPTY_QUEUE: QueueSnapshot = {
  depth: 0,
  inFlight: 0,
  suppressed: false,
  pending: []
};

/**
 * One command the arbiter actually put on the wire.
 *
 * A rule that fired is not the same as a command that was sent: an intent can
 * be coalesced away, expire, or be cancelled between the two. Recording the
 * send separately is what makes "why did the bot run?" answerable — the
 * firing says a rule decided, this says the decision reached the game.
 */
export interface SentCommand {
  at: number;
  command: string;
  priority: Priority;
  reason?: string;
}

/**
 * Something the client did, or refused to do, to keep a character alive.
 *
 * Separate from `sent` because one of them does not produce a command at all,
 * so it would never appear there.
 *
 * **"Why did the bot run?" has to be answerable from a trace**
 * (docs/legacy-assessment.md §6), and hanging up is the one decision with a
 * consequence nothing can undo. A refusal is recorded as well as an action:
 * somebody who turned a safety feature on and found it did nothing needs to see
 * that it *decided* not to, and why.
 */
export interface SafetyDecision {
  at: number;
  /** `retreat` or `hang up`. */
  action: string;
  /** What prompted it — the health, the number of attackers. */
  because: string;
  /** True when it acted; false when it refused. */
  acted: boolean;
  /** Why it refused, when it did. */
  refused?: string;
}

/** What automation has been doing. The decision trace, in one payload. */
export interface AutomationSnapshot {
  queue: QueueSnapshot;
  /** Newest first. */
  sent: SentCommand[];
  /** Newest first. What was done, or refused, to keep this character alive. */
  safety: SafetyDecision[];
  /**
   * The MegaMUD engine's toolbar toggles, for a character it runs; absent for
   * one the old automation runs. Here because they are what this character's
   * automation is set to do, pushed whenever they change.
   */
  mega?: MegaToggles;
  /** A yes-or-no question the MegaMUD engine is waiting on the player for. */
  megaQuestion?: string;
}

export const EMPTY_AUTOMATION: AutomationSnapshot = {
  queue: EMPTY_QUEUE,
  sent: [],
  safety: []
};
