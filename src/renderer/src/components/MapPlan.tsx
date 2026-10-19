/**
 * The map itself, drawn — without the card around it.
 *
 * It was the whole of `MapCard` until the route panel needed the same picture
 * of somewhere *else*: a destination's neighbourhood, from the destination's
 * own point of view, beside the plan for getting there. Two SVGs drawing the
 * same realm data in two files is two pictures that come to disagree about
 * what a door looks like, so the drawing moved here and both surfaces call it.
 *
 * What stayed in the card is what is *about* a card: the fetch keyed on where
 * the character is standing, the folded-rooms badge and the empty state — and
 * since the map became something to pan and zoom, those live in `MapView`,
 * which both cards share.
 *
 * One way of looking at the picture: the SVG shows exactly what a box of that
 * size can hold at that zoom, centred where the eye was taken. It is always a
 * window, because `MapView` is the only thing that draws this and every
 * surface draws it through `MapView`. Given no `viewport` it used to *fit*
 * instead — the whole neighbourhood scaled into the box, which is what the
 * route panel's strip did until 2026-09-14. Two ways of looking at one
 * picture is two pictures, and the one that fitted was also the one that
 * never learnt to pan.
 *
 * Drawn as vector shapes. It was character cells first, on the argument that
 * the game draws its own maps that way — but this map is not the game's. It is
 * derived by the client and never crosses the wire, so the character-cell rule
 * that governs the console does not reach it. It is chrome, and chrome follows
 * the design language.
 */
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';

import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { viewBoxFor, type Box, type MapView } from '../lib/mapView';
import {
  layoutMap,
  NO_TRAIL,
  trailOf,
  type LocalMap,
  type MapAway,
  type MapDrawing,
  type MapNode,
  type MapTrail
} from '@shared/map';
import type { RoomId } from '@shared/world';
import { tuning } from '../lib/tuning';
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

/**
 * What is drawn *on* a room, and how far past the room's own radius each one
 * reaches — its offset, and the stroke it is drawn with, because a stroke
 * straddles the path it follows and half of it lies outside.
 *
 * One table, so that two marks at the same radius cannot be written as two
 * different numbers: the `you` ring is `radius + 2.2` with an 0.8 stroke, and
 * the lap's stop ring must sit exactly on it or the two read as rings of
 * different kinds. It was also read by the fitted viewBox's padding, which
 * was a separately-written `radius + 2` and so drew every ring on a room at
 * the edge of the neighbourhood *outside* the box — sheared off flat by the
 * card's heading. The window pads nothing and clips at its own edge, which is
 * what a window is, but the numbers stay in one place.
 *
 * The room shapes themselves are not in here because they cannot be the
 * constraining ones: the widest is the lair's diamond at `radius + 0.6` with
 * an 0.5 stroke — `radius + 0.85`, a third of the rings' reach. Anything added
 * that reaches further than a ring belongs in this table.
 */
const MARKS = {
  /** The route's halo. Filled, no stroke, so it reaches exactly its radius. */
  onroute: { over: 1.6, stroke: 0 },
  /** A stop this lap still owes, dashed. */
  stop: { over: 2.2, stroke: 0.8 },
  /** Which room is mine — the one deliberately loud element on the surface. */
  you: { over: 2.2, stroke: 0.8 },
  /** The builder's start: the red ring the request asked for. */
  start: { over: 2.2, stroke: 0.8 },
  /** A room the builder was clicked on. */
  pick: { over: 1.6, stroke: 0.8 },
  /** A room the builder's way runs through without having been clicked. */
  through: { over: 1.6, stroke: 0.5 }
} as const;

/**
 * The find dot's radius, in the same units the room's own radius is in.
 *
 * Not in `MARKS`: everything there is measured *over the room's radius*, and
 * this one sits on the corner rather than around the room, so it reaches no
 * further than the room already does.
 */
const FIND_DOT = 1.1;

/**
 * How far out the off-plane controls sit, past the room's radius, the size of
 * their glyph, the stroke they wear and the hit target round each — `MARKS`'
 * shape, kept apart because they are drawn only for a builder.
 */
const AWAY = { over: 2.4, size: 1.5, stroke: 0.6, hit: 1.2 } as const;

/**
 * The shape a room is drawn as.
 *
 * Shape carries the meaning and colour reinforces it, never the other way
 * round: §6 of the design language forbids stating a condition by hue alone,
 * and a map read at a glance in a fight is exactly where that matters. The
 * legend names all four.
 *
 * **Every one of them carries `map-shape`, and that class is load-bearing.**
 * The room's fill and edge used to be stated as `.map-room > circle` — *any*
 * child of the kind — which is a rule about position rather than about what
 * the element is, and a room's group holds marks that are not its shape: the
 * `you` ring, the route halo, the lap's ring. At `(0,1,1)` it outranked each
 * of their own single-class rules at `(0,1,0)`, so all three were painted the
 * room's grey and the shop's amber instead of their own colours — the `you`
 * ring drew as a filled grey disc behind the accent square for as long as the
 * map has existed, and the two marks added for the route inherited it whole.
 * Naming the shape is what lets a rule mean *the shape* and no longer catch
 * whatever else the group happens to hold.
 */
