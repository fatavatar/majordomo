import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import BentoCard, { type CardChrome } from './BentoCard';
import CardTable, { type Column } from './CardTable';
import { t } from '../lib/i18n';
import { keepFocus } from '../lib/focus';
import type {
  GroundArea,
  GroundGroup,
  GroundRoom,
  GroupRole,
  HuntingGrounds
} from '@shared/huntingGrounds';
import type { HuntingRoom } from '@shared/hunting';
import type { IpcApi, SessionId } from '@shared/ipc';
import type { Loop } from '@shared/loops';
import type { LoopDestination } from '../lib/loops';

/**
 * Where to hunt, by MMUD Explorer's own arithmetic (2026-10-29): every area
 * the exits reach from where this character stands, best first.
 *
 * An area is the lairs a player thinks of as one place — one map, one name,
 * or a monster in common close by — and each of its lair groups is priced by
 * MME's exp/hour against the character as it fights: its MegaMUD attack, its
 * heal or heal-over-time blessings, and the monsters' blows simulated against
 * its own defences. The area's rate is its best group walked as the loop, and
 * the groups on a clock longer than that loop added on top for the share of
 * laps that find them back (`priceArea`). Opening an area lists its groups,
 * each with MME's figure and how it counts; *Walk there* opens the route
 * panel on its first room, *Loop it* walks its loop unsaved, and *Create
 * loop* opens the builder with the loop's rooms picked.
 *
 * Checked against Fatty on 2026-10-29: the dark oceanid druidess lairs at
 * 126M/h with his song of harmony as healing, the beastmistress adding about
 * 27M/h on her hour, against the 143M/h he earned.
 */
export interface HuntingCardProps extends CardChrome {
  session: SessionId;
  /** Asks main, addressed at this card's own character: alone, or with its party. */
  loadHunting(asParty: boolean): ReturnType<IpcApi['huntingGrounds']>;
  /** The party roster this character is on, by name; null where it is on none, and only Solo is offered. */
  partyMembers: string[] | null;
  /** Opens the route panel on a room; null on a pinned float. */
  chooseOnMap: ((map: number, room: number) => void) | null;
  /** Walks a loop built here, filed or not; null on a pinned float. */
  runLoop: ((loop: Loop, destination: LoopDestination) => void) | null;
  /** Opens the builder with these stops picked and this name offered; null on a pinned float. */
  createLoop: ((rooms: HuntingRoom[], name: string) => void) | null;
}

/** Two literal calls per word, as the dictionary's coverage test reads them. */
const ROLE_WORD: Record<GroupRole, () => string> = {
  loop: () => t('cards.hunting.role.loop'),
  added: () => t('cards.hunting.role.added'),
  dangerous: () => t('cards.hunting.role.dangerous'),
  none: () => t('cards.hunting.role.none')
};
const ROLE_TITLE: Record<GroupRole, () => string> = {
  loop: () => t('cards.hunting.roleTitle.loop'),
  added: () => t('cards.hunting.roleTitle.added'),
  dangerous: () => t('cards.hunting.roleTitle.dangerous'),
  none: () => t('cards.hunting.roleTitle.none')
};

/** Experience an hour as MME writes it: `126.4M`, `850K`. */
function perHour(rate: number | null): string {
  if (rate === null || rate <= 0) return '–';
  if (rate >= 1_000_000) return `${(rate / 1_000_000).toFixed(1)}M`;
  if (rate >= 1_000) return `${Math.round(rate / 1_000)}K`;
  return String(Math.round(rate));
}
const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** What an area's loop is for: its loop's monsters. */
function mainOf(area: GroundArea): GroundGroup | null {
  return area.loop;
}

/** An area's loop, in the stop grammar every loop uses; an added room carries its clock. */
function areaLoop(area: GroundArea): Loop {
  return {
    name: t('cards.hunting.loopName', { area: area.name, mob: mainOf(area)?.mobs[0] ?? '' }),
    stops: area.walk.map((room) => ({
      room: `${room.name} ${room.map}/${room.room}`,
      ...(room.respawnSeconds === undefined || room.respawnSeconds <= 0
        ? {}
        : { every: Math.round(room.respawnSeconds) })
    }))
  };
}

export function huntingCopyText(grounds: HuntingGrounds | null): string {
  if (grounds === null) return t('cards.hunting.title');
  return [
    t('cards.hunting.title'),
    ...grounds.areas.map((area) =>
      t('cards.hunting.copyRow', {
        area: area.name,
        rate: perHour(area.expPerHour),
        groups: area.groups.length,
        steps: area.steps
      })
    )
  ].join('\n');
}

