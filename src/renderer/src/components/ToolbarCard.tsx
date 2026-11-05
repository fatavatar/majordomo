import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import BentoCard, { type CardChrome } from './BentoCard';
import Icon from './Icon';
import PopupMenu from './PopupMenu';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { menuPosition } from '../lib/menu';
import { holdsDrop, scrollMovesAnchor } from '../lib/popover';
import { tuning } from '../lib/tuning';
import { toolbarButtons, type ToolbarButton, type ToolbarSubject } from '../lib/toolbar';

export interface ToolbarCardProps extends CardChrome {
  subject: ToolbarSubject;
  /**
   * Which buttons are on the row, and the control that moves one on or off.
   *
   * `pinnedButtons`, not `pinned`: `CardChrome.pinned` already means *this
   * float stays in view whichever character is shown*, and two different
   * pins on one component is how a control ends up wired to the wrong one.
   */
  pinnedButtons: ReadonlySet<string>;
  onPinButton(id: string): void;
}

/**
 * One row of glyphs: what this character is doing on its own, and the dial.
 *
 * A card like every other — it can sit on the rail, be dragged over the
 * console or be docked in a strip — but it ships **docked above the console**,
 * where a toolbar belongs and where it costs one row rather than a rail slot.
 * The strips overlay the console rather than taking rows from it, so a toolbar
 * appearing does not resize the terminal, which would go out over NAWS.
 *
 * ## Every button is a toggle, and the state is the character's own file
 *
 * Pressing a switch writes one boolean into that character's YAML through
 * `SettingsEditor`, comments intact, and the config store's poll brings it
 * back half a second later — the path the Gang card's permission grid already
 * takes. There is no second, session-scoped copy of "is auto-combat on": two
 * places that can answer the same question eventually disagree, and the one
 * somebody reads is whichever is wrong.
 *
 * That also means a toolbar press survives a restart, which for the master
 * switch is the whole point: somebody who turned automation off before going
 * to bed did not mean *until the next launch*.
 *
 * ## The row is curated, and the kebab is where
 *
 * There are more buttons than a row, so the row is what somebody keeps to hand
 * and the `...` at the end is the rest — every button there is, with a check
 * against the ones on the row. `internal.yaml` states the row a fresh client
 * draws; a click deviates from it, remembered per client.
 *
 * The order is fixed whether or not a button is pinned, so unpinning one never
 * moves another out from under the pointer.
 */
export default function ToolbarCard({
  subject,
  pinnedButtons,
  onPinButton,
  ...chrome
}: ToolbarCardProps) {
  return (
    <BentoCard {...chrome} className="toolbar-card" title={t('cards.toolbar.title')}>
      <ToolbarRow
        onPinButton={onPinButton}
        pinnedButtons={pinnedButtons}
        returnFocus={chrome.returnFocus}
        subject={subject}
      />
    </BentoCard>
  );
}

/**
 * The toolbar's row on its own, without a card around it (2026-10-31): what
 * the card holds, and what each character's status in the Stable carries
 * small under its name.
 */
export function ToolbarRow({
  subject,
  pinnedButtons,
  onPinButton,
  returnFocus
}: Pick<ToolbarCardProps, 'subject' | 'pinnedButtons' | 'onPinButton' | 'returnFocus'>) {
  const all = toolbarButtons(subject);
  const shown = all.filter((button) => pinnedButtons.has(button.id));
  const kebab = useRef<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState(false);

  return (
    <>
      <div className="toolbar-row" role="toolbar" aria-label={t('cards.toolbar.title')}>
        {shown.length === 0 ? (
          /*
           * A row somebody has emptied says so and says how to undo it — the
           * same rule a narrowed table follows. Without this the toolbar is a
           * blank strip with a kebab on the end and nothing to say it is not
           * broken.
           */
          <span className="empty">{t('cards.toolbar.emptyRow')}</span>
        ) : (
          shown.map((button, at) =>
            button.card === undefined ? (
              <ToolbarKey button={button} key={button.id} />
            ) : (
              <Fragment key={button.id}>
                {/*
                  A rule between what the character does and what is looked
                  up: the switches and transport light and act, the cards drop
                  down. Before the first card, where anything comes before it.
                */}
                {at > 0 && shown[at - 1]!.card === undefined && (
                  <span aria-hidden="true" className="toolbar-divider" />
                )}
                <ToolbarCardKey button={button} />
              </Fragment>
            )
          )
        )}
        <button
          aria-expanded={menu}
          aria-haspopup="menu"
          className="toolbar-key toolbar-more"
          onClick={() => setMenu((open) => !open)}
          onMouseDown={keepFocus}
          ref={kebab}
          title={t('cards.toolbar.pickButtons')}
          type="button"
        >
          <Icon name="more" />
          <span className="sr-only">{t('cards.toolbar.pickButtons')}</span>
        </button>
      </div>

      {menu && kebab.current && (
        <PopupMenu
          at={kebab.current}
          items={all.map((button) => ({
            /*
             * The pin state is in the *label* rather than in a separate
             * control, because this menu has one job. The palette's rows are
             * commands with a pin at the end; here the row **is** the pin.
             */
            label: pinnedButtons.has(button.id)
              ? t('cards.toolbar.unpin', { label: button.label })
              : t('cards.toolbar.pin', { label: button.label }),
            icon: button.icon,
            run: () => onPinButton(button.id)
          }))}
          onDismiss={() => {
            setMenu(false);
            returnFocus?.();
          }}
        />
      )}
    </>
  );
}

