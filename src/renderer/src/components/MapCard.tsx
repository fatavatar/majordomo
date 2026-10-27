import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AreaBadge, LevelKeys } from './AreaControls';
import BentoCard, { type CardChrome } from './BentoCard';
import ClearField from './ClearField';
import MapView from './MapView';
import { useListNavigation } from '../hooks/useListNavigation';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { densityFor } from '../lib/mapView';
import { tuning } from '../lib/tuning';
import {
  DEFAULT_MAP_DENSITY,
  EMPTY_MAP,
  roomPixelsFor,
  type AreaMap,
  type LocalMap
} from '@shared/map';
import type { CharacterState } from '@shared/character';
import type { LoopProgress } from '@shared/loops';
import type { WalkProgress } from '@shared/walk';
import { roomId, type RoomId, type WorldRoom } from '@shared/world';
import { roomsWithFinds, type Find } from '@shared/finds';

export interface MapCardProps extends CardChrome {
  character: CharacterState;
  /**
   * One level of the area a room is in, laid out whole (mudmaps' areas,
   * 2026-10-26): the room's own level where `level` is null. The map draws
   * the whole of it, so it has no draw distance; the zoom goes out as far as
   * the level fits.
   */
  load(map: number, room: number, level: number | null): Promise<AreaMap | null>;
  /** Rooms by name or `map/room`, for the finder. */
  search(query: string): Promise<WorldRoom[]>;
  /**
   * Where this character is headed, so the map can draw it.
   *
   * Both, because they answer the question in two different shapes: a route
   * is a list of steps and draws as a line along them, and a loop is a list
   * of *places* and draws as marks on the ones the lap still owes. A loop's
   * leg arrives as the walk, so the two are drawn together rather than one
   * replacing the other — the line is this leg and the marks are the rest of
   * the lap.
   *
   * This character's own, like every other prop here: a pinned float draws
   * the route of the character it belongs to, not the one on screen.
   */
  walk: WalkProgress;
  loop: LoopProgress;
  /**
   * The rooms this realm's find log names, marked with a dot.
   *
   * The realm's, not this character's, so a room a second character searched
   * is marked here too — which is the whole reason the log is kept per realm.
   * See `src/shared/finds.ts`.
   */
  finds: readonly Find[];
  /**
   * Open the loop builder. Null on a pinned float, where the builder is the
   * shown character's and a control that opened it for somebody else would
   * plan on the wrong realm — so the action is not drawn at all.
   */
  onBuild: (() => void) | null;
  /**
   * A pointer came to rest on a room, or left it. Passed straight through to
   * the picture, which owns the dwell; what opens and how long it lingers is
   * the window's. Null on a pinned float, for `onBuild`'s reason.
   */
  onPeek: ((room: RoomId, at: SVGGElement, settled: boolean) => void) | null;
  onPeekEnd: (() => void) | null;
}

/**
 * The streets around the character, drawn from the realm data.
 *
 * The data has no coordinates — only which exit leads where — so the layout is
 * derived by walking directions outward from where the character is standing.
 * It is therefore a *projection*, not a floor plan, and the card says how many
 * rooms it could not place rather than drawing a confident picture that is
 * wrong: a MUD is not Euclidean, and two exits can lead to the same place.
 *
 * Looked at through `MapView`, which every map in the client shares: the wheel
 * zooms about the pointer, a drag on the background pans, a pointer at rest
 * on a room opens what the realm knows about it. The legend is the Explorer's
 * Rooms map's alone (2026-10-19). What is this card's is the centre and the
 * zoom, which it keeps as its density setting.
 *
 * **An area at a time, like mudmaps** (2026-10-26): the whole level of the
 * area the eye is in, laid out once for the area (`areaMap`), rather than a
 * radius around the character. **Follow** keeps the eye on the character, on
 * its level, recentring at every step; off, the eye stays where it was taken —
 * a room found, a level up or down, an arrow out of the area followed — while
 * the character walks, and the character is ringed wherever it shows. Taking
 * the eye anywhere turns Follow off; a room's panel walks there either way.
 */
