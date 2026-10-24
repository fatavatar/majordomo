import type { MegaChoices, MegaNames, SpellOption } from '@shared/ipc';

/**
 * What a settings box suggests as it is typed in (ours, 2026-10-24): the
 * names, and what each is where the box takes a short form (a spell's name
 * beside its command). Spread onto a `NameCombo`.
 */
export interface Offer {
  options: readonly string[];
  notes?: ReadonlyMap<string, string>;
}

/** A character's lists for its settings boxes, each a kind of thing a box names. */
export interface SettingsNames {
  /** Short commands, from its book, else the realm's castable spells. */
  spells: Offer;
  items: Offer;
  weapons: Offer;
  backstab: Offer;
  shields: Offer;
  /** MegaMUD's room list, and the banks in it, while its engine runs. */
  rooms: Offer;
  banks: Offer;
  loops: Offer;
}

const NONE: Offer = { options: [] };

export const NO_NAMES: SettingsNames = {
  spells: NONE,
  items: NONE,
  weapons: NONE,
  backstab: NONE,
  shields: NONE,
  rooms: NONE,
  banks: NONE,
  loops: NONE
};

/** The spells a box can be given, by the command typed to cast each, with its name beside it. */
export function spellOffer(spells: readonly SpellOption[]): Offer {
  const notes = new Map<string, string>();
  for (const spell of spells) {
    const short = spell.short?.trim() ?? '';
    if (short !== '' && !notes.has(short)) notes.set(short, spell.name);
  }
  return { options: [...notes.keys()].sort((a, b) => a.localeCompare(b)), notes };
}

export function settingsNames(
  spells: readonly SpellOption[],
  names: MegaNames | null,
  choices: MegaChoices | null,
  loops: readonly string[]
): SettingsNames {
  return {
    spells: spellOffer(spells),
    items: { options: names?.items ?? [] },
    weapons: { options: names?.weapons ?? [] },
    backstab: { options: names?.backstab ?? [] },
    shields: { options: names?.shields ?? [] },
    rooms: { options: choices?.rooms ?? [] },
    banks: { options: choices?.banks ?? [] },
    loops: { options: loops }
  };
}