/**
 * One square glyph.
 *
 * `aria-pressed` rather than a class alone: the lit state is the whole message
 * of this control, and somebody who cannot see the tone still has to be told
 * whether their character is fighting on its own. The transport button is not
 * a toggle — it is play *or* stop, and what it presses changes with it — and
 * says so by carrying no pressed state.
 */
function ToolbarKey({ button }: { button: ToolbarButton }) {
  const toggle = button.id !== 'move:toggle';
  return (
    <button
      aria-pressed={toggle ? button.on : undefined}
      className={`toolbar-key${button.on ? ' on' : ''}`}
      disabled={button.disabled === true}
      onClick={button.run}
      // Clicked, never typed into: refusing the mouse's attempt to park the
      // caret leaves the keyboard in the game, where a player needs it.
      onMouseDown={keepFocus}
      title={button.label}
      type="button"
    >
      <Icon name={button.icon} />
      <span className="sr-only">{button.label}</span>
    </button>
  );
}

/**
 * A button that drops a card down (2026-11-01, `TOOLBAR_CARDS`).
 *
 * Opened by a press, never by the pointer passing over it (2026-11-01: a row
 * of glyphs is crossed on the way to everything else); put away by another
 * press, a press elsewhere, or once the pointer has left both the button and
 * the card for `tuning.view.toolbarCardCloseMs`, so crossing the gap between them,
 * or overshooting the card's edge, does not lose it. A menu or panel the card
 * opens is in a portal of its own (`Popup`), so the pointer over one counts as
 * over the card, and a field typed into inside it holds it open until the
 * pointer comes back and leaves again.
 *
 * It never takes the caret: the card is looked at with the keyboard still in
 * the game, unlike a menu, which is driven by the arrow keys.
 */
function ToolbarCardKey({ button }: { button: ToolbarButton }) {
  const key = useRef<HTMLButtonElement | null>(null);
  const drop = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const disabled = button.disabled === true;

  const clear = (): void => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  };
  const after = (ms: number, then: () => void): void => {
    clear();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      then();
    }, ms);
  };
  useEffect(() => clear, []);
  // Out of the realm the card has nothing to draw, and the button greys.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  /*
   * While open, where the pointer goes decides: anywhere outside the button,
   * the card and the popups it opened starts the clock, anywhere inside stops
   * it; a press outside puts it away at once.
   */
  useEffect(() => {
    if (!open) return;
    const keepers = (): Array<HTMLElement | null> => [
      key.current,
      drop.current,
      // A popup the card opened: in a portal of its own straight under the body.
      ...document.body.querySelectorAll<HTMLElement>(':scope > .surface')
    ];
    const over = (event: PointerEvent): void => {
      if (holdsDrop(event.target as Node | null, keepers())) clear();
      else if (!drop.current?.contains(document.activeElement)) {
        after(tuning().toolbarCardCloseMs, () => setOpen(false));
      }
    };
    const away = (event: PointerEvent): void => {
      if (!holdsDrop(event.target as Node | null, keepers())) setOpen(false);
    };
    const scrolled = (event: Event): void => {
      if (scrollMovesAnchor(event.target, key.current)) setOpen(false);
    };
    const resized = (): void => setOpen(false);
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', resized);
    };
  }, [open]);

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`toolbar-key${open ? ' on' : ''}`}
        disabled={disabled}
        onClick={() => {
          clear();
          setOpen((was) => !was);
        }}
        onMouseDown={keepFocus}
        ref={key}
        title={button.label}
        type="button"
      >
        <Icon name={button.icon} />
        <span className="sr-only">{button.label}</span>
      </button>
      {open && key.current && (
        <CardDrop
          anchor={key.current}
          card={button.id}
          label={button.label}
          onDismiss={() => setOpen(false)}
          panel={drop}
        >
          {button.card?.()}
        </CardDrop>
      )}
    </>
  );
}

/**
 * The card's panel, hung under its button in a portal, as `Popup` is, for the
 * same reason: what the button sits in may clip it. Placed from its own
 * measured size, again when the card changes height, and clamped to the
 * window.
 */
function CardDrop({
  anchor,
  card,
  label,
  onDismiss,
  panel,
  children
}: {
  anchor: HTMLElement;
  /** Which card's button, so a card with more to show can be given more room. */
  card: string;
  label: string;
  onDismiss(): void;
  /** The panel's node, which the button reads to tell the card from the rest of the window. */
  panel: React.MutableRefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const node = panel.current;
    if (node === null) return;
    const place = (): void => {
      const box = node.getBoundingClientRect();
      setPosition(
        menuPosition(
          anchor.getBoundingClientRect(),
          { width: box.width, height: box.height },
          { width: window.innerWidth, height: window.innerHeight },
          'start'
        )
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => observer.disconnect();
  }, [anchor, panel]);

  return createPortal(
    <div
      aria-label={label}
      className="toolbar-drop"
      data-card={card}
      data-owns-keys="true"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      ref={panel}
      role="dialog"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position === null ? 'hidden' : 'visible'
      }}
    >
      {children}
    </div>,
    document.body
  );
}
