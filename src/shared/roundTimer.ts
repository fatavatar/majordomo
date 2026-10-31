/**
 * MegaMUD's round timer as its status bar draws it (`0x4a9ff0`, read
 * 2026-10-31): how long until the next combat round, and a colour for what
 * the timer knows. The engine works it out (`combat/timer.ts`); a window
 * counts down from the time it was said.
 */

/**
 * The bar's colour (`0x4aa670`): not synced yet (no bar); synced but not
 * trusted yet, under 80 confidence (orange); a spell cast or refused this
 * round, so the next waits for the round to turn (blue); free to cast (green).
 */
export type RoundTone = 'unsynced' | 'unsure' | 'wait' | 'ready';

export interface RoundTimer {
  tone: RoundTone;
  /** How long until the next round when said, 1–5000 ms (`0x49b8f0`); null before rounds are synced. */
  nextInMs: number | null;
  /** The seconds left written beside the bar (not `Display.HideRoundTimerStatus`). */
  figure: boolean;
  /** The bar drawn (not `Display.HideRoundTimerBar`). */
  bar: boolean;
}

/** The game's combat round. */
export const ROUND_MS = 5000;

export const NO_ROUND: RoundTimer = { tone: 'unsynced', nextInMs: null, figure: true, bar: true };
