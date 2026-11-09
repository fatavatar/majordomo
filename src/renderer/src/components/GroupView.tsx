import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';

import type { HeldRound } from './RoundTimer';
import { rate, RateGraph, ScopePicker, useExperienceView } from './ExperienceScope';
import { attention, type RailView } from './TabRail';
import { musterChoices, PartySay } from './PartyCard';
import PopupMenu from './PopupMenu';
import Icon, { type IconName } from './Icon';
import { CARDS, type CardId } from '../hooks/useCardLayout';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { tuning } from '../lib/tuning';
import { ratio, vitalLevel, type CharacterState } from '@shared/character';
import type { VitalsUiConfig } from '@shared/config';
import type { SessionId } from '@shared/ipc';
import { DEFAULT_STATS_GRAPH, experienceWithin } from '@shared/tally';
import { sameName, type MusterTarget, type PartyRoster } from '@shared/partyRoster';

/**
 * A tab group on screen (2026-11-09; the Stable, 2026-10-31): its characters
 * one row each, a status beside its own console. The card rethink's V1, asked
 * for because the client was built around one character at a keyboard and is
 * played as a stable of them, mostly unattended: the question on sitting down
 * is how all of them are doing, and before this it took a tab switch each.
 * The Stable showed every character in the realm; a group shows the ones
 * added to it (`lib/tabGroups.ts`).
 *
 * The consoles are the window's own, the ones every character keeps mounted
 * (`SessionTerminal`), placed in the group's grid beside these panels rather
 * than drawn again; this file is the rest of it.
 */

/** What a row's status reads: the rail's view, and the round timer. */
export type GroupRowView = RailView & { round: HeldRound };

/** Whether a character is in the realm, or on its way there. */
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
    return t('group.row.looping', {
      loop: loop.name,
      laps: loop.laps,
      stop: loop.stop,
      stops: loop.stops
    });
  }
  if (walk.status === 'walking') {
    return t('group.row.walking', {
      to: walk.destination ?? '',
      done: walk.done,
      total: walk.total
    });
  }
  return null;
}

export interface GroupStatusProps {
  session: SessionId;
  name: string;
  view: GroupRowView;
  /** The group's grid cell this panel takes. */
  cell: CSSProperties;
  focused: boolean;
  restTo: number;
  /** The experience made since the person last looked, or null where nothing is owed. */
  since: number | null;
  onOpen(session: SessionId): void;
  onStop(session: SessionId): void;
  onFocus(session: SessionId): void;
  /** Take it out of the view, its tab standing alone again. */
  onRemove(session: SessionId): void;
  /** The experience's hours views restarted, as the Vitals card's reset does. */
  onExpReset(session: SessionId): void;
  /** The status column slimmed to a strip beside each console (`GroupSlim`). */
  onCollapse(): void;
  /** Its settings, as its tab's pencil opens them; absent for a character with no file. */
  onEdit?: (session: SessionId) => void;
  /** The other cards placed on it, drawn for this character. */
  cards: ReactNode;
  /** The cards on it, and the press that puts one on or takes it off. */
  placed: readonly CardId[];
  onPlace(card: CardId): void;
}