/**
 * A small arrowhead at the middle of a leg, pointing the way it is walked.
 *
 * Returned as `points` for a polygon in the map's own coordinate space, so it
 * zooms with everything else rather than staying one size while the rooms grow
 * — the map is a window on a drawing and a fixed-size mark on it would be a
 * pixel constant in the layout path, which no part of this client is allowed.
 *
 * Sized off the room's radius for the same reason, and deliberately small: it
 * says which way, and the line says where. At a third of a room it reads at the
 * sparse end and disappears politely into the stroke at the dense one, which is
 * the right way round — a lap drawn at ten pixels a room is being read for its
 * shape, not its direction.
 *
 * The midpoint, not the end: an arrowhead at the end of a leg lands on the room
 * marker and fights with it, and every leg's end is another leg's start.
 */
function arrowAt(leg: { x1: number; y1: number; x2: number; y2: number }): string {
  const size = tuning().mapRoomRadius / 1.5;
  const dx = leg.x2 - leg.x1;
  const dy = leg.y2 - leg.y1;
  const length = Math.hypot(dx, dy);
  // A corridor of no length has no direction to state. Zero would divide to
  // NaN and put `points="NaN,NaN …"` in the DOM, which paints nothing and
  // reports nothing.
  if (length === 0) return '';
  const ux = dx / length;
  const uy = dy / length;
  const mx = (leg.x1 + leg.x2) / 2;
  const my = (leg.y1 + leg.y2) / 2;
  // The tip, and two barbs behind it at right angles to the way it points.
  const tipX = mx + ux * size;
  const tipY = my + uy * size;
  const backX = mx - ux * size * 0.35;
  const backY = my - uy * size * 0.35;
  const wing = size * 0.62;
  return [
    `${round(tipX)},${round(tipY)}`,
    `${round(backX - uy * wing)},${round(backY + ux * wing)}`,
    `${round(backX + uy * wing)},${round(backY - ux * wing)}`
  ].join(' ');
}

