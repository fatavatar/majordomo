/**
 * Building a loop or a route by clicking rooms on the map.
 *
 * A loop in this client is a list of places (`src/shared/loops.ts`), and
 * until this card the only ways to write one were a YAML file and the shipped
 * shelf. MegaMUD's own answer is a recorder — walk it once and every step is
 * written down — which is the shape that goes stale silently. This is the
 * other shape: click the rooms, the same planner a walk uses joins them, and
 * what is saved is the fewest waypoints whose routes reproduce the way. The
 * way is drawn whole so the reader sees what will be walked; the list below
 * says which rooms are the waypoints and what each leg needs.
 *
 * Four decisions worth stating:
 *
 * - **A click is a pick, and the picks are the whole state.** Undo and redo
 *   step through the list of picks (`lib/history`), never through the plan,
 *   which is re-asked of main on every change — so the plan can never be
 *   older than the picks it was planned from, and `loopFor` refuses to save
 *   one that is.
 * - **The map follows the last pick.** Each pick recentres the picture on
 *   itself, because building a loop is walking it with the pointer, and the
 *   room you just chose is where the next one is chosen from. The finder
 *   moves the picture without picking anything: finding a room and choosing
 *   it are two acts, and a search that picked would send the loop somewhere
 *   on the strength of a name shared by thirteen rooms.
 * - **Up and down are a way of looking, not a pick.** The plane cannot show
 *   the level above, so the chevrons beside a room take the eye there — the
 *   picture recentres on the room the stairs land in and nothing is picked —
 *   and clicking a room on that level is what routes to it, by whatever way
 *   the planner finds. Taking the way up as a pick was tried first and read
 *   as *nothing happened*: the map jumped a level and no line could be drawn
 *   for a step the plane cannot hold. A **teleport is a pick**, as the
 *   request stated — taking it adds the portal's room and the room it lands
 *   in, so the leg is that step and nothing else.
 * - **The picture is a window** (`MapView`, the one map every surface draws):
 *   the wheel zooms about the pointer between the density slider's two ends, a
 *   drag on the background pans, a pointer at rest on a room opens what the
 *   realm knows about it, and what is fetched is what the window can see. The
 *   builder opens at the densest end, as asked.
 *
 * The quick view is the builder's only because it is *every* map's (todo
 * 2026-09-14): a lair is what makes a room worth putting in a loop, and this
 * was the one map that would not say what was in one. The **same** panel, with
 * the same *Plan route* on it — what the builder decides is what a **click**
 * means, and nothing else. A panel identical everywhere but for its one
 * control is two panels.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AreaBadge, LevelKeys } from './AreaControls';
import BentoCard, { type CardChrome } from './BentoCard';
import ClearField from './ClearField';
import Icon from './Icon';
import { type BuilderMarks } from './MapPlan';
import MapView from './MapView';
import { useListNavigation } from '../hooks/useListNavigation';
import {
  commandsText,
  keptRooms,
  loopFor,
  notableSteps,
  pickRoom,
  shapeOf,
  stopParts,
  suggestedName,
  withCommands,
  type StopExtras
} from '../lib/builder';
import { keepFocus } from '../lib/focus';
import {
  begin,
  canRedo,
  canUndo,
  historyIntent,
  record,
  redo,
  targetOf,
  undo,
  type History
} from '../lib/history';
import { t } from '../lib/i18n';
import { tuning } from '../lib/tuning';
import type { CharacterState } from '@shared/character';
import { LOOP_LIMITS } from '@shared/drafts';
import { roomsWithFinds, type Find } from '@shared/finds';
import type { Loop, LoopAddress, LoopScope } from '@shared/loops';
import { EMPTY_MAP, type AreaMap, type LocalMap, type MapAway } from '@shared/map';
import { errorMessage } from '@shared/values';
import {
  describeBlock,
  EMPTY_LOOP_DRAFT,
  roomId,
  type LoopDraft,
  type RoomId,
  type RouteStep,
  type WorldRoom
} from '@shared/world';

/**
 * Where a built loop may be filed: the character, its realm, or everybody.
 *
 * All three, unlike the Loops modal, which withholds `global` because a shelf
 * loop tried once should not be filed onto every character in passing. A
 * route somebody drew by hand is the opposite case — a deliberate act with a
 * name typed into it — and the request asked for the three outright.
 */
