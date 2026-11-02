/**
 * The realm, over IPC: room search and the realm's figures, quests, hunting
 * grounds, trainers, banks and what a shop serves, the Party card's rosters,
 * a room's brief, the item and monster rules, lookups and questions to the
 * realm, gear, terminal actions, the names it knows, and what to forget.
 */
import type { FightSummary } from '../../shared/fights';
import {
  dropAllPlan,
  equip,
  equipAllPlan,
  GEAR_ACTIONS,
  type GearAction,
  type GearPlan,
  restorePlan,
  unequip,
  type Wearer
} from '../../shared/gear';
import { Invoke, type SessionId } from '../../shared/ipc';
import { asItemRules } from '../../shared/itemRules';
import type { MobLoreEntry } from '../../shared/lore';
import { EMPTY_MAP } from '../../shared/map';
import { asMonsterRules } from '../../shared/monsterRules';
import { type PartyRoster, sameName } from '../../shared/partyRoster';
import { REMOTE_NAMES, type RemoteName } from '../../shared/remotes';
import { TERMINAL_ACTIONS, type TerminalActionName } from '../../shared/types';
import {
  asRoomReference,
  type MobPlaces,
  type MobRowBrief,
  nameAnswersTo,
  roomId,
  type ShopPlace
} from '../../shared/world';
import { t } from '../app/i18n';
import { tuning } from '../app/tuning';
import type { IpcContext } from '../client';
import type { Transport } from '../host/Host';
import { fanOutActs } from '../session/PartyKeeper';
import { areaMap } from '../world/areaMap';
import { localMap } from '../world/localMap';
import { roomBrief } from '../world/roomBrief';

