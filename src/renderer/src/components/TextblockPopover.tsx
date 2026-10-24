import { createPortal } from 'react-dom';

import PopoverHead, { PopoverSizer } from './PopoverHead';
import TextblockView, { useTextblock } from './TextblockView';
import type { Follow } from './ExplorerDetailParts';
import { usePopoverFrame } from '../hooks/usePopoverFrame';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import type { PopoverAnchor } from '../lib/popover';
import type { ExplorerTextblock, TextblockRequest } from '@shared/explorer';

/**
 * A textblock somebody clicked, and where (2026-10-24): a quest step's, or
 * one named in MME's words on a card.
 */
export interface TextblockAsked {
  n: number;
  anchor: PopoverAnchor;
}

export interface TextblockPopoverProps {
  asked: TextblockAsked;
  ask(request: TextblockRequest): Promise<ExplorerTextblock>;
  /** The map a teleport that names none lands on: where the character is. */
  defaultMap: number;
  /** Where a reference in it leads: a name, a room, another block. */
  follow: Follow;
  /** The Explorer on the block; null where there is none to open. */
  explore: (() => void) | null;
  onDismiss(): void;
}

/**
 * MME's textblock view beside what named it: what the block does and what
 * runs it, as the Explorer's Rooms tab shows it (`TextblockView`). A panel
 * like the Reference slide-out, sharing its frame: it places, moves, pins,
 * resizes and dismisses as the others do. A block named in it replaces it,
 * as a name clicked in the Reference slide-out does.
 */
export default function TextblockPopover({
  asked,
  ask,
  defaultMap,
  follow,
  explore,
  onDismiss
}: TextblockPopoverProps) {
  const view = useTextblock(ask, asked.n, defaultMap);
  // `hold`: it hangs off a quest step or a link in another panel, which a
  // card redraws on every status line or which this panel replaced.
  const frame = usePopoverFrame({
    anchor: asked.anchor,
    measure: [view.tb, view.mode, view.hideTB],
    onDismiss,
    whenAnchorGone: 'hold'
  });
  return createPortal(
    <div
      aria-label={t('explorer.textblock.title', { n: asked.n })}
      className="surface popover textblock-popover"
      role="dialog"
      {...frame.props}
    >
      <PopoverHead
        badge={null}
        onClose={onDismiss}
        onGrab={frame.onGrab}
        onPin={frame.togglePin}
        pinned={frame.pinned}
      >
        {t('explorer.textblock.title', { n: asked.n })}
      </PopoverHead>
      <div className="popover-body">
        <TextblockView {...view} follow={follow} />
        {explore !== null && (
          <button
            className="ex-link reference-explore"
            onClick={explore}
            onMouseDown={keepFocus}
            type="button"
          >
            {t('cards.reference.openInExplorer')}
          </button>
        )}
      </div>
      <PopoverSizer onReset={frame.onSizeReset} onSize={frame.onSize} />
    </div>,
    document.body
  );
}
