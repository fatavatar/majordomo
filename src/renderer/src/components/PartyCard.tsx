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
import { levelWord, meterValue } from '../lib/vitals';
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
  /** One line typed once, sent by each of these characters as its own. */
  onSay?(sessions: readonly SessionId[], line: string): void;
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

/** Muster's own option for the leader, which no `sys goto` word can be (it has a space). */
const LEADER = ' leader';

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
 * A fraction against a track, with the number and the level in words beside it.
 *
 * The party roster gives percentages and no absolutes, so there is no `n/max`
 * to print — the maximum, when this member's client has answered `@health`
 * or the member is one of ours, goes beside the percentage instead
 * (`meterValue` says why not the pair). The rule from the Vitals card holds
 * unchanged: a null fraction is an empty track, never a full or a zero one,
 * and the level is said in words as well as in hue.
 */
function Bar({
  label,
  fraction,
  max,
  thresholds,
  tone
}: {
  label: string;
  fraction: number | null;
  /** From an `@health` answer or the member's own tab, or null when nobody has said. */
  max: number | null;
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
        {meterValue(fraction, max)}
        {word === null ? '' : ` ${word}`}
      </span>
    </span>
  );
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
  const [line, setLine] = useState('');
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

  const actions: CardAction[] = [];
  if (editable) {
    actions.push({
      id: 'edit',
      label: open ? t('cards.party.edit.done') : t('cards.party.edit.action'),
      icon: open ? 'check' : 'edit',
      run: () => setEditing(!open)
    });
  } else if (onSaveRoster && realm !== null && character.name !== null) {
    actions.push({
      id: 'keep',
      label: t('cards.party.keepAction'),
      icon: 'users',
      run: () => {
        save(rosterFromListing(newId(), realm, character));
        setEditing(true);
      }
    });
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
  const musterTo = (value: string): void => {
    if (roster === null || !onMuster || value === '') return;
    const target: MusterTarget =
      value === LEADER ? { to: 'leader' } : { to: 'place', place: value };
    void onMuster(roster.id, target).then(setReport);
  };
  const say = (): void => {
    const text = line.trim();
    if (text === '' || sayTo.length === 0 || !onSay) return;
    onSay(sayTo, text);
    setLine('');
  };

  /* How far the party is down, from the members whose figures are known. */
  const known = rows.filter((row) => row.status === 'in' && row.health !== null);
  const deficit = known.reduce(
    (sum, row) => sum + (row.vitals === null ? 0 : Math.max(0, row.vitals.hpMax - row.vitals.hp)),
    0
  );
  const lowest = known.reduce<BoardRow | null>(
    (low, row) => (low === null || (row.health ?? 1) < (low.health ?? 1) ? row : low),
    null
  );

  return (
    <BentoCard
      {...chrome}
      actions={actions}
      badge={badge}
      className="party-card"
      title={t('cards.party.title')}
    >
      {roster !== null && (onRegroup || onMuster) && (
        <div className="party-actions">
          {onRegroup && (
            <button onClick={regroupNow} onMouseDown={keepFocus} type="button">
              {t('cards.party.regroup')}
            </button>
          )}
          {onMuster && (
            /* No `keepFocus` on a select: its default is the popup opening. */
            <select
              aria-label={t('cards.party.musterAria')}
              onChange={(event) => {
                musterTo(event.target.value);
                event.target.value = '';
                chrome.returnFocus?.();
              }}
              value=""
            >
              <option value="">{t('cards.party.muster')}</option>
              {roster.leader !== null && (
                <option value={LEADER}>
                  {t('cards.party.musterToLeader', { leader: roster.leader })}
                </option>
              )}
              {roster.places.map((place) => (
                <option key={place} value={place}>
                  {t('cards.party.musterToPlace', { place })}
                </option>
              ))}
            </select>
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
          </span>
          <input
            aria-label={t('cards.party.sayAria')}
            onChange={(event) => setLine(event.target.value)}
            placeholder={
              sayTo.length === 0
                ? t('cards.party.sayPlaceholder.zero')
                : sayTo.length === 1
                  ? t('cards.party.sayPlaceholder.one')
                  : t('cards.party.sayPlaceholder.many', { count: sayTo.length })
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
      {roster !== null && lowest !== null && (
        <div className="party-summary hint">
          {deficit > 0
            ? t('cards.party.down', {
                hp: deficit.toLocaleString(),
                name: lowest.name,
                percent: Math.round((lowest.health ?? 1) * 100)
              })
            : t('cards.party.whole')}
        </div>
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
                          label={t('cards.party.bar.hp')}
                          max={row.vitals?.hpMax ?? null}
                          thresholds={thresholds.hp}
                          tone="hp"
                        />
                        {/* No mana track for a class that has none — the roster
                            omits the column entirely, and an empty one would
                            imply a resource that does not exist. */}
                        {row.mana !== null && (
                          <Bar
                            fraction={row.mana}
                            label={t('cards.party.bar.mana')}
                            max={row.vitals?.manaMax ?? null}
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
          <input
            aria-label={t('cards.party.edit.placesAria')}
            defaultValue={roster.places.join(', ')}
            key={roster.places.join(',')}
            onBlur={(event) => {
              const places = event.target.value
                .split(',')
                .map(readPlace)
                .filter((place): place is string => place !== null);
              if (places.join(',') !== roster.places.join(','))
                edit((r) => ({ ...r, places: [...new Set(places)] }));
            }}
            placeholder={t('cards.party.edit.placesPlaceholder')}
            spellCheck={false}
            title={t('cards.party.edit.placesHint')}
          />
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