/** Two decimals is under a thousandth of a room and keeps the DOM readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function shape(node: MapNode) {
  const r = tuning().mapRoomRadius;
  return (
    <>
      <RoomShape kind={node.kind} letter={node.letter} r={r} x={node.x} y={node.y} />
      {node.lairBadge === true && <LairBadge r={r} x={node.x} y={node.y} />}
    </>
  );
}

export interface MapPlanProps {
  map: LocalMap;
  /**
   * What the picture shows: the zoom and pan the eye is at, and the box it is
   * being drawn in. Required, because this is always a window — `MapView`
   * measures the box and holds the view, and nothing else draws this.
   */
  viewport: { view: MapView; box: Box };
  /**
   * What the loud ring is marking, in words.
   *
   * The ring itself is always on the map's centre — `localMap` lays the
   * neighbourhood out from one room and that room is `here` — so this changes
   * only what the picture is *called*. The card centres on the character and
   * says "you"; the route panel centres on the destination and must not, or
   * the one deliberately loud element on screen would be claiming the
   * character is somewhere it is not.
   */
  focus?: 'here' | 'destination' | 'centre';
  /**
   * The room the character is standing in, to ring as *you* when the centre
   * is something else — the builder's map is centred on wherever the reader
   * has taken it, and the character is wherever it is. Only drawn where the
   * map shows that room; absent, the centre wears the ring per `focus`.
   */
  you?: RoomId | null;
  /**
   * What a **click** on a room does, where the click is the surface's own: the
   * loop builder's pick. It outranks `onPeek`, which the click otherwise
   * settles — one of the two owns the click and the caller says which by
   * handing this in.
   *
   * Absent where there is nothing for a click to do beyond settling the panel,
   * which is every surface but the builder. A room with neither is drawn as a
   * picture rather than a control, per the rule that a control bound to
   * nowhere is worse than none.
   */
  onChoose?: (map: number, room: number) => void;
  /**
   * The loop builder's own marks: the start in red, every room clicked in
   * green, and every room the planned way runs through in a thinner green.
   * The way itself arrives as `path` and draws as the ordinary trail.
   */
  marks?: BuilderMarks;
  /**
   * Take a way out that leaves the plane — up, down, or a teleport — from a
   * room. Present only on the builder's map, and only then are the ways
   * drawn as controls beside the room, in place of the chevrons the room
   * wears everywhere else: two glyphs saying *up* five units apart, one a
   * mark and one a control, was the map the reader could not tell apart.
   * Everywhere else the chevrons stay a mark, because a control bound to
   * nowhere is worse than none.
   */
  onAway?: (away: MapAway, from: RoomId) => void;
  /**
   * The rooms the walk in progress has still to travel through, opening with
   * the one the character is standing in — `WalkProgress.path`.
   *
   * Drawn over the corridors it walks along, and *only* over corridors this
   * map already draws: a route runs through rooms the projection may have
   * folded away, and a straight line between two placed-but-unjoined rooms
   * would invent a passage. Empty while nothing is being walked.
   */
  path?: readonly RoomId[];
  /**
   * The loop stops this lap has still to reach — `LoopProgress.remainingStops`.
   *
   * Marks rather than a line, because a loop is a list of *places*: the legs
   * between them are planned when they are walked, so the only honest line is
   * the one being walked now, which arrives here as `path`.
   */
  stops?: readonly RoomId[];
  /**
   * A pointer came to rest on a room, or left it: open the room's quick view
   * beside it, and let the caller's linger start.
   *
   * Every map offers it — the card, the route panel's picture of where a
   * route ends, and the builder's chooser — because *what is in that lair* is
   * a question about the room and not about the surface it was drawn on.
   *
   * The dwell itself is here, on the room, because that is where the pointer
   * is; what the panel *is* and how long it lingers afterwards belong to the
   * caller, which owns the one-panel-at-a-time rule. Absent where there is
   * nothing to open — a pinned float has no realm of its own to ask.
   */
  onPeek?: (room: RoomId, at: SVGGElement, settled: boolean) => void;
  onPeekEnd?: () => void;
  /**
   * The rooms this realm's find log names — where searching has turned
   * something up.
   *
   * A **mark**, not a kind: `RoomKind` is a closed, priority-ordered union and
   * one shape per room, so folding this into it would fight lairs and shops for
   * the shape and only ever show on a plain room — while "there is something
   * hidden here" is exactly the fact you want beside a lair. Drawn as a dot on
   * the corner instead, over whatever the room already is.
   *
   * A dot rather than a bolder room or a flashing one: a bold room says
   * something about the *room*, and this is a note attached to it; and nothing
   * on this surface animates, which is a rule the console holds and the chrome
   * around it keeps.
   */
  finds?: readonly RoomId[];
}

export interface BuilderMarks {
  start: RoomId | null;
  picks: ReadonlySet<RoomId>;
  through: ReadonlySet<RoomId>;
}

const NO_ROOMS: readonly RoomId[] = [];
const ORIGIN = { x: 0, y: 0 } as const;

function MapPlan({
  map,
  viewport,
  focus = 'here',
  you = null,
  onChoose,
  marks,
  onAway,
  onPeek,
  onPeekEnd,
  path = NO_ROOMS,
  stops = NO_ROOMS,
  finds = NO_ROOMS
}: MapPlanProps) {
  /*
   * Laid out once per neighbourhood, not once per render: a pan re-renders
   * this for a new viewBox a dozen times a second, and the drawing under it
   * has not changed. The picture below is memoised on the same values, so
   * what a pan actually costs is one attribute on one element.
   */
  const drawing = useMemo(() => layoutMap(map), [map]);
  const centre = useMemo(() => drawing.nodes.find((node) => node.here), [drawing]);
  /*
   * Where the character is going, over the map of where it is.
   *
   * Skipped outright when there is nothing planned, so a client standing
   * still pays nothing for a feature it is not using — and `NO_TRAIL` is a
   * constant, so the empty case is the same value on every render.
   */
  const trail = useMemo(
    () =>
      path.length === 0 && stops.length === 0
        ? NO_TRAIL
        : trailOf(drawing, path, stops, tuning().mapTrailBands),
    [drawing, path, stops]
  );

  /*
   * A `Set`, built once per change of the log rather than per drawn room: the
   * question is asked for every cell on the map and the log grows all session,
   * which is the `O(N²)` the standards name.
   */
  const found = useMemo(() => new Set(finds), [finds]);

  /*
   * The viewBox: the window, stated in map units about the centre room. The
   * box clips at its own edge, so nothing is padded for the rings — what
   * falls outside the window is outside the window, which is what a window is.
   */
  const shown = viewBoxFor(viewport.view, viewport.box, centre ?? ORIGIN);
  const viewBox = `${shown.x} ${shown.y} ${shown.width} ${shown.height}`;

  return (
    <svg
      aria-label={
        focus === 'destination'
          ? t('cards.map.svgAriaLabelDestination', {
              roomCount: map.cells.length,
              roomName: centre?.name ?? t('cards.map.destinationFallback')
            })
          : t('cards.map.svgAriaLabel', {
              roomCount: map.cells.length,
              roomName:
                centre?.name ??
                (focus === 'centre' ? t('cards.map.centreFallback') : t('cards.map.hereFallback'))
            })
      }
      className="map-plan"
      role="img"
      viewBox={viewBox}
    >
      <Picture
        drawing={drawing}
        focus={focus}
        marks={marks}
        onAway={onAway}
        found={found}
        onChoose={onChoose}
        onPeek={onPeek}
        onPeekEnd={onPeekEnd}
        trail={trail}
        you={you}
      />
    </svg>
  );
}

