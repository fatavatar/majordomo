import { memo, useState } from 'react';

import BentoCard, { type CardAction, type CardChrome } from './BentoCard';
import { vitalLevel, type CharacterState } from '@shared/character';
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
 * The formation, as the rows are ordered.
 *
 * One list, as the card rethink's Party Board drew it (2026-10-28): front to
 * back, then whoever has no rank, then an offer nobody has accepted. The rank
 * is in the order and is set while editing, rather than boxed under a heading
 * of its own: three headings for a party of three cost more height than the
 * rows. An *announcement* added somebody with no rank, and defaulting them to
 * the front would put a member in the line of fire on the card who is not
 * there on the server, so they come after the ranked.
 */
const ORDER = { front: 0, mid: 1, back: 2, unranked: 3, invited: 4 } as const;

const orderOf = (row: BoardRow): number =>
  ORDER[row.status === 'invited' ? 'invited' : (row.rank ?? 'unranked')];

const RANKS: ReadonlyArray<{ rank: RosterRank | null; label: string }> = [
  { rank: null, label: t('cards.party.edit.rankAuto') },
  { rank: 'front', label: t('cards.party.groups.front') },
  { rank: 'mid', label: t('cards.party.groups.middle') },
  { rank: 'back', label: t('cards.party.groups.back') }
];

/** A member who is not simply travelling with the party, in a word. */
const STATUS_WORD: Record<Exclude<BoardRow['status'], 'in'>, string> = {
  out: t('cards.party.status.out'),
  offline: t('cards.party.status.offline'),
  forgotten: t('cards.party.status.forgotten'),
  invited: t('cards.party.status.invited')
};

/** The chip at the end of a row: one word, and the tone it is said in. */
interface RowChip {
  word: string;
  tone: 'bad' | 'warn' | 'info' | 'off' | 'quiet';
  title?: string;
}

/**
 * The one condition a row's chip states: the most pressing, since there is
 * room for one (the Party Board's `fighting`, `low mana`).
 *
 * Where the member stands against the party first, because out of it is what
 * Regroup is for; then a fight, then a vital at its alarm, then a vital at
 * its warning, then a rest. The level is said in words here as well as in the
 * bar's hue, which is the Vitals card's rule. An activity letter the client
 * cannot expand is drawn as the letter: expanding it would state a condition
 * the server never did (`PartyActivity`).
 */
function rowChip(
  row: BoardRow,
  character: CharacterState,
  thresholds: VitalsUiConfig
): RowChip | null {
  if (row.status === 'out') return { word: STATUS_WORD.out, tone: 'bad' };
  if (row.status !== 'in')
    return { word: STATUS_WORD[row.status], tone: row.status === 'invited' ? 'info' : 'off' };
  // What the server last said a member not of ours hit, while the sighting is
  // fresh: the fact `assistLeader` acts on.
  const target = row.ours === null ? fightingWord(character, row.name) : null;
  if (row.activity?.state === 'fighting' || target !== null) {
    return {
      word: t('cards.party.activity.fighting'),
      tone: 'bad',
      title: target === null ? undefined : t('cards.party.fighting', { target })
    };
  }
  const hp = vitalLevel(row.health, 1, thresholds.hp);
  const ma = vitalLevel(row.mana, 1, thresholds.mana);
  if (hp === 'critical') return { word: t('cards.party.chip.lowHealth'), tone: 'bad' };
  if (ma === 'critical') return { word: t('cards.party.chip.lowMana'), tone: 'bad' };
  if (hp === 'caution') return { word: t('cards.party.chip.lowHealth'), tone: 'warn' };
  if (ma === 'caution') return { word: t('cards.party.chip.lowMana'), tone: 'warn' };
  if (row.activity !== null) {
    return row.activity.state === 'unknown'
      ? { word: row.activity.flag, tone: 'off' }
      : { word: row.activity.state, tone: 'warn' };
  }
  if (row.guest)
    return { word: t('cards.party.guest'), tone: 'quiet', title: t('cards.party.guestHint') };
  return null;
}

