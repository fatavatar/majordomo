import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import {
  Arrow,
  Bar,
  Chevron,
  chevronAt,
  exitArrowAt,
  LairBadge,
  Portal,
  portalAt,
  RoomShape,
  toneOf
} from './MapGlyphs';
import { MapLegend } from './MapPlan';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import {
  DEFAULT_ROOM_MAP_OPTIONS,
  ROOM_MAP_SIZES,
  type ExplorerPlace,
  type ExplorerRoomView,
  type ExplorerSegment,
  type RoomCell,
  type RoomLine,
  type RoomMapOptions,
  type RoomSearch,
  type RoomSearchResult,
  type RoomViewRequest
} from '@shared/explorer';
import type { Direction } from '@shared/world';

/**
 * MMUD Explorer's Rooms tab (2026-10-18): MME's room walker (frmMap) as
 * mudtool draws it (`../mudtool/js/tabs/rooms.js`, `styles/rooms.css`), on
 * the realm's own rooms and the character's: its room marked on the map,
 * *Where am I* to draw the map from it, and *Walk here* to send it there by
 * the route panel the rest of the client walks by.
 *
 * The map is MME's own layout (`buildMap`, worked out in main): a click walks
 * the map to a room, an up-only or down-only cell follows that exit and an
 * up-and-down one asks, shift-click re-centres the grid, and the keypad moves
 * by the compass. A chevron, a portal or an arrow walks the map to the room
 * it leads to, on another level or in another area, as mudmaps' do, and
 * lights that room while hovered where it is on the map. A cell's text is
 * asked as it is hovered.
 *
 * The key under the map is the client's (`MapLegend`), and this is the one
 * map that carries it (2026-10-19).
 *
 * Not here yet: MME's presets, the MegaMUD pathing pane, and
 * textblock trees, whose references read as plain text until they are.
 */
export interface ExplorerRoomsProps {
  /** The room the map is drawn from, `map/room`. */
  at: string;
  /** The character's room, `map/room`; null where it is not placed. */
  here: string | null;
  characterName: string;
  view(request: RoomViewRequest): Promise<ExplorerRoomView>;
  tip(map: number, room: number, options: RoomMapOptions): Promise<string>;
  search(search: RoomSearch): Promise<RoomSearchResult>;
  /** Walk the map to a room, remembered for Back. */
  onWalk(room: string): void;
  /** Open what a reference names, on its tab. */
  follow(place: ExplorerPlace): void;
  /** Send the character to a room, by the route panel. */
  walkTo(room: string): void;
  /** Runs of reference text, links where they lead somewhere. */
  runs(runs: readonly ExplorerSegment[]): ReactNode;
}

/** Where the map's size and options are kept between sessions. */
const KEPT = 'mudengine.explorer.rooms';

interface Kept {
  size: string;
  options: RoomMapOptions;
}

function recall(): Kept {
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as Partial<Kept> | null;
    return {
      size: ROOM_MAP_SIZES.some((s) => s.id === kept?.size) ? kept!.size! : 'main',
      options: { ...DEFAULT_ROOM_MAP_OPTIONS, ...(kept?.options ?? {}) }
    };
  } catch {
    return { size: 'main', options: DEFAULT_ROOM_MAP_OPTIONS };
  }
}

function keep(kept: Kept): void {
  try {
    localStorage.setItem(KEPT, JSON.stringify(kept));
  } catch {
    // A browser that keeps nothing starts from the default next time.
  }
}

/** `map/room` as its two numbers, or null. */
function parse(room: string): { map: number; room: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(room);
  return m === null ? null : { map: Number(m[1]), room: Number(m[2]) };
}

/**
 * The map in the client's own drawing (2026-10-18): MME's layout, a cell a
 * step of `STEP` units, a room `R` across its middle and `PAD` round the
 * edge for the arrows and chevrons of an edge room — mudmaps' and the Map
 * card's sizes, so the two maps read alike.
 */
const STEP = 10;
const R = 3;
const PAD = 9;

/** Each direction as a step across the grid. */
const ALONG: Record<string, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1]
};

/** How far round a mark its click reaches, in units: clear of its room and of the chevron beside it. */
const MARK_HIT = 1.8;