export type BuilderDestination = LoopScope;

/**
 * A loop handed to the builder ready-drawn — the Hunting card's *Create loop*
 * (todo 00, 2026-09-13): the stops as picks, closed on the first, and the
 * name offered. `stamp` tells one request from the next, so the same rooms
 * asked for twice are drawn twice; the picks then belong to the card, and
 * every edit, undo and save is the builder's own.
 */
export interface BuilderSeed {
  picks: RoomId[];
  name: string;
  stamp: number;
  /**
   * A saved loop opened to be edited (2026-10-23): what its stops carry, its
   * preference, and where it is filed, which a save replaces.
   */
  edit?: { extras: StopExtras; prefer: boolean; at: LoopAddress };
}

export interface LoopBuilderCardProps extends CardChrome {
  character: CharacterState;
  /** The character's own name, for the destination chip. */
  characterName: string;
  /** The realm it plays on, for the other chip; empty when unknown, and the chip is then not drawn. */
  realmName: string;
  search(query: string): Promise<WorldRoom[]>;
  /**
   * One level of the area a room is in, laid out whole — the Map card's own
   * (2026-10-26), so a lap is drawn over all of the area rather than what a
   * radius reaches. The room's own level where `level` is null.
   */
  loadArea(map: number, room: number, level: number | null): Promise<AreaMap | null>;
  /**
   * The rooms this realm's find log names, marked with a dot — the Map card's
   * own prop, taken in the same shape and drawn for the reason it is drawn
   * there: where searching has turned something up is a fact about the realm,
   * not about the surface it is drawn on.
   */
  finds: readonly Find[];
  /**
   * A pointer came to rest on a room, or left it. Passed straight through to
   * the picture, exactly as the Map card passes it, and it is the Map card's
   * own handler — one panel, drawn the same wherever a map is.
   */
  onPeek: ((room: RoomId, at: SVGGElement, settled: boolean) => void) | null;
  onPeekEnd: (() => void) | null;
  /** The picks planned, `keep` staying waypoints whatever the way. */
  draft(rooms: RoomId[], keep: RoomId[]): Promise<LoopDraft>;
  /**
   * Files the loop, in place of `replaces` where it is an edit. Resolves to
   * why it could not, or to where it was filed.
   */
  save(
    loop: Loop,
    destination: BuilderDestination,
    replaces: LoopAddress | null
  ): Promise<string | LoopAddress>;
  /** A loop to open on, drawn; null opens empty. */
  seed?: BuilderSeed | null;
}