/**
 * Everything inside the SVG, memoised apart from the viewBox around it, so
 * that panning and zooming — which change only where the window is — never
 * reconcile two hundred rooms and their corridors.
 */
const Picture = memo(function Picture({
  drawing,
  focus,
  found,
  marks,
  onAway,
  onChoose,
  onPeek,
  onPeekEnd,
  trail,
  you
}: {
  drawing: MapDrawing;
  focus: 'here' | 'destination' | 'centre';
  /** Rooms the realm's find log names. A `Set`, asked once per drawn room. */
  found: ReadonlySet<RoomId>;
  marks: BuilderMarks | undefined;
  onAway: ((away: MapAway, from: RoomId) => void) | undefined;
  onChoose: ((map: number, room: number) => void) | undefined;
  onPeek: ((room: RoomId, at: SVGGElement, settled: boolean) => void) | undefined;
  onPeekEnd: (() => void) | undefined;
  trail: MapTrail;
  you: RoomId | null;
}) {
  /*
   * The one dwell timer, owned here rather than per room: only one pointer is
   * ever on the picture, so a second room entered has to cancel the first
   * room's countdown rather than run a second one beside it.
   */
  const dwell = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(dwell.current), []);
  return (
    <>
      {/* Corridors first, so a room always sits on top of its own links. */}
      <g className="map-links">
        {drawing.links.map((link, index) => (
          <line
            data-kind={link.obstacle?.kind}
            key={index}
            x1={link.x1}
            x2={link.x2}
            y1={link.y1}
            y2={link.y2}
          >
            {link.obstacle && <title>{link.obstacle.detail}</title>}
          </line>
        ))}
      </g>

      {/*
       * The way ahead, drawn along the corridors it walks.
       *
       * Over the corridors and under the obstacle bars, deliberately: a
       * route through a shut door has to keep looking wrong at the step that
       * will not work, and a line painted over the bar would hide exactly the
       * thing the player needs to see before walking into it.
       */}
      {/*
        `data-band` rather than a stroke chosen here: colour lives in
        `tokens.css`, so what this says is *which pass* the leg belongs to and
        the stylesheet says what that looks like — which is also what lets a
        theme repaint it.

        The arrow is drawn per leg and points the way it is walked, which is
        the whole reason `MapTrailLeg` is oriented by travel rather than by the
        link's own ends. `marker-mid` and friends are deliberately not used: a
        marker inherits the stroke rather than the band's colour without a
        marker element per band, and four of those to avoid one polygon is the
        wrong trade.
      */}
      <g className="map-trail">
        {trail.legs.map((leg, index) => (
          <g data-band={leg.band} key={index}>
            <line x1={leg.x1} x2={leg.x2} y1={leg.y1} y2={leg.y2} />
            <polygon className="map-trail-arrow" points={arrowAt(leg)} />
          </g>
        ))}
      </g>

      {/*
       * What stands in the way, drawn on the corridor rather than on
       * either room: the rooms on both sides of a door are ordinary, and
       * a route that will not work needs to look wrong at the step that
       * will not work.
       */}
      {/*
        The whole corridor is the hover target, not the two-pixel bar
        across it. A mark small enough to read at this scale is far too
        small to point at.
      */}
      <g className="map-reach">
        {drawing.links
          .filter((link) => link.obstacle)
          .map((link, index) => (
            <line key={index} x1={link.x1} x2={link.x2} y1={link.y1} y2={link.y2}>
              <title>{link.obstacle!.detail}</title>
            </line>
          ))}
      </g>

      {/*
       * The bar in the tone of what stands there (mudmaps' `REQ_TONE`), a
       * trap's the hazard triangle: a trap is not shut, the route walks
       * through it and takes the hit, so it is its own shape and not a bar
       * in another hue (§6).
       */}
      <g className="map-blocks">
        {drawing.links
          .filter((link) => link.obstacle)
          .map((link, index) => (
            <g data-kind={link.obstacle!.kind} key={index}>
              <title>{link.obstacle!.detail}</title>
              <Bar
                tone={toneOf(link.obstacle!.kind)}
                x1={link.x1}
                x2={link.x2}
                y1={link.y1}
                y2={link.y2}
              />
            </g>
          ))}
      </g>

      {drawing.nodes.map((node) => {
        const pick = onChoose;
        const peekHere = onPeek;
        /*
         * What a click on a room does, and the two are ranked rather than
         * exclusive: **a surface that gave the click a meaning of its own
         * keeps it, and everywhere else the click settles the quick view.**
         *
         * The builder is the one surface with its own: a click there is a
         * pick, and the panel that opened on the hover goes on lingering
         * beside it. Everywhere else the room's facts are read before the way
         * there is planned, and the walk is a button on the panel rather than
         * one mis-click away.
         *
         * Settled, not hovered: a click nails the panel down, so it survives
         * the pointer leaving on its way to the button.
         */
        const choose =
          pick !== undefined
            ? (): void => {
                const [mapId, roomId] = node.id.split('/');
                pick(Number(mapId), Number(roomId));
              }
            : peekHere !== undefined
              ? (at: SVGGElement): void => peekHere(node.id, at, true)
              : undefined;
        /*
         * A room is a control only where there is somewhere to send the click.
         * Absent a handler it is drawn as a picture, per the standing rule that
         * a control bound to nowhere is worse than none — and `role="button"`
         * on an element that does nothing announces one to a screen reader.
         */
        const control = choose
          ? {
              onClick: (event: ReactMouseEvent<SVGGElement>): void => choose(event.currentTarget),
              onMouseDown: keepFocus,
              onKeyDown: (event: KeyboardEvent<SVGGElement>): void => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                choose(event.currentTarget);
              },
              role: 'button',
              tabIndex: 0
            }
          : {};
        /*
         * A pointer resting on a room opens its quick view; leaving it starts
         * the caller's linger. The dwell is here rather than in the caller
         * because it is a property of *this* pointer on *this* room — sweeping
         * across a map is a dozen rooms a second, and one panel per room
         * crossed is two hundred queries for one question.
         *
         * `onPointerEnter`, not `onPointerOver`: a room is a group of shapes
         * and `over` fires again for every child crossed inside it, which
         * would restart the dwell at each and mean a slow hand never opened
         * anything. Cleared on the way out and when the element goes.
         */
        const peek =
          onPeek === undefined
            ? {}
            : {
                onPointerEnter: (event: ReactPointerEvent<SVGGElement>): void => {
                  const at = event.currentTarget;
                  window.clearTimeout(dwell.current);
                  dwell.current = window.setTimeout(
                    () => onPeek(node.id, at, false),
                    tuning().roomPeekDelayMs
                  );
                },
                onPointerLeave: (): void => {
                  window.clearTimeout(dwell.current);
                  onPeekEnd?.();
                }
              };
        return (
          /*
           * **No `<title>`.** It read *Route to {name}* — written when a room's
           * bare click planned a route, and a claim no click makes on any map
           * now: the card's settles the quick view, the builder's is a pick.
           * The room's own name was not the fix either, because a native
           * tooltip and the quick view both open on a rest and the panel is
           * the better answer to the same question, so the browser's would be
           * a second, smaller one drawn over it.
           *
           * The name survives as the control's accessible name, which is all
           * `<title>` was doing for assistive technology. Realm data, so no
           * dictionary key: `aria-label` takes the room's own spelling.
           */
          <g
            aria-label={choose === undefined ? undefined : node.name}
            className="map-room"
            data-here={node.here ? 'true' : undefined}
            data-kind={node.kind}
            data-room={node.id}
            key={node.id}
            {...control}
            {...peek}
          >
            {/*
             * A room the route still has to enter. Behind the shape rather
             * than instead of it: what a room *is* — a lair, a shop, a way
             * down — is the reason to look at the map while walking through
             * it, so the route says "through here" around the room's own
             * mark instead of painting over it.
             */}
            {/* Not under the builder's own rings: the halo sits at the same
                radius as the pick ring, and a disc behind a ring is a ring
                nobody can tell from the next one. */}
            {marks === undefined && trail.rooms.has(node.id) && (
              <circle
                className="map-onroute"
                cx={node.x}
                cy={node.y}
                r={tuning().mapRoomRadius + MARKS.onroute.over}
                strokeWidth={MARKS.onroute.stroke}
              />
            )}
            {/*
             * A place this lap still owes. Not drawn on the room the
             * character is standing in, however: the loud ring below already
             * says it is there, and two rings on one room is one ring too
             * many for a map read at a glance.
             */}
            {/*
             * Something has been found here by searching. On the corner rather
             * than around the room, so it never has to compete with the route
             * halo, a lap's stop ring or the loud ring on the room the
             * character is standing in — all of which are about *now*, where
             * this is about what the realm has been hiding.
             */}
            {found.has(node.id) && (
              <circle
                className="map-find"
                cx={node.x + tuning().mapRoomRadius}
                cy={node.y - tuning().mapRoomRadius}
                r={FIND_DOT}
              />
            )}
            {trail.stops.has(node.id) && !node.here && (
              <circle
                className="map-stop"
                cx={node.x}
                cy={node.y}
                r={tuning().mapRoomRadius + MARKS.stop.over}
                strokeWidth={MARKS.stop.stroke}
              />
            )}
            {/*
             * The builder's rings, under the shape for the route halo's
             * reason: what a room *is* stays readable through them. The
             * start is the loud one — the red ring the request asked for —
             * a pick is a heavier green ring than a room merely walked
             * through, so the two kinds of green say which rooms were chosen
             * and which the planner filled in.
             */}
            {marks !== undefined && marks.start === node.id && (
              <circle
                className="map-start"
                cx={node.x}
                cy={node.y}
                r={tuning().mapRoomRadius + MARKS.start.over}
                strokeWidth={MARKS.start.stroke}
              />
            )}
            {marks !== undefined && marks.start !== node.id && marks.picks.has(node.id) && (
              <circle
                className="map-pick"
                cx={node.x}
                cy={node.y}
                r={tuning().mapRoomRadius + MARKS.pick.over}
                strokeWidth={MARKS.pick.stroke}
              />
            )}
            {marks !== undefined &&
              marks.start !== node.id &&
              !marks.picks.has(node.id) &&
              marks.through.has(node.id) && (
                <circle
                  className="map-through"
                  cx={node.x}
                  cy={node.y}
                  r={tuning().mapRoomRadius + MARKS.through.over}
                  strokeWidth={MARKS.through.stroke}
                />
              )}
            {/* The one deliberately loud element on the surface, spent on the
              only question it is asked under pressure: which one is me — or, in
              the route panel, which one am I being sent to. On a map centred
              on wherever the reader took it, the centre claims nothing and the
              ring goes on the character's own room, if it is in view. */}
            {(focus === 'centre' ? you === node.id : node.here) && (
              <circle
                className="map-you"
                cx={node.x}
                cy={node.y}
                r={tuning().mapRoomRadius + MARKS.you.over}
                strokeWidth={MARKS.you.stroke}
              />
            )}
            {shape(node)}
          </g>
        );
      })}

      {/*
       * The ways out the plane cannot draw, beside each room (mudmaps,
       * 2026-10-18): up and down as chevrons at the right shoulder, a room
       * command that moves you a portal off the left, and an exit a straight
       * corridor would draw wrong an arrow the way it goes. Each says where
       * it leads. On a builder's map the first two are controls, below.
       */}
      <g className="map-marks">
        {drawing.nodes.flatMap((node) => [
          ...(onAway === undefined ? awayMarks(node) : []),
          ...(node.arrows ?? []).map((arrow) => {
            const at = exitArrowAt(node.x, node.y, tuning().mapRoomRadius, arrow.direction);
            const where = arrow.local
              ? t('cards.map.arrowLocal', { direction: arrow.direction })
              : t('cards.map.arrowAway', { direction: arrow.direction });
            return (
              <g
                className="map-mark"
                data-gated={arrow.obstacle === undefined ? undefined : 'true'}
                data-reach={arrow.local ? 'local' : 'away'}
                key={`${node.id}>${arrow.direction}`}
              >
                <title>
                  {arrow.obstacle === undefined ? where : `${where} — ${arrow.obstacle.detail}`}
                </title>
                <Arrow ux={at.ux} uy={at.uy} x={at.x} y={at.y} />
              </g>
            );
          })
        ])}
      </g>

      {/*
       * The ways out that leave the plane, as controls, beside the rooms that
       * have them — only where there is something to send the click to. Each
       * one names where it goes, because *up* is not an answer and *up to
       * Rocky Ledge* is. Drawn after every room so a control is never under
       * a neighbour's shape.
       */}
      {onAway !== undefined &&
        drawing.nodes.flatMap((node) =>
          (node.away ?? []).map((away, index) => (
            <AwayControl
              away={away}
              index={index}
              key={`${node.id}:${away.kind}:${away.to}`}
              node={node}
              onAway={onAway}
            />
          ))
        )}
    </>
  );
});

