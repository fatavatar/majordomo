import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { HeldRound } from './RoundTimer';
import {
  experienceFigures,
  rate,
  RateGraph,
  ScopePicker,
  useExperienceView
} from './ExperienceScope';
import { attention, type RailView } from './TabRail';
import { musterChoices } from './PartyCard';
import PopupMenu from './PopupMenu';
import Icon from './Icon';
import { CARDS, type CardId } from '../hooks/useCardLayout';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { tuning } from '../lib/tuning';
import { ratio, vitalLevel, type CharacterState } from '@shared/character';
import type { VitalsUiConfig } from '@shared/config';
import type { SessionId } from '@shared/ipc';
import { DEFAULT_STATS_GRAPH, experienceWithin } from '@shared/tally';
import { dialWaits } from '@shared/types';
import { sameName, type MusterTarget, type PartyRoster } from '@shared/partyRoster';

/**
 * The Stable (2026-10-31): every character in the realm at once, one row
 * each, its status beside its own console. The card rethink's V1, asked for
 * because the client was built around one character at a keyboard and is
 * played as a stable of them, mostly unattended: the question on sitting down
 * is how all of them are doing, and before this it took a tab switch each.
 *
 * The consoles are the window's own, the ones every character keeps mounted
 * (`SessionTerminal`), placed in the Stable's grid beside these panels rather
 * than drawn again; this file is the rest of it.
 */

/** What a row's status reads: the rail's view, and the round timer. */
export type StableRowView = RailView & { round: HeldRound };

/** Whether a character is in the realm, or on its way there: it gets a row, not a tile. */
export function inRealm(view: Pick<RailView, 'state'> | undefined): boolean {
  const phase = view?.state.phase ?? 'idle';
  return phase !== 'idle' && phase !== 'closed' && phase !== 'error';
}