/** A roster id nobody else has: the browser tab's crypto is not there over plain HTTP. */
const newId = (): string =>
  `party-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * A thin track with its figures beside it.
 *
 * The listing gives a share and no absolutes, so the figures are printed only
 * where a maximum is known — a member of ours, a client's `{HP=…}`, or one
 * guessed from damage seen — and never as a percentage: the track is the
 * share (2026-10-27). The rule from the Vitals card holds unchanged: a null
 * fraction is an empty track, never a full or a zero one. The resource and
 * its level are said to a screen reader; on screen the hue says which track
 * is which and the row's chip says the level in words.
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
      <span className="sr-only">{word === null ? label : `${label} ${word}`}</span>
      <span className="party-bar">
        <span style={fraction === null ? undefined : { width: `${fraction * 100}%` }} />
      </span>
      <span className="party-meter-value">{figures ?? ''}</span>
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
  return `${at}/${mark}${max.toLocaleString()}`;
}

/** Which of the card's three sections the last answer belongs under. */
type ReportFrom = 'regroup' | 'muster' | 'say';

/**
 * The party: who should be travelling together, who is, and how they are
 * doing (2026-10-27), laid out as the card rethink's Party Board, Regroup,
 * Muster and Say It to Everyone drew it (2026-10-28).
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
  /** What the last Regroup, Muster or Say to did, a line each, under its own section until the next press. */
  const [report, setReport] = useState<{ from: ReportFrom; lines: string[] } | null>(null);
  /** Who `Say to` leaves out; everybody of ours on the roster is in by default. */
  const [quiet, setQuiet] = useState<ReadonlySet<SessionId>>(new Set());
  /** Whether Say to leaves out everybody else in the party (the leader's @party). */
  const [othersQuiet, setOthersQuiet] = useState(false);
  const [line, setLine] = useState('');
  /** A sys goto place being added while editing, for Muster. */
  const [placing, setPlacing] = useState('');
  const rows = [...boardRows(roster, character, ours)].sort((a, b) => orderOf(a) - orderOf(b));
  const editable = roster !== null && onSaveRoster !== undefined;
  const open = editing && editable;
  const said = (from: ReportFrom) => (lines: string[]) => setReport({ from, lines });
  const reported = (from: ReportFrom) =>
    report !== null && report.from === from && report.lines.length > 0 ? (
      <p className="party-report hint">{report.lines.join(' · ')}</p>
    ) : null;

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
      <span className={`chip ${count.in < count.of ? 'bad' : 'info'}`}>
        {t('cards.party.badge.of', { count: count.in, of: count.of })}
      </span>
    ) : count.in > 0 ? (
      <span className="chip info">{t('cards.party.badge.together', { count: count.in })}</span>
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

  /*
   * Where everybody is, under the rows: the leader's room when every member
   * of ours stands in it, else who is elsewhere. Only the leader's own tab
   * knows the room, so only while the leader is ours.
   */
  const leading = ours.find((m) => rows.some((row) => row.leader && row.ours === m.session));
  const away = rows.filter((row) => row.status === 'in' && row.away !== null);
  const room = leading?.character.room;
  const where =
    away.length > 0
      ? away.map((row) => t('cards.party.away', { name: row.name, room: row.away! })).join(' · ')
      : room?.name && rows.filter((row) => row.status === 'in').length > 1
        ? t('cards.party.allHere', {
            room: room.name,
            place: room.map !== null && room.number !== null ? ` ${room.map}/${room.number}` : ''
          })
        : null;

  /* Who has dropped out of the party, for Regroup's line: the case it exists for. */
  const out = rows.filter((row) => row.status === 'out').map((row) => row.name);

  /* Say to: only with a roster, since every control on it acts on the roster's members. */
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
      said('regroup')([
        count === 0
          ? t('cards.party.regrouped.zero')
          : count === 1
            ? t('cards.party.regrouped.one')
            : t('cards.party.regrouped.many', { count })
      ])
    );
  };
  /*
   * Muster: a press per place, as the Party Board drew it (2026-10-28) —
   * walking everybody to the leader, or a sys goto place off the roster
   * (places are added while editing, never typed at the moment of going).
   */
  const musterOptions = roster === null ? [] : musterChoices(roster);
  const musterTo = (target: MusterTarget): void => {
    if (roster === null || !onMuster) return;
    void onMuster(roster.id, target).then(said('muster'));
  };
  const addPlace = (): void => {
    const place = readPlace(placing);
    if (place === null) return;
    edit((r) =>
      r.places.some((kept) => sameName(kept, place)) ? null : { ...r, places: [...r.places, place] }
    );
    setPlacing('');
  };
  const say = (): void => {
    const text = line.trim();
    if (text === '' || reach === 0 || !onSay || roster === null) return;
    void onSay(roster.id, sayTo, text, toOthers).then(said('say'));
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
        roster Regroup, Muster and Say to are not drawn, and they were nowhere
        a player could find them.
      */}
      {keep !== null && (
        <div className="party-start">
          <button onClick={keep} onMouseDown={keepFocus} type="button">
            {t('cards.party.start')}
          </button>
          <span className="hint">{t('cards.party.startHint')}</span>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="empty">{t('cards.party.empty')}</div>
      ) : (
        <ul className="party-list">
          {rows.map((row) => {
            const chip = rowChip(row, character, thresholds);
            /* `follow <name>` is how a leader is made on this realm; there is
               no verb for the other direction, so there is no other button.
               Not for this character's own row, nor whoever is already
               followed, nor a roster's leader outside editing — Regroup
               follows them for you. */
            const follow =
              ask !== undefined &&
              row.status === 'in' &&
              !isSelf(character, row.name) &&
              !sameName(row.name, character.party.following ?? '') &&
              (open || (roster === null && !row.leader));
            return (
              <li
                data-selected={playerKey(row.name) === subject ? 'true' : undefined}
                data-status={row.status}
                key={row.name}
              >
                {/* A member the registry or roster knows is a person, and a
                    person's name is the control that opens their card — the
                    same gesture as on the Realm and Players listings. The class
                    is the name's tooltip: the row has no room to spend on it. */}
                <span
                  className="party-name"
                  data-leader={row.leader}
                  title={row.className ?? undefined}
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
                {/*
                  A member the announcements added has no numbers at all
                  until the next listing, and two empty tracks would read as
                  two resources at zero. Nor does a member who is out, or only
                  invited, whose chip already says why.
                */}
                {row.status === 'invited' || row.status === 'out' ? (
                  <span />
                ) : row.health === null ? (
                  <span className="hint party-unlisted">
                    {row.status === 'in' ? t('cards.party.notYetListed') : ''}
                  </span>
                ) : (
                  <span className="party-meters">
                    <Bar
                      fraction={row.health}
                      figures={
                        row.vitals !== null
                          ? figures(row.vitals.hp, row.vitals.hpMax)
                          : figures(
                              row.hpMaxGuess === null ? null : row.health * row.hpMaxGuess,
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
                  </span>
                )}
                <span className="party-chip">
                  {chip !== null && (
                    <span className={`chip ${chip.tone}`} title={chip.title}>
                      {chip.word}
                    </span>
                  )}
                </span>
                {(open || follow) && (
                  <div className="party-edit-row">
                    {follow && (
                      <button
                        aria-label={t('cards.party.followAria', { name: row.name })}
                        className="quiet"
                        onClick={() => ask?.(`follow ${row.name}`)}
                        onMouseDown={keepFocus}
                        type="button"
                      >
                        {t('cards.party.followButton')}
                      </button>
                    )}
                    {open && row.guest && (
                      <button
                        className="quiet"
                        onClick={() =>
                          edit((r) =>
                            withMembers([...r.members, { name: row.name, rank: row.rank }])
                          )
                        }
                        onMouseDown={keepFocus}
                        type="button"
                      >
                        {t('cards.party.edit.keepGuest')}
                      </button>
                    )}
                    {open && !row.guest && (
                      <>
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
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {where !== null && <p className="party-where hint">{where}</p>}
      {/*
        Regroup's line, only while somebody has dropped out: Regroup runs by
        itself, so a button for it on a whole party is a button with nothing
        to do (the Party Board's Re-invite, 2026-10-28).
      */}
      {roster !== null && onRegroup && (out.length > 0 || report?.from === 'regroup') && (
        <div className="party-section party-regroup">
          {out.length > 0 && (
            <div className="party-line">
              <span className="party-left">{t('cards.party.left', { names: out.join(', ') })}</span>
              <button
                className="party-go"
                onClick={regroupNow}
                onMouseDown={keepFocus}
                type="button"
              >
                {t('cards.party.reinvite')}
              </button>
            </div>
          )}
          {reported('regroup')}
        </div>
      )}
      {roster !== null && onMuster && musterOptions.length > 0 && (
        <div className="party-section">
          <div className="party-line">
            <span className="party-section-head">{t('cards.party.muster')}</span>
            {musterOptions.map((option) => (
              <button
                className="party-go"
                key={option.key}
                onClick={() => musterTo(option.target)}
                onMouseDown={keepFocus}
                title={option.title}
                type="button"
              >
                ⇢ {option.label}
              </button>
            ))}
          </div>
          {reported('muster')}
        </div>
      )}
      {roster !== null && onSay && speakers.length > 0 && (
        <form
          className="party-section party-say"
          onSubmit={(event) => {
            event.preventDefault();
            say();
          }}
        >
          <div className="party-line">
            {speakers.map((row) => (
              <button
                aria-pressed={!quiet.has(row.ours!)}
                className="chip party-pick"
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
                className="chip party-pick"
                onClick={() => setOthersQuiet(!othersQuiet)}
                onMouseDown={keepFocus}
                title={t('cards.party.sayOthersHint', { names: othersIn.join(', ') })}
                type="button"
              >
                {t('cards.party.sayOthers', { count: othersIn.length })}
              </button>
            )}
          </div>
          <label className="party-term">
            <span aria-hidden="true">›</span>
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
          </label>
          {reported('say')}
        </form>
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
          <form
            className="party-add"
            onSubmit={(event) => {
              event.preventDefault();
              addPlace();
            }}
          >
            <input
              aria-label={t('cards.party.edit.placeAddAria')}
              onChange={(event) => setPlacing(event.target.value)}
              placeholder={t('cards.party.edit.placeAddPlaceholder')}
              spellCheck={false}
              value={placing}
            />
            <button disabled={readPlace(placing) === null} onMouseDown={keepFocus} type="submit">
              {t('cards.party.edit.placeAdd')}
            </button>
          </form>
          {roster.places.length > 0 && (
            <ul className="party-places">
              {roster.places.map((place) => (
                <li key={place}>
                  <span>{place}</span>
                  <button
                    aria-label={t('cards.party.edit.placeRemoveAria', { place })}
                    className="quiet danger"
                    onClick={() =>
                      edit((r) => ({ ...r, places: r.places.filter((p) => !sameName(p, place)) }))
                    }
                    onMouseDown={keepFocus}
                    type="button"
                  >
                    {t('cards.party.edit.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
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

/** One Muster press: walking everybody to the leader, or a sys goto place. */
interface MusterChoice {
  key: string;
  label: string;
  title: string;
  target: MusterTarget;
}

/** What Muster offers: the leader's walk, then each of the roster's places by the realm's word. */
function musterChoices(roster: PartyRoster): MusterChoice[] {
  const walk: MusterChoice[] =
    roster.leader === null
      ? []
      : [
          {
            key: 'walk',
            label: roster.leader,
            title: t('cards.party.musterToLeader', { leader: roster.leader }),
            target: { to: 'leader' }
          }
        ];
  return [
    ...walk,
    ...roster.places.map((place) => ({
      key: `goto:${place}`,
      label: place.charAt(0).toUpperCase() + place.slice(1),
      title: t('cards.party.musterPlace', { place }),
      target: { to: 'place', place } as MusterTarget
    }))
  ];
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
