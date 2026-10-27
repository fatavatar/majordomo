import { memo, useState } from 'react';

import BentoCard, { type CardAction, type CardChrome } from './BentoCard';
import { vitalLevel, type CharacterState, type PartyActivity } from '@shared/character';
import type { VitalsUiConfig } from '@shared/config';
import {
  readPlace,
  sameName,
  type MusterTarget,
  type PartyRoster,
  type RosterRank
} from '@shared/partyRoster';
import type { SessionId } from '@shared/ipc';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import {
  boardRows,
  rosterFromListing,
  together,
  type BoardRow,
  type OurMember
} from '../lib/partyBoard';
import { isKnownPlayer, isSelf, PlayerName } from '../lib/players';
import { playerKey } from '@shared/players';
import type { PopoverAnchor } from '../lib/popover';
import { levelWord } from '../lib/vitals';
import { tuning } from '../lib/tuning';

export interface PartyCardProps extends CardChrome {
  character: CharacterState;
  thresholds: VitalsUiConfig;
  /** A member's name clicked: the Player flyout on them, beside the row. */
  onSelect?(name: string, anchor: PopoverAnchor): void;
  /** Whoever the flyout is about, as `playerKey` files them, so the row is marked — tonally, never the name. */
  subject?: string | null;
  /**
   * Proposes a command to the arbiter, the way the Room card asks for a look:
   * `follow <name>` and `leave` are the realm's own party verbs, and a button
   * that sends them goes down the path a keystroke takes. Absent, the card
   * reads and does nothing.
   */
  ask?(command: string): void;
  /** The realm this character plays, as its file names it: where its roster is looked up. */
  realm: string | null;
  /** The roster naming this character on its realm, or null when there is none. */
  roster: PartyRoster | null;
  /**
   * This client's characters on the same realm, this one included: each read
   * from its own tab rather than from somebody's listing (`partyBoard.ts`).
   */
  ours: readonly OurMember[];
  /** A roster made or edited here. Absent, the card cannot make or edit one. */
  onSaveRoster?(roster: PartyRoster): void;
  onRemoveRoster?(id: string): void;
  /** Regroup pressed: every act at once. How many were taken. */
  onRegroup?(id: string): Promise<number>;
  /** Muster pressed: a line per member of ours, said under the bar. */
  onMuster?(id: string, target: MusterTarget): Promise<string[]>;
  /**
   * One line typed once: sent by each chosen character of ours as its own,
   * and by the leader's `@party` to everybody else in the party when
   * `others`. A line each for what happened.
   */
  onSay?(
    id: string,
    sessions: readonly SessionId[],
    line: string,
    others: boolean
  ): Promise<string[]>;
}

/**
 * The formation, as the card lays it out.
 *
 * A rank is what the party is *arranged by* — who takes the blows and who casts
 * from behind them — so the card is arranged by it too, under a heading each,
 * rather than printing the word at the end of every row and leaving the reader
 * to assemble the shape. The realm writes `Frontrank`; a card is not a listing.
 *
 * **A group with nobody in it is not drawn.** An empty heading is a row of
 * vertical space saying nothing, and a party of two is usually two of these
 * five.
 *
 * The last two are not ranks and are deliberately last. `unranked` is somebody
 * an *announcement* added, or a roster member nobody has placed — defaulting
 * them to `front` would put a member in the line of fire on the card who is
 * not there on the server. `invited` is an offer nobody has accepted, the one
 * group whose people are not travelling with this character at all.
 */
const GROUPS = [
  { key: 'front', label: t('cards.party.groups.front') },
  { key: 'mid', label: t('cards.party.groups.middle') },
  { key: 'back', label: t('cards.party.groups.back') },
  { key: 'unranked', label: t('cards.party.groups.rankUnknown') },
  { key: 'invited', label: t('cards.party.groups.invited') }
] as const;

type GroupKey = (typeof GROUPS)[number]['key'];

const groupOf = (row: BoardRow): GroupKey =>
  row.status === 'invited' ? 'invited' : (row.rank ?? 'unranked');

const RANKS: ReadonlyArray<{ rank: RosterRank | null; label: string }> = [
  { rank: null, label: t('cards.party.edit.rankAuto') },
  { rank: 'front', label: t('cards.party.groups.front') },
  { rank: 'mid', label: t('cards.party.groups.middle') },
  { rank: 'back', label: t('cards.party.groups.back') }
];