/** Experience made, in the unit that keeps it readable: `982M`, `41.5k`. */
export function amount(value: number): string {
  const size = Math.abs(value);
  if (size >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (size >= 1_000_000) return `${(value / 1_000_000).toFixed(size >= 100_000_000 ? 0 : 1)}M`;
  if (size >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

/** A vital as a bar draws it: its share, its level against the thresholds, and its figures. */
export function barOf(
  current: number | null,
  max: number | null,
  thresholds: VitalsUiConfig['hp']
): { width: string; level: string; text: string } {
  return {
    width: `${Math.round((ratio(current, max) ?? 0) * 100)}%`,
    level: vitalLevel(current, max, thresholds),
    text: current === null ? '–' : max === null ? String(current) : `${current}/${max}`
  };
}

/** Class, level and race, as a line under a name. */
function whoOf(character: CharacterState): string {
  return [
    character.className,
    character.progress.level === null ? null : String(character.progress.level),
    character.race
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

/** What it is doing in words: the lap and where in it, or the route and how far. */
function doingOf(view: RailView): string | null {
  const { loop, walk } = view;
  if (loop.status === 'running' && loop.name !== null) {
    return t('stable.row.looping', {
      loop: loop.name,
      laps: loop.laps,
      stop: loop.stop,
      stops: loop.stops
    });
  }
  if (walk.status === 'walking') {
    return t('stable.row.walking', {
      to: walk.destination ?? '',
      done: walk.done,
      total: walk.total
    });
  }
  return null;
}

export interface StableStatusProps {
  session: SessionId;
  name: string;
  view: StableRowView;
  /** The Stable's grid cell this panel takes. */
  cell: CSSProperties;
  focused: boolean;
  restTo: number;
  /** The experience made since the person last looked, or null where nothing is owed. */
  since: number | null;
  onOpen(session: SessionId): void;
  onStop(session: SessionId): void;
  onFocus(session: SessionId): void;
  /** Leave it out of the Stable (`useLeftOut`). */
  onLeaveOut(session: SessionId): void;
  /** The experience's hours views restarted, as the Vitals card's reset does. */
  onExpReset(session: SessionId): void;
  /** Its settings, as its tab's pencil opens them; absent for a character with no file. */
  onEdit?: (session: SessionId) => void;
  /** The other cards placed on it, drawn for this character. */
  cards: ReactNode;
  /** The cards on it, and the press that puts one on or takes it off. */
  placed: readonly CardId[];
  onPlace(card: CardId): void;
}

/** One character's status, to the left of its console. */
export const StableStatus = memo(function StableStatus({
  session,
  name,
  view,
  cell,
  focused,
  restTo,
  since,
  onOpen,
  onStop,
  onFocus,
  onLeaveOut,
  onExpReset,
  onEdit,
  cards,
  placed,
  onPlace
}: StableStatusProps) {
  const { character } = view;
  const { room } = character;
  const mark = attention(view, restTo);
  const doing = doingOf(view);
  const moving = view.loop.status === 'running' || view.walk.status === 'walking';
  const who = whoOf(character);
  return (
    <section
      aria-label={name}
      className="stable-status"
      data-focused={focused ? 'true' : 'false'}
      onMouseDown={() => onFocus(session)}
      style={cell}
    >
      <header className="stable-head">
        <span className="stable-name">
          <b>{character.name ?? name}</b>
          {who !== '' && <span className="quiet">{who}</span>}
        </span>
        <span className="stable-head-side">
          <span
            className="chip"
            data-level={mark?.level ?? 'info'}
            title={mark?.detail ?? undefined}
          >
            {mark?.label ?? t('stable.row.idle')}
          </span>
          {onEdit !== undefined && <EditCharacter name={name} onEdit={() => onEdit(session)} />}
        </span>
      </header>
      <div className="stable-where">
        <span>{room.name ?? t('stable.row.nowhere')}</span>
        {doing !== null && <span className="quiet">{doing}</span>}
      </div>
      {cards}
      <StableRate
        character={character}
        note={null}
        onReset={() => onExpReset(session)}
        session={session}
        since={since}
      />
      <footer className="stable-actions">
        <button
          className="primary"
          onClick={() => onOpen(session)}
          onMouseDown={keepFocus}
          title={t('stable.row.openTitle', { name })}
          type="button"
        >
          {t('stable.row.open')}
        </button>
        {moving && (
          <button onClick={() => onStop(session)} onMouseDown={keepFocus} type="button">
            {t('stable.row.stop')}
          </button>
        )}
        <CardPlacer name={name} onPlace={onPlace} placed={placed} />
        <button
          className="quiet"
          onClick={() => onLeaveOut(session)}
          onMouseDown={keepFocus}
          title={t('stable.row.leaveOutTitle', { name })}
          type="button"
        >
          {t('stable.row.leaveOut')}
        </button>
      </footer>
    </section>
  );
});

/**
 * A character's settings from the Stable (2026-10-31): the pencil its tab
 * draws, beside its state, so the Stable has the way in the tab rail has.
 */
function EditCharacter({ name, onEdit }: { name: string; onEdit(): void }): React.JSX.Element {
  return (
    <button
      aria-label={t('tabs.tab.editAria', { characterName: name })}
      className="stable-edit"
      onClick={onEdit}
      // The settings screen takes the caret itself, as from the tab.
      onMouseDown={keepFocus}
      title={t('tabs.tab.editAria', { characterName: name })}
      type="button"
    >
      <Icon name="edit" />
    </button>
  );
}

/**
 * The experience as the Vitals card has it, the session or the hours it last
 * chose for the character: the figure, what was made since the person last
 * looked, and the card's own graph, a bar a bin with the rate ruled across.
 */
function StableRate({
  character,
  session,
  since,
  note,
  onReset
}: {
  character: CharacterState;
  session: SessionId;
  since: number | null;
  note: string | null;
  /** The hours views' own reset, the Vitals card's. */
  onReset(): void;
}) {
  const exp = useExperienceView(character, session);
  return (
    <div className="stable-rate">
      {/* The Vitals card's own choice of window (2026-11-01): one choice, read by both. */}
      <ScopePicker onReset={onReset} view={exp} />
      <span className="stable-rate-figures">
        <b data-none={exp.perHour === null ? 'true' : undefined}>{rate(exp.perHour)}</b>
        {note !== null && <span className="quiet">{note}</span>}
        {since !== null && since > 0 && (
          <span className="quiet">{t('stable.row.since', { made: amount(since) })}</span>
        )}
      </span>
      <RateGraph
        away={character.tally.away}
        current={exp.perHour}
        from={exp.from}
        graph={DEFAULT_STATS_GRAPH}
        label={
          exp.scope === 'session'
            ? t('cards.vitals.scope.graphSession')
            : t('cards.stats.graphLabel', { hours: Number(exp.scope) })
        }
        leftAt={character.tally.leftAt}
        now={exp.now}
        samples={character.tally.samples}
      />
    </div>
  );
}

export interface StablePartyProps {
  roster: PartyRoster;
  members: ReadonlyArray<{ id: SessionId; name: string; accent: string; view: StableRowView }>;
  /** The Stable's grid cell: the rows its members' consoles take. */
  cell: CSSProperties;
  focused: SessionId;
  thresholds: VitalsUiConfig;
  restToFor(session: SessionId): number;
  /** What the leader made since the person last looked. */
  since: number | null;
  onOpen(session: SessionId): void;
  onStop(session: SessionId): void;
  onFocus(session: SessionId): void;
  onLeaveOut(session: SessionId): void;
  /** The experience's hours views restarted, as the Vitals card's reset does. */
  onExpReset(session: SessionId): void;
  /** A member's settings; absent for one with no file. */
  editFor(session: SessionId): ((session: SessionId) => void) | undefined;
  onRegroup(roster: string): void;
  onMuster(roster: string, target: MusterTarget): void;
  /** Disband: the party broken up in the realm and its roster forgotten. */
  onDisband(roster: string): void;
  /** The other cards placed on it, drawn for the member with the keyboard. */
  cards: ReactNode;
  placed: readonly CardId[];
  onPlace(card: CardId): void;
}

/**
 * A party's status, to the left of its members' consoles (2026-10-31): the
 * party and its commands at the head — Regroup, Muster and Stop, what the
 * Party card offers — then every member's state, health and mana together,
 * where the party is and what it is walking, and the leader's experience.
 * One block in place of the Party card, which the Stable has no rail for.
 */
export const StableParty = memo(function StableParty({
  roster,
  members,
  cell,
  focused,
  thresholds,
  restToFor,
  since,
  onOpen,
  onStop,
  onFocus,
  onLeaveOut,
  onExpReset,
  editFor,
  onRegroup,
  onMuster,
  onDisband,
  cards,
  placed,
  onPlace
}: StablePartyProps) {
  const lead = members[0]!;
  const leader = roster.leader ?? lead.name;
  const rooms = new Set(
    members.map(({ view }) => {
      const { room } = view.character;
      return room.map === null ? room.name : `${room.map}/${room.number}`;
    })
  );
  const fighting = members.some(({ view }) => view.character.inCombat);
  const leadMark = attention(lead.view, restToFor(lead.id));
  const moving = members.some(
    ({ view }) => view.loop.status === 'running' || view.walk.status === 'walking'
  );
  const doing = members.map(({ view }) => doingOf(view)).find((line) => line !== null) ?? null;
  const choices = musterChoices(roster);
  return (
    <section
      aria-label={t('stable.party.label', { leader })}
      className="stable-status stable-party"
      data-focused={members.some((member) => member.id === focused) ? 'true' : 'false'}
      style={cell}
    >
      <header className="stable-head">
        <span className="stable-name">
          <b>{t('stable.party.title', { leader })}</b>
          <span className="quiet">
            {t('stable.party.inRealm', {
              count: members.length,
              of: roster.members.length - roster.forgotten.length
            })}
            {' · '}
            {rooms.size === 1 ? t('stable.party.together') : t('stable.party.apart')}
          </span>
        </span>
        <span className="stable-head-side">
          <span
            className="chip"
            data-level={fighting ? 'info' : (leadMark?.level ?? 'info')}
            title={leadMark?.detail ?? undefined}
          >
            {fighting ? t('tabs.tab.markFighting') : (leadMark?.label ?? t('stable.row.idle'))}
          </span>
          <button
            aria-label={t('stable.party.disbandTitle', { leader })}
            className="stable-disband"
            onClick={() => onDisband(roster.id)}
            onMouseDown={keepFocus}
            title={t('stable.party.disbandTitle', { leader })}
            type="button"
          >
            <Icon name="clearCircle" />
          </button>
        </span>
      </header>
      <div className="stable-commands">
        <button onClick={() => onRegroup(roster.id)} onMouseDown={keepFocus} type="button">
          {t('stable.party.regroup')}
        </button>
        {choices.length > 0 && (
          <select
            aria-label={t('stable.party.muster')}
            className="stable-muster"
            onChange={(event) => {
              const choice = choices.find((option) => option.key === event.target.value);
              if (choice !== undefined) onMuster(roster.id, choice.target);
              event.target.value = '';
            }}
            value=""
          >
            <option value="">{t('stable.party.muster')}</option>
            {choices.map((option) => (
              <option key={option.key} title={option.title} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        {moving && (
          <button
            onClick={() => {
              for (const member of members) onStop(member.id);
            }}
            onMouseDown={keepFocus}
            type="button"
          >
            {t('stable.party.stop')}
          </button>
        )}
      </div>
      <div className="stable-members">
        {members.map(({ id, name, accent, view }) => {
          const { character } = view;
          const { vitals } = character;
          const mark = attention(view, restToFor(id));
          const hp = barOf(vitals.hp, vitals.hpMax, thresholds.hp);
          const mana = barOf(vitals.mana, vitals.manaMax, thresholds.mana);
          const isLeader = sameName(leader, character.name ?? name);
          const edit = editFor(id);
          return (
            <div
              className="stable-member"
              data-focused={id === focused ? 'true' : 'false'}
              data-who={accent}
              key={id}
              onMouseDown={() => onFocus(id)}
            >
              <span className="stable-member-name">
                <span aria-hidden="true" className="stable-who" />
                <b>
                  {character.name ?? name}
                  {isLeader ? ' ★' : ''}
                </b>
                <span className="quiet">{whoOf(character)}</span>
              </span>
              <span className="stable-head-side">
                <span className="chip" data-level={mark?.level ?? 'info'} title={mark?.detail}>
                  {mark?.label ?? t('stable.row.idle')}
                </span>
                {edit !== undefined && <EditCharacter name={name} onEdit={() => edit(id)} />}
              </span>
              <span className="stable-member-bars">
                <span className="stable-bar" data-kind="hp" data-level={hp.level}>
                  <span style={{ width: hp.width }} />
                </span>
                <span className="stable-bar thin" data-kind="mana" data-level={mana.level}>
                  <span style={{ width: mana.width }} />
                </span>
              </span>
              <span className="stable-member-figures">
                <span className="stable-figure">{hp.text}</span>
                <span className="quiet">{mana.text}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="stable-where">
        <span>{lead.view.character.room.name ?? t('stable.row.nowhere')}</span>
        {doing !== null && <span className="quiet">{doing}</span>}
      </div>
      {cards}
      <StableRate
        character={lead.view.character}
        note={t('stable.party.each', { count: members.length })}
        onReset={() => onExpReset(lead.id)}
        session={lead.id}
        since={since}
      />
      <footer className="stable-actions">
        {members.map((member, at) => (
          <button
            className={at === 0 ? 'primary' : undefined}
            key={member.id}
            onClick={() => onOpen(member.id)}
            onMouseDown={keepFocus}
            title={t('stable.row.openTitle', { name: member.name })}
            type="button"
          >
            {t('stable.party.open', { name: member.name })}
          </button>
        ))}
        <CardPlacer name={t('stable.party.title', { leader })} onPlace={onPlace} placed={placed} />
        <button
          className="quiet"
          onClick={() => {
            for (const member of members) onLeaveOut(member.id);
          }}
          onMouseDown={keepFocus}
          title={t('stable.party.leaveOutTitle', { leader })}
          type="button"
        >
          {t('stable.row.leaveOut')}
        </button>
      </footer>
    </section>
  );
});

/**
 * The Stable's sizes (2026-10-31): the status column's width, and each
 * character's console height where it was dragged from the default. Per
 * browser, as the Explorer's split is: one person's screen.
 */
export interface StableSizes {
  status: number | null;
  /** By block: a solo character's id, or `party:<roster>`. */
  heights: Record<string, number>;
}
const SIZES_KEY = 'mudengine.stable.sizes';
function readSizes(): StableSizes {
  try {
    const stored = JSON.parse(localStorage.getItem(SIZES_KEY) ?? 'null') as {
      status?: unknown;
      heights?: unknown;
    } | null;
    const heights: Record<string, number> = {};
    if (typeof stored?.heights === 'object' && stored.heights !== null) {
      for (const [id, px] of Object.entries(stored.heights as Record<string, unknown>))
        if (typeof px === 'number' && px > 0) heights[id] = px;
    }
    return { status: typeof stored?.status === 'number' ? stored.status : null, heights };
  } catch {
    return { status: null, heights: {} };
  }
}
export function useStableSizes(): StableSizes & {
  setStatus(px: number | null): void;
  setHeight(block: string, px: number | null): void;
} {
  const [sizes, setSizes] = useState<StableSizes>(readSizes);
  useEffect(() => {
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
    } catch {
      // Storage refused: the sizes last this visit.
    }
  }, [sizes]);
  return {
    ...sizes,
    setStatus: (px) => setSizes((was) => ({ ...was, status: px })),
    setHeight: (block, px) =>
      setSizes((was) => {
        const heights = { ...was.heights };
        if (px === null) delete heights[block];
        else heights[block] = px;
        return { ...was, heights };
      })
  };
}

/**
 * The cards placed on each status of the Stable (2026-10-31), by block: a
 * solo character's id, or `party:<roster>`. The toolbar is on every status
 * until it is taken off; the rest are put on from the status's own picker.
 * Per browser, as a card layout is.
 */
const STATUS_CARDS_KEY = 'mudengine.stable.statusCards';
const STATUS_DEFAULT: readonly CardId[] = ['toolbar'];
const KNOWN_CARDS = new Set<string>(CARDS.map((card) => card.id));
function readStatusCards(): Record<string, CardId[]> {
  try {
    const stored = JSON.parse(localStorage.getItem(STATUS_CARDS_KEY) ?? '{}') as unknown;
    const out: Record<string, CardId[]> = {};
    if (typeof stored === 'object' && stored !== null) {
      for (const [key, ids] of Object.entries(stored as Record<string, unknown>))
        if (Array.isArray(ids))
          out[key] = ids.filter(
            (id): id is CardId => typeof id === 'string' && KNOWN_CARDS.has(id)
          );
    }
    return out;
  } catch {
    return {};
  }
}
/** The heights the status cards were dragged to, by `<block>|<card>`, in px. */
const STATUS_HEIGHTS_KEY = 'mudengine.stable.statusCardHeights';
function readStatusHeights(): Record<string, number> {
  try {
    const stored = JSON.parse(localStorage.getItem(STATUS_HEIGHTS_KEY) ?? '{}') as unknown;
    const out: Record<string, number> = {};
    if (typeof stored === 'object' && stored !== null) {
      for (const [key, px] of Object.entries(stored as Record<string, unknown>))
        if (typeof px === 'number' && px > 0) out[key] = px;
    }
    return out;
  } catch {
    return {};
  }
}

export function useStatusCards(): {
  cardsOf(block: string): readonly CardId[];
  toggle(block: string, card: CardId): void;
  /** A placed card's height where its corner grip was dragged, else undefined. */
  heightOf(block: string, card: CardId): number | undefined;
  setHeight(block: string, card: CardId, px: number | null): void;
} {
  const [placed, setPlaced] = useState<Record<string, CardId[]>>(readStatusCards);
  const [heights, setHeights] = useState<Record<string, number>>(readStatusHeights);
  useEffect(() => {
    try {
      localStorage.setItem(STATUS_CARDS_KEY, JSON.stringify(placed));
    } catch {
      // Storage refused: the cards last this visit.
    }
  }, [placed]);
  useEffect(() => {
    try {
      localStorage.setItem(STATUS_HEIGHTS_KEY, JSON.stringify(heights));
    } catch {
      // Storage refused: the heights last this visit.
    }
  }, [heights]);
  return {
    heightOf: (block, card) => heights[`${block}|${card}`],
    setHeight: (block, card, px) =>
      setHeights((was) => {
        const next = { ...was };
        if (px === null) delete next[`${block}|${card}`];
        else next[`${block}|${card}`] = px;
        return next;
      }),
    cardsOf: (block) => placed[block] ?? STATUS_DEFAULT,
    toggle: (block, card) =>
      setPlaced((was) => {
        const now = was[block] ?? [...STATUS_DEFAULT];
        return {
          ...was,
          [block]: now.includes(card) ? now.filter((id) => id !== card) : [...now, card]
        };
      })
  };
}

/** "+ Add card": every card, a check against those on this status, a press to put one on or off. */
function CardPlacer({
  name,
  placed,
  onPlace
}: {
  name: string;
  placed: readonly CardId[];
  onPlace(card: CardId): void;
}) {
  const button = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="quiet"
        onClick={() => setOpen((was) => !was)}
        onMouseDown={keepFocus}
        ref={button}
        title={t('stable.cards.title', { name })}
        type="button"
      >
        {t('stable.cards.add')}
      </button>
      {open && button.current && (
        <PopupMenu
          at={button.current}
          items={CARDS.map((card) => ({
            label: card.label,
            icon: placed.includes(card.id) ? 'check' : 'plus',
            run: () => onPlace(card.id)
          }))}
          onDismiss={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** A window too narrow for a console beside the status: the Stable stacks them. */
const NARROW = '(max-width: 760px)';
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const change = (): void => setNarrow(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return narrow;
}

/**
 * The characters left out and those loaded but not in the realm, small, one
 * press to bring each in: on the Stable's head line since 2026-11-01, where
 * they took a strip of their own under the rows and the height with it.
 */
export function StableAway({
  away,
  leftOut,
  views,
  onToggleConnection,
  onBringBack
}: {
  away: ReadonlyArray<{ id: SessionId; name: string }>;
  /** The characters left out of the Stable, each to be brought back. */
  leftOut: ReadonlyArray<{ id: SessionId; name: string }>;
  views: Record<SessionId, RailView>;
  onToggleConnection(session: SessionId): void;
  onBringBack(session: SessionId): void;
}) {
  if (away.length === 0 && leftOut.length === 0) return null;
  return (
    <section aria-label={t('stable.away.label')} className="stable-away">
      {leftOut.length > 0 && <span className="stable-away-label">{t('stable.leftOut.label')}</span>}
      {leftOut.map((entry) => (
        <span className="stable-away-tile" key={entry.id}>
          <b>{entry.name}</b>
          <button onClick={() => onBringBack(entry.id)} onMouseDown={keepFocus} type="button">
            {t('stable.leftOut.show')}
          </button>
        </span>
      ))}
      {away.length > 0 && <span className="stable-away-label">{t('stable.away.label')}</span>}
      {away.map((entry) => {
        const phase = views[entry.id]?.state.phase ?? 'idle';
        return (
          <span className="stable-away-tile" key={entry.id}>
            <b>{entry.name}</b>
            <span className="quiet">
              {phase === 'error' ? t('stable.away.error') : t('stable.away.offline')}
            </span>
            <button
              disabled={dialWaits(phase)}
              onClick={() => onToggleConnection(entry.id)}
              onMouseDown={keepFocus}
              type="button"
            >
              {t('stable.away.connect')}
            </button>
          </span>
        );
      })}
    </section>
  );
}

/**
 * The characters left out of the Stable (2026-10-31): a character that plays
 * on its own and needs no watching, a bot standing in a temple, has no row,
 * and is listed under the rows to be brought back. Per browser, as a card
 * layout is: what one screen has room to watch is that screen's choice.
 */
const LEFT_OUT_KEY = 'mudengine.stable.leftOut';
function readLeftOut(): SessionId[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LEFT_OUT_KEY) ?? '[]') as unknown;
    return Array.isArray(stored)
      ? stored.filter((id): id is SessionId => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}
export function useLeftOut(): {
  leftOut: readonly SessionId[];
  leaveOut(session: SessionId): void;
  bringBack(session: SessionId): void;
} {
  const [leftOut, setLeftOut] = useState<SessionId[]>(readLeftOut);
  useEffect(() => {
    try {
      localStorage.setItem(LEFT_OUT_KEY, JSON.stringify(leftOut));
    } catch {
      // Storage refused: the choice lasts this visit.
    }
  }, [leftOut]);
  return {
    leftOut,
    leaveOut: (session) => setLeftOut((was) => (was.includes(session) ? was : [...was, session])),
    bringBack: (session) => setLeftOut((was) => was.filter((id) => id !== session))
  };
}

/**
 * When the person last looked (2026-10-31): kept as the window is put away and
 * read when it is looked at again, so the Stable can say what the characters
 * made in between, which is the first thing wanted after leaving them to it.
 * Under `stable.awayMinMs` away is not away. Per browser, as a layout is.
 */
const LOOKED_KEY = 'mudengine.stable.lookedAt';
function readLooked(): number | null {
  try {
    const stored = Number(localStorage.getItem(LOOKED_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}
function keepLooked(at: number): void {
  try {
    localStorage.setItem(LOOKED_KEY, String(at));
  } catch {
    // Storage refused: the Stable says nothing of the time away.
  }
}

/** Since when to count, while there is something to say of it; and how to let it go. */
export function useAwaySince(): { since: number | null; dismiss(): void } {
  const [since, setSince] = useState<number | null>(() => {
    const looked = readLooked();
    return looked !== null && Date.now() - looked >= tuning().stableAwayMinMs ? looked : null;
  });
  useEffect(() => {
    const note = (): void => {
      if (document.visibilityState === 'hidden') keepLooked(Date.now());
      else {
        const looked = readLooked();
        if (looked !== null && Date.now() - looked >= tuning().stableAwayMinMs) setSince(looked);
      }
    };
    const leaving = (): void => keepLooked(Date.now());
    document.addEventListener('visibilitychange', note);
    window.addEventListener('pagehide', leaving);
    return () => {
      document.removeEventListener('visibilitychange', note);
      window.removeEventListener('pagehide', leaving);
    };
  }, []);
  return {
    since,
    dismiss: () => {
      keepLooked(Date.now());
      setSince(null);
    }
  };
}

/** The experience a character made since `from`, by its samples. */
export function madeSince(character: CharacterState, from: number, now: number): number | null {
  return experienceWithin(character.tally, from, now)?.made ?? null;
}

/**
 * The Stable's head: the stable's rate together and Stop all, and what each
 * character made while the person was away, until it is dismissed.
 */
export function StableHead({
  rows,
  views,
  since,
  away,
  onDismiss,
  onStopAll
}: {
  rows: ReadonlyArray<{ id: SessionId; name: string }>;
  views: Record<SessionId, StableRowView>;
  since: number | null;
  /** The characters left out and out of the realm (`StableAway`), on the head line. */
  away: ReactNode;
  onDismiss(): void;
  onStopAll(): void;
}) {
  const now = Date.now();
  // Over each character's session, as the Vitals card's first view.
  const together = rows.reduce((sum, row) => {
    const character = views[row.id]?.character;
    return (
      sum +
      (character === undefined ? 0 : (experienceFigures(character, 'session', now).perHour ?? 0))
    );
  }, 0);
  const awayFor = since === null ? 0 : now - since;
  const hours = Math.floor(awayFor / 3_600_000);
  const minutes = Math.floor((awayFor % 3_600_000) / 60_000);
  return (
    <div className="stable-head-strip">
      <div className="stable-summary">
        <b>{t('stable.head.title')}</b>
        <span className="quiet">
          {t('stable.head.inRealm', { count: rows.length })}
          {together > 0 ? ` · ${t('stable.head.together', { rate: rate(together) })}` : ''}
        </span>
        {away}
        <span className="spacer" />
        <button className="danger" onClick={onStopAll} onMouseDown={keepFocus} type="button">
          {t('stable.head.stopAll')}
        </button>
      </div>
      {since !== null && (
        <div className="stable-since" role="status">
          <b>
            {t('stable.since.title', {
              at: new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              hours,
              minutes
            })}
          </b>
          {rows.map((row) => {
            const view = views[row.id];
            if (view === undefined) return null;
            const made = madeSince(view.character, since, now);
            const alerts = view.unseen.alerts;
            return (
              <span key={row.id}>
                {row.name} <b className="gain">{made === null ? '–' : `+${amount(made)}`}</b>
                {alerts === 1
                  ? ` · ${t('stable.since.alerts.one')}`
                  : alerts > 1
                    ? ` · ${t('stable.since.alerts.many', { count: alerts })}`
                    : ''}
              </span>
            );
          })}
          <span className="spacer" />
          <button onClick={onDismiss} onMouseDown={keepFocus} type="button">
            {t('stable.since.dismiss')}
          </button>
        </div>
      )}
    </div>
  );
}
