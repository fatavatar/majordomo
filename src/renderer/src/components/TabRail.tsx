import { Fragment, memo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import Icon, { type IconName } from './Icon';
import PopupMenu, { type MenuItem } from './PopupMenu';
import type { MenuAnchor } from './Popup';
import { reordered } from '../lib/reorder';

import { ratio, vitalLevel, type CharacterState } from '@shared/character';
import type { VitalsUiConfig } from '@shared/config';
import type { SessionId, SessionSummary } from '@shared/ipc';
import type { WalkProgress } from '@shared/walk';
import type { LoopProgress } from '@shared/loops';
import { keepFocus } from '../lib/focus';
import { useTabDrag } from '../hooks/useTabDrag';
import { t } from '../lib/i18n';
import { dialWaits, type ConnectionState } from '@shared/types';

/** What the rail needs to know about a character it is not showing. */
export interface RailView {
  state: ConnectionState;
  character: CharacterState;
  walk: WalkProgress;
  /** The loop it is running, if any — the rail says `looping` off this. */
  loop: LoopProgress;
  /**
   * The tab alerts raised while nobody was looking (`TAB_ALERTS`), and the
   * newest.
   *
   * The point of running four characters is that three of them are unattended,
   * and the point of this rail is that it reports on the ones whose terminal is
   * not on screen. Vitals and walk state already reached it; alerts did not.
   */
  unseen: { alerts: number; latest: string | null };
}

export interface TabRailProps {
  sessions: SessionSummary[];
  views: Record<SessionId, RailView>;
  active: SessionId;
  thresholds: VitalsUiConfig;
  /**
   * The ceiling each character rests to — `automation.health.restTo`, resolved
   * for that character, as a fraction. 0 is the single sit-down at the floor.
   *
   * A function rather than a value because the rail draws every character at
   * once and each resolves its own: the whole point of the rail is the three
   * characters nobody is looking at, so one figure for all four would be the
   * shown character's answer printed on somebody else's tab.
   */
  restToFor(session: SessionId): number;
  /**
   * The characters that have a file behind them.
   *
   * A session whose file was deleted while it was connected stays until it is
   * idle, and has nothing for "Edit" to open — and a menu entry that does
   * nothing is worse than one that is not offered.
   */
  editable: readonly SessionId[];
  onSelect(session: SessionId): void;
  onClose(session: SessionId): void;
  /**
   * The rail, dragged into a new order.
   *
   * Handed the whole order rather than a move: main writes down a list, and
   * deriving that list from a move in two places is two chances to disagree
   * about where a tab landed. Ordering is a property of *this window's* rail —
   * a popped-out character is not in this list at all — which is the same
   * scoping the roster itself already has.
   */
  onReorder(order: SessionId[]): void;
  /** Make a character. The way in, beside the characters it makes. */
  onNew(): void;
  /**
   * The client's own settings — everything a character inherits.
   *
   * Beside the `+` because that is where somebody already is when they want to
   * change something about the client rather than about one character, and to
   * its *left* because it is the more general of the two: a gear then a plus
   * reads as "the client, and one more of these".
   */
  onEditGlobal(): void;
  /** Open this character's own settings. */
  onEdit(session: SessionId): void;
  /**
   * Dial this character, or hang it up — whichever its phase calls for.
   *
   * Addressed, and deliberately not the window's own connect command: the rail
   * reports on the characters nobody is looking at, so the one being dialled is
   * usually not the one on screen. A control here that acted on the *shown*
   * character would disconnect the wrong one, which on this realm is not free
   * (docs/greatermud/combat.md).
   */
  onToggleConnection(session: SessionId): void;
  /**
   * Tab groups (2026-11-09): each group's members, together in `sessions`,
   * drawn as one joined block. A click on a member shows the group.
   */
  groups: ReadonlyArray<readonly SessionId[]>;
  /** The characters in the view on screen: the group shown, or the one character. */
  inView: readonly SessionId[];
  /** A character added to the view on screen, its tab joining the group. */
  onAddToView(session: SessionId): void;
  /** A character of the group shown taken out of it, its tab standing alone again. */
  onRemoveFromView(session: SessionId): void;
}

function alertLabel(count: number): string {
  return count === 1 ? t('tabs.tab.alertSingular') : t('tabs.tab.alertPlural', { count });
}

/**
 * The tab's one chip: trouble first, then what the character is doing.
 *
 * Deliberately one word (`offline`, `fighting`, `resting`, `meditating`,
 * `recovering`, `walking`, `looping`, `stopped`) plus the one mark that wants
 * a person's eye: a tab alert (`TAB_ALERTS`: hung up, the link dropped, fled,
 * ran) raised while nobody was looking. Only those light a tab (2026-10-17);
 * a red bar, a person's blow and a warning are on the character's own cards.
 * Chat is not on the list: a tab that lights up for every gossip line is a
 * tab nobody reads.
 *
 * Trouble outranks activity, and among the activities a fight outranks the
 * rest it interrupted, which outranks the walk that was holding for it, which
 * outranks the loop that planned it -- each is the more specific answer to
 * *what is this character doing* than the one below it. A walk's own holds sit
 * with it rather than under `walking`, for the reason the loop's do: a tab
 * reading `walking` for a character standing still says the opposite of what
 * is happening. Returned as a word as well as a level, because §6 of the
 * design language forbids stating a condition by colour alone — and `info` is
 * the quiet register, for a status that is not a condition.
 */
export function attention(
  view: RailView | undefined,
  restTo: number
): { level: 'critical' | 'warn' | 'info'; label: string; detail?: string } | null {
  if (!view) return null;

  /*
   * Something was raised while nobody was looking. Above the connection's
   * state deliberately: those describe a *standing* condition that is
   * still true and can be read off the tab at any time, and this describes
   * something that happened once and will otherwise be missed.
   */
  if (view.unseen.alerts > 0) {
    return {
      level: 'critical',
      label: alertLabel(view.unseen.alerts),
      ...(view.unseen.latest !== null ? { detail: view.unseen.latest } : {})
    };
  }

  if (view.state.phase === 'error') return { level: 'critical', label: t('tabs.tab.markError') };
  // Only after it had been up: a character nobody has connected yet is idle,
  // not in trouble.
  if (view.state.phase === 'closed') return { level: 'warn', label: t('tabs.tab.markOffline') };

  if (view.character.inCombat) return { level: 'info', label: t('tabs.tab.markFighting') };

  /*
   * Sitting down, and what it is sitting down *to*.
   *
   * The rail reported `fighting`, `walking`, `looping` and `stopped` and had
   * no word for the state an unattended character spends most of its evening
   * in: the recovery between two fights. A character resting looked exactly
   * like one standing idle in a corridor, so the one thing worth knowing about
   * a tab nobody is watching -- whether it is getting better or merely stuck --
   * was the one thing the rail would not say.
   *
   * Above the walk and the loop because it is the more specific fact: a loop
   * holding for health is *resting*, and `looping` there describes the lap
   * rather than the thing the lap is waiting for. Below the fight, because a
   * fight interrupts a rest rather than the other way round.
   *
   * `resting` and `meditating` are the server's own flag, read off the status
   * line -- never a guess from a threshold, which would report a rest the
   * client wanted and the server never granted.
   */
  const vitals = view.character.vitals;
  if (vitals.resting) return { level: 'info', label: restingLabel(restTo) };
  if (vitals.meditating) return { level: 'info', label: t('tabs.tab.markMeditating') };

  /*
   * The beat after running away, and the hold that carries it.
   *
   * `retreated` and `health` are the two holds a *running* loop can be in with the
   * character on its feet -- the escape has landed, the fight is over and the lap
   * is waiting for the health to come back before it plans a leg that may lead
   * straight back in. Drawn as `recovering` rather than `looping`: the lap is
   * not marching, and a tab reading `looping` for a character standing still
   * is the tab saying the opposite of what is happening. `fight` is not here
   * because `inCombat` above has already claimed it.
   */
  if (
    view.loop.status === 'running' &&
    (view.loop.hold === 'retreated' ||
      view.loop.hold === 'health' ||
      view.loop.hold === 'mana' ||
      view.loop.hold === 'resting')
  ) {
    return { level: 'info', label: t('tabs.tab.markRecovering') };
  }

  /*
   * Off buying supplies. Its own word rather than `recovering`: nothing is
   * wrong with the character, it is walking to a shop — and `looping` would be
   * the tab saying the lap is marching when it is held.
   */
  if (view.loop.status === 'running' && view.loop.hold === 'errand') {
    return { level: 'info', label: t('tabs.tab.markShopping') };
  }

  /*
   * The lap a lost connection is carrying, with the socket back up and the
   * character not yet back in the realm and placed — the login screens, and
   * the line before the entry probe answers. The closed socket itself is the
   * `offline` above; this is the same word in the quiet register, because
   * `looping` here would be the tab saying the lap is marching through a
   * login prompt.
   */
  if (view.loop.status === 'running' && view.loop.hold === 'offline') {
    return { level: 'info', label: t('tabs.tab.markOffline') };
  }

  /*
   * A route's own two holds, in the words the loop's already earned. A held
   * walk is still `walking`, so without this a tab read `walking` for a
   * character standing still — for minutes under `restBelow`, and for the
   * whole of a fight whose flag has not arrived yet, since a walk also holds
   * on a blow the tracker filed a round before `*Combat Engaged*`.
   */
  if (view.walk.status === 'walking' && view.walk.hold === 'fight') {
    // `info`, the same register `inCombat` above wears: a fight is what this
    // character is doing, not a condition somebody has to come and look at.
    return { level: 'info', label: t('tabs.tab.markFighting') };
  }
  if (
    view.walk.status === 'walking' &&
    // `resting` is the beat a step waits for a rest this client has just asked
    // for (todo 14). Short, but a tab reading `walking` for a character that is
    // sitting down is the thing these branches exist to prevent.
    (view.walk.hold === 'health' ||
      view.walk.hold === 'mana' ||
      view.walk.hold === 'trap' ||
      view.walk.hold === 'resting')
  ) {
    return { level: 'info', label: t('tabs.tab.markRecovering') };
  }
  /*
   * Standing at a shut door, running the ladder again on its own clock.
   * `warn` for the afflictions' reason: nothing in this client is working on
   * the door, so it is a state somebody may want to come and look at, and a
   * tab reading `walking` for a character standing at a portcullis is the tab
   * saying it is moving when it is not.
   */
  if (view.walk.status === 'walking' && view.walk.hold === 'barrier') {
    return { level: 'warn', label: t('tabs.tab.markBlocked') };
  }
  /*
   * Looking for a hidden exit. `info` rather than `warn`, unlike the door
   * above: this one the client is working on, and it goes on until the exit
   * turns up — a warning that can stand for an hour stops being read as one.
   */
  if (view.walk.status === 'walking' && view.walk.hold === 'searching') {
    return { level: 'info', label: t('tabs.tab.markSearching') };
  }
  /*
   * Standing in a room too dark to read while the torch is lit. `info` for the
   * search's reason — the client is working on it — and bounded, unlike the
   * search: a few seconds, then the walk stops and says why.
   */
  if (view.walk.status === 'walking' && view.walk.hold === 'dark') {
    return { level: 'info', label: t('tabs.tab.markLighting') };
  }
  if (view.walk.status === 'walking' && view.walk.hold === 'party') {
    return { level: 'info', label: t('tabs.tab.markParty') };
  }
  /*
   * Waiting out a stated affliction, on a route or between a lap's legs.
   * `warn`, unlike the holds above: a condition is something the person may
   * want to come and cure, and `walking` or `looping` here would be the tab
   * saying the character is moving when it is standing still and blind.
   */
  const afflicted =
    (view.walk.status === 'walking' &&
      (view.walk.hold === 'blind' ||
        view.walk.hold === 'held' ||
        view.walk.hold === 'poisoned' ||
        view.walk.hold === 'condition') &&
      view.walk.hold) ||
    (view.loop.status === 'running' &&
      (view.loop.hold === 'blind' ||
        view.loop.hold === 'held' ||
        view.loop.hold === 'poisoned' ||
        view.loop.hold === 'condition') &&
      view.loop.hold) ||
    null;
  if (afflicted === 'blind') return { level: 'warn', label: t('tabs.tab.markBlind') };
  if (afflicted === 'held') return { level: 'warn', label: t('tabs.tab.markHeld') };
  if (afflicted === 'poisoned') return { level: 'warn', label: t('tabs.tab.markPoisoned') };
  if (afflicted === 'condition') return { level: 'warn', label: t('tabs.tab.markCondition') };
  if (view.walk.status === 'walking') return { level: 'info', label: t('tabs.tab.markWalking') };
  if (view.loop.status === 'running') return { level: 'info', label: t('tabs.tab.markLooping') };

  if (view.walk.status === 'stopped' || view.loop.status === 'stopped') {
    return { level: 'warn', label: t('tabs.tab.markStopped') };
  }

  return null;
}

/**
 * What a rest is resting *to*, in the ceiling's own words.
 *
 * `restTo` is the fraction a stretch of resting is carried on to, and the
 * whole reason it is worth printing on a tab is that it answers "will this be
 * a moment or four minutes" without switching to the character. 0 is no
 * ceiling -- a single sit-down at the floor -- and claims nothing beyond the
 * flag itself; a full one is said in the word people use for it rather than as
 * `resting to 100%`.
 */
function restingLabel(restTo: number): string {
  if (restTo <= 0) return t('tabs.tab.markResting');
  if (restTo >= 1) return t('tabs.tab.markRestingToFull');
  return t('tabs.tab.markRestingTo', { percent: Math.round(restTo * 100) });
}

/** One line for what this character is doing, or nothing when it is just playing. */
function activity(view: RailView | undefined): string | null {
  if (!view) return null;
  if (view.walk.status === 'walking') {
    return t('tabs.tab.activityWalking', { done: view.walk.done, total: view.walk.total });
  }
  if (view.state.phase === 'connecting') return t('tabs.tab.activityConnecting');
  if (view.state.phase === 'closed') return t('tabs.tab.activityDisconnected');
  return null;
}

/**
 * What a character is doing, as one glyph (2026-11-10): the word `attention`
 * gives is its title. Shared with a group's slimmed status (`GroupSlim`).
 */
export function glyphOf(view: RailView): IconName | null {
  if (view.unseen.alerts > 0) return 'flag';
  if (view.state.phase === 'error' || view.state.phase === 'closed') return 'unplug';
  if (view.character.inCombat) return 'sword';
  if (view.character.vitals.resting || view.character.vitals.meditating) return 'moon';
  if (view.walk.status === 'walking') return 'route';
  if (view.loop.status === 'running') return 'loop';
  return null;
}

/**
 * The characters this window holds, one row across the top (2026-11-10), and
 * which one it is showing.
 *
 * Not merely a switcher. The reason to look at a second character is almost
 * never to read its scrollback — it is to see that it is at 20% health, or that
 * its walk stopped. So each tab is its health and mana as two upright bars, its
 * name, what it is doing as a glyph (the word as its title), where it is or how
 * far through its walk, and the alerts raised while nobody was looking. The
 * rail down a side, which spent the console's columns on the same facts in
 * three rows, is retired: the row costs one line of height and the console
 * keeps its width.
 *
 * The tab being shown carries its own controls — dial, settings, close — and
 * every tab answers a right-click with them all, and with the view's add and
 * remove; the others stay a name and its state, which is what keeps the row
 * one line. A tab is dragged by itself, past the slop, into the order wanted.
 * A tab group's tabs are one frame (`lib/tabGroups.ts`).
 */
function TabRail({
  sessions,
  views,
  active,
  thresholds,
  restToFor,
  editable,
  onSelect,
  onClose,
  onReorder,
  onNew,
  onEditGlobal,
  onEdit,
  onToggleConnection,
  groups,
  inView,
  onAddToView,
  onRemoveFromView
}: TabRailProps) {
  /*
   * The rail is the player's arrangement of their characters, exactly as the
   * card rail is their arrangement of what they watch — so it is dragged, and
   * the order is remembered. Ids and not summaries: two characters can share
   * a display name.
   */
  const drag = useTabDrag(
    sessions.map((entry) => entry.id),
    onReorder
  );
  // The right-click menu, and the tab it is for.
  const [menu, setMenu] = useState<{ id: SessionId; at: MenuAnchor } | null>(null);
  /*
   * Where the tab would land, as a gap its own size — and not where the drop
   * would change nothing, because there the dimmed tab is already the gap.
   */
  const order = sessions.map((entry) => entry.id);
  const dropAt =
    drag.session !== null &&
    drag.index !== null &&
    reordered(order, drag.session, drag.index) !== order
      ? drag.index
      : null;
  const slot =
    dropAt !== null && drag.ghost !== null ? (
      <div
        className="rail-slot"
        style={
          {
            '--slot-w': `${drag.ghost.w}px`,
            '--slot-h': `${drag.ghost.h}px`
          } as CSSProperties
        }
      />
    ) : null;
  // The dragged tab's ghost, through a portal, carrying the name.
  const held = drag.session === null ? null : sessions.find((entry) => entry.id === drag.session);
  const ghost =
    drag.ghost !== null && held !== undefined && held !== null
      ? createPortal(
          <div
            className="drag-ghost tab-ghost"
            style={{
              left: drag.ghost.x,
              top: drag.ghost.y,
              width: drag.ghost.w,
              height: drag.ghost.h
            }}
          >
            {held.name}
          </div>,
          document.body
        )
      : null;

  /*
   * A group's tabs together in one joined block (2026-11-09): `sessions` has
   * them side by side already (`railOrder`), so the blocks are runs of it.
   */
  const segments: SessionSummary[][] = [];
  for (const entry of sessions) {
    const last = segments[segments.length - 1];
    const group = groups.find((members) => members.includes(entry.id));
    if (group !== undefined && last !== undefined && group.includes(last[0]!.id)) last.push(entry);
    else segments.push([entry]);
  }

  /** Every action a tab has, for its right-click. */
  const menuFor = (id: SessionId): MenuItem[] => {
    const session = sessions.find((entry) => entry.id === id);
    if (session === undefined) return [];
    const phase = views[id]?.state.phase ?? 'idle';
    const connected = phase === 'connected' || session.retrying;
    const here = inView.includes(id);
    return [
      {
        label: connected
          ? session.retrying
            ? t('tabs.tab.dialStopRetryingAria', { characterName: session.name })
            : t('tabs.tab.dialDisconnectAria', { characterName: session.name })
          : t('tabs.tab.dialConnectAria', { characterName: session.name }),
        icon: connected ? 'stop' : 'play',
        disabled: dialWaits(phase),
        run: () => onToggleConnection(id)
      },
      ...(editable.includes(id)
        ? [
            {
              label: t('tabs.tab.editAria', { characterName: session.name }),
              icon: 'edit' as const,
              run: () => onEdit(id)
            }
          ]
        : []),
      ...(!here
        ? [
            {
              label: t('group.tabs.addAria', { characterName: session.name }),
              icon: 'plus' as const,
              run: () => onAddToView(id)
            }
          ]
        : inView.length > 1
          ? [
              {
                label: t('group.tabs.removeAria', { characterName: session.name }),
                icon: 'minus' as const,
                run: () => onRemoveFromView(id)
              }
            ]
          : []),
      {
        label: t('tabs.tab.closeAria', { characterName: session.name }),
        icon: 'close',
        danger: true,
        run: () => onClose(id)
      }
    ];
  };

  const drawTab = (session: SessionSummary): React.JSX.Element => {
    const at = sessions.indexOf(session);
    const view = views[session.id];
    const vitals = view?.character.vitals;
    const hp = ratio(vitals?.hp ?? null, vitals?.hpMax ?? null);
    const mana = ratio(vitals?.mana ?? null, vitals?.manaMax ?? null);
    const hpLevel = vitalLevel(vitals?.hp ?? null, vitals?.hpMax ?? null, thresholds.hp);
    const manaLevel = vitalLevel(vitals?.mana ?? null, vitals?.manaMax ?? null, thresholds.mana);
    const mark = view === undefined ? null : attention(view, restToFor(session.id));
    const glyph = view === undefined ? null : glyphOf(view);
    // Where it is, or how far through its walk: the room the tab carries after its state.
    const where = activity(view) ?? view?.character.room.name ?? null;
    const isActive = session.id === active;
    const phase = view?.state.phase ?? 'idle';
    const alerts = view?.unseen.alerts ?? 0;
    const figures =
      vitals === undefined
        ? undefined
        : `${t('group.row.hp')} ${vitals.hp ?? '–'}${vitals.hpMax === null ? '' : `/${vitals.hpMax}`}` +
          (vitals.manaMax === null
            ? ''
            : ` · ${t('group.row.mana')} ${vitals.mana ?? '–'}/${vitals.manaMax}`);
    const busy = dialWaits(phase);
    const dialLabel =
      phase === 'connected'
        ? t('tabs.tab.dialDisconnectAria', { characterName: session.name })
        : session.retrying
          ? t('tabs.tab.dialStopRetryingAria', { characterName: session.name })
          : t('tabs.tab.dialConnectAria', { characterName: session.name });

    return (
      <Fragment key={session.id}>
        {/* Where the tab would land: a gap between tabs, never a highlight on one. */}
        {dropAt === at && slot}
        <div
          aria-selected={isActive}
          className="tab"
          data-accent={session.accent}
          data-active={isActive ? 'true' : 'false'}
          data-dragging={drag.session === session.id ? 'true' : undefined}
          // Two characters can share a display name, so the tab keys on the id.
          data-session={session.id}
          data-phase={phase}
          onClick={() => {
            // A drop that came to rest on its own tab is not a switch.
            if (!drag.consumeClick()) onSelect(session.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({
              id: session.id,
              at:
                event.clientX === 0 && event.clientY === 0
                  ? event.currentTarget
                  : { x: event.clientX, y: event.clientY }
            });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(session.id);
            }
          }}
          // Dragged by itself, past the slop; the caret stays in the game.
          onPointerDown={(event) => drag.begin(session.id, event)}
          role="tab"
          tabIndex={0}
          title={t('tabs.tab.whoTooltip', {
            characterName: session.name,
            realmName: session.server
          })}
        >
          {/*
            Health and mana, upright side by side, in the vitals' own levels;
            a null fraction is an empty track, never a full or a red one.
          */}
          <span className="tab-bars" title={figures}>
            <span className="tab-bar" data-kind="hp" data-level={hpLevel}>
              <span style={{ height: hp === null ? 0 : `${hp * 100}%` }} />
            </span>
            <span className="tab-bar" data-kind="mana" data-level={manaLevel}>
              <span style={{ height: mana === null ? 0 : `${mana * 100}%` }} />
            </span>
          </span>
          <span className="name">{session.name}</span>
          {glyph !== null && (
            <span
              className="tab-glyph"
              data-level={mark?.level ?? 'info'}
              title={mark?.detail ?? mark?.label}
            >
              <Icon name={glyph} />
            </span>
          )}
          {where !== null && (
            <span className="where" title={where}>
              {where}
            </span>
          )}
          {alerts > 0 && (
            <span className="tab-alerts" title={mark?.detail ?? mark?.label}>
              {alerts}
            </span>
          )}
          {/* The tab being shown carries its controls; every tab has them on a right-click. */}
          {isActive && (
            <span className="tab-controls">
              <button
                aria-label={dialLabel}
                className="dial"
                data-phase={phase}
                disabled={busy}
                onClick={(event) => {
                  // The tab underneath would otherwise select the character.
                  event.stopPropagation();
                  onToggleConnection(session.id);
                }}
                onMouseDown={keepFocus}
                onPointerDown={(event) => event.stopPropagation()}
                title={
                  busy
                    ? t('tabs.tab.dialClosingTooltip')
                    : phase === 'connecting'
                      ? t('tabs.tab.dialAgainTooltip', { characterName: session.name })
                      : dialLabel
                }
                type="button"
              >
                <Icon name={phase === 'connected' || session.retrying ? 'stop' : 'play'} />
              </button>
              {editable.includes(session.id) && (
                <button
                  aria-label={t('tabs.tab.editAria', { characterName: session.name })}
                  className="edit"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(session.id);
                  }}
                  onMouseDown={keepFocus}
                  onPointerDown={(event) => event.stopPropagation()}
                  title={t('tabs.tab.editAria', { characterName: session.name })}
                  type="button"
                >
                  <Icon name="edit" />
                </button>
              )}
              <button
                aria-label={t('tabs.tab.closeAria', { characterName: session.name })}
                className="close"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(session.id);
                }}
                onMouseDown={keepFocus}
                onPointerDown={(event) => event.stopPropagation()}
                title={t('tabs.tab.closeAria', { characterName: session.name })}
                type="button"
              >
                <Icon name="close" />
              </button>
            </span>
          )}
        </div>
      </Fragment>
    );
  };

  if (sessions.length === 0) return null;

  return (
    <div className="tab-rail" role="tablist">
      {ghost}
      {/*
        The client's settings and making a character, at the head of the row:
        a trailing button would move every time somebody is added or removed.
      */}
      <div className="rail-head">
        <button
          aria-label={t('tabs.head.settingsAria')}
          className="new-character rail-settings"
          onClick={onEditGlobal}
          onMouseDown={keepFocus}
          title={t('tabs.head.settingsTooltip')}
          type="button"
        >
          <Icon name="settings" />
        </button>
        <button
          aria-label={t('tabs.head.newCharacterAria')}
          className="new-character"
          onClick={onNew}
          onMouseDown={keepFocus}
          title={t('tabs.head.newCharacterTooltip')}
          type="button"
        >
          <Icon name="plus" />
        </button>
      </div>

      {/* The tabs scroll when they outrun the window; the head does not. */}
      <div className="tabs">
        {segments.map((segment) =>
          segment.length > 1 ? (
            <div
              aria-label={t('group.tabs.label', {
                names: segment.map((entry) => entry.name).join(', ')
              })}
              className="tab-group"
              data-active={segment.some((entry) => entry.id === active) ? 'true' : 'false'}
              key={`group:${segment[0]!.id}`}
              role="group"
            >
              {segment.map(drawTab)}
            </div>
          ) : (
            segment.map(drawTab)
          )
        )}
        {/* The gap past the last tab: dropping beyond the row means the end. */}
        {dropAt === sessions.length && slot}
      </div>
      {menu !== null && (
        <PopupMenu
          at={menu.at}
          // Put away as an entry runs: the menu leaves that to its owner.
          items={menuFor(menu.id).map((item) => ({
            ...item,
            run: () => {
              setMenu(null);
              item.run();
            }
          }))}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/*
 * Memoised, because the window's root re-renders for things that are not the
 * rail's business — a flyout opening, the palette closing — and the rail draws
 * a tab per character. `views` changes whenever any character's state moves,
 * and that is exactly when it redraws.
 */
export default memo(TabRail);
