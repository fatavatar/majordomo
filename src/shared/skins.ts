/**
 * The skins the chrome can wear (2026-10-24): how cards are drawn — their
 * type, shape, gauges and the order a card states things in — beside the
 * colour themes (`themes.ts`), which say only what everything is painted.
 * Any skin wears any theme: a skin reads the theme's tokens for every hue.
 *
 * A skin can lay a card out its own way, not only paint it: a card asks for
 * the skin (`useSkin`) and draws its body from the layout that skin has,
 * built from the shared primitives in `renderer/src/components/kit`, and its
 * stylesheet (`styles/skins/<id>.css`) is keyed off `data-skin` on the root.
 * A card with no layout of a skin's own draws classic's.
 *
 * - `classic`, the client as it has always been drawn.
 * - `glance` (2026-10-25), colour and shape carrying what rows of words
 *   did: figures inside their bars, an alignment as the colour of a name,
 *   lines that say the same thing folded into one with a count. Shorter than
 *   classic wherever it differs, which is the point of it.
 *
 * `atlas` and `halo` (2026-10-25) were retired on 2026-10-27: restyling the
 * same cards did not make them more useful, and every new card paid for
 * keeping them in step. A file still naming either is moved to glance
 * (`statedTheSkin`), and anything else unknown draws classic.
 *
 * Every skin but classic lays the cards out compactly (`compactSkin`). A skin
 * is never taller than classic: measured card by card before one ships.
 */
export const SKINS = ['classic', 'glance'] as const;

export type SkinId = (typeof SKINS)[number];

export const DEFAULT_SKIN: SkinId = 'classic';

/** Whether a skin lays the cards out compactly — every one but classic. */
export function compactSkin(skin: SkinId): boolean {
  return skin !== 'classic';
}

export function isSkin(value: unknown): value is SkinId {
  return typeof value === 'string' && (SKINS as readonly string[]).includes(value);
}