/**
 * A charted cell's ways off the plane, each saying where it leads, at the Map
 * card's places. A click walks the map there, as mudmaps' arrows and
 * chevrons link to the room on the other end (asked for 2026-10-21), and
 * hovering one lights that room where the map holds it.
 */
function Away({
  cell,
  x,
  y,
  onFollow,
  onLight
}: {
  cell: RoomCell;
  x: number;
  y: number;
  onFollow(room: string): void;
  onLight(room: string | null): void;
}) {
  const slots = { up: 0, down: 0, teleport: 0 };
  const mark = (to: string) => ({
    onClick: () => onFollow(to),
    onMouseEnter: () => onLight(to),
    onMouseLeave: () => onLight(null)
  });
  return (
    <>
      {cell.away.map((way, k) => {
        const slot = slots[way.kind]++;
        const at =
          way.kind === 'teleport'
            ? portalAt(x, y, R, slot)
            : chevronAt(x, y, R, way.kind === 'up', slot);
        return (
          <g
            className="map-mark rm-mark"
            data-gated={way.gated ? 'true' : undefined}
            data-reach="jump"
            key={k}
            {...mark(way.to)}
          >
            <title>{way.title}</title>
            <circle className="rm-mark-hit" cx={at.x} cy={at.y} r={MARK_HIT} />
            {way.kind === 'teleport' ? (
              <Portal x={at.x} y={at.y} />
            ) : (
              <Chevron up={way.kind === 'up'} x={at.x} y={at.y} />
            )}
          </g>
        );
      })}
      {cell.arrows.map((arrow, k) => {
        const at = exitArrowAt(x, y, R, arrow.dir as Direction);
        return (
          <g
            className="map-mark rm-mark"
            data-gated={arrow.gated ? 'true' : undefined}
            data-reach={arrow.local ? 'local' : 'away'}
            key={`a${k}`}
            {...mark(arrow.to)}
          >
            <title>{arrow.title}</title>
            <circle className="rm-mark-hit" cx={at.x} cy={at.y} r={MARK_HIT} />
            <Arrow ux={at.ux} uy={at.uy} x={at.x} y={at.y} />
          </g>
        );
      })}
    </>
  );
}

/** The keypad's moves (frmMap's `KeyPress`): the compass, 0 up, `.` down. */
const KEYS: Record<string, string> = {
  '8': 'N',
  '2': 'S',
  '4': 'W',
  '6': 'E',
  '7': 'NW',
  '9': 'NE',
  '1': 'SW',
  '3': 'SE',
  '0': 'U',
  '.': 'D'
};

/** The compass's grid, as frmMap lays out `cmdMove`; null its middle. */
const COMPASS = ['NW', 'N', 'NE', 'W', null, 'E', 'SW', 'S', 'SE'] as const;

/** The map options' boxes, in frmMap's order. */
const OPTION_BOXES: ReadonlyArray<{
  key: Exclude<keyof RoomMapOptions, 'alsoMark'>;
  label: () => string;
}> = [
  { key: 'followMap', label: () => t('explorer.rooms.options.followMap') },
  { key: 'noHidden', label: () => t('explorer.rooms.options.noHidden') },
  { key: 'noLairs', label: () => t('explorer.rooms.options.noLairs') },
  { key: 'noNPC', label: () => t('explorer.rooms.options.noNPC') },
  { key: 'noCMD', label: () => t('explorer.rooms.options.noCMD') },
  { key: 'dupes', label: () => t('explorer.rooms.options.dupes') },
  { key: 'overwrite', label: () => t('explorer.rooms.options.overwrite') },
  { key: 'noRestricted', label: () => t('explorer.rooms.options.noRestricted') }
];

/** A finder's results, or what one said. */
interface Results {
  title: string;
  lines: RoomLine[];
  empty: string;
}