function HuntingCard({
  session,
  loadHunting,
  chooseOnMap,
  runLoop,
  createLoop,
  partyMembers,
  ...chrome
}: HuntingCardProps) {
  // Priced for this character alone, or by MME's party mode with its roster (2026-10-29).
  const canParty = partyMembers !== null && partyMembers.length > 1;
  const [asParty, setAsParty] = useState(false);
  const party = asParty && canParty;
  const [grounds, setGrounds] = useState<HuntingGrounds | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  /*
   * Asked when the card opens, when the party changes — Solo or Party, or who
   * is on the roster — and on *Ask again*, and at no other time (2026-10-29):
   * nothing it prices moves with a step, and the survey prices every lair in
   * reach, so asking again as the character walked redid it every ten
   * seconds of a lap for a steps column.
   */
  const partyKey = party ? (partyMembers ?? []).join('|') : '';
  useEffect(() => {
    let stale = false;
    setLoading(true);
    void loadHunting(party).then((answer) => {
      if (stale) return;
      setGrounds(answer);
      setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [loadHunting, asked, party, partyKey]);

  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  const rows = useMemo(() => grounds?.areas ?? [], [grounds]);

  const columns: Array<Column<GroundArea>> = useMemo(
    () => [
      {
        id: 'area',
        label: t('cards.hunting.columns.area'),
        wide: true,
        value: (area) => `${area.name} ${area.groups.flatMap(({ group }) => group.mobs).join(' ')}`,
        cell: (area) => (
          <span className="hunt-lair">
            <button
              aria-expanded={open === area.key}
              className="lookup"
              onClick={() => setOpen(open === area.key ? null : area.key)}
              onMouseDown={keepFocus}
              title={mainOf(area)?.mobs.join(', ')}
              type="button"
            >
              {area.name === '' ? t('cards.hunting.unnamedArea', { map: area.map }) : area.name}
            </button>
            <span className="quiet">
              {mainOf(area)?.mobs.slice(0, 2).join(', ') ?? t('cards.hunting.nothingPays')}
            </span>
          </span>
        )
      },
      {
        id: 'rate',
        label: t('cards.hunting.columns.rate'),
        numeric: true,
        value: (area) => area.expPerHour,
        cell: (area) =>
          area.tooDangerous ? (
            <span className="chip bad" title={t('cards.hunting.tooDangerousTitle')}>
              {t('cards.hunting.tooDangerous')}
            </span>
          ) : (
            perHour(area.expPerHour)
          )
      },
      {
        id: 'risk',
        label: t('cards.hunting.columns.risk'),
        numeric: true,
        // The router's check: what one pass through its worst lair, or room, takes of the bar.
        value: (area) => area.danger,
        cell: (area) => (area.danger === null ? '?' : percent(area.danger))
      },
      {
        id: 'groups',
        optional: true,
        label: t('cards.hunting.columns.groups'),
        numeric: true,
        value: (area) => area.groups.length
      },
      {
        id: 'steps',
        optional: true,
        label: t('cards.hunting.columns.steps'),
        numeric: true,
        value: (area) => area.steps
      }
    ],
    [open]
  );

  const opened = rows.find((area) => area.key === open) ?? null;
  const closeDetail = useCallback(() => setOpen(null), []);
  const copyText = useCallback(() => huntingCopyText(grounds), [grounds]);
  const actions = useMemo(
    () => [
      { id: 'refresh', icon: 'reset' as const, label: t('cards.hunting.refresh'), run: refresh }
    ],
    [refresh]
  );

  const note =
    grounds?.refusal !== null && grounds?.refusal !== undefined
      ? grounds.refusal
      : loading
        ? t('cards.hunting.loading')
        : grounds === null
          ? ''
          : [
              t('cards.hunting.from', {
                room: grounds.from?.name ?? '',
                areas: rows.length.toLocaleString(),
                swept: grounds.swept.toLocaleString()
              }),
              grounds.setup === null ? '' : t('cards.hunting.setup', { setup: grounds.setup }),
              grounds.party === null
                ? ''
                : t('cards.hunting.asParty', {
                    members: grounds.party.members.join(', '),
                    size: grounds.party.size
                  })
            ]
              .filter((sentence) => sentence !== '')
              .join(' ');

  return (
    <BentoCard
      {...chrome}
      actions={actions}
      copyText={copyText}
      paned
      title={t('cards.hunting.title')}
    >
      <div className="hunt-head">
        {canParty ? (
          <span aria-label={t('cards.hunting.mode.label')} className="hunt-mode" role="group">
            <button
              aria-pressed={!party}
              className="chip"
              onClick={() => setAsParty(false)}
              onMouseDown={keepFocus}
              type="button"
            >
              {t('cards.hunting.mode.solo')}
            </button>
            <button
              aria-pressed={party}
              className="chip"
              onClick={() => setAsParty(true)}
              onMouseDown={keepFocus}
              title={t('cards.hunting.mode.partyTitle', { members: partyMembers.join(', ') })}
              type="button"
            >
              {t('cards.hunting.mode.party')}
            </button>
          </span>
        ) : null}
        <span className="hunt-note">{note}</span>
      </div>
      <CardTable
        caption={t('cards.hunting.caption')}
        className="hunt-table"
        columns={columns}
        detailKey={open}
        empty={loading ? t('cards.hunting.loading') : t('cards.hunting.none')}
        find={t('cards.hunting.find')}
        keyOf={(area) => area.key}
        name="hunting"
        onDetailHidden={closeDetail}
        rowAttrs={(area) => ({ 'data-open': open === area.key ? 'true' : 'false' })}
        rows={rows}
        session={session}
      />
      {opened === null ? null : (
        <>
          <AreaDetail area={opened} chooseOnMap={chooseOnMap} />
          <AreaActions
            area={opened}
            chooseOnMap={chooseOnMap}
            createLoop={createLoop}
            runLoop={runLoop}
          />
        </>
      )}
    </BentoCard>
  );
}

/** An area's groups, each with MME's figures and how it counts toward the area. */
function AreaDetail({
  area,
  chooseOnMap
}: {
  area: GroundArea;
  chooseOnMap: HuntingCardProps['chooseOnMap'];
}) {
  return (
    <div className="scroller hunt-detail">
      <div className="readout-box">
        <dl className="readout columns">
          <dt>{t('cards.hunting.detail.rate')}</dt>
          <dd>{t('cards.hunting.detail.rateValue', { rate: perHour(area.expPerHour) })}</dd>
          {area.loop === null ? null : (
            <>
              <dt>{t('cards.hunting.detail.loop')}</dt>
              <dd>
                {t('cards.hunting.detail.loopValue', {
                  rate: perHour(area.loop.expPerHour),
                  lairs: area.loop.lairs,
                  recover: percent(area.loop.recovering)
                })}
              </dd>
            </>
          )}
          <dt>{t('cards.hunting.detail.lap')}</dt>
          <dd>
            {area.lapMinutes === null
              ? '–'
              : t('cards.hunting.detail.lapValue', { minutes: Math.round(area.lapMinutes) })}
          </dd>
        </dl>
      </div>
      <ul className="hunt-lairs">
        {area.groups.map(({ group, role, contributes }) => (
          <li key={group.key} data-role={role}>
            <span>
              <span className="chip quiet" title={ROLE_TITLE[role]()}>
                {ROLE_WORD[role]()}
              </span>{' '}
              {group.mobs.join(', ')}
            </span>
            <span className="quiet">
              {role === 'added'
                ? t('cards.hunting.addedFigures', {
                    rate: perHour(group.expPerHour),
                    counts: perHour(contributes),
                    respawn: Math.round(group.respawnMinutes)
                  })
                : t('cards.hunting.groupFigures', {
                    rate: perHour(group.expPerHour),
                    recover: percent(group.recovering),
                    lairs: group.lairs,
                    respawn: Math.round(group.respawnMinutes)
                  })}
              {group.danger === null || group.danger === undefined
                ? ''
                : ` · ${t('cards.hunting.dangerFigure', { share: percent(group.danger) })}`}
            </span>
          </li>
        ))}
      </ul>
      <ul className="hunt-rooms">
        {area.walk.slice(0, 12).map((room) => (
          <RoomRow chooseOnMap={chooseOnMap} key={room.id} room={room} />
        ))}
        {area.walk.length > 12 ? (
          <li className="quiet">
            {t('cards.hunting.moreRooms.many', { count: area.walk.length - 12 })}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** What can be done with the area on screen: go there, walk its loop, build it. */
function AreaActions({
  area,
  chooseOnMap,
  runLoop,
  createLoop
}: {
  area: GroundArea;
  chooseOnMap: HuntingCardProps['chooseOnMap'];
  runLoop: HuntingCardProps['runLoop'];
  createLoop: HuntingCardProps['createLoop'];
}) {
  const first = area.walk[0];
  if (chooseOnMap === null || runLoop === null || createLoop === null || first === undefined) {
    return null;
  }
  return (
    <div className="loop-controls hunt-actions">
      <button
        className="quiet"
        onClick={() => chooseOnMap(first.map, first.room)}
        onMouseDown={keepFocus}
        type="button"
      >
        {t('cards.hunting.walkThere')}
      </button>
      <button
        className="quiet"
        onClick={() => runLoop(areaLoop(area), 'none')}
        onMouseDown={keepFocus}
        type="button"
      >
        {t('cards.hunting.loopIt')}
      </button>
      <button
        className="quiet"
        disabled={area.walk.length < 2}
        onClick={() => createLoop(area.walk, areaLoop(area).name)}
        onMouseDown={keepFocus}
        title={area.walk.length < 2 ? t('cards.hunting.oneRoomNoLoop') : undefined}
        type="button"
      >
        {t('cards.hunting.createLoop')}
      </button>
    </div>
  );
}

/** One room of the loop: a control where the panel can open on it, its figures quiet at the end. */
function RoomRow({
  room,
  chooseOnMap
}: {
  room: GroundRoom;
  chooseOnMap: HuntingCardProps['chooseOnMap'];
}) {
  return (
    <li>
      {chooseOnMap === null ? (
        <span>{room.name}</span>
      ) : (
        <button
          className="lookup"
          onClick={() => chooseOnMap(room.map, room.room)}
          onMouseDown={keepFocus}
          type="button"
        >
          {room.name}
        </button>
      )}
      <span className="quiet">
        {t('cards.hunting.roomFigures', { map: room.map, room: room.room, steps: room.steps })}
      </span>
    </li>
  );
}

export default memo(HuntingCard);
