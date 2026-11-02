/**
 * Walking and looping, over IPC: a route planned and walked, a loop drafted,
 * started, run and stopped, a step back, and the loop shelf.
 */
import { asLoop, LOOP_LIMITS } from '../../shared/drafts';
import { Invoke, type SessionId } from '../../shared/ipc';
import type { MovementStart, WalkStart } from '../../shared/movement';
import {
  asRoomIds,
  asRoute,
  COLLECT_ITEMS_MAX,
  EMPTY_LOOP_DRAFT,
  roomId
} from '../../shared/world';
import { t } from '../app/i18n';
import type { IpcContext } from '../client';
import type { Transport } from '../host/Host';
import { planRoute } from '../world/RoutePlanner';
import type { Traveller } from '../world/WorldGraph';
import { LoopDraftCache } from '../world/loopDraft';

export function registerPlayIpc(transport: Transport, ctx: IpcContext): void {
  const { handle } = transport;

  /**
   * Who is walking, for pricing a route against them.
   *
   * One reading for every route a window asks for — the route panel's and the
   * loop builder's — so a door graded one way on the panel and another way in
   * the builder cannot happen. A character nobody has read the sheet of is
   * priced as one that can force nothing, which is `edgePenalty`'s own rule.
   */
  const travellerOf = (session: SessionId, walking: 'route' | 'lap'): Traveller => {
    const manager = ctx.host?.get(session)?.manager;
    // The session's own statement of what its character costs to move — the
    // stats off the sheet, the purse, what the server refused — so a door
    // graded one way on the panel and another way in a loop's leg cannot
    // happen. The builder drafts as the lap will walk, by distance and
    // passability: see the header of `loopDraft.ts`. A character with no
    // session yet is priced as one that can force nothing, which is
    // `edgePenalty`'s own rule.
    if (manager) {
      return walking === 'lap'
        ? manager.lapTraveller(manager.character)
        : manager.travellerNow(manager.character);
    }
    return { level: null, strength: null, pickSkill: undefined, wealth: null };
  };
  /*
   * One remembered set of drafts per session, so a pick costs its own leg
   * rather than a plan of the whole way from scratch on main's thread.
   */
  const drafts = new Map<SessionId, LoopDraftCache>();
  handle(Invoke.routeTo, async (_caller, session: SessionId, map: number, room: number) => {
    const manager = ctx.host?.get(session)?.manager;
    // This character's realm, not the client's: routing against the wrong one
    // sends somebody to a room that does not exist.
    const world = ctx.worldFor(session);
    if (!world || world.size === 0) {
      return { steps: [], cost: 0, blocked: true, reason: t('app.route.noRealmData') };
    }
    // Ambiguous rather than merely unresolved: asked for, then read again --
    // see `ensureLocated`. A room already known returns at once, and a realm
    // with nothing to ask (`locate: none`, or one that has already refused
    // the configured word) does too, so the ordinary case pays nothing here.
    if (manager && manager.character.room.map === null) await manager.ensureLocated();
    const here = manager?.character.room;
    if (!here || here.map === null || here.number === null) {
      // Routing from an unknown position would be a guess dressed as a plan.
      return { steps: [], cost: 0, blocked: true, reason: t('app.route.unknownRoom') };
    }
    // With the alternatives a reader chooses between: this is the one route
    // planned to be read rather than walked.
    return planRoute(
      world,
      roomId(here.map, here.number),
      roomId(map, room),
      travellerOf(session, 'route'),
      { alternatives: true }
    );
  });
  /*
   * A loop being built by hand, planned. Parsed rather than trusted: every
   * room on the way is one A* pass on this thread, so the list is bounded by
   * the same ceiling a loop payload has (the card refuses the click before
   * it gets here), and an entry that is not a room is refused outright —
   * skipping it would plan a different loop from the one on the screen.
   * Planned as a lap walks — by distance and passability, without the
   * corridors it prefers — so the way drawn is the way the reduction
   * reproduces and the way the lap walks; see the header of `loopDraft.ts`.
   */
  handle(Invoke.draftLoop, (_caller, session: SessionId, rooms: unknown, keep: unknown) => {
    const world = ctx.worldFor(session);
    if (!world || world.size === 0) return EMPTY_LOOP_DRAFT;
    const picks = asRoomIds(rooms, LOOP_LIMITS.stops);
    if (picks === null) throw new Error(t('app.loop.invalidPicks', { max: LOOP_LIMITS.stops }));
    // The rooms to keep as stops: those the builder has commands for (2026-10-23).
    const kept = keep === undefined ? [] : asRoomIds(keep, LOOP_LIMITS.stops);
    if (kept === null) throw new Error(t('app.loop.invalidPicks', { max: LOOP_LIMITS.stops }));
    let cache = drafts.get(session);
    if (cache === undefined) {
      cache = new LoopDraftCache();
      drafts.set(session, cache);
    }
    return cache.draft(world, picks, travellerOf(session, 'lap'), new Set(kept));
  });
  /*
   * Walking is an outbound action, so it goes to that session's arbiter rather
   * than sending anything from here. The route is passed back in whole because
   * the renderer has already shown it to a person: walking exactly what was
   * reviewed is the point, and re-planning here could quietly walk a different
   * one.
   */
  handle(
    Invoke.walkRoute,
    (_caller, session: SessionId, payload: unknown, run: unknown): WalkStart => {
      const slot = ctx.host?.get(session);
      if (!slot) return { refused: t('app.session.notConnected') };
      /*
       * Parsed, not trusted. This is the one payload a window sends that turns
       * into commands on the socket, so it is the one that has to be proven at
       * the boundary — a malformed route otherwise fails several frames later
       * inside the walker, where nothing on the stack says where it came from.
       */
      const route = asRoute(payload);
      if (!route) return { refused: t('app.route.invalidPayload') };
      /*
       * Through the manager rather than straight at the walker: a route the
       * player asked for is one of the two moments the supply list is consulted,
       * and the shop is visited before the route is walked. And it is the one
       * route that can have gone stale while somebody read it, so it goes
       * through `walkPlan`, which redraws it rather than refusing. See both.
       */
      return slot.manager.walkPlan(route, run === true);
    }
  ); /*
   * Collect what a door wants, then walk the way through it (todo 07).
   *
   * Parsed, not trusted, for `walk:start`'s reason — this turns into commands
   * on a socket — and each item is checked as narrowly as the route: an id and
   * a name, both of which the realm gave the window in the first place. One
   * bad entry refuses the lot: an errand that silently dropped an item would
   * walk into the door that item opens.
   */
  handle(
    Invoke.collectThenWalk,
    (_caller, session: SessionId, items: unknown, payload: unknown, run: unknown) => {
      const slot = ctx.host?.get(session);
      if (!slot) return t('app.session.notConnected');
      const route = asRoute(payload);
      if (!route) return t('app.route.invalidPayload');
      if (!Array.isArray(items) || items.length === 0 || items.length > COLLECT_ITEMS_MAX) {
        return t('app.route.invalidPayload');
      }
      const wanted: Array<{ id: number; name: string }> = [];
      for (const item of items) {
        const asked = item as { id?: unknown; name?: unknown } | null;
        const id = typeof asked?.id === 'number' && Number.isFinite(asked.id) ? asked.id : null;
        const name = typeof asked?.name === 'string' ? asked.name.trim() : '';
        if (id === null || name.length === 0) return t('app.route.invalidPayload');
        wanted.push({ id, name });
      }
      return slot.manager.collectThenWalk(wanted, route, run === true);
    }
  ); /*
   * The one play button and the one stop button.
   *
   * A character is routing, looping or stopped, and *stop* means the same
   * thing in all three sentences — so main is asked to start or to stop, and
   * decides for itself which of the two it is. See `src/shared/movement.ts`
   * and `SessionManager.startMoving`.
   *
   * `loop` is what the card's picker says and `confirmed` is the answer to the
   * one question play can ask back. Both parsed, not trusted: this turns into
   * commands on a socket.
   */
  handle(
    Invoke.startMoving,
    async (_caller, session: SessionId, loop: unknown): Promise<MovementStart> => {
      const slot = ctx.host?.get(session);
      if (!slot) return { refused: t('app.session.notConnected') };
      if (loop !== null && typeof loop !== 'string') return { refused: t('app.loop.invalidName') };
      // See `Invoke.routeTo` — the same wait, so a route resumed or a loop
      // started from an ambiguous room gets one chance at the real answer
      // before `planFromHere` refuses it.
      if (slot.manager.character.room.map === null) await slot.manager.ensureLocated();
      return slot.manager.startMoving(loop);
    }
  );
  handle(Invoke.stopMoving, (_caller, session: SessionId) => {
    ctx.host?.get(session)?.manager.stopMoving();
  }); // Back: one room the way the character came, MegaMUD's Step Back.
  handle(Invoke.stepBack, (_caller, session: SessionId): MovementStart => {
    const slot = ctx.host?.get(session);
    if (!slot) return { refused: t('app.session.notConnected') };
    return slot.manager.stepBack();
  }); /*
   * A loop is named rather than passed: unlike a route, nothing has been shown
   * to a person to walk *exactly*, and the loop the character should run is
   * the one their own options file defines under that name.
   */
  handle(
    Invoke.listLoops,
    (_caller, session: SessionId) => ctx.host?.get(session)?.manager.loopList ?? []
  );
  handle(Invoke.startLoop, async (_caller, session: SessionId, name: unknown) => {
    const slot = ctx.host?.get(session);
    if (!slot) return t('app.session.notConnected');
    if (typeof name !== 'string') return t('app.loop.invalidName');
    const loop = slot.manager.loopNamed(name);
    if (!loop) return t('app.loop.notFound', { name });
    // See `Invoke.routeTo` — the same wait, before the first leg is planned.
    if (slot.manager.character.room.map === null) await slot.manager.ensureLocated();
    // Through the manager: one movement at a time, so a lap starting takes the
    // character off whatever route it was walking, out loud.
    const answer = slot.manager.startLoop(loop);
    return 'refused' in answer ? answer.refused : null;
  }); /*
   * Walk a loop that is not in this character's options at all.
   *
   * `loop:start` addresses a loop by *name*, resolved against the character's
   * own resolved config — which is right for the palette and the card, whose
   * lists are that config. The Loops modal browses the shipped shelf, and its
   * `Don't keep it` destination means precisely a loop that was never written
   * anywhere: there is no name for `loopNamed` to find, and filing one in
   * order to start it and then deleting it would be a write into the user's
   * tree on a path that promised not to make one.
   *
   * `SessionManager.startLoop` takes the loop itself and never a name, so this
   * is its own shape rather than a new capability. Parsed, not
   * trusted: it crossed the wire.
   */
  handle(Invoke.runLoop, async (_caller, session: SessionId, loop: unknown) => {
    const slot = ctx.host?.get(session);
    if (!slot) return t('app.session.notConnected');
    const parsed = asLoop(loop);
    if (parsed === null) return t('app.loop.invalidLoop');
    // See `Invoke.routeTo` — the same wait, before the first leg is planned.
    if (slot.manager.character.room.map === null) await slot.manager.ensureLocated();
    const answer = slot.manager.startLoop(parsed);
    return 'refused' in answer ? answer.refused : null;
  }); /*
   * A loop's stops as the rooms they name on this character's realm, for the
   * builder to open it on (2026-10-23): resolved as a lap resolves them, so
   * the loop drawn is the loop walked.
   */
  handle(Invoke.loopStops, (_caller, session: SessionId, loop: unknown) => {
    const slot = ctx.host?.get(session);
    if (!slot) return t('app.session.notConnected');
    const parsed = asLoop(loop);
    if (parsed === null) return t('app.loop.invalidLoop');
    return slot.manager.loopStops(parsed);
  }); /*
   * The shelf, not a character's list — so it takes no session, unlike every
   * other loop channel here. The settings screen asks for it when its picker
   * opens; the catalogue reads the shipped file once and keeps it.
   */
  handle(Invoke.loopCatalogue, () => ctx.loopCatalogue().all());
}