export function registerWorldIpc(transport: Transport, ctx: IpcContext): void {
  const { handle } = transport;

  /*
   * Every world query is addressed, for the same reason every push is: with a
   * realm per character, an unaddressed one would answer from whichever realm
   * happened to be the client's. A destination searched on one character's
   * realm and walked on another's is a route to a room that does not exist.
   */
  handle(Invoke.mobNames, (_caller, session: SessionId) => {
    const world = ctx.worldFor(session);
    return world ? world.mobNames() : [];
  });
  handle(Invoke.searchRooms, (_caller, session: SessionId, query: string) => {
    const world = ctx.worldFor(session);
    if (!world) return [];
    /*
     * Two numbers identify a room outright, so they never go to the name search.
     *
     * The realm keys every room on `map/room` and the Room card's badge shows
     * that pair -- and typing what it showed found nothing, because this field
     * was a substring query over room *names*. A reference is answered by the
     * index instead, which means exactly one room or none: the candidate ladder
     * name search needs cannot apply to a key that is already unique.
     *
     * Deliberately no fallback to a name search when the room is not there. A
     * reference that misses is a room the realm does not have, and running a
     * name query for "1/99999" afterwards would fail a second time and blame
     * the wrong thing.
     */
    const reference = asRoomReference(query);
    if (reference !== null) {
      const room = world.get(reference.map, reference.room);
      return room === undefined ? [] : [{ ...room, visitedAt: null }];
    }

    /*
     * Where this character's realm has been walked to, first.
     *
     * `searchByName` is a substring match over 55,806 rooms, capped at 25, in
     * the world file's own build order — so `forest` answers with whichever
     * forests the file happens to list first, and the one the player means is
     * usually not among them. It is almost always somewhere they have been
     * before, and the client knows which those are because it planned the
     * route. So the recent matches go on top, newest first.
     *
     * They are *added* to the realm's answer rather than replacing part of it:
     * a room already recorded is dropped from the realm rows below rather than
     * listed twice, and the realm's own count is unchanged, so putting the
     * shortcut on top never costs a result somebody could have had.
     */
    const shown = tuning().records.destinationsShown;
    const recent = ctx.destinationsFor(session).matching(query, shown);
    const seen = new Set(recent.map((entry) => entry.id));
    const found = world
      .searchByName(query)
      .map((room) => ({ ...room, visitedAt: null }))
      .filter((room) => !seen.has(roomId(room.map, room.room)));

    return [
      ...recent.flatMap((entry) => {
        /*
         * Resolved against the realm rather than drawn from the record.
         *
         * The record holds a name from whenever the walk happened, and the
         * realm underneath it can be swapped — `world.database` is a
         * per-character setting. A row whose id the realm no longer has is
         * dropped rather than offered: clicking it would plan a route to a
         * room that does not exist, which is the confidently wrong answer this
         * project refuses everywhere else. It stays in the file, because the
         * realm may be swapped back.
         */
        const reference = asRoomReference(entry.id);
        const room = reference === null ? undefined : world.get(reference.map, reference.room);
        return room === undefined ? [] : [{ ...room, visitedAt: entry.at }];
      }),
      ...found
    ];
  });
  handle(Invoke.worldInfo, (_caller, session: SessionId) => {
    const world = ctx.worldFor(session);
    return { rooms: world?.size ?? 0, source: world?.info.source ?? 'none' };
  });
  handle(Invoke.questBook, (_caller, session: SessionId) => {
    // A realm with no world loaded, and one converted before quests were
    // indexed, both answer with none — which the card says out loud.
    return ctx.worldFor(session)?.quests() ?? [];
  });
  handle(Invoke.questErrand, (_caller, session: SessionId, block: unknown) => {
    /*
     * Parsed, not trusted. The block is a text-block id off a card that read
     * it out of the book, and what it selects here is a travelling salesman's
     * path costing a graph sweep per place — so a payload that is not one of
     * the realm's own blocks answers null rather than being looked up.
     */
    if (typeof block !== 'number' || !Number.isInteger(block)) return null;
    return ctx.host?.get(session)?.manager?.questErrand(block) ?? null;
  });
  handle(Invoke.questPlan, (_caller, session: SessionId, block: unknown, marked: unknown) => {
    // Parsed like the errand's block, and for the same reason: a chain's plan
    // is an A* per step, and only one of the realm's own blocks earns it.
    if (typeof block !== 'number' || !Number.isInteger(block)) return null;
    const rank = typeof marked === 'number' && Number.isInteger(marked) ? marked : null;
    return ctx.host?.get(session)?.manager?.questPlan(block, rank) ?? null;
  });
  handle(Invoke.questRun, (_caller, session: SessionId, block: unknown, marked: unknown) => {
    if (typeof block !== 'number' || !Number.isInteger(block)) {
      return t('automation.quests.refusalUnknownStep', { block: String(block) });
    }
    const rank = typeof marked === 'number' && Number.isInteger(marked) ? marked : null;
    const manager = ctx.host?.get(session)?.manager;
    if (manager === undefined || manager === null) return t('automation.quests.refusalNotInRealm');
    return manager.questRun(block, rank);
  });
  handle(Invoke.questStop, (_caller, session: SessionId) => {
    ctx.host?.get(session)?.manager?.questStop();
  });
  handle(
    Invoke.localMap,
    (_caller, session: SessionId, map: number, room: number, radius?: unknown) => {
      const world = ctx.worldFor(session);
      if (!world || world.size === 0) return EMPTY_MAP;
      /*
       * Parsed, not trusted. The card measures its own box and asks for the
       * radius it can show, and that number arrives here as a payload like any
       * other — the search is breadth-first and exponential in it, so a window
       * asking for a radius of four hundred would walk the realm on the main
       * process's own thread. Bounded to the same range the card clamps to;
       * anything else is `undefined`, which takes `DEFAULT_RADIUS`.
       */
      const { mapRadiusMin, mapRadiusMax } = tuning().view;
      const asked =
        typeof radius === 'number' && Number.isInteger(radius)
          ? Math.max(mapRadiusMin, Math.min(mapRadiusMax, radius))
          : undefined;
      return localMap(world, roomId(map, room), asked);
    }
  );
  handle(
    Invoke.areaMap,
    (_caller, session: SessionId, map: unknown, room: unknown, level: unknown) => {
      const world = ctx.worldFor(session);
      if (!world || world.size === 0) return null;
      if (!Number.isInteger(map) || !Number.isInteger(room)) return null;
      return areaMap(
        world,
        roomId(map as number, room as number),
        Number.isInteger(level) ? (level as number) : null,
        ctx.areaOverrides()
      );
    }
  ); // Where this character earns most, by MMUD Explorer's own arithmetic (2026-10-29).
  handle(Invoke.huntingGrounds, (_caller, session: SessionId, asParty: unknown) =>
    ctx.huntingGroundsOf(session, ctx.explorerRealm(session), asParty === true)
  ); /*
   * Where this character may go and level. Addressed, and answered from the
   * realm's own shop rows rather than from a room name — see `trainersTaking`.
   * No session is an empty list, which is what the picker draws as *nowhere
   * the realm says will take you*.
   */
  handle(Invoke.trainers, (_caller, session: SessionId) => {
    return ctx.host?.get(session)?.manager?.trainers() ?? [];
  }); /* Every bank counter this realm places, for the settings picker (todo 00). */
  handle(Invoke.banks, (_caller, session: SessionId) => ctx.worldFor(session)?.banks() ?? []); /*
   * The items the realm says would serve each condition a potion rule can
   * name. A property of the realm rather than the character, so one call
   * answers every row the settings screen draws.
   */
  handle(Invoke.itemsServing, (_caller, session: SessionId) => {
    const world = ctx.worldFor(session);
    if (!world) return {};
    return {
      hp: world.itemsServing('hp').map((item) => item.name),
      poisoned: world.itemsServing('poisoned').map((item) => item.name),
      blind: world.itemsServing('blind').map((item) => item.name),
      diseased: world.itemsServing('diseased').map((item) => item.name)
    };
  }); /*
   * And the realm's own half of the same list (todo 02): where it says a
   * spell stops a room's effect and an item's use casts that spell. A
   * property of the realm like the line above, so one call answers the
   * section.
   */
  handle(Invoke.wards, (_caller, session: SessionId) => ctx.worldFor(session)?.wards() ?? []);
  handle(Invoke.partyRosters, () => ctx.parties?.all ?? []);
  handle(Invoke.saveRoster, (_caller, roster: unknown) => {
    if (!ctx.parties) return [];
    const made = roster as Partial<PartyRoster> | null;
    if (
      made !== null &&
      typeof made === 'object' &&
      typeof made.realm === 'string' &&
      !ctx.parties.all.some((entry) => entry.id === made.id) &&
      (made.places ?? []).length === 0
    )
      return ctx.saveNewRoster(made as PartyRoster);
    const before = ctx.parties.all.find((entry) => entry.id === made?.id)?.leader ?? null;
    const saved = ctx.parties.save(roster);
    // A leader changed on the card: the party re-formed round them now, as a
    // Regroup press would, whatever the automatic switch says.
    const after = saved.find((entry) => entry.id === made?.id);
    if (after?.leader && before !== null && !sameName(before, after.leader))
      ctx.partyKeeper.now(after, ctx.keptOn(after.realm));
    return saved;
  });
  handle(Invoke.regroupParty, (_caller, id: unknown) => {
    const roster = ctx.parties?.all.find((entry) => entry.id === id);
    return roster ? ctx.partyKeeper.now(roster, ctx.keptOn(roster.realm)) : 0;
  });
  handle(Invoke.musterParty, (_caller, id: unknown, target: unknown) => {
    const roster = ctx.parties?.all.find((entry) => entry.id === id);
    const where = ctx.asMusterTarget(target);
    if (!roster || where === null) return [];
    return ctx.muster(roster, where);
  }); /*
   * Say to: one line typed once, fanned out — each chosen character of ours
   * sends it as its own, as if typed there, and everybody else in the party
   * gets the leader's @party when `others` says so.
   */
  handle(
    Invoke.partySay,
    (_caller, id: unknown, chosen: unknown, line: unknown, others: unknown) => {
      const roster = ctx.parties?.all.find((entry) => entry.id === id);
      const text = typeof line === 'string' ? line.trim().slice(0, 200) : '';
      if (!roster || text === '' || !Array.isArray(chosen)) return [];
      const sessions = new Set(chosen.filter((s): s is string => typeof s === 'string'));
      const acts = fanOutActs(roster, ctx.keptOn(roster.realm), {
        chosen: sessions,
        others: others === true
      });
      return ctx.fanOut(roster, acts, [text], (manager) => {
        manager.sendMacro(text);
        return null;
      });
    }
  );
  handle(Invoke.removeRoster, (_caller, id: unknown) =>
    typeof id === 'string' ? (ctx.parties?.remove(id) ?? []) : (ctx.parties?.all ?? [])
  );
  handle(Invoke.disbandParty, (_caller, id: unknown) => {
    const roster = ctx.parties?.all.find((entry) => entry.id === id);
    if (!ctx.parties || !roster) return ctx.parties?.all ?? [];
    ctx.disband(roster);
    return ctx.parties.remove(roster.id);
  });
  handle(Invoke.roomBrief, (_caller, session: SessionId, map: number, room: number) => {
    const world = ctx.worldFor(session);
    // A realm with no world loaded knows nothing about any room, which is the
    // same answer as a room it does not hold: the panel says so either way.
    if (!world || world.size === 0) return null;
    /*
     * The family the *wire* stated, not the realm file's: it decides the
     * lair's respawn clock alone, and on the shipped configuration the two
     * legitimately differ (a Paradigm-built world file against a GreaterMUD
     * default realm). The same reading `CharacterTracker` resolves the Room
     * card's own `LAIR` face with, so the panel and the card cannot answer two
     * clocks for one room. See `WorldGraph.lair`.
     */
    const manager = ctx.host?.get(session)?.manager;
    const family = manager?.family ?? null;
    return roomBrief(world, roomId(map, room), family, manager?.level ?? null);
  });
  /*
   * The four world queries that used to live here — `shopHere`, `lairHere`,
   * `answersHere` and `itemsKnown` — are gone (2026-09-02).
   *
   * Every one of them answered a question main had already answered: the shop,
   * the lair, the room's script and what the realm knows about an item are all
   * settled the moment the room resolves or the pack listing is parsed, and
   * `CharacterTracker` attaches them to the entities it publishes. They
   * crossed the wire on demand only because the room was a bag of strings and
   * the pack was a list of names when they were added — and the cost was four
   * React effects that each ran *after* the card had drawn once without the
   * answer, each with its own stale-value hazard when a character switched.
   */

  /**
   * Who this character is, as the realm numbers races and classes.
   *
   * The stat sheet prints the realm's own words (`Race: Halfling`,
   * `Class: Mystic`) and an item's restrictions are row ids, so the join
   * happens here, where both tables are. Null throughout until a sheet has
   * printed — and null is *unknown*, which the equip check never refuses on.
   */
  handle(Invoke.wearer, (_caller, session: SessionId): Wearer => ctx.wearerIn(session)); /*
   * The own rows from the character's file as written, not the resolved
   * config: that one has the options file's rows merged in, and writing it
   * back would pin them into this character (`ownMonsterRules`).
   */
  handle(Invoke.itemRulesFor, (_caller, session: unknown) => {
    if (typeof session !== 'string') return { realm: [], own: [] };
    return {
      realm: ctx.realmTablesFor(session as SessionId).items,
      own: ctx.editor().ownRules(session).items
    };
  });
  handle(Invoke.setItemDetails, (_caller, session: unknown, rules: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    const result = ctx.editor().setItemDetails(session, asItemRules(rules));
    if (result.ok) ctx.publishRosters();
    return result.ok ? null : result.error;
  });
  handle(Invoke.monsterRulesFor, (_caller, session: unknown) => {
    if (typeof session !== 'string') return { realm: [], own: [] };
    return {
      realm: ctx.realmTablesFor(session as SessionId).monsters,
      own: ctx.editor().ownRules(session).monsters
    };
  });
  handle(Invoke.setCombatMonsters, (_caller, session: unknown, rules: unknown) => {
    if (typeof session !== 'string') return t('app.profiles.noSuchCharacter');
    const result = ctx.editor().setCombatMonsters(session, asMonsterRules(rules));
    if (result.ok) ctx.publishRosters();
    return result.ok ? null : result.error;
  });
  handle(Invoke.lookup, async (_caller, session: SessionId, query: unknown) => {
    const world = ctx.worldFor(session);
    if (!world) return { mobs: [], items: [], spells: [], races: [], classes: [] };
    /*
     * Asked from where the reader is standing, which is what tells two of the
     * realm's rows apart under one name: the Gnoll Tent's own lair names row
     * 224 and the nearest room row 2204 spawns in is on another map, so the
     * card answers `100 hp` rather than the fold's `100–830`. A session whose
     * character has not placed itself yet passes null and gets the fold.
     */
    const here = ctx.host?.get(session)?.manager.character.room;
    const at =
      !here || here.map === null || here.number === null ? null : roomId(here.map, here.number);
    const found = world.lookup(typeof query === 'string' ? query.slice(0, 128) : '', 12, at);
    // And what this character's realm has learned about each monster named,
    // beside the realm's figure. Only where fighting has taught something.
    const lore = ctx.loreFor(session);
    const learned: Record<string, MobLoreEntry> = {};
    for (const mob of found.mobs) {
      const entry = lore.learnedFor(mob.name);
      if (entry !== null) learned[mob.name] = entry;
    }
    // One read of the record for every monster named, resolved through the
    // realm table the way the lore is, so a rat king's fights stay its own.
    const fights = Object.fromEntries(
      (await ctx.fightLogs.get(session)?.summaries(
        found.mobs.map((mob) => mob.name),
        (printed) => world.mobAsPrinted(printed)?.name ?? printed
      )) ?? []
    ) as Record<string, FightSummary>;
    /*
     * Where every shop that sells one of these items is.
     *
     * Resolved here so that reading `Sold by` and walking to one of them is
     * one round trip rather than two: the card would otherwise need a channel
     * of its own, asked per click, for a join the realm file can already make.
     * A shop the realm places in no room contributes no key, which is what
     * leaves its name plain text on the card rather than a control that goes
     * nowhere.
     */
    const shopPlaces: Record<string, ShopPlace> = {};
    for (const item of found.items) {
      for (const shop of item.shops ?? []) {
        const key = shop.trim().toLowerCase();
        if (key.length === 0 || key in shopPlaces) continue;
        const place = world.shopPlace(shop);
        if (place !== undefined) shopPlaces[key] = place;
      }
    }
    /*
     * And where the realm puts each monster named.
     *
     * Same join, made in the same place and for the same reason as the shops
     * above: *what is this thing* and *where do I find one* are one question
     * asked twice, and the answer to the second was in the room table with no
     * door to it. Keyed by the monster's own name, as `learned` and `verdicts`
     * are, so the card reads all four off one answer.
     */
    const mobPlaces: Record<string, MobPlaces> = {};
    for (const mob of found.mobs) {
      const places = world.mobPlaces(mob);
      if (places !== undefined) mobPlaces[mob.name] = places;
    }
    /*
     * And each row of a name several rows share, where nothing settled which:
     * its own figures and where it spawns, so a name typed into Ctrl+K lists
     * every one of them told apart (2026-10-24).
     */
    const mobRows: Record<string, MobRowBrief[]> = {};
    for (const mob of found.mobs) {
      const rows = world.rowBriefs(mob);
      if (rows !== undefined) mobRows[mob.name] = rows;
    }
    /*
     * And *can I fight this?* — each monster named, weighed against the
     * character as it stands at this moment, by the session's own arithmetic
     * so the card reads exactly what auto-combat ranks on. A session with no
     * manager (a stale id) has no character to weigh against and gets none.
     */
    const verdicts =
      ctx.host?.get(session)?.manager.appraise(found.mobs.map((mob) => mob.name)) ?? {};
    return {
      ...found,
      ...(Object.keys(learned).length > 0 ? { learned } : {}),
      ...(Object.keys(fights).length > 0 ? { fights } : {}),
      ...(Object.keys(shopPlaces).length > 0 ? { shopPlaces } : {}),
      ...(Object.keys(mobPlaces).length > 0 ? { mobPlaces } : {}),
      ...(Object.keys(mobRows).length > 0 ? { mobRows } : {}),
      ...(Object.keys(verdicts).length > 0 ? { verdicts } : {})
    };
  });
  /*
   * Parsed, not trusted: the payload names a record to delete from a file the
   * player owns, so a malformed one is refused rather than matched loosely.
   */
  /*
   * A command asked for from a card, sent through the engine's pending list
   * like every automated command — which is what makes it quiet when
   * `internal.yaml` says so. Parsed: one line of printable text, no longer
   * than a command, because this is a window handing main a string that
   * becomes bytes on a socket. It was one bare word, which refused the Party
   * card's `follow <name>` and the Room card's phrases outright; a window can
   * already type any line (`Send.input`), so a line is no wider a door.
   */
  handle(Invoke.ask, (_caller, session: SessionId, command: unknown) => {
    if (typeof command !== 'string' || !ctx.ASKABLE.test(command) || command.trim() !== command) {
      return false;
    }
    return ctx.host?.get(session)?.manager.ask(command) ?? false;
  });
  /*
   * *Where am I standing*, in whichever word the realm's own `locate` setting
   * names. No argument crosses from the window: main reads the setting and
   * picks the word itself, exactly as the gear button decides its own.
   */
  handle(Invoke.locate, (_caller, session: SessionId) => {
    return ctx.host?.get(session)?.manager.askWhereIAm() ?? false;
  });
  /*
   * A gear button: the kit back on, all of it on, all of it off, or one item.
   *
   * **Decided here, not in the renderer**, for the reason `actions.ts` gives
   * about the buttons beside a room's name: the pack, the remembered loadout
   * and the realm's own word on what can be worn all live in main, and a
   * renderer deciding this would be a second reading of all three. What
   * crosses the wire is an action from a closed list and, for one item, a name
   * — and the name is resolved against the pack before it becomes a command,
   * so a stale card cannot make this send `wear` at something that is not
   * there. An unrecognised command on this server is said out loud in the room.
   *
   * The plans are pure and in `shared/gear.ts`, which is what lets the card
   * offer only the buttons that would do something.
   *
   * Each command goes through `ask` — the arbiter, `probe` band, coalesced by
   * its own text — so a bulk action is paced exactly as everything else
   * automated is and never displaces an attack or an escape. Bounded by
   * `tuning.spending.maxGear`, and the cap is said out loud rather than silently applied.
   */
  handle(Invoke.gear, (_caller, session: SessionId, action: unknown, item: unknown): number => {
    if (typeof action !== 'string' || !(GEAR_ACTIONS as readonly string[]).includes(action)) {
      return 0;
    }
    const manager = ctx.host?.get(session)?.manager;
    if (!manager) return 0;
    const state = manager.character;
    const items = state.inventory.items;

    const plan = ((): GearPlan => {
      switch (action as GearAction) {
        case 'restore':
          return restorePlan(state.loadout, items, tuning().spending.maxGear);
        case 'equip-all':
          return equipAllPlan(
            items,
            (name) => ctx.wearableIn(session, name),
            tuning().spending.maxGear
          );
        case 'drop-all':
          return dropAllPlan(items, tuning().spending.maxGear);
        /*
         * One item, on or off, and the pack is what says which row.
         *
         * `nameAnswersTo` is the server's own rule for a typed name, so the
         * card may send what it drew and this still finds the row — and the
         * *listing's* spelling is what goes out, never the renderer's string.
         *
         * The row it finds is one the action can actually act on, which
         * matters because a pack holds two of a name as often as one: with a
         * ring on a finger and its twin in the pack, taking the first match
         * would have *Take off* find the spare and *Put on* find the worn
         * one, and both buttons would silently do nothing. A name held only
         * in the wrong state is therefore already done rather than missing —
         * and a name the pack does not hold at all is said out loud, because
         * after a death the difference between "already off" and "gone" is
         * the half the player needs.
         */
        case 'equip':
        case 'remove': {
          if (typeof item !== 'string') return { commands: [], missing: [], overflow: 0 };
          const wanted = action === 'equip';
          const matching = items.filter((carried) => nameAnswersTo(carried.name, item));
          if (matching.length === 0) return { commands: [], missing: [item], overflow: 0 };
          const held = matching.find((carried) => carried.equipped !== wanted);
          if (!held) return { commands: [], missing: [], overflow: 0 };
          return {
            commands: [wanted ? equip(held.name) : unequip(held.name)],
            missing: [],
            overflow: 0
          };
        }
      }
    })();

    for (const command of plan.commands) manager.ask(command);
    if (plan.missing.length > 0) {
      ctx.announce(
        'gear',
        t('automation.gear.missing', {
          count: plan.missing.length,
          items: plan.missing.join(', ')
        })
      );
    }
    if (plan.overflow > 0) {
      ctx.announce(
        'gear',
        t('automation.gear.capped', { max: tuning().spending.maxGear, more: plan.overflow })
      );
    }
    return plan.commands.length;
  });
  /*
   * A button beside a room's name that main runs: `Deposit All`.
   *
   * Nothing crosses but the name of the action, checked against the closed
   * list — `gear:act`'s rule, and here it carries more weight than usual,
   * because the whole reason this is not a list of commands is that the
   * figure a deposit names is not knowable until the `i` it sends has been
   * answered. The engine's deposit owns the wait (`MegaEngine.depositAll`).
   *
   * A refusal — nothing to bank, or a button pressed from the backscroll
   * beside a room the character left — reports itself as a notice, so `false`
   * here is never silent.
   */
  handle(Invoke.terminalAct, (_caller, session: SessionId, action: unknown): boolean => {
    if (typeof action !== 'string' || !(TERMINAL_ACTIONS as readonly string[]).includes(action)) {
      return false;
    }
    const manager = ctx.host?.get(session)?.manager;
    if (!manager) return false;
    switch (action as TerminalActionName) {
      case 'deposit-all':
        return manager.depositAll();
    }
  });
  /*
   * A question at another player, from the palette. Parsed, for the same
   * reason `ask` is: a name is a word the realm accepts as one, and the
   * command is one of the closed list — anything else is refused rather than
   * turned into bytes on the socket.
   */
  handle(Invoke.askRemote, (_caller, session: SessionId, who: unknown, name: unknown) => {
    if (typeof who !== 'string' || !/^[A-Za-z][A-Za-z'-]{0,30}$/.test(who)) return false;
    if (typeof name !== 'string' || !(REMOTE_NAMES as readonly string[]).includes(name)) {
      return false;
    }
    return ctx.host?.get(session)?.manager.askRemote(who, name as RemoteName) ?? false;
  });
  handle(Invoke.names, (_caller, session: SessionId) => {
    return (
      ctx.worldFor(session)?.names() ?? {
        items: [],
        mobs: [],
        spells: [],
        races: [],
        classes: [],
        rooms: []
      }
    );
  });
  handle(Invoke.forget, (_caller, session: SessionId, discovery: unknown) => {
    if (typeof discovery !== 'object' || discovery === null) return false;
    const { from, command } = discovery as Record<string, unknown>;
    if (typeof from !== 'string' || typeof command !== 'string') return false;
    return ctx.host?.get(session)?.manager.forget({ from, command }) ?? false;
  });
  handle(Invoke.forgetCharacter, (_caller, session: SessionId) => {
    return ctx.host?.get(session)?.manager.forgetCharacter() ?? false;
  });
  // Parsed, not checked, like every payload that reaches a file on disk.
  handle(Invoke.forgetFind, (_caller, session: SessionId, find: unknown) => {
    if (typeof find !== 'object' || find === null) return false;
    const { room, name } = find as Record<string, unknown>;
    if (typeof room !== 'string' || typeof name !== 'string') return false;
    return ctx.host?.get(session)?.manager.forgetFind({ room, name }) ?? false;
  });
}
