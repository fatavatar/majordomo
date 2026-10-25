import { memo, useCallback, type ReactNode } from 'react';

import BentoCard, { type CardChrome, type CardTab } from './BentoCard';
import { useRememberedChoice } from '../hooks/useRemembered';
import CardTable, { type Column } from './CardTable';
import type { CharacterState } from '@shared/character';
import {
  BLOW_KINDS,
  MEGA_MODES,
  NO_MEGA_TALLY,
  damageDealt,
  engagedFor,
  engagedShare,
  hitsDealt,
  mean,
  perRound,
  onlineFor,
  ratePerHour,
  share,
  clock,
  sinceCardBaseline,
  swings,
  turnedAside,
  type BlowKind,
  type BlowTally,
  type CombatTally,
  type MegaMode
} from '@shared/tally';
import type { SessionId } from '@shared/ipc';
import { t } from '../lib/i18n';
import { tuning } from '../lib/tuning';
import { rate } from './ExperienceScope';

export interface StatsCardProps extends CardChrome {
  character: CharacterState;
  /** Which character's card this is, for its table to remember its own sort. */
  session: SessionId;
  /**
   * The reading every figure is a difference from, or null for the whole
   * session. Owned by `App` rather than by this card — see `onReset`.
   */
  baseline: CombatTally | null;
  /** Re-base to the totals as they stand now. */
  onReset(): void;
}

