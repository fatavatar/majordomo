import type { Movement } from '../movement';

/**
 * MegaMUD's automation toggles, its toolbar's switches: each the window
 * command that flips it (`0x462d20`, read 2026-10-13), in the order MegaMUD's
 * own `[Toolbar]` section lists them. Which are on the toolbar is the
 * toolbar's own pins, as every other button on it is (2026-10-14), not the
 * character's `[Toolbar]`.
 */
export const MEGA_TOGGLES = [
  /** Lit when hanging up is off (`0x460d50` checks `0x82f` while `NoHangup` is set). */
  { name: 'noHangup', command: 0x82f },
  { name: 'allOff', command: 0x821 },
  { name: 'combat', command: 0x7d3 },
  { name: 'preAttack', command: 0x829 },
  { name: 'melee', command: 0x8a4 },
  { name: 'nuke', command: 0x86a },
  { name: 'heal', command: 0x7dc },
  { name: 'bless', command: 0x82a },
  { name: 'light', command: 0x870 },
  { name: 'get', command: 0x7d9 },
  { name: 'cash', command: 0x823 },
  { name: 'sneak', command: 0x801 },
  { name: 'hide', command: 0x815 },
  { name: 'search', command: 0x7f2 },
  { name: 'afk', command: 0x809 }
] as const;

export type MegaToggle = (typeof MEGA_TOGGLES)[number]['name'];

/** A character's toggles as the MegaMUD engine has them. */
export interface MegaToggles {
  /**
   * Each toggle as MegaMUD draws it: with All Off on, every other one reads
   * off (`0x460d50`), whatever it will be when All Off is let go.
   */
  on: Record<MegaToggle, boolean>;
  /** Walking a path (`0xe184`), its Go/Stop lit. */
  walking: boolean;
  /** The path walked is the loop (`0xe188`). */
  looping: boolean;
  /** Go would walk something: in the game, not All Off, with a path or roaming to pick up. */
  canGo: boolean;
}

/**
 * The engine's walking as the transport reads it, in place of the walker's
 * and loop runner's progress, which stand idle while the engine walks.
 */
export function megaMovement(mega: MegaToggles): Movement {
  if (mega.walking)
    return { kind: mega.looping ? 'loop' : 'route', moving: true, resumable: false };
  return { kind: null, moving: false, resumable: mega.canGo };
}

/** A toggle's name off the wire, or null. */
export function asMegaToggle(value: unknown): MegaToggle | null {
  return MEGA_TOGGLES.find((toggle) => toggle.name === value)?.name ?? null;
}