/**
 * A room's ways off the plane as marks, on a map that does not take them:
 * its chevrons and portals, each saying where it goes, and a room the realm
 * gives only a direction for still wearing its chevron.
 */
function awayMarks(node: MapNode): ReactNode[] {
  const r = tuning().mapRoomRadius;
  const slots = { up: 0, down: 0, teleport: 0 };
  const marks = (node.away ?? []).map((away) => {
    const slot = slots[away.kind]++;
    const at =
      away.kind === 'teleport'
        ? portalAt(node.x, node.y, r, slot)
        : chevronAt(node.x, node.y, r, away.kind === 'up', slot);
    const where =
      away.kind === 'up'
        ? t('cards.map.away.up', { roomName: away.name })
        : away.kind === 'down'
          ? t('cards.map.away.down', { roomName: away.name })
          : t('cards.map.away.teleport', { command: away.command, roomName: away.name });
    return (
      <g
        className="map-mark"
        data-gated={away.obstacle === undefined ? undefined : 'true'}
        data-reach="jump"
        key={`${node.id}:${away.kind}:${away.to}`}
      >
        <title>{away.obstacle === undefined ? where : `${where} — ${away.obstacle.detail}`}</title>
        {away.kind === 'teleport' ? (
          <Portal x={at.x} y={at.y} />
        ) : (
          <Chevron up={away.kind === 'up'} x={at.x} y={at.y} />
        )}
      </g>
    );
  });
  // A way up or down the realm names no room for: its chevron, saying nothing more.
  for (const up of [true, false]) {
    const kind = up ? 'up' : 'down';
    if (slots[kind] > 0) continue;
    if (node.vertical !== 'both' && node.vertical !== kind) continue;
    const at = chevronAt(node.x, node.y, r, up);
    marks.push(
      <g className="map-mark" data-reach="jump" key={`${node.id}:${kind}`}>
        <Chevron up={up} x={at.x} y={at.y} />
      </g>
    );
  }
  return marks;
}