function LoopBuilderCard({
  character,
  characterName,
  realmName,
  finds,
  onPeek,
  onPeekEnd,
  search,
  loadArea,
  draft,
  save,
  seed = null,
  ...chrome
}: LoopBuilderCardProps) {
  /* The rooms alone, memoised on the log, exactly as the Map card takes it. */
  const foundRooms = useMemo(() => [...roomsWithFinds(finds)], [finds]);
  const [history, setHistory] = useState<History<RoomId[]>>(() => begin([]));
  const picks = history.present;
  /** Where the eye is: a room, and the level of its area asked for (null is the room's own). */
  const [eye, setEye] = useState<{ room: RoomId; level: number | null } | null>(null);
  const centre = eye?.room ?? null;
  const setCentre = useCallback((room: RoomId): void => setEye({ room, level: null }), []);
  const atLevel = useCallback((room: RoomId, level: number): void => setEye({ room, level }), []);
  /* The densest end of the Map card's slider, which is where the builder opens. */
  const [zoom, setZoom] = useState(() => tuning().mapRoomPixelsDense);
  /** The level last drawn, with its area: the badge, and the levels above and below. */
  const [shown, setShown] = useState<AreaMap | null>(null);
  const level = eye?.level ?? null;
  const loadLevel = useCallback(
    (map: number, room: number): Promise<LocalMap> =>
      loadArea(map, room, level).then((found) => found ?? EMPTY_MAP),
    [loadArea, level]
  );
  const onLoaded = useCallback((next: LocalMap): void => {
    setShown(next.whole === true ? (next as AreaMap) : null);
  }, []);
  const [plan, setPlan] = useState<LoopDraft>(EMPTY_LOOP_DRAFT);
  const [planFailed, setPlanFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<WorldRoom[]>([]);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [destination, setDestination] = useState<BuilderDestination>('profile');
  /*
   * Whether routes this character plans afterwards *follow* what is saved —
   * every step along it priced at a fraction of an ordinary one, so the
   * planner takes this way wherever it can instead of the shortest. On by
   * default, because that is what saving a way somebody drew is for, and a
   * toggle rather than a rule, because a standing change to how a character
   * navigates is the player's to make and to see: the chip says it beside
   * the save, in those words — *prefer its corridors* was the first wording,
   * and the person it was written for could not say what it did.
   */
  const [prefer, setPrefer] = useState(true);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  /*
   * What the stops carry besides their rooms (2026-10-23), by room: the
   * commands typed there, as the fields under the waypoints say them, and
   * the field's own text while it is typed, so a `;` typed before the next
   * command is not read away under the caret.
   */
  const [extras, setExtras] = useState<StopExtras>({});
  const [typed, setTyped] = useState<Readonly<Record<RoomId, string>>>({});
  /** The saved loop being edited, which a save replaces; null for a new one. */
  const [editing, setEditing] = useState<LoopAddress | null>(null);
  const finder = useRef<HTMLInputElement>(null);

  const { map: area, number } = character.room;
  const here = area === null || number === null ? null : roomId(area, number);

  /*
   * The picture opens on the character, and only opens there: once the
   * reader has taken it somewhere the character walking must not drag it
   * back, or a loop being built three maps away would snap home on every
   * step of a lap.
   */
  useEffect(() => {
    if (centre === null && here !== null) setCentre(here);
  }, [centre, here]);

  /*
   * A seed replaces the picks and the name outright and moves the picture to
   * its first room — as one history step, so a second thought can take the
   * whole loop back the way it takes any other edit back.
   */
  useEffect(() => {
    if (seed === null) return;
    setHistory(begin([...seed.picks]));
    setTypedName(seed.name);
    setExtras(seed.edit?.extras ?? {});
    setTyped({});
    setEditing(seed.edit?.at ?? null);
    if (seed.edit !== undefined) {
      setPrefer(seed.edit.prefer);
      setDestination(seed.edit.at.scope);
    }
    const first = seed.picks[0];
    if (first !== undefined) setCentre(first);
    setStatus(null);
  }, [seed]);

  /*
   * The plan follows the picks, and a late answer is dropped: two clicks in
   * quick succession are two asks, and the first answer arriving second
   * would draw the shorter way under the longer list.
   */
  const keptKey = keptRooms(extras).join(',');
  useEffect(() => {
    let live = true;
    setPlanFailed(null);
    void draft([...picks], keptKey === '' ? [] : (keptKey.split(',') as RoomId[]))
      .then((next) => {
        if (live) setPlan(next);
      })
      .catch((error) => {
        if (!live) return;
        setPlan(EMPTY_LOOP_DRAFT);
        setPlanFailed(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, [draft, picks, keptKey]);

  /* The finder, debounced like the route panel's and searching the same index. */
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

  /** Moves the picture to a found room. It picks nothing — see the header. */
  const centreOn = useCallback(
    (room: WorldRoom): void => {
      setCentre(roomId(room.map, room.room));
      setQuery('');
      setMatches([]);
      chrome.returnFocus?.();
    },
    [chrome]
  );

  const list = useListNavigation<WorldRoom>({
    items: matches,
    onChoose: centreOn,
    onCancel: () => {
      setQuery('');
      setMatches([]);
      chrome.returnFocus?.();
    }
  });

  /** Commits a new list of picks, moving the picture to the last of them. */
  const commit = useCallback((next: RoomId[]): void => {
    setHistory((current) => record(current, next, samePicks));
    const last = next[next.length - 1];
    if (last !== undefined) setCentre(last);
    setStatus(null);
  }, []);

  /*
   * The ceiling a loop payload has, refused here where the click is, with the
   * number — rather than on the far side of the bridge, where all main can
   * say is that the list was not one.
   */
  const full = useCallback((): boolean => {
    if (picks.length < LOOP_LIMITS.stops) return false;
    setStatus({ text: t('cards.builder.tooManyPicks', { max: LOOP_LIMITS.stops }), failed: true });
    return true;
  }, [picks]);

  const choose = useCallback(
    (mapNumber: number, room: number): void => {
      const next = pickRoom(picks, roomId(mapNumber, room));
      if (next === null) return;
      if (next.length > picks.length && full()) return;
      commit(next);
    },
    [commit, full, picks]
  );

  /*
   * A way out that leaves the plane. Up or down takes the eye there and
   * picks nothing — the header says why — and says so under the foot, so the
   * level changing under the pointer is not read as the picture breaking. A
   * teleport is a pick: the room it leaves from is picked first if it is not
   * the last pick already, so the leg planned is exactly that step —
   * otherwise the planner would route to the landing room from wherever the
   * last pick was, by whatever way it liked.
   */
  const takeAway = useCallback(
    (away: MapAway, from: RoomId): void => {
      if (away.kind !== 'teleport') {
        setCentre(away.to);
        setStatus({
          text:
            away.kind === 'up'
              ? t('cards.builder.lookingUp', { roomName: away.name })
              : t('cards.builder.lookingDown', { roomName: away.name }),
          failed: false
        });
        return;
      }
      if (full()) return;
      const viaFrom = picks[picks.length - 1] === from ? picks : (pickRoom(picks, from) ?? picks);
      const next = pickRoom(viaFrom, away.to);
      commit(next ?? viaFrom);
    },
    [commit, full, picks]
  );

  /*
   * Back to the start with nothing else picked, as one step of history: the
   * whole way can be taken back by a second thought, and a start-over that
   * undo could not reach would be the one edit on the card that is final.
   */
  const startOver = useCallback((): void => {
    const start = picks[0];
    if (start === undefined || picks.length < 2) return;
    commit([start]);
    // Starting over is a new loop: saving it no longer replaces the one opened.
    setEditing(null);
  }, [commit, picks]);

  const stepBack = useCallback((): void => {
    setHistory((current) => {
      const next = undo(current);
      const last = next.present[next.present.length - 1];
      if (last !== undefined) setCentre(last);
      return next;
    });
    setStatus(null);
  }, []);
  const stepForward = useCallback((): void => {
    setHistory((current) => {
      const next = redo(current);
      const last = next.present[next.present.length - 1];
      if (last !== undefined) setCentre(last);
      return next;
    });
    setStatus(null);
  }, []);

  /*
   * The chords, while the card is on screen. In capture like `useHotkeys`,
   * so they work with the caret in the console — where they would otherwise
   * be a control character for the realm, which is why they are claimed only
   * while a builder is open. `historyIntent` declines inside a text field,
   * where the chord is the field's own undo; the console's hidden textarea is
   * not one of those, and is told apart the way `useHotkeys` tells it.
   */
  const stepping = canUndo(history) || canRedo(history);
  useEffect(() => {
    // A builder with nothing to step through takes nothing from the game: a
    // card docked on the rail for the evening must not hold the chord for it.
    if (!stepping) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const inConsole = target instanceof HTMLElement && target.closest('.terminal-cell') !== null;
      const intent = historyIntent(event, inConsole ? null : targetOf(target));
      if (intent === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (intent === 'undo') stepBack();
      else stepForward();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [stepBack, stepForward, stepping]);

  const shape = shapeOf(picks);
  /* One element for as long as the reason holds, so the view's memo holds too. */
  const empty = useMemo(
    () => (
      <div className="empty">
        {centre === null ? t('cards.map.emptyNoLocation') : t('cards.map.emptyNoWorldData')}
      </div>
    ),
    [centre]
  );
  const marks = useMemo<BuilderMarks>(
    () => ({
      start: picks[0] ?? null,
      picks: new Set(picks),
      through: new Set(plan.path)
    }),
    [picks, plan.path]
  );

  const offered = suggestedName(
    plan,
    picks,
    (from, to) => t('cards.builder.routeName', { from, to }),
    (place) => t('cards.builder.loopName', { place })
  );
  const name = typedName ?? offered;
  const loop = loopFor(plan, picks, name, prefer, extras);
  const blocked = plan.legs.find((leg) => leg.route.blocked);

  /** Whether a waypoint row is a loop's close, the start again. */
  const closes = (index: number): boolean =>
    shape === 'loop' && index > 0 && index === plan.waypoints.length - 1;
  /** The commands field's text for a room, or null where it has none open. */
  const commandsAt = (room: RoomId): string | null =>
    typed[room] ?? (extras[room]?.commands ? commandsText(extras[room]?.commands) : null);
  const typeCommands = (room: RoomId, text: string): void => {
    setTyped((current) => ({ ...current, [room]: text }));
    setExtras((current) => withCommands(current, room, text));
    setStatus(null);
  };

  /* The legs between consecutive waypoints, read off the planned steps. */
  const legs = useMemo(() => legsBetweenWaypoints(plan), [plan]);

  const file = (): void => {
    if (loop === null) return;
    const where =
      destination === 'server'
        ? t('loops.destination.realm', { name: realmName })
        : destination === 'global'
          ? t('cards.builder.destinationGlobal')
          : t('loops.destination.character', { name: characterName });
    void save(loop, destination, editing)
      .then((filed) => {
        if (typeof filed === 'string') {
          setStatus({ text: filed, failed: true });
          return;
        }
        // Saved again, it is this one that is replaced.
        if (editing !== null) setEditing(filed);
        setStatus({ text: t('cards.builder.saved', { name: loop.name, where }), failed: false });
      })
      .catch((error) => setStatus({ text: errorMessage(error), failed: true }));
  };

  const badge = <AreaBadge shown={shown} />;

  return (
    <BentoCard
      {...chrome}
      badge={badge}
      className="loop-builder-card"
      copyText={() =>
        [
          t('cards.builder.title'),
          ...plan.waypoints.map((stop, index) => `${index + 1}. ${stop.name} ${stop.id}`)
        ].join('\n')
      }
      paned
      title={t('cards.builder.title')}
    >
      <div className="builder-tools">
        <ClearField label={t('cards.builder.findAria')} onClear={() => setQuery('')} query={query}>
          <input
            aria-label={t('cards.builder.findAria')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={list.onKeyDown}
            placeholder={t('cards.builder.findPlaceholder')}
            ref={finder}
            spellCheck={false}
            value={query}
          />
        </ClearField>
        <button
          aria-label={t('cards.builder.centreHereAria', { name: characterName })}
          className="quiet builder-key"
          disabled={here === null}
          onClick={() => {
            if (here !== null) setCentre(here);
          }}
          onMouseDown={keepFocus}
          title={t('cards.builder.centreHereAria', { name: characterName })}
          type="button"
        >
          <Icon name="crosshair" />
        </button>
        <LevelKeys onLevel={atLevel} shown={shown} />
        <button
          aria-label={t('cards.builder.undo')}
          className="quiet builder-key"
          disabled={!canUndo(history)}
          onClick={stepBack}
          onMouseDown={keepFocus}
          title={t('cards.builder.undo')}
          type="button"
        >
          <Icon name="undo" />
        </button>
        <button
          aria-label={t('cards.builder.redo')}
          className="quiet builder-key"
          disabled={!canRedo(history)}
          onClick={stepForward}
          onMouseDown={keepFocus}
          title={t('cards.builder.redo')}
          type="button"
        >
          <Icon name="redo" />
        </button>
        <button
          aria-label={t('cards.builder.startOver')}
          className="quiet builder-key"
          disabled={picks.length < 2}
          onClick={startOver}
          onMouseDown={keepFocus}
          title={t('cards.builder.startOver')}
          type="button"
        >
          <Icon name="reset" />
        </button>
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
                onClick={() => centreOn(room)}
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

      {/* The picture: the shared window, with the builder's own marks and
          controls on it, and its own legend under it. `onChoose` is what makes
          a click here a pick rather than the settle every other map's click
          is — see `MapPlanProps.onChoose`. */}
      <div className="builder-map">
        <MapView
          centre={centre}
          empty={empty}
          finds={foundRooms}
          focus="centre"
          load={loadLevel}
          marks={marks}
          name="builder"
          onAway={takeAway}
          onChoose={choose}
          onGo={setCentre}
          onLoaded={onLoaded}
          onPeek={onPeek ?? undefined}
          onPeekEnd={onPeekEnd ?? undefined}
          onZoom={setZoom}
          path={plan.path}
          whole
          you={here}
          zoom={zoom}
        />
      </div>

      <div className="scroller builder-list">
        {shape === 'empty' ? (
          <div className="empty">{t('cards.builder.emptyHint')}</div>
        ) : (
          <ol className="builder-waypoints">
            {plan.waypoints.map((stop, index) => {
              const leg = legs[index - 1];
              return (
                <li key={`${stop.id}-${index}`}>
                  {leg !== undefined && (
                    <div className="builder-leg">
                      <span className="quiet">
                        {leg.length === 1
                          ? t('cards.builder.legSteps.one', { count: leg.length })
                          : t('cards.builder.legSteps.many', { count: leg.length })}
                      </span>
                      {notableSteps(leg).map(({ at, step }) => (
                        <span className="builder-note" key={at}>
                          <span className="quiet">{t('cards.builder.stepAt', { at })}</span>
                          <span className="step-command">{step.command}</span>
                          {step.requirement && (
                            <span
                              className={
                                step.requirement.kind === 'trap' ? 'chip bad' : 'chip warn'
                              }
                              title={step.obstacle?.detail ?? step.requirement.raw}
                            >
                              {step.obstacle?.label ?? step.requirement.kind}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="builder-waypoint" data-kind={index === 0 ? 'start' : 'waypoint'}>
                    <span className="builder-index">{index + 1}</span>
                    <span className="step-name" title={stop.name}>
                      {stop.name}
                    </span>
                    <span className="chip off">
                      {stopParts({ room: `${stop.name} ${stop.id}` }).at}
                    </span>
                    {/* The closing row is the start again, whose commands are its own row's. */}
                    {!closes(index) && commandsAt(stop.id) === null && (
                      <button
                        aria-label={t('cards.builder.addCommandsAria', { roomName: stop.name })}
                        className="quiet builder-key"
                        onClick={() => setTyped((current) => ({ ...current, [stop.id]: '' }))}
                        title={t('cards.builder.addCommandsTitle')}
                        type="button"
                      >
                        <Icon name="terminal" />
                      </button>
                    )}
                  </div>
                  {!closes(index) && commandsAt(stop.id) !== null && (
                    <input
                      aria-label={t('cards.builder.commandsAria', { roomName: stop.name })}
                      autoFocus={typed[stop.id] === ''}
                      className="builder-commands"
                      onChange={(event) => typeCommands(stop.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          chrome.returnFocus?.();
                        }
                      }}
                      placeholder={t('cards.builder.commandsPlaceholder')}
                      spellCheck={false}
                      title={t('cards.builder.commandsTitle')}
                      value={commandsAt(stop.id) ?? ''}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {shape === 'start' && (
          <div className="quiet builder-hint">{t('cards.builder.startHint')}</div>
        )}
        {blocked !== undefined && (
          <div className="route-refused">
            {t('cards.builder.blocked', {
              reason:
                (blocked.route.blocks ?? []).length > 0
                  ? blocked.route.blocks!.map(describeBlock).join('; ')
                  : (blocked.route.reason ?? t('cards.route.noRouteFallback'))
            })}
          </div>
        )}
        {planFailed !== null && <div className="route-refused">{planFailed}</div>}
      </div>

      <div className="builder-foot">
        {editing !== null && (
          <div className="builder-editing">
            <span>{t('cards.builder.editing', { name: editing.name })}</span>
            <button
              aria-label={t('cards.builder.editingDetach')}
              className="quiet builder-key"
              onClick={() => setEditing(null)}
              onMouseDown={keepFocus}
              title={t('cards.builder.editingDetach')}
              type="button"
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <input
          aria-label={t('cards.builder.nameAria')}
          onChange={(event) => setTypedName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              chrome.returnFocus?.();
            }
            if (event.key === 'Enter' && loop !== null) {
              event.preventDefault();
              file();
            }
          }}
          placeholder={t('cards.builder.namePlaceholder')}
          spellCheck={false}
          value={name}
        />
        <div aria-label={t('loops.destinationLabel')} className="builder-destination" role="group">
          <button
            aria-pressed={destination === 'profile'}
            className="chip toggle"
            data-level="ok"
            data-on={destination === 'profile' ? 'true' : 'false'}
            onClick={() => setDestination('profile')}
            onMouseDown={keepFocus}
            type="button"
          >
            {t('loops.destination.character', { name: characterName })}
          </button>
          {realmName.length > 0 && (
            <button
              aria-pressed={destination === 'server'}
              className="chip toggle"
              data-level="ok"
              data-on={destination === 'server' ? 'true' : 'false'}
              onClick={() => setDestination('server')}
              onMouseDown={keepFocus}
              type="button"
            >
              {t('loops.destination.realm', { name: realmName })}
            </button>
          )}
          <button
            aria-pressed={destination === 'global'}
            className="chip toggle"
            data-level="ok"
            data-on={destination === 'global' ? 'true' : 'false'}
            onClick={() => setDestination('global')}
            onMouseDown={keepFocus}
            type="button"
          >
            {t('cards.builder.destinationGlobal')}
          </button>
        </div>
        <button
          aria-pressed={prefer}
          className="chip toggle"
          data-level="ok"
          data-on={prefer ? 'true' : 'false'}
          onClick={() => setPrefer((current) => !current)}
          onMouseDown={keepFocus}
          title={t('cards.builder.preferTitle')}
          type="button"
        >
          {t('cards.builder.preferToggle')}
        </button>
        {/* One filled control: the save. Its word is the shape's — a way that
            ends where it began is a loop, anything else is a route. */}
        <button
          className="primary"
          data-shape={shape}
          disabled={loop === null}
          onClick={file}
          onMouseDown={keepFocus}
          type="button"
        >
          {shape === 'loop' ? t('cards.builder.saveLoop') : t('cards.builder.saveRoute')}
        </button>
        {/* What the save means, in one line, because a route and a loop are
            filed into the same directory and only the file says which. */}
        {loop !== null && status === null && (
          <div className="builder-status">
            {shape === 'loop' ? t('cards.builder.loopHint') : t('cards.builder.routeHint')}{' '}
            {prefer ? t('cards.builder.preferHint') : t('cards.builder.plainHint')}
          </div>
        )}
        {status !== null && (
          <div className={status.failed ? 'route-refused builder-status' : 'builder-status'}>
            {status.text}
          </div>
        )}
      </div>
    </BentoCard>
  );
}

const samePicks = (a: readonly RoomId[], b: readonly RoomId[]): boolean =>
  a.length === b.length && a.every((id, at) => id === b[at]);

/**
 * The planned steps, cut at each waypoint.
 *
 * The plan's legs are per *pick* and the waypoints are fewer, so the steps
 * are walked once in order and a leg ends where a waypoint is reached. A
 * room a loop passes twice — its start, at the close — is handled by
 * position rather than by id: each waypoint after the first takes the steps
 * up to its next arrival.
 */
function legsBetweenWaypoints(plan: LoopDraft): RouteStep[][] {
  const steps = plan.legs.flatMap((leg) => leg.route.steps);
  const out: RouteStep[][] = [];
  let cursor = 0;
  for (let index = 1; index < plan.waypoints.length; index += 1) {
    const target = plan.waypoints[index]!.id;
    const leg: RouteStep[] = [];
    while (cursor < steps.length) {
      const step = steps[cursor]!;
      leg.push(step);
      cursor += 1;
      if (step.to === target) break;
    }
    out.push(leg);
  }
  return out;
}

export default memo(LoopBuilderCard);
