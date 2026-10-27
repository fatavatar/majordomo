import { createContext, useContext } from 'react';

import { compactSkin, DEFAULT_SKIN, type SkinId } from '@shared/skins';

/**
 * The skin the cards are drawn in (2026-10-25), for a card whose skin lays
 * it out its own way (`shared/skins.ts`). Given by the window from
 * `ui.skin`; a card with no layout of the skin's own draws classic's.
 */
export const SkinContext = createContext<SkinId>(DEFAULT_SKIN);

export function useSkin(): SkinId {
  return useContext(SkinContext);
}

/** Whether the cards are laid out compactly: glance's way. */
export function useCompact(): boolean {
  return compactSkin(useContext(SkinContext));
}