/**
 * One way out of a room that the plane cannot draw, as a control.
 *
 * Up sits above the room's right shoulder, down below it, a teleport off its
 * left — fixed places, so two rooms side by side with a way up each read the
 * same way. The glyphs are the chevrons the room wears on every other map and
 * a ring-with-a-dot for a teleport, which is the mark the legend keys. A
 * press keeps the caret in the game like every other click on a map.
 *
 * What a press *does* is the builder's to say: the chevrons take the eye to
 * the level they lead to, the teleport adds itself to the way. The title
 * says which, because a control that looks like its neighbour and does
 * something else has to say so before it is pressed.
 */
function AwayControl({
  away,
  index,
  node,
  onAway
}: {
  away: MapAway;
  index: number;
  node: MapNode;
  onAway: (away: MapAway, from: RoomId) => void;
}) {
  const r = tuning().mapRoomRadius;
  // Where the same way sits as a mark on every other map: the controls are the marks, pressable.
  const { x, y } =
    away.kind === 'teleport'
      ? portalAt(node.x, node.y, r, index)
      : chevronAt(node.x, node.y, r, away.kind === 'up', index);
  const where =
    away.kind === 'up'
      ? t('cards.map.away.up', { roomName: away.name })
      : away.kind === 'down'
        ? t('cards.map.away.down', { roomName: away.name })
        : t('cards.map.away.teleport', { command: away.command, roomName: away.name });
  // The price the realm stated, beside the way: a door on the way up is
  // said here, where the corridor's bar would say it on the plane.
  const label = away.obstacle === undefined ? where : `${where} — ${away.obstacle.detail}`;
  const take = (): void => onAway(away, node.id);
  return (
    <g
      className="map-away"
      data-gated={away.obstacle === undefined ? undefined : away.obstacle.kind}
      data-kind={away.kind}
      onClick={(event) => {
        // The room underneath is a control too; a way out is not a pick.
        event.stopPropagation();
        take();
      }}
      onKeyDown={(event: KeyboardEvent<SVGGElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        take();
      }}
      onMouseDown={keepFocus}
      role="button"
      tabIndex={0}
    >
      <title>{label}</title>
      {/* The hit target: a glyph this small cannot be pointed at. */}
      <circle className="map-away-hit" cx={x} cy={y} r={AWAY.size + AWAY.hit} />
      {away.kind === 'teleport' ? (
        <Portal x={x} y={y} />
      ) : (
        <Chevron up={away.kind === 'up'} x={x} y={y} />
      )}
      {/*
       * Something in the way — a door on the stairs, a level the portal
       * wants — is a bar across the glyph, the corridor's own mark for a
       * shut passage, and not a hue alone: §6, and the trap's lesson above.
       */}
      {away.obstacle !== undefined && <GatedBar size={AWAY.size} x={x} y={y} />}
    </g>
  );
}