/** One character's status, to the left of its console. */
export const GroupStatus = memo(function GroupStatus({
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
  onRemove,
  onExpReset,
  onCollapse,
  onEdit,
  cards,
  placed,
  onPlace
}: GroupStatusProps) {
  const { character } = view;
  const { room } = character;
  const mark = attention(view, restTo);
  const doing = doingOf(view);
  const moving = view.loop.status === 'running' || view.walk.status === 'walking';
  const who = whoOf(character);
  return (
    <section
      aria-label={name}
      className="group-status"
      data-focused={focused ? 'true' : 'false'}
      onMouseDown={() => onFocus(session)}
      style={cell}
    >
      <header className="group-head">
        <span className="group-name">
          <b>{character.name ?? name}</b>
          {who !== '' && <span className="quiet">{who}</span>}
        </span>
        <span className="group-head-side">
          <span
            className="chip"
            data-level={mark?.level ?? 'info'}
            title={mark?.detail ?? undefined}
          >
            {mark?.label ?? t('group.row.idle')}
          </span>
          {onEdit !== undefined && <EditCharacter name={name} onEdit={() => onEdit(session)} />}
          <SlimButton onCollapse={onCollapse} />
        </span>
      </header>
      <div className="group-where">
        <span>{room.name ?? t('group.row.nowhere')}</span>
        {doing !== null && <span className="quiet">{doing}</span>}
      </div>
      {cards}
      <GroupRate
        character={character}
        note={null}
        onReset={() => onExpReset(session)}
        session={session}
        since={since}
      />
      <footer className="group-actions">
        <button
          className="primary"
          onClick={() => onOpen(session)}
          onMouseDown={keepFocus}
          title={t('group.row.openTitle', { name })}
          type="button"
        >
          {t('group.row.open')}
        </button>
        {moving && (
          <button onClick={() => onStop(session)} onMouseDown={keepFocus} type="button">
            {t('group.row.stop')}
          </button>
        )}
        <CardPlacer name={name} onPlace={onPlace} placed={placed} />
        <button
          className="quiet"
          onClick={() => onRemove(session)}
          onMouseDown={keepFocus}
          title={t('group.row.removeTitle', { name })}
          type="button"
        >
          {t('group.row.remove')}
        </button>
      </footer>
    </section>
  );
});

/**
 * A character's settings from its status (2026-10-31): the pencil its tab
 * draws, beside its state, so the group has the way in the tab rail has.
 */