/** A figure the realm has not made yet reads as a dash, never as zero. */
function figure(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** A share as a percentage, or a dash. `share` already returns null for 0/0. */
function percent(value: number | null): string {
  return value === null ? '—' : t('cards.stats.percent', { value: (value * 100).toFixed(1) });
}

/** `12 – 48`, or a dash while nothing has landed. */
function span(blows: BlowTally): string {
  if (blows.least === null || blows.most === null) return '—';
  return blows.least === blows.most
    ? String(blows.least)
    : t('cards.stats.span', { least: blows.least, most: blows.most });
}

/** A quiet `avg 4.4`, or nothing where nothing has landed. */
function average(damage: number, hits: number): string | null {
  const value = mean(damage, hits);
  return value === null ? null : t('cards.stats.avg', { mean: figure(value, 1) });
}

/** One row of the accuracy table: a kind of blow, or the summary under them. */
interface Row {
  key: string;
  label: string;
  hits: number;
  /** Null where the wire cannot say how many attempts a kind took. See below. */
  accuracy: number | null;
  blows: BlowTally;
}

/*
 * MegaMUD's own words for the rows of its accuracy box — `Crit:`, `Cast:`,
 * `Miss:` — read out of `MegaRes.dll`, because the point of this card is that
 * somebody coming from that client recognises it without translating. `BS:` is
 * the one spelled out: the realm's own command table calls it `Backstab`, and
 * `docs/terminology.md` puts the realm's word above MegaMUD's.
 */
const KIND_LABEL: Record<BlowKind, string> = {
  melee: t('cards.stats.kind.melee'),
  critical: t('cards.stats.kind.crit'),
  backstab: t('cards.stats.kind.backstab'),
  spell: t('cards.stats.kind.cast'),
  proc: t('cards.stats.kind.proc')
};

/**
 * MegaMUD's own rows for its attack rungs (2026-10-19), named as its window
 * names them where the rung's command is unset; set, the row is the command.
 */
const MODE_LABEL: Record<MegaMode, string> = {
  pre: t('cards.stats.kind.pre'),
  preMulti: t('cards.stats.kind.preMulti'),
  multi: t('cards.stats.kind.multi'),
  main: t('cards.stats.kind.main'),
  second: t('cards.stats.kind.second')
};

/**
 * How this character has been fighting, added up.
 *
 * The MegaMUD Stats window's question, answered from the stream — and after
 * 2026-09-02 it answers rather more of it, because the objection that had kept
 * four of its rows out dissolved. The old reasoning was *a row that would be a
 * confident zero for every character on this realm is worse than no row*. It
 * still holds; what changed is that **a row is now drawn only once the thing it
 * counts has happened**, so a class that cannot cast, backstab or sneak never
 * sees those rows at all and the rows can exist for the classes that can.
 *
 * Three of MegaMUD's rows came in on that reasoning, each with a wire frame
 * behind it rather than an inference:
 *
 * - **`BS`** — `You surprise <verb> <target> for N damage!`, five captures
 *   (001, 008, 009, 011, 013, 022), every one of them following a typed `bs`.
 *   This file used to say no frame for it existed in the corpus. It did; the
 *   claim had never been checked against a grep.
 * - **`Dodge`** — `but you dodge!` and its three variants, 362 lines. They were
 *   all being counted as unexplained turns, which threw away the one thing
 *   about them that is a fact about the *character*.
 * - **`Sneak`** — `Attempting to sneak...`, with the refusal glued to the
 *   attempt on the failures, so both halves of a real success rate are on the
 *   wire.
 *
 * What is still deliberately **not** here:
 *
 * - **Pre / PreM / Multi / Main / Cast2 only where the MegaMUD engine ran**
 *   (2026-10-19). Those are *its own* attack script's rungs, not things the
 *   server says, so the stream counts a spell as one row; the engine knows
 *   which rung it cast and counts them as its window does (`tally.mega`), as
 *   it does a round's damage and what it collected, sold and stashed.
 * - **"Deflected", not "dodged", for the rest.** The server prints `The
 *   lashworm lunges at you!` and says nothing about why it did no damage.
 *   Calling *that* a dodge would be a claim read off a sentence that makes
 *   none — which is exactly why the dodges it does state are counted apart.
 * - **One time figure, not four.** The server announces engagement and
 *   announces nothing that could add up resting, walking or idling the same
 *   way. `Attacking 41%` is true; a pie of four slices where three were
 *   guessed is not.
 * - **Coin banked or sold and items only from the engine.** MegaMUD's
 *   `Deposit/Sold` and `Stashed` are totals of what *it* did, so they are
 *   counted where it does them (`tally.mega`). Off the wire alone: the server
 *   confirms a coin pick-up (`You picked up 17 copper farthings`) and says
 *   **nothing** when an item is taken — grepped across all 220 captures,
 *   2026-09-02, and the only `You get …` line in any of them is `You get back
 *   on your feet.` The pack changing is an inference, not a statement, and
 *   this card states. `Coins collected` counts the server's own sentence and
 *   nothing else.
 *
 * Nothing here sends, and nothing here decides. Same rule as the Reference
 * card: this is a readout of what already happened.
 */
/*
 * Two faces (todo 08): the card, with what decides an evening — the level
 * meter, the rates and the damage — and *More*, with what qualifies it. The
 * face is remembered per character, as the Self card's is.
 */
const FACE_IDS = ['stats', 'more'] as const;
const MORE_ROWS: ReadonlySet<string> = new Set([
  'deflected',
  'sneak',
  'coins',
  'items',
  'deposited',
  'stashed',
  'income',
  'attacking'
]);

function StatsCard({ baseline, character, onReset, session, ...chrome }: StatsCardProps) {
  const { tally } = character;
  const [face, chooseFace] = useRememberedChoice(session, 'stats-tab', FACE_IDS, FACE_IDS[0]);

  /**
   * The Reset control, as a *baseline* rather than a message to main.
   *
   * Main keeps one monotonic total; pressing Reset stores a copy of it and
   * every figure is read as the difference. That makes the press instant, keeps
   * main free of a second accumulator, and means the untouched totals are still
   * there — which is what makes Reset safe to press. A baseline from a session
   * that has since restarted is discarded below rather than producing negative
   * counts.
   *
   * **The baseline is `App`'s, not this card's** (todo 01, 2026-09-06). It was
   * remembered here, per character, and that could not answer *starting a loop
   * resets the statistics*: this card ships **put away**, so on most rails it
   * is not mounted when a lap begins, and a card that re-based on mount would
   * wipe however much of the lap had already happened. Whatever re-bases has to
   * be running whether or not anything is drawn, and that is `App`, which holds
   * every session's view and hears the loop push for all of them. There is
   * still exactly **one** baseline, written by the button and by the lap alike,
   * so neither has to be compared against the other.
   */
  // A baseline from another series is not subtracted: see `sinceCardBaseline`.
  const shown = sinceCardBaseline(tally, baseline);

  // Read once per render rather than per figure, so every number on the card
  // is taken at the same instant — two clocks in one readout disagree.
  const now = Date.now();
  const total = swings(shown);
  const dealt = damageDealt(shown);
  const landed = hitsDealt(shown);
  const incoming = shown.taken.hits + turnedAside(shown);
  /*
   * Every rate is read over the **scope's own clock** — the time this
   * character has stood in the realm since the scope began, the same stretch
   * the duration badge at the top of this card draws. So `Exp. made 66` over
   * `0:00:40` is a rate the reader can check against the two rows above it,
   * and pressing Reset re-bases all three in one act. In the realm, not since
   * `since`: the tally outlives the socket and the launch, and a night spent
   * disconnected is not an hour the character earned nothing in.
   */
  const elapsed = onlineFor(shown, now);

  /*
   * **Which rows exist is read from the session, not from the reset.**
   *
   * Every figure on the card is `shown` — the difference since the button was
   * pressed — but the *shape* of the card comes from `tally`, the whole
   * session. Otherwise pressing Reset would empty the card and then have rows
   * reappear one at a time as each thing happened again, which is a card
   * changing height under the pointer for no reason the reader can see. A
   * character that has backstabbed once this session keeps its Backstab row,
   * reading zero, for as long as the session lasts.
   */
  const everHappened = (count: number): boolean => count > 0;
  const mega = shown.mega ?? NO_MEGA_TALLY;

  const rows: Row[] = [
    ...BLOW_KINDS.filter((kind) => everHappened(tally.dealt[kind].hits)).map((kind) => ({
      key: kind,
      label: KIND_LABEL[kind],
      hits: shown.dealt[kind].hits,
      /*
       * A share of every swing, which is what MegaMUD's own window showed —
       * and it is only meaningful for the kinds a *swing* can become. A
       * spell that fails is refused in its own sentence, never counted as a
       * miss, so a spell's share of the swings would be a number over the
       * wrong denominator. A weapon's proc is the same objection from the
       * other side: it rides on a swing that is already in the denominator,
       * so its share of them would count one round twice.
       */
      accuracy: kind === 'spell' || kind === 'proc' ? null : share(shown.dealt[kind].hits, total),
      blows: shown.dealt[kind]
    })),
    /*
     * The engine's rungs, by its window's reckoning: a share of the casts
     * that took (`0x4a8a10`), and the damage they landed for.
     */
    ...MEGA_MODES.filter((mode) => {
      const ever = tally.mega?.modes[mode];
      return ever !== undefined && everHappened(ever.took + ever.failed + ever.blows.hits);
    }).map((mode) => {
      const rung = (shown.mega ?? NO_MEGA_TALLY).modes[mode];
      return {
        key: `mega-${mode}`,
        label: rung.command === '' ? MODE_LABEL[mode] : rung.command,
        hits: rung.blows.hits,
        accuracy: share(rung.took, rung.took + rung.failed),
        blows: rung.blows
      };
    }),
    ...(everHappened(tally.missed)
      ? [
          {
            key: 'missed',
            label: t('cards.stats.kind.miss'),
            hits: shown.missed,
            accuracy: share(shown.missed, total),
            blows: { hits: shown.missed, damage: 0, least: null, most: null }
          }
        ]
      : []),
    // A round's damage, its least and most and the average, as the window's `Round:`.
    ...(everHappened(tally.mega?.rounds.hits ?? 0)
      ? [
          {
            key: 'mega-round',
            label: t('cards.stats.kind.round'),
            hits: (shown.mega ?? NO_MEGA_TALLY).rounds.hits,
            accuracy: null,
            blows: (shown.mega ?? NO_MEGA_TALLY).rounds
          }
        ]
      : [])
  ];

  const columns: Column<Row>[] = [
    { id: 'kind', label: t('cards.stats.column.kind'), value: (row) => row.label },
    {
      id: 'count',
      label: t('cards.stats.column.count'),
      numeric: true,
      value: (row) => row.hits
    },
    {
      id: 'accuracy',
      label: t('cards.stats.column.share'),
      numeric: true,
      value: (row) => row.accuracy ?? -1,
      cell: (row) => percent(row.accuracy)
    },
    {
      id: 'span',
      label: t('cards.stats.column.span'),
      // The range steps aside on a rail card, for the average it brackets.
      optional: true,
      numeric: true,
      value: (row) => row.blows.most ?? -1,
      cell: (row) => span(row.blows)
    },
    {
      id: 'mean',
      label: t('cards.stats.column.mean'),
      numeric: true,
      value: (row) => mean(row.blows.damage, row.blows.hits) ?? -1,
      cell: (row) => figure(mean(row.blows.damage, row.blows.hits), 1)
    }
  ];

  /*
   * The readout, as data.
   *
   * Every row is a label, a figure and — where there is one — a **second
   * figure in its own column**. It used to be a label and a value with the
   * second figure appended inside it, so `133 avg 10.2` and `9 69.2%` were two
   * numbers running into each other and nothing on the card lined up but the
   * labels. A grid can only align what it is given as separate cells, so the
   * rows are declared here and drawn as three columns below.
   *
   * `when` is the visibility rule above: a row whose subject has never
   * happened this session is not drawn. The five that are always drawn are the
   * session's own facts — how much experience, how fast, how many kills, how
   * fast, and how much of the time was spent fighting — and a zero is a real
   * answer to every one of them.
   */
  const readout: { key: string; label: string; value: string; second?: string; when?: boolean }[] =
    [
      { key: 'killed', label: t('cards.stats.killedLabel'), value: figure(shown.kills) },
      {
        key: 'kill-rate',
        label: t('cards.stats.killRateLabel'),
        value: rate(ratePerHour(shown.kills, elapsed, tuning().rateFloorMs))
      },
      /*
       * The character's hit, miss and dodge, measured since the scope began
       * (2026-10-17): a swing landed or missed, of every swing it made, and
       * an attack on it dodged, of every attack made on it. Spells and procs
       * are not swings, and are left out of the first two as MegaMUD's own
       * window left them.
       */
      {
        key: 'hit',
        label: t('cards.stats.hitLabel'),
        value: percent(share(total - shown.missed, total)),
        second: t('cards.stats.ofCount', {
          part: figure(total - shown.missed),
          whole: figure(total)
        }),
        when: everHappened(swings(tally))
      },
      {
        key: 'miss',
        label: t('cards.stats.missLabel'),
        value: percent(share(shown.missed, total)),
        second: t('cards.stats.ofCount', { part: figure(shown.missed), whole: figure(total) }),
        when: everHappened(swings(tally))
      },
      {
        key: 'dodge',
        label: t('cards.stats.dodgeLabel'),
        value: percent(share(shown.dodged, incoming)),
        second: t('cards.stats.ofCount', { part: figure(shown.dodged), whole: figure(incoming) }),
        when: everHappened(tally.taken.hits + turnedAside(tally))
      },
      {
        key: 'dealt',
        label: t('cards.stats.dealtLabel'),
        value: figure(dealt),
        second: average(dealt, landed) ?? undefined,
        when: everHappened(hitsDealt(tally))
      },
      {
        key: 'per-round',
        label: t('cards.stats.perRoundLabel'),
        value: figure(perRound(shown, now, tuning().combatRoundMs), 1),
        when: everHappened(hitsDealt(tally))
      },
      {
        key: 'taken',
        label: t('cards.stats.takenLabel'),
        value: figure(shown.taken.damage),
        second: average(shown.taken.damage, shown.taken.hits) ?? undefined,
        when: everHappened(tally.taken.hits)
      },
      {
        key: 'deflected',
        label: t('cards.stats.deflectedLabel'),
        value: figure(shown.turned),
        second: percent(share(shown.turned, incoming)),
        when: everHappened(tally.turned)
      },
      {
        key: 'sneak',
        label: t('cards.stats.sneakLabel'),
        value: figure(shown.sneakTried),
        // The share that worked, not the share that failed: MegaMUD's own row
        // reads as a skill, and a skill is stated by how often it holds.
        second: percent(share(shown.sneakTried - shown.sneakFailed, shown.sneakTried)),
        when: everHappened(tally.sneakTried)
      },
      {
        key: 'coins',
        label: t('cards.stats.coinsLabel'),
        value: figure(shown.coins),
        when: everHappened(tally.coins)
      },
      /*
       * What the engine collected, banked or sold and stashed: its window's
       * `Items` column, and its copper beside the coins picked up.
       */
      {
        key: 'items',
        label: t('cards.stats.itemsLabel'),
        value: figure(mega.items.collected),
        when: everHappened(tally.mega?.items.collected ?? 0)
      },
      {
        key: 'deposited',
        label: t('cards.stats.depositedLabel'),
        value: figure(mega.copper.deposited),
        second: t('cards.stats.itemsFigure', { count: figure(mega.items.sold) }),
        when: everHappened((tally.mega?.copper.deposited ?? 0) + (tally.mega?.items.sold ?? 0))
      },
      {
        key: 'stashed',
        label: t('cards.stats.stashedLabel'),
        value: figure(mega.copper.stashed),
        second: t('cards.stats.itemsFigure', { count: figure(mega.items.stashed) }),
        when: everHappened((tally.mega?.copper.stashed ?? 0) + (tally.mega?.items.stashed ?? 0))
      },
      {
        key: 'income',
        label: t('cards.stats.incomeRateLabel'),
        value: rate(ratePerHour(shown.coins, elapsed, tuning().rateFloorMs)),
        when: everHappened(tally.coins)
      },
      {
        key: 'attacking',
        label: t('cards.stats.attackingLabel'),
        value: clock(engagedFor(shown, now)),
        second: percent(engagedShare(shown, now))
      }
    ].filter((row) => row.when !== false);

  const mainRows = readout.filter((row) => !MORE_ROWS.has(row.key));
  const moreRows = readout.filter((row) => MORE_ROWS.has(row.key));
  const exchange = share(dealt, dealt + shown.taken.damage);

  const rowLines = (list: typeof readout): string[] =>
    list.map((row) =>
      row.second === undefined
        ? `${row.label}: ${row.value}`
        : `${row.label}: ${row.value} · ${row.second}`
    );
  const copyMain = useCallback((): string => {
    return [
      ...rowLines(mainRows),
      ...rows.map(
        (row) => `${row.label}: ${row.hits} · ${percent(row.accuracy)} · ${span(row.blows)}`
      )
    ].join('\n');
  }, [mainRows, rows]);
  const copyMore = useCallback((): string => {
    return [
      ...rowLines(moreRows),
      ...(exchange === null
        ? []
        : [
            `${t('cards.stats.exchangeLabel')}: ${t('cards.stats.exchangeFigure', {
              dealt: figure(dealt),
              taken: figure(shown.taken.damage)
            })}`
          ])
    ].join('\n');
  }, [moreRows, exchange, dealt, shown.taken.damage]);

  const empty = shown.since === null ? <div className="empty">{t('cards.stats.empty')}</div> : null;
  const pairs = (list: typeof readout): React.JSX.Element[] =>
    list.map((row) => (
      <Pair id={row.key} key={row.key} label={row.label} second={row.second} value={row.value} />
    ));

  const tabs: CardTab[] = [
    {
      id: 'stats',
      label: t('cards.stats.title'),
      paned: true,
      copyText: copyMain,
      content: (
        <div className="scroller">
          {empty ?? (
            <>
              {/*
                One `<dl>` for the face, and the table under it rather than
                between two of them: a `.readout` sizes its label column from
                its own children. Three columns: an average, a share or a rate
                is a *second figure* with a track of its own (`.readout.paired`),
                and `dt` is pinned to column one so a row with no second figure
                still starts a new row.
              */}
              <dl className="readout paired">{pairs(mainRows)}</dl>
              <CardTable
                caption={t('cards.stats.tableCaption')}
                className="stats-table"
                columns={columns}
                empty={t('cards.stats.noSwings')}
                keyOf={(row) => row.key}
                name="stats"
                rows={rows}
                session={session}
              />
            </>
          )}
        </div>
      )
    },
    {
      id: 'more',
      label: t('cards.stats.faceMore'),
      paned: true,
      copyText: copyMore,
      content: (
        <div className="scroller">
          {empty ?? (
            <>
              <dl className="readout paired">{pairs(moreRows)}</dl>
              {exchange !== null && (
                <div className="stats-level">
                  <div className="meter exchange">
                    <div className="fill" style={{ width: `${exchange * 100}%` }} />
                    <span className="meter-label">
                      {t('cards.stats.percent', { value: (exchange * 100).toFixed(0) })}
                    </span>
                  </div>
                  <span className="hint">
                    {t('cards.stats.exchangeLabel')}
                    {': '}
                    {t('cards.stats.exchangeFigure', {
                      dealt: figure(dealt),
                      taken: figure(shown.taken.damage)
                    })}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )
    }
  ];

  return (
    <BentoCard
      {...chrome}
      actions={[
        {
          id: 'reset',
          label: t('cards.stats.resetAction'),
          icon: 'reset',
          // Nothing is lost by it — main's totals are untouched — so it is not
          // toned as danger. What it costs is the reading, and that comes back
          // by resetting again on a fresh baseline.
          run: onReset
        }
      ]}
      active={face}
      badge={
        shown.since === null ? (
          <span className="chip off">{t('cards.stats.badge.nothingYet')}</span>
        ) : (
          <span className="chip off">{clock(elapsed)}</span>
        )
      }
      className="stats-card"
      onActive={chooseFace}
      paned
      tabs={tabs}
      title={t('cards.stats.title')}
    />
  );
}

function Pair({
  id,
  label,
  value,
  second
}: {
  /**
   * The row's key, on the figure cell.
   *
   * So a harness can read one row without matching an English label — the
   * `data-action="more"` rule, applied to a readout. Every geometry check on
   * this card passed for the whole time its three rates read `—`, which is
   * what a check keyed on a row's *value* is for.
   */
  id: string;
  label: string;
  value: ReactNode;
  second?: string;
}): React.JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd data-row={id}>{value}</dd>
      {second !== undefined && <dd className="second">{second}</dd>}
    </>
  );
}

export default memo(StatsCard);