/** The bar across a way out with something in it: the door's mark, on the glyph. */
function GatedBar({ size, x, y }: { size: number; x: number; y: number }) {
  return (
    <line
      className="map-away-bar"
      strokeWidth={AWAY.stroke}
      x1={x - size - 0.4}
      x2={x + size + 0.4}
      y1={y}
      y2={y}
    />
  );
}

/** One room as the legend keys it: the map's own shape in the map's own group, so it looks the same. */
function KeyRoom({
  kind,
  letter,
  here = false
}: {
  kind: MapNode['kind'];
  letter?: string;
  here?: boolean;
}) {
  return (
    <g className="map-room" data-here={here ? 'true' : undefined} data-kind={kind}>
      <RoomShape kind={kind} letter={letter} r={3} x={0} y={0} />
    </g>
  );
}

/** One legend entry: its picture in a 12-unit box, and what it is. */
function Key({ kind, label, children }: { kind?: string; label: string; children: ReactNode }) {
  return (
    <span data-kind={kind}>
      <svg aria-hidden="true" className="key" viewBox="-6 -6 12 12">
        {children}
      </svg>
      {label}
    </span>
  );
}

/**
 * What the shapes mean, on MMUD Explorer's Rooms map — the one map that keys
 * them (2026-10-19): the Map card, the route panel and the loop builder are
 * read at a glance or with their own panel beside them, and the user asked
 * for the key there only. Listed whether or not each is in view, so the box
 * under the map keeps its size as it is walked.
 *
 * Only what that map draws: the character's room and the room the map is
 * drawn from, the rooms by kind, the bars across a corridor, and the ways out
 * the plane cannot draw.
 */