function EditCharacter({ name, onEdit }: { name: string; onEdit(): void }): React.JSX.Element {
  return (
    <button
      aria-label={t('tabs.tab.editAria', { characterName: name })}
      className="group-edit"
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

/** The status column slimmed (2026-11-09): from any status, as the column is one. */
function SlimButton({ onCollapse }: { onCollapse(): void }): React.JSX.Element {
  return (
    <button
      aria-label={t('group.status.collapse')}
      className="group-edit"
      onClick={onCollapse}
      onMouseDown={keepFocus}
      title={t('group.status.collapse')}
      type="button"
    >
      <Icon name="chevronLeft" />
    </button>
  );
}

/** What a character is doing, as the slim strip's one glyph, or none for standing about. */
function glyphOf(view: RailView): IconName | null {
  if (view.unseen.alerts > 0) return 'flag';
  if (view.state.phase === 'error' || view.state.phase === 'closed') return 'unplug';
  if (view.character.inCombat) return 'sword';
  if (view.character.vitals.resting || view.character.vitals.meditating) return 'moon';
  if (view.walk.status === 'walking') return 'route';
  if (view.loop.status === 'running') return 'loop';
  return null;
}

export interface GroupSlimProps {
  session: SessionId;
  name: string;
  accent: string;
  view: GroupRowView;
  /** The grid cell: beside its own console. */
  cell: CSSProperties;
  focused: boolean;
  restTo: number;
  thresholds: VitalsUiConfig;
  onFocus(session: SessionId): void;
  onOpen(session: SessionId): void;
  /** The status column back to its width. */
  onExpand(): void;
}

/**
 * A character's status slimmed (2026-11-09), as the card rail tucks to a
 * strip: what is worth a glance beside its console, top to bottom — what it
 * is doing as a glyph (the tab's word as its title), its health and mana as
 * two upright bars, its health in per cent, the experience rate in the
 * window its status shows, and its name up the strip in its colour.
 */
export const GroupSlim = memo(function GroupSlim({
  session,
  name,
  accent,
  view,
  cell,
  focused,
  restTo,
  thresholds,
  onFocus,
  onOpen,
  onExpand
}: GroupSlimProps) {
  const { character } = view;
  const { vitals } = character;
  const mark = attention(view, restTo);
  const glyph = glyphOf(view);
  const hp = barOf(vitals.hp, vitals.hpMax, thresholds.hp);
  const mana = barOf(vitals.mana, vitals.manaMax, thresholds.mana);
  const share = ratio(vitals.hp, vitals.hpMax);
  const exp = useExperienceView(character, session);
  const shown = character.name ?? name;
  return (
    <section
      aria-label={shown}
      className="group-slim"
      data-focused={focused ? 'true' : 'false'}
      data-who={accent}
      onMouseDown={() => onFocus(session)}
      style={cell}
    >
      <button
        aria-label={t('group.status.expand')}
        className="group-slim-button"
        onClick={onExpand}
        onMouseDown={keepFocus}
        title={t('group.status.expand')}
        type="button"
      >
        <Icon name="chevronRight" />
      </button>
      <span
        className="group-slim-mark"
        data-level={mark?.level ?? 'info'}
        title={mark?.detail ?? mark?.label ?? t('group.row.idle')}
      >
        {glyph === null ? <span className="group-slim-dot" /> : <Icon name={glyph} />}
      </span>
      <span
        className="group-slim-bars"
        title={`${t('group.row.hp')} ${hp.text} · ${t('group.row.mana')} ${mana.text}`}
      >
        <span className="group-slim-bar" data-kind="hp" data-level={hp.level}>
          <span style={{ height: hp.width }} />
        </span>
        <span className="group-slim-bar" data-kind="mana" data-level={mana.level}>
          <span style={{ height: mana.width }} />
        </span>
      </span>
      <span className="group-slim-figure" data-level={hp.level}>
        {share === null ? '–' : `${Math.round(share * 100)}%`}
      </span>
      <span className="group-slim-rate" title={rate(exp.perHour)}>
        {exp.perHour === null ? '–' : amount(exp.perHour)}
      </span>
      <button
        className="group-slim-name"
        onClick={() => onOpen(session)}
        onMouseDown={keepFocus}
        title={t('group.row.openTitle', { name })}
        type="button"
      >
        {shown}
      </button>
    </section>
  );
});

/**
 * The experience as the Vitals card has it, the session or the hours it last
 * chose for the character: the figure, what was made since the person last
 * looked, and the card's own graph, a bar a bin with the rate ruled across.
 */
function GroupRate({
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
    <div className="group-rate">
      {/* The Vitals card's own choice of window (2026-11-01): one choice, read by both. */}
      <ScopePicker onReset={onReset} view={exp} />
      <span className="group-rate-figures">
        <b data-none={exp.perHour === null ? 'true' : undefined}>{rate(exp.perHour)}</b>
        {note !== null && <span className="quiet">{note}</span>}
        {since !== null && since > 0 && (
          <span className="quiet">{t('group.row.since', { made: amount(since) })}</span>
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

export interface GroupPartyProps {
  roster: PartyRoster;
  members: ReadonlyArray<{ id: SessionId; name: string; accent: string; view: GroupRowView }>;
  /** The group's grid cell: the rows its members' consoles take. */
  cell: CSSProperties;
  focused: SessionId;
  thresholds: VitalsUiConfig;
  restToFor(session: SessionId): number;
  /** What the leader made since the person last looked. */
  since: number | null;
  onOpen(session: SessionId): void;
  onStop(session: SessionId): void;
  onFocus(session: SessionId): void;
  onRemove(session: SessionId): void;
  /** The experience's hours views restarted, as the Vitals card's reset does. */
  onExpReset(session: SessionId): void;
  /** The status column slimmed to a strip beside each console (`GroupSlim`). */
  onCollapse(): void;
  /** A member's settings; absent for one with no file. */
  editFor(session: SessionId): ((session: SessionId) => void) | undefined;
  onRegroup(roster: string): void;
  onMuster(roster: string, target: MusterTarget): void;
  /** Disband: the party broken up in the realm and its roster forgotten. */
  onDisband(roster: string): void;
  /** Say to: one line sent by each chosen member as its own, the Party card's (2026-11-01). */
  onSay(
    roster: string,
    sessions: readonly SessionId[],
    line: string,
    others: boolean
  ): Promise<string[]>;
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
 * One block in place of the Party card, which a group has no rail for.
 */
export const GroupParty = memo(function GroupParty({
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
  onRemove,
  onExpReset,
  onCollapse,
  editFor,
  onRegroup,
  onMuster,
  onDisband,
  onSay,
  cards,
  placed,
  onPlace
}: GroupPartyProps) {
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
      aria-label={t('group.party.label', { leader })}
      className="group-status group-party"
      data-focused={members.some((member) => member.id === focused) ? 'true' : 'false'}
      style={cell}
    >
      <header className="group-head">
        <span className="group-name">
          <b>{t('group.party.title', { leader })}</b>
          <span className="quiet">
            {t('group.party.inRealm', {
              count: members.length,
              of: roster.members.length - roster.forgotten.length
            })}
            {' · '}
            {rooms.size === 1 ? t('group.party.together') : t('group.party.apart')}
          </span>
        </span>
        <span className="group-head-side">
          <span
            className="chip"
            data-level={fighting ? 'info' : (leadMark?.level ?? 'info')}
            title={leadMark?.detail ?? undefined}
          >
            {fighting ? t('tabs.tab.markFighting') : (leadMark?.label ?? t('group.row.idle'))}
          </span>
          <button
            aria-label={t('group.party.disbandTitle', { leader })}
            className="group-disband"
            onClick={() => onDisband(roster.id)}
            onMouseDown={keepFocus}
            title={t('group.party.disbandTitle', { leader })}
            type="button"
          >
            <Icon name="clearCircle" />
          </button>
          <SlimButton onCollapse={onCollapse} />
        </span>
      </header>
      <div className="group-commands">
        <button onClick={() => onRegroup(roster.id)} onMouseDown={keepFocus} type="button">
          {t('group.party.regroup')}
        </button>
        {choices.length > 0 && (
          <select
            aria-label={t('group.party.muster')}
            className="group-muster"
            onChange={(event) => {
              const choice = choices.find((option) => option.key === event.target.value);
              if (choice !== undefined) onMuster(roster.id, choice.target);
              event.target.value = '';
            }}
            value=""
          >
            <option value="">{t('group.party.muster')}</option>
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
            {t('group.party.stop')}
          </button>
        )}
      </div>
      {/*
        One line for every member at once, the Party card's Say to: the
        members' consoles are beside it, so each one's answer is read there.
      */}
      <PartySay
        onSay={(sessions, line, others) => onSay(roster.id, sessions, line, others)}
        others={[]}
        speakers={members.map((member) => ({ session: member.id, name: member.name }))}
      />
      <div className="group-members">
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
              className="group-member"
              data-focused={id === focused ? 'true' : 'false'}
              data-who={accent}
              key={id}
              onMouseDown={() => onFocus(id)}
            >
              <span className="group-member-name">
                <span aria-hidden="true" className="group-who" />
                <b>
                  {character.name ?? name}
                  {isLeader ? ' ★' : ''}
                </b>
                <span className="quiet">{whoOf(character)}</span>
              </span>
              <span className="group-head-side">
                <span className="chip" data-level={mark?.level ?? 'info'} title={mark?.detail}>
                  {mark?.label ?? t('group.row.idle')}
                </span>
                {edit !== undefined && <EditCharacter name={name} onEdit={() => edit(id)} />}
              </span>
              <span className="group-member-bars">
                <span className="group-bar" data-kind="hp" data-level={hp.level}>
                  <span style={{ width: hp.width }} />
                </span>
                <span className="group-bar thin" data-kind="mana" data-level={mana.level}>
                  <span style={{ width: mana.width }} />
                </span>
              </span>
              <span className="group-member-figures">
                <span className="group-figure">{hp.text}</span>
                <span className="quiet">{mana.text}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="group-where">
        <span>{lead.view.character.room.name ?? t('group.row.nowhere')}</span>
        {doing !== null && <span className="quiet">{doing}</span>}
      </div>
      {cards}
      <GroupRate
        character={lead.view.character}
        note={t('group.party.each', { count: members.length })}
        onReset={() => onExpReset(lead.id)}
        session={lead.id}
        since={since}
      />
      <footer className="group-actions">
        {members.map((member, at) => (
          <button
            className={at === 0 ? 'primary' : undefined}
            key={member.id}
            onClick={() => onOpen(member.id)}
            onMouseDown={keepFocus}
            title={t('group.row.openTitle', { name: member.name })}
            type="button"
          >
            {t('group.party.open', { name: member.name })}
          </button>
        ))}
        <CardPlacer name={t('group.party.title', { leader })} onPlace={onPlace} placed={placed} />
        <button
          className="quiet"
          onClick={() => {
            for (const member of members) onRemove(member.id);
          }}
          onMouseDown={keepFocus}
          title={t('group.party.removeTitle', { leader })}
          type="button"
        >
          {t('group.row.remove')}
        </button>
      </footer>
    </section>
  );
});

/**
 * A group's sizes (2026-10-31): the status column's width, and whether it is
 * slimmed (2026-11-09). Per browser, as the Explorer's split is: one person's
 * screen. Under the Stable's key, which they were first kept under; the
 * console heights it also kept are read past, the consoles sharing the
 * height evenly since 2026-11-09.
 */
export interface GroupSizes {
  status: number | null;
  /** The status column slimmed to a strip beside each console. */
  collapsed: boolean;
}
const SIZES_KEY = 'mudengine.stable.sizes';
function readSizes(): GroupSizes {
  try {
    const stored = JSON.parse(localStorage.getItem(SIZES_KEY) ?? 'null') as {
      status?: unknown;
      collapsed?: unknown;
    } | null;
    return {
      status: typeof stored?.status === 'number' ? stored.status : null,
      collapsed: stored?.collapsed === true
    };
  } catch {
    return { status: null, collapsed: false };
  }
}
export function useGroupSizes(): GroupSizes & {
  setStatus(px: number | null): void;
  setCollapsed(collapsed: boolean): void;
} {
  const [sizes, setSizes] = useState<GroupSizes>(readSizes);
  useEffect(() => {
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
    } catch {
      // Storage refused: the sizes last this visit.
    }
  }, [sizes]);
  // Stable setters, so a status handed one is not drawn again for it.
  const setters = useMemo(
    () => ({
      setStatus: (px: number | null) => setSizes((was) => ({ ...was, status: px })),
      setCollapsed: (collapsed: boolean) => setSizes((was) => ({ ...was, collapsed }))
    }),
    []
  );
  return { ...sizes, ...setters };
}

/**
 * The cards placed on each status of a group (2026-10-31), by block: a
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
        title={t('group.cards.title', { name })}
        type="button"
      >
        {t('group.cards.add')}
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

/** A window too narrow for a console beside the status: a group stacks them. */
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
 * When the person last looked (2026-10-31): kept as the window is put away and
 * read when it is looked at again, so a group can say what the characters
 * made in between, which is the first thing wanted after leaving them to it.
 * Under `view.groupAwayMinMs` away is not away. Per browser, as a layout is.
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
    // Storage refused: the group says nothing of the time away.
  }
}

/** Since when to count, while there is something to say of it; and how to let it go. */
export function useAwaySince(): { since: number | null; dismiss(): void } {
  const [since, setSince] = useState<number | null>(() => {
    const looked = readLooked();
    return looked !== null && Date.now() - looked >= tuning().groupAwayMinMs ? looked : null;
  });
  useEffect(() => {
    const note = (): void => {
      if (document.visibilityState === 'hidden') keepLooked(Date.now());
      else {
        const looked = readLooked();
        if (looked !== null && Date.now() - looked >= tuning().groupAwayMinMs) setSince(looked);
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
 * What each character of a group made while the person was away, over its
 * rows until it is dismissed (2026-10-31). Nothing otherwise: the group's
 * own figures are on its rows, and a standing line above them was a row of
 * console given up for a count (2026-11-09).
 */
export function GroupSince({
  rows,
  views,
  since,
  onDismiss
}: {
  rows: ReadonlyArray<{ id: SessionId; name: string }>;
  views: Record<SessionId, GroupRowView>;
  since: number | null;
  onDismiss(): void;
}) {
  if (since === null) return null;
  const now = Date.now();
  const awayFor = now - since;
  const hours = Math.floor(awayFor / 3_600_000);
  const minutes = Math.floor((awayFor % 3_600_000) / 60_000);
  return (
    <div className="group-since" role="status">
      <b>
        {t('group.since.title', {
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
              ? ` · ${t('group.since.alerts.one')}`
              : alerts > 1
                ? ` · ${t('group.since.alerts.many', { count: alerts })}`
                : ''}
          </span>
        );
      })}
      <span className="spacer" />
      <button onClick={onDismiss} onMouseDown={keepFocus} type="button">
        {t('group.since.dismiss')}
      </button>
    </div>
  );
}
