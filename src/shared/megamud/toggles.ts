/**
 * MegaMUD's automation toggles, its toolbar's switches: each the window
 * command that flips it (`0x462d20`, read 2026-10-13) and the `[Toolbar]`
 * key that says whether a character's toolbar shows it: 0 hidden, 1 shown,
 * 2 shown with a separator before it (the Toolbar tab, `0x4bb4d0`, ticks
 * Visible above 0 and Separator above 1).
 *
 * In the order MegaMUD's own `[Toolbar]` section lists them.
 */
export const MEGA_TOGGLES = [
  { name: 'allOff', command: 0x821, toolbar: 'AllOff' },
  { name: 'combat', command: 0x7d3, toolbar: 'AutoCombat' },
  { name: 'preAttack', command: 0x829, toolbar: 'AutoPreAttack' },
  { name: 'melee', command: 0x8a4, toolbar: 'AutoMelee' },
  { name: 'nuke', command: 0x86a, toolbar: 'AutoNuke' },
  { name: 'heal', command: 0x7dc, toolbar: 'AutoHeal' },
  { name: 'bless', command: 0x82a, toolbar: 'AutoBless' },
  { name: 'light', command: 0x870, toolbar: 'AutoLight' },
  { name: 'get', command: 0x7d9, toolbar: 'AutoGet' },
  { name: 'cash', command: 0x823, toolbar: 'AutoCash' },
  { name: 'sneak', command: 0x801, toolbar: 'AutoSneak' },
  { name: 'hide', command: 0x815, toolbar: 'AutoHide' },
  { name: 'search', command: 0x7f2, toolbar: 'AutoSearch' },
  { name: 'afk', command: 0x809, toolbar: 'AFK' }
] as const;

export type MegaToggle = (typeof MEGA_TOGGLES)[number]['name'];

/** A character's toggles as the MegaMUD engine has them, and which its toolbar shows. */
export interface MegaToggles {
  on: Record<MegaToggle, boolean>;
  /** Those its `[Toolbar]` marks visible, in the table's order. */
  shown: MegaToggle[];
}

/** A toggle's name off the wire, or null. */
export function asMegaToggle(value: unknown): MegaToggle | null {
  return MEGA_TOGGLES.find((toggle) => toggle.name === value)?.name ?? null;
}

/** The toggles a character's `[Toolbar]` section shows (any value above 0). */
export function shownToggles(toolbar: Readonly<Record<string, unknown>> | undefined): MegaToggle[] {
  return MEGA_TOGGLES.filter((toggle) => Number(toolbar?.[toggle.toolbar] ?? 0) > 0).map(
    (toggle) => toggle.name
  );
}