export function MapLegend() {
  return (
    <div className="map-legend">
      <Key kind="here" label={t('cards.map.legendYou')}>
        <circle className="map-you" cx="0" cy="0" r="5.2" />
        <KeyRoom here kind="room" />
      </Key>
      <Key kind="start" label={t('cards.map.legendStart')}>
        <circle className="rm-start" cx="0" cy="0" r="5" />
        <KeyRoom kind="room" />
      </Key>
      <Key kind="stairs" label={t('cards.map.legendVertical')}>
        <KeyRoom kind="stairs" />
      </Key>
      <Key kind="shop" label={t('cards.map.legendShop')}>
        <KeyRoom kind="shop" />
      </Key>
      <Key kind="trainer" label={t('cards.map.legendLettered')}>
        <KeyRoom kind="shop" letter="G" />
      </Key>
      <Key kind="bank" label={t('cards.map.legendBank')}>
        <KeyRoom kind="bank" />
      </Key>
      <Key kind="npc" label={t('cards.map.legendNpc')}>
        <KeyRoom kind="npc" />
      </Key>
      <Key kind="cmd" label={t('cards.map.legendCommand')}>
        <KeyRoom kind="cmd" />
      </Key>
      <Key kind="lair" label={t('cards.map.legendLair')}>
        <KeyRoom kind="lair" />
      </Key>
      <Key kind="door" label={t('cards.map.legendShut')}>
        <g className="map-links">
          <line data-kind="door" x1="-5" x2="5" y1="0" y2="0" />
        </g>
        <Bar tone="door" x1={-5} x2={5} y1={0} y2={0} />
      </Key>
      <Key kind="hidden" label={t('cards.map.legendHidden')}>
        <g className="map-links">
          <line data-kind="hidden" x1="-5" x2="5" y1="0" y2="0" />
        </g>
        <Bar tone="hidden" x1={-5} x2={5} y1={0} y2={0} />
      </Key>
      <Key kind="trap" label={t('cards.map.legendTrap')}>
        <g className="map-links">
          <line data-kind="trap" x1="-5" x2="5" y1="1" y2="1" />
        </g>
        <Bar tone="trap" x1={-5} x2={5} y1={1} y2={1} />
      </Key>
      {/* The ways out the plane cannot draw: up and down, a portal, an arrow. */}
      <Key kind="updown" label={t('cards.map.legendUpDown')}>
        <g className="map-mark" data-reach="jump">
          <Chevron up x={0} y={-1.9} />
          <Chevron up={false} x={0} y={1.9} />
        </g>
      </Key>
      <Key kind="teleport" label={t('cards.map.legendTeleport')}>
        <g className="map-mark" data-reach="jump">
          <Portal x={0} y={0} />
        </g>
      </Key>
      <Key kind="arrow" label={t('cards.map.legendArrow')}>
        <g className="map-mark" data-reach="local">
          <Arrow ux={1} uy={0} x={0} y={0} />
        </g>
      </Key>
      <Key kind="away" label={t('cards.map.legendArrowAway')}>
        <g className="map-mark" data-reach="away">
          <Arrow ux={1} uy={0} x={0} y={0} />
        </g>
      </Key>
    </div>
  );
}

export default memo(MapPlan);