export default function ExplorerRooms({
  at,
  here,
  characterName,
  view,
  tip,
  search,
  onWalk,
  follow,
  walkTo,
  runs
}: ExplorerRoomsProps) {
  const [kept, setKept] = useState<Kept>(recall);
  useEffect(() => keep(kept), [kept]);
  const [center, setCenter] = useState<number | null>(null);
  const [shown, setShown] = useState<ExplorerRoomView | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [findText, setFindText] = useState('');
  const [lastFind, setLastFind] = useState<{ text: string; room: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ x: number; y: number; cell: RoomCell } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const tips = useRef(new Map<string, string>());
  const [goMap, setGoMap] = useState('');
  const [goRoom, setGoRoom] = useState('');

  const target = parse(at);
  useEffect(() => {
    if (target === null) return;
    setGoMap(String(target.map));
    setGoRoom(String(target.room));
    // `target` is `at` read again.
  }, [at]);

  useEffect(() => {
    if (target === null) return;
    let live = true;
    void view({ ...target, size: kept.size, options: kept.options, center }).then((found) => {
      if (!live) return;
      setShown(found);
      setLit(null);
    });
    return () => {
      live = false;
    };
    // `target` is `at` read again; MME keeps a re-centred cell until the size changes.
  }, [at, kept, center, view]);

  // A tooltip is the realm's and the character's, so the options or the room change it.
  useEffect(() => tips.current.clear(), [kept.options, here]);

  const setOption = (change: Partial<RoomMapOptions>): void =>
    setKept((was) => ({ ...was, options: { ...was.options, ...change } }));

  const walkMap = useCallback(
    (room: string | null): void => {
      if (room === null) return;
      setAsking(null);
      onWalk(room);
    },
    [onWalk]
  );

  // The keypad walks the compass, as frmMap's does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const into = event.target as HTMLElement | null;
      if (into && /^(INPUT|TEXTAREA|SELECT)$/.test(into.tagName)) return;
      const dir = KEYS[event.key];
      const exit = dir === undefined ? undefined : shown?.compass.find((e) => e.dir === dir);
      if (exit?.target == null) return;
      event.preventDefault();
      walkMap(exit.target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, walkMap]);

  const findNext = (): void => {
    const text = findText.trim();
    if (text === '') return;
    const after = lastFind?.text === text ? lastFind.room : null;
    void search({ find: text, after }).then((found) => {
      if (found.room == null) {
        setLastFind(null);
        setSaid(t('explorer.rooms.notFound'));
        return;
      }
      setSaid(null);
      setLastFind({ text, room: found.room });
      walkMap(found.room);
    });
  };
  const listRooms = (): void => {
    const text = findText.trim();
    if (text === '') return;
    void search({ list: text }).then((found) =>
      setResults({
        title: found.capped
          ? t('explorer.rooms.listedCapped', { text })
          : t('explorer.rooms.listed', { text }),
        lines: found.lines ?? [],
        empty: t('explorer.rooms.notFound')
      })
    );
  };
  const leadsHere = (room: string): void => {
    void search({ leads: room }).then((found) =>
      setResults({
        title: t('explorer.rooms.leadsHereTitle', { room }),
        lines: found.lines ?? [],
        empty: t('explorer.rooms.nothing')
      })
    );
  };

  const onHover = (cell: RoomCell | null, x: number, y: number): void => {
    if (cell === null) {
      setHover(null);
      return;
    }
    const key = `${cell.map}/${cell.room}`;
    const known = tips.current.get(key);
    if (known !== undefined) {
      setHover({ x, y, text: known });
      return;
    }
    setHover({ x, y, text: key });
    void tip(cell.map, cell.room, kept.options).then((text) => {
      tips.current.set(key, text);
      setHover((was) => (was !== null && was.text === key ? { x: was.x, y: was.y, text } : was));
    });
  };

  const grid = shown?.grid ?? null;
  const width = grid === null ? 0 : PAD * 2 + (grid.cols - 1) * STEP;
  const height = grid === null ? 0 : PAD * 2 + (grid.rows - 1) * STEP;
  const pos = (i: number): [number, number] =>
    grid === null ? [0, 0] : [PAD + (i % grid.cols) * STEP, PAD + Math.floor(i / grid.cols) * STEP];
  const atRoom = shown === null || !shown.found ? null : `${shown.map}/${shown.room}`;
  const standing = here !== null && atRoom === here;

  return (
    <div className="rm">
      <div className="ex-toolbar rm-bar">
        <form
          className="rm-goto"
          onSubmit={(event) => {
            event.preventDefault();
            const map = Math.min(32767, Number(goMap) || 0);
            const room = Math.min(32767, Number(goRoom) || 0);
            if (map > 0 && room > 0) walkMap(`${map}/${room}`);
          }}
        >
          <span className="ex-field-label">{t('explorer.rooms.mapRoom')}</span>
          <input
            aria-label={t('explorer.rooms.map')}
            className="rm-num"
            inputMode="numeric"
            onChange={(event) => setGoMap(event.target.value)}
            value={goMap}
          />
          <input
            aria-label={t('explorer.rooms.room')}
            className="rm-num"
            inputMode="numeric"
            onChange={(event) => setGoRoom(event.target.value)}
            value={goRoom}
          />
          <button className="ex-btn" type="submit">
            {t('explorer.rooms.go')}
          </button>
        </form>
        <button
          className="ex-btn"
          disabled={here === null}
          onClick={() => here !== null && walkMap(here)}
          onMouseDown={keepFocus}
          title={t('explorer.rooms.whereAmITitle', { characterName })}
          type="button"
        >
          {t('explorer.rooms.whereAmI')}
        </button>
        <form
          className="rm-find"
          onSubmit={(event) => {
            event.preventDefault();
            findNext();
          }}
        >
          <input
            aria-label={t('explorer.rooms.findLabel')}
            className="ex-search"
            onChange={(event) => setFindText(event.target.value)}
            placeholder={t('explorer.rooms.findLabel')}
            spellCheck={false}
            value={findText}
          />
          <button className="ex-btn" title={t('explorer.rooms.nextTitle')} type="submit">
            {t('explorer.rooms.next')}
          </button>
          <button className="ex-btn" onClick={listRooms} onMouseDown={keepFocus} type="button">
            {t('explorer.rooms.list')}
          </button>
        </form>
        <select
          aria-label={t('explorer.rooms.size')}
          onChange={(event) => {
            setCenter(null);
            setKept((was) => ({ ...was, size: event.target.value }));
          }}
          title={t('explorer.rooms.size')}
          value={kept.size}
        >
          {ROOM_MAP_SIZES.map((size) => (
            <option key={size.id} value={size.id}>
              {size.label}
            </option>
          ))}
        </select>
        <details className="rm-options">
          <summary className="ex-btn">{t('explorer.rooms.optionsButton')}</summary>
          <div className="rm-options-menu">
            {OPTION_BOXES.map((box) => (
              <label className="ex-check" key={box.key}>
                <input
                  checked={kept.options[box.key]}
                  onChange={(event) => setOption({ [box.key]: event.target.checked })}
                  type="checkbox"
                />
                {box.label()}
              </label>
            ))}
            <label className="ex-field">
              <span className="ex-field-label">{t('explorer.rooms.options.alsoMark')}</span>
              <select
                onChange={(event) => setOption({ alsoMark: Number(event.target.value) })}
                value={String(kept.options.alsoMark)}
              >
                <option value="0">{t('explorer.rooms.options.markNothing')}</option>
                <option value="1">{t('explorer.rooms.options.markShops')}</option>
                <option value="2">{t('explorer.rooms.options.markSpells')}</option>
              </select>
            </label>
          </div>
        </details>
        {said !== null && <span className="rm-said">{said}</span>}
      </div>

      <div className="rm-body">
        <div className="rm-map">
          {shown === null ? (
            <div className="ex-empty">{t('explorer.loading')}</div>
          ) : !shown.supported ? (
            <div className="ex-empty">{shown.reason || t('explorer.unsupported')}</div>
          ) : !shown.found || grid === null ? (
            <div className="ex-empty">{t('explorer.rooms.missing', { room: at })}</div>
          ) : (
            <svg
              className="rm-svg"
              onMouseLeave={() => setHover(null)}
              preserveAspectRatio="xMidYMid meet"
              viewBox={`0 0 ${width} ${height}`}
            >
              {/* Corridors first, so a room always sits on top of its own links. */}
              <g className="map-links">
                {grid.cells.map((cell, i) => {
                  if (cell === null) return null;
                  const [x, y] = pos(i);
                  return cell.links.map((link, k) => {
                    const [dx, dy] = ALONG[link.dir] ?? [0, 0];
                    return (
                      <line
                        data-kind={link.tone}
                        key={`${i}:${k}`}
                        x1={x}
                        x2={x + dx * STEP}
                        y1={y}
                        y2={y + dy * STEP}
                      >
                        {link.title !== undefined && <title>{link.title}</title>}
                      </line>
                    );
                  });
                })}
              </g>
              <g className="map-blocks">
                {grid.cells.map((cell, i) => {
                  if (cell === null) return null;
                  const [x, y] = pos(i);
                  return cell.links.map((link, k) => {
                    if (link.tone === undefined) return null;
                    const [dx, dy] = ALONG[link.dir] ?? [0, 0];
                    return (
                      <Bar
                        key={`${i}:${k}`}
                        tone={toneOf(link.tone)}
                        x1={x}
                        x2={x + dx * STEP}
                        y1={y}
                        y2={y + dy * STEP}
                      />
                    );
                  });
                })}
              </g>
              <g>
                {grid.cells.map((cell, i) => {
                  if (cell === null) return null;
                  const [x, y] = pos(i);
                  const key = `${cell.map}/${cell.room}`;
                  const isHere = key === here;
                  return (
                    <g
                      className={
                        'map-room rm-cell-hit' +
                        (i === grid.center ? ' is-start' : '') +
                        (key === lit ? ' is-lit' : '')
                      }
                      data-here={isHere ? 'true' : undefined}
                      data-kind={cell.kind}
                      key={i}
                      onClick={(event) => {
                        if (event.shiftKey) {
                          setCenter(i);
                          return;
                        }
                        if (cell.upDown !== undefined) {
                          setAsking({ x: event.clientX, y: event.clientY, cell });
                          return;
                        }
                        walkMap(cell.target);
                      }}
                      onMouseMove={(event) => onHover(cell, event.clientX, event.clientY)}
                    >
                      {isHere && (
                        <circle className="map-you" cx={x} cy={y} r={R + 2.2} strokeWidth={0.8} />
                      )}
                      {i === grid.center && !isHere && (
                        <circle className="rm-start" cx={x} cy={y} r={R + 1.8} strokeWidth={0.6} />
                      )}
                      <RoomShape kind={cell.kind} letter={cell.letter} r={R} x={x} y={y} />
                      {cell.lairBadge === true && <LairBadge r={R} x={x} y={y} />}
                    </g>
                  );
                })}
              </g>
              <g className="map-marks">
                {grid.cells.map((cell, i) => {
                  if (cell === null) return null;
                  const [x, y] = pos(i);
                  return (
                    <Away cell={cell} key={i} onFollow={walkMap} onLight={setLit} x={x} y={y} />
                  );
                })}
              </g>
            </svg>
          )}
          <MapLegend />
        </div>

        <aside className="rm-side">
          {shown?.found === true && (
            <section className="rm-sec rm-here-sec">
              <div className="rm-here-head">
                <h2 className="ex-name">{shown.name}</h2>
                <span className="ex-sub">{atRoom}</span>
              </div>
              <div className="rm-compass">
                {COMPASS.map((dir, i) => {
                  if (dir === null)
                    return (
                      <span className="rm-dir rm-mid" key={i}>
                        ·
                      </span>
                    );
                  return (
                    <Dir
                      exit={shown.compass.find((e) => e.dir === dir)}
                      key={dir}
                      onWalk={walkMap}
                    />
                  );
                })}
                <div className="rm-ud">
                  <Dir exit={shown.compass.find((e) => e.dir === 'U')} onWalk={walkMap} />
                  <Dir exit={shown.compass.find((e) => e.dir === 'D')} onWalk={walkMap} />
                </div>
              </div>
              <div className="rm-actions">
                <button
                  className="ex-btn rm-walk"
                  disabled={atRoom === null || standing}
                  onClick={() => atRoom !== null && walkTo(atRoom)}
                  onMouseDown={keepFocus}
                  title={t('explorer.rooms.walkHereTitle', { characterName })}
                  type="button"
                >
                  {standing
                    ? t('explorer.rooms.standingHere', { characterName })
                    : t('explorer.rooms.walkHere')}
                </button>
                <button
                  className="ex-btn"
                  onClick={() => atRoom !== null && leadsHere(atRoom)}
                  onMouseDown={keepFocus}
                  type="button"
                >
                  {t('explorer.rooms.leadsHere')}
                </button>
              </div>
            </section>
          )}

          {results !== null && (
            <section className="rm-sec">
              <div className="rm-sec-head">
                <h3 className="ex-heading">{results.title}</h3>
                <button
                  aria-label={t('explorer.close')}
                  className="ex-btn rm-x"
                  onClick={() => setResults(null)}
                  onMouseDown={keepFocus}
                  type="button"
                >
                  ×
                </button>
              </div>
              <Lines empty={results.empty} follow={follow} lines={results.lines} runs={runs} />
            </section>
          )}

          {shown?.found === true && (
            <section className="rm-sec">
              <h3 className="ex-heading">
                {t('explorer.rooms.refsTitle', { name: shown.name, room: atRoom ?? '' })}
              </h3>
              <Lines
                empty={t('explorer.rooms.nothingHere')}
                follow={follow}
                lines={shown.refs}
                runs={runs}
              />
              <pre className="rm-info">{shown.info}</pre>
            </section>
          )}
        </aside>
      </div>

      {hover !== null && (
        <div className="rm-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.text}
        </div>
      )}
      {asking !== null && (
        <div
          className="rm-menu"
          onMouseLeave={() => setAsking(null)}
          style={{ left: asking.x, top: asking.y }}
        >
          <button
            className="ex-btn"
            disabled={asking.cell.upDown?.up == null}
            onClick={() => walkMap(asking.cell.upDown?.up ?? null)}
            type="button"
          >
            {t('explorer.rooms.goUp')}
          </button>
          <button
            className="ex-btn"
            disabled={asking.cell.upDown?.down == null}
            onClick={() => walkMap(asking.cell.upDown?.down ?? null)}
            type="button"
          >
            {t('explorer.rooms.goDown')}
          </button>
          <button className="ex-btn" onClick={() => walkMap(asking.cell.target)} type="button">
            {t('explorer.rooms.thisRoom')}
          </button>
        </div>
      )}
    </div>
  );
}