/** A member who is not simply travelling with the party, in a word. */
const STATUS_WORD: Record<Exclude<BoardRow['status'], 'in' | 'invited'>, string> = {
  out: t('cards.party.status.out'),
  offline: t('cards.party.status.offline'),
  forgotten: t('cards.party.status.forgotten')
};

/**
 * What a member is doing, in the server's words where it has said them.
 *
 * An unrecognised letter is drawn as the letter, because expanding it would put
 * a condition on the card the server never stated — see `PartyActivity`.
 */
function activityWord(activity: PartyActivity | { state: 'fighting' }): string {
  if (activity.state === 'fighting') return t('cards.party.activity.fighting');
  return activity.state === 'unknown' ? activity.flag : activity.state;
}

/** A roster id nobody else has: the browser tab's crypto is not there over plain HTTP. */
const newId = (): string =>
  `party-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * A fraction against a track, with its figures and the level in words beside it.
 *
 * The listing gives a share and no absolutes, so the figures are printed only
 * where a maximum is known — a member of ours, a client's `{HP=…}`, or one
 * guessed from damage seen — and never as a percentage: the track is the
 * share (2026-10-27). The rule from the Vitals card holds unchanged: a null
 * fraction is an empty track, never a full or a zero one, and the level is
 * said in words as well as in hue.
 */
function Bar({
  label,
  fraction,
  figures,
  thresholds,
  tone
}: {
  label: string;
  fraction: number | null;
  /** What it stands at of its maximum, when either is known; nothing to print otherwise. */
  figures: string | null;
  thresholds: VitalsUiConfig['hp'];
  tone: string;
}) {
  const level = vitalLevel(fraction, 1, thresholds);
  const word = levelWord(level);
  return (
    <span className={`party-meter ${tone}`} data-level={level}>
      <span className="party-meter-label">{label}</span>
      <span className="party-bar">
        <span style={fraction === null ? undefined : { width: `${fraction * 100}%` }} />
      </span>
      <span className="party-meter-value">
        {figures ?? ''}
        {word === null ? '' : ` ${word}`}
      </span>
    </span>
  );
}

/**
 * A bar's figures (2026-10-27): what it stands at of its maximum, never a
 * percentage — the bar is the share. Exact from a member's own tab or their
 * client's `{HP=…}`; `≈` where the maximum is guessed from damage seen.
 */
function figures(now: number | null, max: number | null, guessed = false): string | null {
  if (max === null || max <= 0) return null;
  const mark = guessed ? '≈' : '';
  const at = now === null ? '?' : `${mark}${Math.round(now).toLocaleString()}`;
  return `${at} / ${mark}${max.toLocaleString()}`;
}

/**
 * The party: who should be travelling together, who is, and how they are
 * doing (2026-10-27).
 *
 * **With a roster** — made from the party as it stands, then edited here
 * while playing — the card draws who *should* be there and says, row by row,
 * who has dropped out, who is offline and who is only invited. A member who
 * is one of this client's characters is read from their own tab: exact
 * figures, their room, whether they are fighting. Everybody else comes from a
 * party listing, the leader's first. See `partyBoard.ts`.
 *
 * **Without one** it is the card it always was: whoever this character's
 * listing names, and a button to keep that party as a roster.
 *
 * The party roster is **the only place another character's health is
 * visible** that is not one of ours, and it costs one command rather than a
 * second connection. Nothing here asks the server for anything: a `party`
 * seeds the listing and the invite, follow, rank and rest announcements
 * maintain it; those carry no health, so a member added that way has none
 * until the next listing and the card **says so** rather than drawing an
 * empty bar as though it meant zero.
 */
function PartyCard({
  character,
  thresholds,
  onSelect,
  subject = null,
  ask,
  realm,
  roster,
  ours,
  onSaveRoster,
  onRemoveRoster,
  onRegroup,
  onMuster,
  onSay,
  ...chrome
}: PartyCardProps) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState('');
  /** What the last Regroup or Muster did, a line each, until the next press. */
  const [report, setReport] = useState<string[]>([]);
  /** Who `Say to` leaves out; everybody of ours on the roster is in by default. */
  const [quiet, setQuiet] = useState<ReadonlySet<SessionId>>(new Set());
  /** Whether Say to leaves out everybody else in the party (the leader's @party). */
  const [othersQuiet, setOthersQuiet] = useState(false);
  const [line, setLine] = useState('');
  /** A sys goto place typed beside the Muster button. */
  const [goto, setGoto] = useState('');
  const rows = boardRows(roster, character, ours);
  const editable = roster !== null && onSaveRoster !== undefined;
  const open = editing && editable;

  const save = (next: PartyRoster): void => onSaveRoster?.(next);
  const withMembers = (members: PartyRoster['members']): PartyRoster | null =>
    roster === null
      ? null
      : {
          ...roster,
          members,
          leader:
            roster.leader !== null && members.some((m) => sameName(m.name, roster.leader!))
              ? roster.leader
              : (members[0]?.name ?? null),
          forgotten: roster.forgotten.filter((f) => members.some((m) => sameName(m.name, f)))
        };
  const edit = (change: (r: PartyRoster) => PartyRoster | null): void => {
    if (roster === null) return;
    const next = change(roster);
    if (next !== null) save(next);
  };

  /*
   * The badge reports the number somebody acts on. "One hurt" is a reason to
   * heal; with a roster, who is missing is the next thing; "three in the
   * party" is trivia they can already see — and while an invitation is the
   * only thing on the listing, the number travelling together is nobody, so
   * the badge states the offer instead of counting it as company.
   */
  const hurt = rows.filter(
    (row) => row.status === 'in' && vitalLevel(row.health, 1, thresholds.hp) === 'critical'
  ).length;
  const count = together(rows);
  const invited = rows.filter((row) => row.status === 'invited').length;
  const badge =
    hurt > 0 ? (
      <span className="chip bad">{t('cards.party.badge.hurt', { count: hurt })}</span>
    ) : roster !== null ? (
      <span className={`chip ${count.in < count.of ? 'warn' : 'off'}`}>
        {t('cards.party.badge.of', { count: count.in, of: count.of })}
      </span>
    ) : count.in > 0 ? (
      <span className="chip off">{t('cards.party.badge.together', { count: count.in })}</span>
    ) : (
      <span className="chip off">{t('cards.party.badge.invited', { count: invited })}</span>
    );

  /* A roster made from the party as it stands, opened for editing: where Regroup, Muster and Say to begin. */
  const keep =
    roster === null && onSaveRoster && realm !== null && character.name !== null
      ? (): void => {
          save(rosterFromListing(newId(), realm, character));
          setEditing(true);
        }
      : null;

  const actions: CardAction[] = [];
  if (editable) {
    actions.push({
      id: 'edit',
      label: open ? t('cards.party.edit.done') : t('cards.party.edit.action'),
      icon: open ? 'check' : 'edit',
      run: () => setEditing(!open)
    });
  } else if (keep !== null) {
    actions.push({ id: 'keep', label: t('cards.party.keepAction'), icon: 'users', run: keep });
  }
  if (ask && character.party.members.length > 0) {
    actions.push({
      id: 'leave',
      label: t('cards.party.leaveAction'),
      icon: 'popout',
      run: () => ask('leave'),
      danger: true
    });
  }

  /* Who could be added: this client's characters here, and whoever the listing names. */
  const onRoster = (name: string): boolean =>
    roster?.members.some((m) => sameName(m.name, name)) ?? false;
  const suggestions = [
    ...ours.map((m) => m.character.name),
    ...character.party.members.map((m) => m.name)
  ].filter(
    (name, index, all): name is string =>
      name !== null &&
      !onRoster(name) &&
      all.findIndex((other) => other !== null && sameName(other, name)) === index
  );
  const add = (): void => {
    const name = adding.trim();
    if (name === '' || roster === null || onRoster(name)) return;
    const next = withMembers([...roster.members, { name, rank: null }]);
    if (next !== null) save(next);
    setAdding('');
  };

  /* The bar: only with a roster, since every control on it acts on the roster's members. */
  const speakers = rows.filter((row) => row.ours !== null && row.status !== 'offline');
  const sayTo = speakers.map((row) => row.ours!).filter((sid) => !quiet.has(sid));
  /*
   * Everybody else in the party, whom only the leader's @party reaches — so
   * only while the leader is one of ours and in it.
   */
  const leaderOurs = rows.some((row) => row.leader && row.ours !== null && row.status === 'in');
  const othersIn = leaderOurs
    ? rows.filter((row) => row.ours === null && row.status === 'in').map((row) => row.name)
    : [];
  const toOthers = othersIn.length > 0 && !othersQuiet;
  const reach = sayTo.length + (toOthers ? othersIn.length : 0);
  const regroupNow = (): void => {
    if (roster === null || !onRegroup) return;
    void onRegroup(roster.id).then((count) =>
      setReport([
        count === 0
          ? t('cards.party.regrouped.zero')
          : count === 1
            ? t('cards.party.regrouped.one')
            : t('cards.party.regrouped.many', { count })
      ])
    );
  };
  /*
   * Muster to what is typed: the leader's name walks everybody to the
   * leader, anything else is a sys goto place, kept for the suggestions.
   */
  const musterTyped = (): void => {
    const place = readPlace(goto);
    if (roster === null || !onMuster || place === null) return;
    if (roster.leader !== null && sameName(place, roster.leader)) {
      void onMuster(roster.id, { to: 'leader' }).then(setReport);
      setGoto('');
      return;
    }
    if (!roster.places.some((kept) => sameName(kept, place)))
      edit((r) => ({ ...r, places: [...r.places, place] }));
    void onMuster(roster.id, { to: 'place', place }).then(setReport);
    setGoto('');
  };
  const say = (): void => {
    const text = line.trim();
    if (text === '' || reach === 0 || !onSay || roster === null) return;
    void onSay(roster.id, sayTo, text, toOthers).then(setReport);
    setLine('');
  };

  return (
    <BentoCard
      {...chrome}
      actions={actions}
      badge={badge}
      className="party-card"
      title={t('cards.party.title')}
    >
      {/*
        Said in the body, not only as a glyph in the action column: without a
        roster the bar below is not drawn, and Regroup, Muster and Say to were
        nowhere a player could find them.
      */}
      {keep !== null && (
        <div className="party-start">
          <button onClick={keep} onMouseDown={keepFocus} type="button">
            {t('cards.party.start')}
          </button>
          <span className="hint">{t('cards.party.startHint')}</span>
        </div>
      )}
      {roster !== null && (onRegroup || onMuster) && (
        <div className="party-actions">
          {onRegroup && (
            <button onClick={regroupNow} onMouseDown={keepFocus} type="button">
              {t('cards.party.regroup')}
            </button>
          )}
          {onMuster && (
            <form
              className="party-muster"
              onSubmit={(event) => {
                event.preventDefault();
                musterTyped();
              }}
            >
              <input
                aria-label={t('cards.party.edit.placesAria')}
                list={`party-places-${roster.id}`}
                onChange={(event) => setGoto(event.target.value)}
                placeholder={t('cards.party.edit.placesPlaceholder')}
                spellCheck={false}
                title={t('cards.party.edit.placesHint')}
                value={goto}
              />
              <datalist id={`party-places-${roster.id}`}>
                {roster.leader !== null && (
                  <option
                    label={t('cards.party.musterToLeader', { leader: roster.leader })}
                    value={roster.leader}
                  />
                )}
                {roster.places.map((place) => (
                  <option key={place} value={place} />
                ))}
              </datalist>
              <button disabled={readPlace(goto) === null} onMouseDown={keepFocus} type="submit">
                {t('cards.party.edit.muster')}
              </button>
            </form>
          )}
        </div>
      )}
      {roster !== null && onSay && speakers.length > 0 && (
        <form
          className="party-say"
          onSubmit={(event) => {
            event.preventDefault();
            say();
          }}
        >
          <span className="party-say-to">
            {speakers.map((row) => (
              <button
                aria-pressed={!quiet.has(row.ours!)}
                className="chip toggle"
                data-on={quiet.has(row.ours!) ? 'false' : 'true'}
                key={row.ours}
                onClick={() => {
                  const next = new Set(quiet);
                  if (next.has(row.ours!)) next.delete(row.ours!);
                  else next.add(row.ours!);
                  setQuiet(next);
                }}
                onMouseDown={keepFocus}
                title={t('cards.party.sayToggle', { name: row.name })}
                type="button"
              >
                {row.name}
              </button>
            ))}
            {othersIn.length > 0 && (
              <button
                aria-pressed={!othersQuiet}
                className="chip toggle"
                data-on={othersQuiet ? 'false' : 'true'}
                onClick={() => setOthersQuiet(!othersQuiet)}
                onMouseDown={keepFocus}
                title={t('cards.party.sayOthersHint', { names: othersIn.join(', ') })}
                type="button"
              >
                {t('cards.party.sayOthers', { count: othersIn.length })}
              </button>
            )}
          </span>
          <input
            aria-label={t('cards.party.sayAria')}
            onChange={(event) => setLine(event.target.value)}
            placeholder={
              reach === 0
                ? t('cards.party.sayPlaceholder.zero')
                : reach === 1
                  ? t('cards.party.sayPlaceholder.one')
                  : t('cards.party.sayPlaceholder.many', { count: reach })
            }
            spellCheck={false}
            value={line}
          />
        </form>
      )}
      {report.length > 0 && (
        <ul className="party-report hint">
          {report.map((said) => (
            <li key={said}>{said}</li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (
        <div className="empty">{t('cards.party.empty')}</div>
      ) : (
        GROUPS.map(({ key, label }) => {
          const inRank = rows.filter((row) => groupOf(row) === key);
          if (inRank.length === 0) return null;
          return (
            <section className="party-rank-group" data-rank={key} key={key}>
              <h4 className="party-rank-head">{label}</h4>
              <ul className="party-list">
                {inRank.map((row) => (
                  <li
                    data-selected={playerKey(row.name) === subject ? 'true' : undefined}
                    data-status={row.status}
                    key={row.name}
                  >
                    <div className="party-who">
                      {/* A member the registry or roster knows is a person, and a
                          person's name is the control that opens their card — the
                          same gesture as on the Realm and Players listings, gated
                          by the same test rather than by "a member is a person". */}
                      <span
                        className="party-name"
                        data-leader={row.leader}
                        data-ours={row.ours !== null ? 'true' : undefined}
                      >
                        {onSelect && isKnownPlayer(character, row.name) ? (
                          <PlayerName
                            className="name"
                            name={row.name}
                            onSelect={onSelect}
                            self={isSelf(character, row.name)}
                          />
                        ) : (
                          row.name
                        )}
                      </span>
                      <span className="party-class">{row.className ?? ''}</span>
                      {row.status !== 'in' && row.status !== 'invited' && (
                        <span className="party-status" data-status={row.status}>
                          {STATUS_WORD[row.status]}
                        </span>
                      )}
                      {/*
                        A condition is tonal, per §9 — and it is the thing on
                        this row that decides whether a member will answer a
                        heal or a step.
                      */}
                      {row.activity !== null && (
                        <span className="party-activity" data-state={row.activity.state}>
                          {activityWord(row.activity)}
                        </span>
                      )}
                      {/* What the server last said this member hit, while the
                          sighting is fresh: the fact `assistLeader` acts on,
                          shown where the person deciding to help can see it. */}
                      {row.ours === null && fightingWord(character, row.name) !== null && (
                        <span className="chip quiet party-fighting">
                          {t('cards.party.fighting', {
                            target: fightingWord(character, row.name) ?? ''
                          })}
                        </span>
                      )}
                      {/* `follow <name>` is how a leader is made on this realm;
                          there is no verb for the other direction, so there is
                          no other button. Not for this character's own row, and
                          not for whoever is already followed. */}
                      {ask &&
                        !open &&
                        row.status === 'in' &&
                        !isSelf(character, row.name) &&
                        !sameName(row.name, character.party.following ?? '') &&
                        !(roster === null && row.leader) && (
                          <button
                            aria-label={t('cards.party.followAria', { name: row.name })}
                            className="quiet party-follow"
                            onClick={() => ask(`follow ${row.name}`)}
                            onMouseDown={keepFocus}
                            type="button"
                          >
                            {t('cards.party.followButton')}
                          </button>
                        )}
                    </div>
                    {row.away !== null && (
                      <span className="hint party-away">
                        {t('cards.party.away', { room: row.away })}
                      </span>
                    )}
                    {/*
                      A member the announcements added has no numbers at all
                      until the next listing, and two empty tracks would read as
                      two resources at zero. An *invited* member has none either
                      and for a different reason — they have not answered — which
                      the heading above them already says, so the row says
                      nothing a second time. Nor does a member who is out.
                    */}
                    {row.status === 'invited' || row.status === 'out' ? null : row.health ===
                      null ? (
                      row.status === 'in' && (
                        <span className="hint">{t('cards.party.notYetListed')}</span>
                      )
                    ) : (
                      <div className="party-meters">
                        <Bar
                          fraction={row.health}
                          figures={
                            row.vitals !== null
                              ? figures(row.vitals.hp, row.vitals.hpMax)
                              : figures(
                                  row.health === null || row.hpMaxGuess === null
                                    ? null
                                    : row.health * row.hpMaxGuess,
                                  row.hpMaxGuess,
                                  true
                                )
                          }
                          label={t('cards.party.bar.hp')}
                          thresholds={thresholds.hp}
                          tone="hp"
                        />
                        {/* No mana track for a class that has none — the roster
                            omits the column entirely, and an empty one would
                            imply a resource that does not exist. */}
                        {row.mana !== null && (
                          <Bar
                            fraction={row.mana}
                            figures={figures(row.vitals?.mana ?? null, row.vitals?.manaMax ?? null)}
                            label={t('cards.party.bar.mana')}
                            thresholds={thresholds.mana}
                            tone="mana"
                          />
                        )}
                      </div>
                    )}
                    {open && (
                      <div className="party-edit-row">
                        {/* No `keepFocus` on a select: its default is the popup opening. */}
                        <select
                          aria-label={t('cards.party.edit.rankAria', { name: row.name })}
                          onChange={(event) => {
                            const rank = (event.target.value || null) as RosterRank | null;
                            edit((r) =>
                              withMembers(
                                r.members.map((m) =>
                                  sameName(m.name, row.name) ? { ...m, rank } : m
                                )
                              )
                            );
                            chrome.returnFocus?.();
                          }}
                          value={row.rosterRank ?? ''}
                        >
                          {RANKS.map(({ rank, label: word }) => (
                            <option key={word} value={rank ?? ''}>
                              {word}
                            </option>
                          ))}
                        </select>
                        {!row.leader && (
                          <button
                            className="quiet"
                            onClick={() => edit((r) => ({ ...r, leader: row.name }))}
                            onMouseDown={keepFocus}
                            type="button"
                          >
                            {t('cards.party.edit.makeLeader')}
                          </button>
                        )}
                        {row.status === 'forgotten' && (
                          <button
                            className="quiet"
                            onClick={() =>
                              edit((r) => ({
                                ...r,
                                forgotten: r.forgotten.filter((f) => !sameName(f, row.name))
                              }))
                            }
                            onMouseDown={keepFocus}
                            type="button"
                          >
                            {t('cards.party.edit.putBack')}
                          </button>
                        )}
                        <button
                          aria-label={t('cards.party.edit.removeAria', { name: row.name })}
                          className="quiet danger"
                          onClick={() =>
                            edit((r) =>
                              withMembers(r.members.filter((m) => !sameName(m.name, row.name)))
                            )
                          }
                          onMouseDown={keepFocus}
                          type="button"
                        >
                          {t('cards.party.edit.remove')}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {open && roster !== null && (
        <div className="party-editor">
          <form
            className="party-add"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <input
              aria-label={t('cards.party.edit.addAria')}
              list={`party-add-${roster.id}`}
              onChange={(event) => setAdding(event.target.value)}
              placeholder={t('cards.party.edit.addPlaceholder')}
              spellCheck={false}
              value={adding}
            />
            <datalist id={`party-add-${roster.id}`}>
              {suggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <button disabled={adding.trim() === ''} onMouseDown={keepFocus} type="submit">
              {t('cards.party.edit.add')}
            </button>
          </form>
          <label className="party-check" title={t('cards.party.edit.regroupHint')}>
            <input
              checked={roster.regroup}
              onChange={(event) => edit((r) => ({ ...r, regroup: event.target.checked }))}
              type="checkbox"
            />
            {t('cards.party.edit.regroup')}
          </label>
          {onRemoveRoster && (
            <button
              className="quiet danger"
              onClick={() => {
                onRemoveRoster(roster.id);
                setEditing(false);
              }}
              onMouseDown={keepFocus}
              type="button"
            >
              {t('cards.party.edit.disband')}
            </button>
          )}
        </div>
      )}
    </BentoCard>
  );
}

/** The monster a member was last seen fighting, or null once the sighting is stale. */
function fightingWord(character: CharacterState, name: string): string | null {
  const key = Object.keys(character.party.engaged).find(
    (entry) => entry.toLowerCase() === name.toLowerCase()
  );
  const seen = key === undefined ? undefined : character.party.engaged[key];
  if (!seen || Date.now() - seen.at > tuning().fightingFreshMs) return null;
  return seen.target;
}

export default memo(PartyCard);