function MapCard({
  character,
  finds,
  load,
  loop,
  onBuild,
  onPeek,
  onPeekEnd,
  search,
  walk,
  ...chrome
}: MapCardProps) {
  /** The level last drawn, with its area: the badge, and the levels above and below. */
  const [shown, setShown] = useState<AreaMap | null>(null);
  /*
   * The rooms alone, memoised on the log: the picture asks per drawn room, and
   * a fresh array every render would reconcile two hundred rooms for a value
   * that did not change.
   */
  const foundRooms = useMemo(() => [...roomsWithFinds(finds)], [finds]);
  const { map: area, number } = character.room;
  const here = area === null || number === null ? null : roomId(area, number);

  /*
   * Follow, held here and written to the card's settings so it outlives a
   * reload: absent is following, the shipped answer, so only *off* is stored.
   */
  const stored = chrome.settings?.value.mapFollow !== false;
  const [following, setFollowing] = useState(stored);
  useEffect(() => setFollowing(stored), [stored]);
  /** Where the eye is while not following: a room, and the level asked for (null is its own). */
  const [eye, setEye] = useState<{ room: RoomId; level: number | null } | null>(null);
  const setFollow = useCallback(
    (on: boolean): void => {
      setFollowing(on);
      if (on) setEye(null);
      chrome.settings?.onChange({ mapFollow: on ? undefined : false });
    },
    [chrome.settings]
  );
  /** Takes the eye to a room, or another level of the area drawn, and stops following. */
  const lookAt = useCallback(
    (room: RoomId, level: number | null): void => {
      setEye({ room, level });
      if (following) setFollow(false);
    },
    [following, setFollow]
  );
  /*
   * Follow turned off where the eye was never taken anywhere — the button
   * pressed from a standing start, or a reload with it stored off — holds the
   * eye where the character is now, or the map went on following it.
   */
  useEffect(() => {
    if (!following && eye === null && here !== null) setEye({ room: here, level: null });
  }, [following, eye, here]);
  const looking = !following && eye !== null;
  const centre = looking ? eye.room : here;
  const level = looking ? eye.level : null;
  const loadLevel = useCallback(
    (map: number, room: number): Promise<LocalMap> =>
      load(map, room, level).then((found) => found ?? EMPTY_MAP),
    [load, level]
  );
  const onLoaded = useCallback((next: LocalMap): void => {
    setShown(next.whole === true ? (next as AreaMap) : null);
  }, []);
  const onGo = useCallback((to: RoomId): void => lookAt(to, null), [lookAt]);

  /* The finder, debounced like the builder's and searching the same index. */
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<WorldRoom[]>([]);
  useEffect(() => {
    if (query.trim().length < tuning().roomSearchMinChars) {
      setMatches([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      void search(query)
        .then((found) => {
          if (live) setMatches(found);
        })
        .catch(() => {
          if (live) setMatches([]);
        });
    }, tuning().roomSearchDebounceMs);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, search]);
  const found = useCallback(
    (room: WorldRoom): void => {
      lookAt(roomId(room.map, room.room), null);
      setQuery('');
      setMatches([]);
      chrome.returnFocus?.();
    },
    [lookAt, chrome]
  );
  const list = useListNavigation<WorldRoom>({
    items: matches,
    onChoose: found,
    onCancel: () => {
      setQuery('');
      setMatches([]);
      chrome.returnFocus?.();
    }
  });
  const { mapRoomPixelsSparse: sparse, mapRoomPixelsDense: dense } = tuning();
  /*
   * How much of the realm to fit on the card, from the gear in its own action
   * column. Read off `chrome.settings` — already this card's settings for
   * *this* character, addressed the way a pinned float's are — rather than
   * taken as a prop, which would be a second route to the same value.
   *
   * It chooses how small a room may be drawn, not the room count: the count
   * is still measured from the laid-out box, so a map dragged twice as big
   * shows more of the realm at every setting.
   */
  const density = chrome.settings?.value.mapDensity ?? DEFAULT_MAP_DENSITY;

  /*
   * The zoom, and the setting are one number read two ways. The wheel moves
   * the zoom at once and writes it into the setting once the hand has
   * stopped (`mapZoomSettleMs`) — a wheel reports a dozen events a second and
   * every write re-lays the workspace out — and the slider moves the setting,
   * which the zoom then follows. A setting that already says what the zoom
   * is, because the zoom just wrote it, moves nothing.
   */
  const [zoom, setZoom] = useState(() => roomPixelsFor(density, sparse, dense));
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const settle = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const write = chrome.settings?.onChange;
  const writeRef = useRef(write);
  writeRef.current = write;

  const flush = useCallback((): void => {
    if (settle.current !== null) {
      window.clearTimeout(settle.current);
      settle.current = null;
    }
    const perRoom = pending.current;
    pending.current = null;
    if (perRoom === null || writeRef.current === undefined) return;
    const at = densityFor(perRoom, sparse, dense);
    // Cleared back to nothing where it agrees with the shipped answer, as the
    // slider does: what is stored is what somebody chose.
    writeRef.current({ mapDensity: at === DEFAULT_MAP_DENSITY ? undefined : at });
  }, [sparse, dense]);
  // A zoom still waiting to be written when the card goes is written then.
  useEffect(() => flush, [flush]);

  const onZoom = useCallback(
    (perRoom: number): void => {
      setZoom(perRoom);
      pending.current = perRoom;
      if (settle.current !== null) window.clearTimeout(settle.current);
      settle.current = window.setTimeout(flush, tuning().mapZoomSettleMs);
    },
    [flush]
  );

  useEffect(() => {
    if (densityFor(zoomRef.current, sparse, dense) === density) return;
    // The slider moved: it outranks a wheel still waiting to be written down.
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = null;
    pending.current = null;
    setZoom(roomPixelsFor(density, sparse, dense));
  }, [density, sparse, dense]);

  /* One element for as long as the reason holds, so the view's memo holds too. */
  const empty = useMemo(
    () => (
      <div className="empty">
        {area === null ? t('cards.map.emptyNoLocation') : t('cards.map.emptyNoWorldData')}
      </div>
    ),
    [area]
  );

  return (
    <BentoCard
      {...chrome}
      actions={
        onBuild === null
          ? undefined
          : [{ id: 'build', label: t('cards.map.buildAction'), icon: 'flag', run: onBuild }]
      }
      badge={<AreaBadge shown={shown} />}
      className="map-card"
      scroll
      title={t('cards.map.title')}
    >
      {/*
       * The picture, always present — including while there is nothing to
       * draw, so the view keeps its measured size across the moment it is
       * told where the character is. Its box is `MapView`'s own, so this card
       * and every other map are one picture.
       *
       * Clicking a room opens what the realm knows about it, and the walk is
       * a button on that panel; it does not walk one, and it does not plan one
       * either. Showing the facts first is the whole reason walking is a
       * separate, deliberate action — a bare map click is the easiest possible
       * way to send a character somewhere by accident.
       */}
      <div className="map-tools">
        <button
          aria-pressed={following}
          className="chip toggle"
          data-level="ok"
          data-on={following ? 'true' : 'false'}
          disabled={here === null}
          onClick={() => setFollow(!following)}
          onMouseDown={keepFocus}
          title={t('cards.map.followTooltip')}
          type="button"
        >
          {t('cards.map.follow')}
        </button>
        <ClearField label={t('cards.map.findAria')} onClear={() => setQuery('')} query={query}>
          <input
            aria-label={t('cards.map.findAria')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={list.onKeyDown}
            placeholder={t('cards.map.findPlaceholder')}
            spellCheck={false}
            value={query}
          />
        </ClearField>
        <LevelKeys onLevel={lookAt} shown={shown} />
      </div>
      {matches.length > 0 && (
        <ul className="route-matches builder-matches" ref={list.listRef}>
          {matches.map((room, index) => (
            <li
              data-active={list.isActive(index) ? 'true' : 'false'}
              key={`${room.map}/${room.room}`}
              onMouseEnter={() => list.point(index)}
            >
              <button
                onClick={() => found(room)}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                <span>{room.name}</span>
                <span className="hint">
                  {room.map}/{room.room}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <MapView
        centre={centre}
        empty={empty}
        finds={foundRooms}
        focus={looking ? 'centre' : 'here'}
        load={loadLevel}
        name="map"
        onGo={onGo}
        onLoaded={onLoaded}
        onPeek={onPeek ?? undefined}
        onPeekEnd={onPeekEnd ?? undefined}
        onZoom={onZoom}
        path={walk.path}
        stops={loop.remainingStops}
        whole
        you={here}
        zoom={zoom}
      />
    </BentoCard>
  );
}

export default memo(MapCard);
