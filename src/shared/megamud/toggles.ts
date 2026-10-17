import type { Movement } from '../movement';

/** MegaMUD's window commands (its `WM_COMMAND` ids, handled by `0x462d20`). */
export const WindowCommand = {
  AutoCombat: 0x7d3,
  /** Connect, or Disconnect when online. */
  Connect: 0x7d4,
  AutoGet: 0x7d9,
  AutoHeal: 0x7dc,
  AutoSearch: 0x7f2,
  AutoSneak: 0x801,
  /** Go, or Stop when walking. */
  GoStop: 0x803,
  AutoTrack: 0x804,
  Roam: 0x808,
  Afk: 0x809,
  AutoHide: 0x815,
  AllOff: 0x821,
  AutoCash: 0x823,
  AutoPreAttack: 0x829,
  AutoBless: 0x82a,
  NoHangup: 0x82f,
  StepBack: 0x869,
  AutoNuke: 0x86a,
  AutoLight: 0x870,
  Melee: 0x8a4
} as const;

/**
 * MegaMUD's automation toggles, its toolbar's switches: each the window
 * command that flips it (`0x462d20`, read 2026-10-13), in the order MegaMUD's
 * own `[Toolbar]` section lists them. Which are on the toolbar is the
 * toolbar's own pins, as every other button on it is (2026-10-14), not the
 * character's `[Toolbar]`.
 */
export const MEGA_TOGGLES = [
  /** Lit when hanging up is off (`0x460d50` checks `NoHangup` while `NoHangup` is set). */
  { name: 'noHangup', command: WindowCommand.NoHangup },
  { name: 'allOff', command: WindowCommand.AllOff },
  { name: 'combat', command: WindowCommand.AutoCombat },
  { name: 'preAttack', command: WindowCommand.AutoPreAttack },
  { name: 'melee', command: WindowCommand.Melee },
  { name: 'nuke', command: WindowCommand.AutoNuke },
  { name: 'heal', command: WindowCommand.AutoHeal },
  { name: 'bless', command: WindowCommand.AutoBless },
  { name: 'light', command: WindowCommand.AutoLight },
  { name: 'get', command: WindowCommand.AutoGet },
  { name: 'cash', command: WindowCommand.AutoCash },
  { name: 'sneak', command: WindowCommand.AutoSneak },
  { name: 'hide', command: WindowCommand.AutoHide },
  { name: 'search', command: WindowCommand.AutoSearch },
  { name: 'afk', command: WindowCommand.Afk }
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
  /**
   * How many runs from a fight the engine has begun, and how many Auto-Flee
   * sys gotos it has sent, since it started: the window raises its `ran` and
   * `fled` alerts as these go up (`escapeNotices`).
   */
  ran: number;
  fled: number;
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