/** One of the compass's ways out: a button where it leads somewhere, greyed where not. */
function Dir({
  exit,
  onWalk
}: {
  exit: ExplorerRoomView['compass'][number] | undefined;
  onWalk(room: string): void;
}) {
  const label = (exit?.dir ?? '').toLowerCase();
  if (exit === undefined || exit.target === null)
    return (
      <span className="rm-dir is-off" title={exit?.title || undefined}>
        {label}
      </span>
    );
  return (
    <button
      className={'rm-dir' + (exit.mapChange ? ' is-mapchange' : '')}
      onClick={() => onWalk(exit.target!)}
      onMouseDown={keepFocus}
      title={exit.title}
      type="button"
    >
      {label}
    </button>
  );
}

/** A list of reference lines: a line that leads somewhere opens it, and its own links open theirs. */
function Lines({
  lines,
  empty,
  follow,
  runs
}: {
  lines: readonly RoomLine[];
  empty: string;
  follow(place: ExplorerPlace): void;
  runs(runs: readonly ExplorerSegment[]): ReactNode;
}) {
  if (lines.length === 0) return <div className="ex-empty rm-none">{empty}</div>;
  return (
    <ul className="rm-refs">
      {lines.map((line, i) => {
        const linked = line.text.some((run) => 'kind' in run && run.tab !== null);
        return (
          <li key={i}>
            {line.place !== null && !linked ? (
              <button
                className="ex-link"
                onClick={() => follow(line.place!)}
                onMouseDown={keepFocus}
                type="button"
              >
                {line.text.map((run) => run.text).join('')}
              </button>
            ) : (
              runs(line.text)
            )}
          </li>
        );
      })}
    </ul>
  );
}
