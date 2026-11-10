/**
 * The client: every session, every store, the realm data and every handler
 * behind `IpcApi` — built once by `startClient`, for whichever host
 * `src/main/index.ts` chose.
 *
 * Responsibilities are deliberately narrow: own one `SessionHost`, and bridge
 * it to the renderer over the typed IPC contract in `@shared/ipc`. No
 * parsing, no game logic — and, since 2026-09-07, **no `electron`**: what a
 * desktop window, a file manager, a native picker or a clipboard is has to be
 * asked of the `Host` (`host/Host.ts`), because the same client is served to
 * a browser tab (`host/WebHost.ts`) where none of those exist. A host that
 * cannot do something says so, and every refusal below is worded for the
 * window that will show it.
 */
import { copyFileSync, cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ConfigStore } from './config/ConfigStore';
import { reconcileWithTemplate } from './config/reconcile';
import { InternalStore } from './config/InternalStore';
import { setTuning, tuning } from './app/tuning';
import { ProfileStore, type ProfileSnapshot } from './config/ProfileStore';
import { ServerStore } from './config/ServerStore';
import {
  MESSAGE_TABLE,
  ITEM_TABLE,
  MONSTER_TABLE,
  RealmTableStore,
  type RealmTable,
  type TableKind
} from './config/RealmTableStore';
import { LoopStore } from './config/LoopStore';
import { SettingsEditor, type SettingsEditorOptions } from './config/SettingsEditor';
import { LoopCatalogue } from './config/LoopCatalogue';
import { migrateHome } from './config/Migration';
import { homeAt, homeRoot, type Home } from './app/home';
import { WorldGraph } from './world/WorldGraph';
import { RealmLibrary } from './world/RealmLibrary';
import { WorldMemory } from './world/WorldMemory';
import { FindBook } from './world/FindBook';
import { WorldBook } from './world/WorldBook';
import { SplitMemory } from './world/SplitMemory';
import {
  NO_REALM_TABLES,
  type RealmMemory,
  type RealmTables,
  type SessionManager
} from './session/SessionManager';
import { MegaLearned } from './world/MegaLearned';
import { RealmLore, realmKey } from './world/RealmLore';
import { PlayerBook, realmAddress } from './world/PlayerBook';
import { cureGates, spellServes, spellTargeting } from '../shared/spellcraft';
import { DestinationBook, type RealmDestinations } from './world/DestinationBook';
import { MovementBook } from './session/MovementBook';
import { PartyBook } from './session/PartyBook';
import {
  musterActs,
  PartyKeeper,
  type KeptMember,
  type FanAct,
  type FanSkip,
  type RegroupAct
} from './session/PartyKeeper';
import {
  formedParty,
  readPlace,
  sameName,
  withStatedPlaces,
  type MusterTarget,
  type PartyRoster
} from '../shared/partyRoster';
import { bareName } from '../shared/items';
import { equipBlock, isWearable, type Wearer } from '../shared/gear';
import { Belongings, peekSpellbook } from './session/Belongings';
import type { BelongingsSink } from '../shared/belongings';
import { NO_LORE, type MobLore } from '../shared/lore';
import {
  SpellMessageBook,
  spellLoreOf,
  withRealmSpellNames,
  type SpellLore,
  type SpellMessageRow
} from '../shared/spell-messages';
import { loadSpellMessageRows } from './world/SpellMessages';
import { loadShippedSentences } from './world/ShippedSentences';
import { databaseTables, shopkeepers, type DatabaseTables } from './world/realmTables';
import { realmLoopCount, realmLoopsYielding } from './world/realmLoops';
import { openRealm } from './world/RealmSource';
import type { RealmSummary } from '../shared/realmFiles';
import { databaseLoopsCurrent, writeDatabaseLoops } from './world/realmLoopFiles';
import type { ShippedSentences } from '../shared/sentences';
import { NO_REALM_PLAYERS, type RealmPlayers } from '../shared/players';
import { NO_FIGHTS, type FightSink } from '../shared/fights';
import { FightLog } from './session/FightLog';
import { NO_TALK, TalkLog, type TalkSink } from './session/TalkLog';
import type { AreaOverrides } from './world/areas';
import { orderRing } from '../shared/hunting';
import { areaOfRooms, bossRooms, realmAreas } from './world/huntingAreas';
import {
  howItFights,
  loopGroups,
  priceAreaBothWays,
  sheetRead,
  type GroundArea,
  type GroundGroup,
  type GroundRoom,
  type HowItFights,
  type HuntingGrounds,
  type LairPrice
} from '../shared/huntingGrounds';
import { SessionHost } from './session/SessionHost';
import { WindowRegistry } from './windows/WindowRegistry';
import { Workspace } from './windows/Workspace';
import { quitGuard, type QuitAnswer } from './app/quit';
import { t } from './app/i18n';
import { claimHome, type HomeLock } from './app/homeLock';
import type { Caller, Host } from './host/Host';
import {
  Push,
  type Notice,
  type ProfileSummary,
  type Revealed,
  type SessionId
} from '../shared/ipc';
import {
  type SupplyItem,
  automationSwitches,
  DEFAULT_CONFIG,
  type AppConfig
} from '../shared/config';
import { DEFAULT_INTERNAL } from '../shared/internal';
import { asPlayerStance, isRemoteName, type PlayerGrant, type RemoteName } from '../shared/remotes';
import type { Profile } from '../shared/profiles';
import { type MessageTable } from '../shared/messageTriggers';
import { type MonsterTable } from '../shared/monsterRules';
import { mergeItemRules, type ItemTable } from '../shared/itemRules';
import type { MegaSettings } from '../shared/megamud/settings';
import { megamudFromConfig } from '../shared/megamud/fromConfig';
import type { MegaData } from './megamud/data';
import { megaDataFrom } from './megamud/fromWorld';
import { explorerAsk } from './mme/ExplorerThread';
import type { MmeParty } from './mme/Explorer';
import { DEFAULT_EXPLORER_OPTIONS, type ExplorerAs } from '../shared/explorer';
import { type EngineMemory, type MegaEngineSetup } from './session/MegaEngine';
import type { SessionSummary } from '../shared/ipc';
import { type CharacterState } from '../shared/character';
import { mergeLoops } from '../shared/loops';

/** The most a shared loop file may hold: far over any loop, far under a socket's message. */
const LOOP_FILE_MAX = 256 * 1024;
import { roomId, type RoomId, type WorldRoom } from '../shared/world';
import { errorMessage } from '../shared/values';
import { BUILD, versionWithCommit } from '../shared/build';
/*
 * The one field, by name. A default import would inline the whole manifest into
 * the main chunk — the maintainer's email address and every dependency's name
 * along with it — for one string. Vite turns a JSON module into named exports,
 * so this tree-shakes to the version and nothing else. Same instinct as the
 * comment stripping in `electron.vite.config.ts`: what ships is what somebody
 * is handed.
 */
import { version as APP_VERSION } from '../../package.json';
import { type ConnectionTarget } from '../shared/types';
import { registerSessionsIpc } from './ipc/sessions';
import { registerPlayIpc } from './ipc/play';
import { registerWorldIpc } from './ipc/world';
import { registerExplorerIpc } from './ipc/explorer';
import { registerSettingsIpc } from './ipc/settings';

/**
 * What is hosting this client. Assigned first thing in `startClient`, before
 * anything below can run: every function in this module is reached from a
 * handler, a store callback or a timer, and none of those exists until the
 * host has been handed over.
 */
let platform: Host;

/**
 * Where everything the client owns lives. Decided once, before anything reads.
 *
 * Not lazily and not per record: five different places used to join a path onto
 * `path.dirname(the options file)`, and a record written to the wrong directory
 * is not an error — it is a file nobody ever reads again. See `app/home.ts`.
 * Set beside `platform`, from the host's answer for the platform's own place.
 */
let asked: ReturnType<typeof homeRoot>;
let home: Home;
/**
 * The home, held for the life of the process. Taken before anything reads a
 * file and released last; see `app/homeLock.ts` for why a host's own
 * instance lock is not enough.
 */
let homeLock: HomeLock | null = null;

/** What a card may ask to have sent: one line of printable text, as long as a command runs. */
const ASKABLE = /^[\x20-\x7e]{1,80}$/;

/** What a session that has never been dialled reports. Keeps `attach` total. */
const IDLE_STATE = {
  phase: 'idle' as const,
  target: null,
  connectedAt: null,
  detail: null,
  endedBy: null,
  negotiated: {
    localEnabled: [],
    remoteEnabled: [],
    binary: false,
    suppressGoAhead: false,
    remoteEcho: false
  }
};

let config: ConfigStore | null = null;
/** The client's own settings, beside the options file. See `shared/internal.ts`. */
let internal: InternalStore | null = null;
let profiles: ProfileStore | null = null;
/** The servers on disk: `servers/<id>/server.yaml`. See `ServerStore`. */
let servers: ServerStore | null = null;
/** The loops on disk, at all three scopes. See `LoopStore`. */
let loops: LoopStore | null = null;
/** Each realm's imported tables: `servers/<id>/messages.yaml`, `monsters.yaml` and `items.yaml`. See `RealmTableStore`. */
let realmMessages: RealmTableStore<MessageTable> | null = null;
let realmMonsters: RealmTableStore<MonsterTable> | null = null;
let realmItems: RealmTableStore<ItemTable> | null = null;
/**
 * Every realm the client has been asked for.
 *
 * One graph per realm *file*, shared by every character that names it — 55,806
 * rooms indexed twice is a cost nobody asked for, and two characters on one
 * realm is the ordinary case.
 */
let realms: RealmLibrary | null = null;
let worldBook: WorldBook | null = null;
/**
 * Monster health learned by fighting, for every realm played.
 *
 * One store rather than one per character: it is keyed by realm, and two
 * characters on one realm should share what either of them learns. The file is
 * resolved from the options file's own directory so `MUDENGINE_CONFIG`
 * relocates it with everything else.
 */
let lore: RealmLore | null = null;
/** The shipped spell message table, read once on first use. See `spellLoreFor`. */
let spellMessages: SpellMessageRow[] | null = null;
/** That table as each realm names its spells, built once per realm. See `spellLoreFor`. */
const spellBooks = new Map<string, SpellMessageBook>();
/** The shipped emote and death-sentence tables, read once on first use. See `sentences`. */
let shippedSentences: ShippedSentences | null = null;
/**
 * What is known about the other players on every realm dialled.
 *
 * One store, keyed by the address a character dials, so every character on a
 * realm shares what any of them sees — Soul's kit is Soul's whichever
 * character looked — and none inherits another realm's people. See `PlayerBook`.
 */
let playerBook: PlayerBook | null = null;
/**
 * What the MegaMUD engine learns in play — monsters, items and players met,
 * room signatures — per realm, as MegaMUD keeps them in its data files. See
 * `MegaLearned`.
 */
let megaLearned: MegaLearned | null = null;
/**
 * Where characters on this machine have walked, per realm.
 *
 * One store, keyed on the realm *file* rather than on the address dialled — the
 * opposite of `playerBook` above, and deliberately: a destination is a room
 * **id**, and an id only means a place within the realm data that defines it.
 * Two servers sharing one map share these rooms; one server whose map was
 * swapped underneath it does not. See `DestinationBook`.
 */
let destinations: DestinationBook | null = null;
let movements: MovementBook | null = null;
/** The Party card's rosters, every realm's. See `PartyBook`. */
let parties: PartyBook | null = null;
/** Which window shows which characters. See `Workspace`. */
let workspace: Workspace | null = null;

/**
 * Windows are views; sessions are the app's. Neither owns the other, which is
 * what makes closing a window safe and popping a tab out possible.
 */
const windows = new WindowRegistry();
/** Who each character's Explorer answers for, where not as played. See `Invoke.explorerAs`. */
const explorerAs = new Map<SessionId, ExplorerAs>();
let host: SessionHost | null = null;

/**
 * Monster health learned by fighting.
 *
 * Beside the options file, so `MUDENGINE_CONFIG` relocates it along with the
 * characters and the realm cache — and so a smoke run cannot write into the
 * developer's own. Created after the config is resolved for exactly that
 * reason: the directory is not known until then.
 */
function createLore(): RealmLore {
  return new RealmLore({
    file: home.state('mob-lore.json'),
    notify: (message) => announce('lore', message)
  });
}

/** The realm data a saved realm's lore is kept under, as `loreFor` keys it; null for no such realm. */
function loreSourceOf(realm: unknown): string | null {
  const stored =
    typeof realm === 'string' ? servers?.all.find((entry) => entry.server.name === realm) : null;
  if (!stored) return null;
  const learned = worldBook?.at(realmAddress(stored.server)) ?? null;
  return realms?.load(stored.server.database, learned).graph?.info.source ?? 'none';
}

/** Beside the lore, for the same reasons `createLore` gives. */
function createDestinations(): DestinationBook {
  return new DestinationBook({
    file: home.state('destinations.json'),
    notify: (message) => announce('world', message)
  });
}

/** Beside the lore, for the same reasons `createLore` gives. */
function createMovements(): MovementBook {
  return new MovementBook({
    file: home.state('movement.json'),
    notify: (message) => announce('movement', message)
  });
}

/**
 * Hunting Grounds for a character (2026-10-29): every room it can reach, the
 * lair groups and bosses in them priced by MMUD Explorer's exp/hour for how
 * it fights (its MegaMUD settings, `howItFights`), and those gathered into
 * areas, each priced as a loop walks it (`priceArea`). See
 * `shared/huntingGrounds.ts`.
 */
async function huntingGroundsOf(
  session: SessionId,
  realm: { file: string } | string,
  asParty: boolean
): Promise<HuntingGrounds> {
  const refused = (refusal: string): HuntingGrounds => ({
    from: null,
    swept: 0,
    areas: [],
    party: null,
    setup: null,
    refusal
  });
  const manager = host?.get(session)?.manager;
  const profile = profileFor(session);
  const world = worldFor(session);
  if (!manager || !profile || !world) return refused(t('session.hunt.noSession'));
  if (typeof realm === 'string') return refused(realm);
  if (!sheetRead(manager.character)) return refused(t('session.hunt.notRead'));
  const swept = manager.huntingReach();
  if (typeof swept === 'string') return refused(swept);
  const { from, reach } = swept;
  const how = howItFights(megamudSettingsOf(session, profile).live);
  const party = asParty ? huntingPartyOf(session) : null;
  const { areaRadius, clockBound, maxDamageShare } = tuning().hunting;
  /*
   * The realm's areas, worked out once per load of its room data
   * (`realmAreas`): a lair group spread over several is priced an area at a
   * time (`LairAreas`), and each group goes to the area most of its rooms
   * are in, the best groups first so an area's order is its best's.
   */
  const places = realmAreas(world, areaRadius);
  const lairAreas = Object.fromEntries(places.areaOf);
  let answer: Awaited<ReturnType<typeof explorerAsk<'hunting'>>>;
  try {
    answer = await explorerAsk(
      'hunting',
      realm.file,
      manager.character,
      how,
      [...reach.keys()],
      party?.mme ?? null,
      lairAreas
    );
  } catch (error) {
    return refused(errorMessage(error));
  }
  if (!answer.supported) return refused(t('app.explorer.unsupported'));
  // Each group's rooms named and stepped; a room out of reach is not one to hunt.
  const groups: GroundGroup[] = answer.groups.flatMap((group) => {
    const rooms = group.rooms.flatMap(({ map, room }) => {
      const id = roomId(map, room);
      const steps = reach.get(id);
      const found = world.byId(id);
      return steps === undefined || !found ? [] : [{ id, map, room, name: found.name, steps }];
    });
    if (rooms.length === 0) return [];
    rooms.sort((a, b) => a.steps - b.steps);
    // The router's danger check, at full health: too dangerous a group is not hunted.
    return [{ ...group, rooms, danger: manager.huntingDanger(rooms.map((room) => room.id)) }];
  });
  const traveller = manager.travellerNow(manager.character);
  const byArea = new Map<string, GroundGroup[]>();
  for (const group of [...groups].sort((a, b) => (b.expPerHour ?? -1) - (a.expPerHour ?? -1))) {
    const area =
      areaOfRooms(
        places,
        group.rooms.map((room) => room.id)
      ) ?? group.key;
    byArea.set(area, [...(byArea.get(area) ?? []), group]);
  }
  const grouped = [...byArea.entries()].map(([key, members]) => ({
    key,
    name: places.areas.get(key)?.name ?? members[0]!.rooms[0]?.name ?? '',
    map: places.areas.get(key)?.map ?? members[0]!.rooms[0]?.map ?? 0,
    members
  }));
  /*
   * Each area's loop: its busy groups' lairs pooled and priced as one by MME,
   * as MME pools a monster's lairs. A loop of one group is that group's own
   * figure; the rest are asked for together.
   */
  const pools = grouped.map((area) => ({
    key: `pool:${area.key}`,
    groups: loopGroups(area.members, clockBound, maxDamageShare).map((group) => group.key)
  }));
  let pooled: LairPrice[] = [];
  try {
    pooled = await explorerAsk(
      'huntingPools',
      realm.file,
      manager.character,
      how,
      pools.filter((pool) => pool.groups.length > 1),
      party?.mme ?? null,
      lairAreas
    );
  } catch {
    // Unpriced pools fall back to their best group, below.
  }
  const roomsOf = (keys: readonly string[], members: readonly GroundGroup[]): GroundRoom[] => {
    const seen = new Set<RoomId>();
    return members
      .filter((group) => keys.includes(group.key))
      .flatMap((group) => group.rooms)
      .filter((room) => !seen.has(room.id) && (seen.add(room.id), true))
      .sort((a, b) => a.steps - b.steps);
  };
  const areas: GroundArea[] = grouped.flatMap((area, at) => {
    const pool = pools[at]!;
    const found = pooled.find((price) => price.key === pool.key);
    const loop: GroundGroup | null =
      found !== undefined
        ? { ...found, rooms: roomsOf(pool.groups, area.members) }
        : (area.members.find((group) => group.key === pool.groups[0]) ?? null);
    // With its bosses and, where it has any to fight, without them as well.
    return priceAreaBothWays(area.members, loop, clockBound, maxDamageShare).map((priced) => ({
      key: priced.bosses === 'without' ? `${area.key}:lairs` : area.key,
      name: area.name,
      map: area.map,
      steps: Math.min(...area.members.map((group) => group.rooms[0]?.steps ?? Infinity)),
      walk: [],
      ...priced
    }));
  });
  // What pays first, best first; an area too dangerous to hunt after everything that pays.
  areas.sort(
    (a, b) =>
      (b.expPerHour ?? -1) - (a.expPerHour ?? -1) ||
      Number(a.tooDangerous) - Number(b.tooDangerous) ||
      a.steps - b.steps
  );
  /*
   * The loop each of the best areas is walked by: the main group's lairs and
   * the added groups' rooms, nearest first round a ring of measured legs
   * (`orderRing`), an added room carrying its own clock so the lap walks to
   * it only when it is due (`LoopStop.every`). Priced without its bosses, the
   * loop leaves their rooms out too (`bossRooms`): a boss's room is often one
   * of the lairs, and walking into it is fighting it (2026-11-10).
   */
  const { clusterRadius, maxSpots } = tuning().hunting;
  for (const area of areas.slice(0, maxSpots)) {
    const lairs = area.loop?.rooms ?? [];
    const bosses =
      area.bosses === 'without'
        ? bossRooms(
            world,
            lairs.map((room) => room.id)
          )
        : new Set<RoomId>();
    if (bosses.size > 0) area.avoid = lairs.filter((room) => bosses.has(room.id));
    const stops = [
      ...lairs.filter((room) => !bosses.has(room.id)),
      ...area.groups.flatMap(({ group, role }) =>
        role === 'added'
          ? group.rooms.map((room) => ({ ...room, respawnSeconds: group.respawnMinutes * 60 }))
          : []
      )
    ];
    const sweeps = new Map<RoomId, Map<RoomId, number>>();
    const away = (room: WorldRoom): boolean => !bosses.has(roomId(room.map, room.room));
    for (const room of stops)
      sweeps.set(room.id, world.withinSteps(room.id, clusterRadius, traveller, away));
    const { order } = orderRing(
      [...stops].sort((a, b) => a.steps - b.steps),
      (a, b) => sweeps.get(a)?.get(b) ?? sweeps.get(b)?.get(a) ?? null
    );
    area.walk = order;
  }
  /*
   * A party's rates are the party's: MajorMUD splits a kill among everyone
   * fighting it, and MME divides its party estimate by the party's size.
   * Shown per member; the lap, which is the party's, is not.
   */
  const size = party?.mme.size ?? 1;
  if (size > 1) {
    const each = (rate: number | null): number | null => (rate === null ? null : rate / size);
    for (const area of areas) {
      area.expPerHour = each(area.expPerHour);
      if (area.loop !== null) area.loop = { ...area.loop, expPerHour: each(area.loop.expPerHour) };
      area.groups = area.groups.map((entry) => ({
        ...entry,
        group: { ...entry.group, expPerHour: each(entry.group.expPerHour) },
        contributes: entry.contributes / size
      }));
    }
  }
  return {
    from,
    swept: reach.size,
    areas,
    party: party === null ? null : { members: party.names, size },
    setup: answer.setup,
    refusal: null
  };
}

/**
 * The party a character hunts with (2026-10-29), off the party roster it is
 * on: the other members of ours in the realm, each as it plays and fights,
 * for MME's party box, and every player who would share a kill — ours in the
 * realm, and members not of ours. Null where it is on no roster, or alone.
 */
function huntingPartyOf(session: SessionId): { mme: MmeParty; names: string[] } | null {
  const realm = labelOf(session).server;
  const me = host?.get(session)?.manager.character.name ?? null;
  if (me === null || !parties) return null;
  const roster = parties.all.find(
    (entry) =>
      entry.realm === realm &&
      entry.members.some((member) => member.name.toLowerCase() === me.toLowerCase())
  );
  if (roster === undefined) return null;
  const kept = keptOn(realm);
  const forgotten = new Set(roster.forgotten.map((name) => name.toLowerCase()));
  const members: MmeParty['members'] = [];
  const names = [me];
  let strangers = 0;
  for (const { name } of roster.members) {
    const lower = name.toLowerCase();
    if (lower === me.toLowerCase() || forgotten.has(lower)) continue;
    const ours = kept.find((member) => member.character.name?.toLowerCase() === lower);
    if (ours === undefined) {
      strangers += 1;
      names.push(name);
      continue;
    }
    if (!ours.inGame) continue;
    const profile = profileFor(ours.session);
    if (profile === undefined) continue;
    members.push({
      state: ours.character,
      how: howItFights(megamudSettingsOf(ours.session, profile).live)
    });
    names.push(name);
  }
  const size = 1 + members.length + strangers;
  return size < 2 ? null : { mme: { size, members }, names };
}

/** How a character fights, off its MegaMUD settings, for MME's Attack settings (2026-10-29). */
function fightsOf(session: SessionId): HowItFights | null {
  const profile = profileFor(session);
  return profile === undefined ? null : howItFights(megamudSettingsOf(session, profile).live);
}

/** This client's characters on `realm`, as Regroup sees them. */
function keptOn(realm: string): KeptMember[] {
  if (!host) return [];
  const kept: KeptMember[] = [];
  for (const { id } of host.summaries) {
    if (labelOf(id).server !== realm) continue;
    const manager = host.get(id)?.manager;
    if (!manager || manager.character.name === null) continue;
    const character = manager.character;
    kept.push({
      session: id,
      character,
      inGame: manager.state.phase === 'connected' && character.phase === 'in-game',
      busy:
        character.inCombat ||
        manager.walkProgress.status === 'walking' ||
        manager.loopProgress.status === 'running'
    });
  }
  return kept;
}

/**
 * A roster made just now: started with its characters' own MegaMUD sys goto
 * words and every place the realm itself has listed for sys goto.
 */
function saveNewRoster(made: PartyRoster): PartyRoster[] {
  if (!parties) return [];
  const places = keptOn(made.realm)
    .map(({ session }) => host?.get(session)?.manager.megaMudop.place ?? '')
    .map(readPlace)
    .filter((place): place is string => place !== null);
  return parties.save({ ...made, places: withStatedPlaces(places, parties.gotoOn(made.realm)) });
}

/**
 * MMUD Explorer's damage simulation worked out before it is asked for
 * (2026-11-01): every monster's blows against a character in the realm, and
 * against its party where it has one, the two seconds a monster card or the
 * Hunting card would otherwise wait for. Looked at once the character has
 * held still for `hunting.explorerWarmMs`, and sent only when what the
 * simulation reads -- the realm, the sheet, what is worn, how it fights, the
 * party -- has changed since; the figures are kept per set of defences
 * (`explorerWarm`), so another character's warming takes nothing from this
 * one's.
 */
/** What of a character the damage simulation reads: its sheet, its gear and its book. */
function sheetOf(character: CharacterState): unknown[] {
  const { progress } = character;
  return [
    character.className,
    character.race,
    progress.level,
    [progress.strength, progress.intellect, progress.willpower],
    [progress.agility, progress.health, progress.charm],
    character.inventory.items.filter((item) => item.equipped).map((item) => item.name),
    character.spellbook?.map((spell) => spell.name) ?? []
  ];
}
const warmedAs = new Map<SessionId, string>();
const warmingSoon = new Set<SessionId>();
function warmExplorer(id: SessionId): void {
  if (warmingSoon.has(id) || host?.get(id)?.manager.character.phase !== 'in-game') return;
  warmingSoon.add(id);
  const timer = setTimeout(() => {
    warmingSoon.delete(id);
    const manager = host?.get(id)?.manager;
    if (manager === undefined || manager.character.phase !== 'in-game') return;
    const file = realms?.databaseFile(profileFor(id)?.database ?? '') ?? null;
    if (file === null || !existsSync(file)) return;
    const character = manager.character;
    const how = fightsOf(id);
    const party = huntingPartyOf(id)?.mme ?? null;
    const signature = JSON.stringify([
      file,
      sheetOf(character),
      how,
      party === null
        ? null
        : [party.size, party.members.map((member) => [sheetOf(member.state), member.how])]
    ]);
    if (warmedAs.get(id) === signature) return;
    warmedAs.set(id, signature);
    const options = { ...DEFAULT_EXPLORER_OPTIONS, fights: how };
    const started = Date.now();
    void explorerAsk('warm', file, character, options, how, party).then(
      // The log only, as the realm's load is: nothing a player needs told.
      () => console.log(`explorer: ${labelOf(id).name} warmed in ${Date.now() - started}ms`),
      // Asked again on the next change rather than taken as done.
      () => warmedAs.delete(id)
    );
  }, tuning().hunting.explorerWarmMs);
  timer.unref?.();
}

/**
 * Characters of ours whose party was disbanded from the Stable or the Party
 * card, by `realm|name`: no roster is made for them again until their listing
 * shows the party gone, or one made before the `disband` reached the realm
 * would bring the party back.
 */
const disbanded = new Set<string>();

/**
 * A party formed in the realm keeps a roster without being asked (2026-10-31):
 * Regroup, Muster and the Stable's party block are there for it as soon as
 * one of ours is in a party of two or more that no roster names. A member
 * the listing names that the roster does not is added to it, so the roster
 * follows the party as it grows; Disband is what forgets it. Making and
 * tearing down rosters by hand was too much overhead to ask of a party.
 */
function keepFormedParty(id: SessionId): void {
  const character = host?.get(id)?.manager.character;
  if (!parties || !character || character.name === null) return;
  const realm = labelOf(id).server;
  const self = `${realm}|${character.name.toLowerCase()}`;
  if (character.party.members.filter((member) => !member.invited).length < 2) {
    disbanded.delete(self);
    return;
  }
  if (disbanded.has(self)) return;
  const next = formedParty(parties.all, realm, character, randomUUID);
  if (next === null) return;
  if (parties.all.some((roster) => roster.id === next.id)) parties.save(next);
  else saveNewRoster(next);
}

/**
 * A roster's party broken up in the realm: the leader's `disband` where the
 * leader is ours and in the game, else each of ours in it leaves. Its members
 * of ours are kept from being given a roster again until it is gone.
 */
function disband(roster: PartyRoster): void {
  const ours = keptOn(roster.realm).filter(
    (member) =>
      member.character.name !== null &&
      roster.members.some((kept) => sameName(kept.name, member.character.name!))
  );
  for (const member of ours)
    disbanded.add(`${roster.realm}|${member.character.name!.toLowerCase()}`);
  const leader =
    roster.leader === null
      ? undefined
      : ours.find((member) => sameName(member.character.name!, roster.leader!));
  if (leader !== undefined && leader.inGame) {
    host?.get(leader.session)?.manager.partyCommand('disband', t('session.party.disband'));
    return;
  }
  for (const member of ours)
    if (member.inGame && member.character.party.members.length > 0)
      host
        ?.get(member.session)
        ?.manager.partyCommand(
          'leave',
          t('session.party.disbandLeave', { name: member.character.name! })
        );
}

/** One Regroup act, carried out by the character it names. Whether it was taken. */
function regroup(act: RegroupAct): boolean {
  const manager = host?.get(act.session)?.manager;
  if (!manager) return false;
  switch (act.act) {
    case 'invite':
      return manager.partyCommand(
        `invite ${act.name}`,
        t('session.party.regroupInvite', { name: act.name })
      );
    case 'join':
      return manager.partyJoin(act.leader, t('session.party.regroupJoin', { leader: act.leader }));
    case 'leave':
      return manager.partyCommand('leave', t('session.party.regroupLeave', { name: act.name }));
    case 'rank':
      return manager.partyCommand(
        `${act.rank}rank`,
        t('session.party.regroupRank', { rank: act.rank })
      );
    case 'askInvite':
      return manager.partyCommand(
        `/${act.leader} @invite`,
        t('session.party.regroupAsk', { leader: act.leader })
      );
    case 'walk':
      void manager.walkTo(act.to).then((refused) => {
        if (refused !== null)
          announce('party', t('session.party.regroupWalkRefused', { leader: act.leader, refused }));
      });
      return true;
  }
}

/** A Muster target from the window, parsed rather than trusted: it turns into commands. */
function asMusterTarget(value: unknown): MusterTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record['to'] === 'leader') return { to: 'leader' };
  const place = readPlace(record['place']);
  return record['to'] === 'place' && place !== null ? { to: 'place', place } : null;
}

/** Why a member of ours does not do a fanned-out command, in a line; null says nothing. */
const FAN_SKIP: Record<FanSkip, ((name: string) => string) | null> = {
  offline: (name) => t('session.party.musterSkip.offline', { name }),
  fighting: (name) => t('session.party.musterSkip.fighting', { name }),
  notMudop: (name) => t('session.party.musterSkip.notMudop', { name }),
  leaderUnknown: (name) => t('session.party.musterSkip.leaderUnknown', { name }),
  isLeader: (name) => t('session.party.musterSkip.isLeader', { name }),
  leftOut: null
};

/**
 * What each character of ours was just had do itself, by the leader it
 * would hear the same `@party` from: so that `@party` is not done twice
 * (`partyAlreadyDone`). Each is taken once, and only while fresh.
 */
const doneDirectly = new Map<string, number>();
const doneKey = (session: SessionId, leader: string, command: string): string =>
  `${session}|${leader.toLowerCase()}|${command.trim().toLowerCase()}`;

function partyAlreadyDone(session: SessionId, leader: string, command: string): boolean {
  const key = doneKey(session, leader, command);
  const at = doneDirectly.get(key);
  if (at === undefined) return false;
  doneDirectly.delete(key);
  return Date.now() - at < tuning().session.partyEchoMs;
}

/**
 * Commands fanned out across a party (`fanOutActs`), carried out: each
 * member of ours by `direct`, everybody else by the leader's `@party` of each
 * in turn, with every member of ours marked first as having done them — or
 * as left out of them — so none of them takes the leader's lines as theirs as
 * well. A line each for the card, which names the last command: the one the
 * others lead up to.
 */
function fanOut(
  roster: PartyRoster,
  acts: readonly FanAct[],
  commands: readonly string[],
  direct: (manager: SessionManager, act: FanAct) => string | null
): string[] {
  const leader = roster.leader;
  const command = commands[commands.length - 1] ?? '';
  if (leader !== null && acts.some((act) => act.act === 'atParty')) {
    for (const { session } of keptOn(roster.realm))
      for (const each of commands) doneDirectly.set(doneKey(session, leader, each), Date.now());
  }
  const said: string[] = [];
  /*
   * The leader's `@party` first, queued ahead of what the leader does itself:
   * its own `sys goto` takes it out of the party, and an `@party` sent after
   * that reaches nobody (2026-10-27).
   */
  const ordered = [
    ...acts.filter((act) => act.act === 'atParty'),
    ...acts.filter((act) => act.act !== 'atParty')
  ];
  for (const act of ordered) {
    const manager = host?.get(act.session)?.manager;
    if (!manager) continue;
    if (act.act === 'skip') {
      const line = FAN_SKIP[act.why]?.(act.name);
      if (line) said.push(line);
    } else if (act.act === 'atParty') {
      for (const each of commands)
        manager.partyCommand(
          `${manager.megaMudop.prefix}@party ${each}`,
          t('session.party.fanReason', { command: each })
        );
      said.push(
        t('session.party.fanAtParty', { name: act.name, command, others: act.others.join(', ') })
      );
    } else {
      const line = direct(manager, act);
      if (line) said.push(line);
    }
  }
  return said;
}

/** A Muster pressed, carried out: walking to the leader, or `sys goto` fanned out. */
function muster(roster: PartyRoster, target: MusterTarget): string[] {
  const ours = keptOn(roster.realm);
  const acts = musterActs(
    roster,
    ours,
    target,
    (session) => host?.get(session)?.manager.megaMudop.mudop ?? false
  );
  if (target.to === 'place') {
    const command = `sys goto ${target.place}`;
    /*
     * Out of any fight first, everybody: the others by the leader's
     * `@party break` ahead of the teleport, and ours each by its own engine,
     * which forgets the fight as well. The teleport takes everybody out of
     * the party, so it is put back together as they land (`reform`).
     */
    partyKeeper.reform(roster, tuning().session.partyReformMs);
    const said = fanOut(roster, acts as FanAct[], ['break', command], (manager, act) => {
      // A loop or a walk let go first: walked on from where the teleport lands, it is lost.
      manager.stopMoving();
      manager.breakCombat();
      manager.partyCommand(command, t('session.party.fanReason', { command }));
      return t('session.party.musterTeleport', { name: act.name, place: target.place });
    });
    /*
     * The realm says nothing when the teleport breaks the party, so the
     * leader's listing would still show everybody and Regroup find nobody to
     * invite: a leader of ours lists it again, queued behind its own goto.
     */
    const leader = acts.find(
      (act) => act.act === 'direct' && roster.leader !== null && sameName(act.name, roster.leader)
    );
    const manager = leader === undefined ? undefined : host?.get(leader.session)?.manager;
    if (manager?.partyCommand('par', t('session.party.reformReason')) === true)
      said.push(t('session.party.musterReform', { leader: roster.leader ?? '' }));
    return said;
  }
  return acts
    .map((act) => {
      if (act.act === 'walk') {
        void host
          ?.get(act.session)
          ?.manager.walkTo(act.to)
          .then((refused) => {
            if (refused !== null)
              announce('party', t('session.party.musterWalkRefused', { name: act.name, refused }));
          });
        return t('session.party.musterWalk', { name: act.name });
      }
      return act.act === 'skip' ? (FAN_SKIP[act.why]?.(act.name) ?? '') : '';
    })
    .filter((line) => line !== '');
}

/** Regroup: looks again whenever a character's state changes. See `PartyKeeper`. */
const partyKeeper = new PartyKeeper({
  againMs: () => tuning().session.partyRegroupAgainMs,
  run: regroup
});

/** Beside the lore, for the same reasons `createLore` gives; every window told of a change. */
function createParties(): PartyBook {
  return new PartyBook({
    file: home.state('parties.json'),
    notify: (message) => announce('party', message),
    changed: (rosters) => push(Push.partyRosters, rosters)
  });
}

/** Beside the lore, for the same reasons `createLore` gives. */
function createPlayerBook(): PlayerBook {
  return new PlayerBook({
    file: home.state('players.json'),
    notify: (message) => announce('players', message)
  });
}

/** Beside the lore, for the same reasons `createLore` gives. */
function createMegaLearned(): MegaLearned {
  return new MegaLearned({
    file: home.state('megamud-learned.json'),
    notify: (message) => announce('world', message)
  });
}

/** Which world each address has said it runs. Beside the lore, like the rest. */
function createWorldBook(): WorldBook {
  return new WorldBook({
    file: home.state('worlds.json'),
    notify: (message) => announce('world', message)
  });
}

function createRealms(): RealmLibrary {
  return new RealmLibrary({
    shippedDir: path.join(resourcesDir(), 'world'),
    /*
     * So a realm can name a database **beside the client's own files**,
     * relatively. No shipped realm does today -- the six that ship are Paradigm
     * and the built-in world is Paradigm's own database -- but `GMUD (5X)` did
     * until 2026-09-05, and the rule it established stands: an absolute path in
     * a shipped file exists on the one computer that wrote it, so the answer
     * for a database carried alongside the client is a relative path and
     * `RealmLibrary.resolve` is the one place that knows what it resolves
     * against.
     */
    resourcesDir: resourcesDir(),
    // Beside the options file, so `MUDENGINE_CONFIG` relocates it too and the
    // smoke test needs no second variable to forget.
    cacheDir: home.state('realms'),
    // Converting a realm takes a couple of seconds and happens while somebody
    // is watching a blank terminal wondering whether it worked.
    notify: (message) => announce('world', message, 'log')
  });
}

/**
 * The realm a character plays against.
 *
 * The **server's** database, not the character's: two characters on one realm
 * walk one map, so it is stated once beside the host and the menu script. See
 * `Server.database`. A realm stating none walks whichever bundled world it
 * named at its menu on an earlier connection (`WorldBook`), and the default
 * one, announced, until it has.
 *
 * Read through `profileFor` rather than captured, so an edited realm takes
 * effect on the next session rather than on the next restart. A session with no
 * profile — one whose file went while it was connected — gets the default
 * world, which is the honest answer when there is nothing left to ask.
 */
function worldFor(id: SessionId): WorldGraph | undefined {
  const profile = profileFor(id);
  const learned = profile ? (worldBook?.at(realmAddress(profile.target)) ?? null) : null;
  return realms?.load(profile?.database ?? '', learned).graph;
}

/**
 * What is known about the monsters this character will meet.
 *
 * Keyed on the realm rather than on the character: how much health a giant rat
 * has is a fact about the world, so four characters on one realm share what any
 * of them learns and none of them inherits another realm's monsters. See
 * `RealmLore`.
 */
function loreFor(id: SessionId): MobLore {
  const world = worldFor(id);
  // Before the store exists there is nothing to learn from and nowhere to
  // learn to, which is the honest answer rather than a reason to throw.
  return lore?.forRealm(world?.info.source ?? 'none', world) ?? NO_LORE;
}

/** mudmaps' hand tuning of the areas, read once (`resources/world/areas.json`). */
let areaTuning: AreaOverrides | null = null;

function areaOverrides(): AreaOverrides {
  if (areaTuning === null) {
    try {
      areaTuning = JSON.parse(
        readFileSync(path.join(resourcesDir(), 'world', 'areas.json'), 'utf8')
      ) as AreaOverrides;
    } catch (error) {
      // The areas are still carved, untuned: Silvermere's streets as several.
      announce('world', `areas.json unread: ${errorMessage(error)}`);
      areaTuning = {};
    }
  }
  return areaTuning;
}

/**
 * The sentences a spell prints when it lands and when it ends.
 *
 * The shipped half is one file for every realm (`resources/world/
 * spell-messages.csv`, the server's message data by spell name); the learned
 * half is kept by `RealmLore` beside the monster health, keyed on the realm
 * for the same reason — a sentence the server prints for a spell is a fact
 * about the world. Before the store exists the shipped table is still read,
 * and what is learned then goes nowhere, which is the honest answer.
 */
function spellLoreFor(id: SessionId): SpellLore {
  spellMessages ??= loadSpellMessageRows(
    path.join(resourcesDir(), 'world', 'spell-messages.csv'),
    (message) => announce('world', message)
  );
  const world = worldFor(id);
  const realm = world?.info.source ?? 'none';
  /*
   * Under the realm's own spell names as well as the file's, joined by the
   * message record each row carries (`withRealmSpellNames`): a derivative
   * realm renames spells and keeps their sentences.
   */
  let shipped = spellBooks.get(realm);
  if (shipped === undefined) {
    const rows = world ? withRealmSpellNames(spellMessages, world.allSpells()) : spellMessages;
    shipped = SpellMessageBook.fromRows(rows);
    spellBooks.set(realm, shipped);
  }
  return lore?.spellsFor(realm, shipped) ?? spellLoreOf(shipped, new SpellMessageBook());
}

/**
 * The server's own words for an emote and for a monster dying, one pair for
 * every session: neither is a fact about a realm, so neither is keyed on one.
 * Read on first use, like the spell table, and reported the same way.
 */
function sentences(): ShippedSentences {
  shippedSentences ??= loadShippedSentences(path.join(resourcesDir(), 'world'), (message) =>
    announce('world', message)
  );
  return shippedSentences;
}

/**
 * Where this character's realm has been walked to.
 *
 * Keyed on the realm file, exactly as `loreFor` is, because a destination is a
 * room **id** and an id only means a place within the data that defines it.
 * Before the store exists there is nowhere to write and nothing to read, and a
 * pair of no-ops is the honest answer rather than a reason to throw.
 */
function destinationsFor(id: SessionId): RealmDestinations {
  const world = worldFor(id);
  return (
    destinations?.forRealm(world?.info.source ?? 'none') ?? {
      remember: () => {},
      matching: () => []
    }
  );
}

/**
 * What is known about the other players at one address.
 *
 * Keyed on the **address dialled**, not on the world file the lore uses: Soul
 * on GreaterMUD is not Soul on a MajorMUD board that ships the same map data,
 * and two server entries that dial one address are one realm. The host asks
 * with the address each connection actually goes to.
 */
function playersAt(target: ConnectionTarget): RealmPlayers {
  return playerBook?.forRealm(realmAddress(target)) ?? NO_REALM_PLAYERS;
}

/** The same, for where a character's own file says it plays — what a session starts seeded from. */
function playersFor(id: SessionId): RealmPlayers {
  const target = profileFor(id)?.target;
  return target ? playersAt(target) : NO_REALM_PLAYERS;
}

/**
 * Where what a character has learned about its realm is kept.
 *
 * One file per character, beside the options file and the profiles — which is
 * what makes `MUDENGINE_CONFIG` relocate it with everything else, and what keeps
 * a test run from writing into somebody's real record.
 *
 * Kept open for the life of the session and closed on quit, so the deferred
 * write has somewhere to land. Built lazily rather than per call: a store
 * constructed on every block would re-read the file on every block.
 */
const memories = new Map<SessionId, WorldMemory>();
/**
 * The realm-wide half of each character's memory, one store per realm.
 *
 * What a shop turns out to stock is a fact about the *world*, not about
 * whichever character walked in and typed `list` — the same reasoning that puts
 * learned monster health in `RealmLore` and other players in `PlayerBook`. Kept
 * per character it was re-learned by every character in turn, each spending the
 * command that teaches it. Keyed on the realm file, like the lore, because the
 * room numbers only mean the same places within one map.
 */
const realmMemories = new Map<string, WorldMemory>();

/** The shared half for a realm, created on first use. See `realmMemories`. */
function realmMemoryFor(realm: string): WorldMemory {
  const existing = realmMemories.get(realmKey(realm));
  if (existing) return existing;
  const store = new WorldMemory(
    home.state('memory', `realm-${realmKey(realm)}.json`),
    realm,
    (message) => announce('memory', message)
  );
  realmMemories.set(realmKey(realm), store);
  return store;
}

/**
 * One find log per realm, created on first use.
 *
 * Keyed exactly as `realmMemories` is and for the same reason: a room number
 * only means a place within one map, so a find written against the shipped
 * realm says nothing about a private one.
 */
const realmFinds = new Map<string, FindBook>();

function findsFor(id: SessionId): FindBook | undefined {
  const realm = worldFor(id)?.info.source;
  // Nothing to be wrong about and nothing to write against: see `memoryFor`.
  if (realm === undefined) return undefined;
  return findsForRealm(realm);
}

function findsForRealm(realm: string): FindBook {
  const existing = realmFinds.get(realmKey(realm));
  if (existing) return existing;
  const store = new FindBook(
    home.state('memory', `finds-${realmKey(realm)}.json`),
    realm,
    (message) => announce('memory', message)
  );
  realmFinds.set(realmKey(realm), store);
  return store;
}

function memoryFor(id: SessionId): WorldMemory | undefined {
  const existing = memories.get(id);
  if (existing) return existing;

  const world = worldFor(id);
  /*
   * Keyed by realm, because an edge learned on the shipped realm says nothing
   * about a private one — the room numbers do not even mean the same places.
   * With no realm data at all there is nothing to be wrong about and nothing
   * to learn against, so nothing is kept.
   */
  const realm = world?.info.source;
  if (realm === undefined) return undefined;

  const store = new WorldMemory(home.state('memory', `${id}.json`), realm, (message) =>
    announce('memory', message)
  );
  memories.set(id, store);
  return store;
}

/**
 * What a session learns about its realm — its own exits, and the realm's shops.
 *
 * See `SplitMemory`: an exit is this character's exploration and a shop's stock
 * is the world's, so the two halves are kept in two files and routed by reason.
 */
function splitMemoryFor(id: SessionId): RealmMemory | undefined {
  const own = memoryFor(id);
  if (!own) return undefined;
  const realm = worldFor(id)?.info.source;
  // `memoryFor` already returned undefined without a realm, so this is only
  // reachable with one; checked rather than asserted because the two reads are
  // separate calls and an unchecked `!` here would be a claim about that.
  if (realm === undefined) return own;
  return new SplitMemory(own, realmMemoryFor(realm));
}

/**
 * Where a character's fights are written down.
 *
 * Beside the options file like the memory and the lore, so `MUDENGINE_CONFIG`
 * relocates every record together and a test run cannot write into somebody's
 * real one. Kept open for the life of the session and flushed on quit, because
 * the write is deferred and quitting is exactly when a deferred write has not
 * happened yet.
 *
 * Off when `logging.fights` is off, and then it writes nothing rather than
 * writing an empty file: a setting that leaves a file behind has not been
 * turned off.
 */
const fightLogs = new Map<SessionId, FightLog>();

function fightsFor(id: SessionId): FightSink {
  if (!(config?.config.logging.fights ?? DEFAULT_CONFIG.logging.fights)) return NO_FIGHTS;
  const existing = fightLogs.get(id);
  if (existing) return existing;
  const log = new FightLog(
    home.state('fights', `${id}.jsonl.gz`),
    { notice: (message) => announce('fights', message) },
    config?.config.logging.maxBytes ?? DEFAULT_CONFIG.logging.maxBytes
  );
  fightLogs.set(id, log);
  // Folded now, off the thread: the hunting survey asks synchronously, and
  // automatic hunting's first survey would otherwise price nothing and keep
  // that answer until the level moved. `ready` never rejects.
  void log.ready();
  return log;
}

/**
 * The Talk card's history, per character, beside the fights and for the same
 * reason: what somebody said outlives the socket, and a restart that started
 * the card empty was a conversation lost.
 *
 * Off when `logging.conversations` is off, and then nothing is written and
 * nothing restored — the FightLog's rule. Retention is read at creation,
 * which is when the prune happens; a config edit reaches the next launch.
 */
const talkLogs = new Map<SessionId, TalkLog>();

function talkFor(id: SessionId): TalkSink {
  if (!(config?.config.logging.conversations ?? DEFAULT_CONFIG.logging.conversations)) {
    return NO_TALK;
  }
  const existing = talkLogs.get(id);
  if (existing) return existing;
  const log = new TalkLog(
    home.state('talk', `${id}.jsonl`),
    config?.config.logging.conversationDays ?? DEFAULT_CONFIG.logging.conversationDays,
    { notice: (message) => announce('talk', message) }
  );
  talkLogs.set(id, log);
  return log;
}

/**
 * A character's own record — what each bank holds, and what was in each worn
 * slot.
 *
 * Beside the memory and the fights, and keyed on **both** the character and the
 * address it dialled: what is in Rand's vault is not in Probe's, neither is the
 * kit on Rand's back, and both belong to the server — so a character dialled at
 * a saved realm from the palette must not be shown either from somewhere else.
 * That second key is why this is built at connect rather than at session
 * creation like `memoryFor`: the address is not known until then.
 *
 * A session that re-dials a *different* realm gets a different record, and the
 * one it had is closed on the way out so its deferred write lands.
 */
const belongings = new Map<SessionId, Belongings>();

function belongingsAt(id: SessionId, target: ConnectionTarget): BelongingsSink {
  const realm = realmAddress(target);
  const existing = belongings.get(id);
  if (existing) {
    if (existing.realm === realm) return existing;
    existing.close();
  }
  const record = new Belongings({
    file: home.state('belongings', `${id}.json`),
    realm,
    notify: (message) => announce('belongings', message)
  });
  belongings.set(id, record);
  return record;
}

/**
 * Whether the realm says an item goes in a slot, **and that this character may
 * have it**.
 *
 * The realm's own `Worn` code, read through the item table, and **not** a guess
 * from the name or from the item's kind. Without it *Equip all* would send
 * `wear healing potion` once per potion, each answered with a refusal, out of
 * the same budget. An item the realm does not carry answers no: a private
 * realm's own item is exactly where the client knows nothing, and refusing
 * costs a button where guessing costs a broadcast.
 *
 * The restriction half is the same `equipBlock` the pack's own row button
 * draws from, for the reason `shared/gear.ts` exists at all: a bulk action that
 * sent `wear` at the four items the card had just struck through would spend
 * four commands to be refused four times, and the two halves of one question
 * would disagree on screen. Unknown still refuses nothing — a character whose
 * stat sheet has not printed gets the same *Equip all* it always had.
 */
function wearableIn(session: SessionId, name: string): boolean {
  const world = worldFor(session);
  if (!world) return false;
  const key = bareName(name);
  const item = world.itemsNamed([key])[key];
  if (!isWearable(item)) return false;
  return equipBlock(item, wearerIn(session)) === null;
}

/**
 * Who this character is, in the realm's own row ids.
 *
 * Shared by the `wearer` query the pack asks and by `wearableIn` above, so the
 * card and the bulk action cannot resolve the same character two ways.
 */
function wearerIn(session: SessionId): Wearer {
  const state = host?.get(session)?.manager.character;
  const world = worldFor(session);
  return {
    classId: world && state?.className ? world.classId(state.className) : null,
    raceId: world && state?.race ? world.raceId(state.race) : null,
    level: state?.progress.level ?? null,
    strength: state?.progress.strength ?? null,
    classNames: world?.namedClasses() ?? {},
    raceNames: world?.namedRaces() ?? {}
  };
}

/**
 * How a character should be named on screen and in a file it produces.
 *
 * A top-level function rather than a closure inside the host's options because
 * a bug report has to name the character it is about, and that is asked from an
 * IPC handler rather than from the rail.
 *
 * The name the *realm* gave them wins, because that is who the player thinks
 * they are: a profile's display name is a filename until the stat sheet
 * arrives, and "Main" identifies nobody. The server comes along so that two
 * characters on two realms are told apart at a glance.
 */
function labelOf(id: SessionId): { name: string; server: string; accent: string } {
  const profile = profileFor(id);
  const learned = host?.get(id)?.manager.character.name ?? null;
  const target = host?.get(id)?.manager.state.target;
  return {
    name: learned ?? profile?.name ?? id,
    server: profile?.serverName ?? target?.host ?? '',
    accent: profile?.accent ?? 'cyan'
  };
}

/**
 * Which mudengine this is.
 *
 * **Not `app.getVersion()` alone.** In a package that reads the version
 * electron-builder wrote into the app's `package.json`; in development the app
 * path is not this project's, so it answers with *Electron's* version — the
 * first report this wrote said `version 33.4.11` next to `Electron 33.4.11`,
 * which tells whoever is diagnosing it nothing at all. The repository's own
 * `package.json` is bundled at build time and is the same file electron-builder
 * takes the packaged version from, so the two cannot disagree. The commit it
 * was built from rides beside it (`src/shared/build.ts`).
 */
function appVersion(): string {
  return versionWithCommit(APP_VERSION, BUILD, t);
}

/** Where session logs go: the configured directory, or the per-user data dir. */
function logDirectory(): string {
  const configured = config?.config.logging.directory ?? '';
  return configured.length > 0 ? configured : home.state('logs');
}

/**
 * The bundled resources directory.
 *
 * electron-builder flattens `resources/` into the app's own resources root, so
 * the `resources/` path segment exists only in the source tree.
 *
 * In development this cannot be derived from one path: launching the built
 * main directly puts it at `<root>/out`, while `electron-vite dev` puts it at
 * `<root>`. Depending on one of those silently found no resources under the
 * other — the realm data failed to load and the annotated config template was
 * quietly replaced by an empty file. The host names its candidates and they
 * are probed here for a file that must be there.
 */
function resourcesDir(): string {
  if (platform.resourcesPath !== null) return platform.resourcesPath;

  const candidates = platform.resourceCandidates();
  const found = candidates.find((dir) => existsSync(path.join(dir, 'config', 'default.yaml')));
  if (!found) console.warn(`resources: none of ${candidates.join(', ')} look right`);
  return found ?? candidates[0]!;
}

/**
 * The client's own icon, as a file on disk.
 *
 * Beside the realm data in `resources/`, which electron-builder flattens into
 * the package's resources root — so one path answers for a package and for a
 * development run alike. `build/icon.png` is the *packaging* copy and is never
 * shipped inside the app; this is the one the running window uses.
 */
function appIcon(): string {
  return path.join(resourcesDir(), 'icon.png');
}

/**
 * Where an options file may be sitting from before the tree existed.
 *
 * Two places, and both of them are history: `<userData>/config.yaml` is where a
 * packaged build kept it, and `resources/config/user.yaml` is where a
 * development run did — inside the source checkout, which is how a player's
 * real characters and their real passwords came to live in a git working tree.
 * `migrateHome` moves the first of these that exists, with everything beside
 * it, and then this list never matches again.
 */
function legacyOptionsFiles(): string[] {
  return [
    path.join(home.root, 'config.yaml'),
    platform.packaged ? '' : path.join(resourcesDir(), 'config', 'user.yaml')
  ];
}

function configTemplate(): string {
  return path.join(resourcesDir(), 'config', 'default.yaml');
}

/**
 * Puts the realms on disk the first time, so a fresh client has somewhere to
 * play rather than an empty Realms page.
 *
 * Six of them, one directory each: Paradigm's four game realms and its two
 * test realms, which is what the client ships for — `resources/world/` is
 * built from Paradigm's own database. The same reasoning as the options
 * template being copied on first run, and the same failure it avoids: a
 * feature nobody can find is one that was never built.
 *
 * Copied **only when the directory does not exist at all** — not per file —
 * so somebody who deleted a realm does not get it back on every launch, which
 * is a client arguing with a decision they made.
 */
function seedServers(): void {
  if (existsSync(home.serversDir)) return;
  const shipped = path.join(resourcesDir(), 'servers');
  if (!existsSync(shipped)) return;
  try {
    cpSync(shipped, home.serversDir, { recursive: true });
  } catch (error) {
    console.warn(`servers: could not copy the shipped realms: ${String(error)}`);
  }
}

function profileTemplate(): string {
  return path.join(resourcesDir(), 'config', 'profile.default.yaml');
}

/** The client's own settings template, copied beside the options on first run. */
function internalTemplate(): string {
  return path.join(resourcesDir(), 'config', 'internal.yaml');
}

/** The shipped loops, read once. See `LoopCatalogue`. */
let catalogue: LoopCatalogue | null = null;

/*
 * Lazily, and not at startup like the realm data: the realm is announced on the
 * way up precisely so a package that cannot find it says so, and it is needed
 * to route anywhere. This is needed only by a screen somebody has to open.
 */
function loopCatalogue(): LoopCatalogue {
  catalogue ??= new LoopCatalogue(path.join(resourcesDir(), 'loops', 'megamud.yaml'));
  return catalogue;
}

/** MegaMUD's databases as last built, by character: rebuilt when what they are built from changes. */
const megaDataBuilt = new Map<
  SessionId,
  { from: readonly unknown[]; data: MegaData; serial: number }
>();
/** Each build's number, which the engine's key carries so a running engine is handed a rebuild. */
let megaDataBuilds = 0;

/**
 * A character's MegaMUD settings: its file's, or, where it has none yet,
 * started from what it did under the old automation (`megamudFromConfig`),
 * written to the file at its first edit. Every character runs on the engine
 * (2026-10-14).
 */
function megamudSettingsOf(id: SessionId, profile: Profile): MegaSettings {
  if (profile.megamudOn) return profile.megamud;
  const world = worldFor(id);
  return megamudFromConfig(
    profile.config.automation,
    (spell) => world?.spellNamed(spell)?.short ?? spell
  );
}

/**
 * A character's MegaMUD databases, built from its realm's data and tables
 * with its own item rows laid over them, and kept until what they are built
 * from changes: what its engine is given, and what its settings boxes
 * suggest (`megamudNames`) whether or not it is connected.
 */
function megaDataFor(id: SessionId, profile: Profile): MegaData {
  const runic = profile.config.connection.coins.runic;
  const world = worldFor(id);
  const tables = realmTablesFor(id);
  const own = profile.config.automation.loot.itemDetails;
  // The character's rows by what they say: its file is read again on every
  // save (its MegaMUD settings save as they are changed), and a fresh array
  // saying the same thing is no reason to build the databases again.
  const from = [world, tables.items, JSON.stringify(own), tables.messages, runic] as const;
  let built = megaDataBuilt.get(id);
  if (built === undefined || built.from.some((part, i) => part !== from[i])) {
    // The realm's item table with the character's own rows laid over it.
    const items = mergeItemRules(tables.items, own);
    built = {
      from,
      data: megaDataFrom(world, { items, messages: tables.messages }, runic),
      serial: (megaDataBuilds += 1)
    };
    megaDataBuilt.set(id, built);
    // Said once a build, so what a character's engine was given is on record.
    announce(
      'world',
      t('notices.world.megamudData', {
        name: profile.name,
        realm: world?.info.source || '-',
        monsters: built.data.monsters.length,
        items: built.data.items.length,
        spells: built.data.spells.length,
        messages: built.data.messages?.length ?? 0
      }),
      'log'
    );
  }
  return built.data;
}

/**
 * The ported MegaMUD engine's set-up: the character's settings, its
 * databases built from the realm's data and tables (`megamud/fromWorld.ts`)
 * and its per-player remote grants.
 */
function megamudFor(id: SessionId): { key: string; setup: MegaEngineSetup } | null {
  const profile = profileFor(id);
  if (profile === undefined) return null;
  const grants = profile.config.automation.remotes.players;
  const joinWhenInvited = profile.config.automation.remotes.autoJoin;
  const botCommands = profile.config.automation.remotes.commands;
  // The realm's name for its runic coin (BBS.INI's `RunicName`, ours per realm).
  const runic = profile.config.connection.coins.runic;
  const world = worldFor(id);
  const data = megaDataFor(id, profile);
  /*
   * The build in the key (2026-10-29): a table changed under a running
   * engine rebuilds its databases, and without it the key stayed as it was
   * and the engine kept the old ones — Skinny held by weakness after its
   * wait was taken off.
   */
  const dataKey = `${world?.info.source ?? ''}|${runic ?? ''}|${megaDataBuilt.get(id)?.serial ?? 0}`;
  // What it knows from before on this realm, out of our stores, and where
  // what it learns goes: stances to the lore, the rest to `MegaLearned`.
  // Players our tracker keeps in `PlayerBook` already.
  const realm = worldFor(id)?.info.source ?? '';
  const store = megaLearned;
  const realmLore = lore;
  let memory: EngineMemory | undefined;
  if (store !== null && realmLore !== null && realm !== '') {
    const kept = store.forRealm(realm);
    memory = {
      stances: realmLore.stancesFor(realm),
      players: playersAt(profile.target).recall(),
      items: kept.items,
      signatures: kept.signatures,
      marks: kept.marks[profile.name.toLowerCase()] ?? [],
      keep: (lessons) => {
        const at = Date.now();
        for (const [mob, relationship] of lessons.stances) {
          realmLore.learnStance(realm, mob, relationship, at);
        }
        if (lessons.items.length > 0 || lessons.signatures.length > 0 || lessons.marks !== null) {
          store.keep(realm, {
            items: lessons.items,
            signatures: lessons.signatures,
            ...(lessons.marks !== null ? { marks: { [profile.name]: lessons.marks } } : {})
          });
        }
      }
    };
  }
  // The BBS set-up MegaMUD reads from BBS.INI, from the realm's own settings:
  // its `bbs:`, and its runic coin's name (`coins: runic`).
  const bbs: Record<string, string> = {
    ...profile.config.connection.bbs,
    ...(runic !== undefined ? { RunicName: runic } : {})
  };
  // The account MegaMUD's BBS tab keeps (its `{userid}` and `{pswd}`) is the
  // character's own login, which the Character page edits (2026-10-14).
  const { username, password } = profile.config.connection.login;
  const settings = structuredClone(megamudSettingsOf(id, profile));
  if (username !== '') settings.live['BBS']!['UserID'] = username;
  if (password !== '') settings.live['BBS']!['Password'] = password;
  return {
    key: `${dataKey}\n${JSON.stringify([settings, grants, joinWhenInvited, botCommands, bbs])}`,
    setup: {
      settings,
      data,
      grants,
      joinWhenInvited,
      botCommands,
      ...(memory ? { memory } : {}),
      bbs
    }
  };
}

/** The character with this id, if a profile file defines one. */
function profileFor(id: SessionId): Profile | undefined {
  return profiles?.profiles.find((profile) => profile.id === id);
}

/**
 * The options one session runs under: its profile's overlay.
 *
 * The global file answers only for a session whose file has gone while it was
 * connected — deleting a file is an edit, and an edit must not cut a socket —
 * and that session keeps the client's defaults until it is idle and closes.
 * Nothing else runs without a profile.
 */
function configFor(id: SessionId): AppConfig {
  return profileFor(id)?.config ?? config?.config ?? DEFAULT_CONFIG;
}

/** Pushes an app-level payload to every live window. */
function push(channel: string, payload: unknown): void {
  windows.toAll(channel, payload);
}

/** An engine message. A null session means it is about the client, not a character. */
function notice(message: string, session: SessionId | null = null): void {
  const payload: Notice = { session, message };
  push(Push.notice, payload);
  /*
   * And to stdout.
   *
   * A notice is the client explaining itself — an options file that will not
   * parse, a character that cannot load, a realm that had to be fallen back
   * from. It reaches the terminal, which xterm draws to a *canvas*: not in the
   * DOM, not in a log file, and gone the moment the window is closed. When
   * somebody asks why the client did something, this is the record, and a
   * packaged app's stdout is where it can actually be read from.
   */
  console.log(session === null ? `notice: ${message}` : `notice[${session}]: ${message}`);
}

/**
 * A subsystem explaining itself, in both places at once: the terminal gets the
 * notice, and stdout gets the same line with who is speaking in front — the
 * record that survives the window closing. One helper because the nine stores
 * that report this way had each restated the pair inline.
 */
function announce(prefix: string, message: string, level: 'log' | 'warn' = 'warn'): void {
  /*
   * The push, then the record — the same two places `notice` writes to, and
   * deliberately not by calling it. It did, and so every line a store reported
   * appeared on stdout **twice**: once as `world: Converting the realm
   * database…` and again as `notice: Converting the realm database…`. The
   * subsystem prefix is what this helper exists to add, so it is the one that
   * stays; `notice` keeps its own for the callers that speak for the client
   * rather than for a store.
   */
  const payload: Notice = { session: null, message };
  push(Push.notice, payload);
  console[level](`${prefix}: ${message}`);
}

function createConfig(): ConfigStore {
  /*
   * Bring the file up to the template before anything reads it.
   *
   * The client used to *report* the gap instead, on every reload, and the
   * report was the thing people actually saw: a file that had correctly
   * dropped `servers:` when realms became directories was told it was out of
   * date every few seconds, for ever. Filling the gap leaves nothing to say —
   * see `reconcileWithTemplate`, which only ever adds a block that is absent.
   */
  const brought = reconcileWithTemplate(home.options, configTemplate());
  // Said once, when something actually changed. This is the only code besides
  // `migrateHome` that edits a file somebody else wrote, and a client that
  // rewrites your options silently is one you cannot trust with them.
  if (brought.added.length > 0) {
    notice(t('app.config.templateAdded', { added: brought.added.join(', ') }));
  }
  if (brought.error !== null) {
    notice(t('app.config.templateReconcileFailed', { error: brought.error }));
  }

  const store = new ConfigStore({
    /*
     * One place, always. There is no search any more: `home` decided where the
     * tree is before anything read from it, and `migrateHome` has already
     * brought an older layout across, so a file that is not there is a first
     * run rather than a file somewhere else.
     */
    override: home.options,
    searchPaths: [home.options],
    template: configTemplate()
  });

  store.on('change', (snapshot) => {
    push(Push.config, snapshot);
    /*
     * Profiles are overlays on this file, so a reload has to be reapplied to
     * every character before anything reads it back. `refresh` re-resolves them
     * against the new base and emits, which is what reconfigures the sessions.
     */
    if (profiles) profiles.refresh();
    else host?.reconfigure();
    /*
     * Only when something went wrong.
     *
     * A parse error has to be visible or a silently ignored edit reads as a
     * broken watcher. A *successful* reload does not: the file is polled twice
     * a second and every save an editor makes is a reload, so announcing them
     * put three identical lines in the console for one Ctrl-S and pushed the
     * game off the screen. What changed is already visible in the thing that
     * changed.
     */
    if (snapshot.error) notice(t('app.config.reloadFailed', { error: snapshot.error }));
  });

  store.watch();
  return store;
}

/**
 * Brings the set of live sessions in line with the set of profile files.
 *
 * Adding a character is dropping a YAML file in; removing one is deleting it.
 * The asymmetry is deliberate: **a file disappearing never disconnects a live
 * character.** Deleting a file is an edit, and an edit must not be able to cut
 * a socket out from under someone who is standing in a dangerous room. The
 * session stays until it is idle, and says so.
 */
function syncSessions(snapshot: ProfileSnapshot): void {
  if (!host) return;

  for (const profile of snapshot.profiles) {
    if (unloaded.has(profile.id)) continue;
    host.ensure(profile.id);
  }

  /*
   * With no profiles at all there is no session. There used to be one — an
   * anonymous session driven by `connection:`, the shape the client had before
   * profiles existed — and every feature since had to carve a case out for it
   * (retired 2026-08-29; see `NO_SESSION`). Making a character is step one, so
   * the renderer opens the new-character form, and this says so once.
   *
   * Once per launch: a message repeated on every profile poll is a message
   * nobody reads. To stdout as well as the window, because with no session
   * there is no console for it to land in.
   */
  if (snapshot.profiles.length === 0 && !saidHowToAddACharacter) {
    saidHowToAddACharacter = true;
    notice(t('app.onboarding.noCharactersYet'));
  }

  const known = new Set(snapshot.profiles.map((profile) => profile.id));
  for (const id of host.ids) {
    if (known.has(id)) continue;

    const phase = host.get(id)?.manager.state.phase;
    if (phase !== undefined && !DORMANT_PHASES.has(phase)) {
      notice(t('app.profiles.fileGoneStillConnected', { id }), id);
      continue;
    }
    host.remove(id);
  }

  // Profiles are overlays, so any change to one — or to the file underneath it
  // — has to reach the running session.
  host.reconfigure();

  for (const error of snapshot.errors) notice(t('app.profiles.loadFailed', { error }));
}

/**
 * Whether the "no characters yet" line has been said this launch.
 *
 * Profiles are polled, so without this it would be said every poll — and a
 * message repeated forever is one nobody reads, including the times it matters.
 */
let saidHowToAddACharacter = false;

/** Phases in which a session is not holding a socket and can safely be dropped. */
const DORMANT_PHASES = new Set(['idle', 'closed', 'error']);

/**
 * Characters the player has closed.
 *
 * A profile file is the statement that a character *exists*; a tab is the
 * statement that they are playing it now. Without this set, closing a tab would
 * be undone by the next directory poll, which is a close button that does not
 * close. Kept for the life of the process — which window layout persists across
 * restarts is step 5's problem, not this one's.
 */
const unloaded = new Set<SessionId>();

/**
 * A list of remotes off the wire, or `null` if any of it is not one.
 *
 * **Refused whole, never filtered.** Dropping the unrecognised entries and
 * writing the rest would silently write a permission somebody did not choose —
 * and the direction that is safe in an options file (drop, narrow) is the wrong
 * one for a click, where the honest answer is that the client did not
 * understand and nothing was written.
 */
function asRemoteNames(value: unknown): RemoteName[] | null {
  if (!Array.isArray(value)) return null;
  const names: RemoteName[] = [];
  for (const entry of value) {
    if (!isRemoteName(entry)) return null;
    names.push(entry);
  }
  return names;
}

/**
 * A supplies list off the wire, or `null`. Parse, do not validate: every row
 * is rebuilt from the fields this accepts, so nothing else on the payload
 * reaches the file. Bounded as the normaliser bounds it.
 */
function asSupplyItems(value: unknown): SupplyItem[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const items: SupplyItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const row = entry as Record<string, unknown>;
    const name = typeof row['name'] === 'string' ? row['name'].trim().slice(0, 60) : '';
    if (name.length === 0) return null;
    const min = Number(row['min']);
    const max = Number(row['max']);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 0) return null;
    if (min > 1000 || max > 1000) return null;
    const shop = typeof row['shop'] === 'string' ? row['shop'].trim().slice(0, 80) : '';
    let at: SupplyItem['at'] = null;
    if (row['at'] !== null && row['at'] !== undefined) {
      if (typeof row['at'] !== 'object') return null;
      const place = row['at'] as Record<string, unknown>;
      const map = Number(place['map']);
      const room = Number(place['room']);
      if (!Number.isInteger(map) || !Number.isInteger(room) || map < 0 || room < 0) return null;
      at = { map, room };
    }
    items.push({ name, min, max: Math.max(min, max), shop, at });
  }
  return items;
}

/** One player's grant off the wire, or `null`. */
function asGrant(value: unknown): PlayerGrant | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const allow = asRemoteNames(record['allow']);
  const deny = asRemoteNames(record['deny']);
  if (allow === null || deny === null) return null;
  const stance = asPlayerStance(record['stance']);
  return {
    allow,
    deny,
    ...(record['autoInviteWhenSeen'] === true ? { autoInviteWhenSeen: true } : {}),
    ...(stance !== null ? { stance } : {})
  };
}

/**
 * What the character rests its HP to: MegaMUD's *HP Full %* (`Health.HpFull%`),
 * which the engine rests to (`0x414300`), as a fraction. The tab said the old
 * automation's `health.restTo`, which nothing reads since the engine took over
 * (2026-10-17: every rest read "resting to 70%").
 */
function restCeilingOf(profile: Profile): number {
  const full = Number(megamudSettingsOf(profile.id, profile).live['Health']?.['HpFull%']);
  return Number.isFinite(full) && full > 0 ? Math.min(full, 100) / 100 : 0;
}

/** Every character on disk, and whether a session is open for it. */
function profileSummaries(): ProfileSummary[] {
  return (profiles?.profiles ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    accent: profile.accent,
    theme: profile.config.ui.theme,
    loaded: host?.has(profile.id) ?? false,
    target: profile.target,
    serverName: profile.serverName,
    remotes: profile.config.automation.remotes,
    switches: automationSwitches(profile.config.automation),
    restTo: restCeilingOf(profile),
    supplies: profile.config.automation.supplies
  }));
}

/**
 * The characters whose *tabs* live in one window.
 *
 * Not the same question as which sessions a window is attached to: attachment
 * is about where bytes are pushed, ownership is about whose rail a character
 * appears in. A window can show a character it does not own — that is a pane —
 * and must not have a tab for one that lives somewhere else.
 */
function summariesFor(windowId: number): SessionSummary[] {
  const all = host?.summaries ?? [];
  if (!workspace) return all;
  /*
   * In the *workspace's* order, not the host's.
   *
   * This used to filter `all` against a `Set`, which quietly threw away the one
   * thing `sessionsFor` is documented to return — the characters "in rail
   * order". The rail could be dragged into an order, the order was written to
   * `workspace.json`, and every republish put it back the way the profile
   * directory happened to sort.
   */
  const summaries = new Map(all.map((entry) => [entry.id, entry] as const));
  return workspace
    .sessionsFor(windowId)
    .map((id) => summaries.get(id))
    .filter((entry): entry is SessionSummary => entry !== undefined);
}

/**
 * Republishes both rosters.
 *
 * The session roster is per window and the profile roster is not: which
 * characters *exist* is the same everywhere, and which of them this window
 * shows tabs for is not.
 */
function publishRosters(): void {
  for (const windowId of windows.ids()) {
    windows.toWindow(windowId, Push.sessions, summariesFor(railOf(windowId)));
  }
  push(Push.profiles, profileSummaries());
}

/**
 * Whose rail a view draws.
 *
 * On the desktop a window's rail is its own: ownership is per window, and
 * that is what popping a character out moves. A host with no second window
 * (`platform.windows === null`) has one rail and every view is a view of it
 * — a second browser tab is another look at the same client, not another
 * window to own characters — so every view draws the rail the workspace
 * calls main. Asked here, once, rather than at each of the seven places a
 * window id reaches the workspace.
 */
function railOf(windowId: number): number {
  if (platform.windows !== null) return windowId;
  return platform.mainWindowId() ?? windowId;
}

/** The roster for whoever asked: their rail's, or everybody's for a caller no window claims. */
function rosterFor(caller: Caller): SessionSummary[] {
  if (caller.windowId === -1) return host?.summaries ?? [];
  return summariesFor(railOf(caller.windowId));
}

/**
 * Hands the options store what the directories beside it say.
 *
 * Servers and the loops everybody may walk are files now, and everything that
 * reads a configuration asks `ConfigStore` for one — so they are folded in
 * there rather than at each call site, and a change to either republishes the
 * configuration exactly as an edit to the options file does.
 */
function publishTree(): void {
  config?.setExtras({
    servers: servers?.servers ?? [],
    loops: loops?.globalLoops ?? []
  });
}

function createServers(): ServerStore {
  const store = new ServerStore(home, (message) => announce('servers', message));
  store.on('change', publishTree);
  // A realm given a database builds its data from it there and then, not at
  // its next character's connection (2026-11-10).
  store.on('change', () => {
    for (const { id, server } of store.all) realmFromDatabase(id, server.database);
  });
  store.watch();
  return store;
}

function createRealmTable<T extends RealmTable>(
  kind: TableKind<T>,
  channel: 'messages' | 'monsters' | 'items'
): RealmTableStore<T> {
  const store = new RealmTableStore(home, kind, (message) => announce(channel, message));
  // A table imported, edited on the settings page or by hand reaches the
  // characters already playing that realm, the way a changed option does.
  store.on('change', () => host?.reconfigure());
  store.watch();
  return store;
}

/**
 * The imported tables of the realm a character plays.
 *
 * By the character's own realm, named in its file, and never by where the
 * socket happens to point: a realm dialled ad hoc has no directory and so no
 * tables, which is the same answer its loops get.
 */
function realmTablesFor(id: SessionId): RealmTables {
  const profile = profileFor(id);
  const serverId = profile === undefined ? undefined : servers?.idFor(profile.serverName);
  if (profile === undefined || serverId === undefined) return NO_REALM_TABLES;
  realmFromDatabase(serverId, profile.database);
  return {
    messages: realmMessages?.forServer(serverId).triggers ?? [],
    monsters: realmMonsters?.forServer(serverId).monsters ?? [],
    items: realmItems?.forServer(serverId).items ?? []
  };
}

/**
 * What a realm database holds (2026-11-10), said to whoever uploaded it: its
 * rows, without reading them, and the hunting loops a realm is given from it
 * (`realmLoopCount`). Converting it for the count is the conversion its first
 * character would otherwise wait for, kept for when it does.
 */
function describeRealm(file: string): RealmSummary | null {
  const realm = openRealm(file);
  let counts: Omit<RealmSummary, 'loops'>;
  try {
    const rows = (name: string): number => realm.count(name) ?? 0;
    counts = {
      classes: rows('Classes'),
      races: rows('Races'),
      monsters: rows('Monsters'),
      items: rows('Items'),
      rooms: rows('Rooms'),
      messages: realm.count('Messages')
    };
  } finally {
    realm.close();
  }
  const loaded = realms?.load(file);
  const loops =
    loaded !== undefined && loaded.problem === undefined && loaded.graph !== undefined
      ? realmLoopCount(loaded.graph, tuning().hunting.areaRadius)
      : 0;
  return { ...counts, loops };
}

/** Each realm database already read for its tables, by realm, file and stamp. */
const tablesAsked = new Set<string>();

/**
 * A realm played from its own database takes its message, monster and item
 * tables and its hunting loops from it (`world/realmTables.ts`,
 * `world/realmLoops.ts`, 2026-11-10), in place of MegaMUD's `Messages.md`,
 * `Monsters.md`, `Items.md` and recorded loops or anything shipped: the
 * database is the realm's one source. The loops are files in the realm's
 * loops folder, rebuilt when the database changes but for any the player
 * edited (`world/realmLoopFiles.ts`). A table is rebuilt when it did not come
 * from this database as it now is — imported from MegaMUD, made before the
 * database changed, or not there at all — and a table that came from
 * somewhere else is copied aside once first (`<file>.before-database`).
 * Edits to a table built from the database are kept until the database
 * changes. A database with no `Messages` table leaves that table as it is.
 *
 * On the next turn rather than here: a table's write reconfigures every
 * session, and this is asked while one is being configured. That
 * reconfiguration is what hands the characters the new tables.
 */
function realmFromDatabase(serverId: string, database: string): void {
  const file = realms?.databaseFile(database) ?? null;
  if (file === null) return;
  let builtAt: number;
  try {
    builtAt = statSync(file).mtimeMs;
  } catch {
    // No such file: the realm's loader says so.
    return;
  }
  const current = (source: RealmTable['source']): boolean =>
    source !== null && source.file === file && Date.parse(source.importedAt) >= builtAt;
  const loopsDir = home.server(serverId).loops;
  const stores = [realmMessages, realmMonsters, realmItems];
  if (
    stores.every((store) => store === null || current(store.forServer(serverId).source)) &&
    databaseLoopsCurrent(loopsDir, file, builtAt)
  )
    return;
  const key = `${serverId}\n${file}\n${builtAt}`;
  if (tablesAsked.has(key)) return;
  tablesAsked.add(key);
  setImmediate(() => {
    const loaded = realms?.load(database);
    // A database that did not convert is the bundled world standing in: nothing of it is this realm's.
    const world = loaded !== undefined && loaded.problem === undefined ? loaded.graph : undefined;
    let tables: DatabaseTables;
    try {
      tables = databaseTables(file, world ? shopkeepers(world) : new Set());
    } catch {
      // A file that does not open: the realm's loader says so.
      return;
    }
    const source = { file, importedAt: new Date().toISOString() };
    const rebuild = <T extends RealmTable>(store: RealmTableStore<T> | null, table: T): boolean => {
      if (store === null || current(store.forServer(serverId).source)) return false;
      const at = store.file(serverId);
      const aside = `${at}.before-database`;
      if (existsSync(at) && store.forServer(serverId).source?.file !== file && !existsSync(aside))
        copyFileSync(at, aside);
      return store.write(serverId, table).ok;
    };
    const counts = {
      messages:
        tables.messages !== null && tables.messages.length > 0
          ? rebuild(realmMessages, { source, triggers: tables.messages })
            ? tables.messages.length
            : null
          : null,
      monsters: rebuild(realmMonsters, { source, monsters: tables.monsters })
        ? tables.monsters.length
        : null,
      items: rebuild(realmItems, { source, items: tables.items }) ? tables.items.length : null,
      loops: null as number | null
    };
    const said = (): void => {
      if (Object.values(counts).every((count) => count === null)) return;
      announce(
        'world',
        t('notices.world.tablesFromDatabase', {
          file: path.basename(file),
          messages: counts.messages ?? '-',
          monsters: counts.monsters ?? '-',
          items: counts.items ?? '-',
          loops: counts.loops ?? '-'
        }),
        'log'
      );
    };
    if (world === undefined || databaseLoopsCurrent(loopsDir, file, builtAt)) {
      said();
      return;
    }
    // The loops an area at a time, everything else running between them.
    const steps = realmLoopsYielding(world, tuning().hunting.areaRadius);
    const step = (): void => {
      const next = steps.next();
      if (next.done !== true) {
        setImmediate(step);
        return;
      }
      try {
        counts.loops = writeDatabaseLoops(
          loopsDir,
          { file, builtAt },
          next.value,
          ` ${t('notices.world.loopFromDatabase', { file: path.basename(file) })}`
        );
        loops?.refresh();
      } catch (error) {
        announce('loops', errorMessage(error));
      }
      said();
    };
    step();
  });
}

/**
 * A realm's table, addressed by the realm's *name* — what the settings page
 * holds — and resolved here to its directory, the one place the two are
 * joined (`ServerStore.idFor`). Null for a realm with no directory.
 */
function tableAt<T extends RealmTable>(
  store: RealmTableStore<T> | null,
  realm: unknown
): { store: RealmTableStore<T>; serverId: string } | null {
  const serverId = typeof realm === 'string' ? servers?.idFor(realm) : undefined;
  return serverId === undefined || store === null ? null : { store, serverId };
}

/** Where an import says it came from: the file picked, or the name MegaMUD gives it. */
function importedFrom(fileName: unknown, fallback: string): RealmTable['source'] {
  return {
    file: typeof fileName === 'string' && fileName.length > 0 ? fileName : fallback,
    importedAt: new Date().toISOString()
  };
}

function createLoops(): LoopStore {
  const store = new LoopStore(home, (message) => announce('loops', message));
  store.on('change', () => {
    publishTree();
    // A server's or a character's loops are not part of the base, so a change
    // to one reaches the characters only by re-resolving them.
    profiles?.refresh();
  });
  store.watch();
  return store;
}

function createProfiles(): ProfileStore {
  const store = new ProfileStore({
    directory: home.profilesDir,
    base: () => config?.source ?? {},
    /*
     * What the two narrower directories lend this character: its server's
     * loops, then its own. Read through rather than captured, so a file
     * written while the client is running reaches the next resolution.
     */
    loopsFor: (id, serverName) => {
      const serverId = servers?.idFor(serverName);
      return mergeLoops(
        serverId === undefined ? [] : (loops?.forServer(serverId) ?? []),
        loops?.forProfile(id) ?? []
      );
    }
  });

  store.ensureDirectory();
  store.on('change', (snapshot) => {
    // A file that has come back is a character the player wants again; leaving
    // it in `unloaded` would make re-adding it silently do nothing.
    for (const id of [...unloaded]) {
      if (!snapshot.profiles.some((profile) => profile.id === id)) unloaded.delete(id);
    }
    syncSessions(snapshot);
    publishRosters();
  });
  store.watch();
  return store;
}

/**
 * The internal settings file: beside the options file, like everything the
 * client keeps, so `MUDENGINE_CONFIG` relocates it too. Hot-reloaded, and a
 * change reaches every session the way an options change does.
 */
function createInternal(): InternalStore {
  /*
   * Brought up to the template first, exactly as the options file is.
   *
   * This file is copied once and never again, so every block added to the
   * template afterwards was invisible to anybody who had already run the
   * client — and the block *is* the documentation here: `toolbar.pinned` names
   * every button there is and says how to change the row. The defaults still
   * applied, which is the shape this project has a name for: a setting nobody
   * can see is a setting nobody uses.
   *
   * `reconcileWithTemplate` only ever adds a whole absent top-level block, so
   * nothing the user has written is touched.
   */
  const brought = reconcileWithTemplate(home.internal, internalTemplate());
  if (brought.added.length > 0) {
    notice(t('app.config.internalTemplateAdded', { added: brought.added.join(', ') }));
  }
  if (brought.error !== null) {
    notice(t('app.config.templateReconcileFailed', { error: brought.error }));
  }

  const store = new InternalStore({
    file: home.internal,
    template: internalTemplate(),
    onError: (message) => announce('internal', message)
  });
  /*
   * The tuning block is process-wide rather than threaded, so it is set here
   * on the first read and again on every change — see `app/tuning.ts` for why
   * it is a lookup rather than a constructor argument.
   */
  setTuning(store.config.tuning);
  store.on('change', () => {
    setTuning(store.config.tuning);
    host?.reconfigure();
    // The palette reads it too, so a saved edit reaches every window.
    push(Push.internal, store.config);
  });
  store.watch();
  return store;
}

function createHost(): SessionHost {
  return new SessionHost({
    worldFor,
    internal: () => internal?.config ?? DEFAULT_INTERNAL,
    loreFor,
    spellLoreFor,
    sentences,
    memoryFor: splitMemoryFor,
    fightsFor,
    talkFor,
    // Beside the conversation and for the same reason: what the console
    // showed outlives the launch. `check:secrets` walks the whole home.
    backscrollFor: (id) => home.state('backscroll', `${id}.log`),
    belongingsAt,
    playersFor,
    destinationsFor,
    playersAt,
    findsFor,
    // What the realm called itself, by the address it was dialled at, so the
    // next session built for it starts on the right world.
    realmTold: (_id, target, realm) => worldBook?.learn(realmAddress(target), realm),
    // Not a domain concern: see `keepSignalsWorking`.
    onConnected: keepSignalsWorking,
    // Per window: which characters have tabs where is the one roster question
    // that differs between them.
    publishRoster: publishRosters,
    // Read through rather than captured: the options file is hot-reloaded and
    // profiles are watched, so a captured snapshot would pin every session to
    // the values it started with.
    configFor,
    realmTablesFor,
    megamudFor,
    movement: {
      get: (id) => movements?.get(id) ?? null,
      set: (id, movement) => movements?.set(id, movement)
    },
    /*
     * Whether a lost connection is dialled back, per character, read through
     * for the reason `configFor` is: profiles are watched, so switching it off
     * has to reach a session that is already counting down.
     */
    autoReconnect: (id) => profileFor(id)?.autoReconnect ?? false,
    /*
     * What to call a character.
     *
     * The name the *realm* gave them wins, because that is who the player
     * thinks they are: a profile's display name is a filename until the stat
     * sheet arrives, and "Main" identifies nobody. The server comes along so
     * that two characters on two realms are told apart at a glance.
     */
    label: labelOf,
    characterChanged: (id) => {
      warmExplorer(id);
      if (!parties) return;
      // The realm's sys goto places, once a character has heard it list them.
      const places = host?.get(id)?.manager.character.gotoPlaces ?? [];
      if (places.length > 0) parties.gotoStated(labelOf(id).server, places);
      keepFormedParty(id);
      partyKeeper.check(parties.all, keptOn);
    },
    partyForgot: (id, name) => parties?.forget(labelOf(id).server, name),
    partyAlreadyDone,
    logDirectory,
    toAttached: (channel, message) => windows.toAttached(channel, message),
    toDiagnostics: (channel, message) => windows.toDiagnostics(channel, message),
    toDebugging: (channel, message) => windows.toDebugging(channel, message),
    toAll: (channel, payload) => windows.toAll(channel, payload),
    notice: (payload) => push(Push.notice, payload)
  });
}

/**
 * Whether the window is drawn by the GPU, said out loud when it is not.
 *
 * Nothing about the client changes when Chromium falls back to software
 * compositing — the same code runs, the same frames are asked for — and
 * nothing on screen says so. What changes is that every frame is composed on
 * a CPU: the console's WebGL canvas is read back, every glass surface is
 * blurred in software, and a typed character comes back a hundred and fifty
 * milliseconds later. Measured on a virtual display with `npm run
 * profile:ui`, where that is the whole of the difference between the window
 * being fluid and the window crawling; a driver, a sandbox or a launch flag
 * can put a real desktop in the same state, and somebody in it would
 * otherwise read the client as slow rather than the machine as unaccelerated.
 *
 * Once per window, because each window has its own console and a character
 * popped out later deserves the same sentence; once per process on stdout,
 * because the record needs it once. Only a status Chromium has actually
 * *decided* is software counts — `disabled_software`, `unavailable_software`
 * and their kin. `unknown` is not a decision, and stating it as one would be
 * the reassuring guess in the other direction: an alarm nobody can clear.
 * A host with nothing composing here — a browser tab draws itself on its own
 * machine — answers null, and nothing is said: absence is not a verdict.
 */
const compositingReportedTo = new Set<number>();
let compositingLogged = false;
function reportSoftwareCompositing(to: Caller): void {
  if (compositingReportedTo.has(to.windowId)) return;
  const status = platform.gpu();
  if (status === null) return;
  if (!/^(disabled|unavailable)/.test(status.compositing)) return;
  compositingReportedTo.add(to.windowId);
  const message = t('app.gpu.softwareCompositing', {
    compositing: status.compositing,
    rasterization: status.rasterization,
    webgl: status.webgl
  });
  const payload: Notice = { session: null, message };
  to.send(Push.notice, payload);
  if (!compositingLogged) {
    compositingLogged = true;
    console.warn(`gpu: ${message}`);
  }
}

/*
 * Revealing a path.
 *
 * On the desktop the host opens the operating system's file manager and
 * the answer is `opened`. A host that cannot — a browser tab has no file
 * manager on the machine the files are on — answers `listed` with the
 * path, and the window shows it in a listing of its own (`browseHome`).
 * Said in the answer rather than inferred from the host kind, so the
 * window acts on what happened.
 */
const reveal = async (target: string, kind: 'file' | 'directory'): Promise<Revealed> =>
  (await platform.reveal(target, kind)) ? { how: 'opened' } : { how: 'listed', path: target }; /*
 * The realm's database file, which the Explorer's thread reads
 * (`ExplorerThread`), or why there is none to read.
 */
const explorerRealm = (session: SessionId): { file: string } | string => {
  const file = realms?.databaseFile(profileFor(session)?.database ?? '') ?? null;
  if (file === null || !existsSync(file)) return t('app.explorer.noDatabase');
  return { file };
};
/*
 * Writing settings back.
 *
 * Every payload is *parsed* rather than checked — `asProfileDraft`,
 * `asProfileId`, `asServerDraft` return the typed value or null — because
 * these are the payloads that become files on disk holding credentials. A
 * malformed one is a character dialling somewhere nobody chose, which is the
 * exact failure a profile with no server is refused for.
 *
 * Each resolves to *why it refused*, or null. Nothing here throws at the
 * renderer: a settings screen that takes the process down takes every
 * character's socket with it.
 */
/*
 * What the settings screen's spell pickers offer. The character's own book
 * — the live record when a session holds one on the same realm (the disk
 * copy lags it by a deferred write), the file otherwise — and the cure
 * gates computed over it against that character's realm. The Global page
 * gets the shipped realm's castable spells: it is the starting point a new
 * character copies, and there is no character whose book could narrow it.
 */
const settingsSpells: NonNullable<SettingsEditorOptions['spells']> = {
  forProfile: (id, target) => {
    const realm = realmAddress(target);
    const live = belongings.get(id as SessionId);
    const book =
      live && live.realm === realm
        ? live.recallSpellbook()
        : peekSpellbook(home.state('belongings', `${id}.json`), realm);
    if (book === null) return { spellbook: null, cureGates: null };
    const world = worldFor(id as SessionId);
    return {
      /*
       * The listing knows what this character can cast; only the realm table
       * knows who each spell may be cast *on*, so the two are joined here.
       * A spell the realm cannot name reads as `unknown`, which every picker
       * offers rather than hides — a derivative realm must not empty the
       * field. See `spellTargeting`.
       */
      spellbook: book.map((spell) => {
        const row = world?.spellNamed(spell.name);
        return {
          name: spell.name,
          short: spell.short,
          targeting: spellTargeting(row?.targets),
          /*
           * What the realm says it serves, so each cure field offers the
           * spells that answer its own question (todo 00). Left absent
           * where the realm has no row: unknown offers everything, the
           * same rule `targeting` keeps one line up.
           */
          ...(row === undefined || row === null
            ? {}
            : {
                serves: spellServes(
                  world?.servingAbilities(row) ?? row.abilities,
                  (id) => world?.spellById(id)?.abilities
                )
              })
        };
      }),
      // No realm to ask means no gates, never closed ones: unknown must
      // not disable a cure.
      cureGates:
        world === undefined
          ? null
          : cureGates(
              book.map((spell) => {
                const row = world.spellNamed(spell.name);
                return row === null ? undefined : world.servingAbilities(row);
              })
            )
    };
  },
  /*
   * The bundled world outright, never `load('')`.
   *
   * `load` resolves **a realm's** database, and an empty one means *this
   * realm has not said which world it runs* — so it announces the automatic
   * choice, as a session walking an unconfirmed map must. The Global page
   * has no realm in the question at all: it is asking what a new character
   * would copy. Asked through `load`, opening the settings screen printed
   * "No world database is named and this realm has not yet said which it
   * runs" into every terminal, about nothing (2026-09-15).
   */
  realm: () => realms?.shippedGraph().castableSpells() ?? []
};
const editor = (): SettingsEditor =>
  new SettingsEditor({ home, spells: settingsSpells, megamud: megamudSettingsOf });

/** Sessions this launch has already dialled on its own. See `clientReady`. */
const autoConnected = new Set<SessionId>();

/**
 * What the IPC handlers in `ipc/` reach of this module: its state, read at
 * the moment a handler runs (a getter, as the variable was), and its helpers.
 */
const ipcContext = {
  announce,
  appVersion,
  areaOverrides,
  asGrant,
  ASKABLE,
  asMusterTarget,
  asRemoteNames,
  asSupplyItems,
  autoConnected,
  get config() {
    return config;
  },
  destinationsFor,
  disband,
  DORMANT_PHASES,
  editor,
  explorerAs,
  explorerRealm,
  fallbackSnapshot,
  fanOut,
  fightLogs,
  fightsOf,
  get home() {
    return home;
  },
  get host() {
    return host;
  },
  huntingGroundsOf,
  IDLE_STATE,
  importedFrom,
  get internal() {
    return internal;
  },
  keptOn,
  labelOf,
  get launched() {
    return launched;
  },
  set launched(value: typeof launched) {
    launched = value;
  },
  logDirectory,
  LOOP_FILE_MAX,
  loopCatalogue,
  get loops() {
    return loops;
  },
  get lore() {
    return lore;
  },
  loreFor,
  loreSourceOf,
  megaDataFor,
  muster,
  notice,
  get parties() {
    return parties;
  },
  partyKeeper,
  get platform() {
    return platform;
  },
  get playerBook() {
    return playerBook;
  },
  playersFor,
  profileFor,
  get profiles() {
    return profiles;
  },
  profileSummaries,
  publishRosters,
  push,
  railOf,
  get realmItems() {
    return realmItems;
  },
  get realmMessages() {
    return realmMessages;
  },
  get realmMonsters() {
    return realmMonsters;
  },
  get realms() {
    return realms;
  },
  realmTablesFor,
  reportSoftwareCompositing,
  reveal,
  rosterFor,
  saveNewRoster,
  get servers() {
    return servers;
  },
  summariesFor,
  tableAt,
  talkFor,
  unloaded,
  wearableIn,
  wearerIn,
  windows,
  get workspace() {
    return workspace;
  },
  get worldBook() {
    return worldBook;
  },
  worldFor
};
export type IpcContext = typeof ipcContext;

/** Every handler behind `IpcApi`, one function per area under `ipc/`. */
function registerIpc(): void {
  const { transport } = platform;
  registerSessionsIpc(transport, ipcContext);
  registerPlayIpc(transport, ipcContext);
  registerWorldIpc(transport, ipcContext);
  registerExplorerIpc(transport, ipcContext);
  registerSettingsIpc(transport, ipcContext);
}

/** Whether this launch has done its autoconnect pass. See `clientReady`. */
let launched = false;

/** Used only if the store somehow failed to construct; keeps the API total. */
function fallbackSnapshot() {
  return { config: DEFAULT_CONFIG, path: '', error: null, loadedAt: 0 };
}

/**
 * Last resort, so one bug cannot cost four characters.
 *
 * The main process holds every session's socket. Node's default for an uncaught
 * exception is to exit, and for an unhandled rejection likewise — which here
 * means a defect anywhere, in any window's IPC handler, silently disconnects
 * every character the player has in the realm. That is the largest blast radius
 * in the application and the cheapest to contain.
 *
 * Staying up is the right trade for an interactive client, but it is only
 * defensible if it is *loud*: this reports to the console and into the terminal
 * the player is looking at. It is not a catch-all that hides defects — it is
 * the thing that stops a defect taking hostages while it is being reported.
 */
function guardTheProcess(): void {
  const report = (kind: string, cause: unknown): void => {
    const detail = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
    console.error(`${kind}:`, detail);
    // The kind rides in the diagnostic payload: in a packaged build this
    // notice is the only copy anybody sees, and "please report this" needs
    // the fault named, not only its message.
    notice(t('app.crash.guardNotice', { message: `${kind}: ${errorMessage(cause)}` }));
  };

  process.on('uncaughtException', (error) => report('uncaught exception', error));
  process.on('unhandledRejection', (reason) => report('unhandled rejection', reason));
}

/**
 * Builds the client on the host it is given, and opens it.
 *
 * The one entry point. `src/main/index.ts` chooses the host — the desktop by
 * default, the web server under `MUDENGINE_WEB=1` — and everything here is
 * the same on both: the same stores, the same sessions, the same handlers
 * behind the same channels. What differs is asked of `platform` at the point
 * it differs.
 */
export function startClient(host: Host): void {
  platform = host;
  asked = homeRoot(process.env, host.defaultHome);
  home = homeAt(asked.root);

  /*
   * Ctrl-C in the terminal that launched the client is still an exit.
   *
   * Node's default for a signal is to terminate immediately, which takes
   * every socket down with it uncleanly — the disconnect this realm charges
   * for (docs/greatermud/combat.md) — and abandons the lore and memory writes
   * that are scheduled lazily. So a signal runs the same teardown a quit
   * does, and then ends the process through the host, which deliberately does
   * **not** ask: a confirmation nobody is looking at is a client that hangs on
   * a modal dialog, and somebody signalling the process has already decided.
   * `docker stop` is this path too.
   *
   * A second signal goes through immediately. Replacing the default handler
   * is only defensible if the thing everybody reaches for when an app will
   * not die still works.
   */
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (signalled) process.exit(1);
      signalled = true;
      console.log(`\nshutdown: ${signal}.`);
      teardown();
      exitOnceItHasBeenSaid();
    });
  }

  /*
   * Claimed before anything is built, because everything built here is
   * shared.
   *
   * The reasoning, and the measurement that produced it, are in
   * `src/main/app/instance.ts`. In short: a second client on one profile
   * makes the *first* one's storage contended — a three-second black window on
   * the next launch, which is how this was found — and then the two of them
   * write the same lore, memory and fight logs and dial the same characters.
   */
  const ownsTheProfile = host.claimInstance({
    say: (message) => console.log(message),
    leave: exitOnceItHasBeenSaid
  });

  void host.ready().then(() => {
    /*
     * A launch that bounced off the client already running is on its way
     * out; the host's `exit` waits for its own explanation to be flushed, so
     * `ready` can still resolve in between. It must not build a client on
     * the way.
     */
    if (!ownsTheProfile) return;
    build();
  });
}

/** Everything, in the order each thing's dependencies demand. Once. */
function build(): void {
  guardTheProcess();
  /*
   * The home, before anything reads from it.
   *
   * The host's own lock keeps one desktop client per profile; this keeps one
   * client per *home* across hosts, because a web client started beside a
   * desktop one lands on the same directory and neither lock would know. A
   * refusal names the holder and where the lock is, then leaves the way a
   * bounced second launch leaves — nothing built, nothing to tear down.
   */
  let claim: ReturnType<typeof claimHome>;
  try {
    claim = claimHome(home.root);
  } catch (error) {
    /*
     * A home this process may not write, said in words rather than as a stack
     * (2026-11-09): rootless Docker with a bind mount ran the image as a uid
     * that was not the folder's owner, and `.lock` is the first file written.
     */
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EROFS') throw error;
    console.log(
      t('app.instance.homeUnwritable', {
        home: home.root,
        uid: process.getuid?.() ?? '?',
        message: (error as Error).message
      })
    );
    exitOnceItHasBeenSaid(1);
    return;
  }
  if (!claim.held) {
    console.log(t('app.instance.homeHeld', { home: home.root, pid: claim.by, file: claim.file }));
    exitOnceItHasBeenSaid(1);
    return;
  }
  homeLock = claim.lock;
  if (claim.recovered !== null) {
    announce('home', t('app.instance.staleLock', { pid: claim.recovered }), 'log');
  }
  /*
   * Before anything reads a file: the tree may still be in the shape an older
   * build left it in, and every store below would otherwise find an empty
   * directory and quietly create a fresh configuration beside somebody's real
   * one. Said out loud, because a migration that moved a player's characters
   * and reported nothing is indistinguishable from one that lost them.
   */
  // Said before anything else, because it changes where every file below is
  // read from and written to.
  if (asked.note !== undefined) announce('home', asked.note, 'log');
  migrateHome({
    home,
    legacyOptions: legacyOptionsFiles(),
    /*
     * The shipped templates, which sit in the *same directory* a development
     * run used to keep the live files in. Without this the migration carries
     * `internal.yaml` out of the repository -- it is both the template and,
     * under the old layout, the file the client wrote to, which is the other
     * half of why that layout had to go.
     */
    keep: [configTemplate(), internalTemplate(), profileTemplate()],
    /*
     * Named rather than taken from `keep[0]`: a migration that *renames* a
     * block needs the template's current annotation for it, and a positional
     * dependency on a list about something else is how that quietly stops
     * working.
     */
    template: configTemplate(),
    // And the tuning template, for the file the player hand-edits to
    // experiment: its paragraphs are documentation too.
    internalTemplate: internalTemplate(),
    /*
     * The shelf, for the one migration that has to recognise a loop copied off
     * it. A function, so the lazy read above stays lazy for a client with no
     * copied loop on disk -- and is warm for the picker where there is one.
     */
    loopShelf: () => loopCatalogue().all(),
    note: (message) => announce('home', message, 'log')
  });
  config = createConfig();
  seedServers();
  servers = createServers();
  loops = createLoops();
  realmMessages = createRealmTable(MESSAGE_TABLE, 'messages');
  realmMonsters = createRealmTable(MONSTER_TABLE, 'monsters');
  realmItems = createRealmTable(ITEM_TABLE, 'items');
  publishTree();
  internal = createInternal();
  lore = createLore();
  playerBook = createPlayerBook();
  megaLearned = createMegaLearned();
  // What the first version of that file held of monsters belongs to the lore now.
  for (const { realm, mob, relationship } of megaLearned.takeStances()) {
    lore.learnStance(realm, mob, relationship, Date.now());
  }
  destinations = createDestinations();
  movements = createMovements();
  parties = createParties();
  worldBook = createWorldBook();
  realms = createRealms();
  /*
   * Loaded before the window, and said out loud.
   *
   * In a packaged build the resources directory is somewhere else and
   * `resourcesDir()` probes candidates for it, so this line is the difference
   * between a working package and one that silently cannot say where anybody is
   * standing. Eagerly rather than on the first session for the same reason:
   * finding out at connect time is finding out too late.
   */
  realms.shippedGraph();
  workspace = new Workspace({
    mainWindowId: () => platform.mainWindowId(),
    allSessions: () => host?.summaries.map((entry) => entry.id) ?? [],
    // Under the user data directory, not the options file: it is chrome state,
    // it changes constantly, and writing it into a hand-annotated YAML the user
    // edits would mean the client fighting them for it.
    file: home.state('workspace.json')
  });
  // Before the host: it asks the profile store which options each session runs
  // under, and the answer has to exist by the time the first one is created.
  profiles = createProfiles();
  host = createHost();
  syncSessions(profiles.snapshot);
  registerIpc();

  /*
   * Everything exists and every channel answers: open. The desktop makes its
   * window here (and whatever was popped out last time); the web server
   * starts listening. What a host reaches back into is the whole of this
   * object, and it is handed over rather than imported so the host cannot
   * touch a store before it is built.
   */
  platform.open({
    home,
    windows,
    workspace: () => workspace,
    publishRosters,
    quitting,
    appIcon,
    abort,
    logDirectory,
    describeRealm
  });
}

/**
 * A host that cannot open — a port already taken, a password file it cannot
 * read — ends the client the way a signal does: the reason on stdout, the
 * teardown run so every store is disposed and the lock released, and the
 * exit held until the reason has actually left the pipe. `process.exit` on
 * the line after `console.error` loses the one sentence that says why, and
 * skips the teardown that puts the home back the way it was found.
 */
function abort(reason: string): void {
  console.log(reason);
  teardown();
  exitOnceItHasBeenSaid(1);
}

/**
 * A teardown step that cannot take the rest of the quit down with it.
 *
 * Quitting is the one moment where every deferred write is flushed and every
 * socket is closed, and `guardTheProcess` keeps the process up on an uncaught
 * exception — which *here* means a client with no window, no way back to one
 * and a terminal that never returns. So a step that fails is reported and the
 * next one runs anyway: a lore file that will not write must not cost four
 * characters their clean disconnect.
 */
function settle(what: string, step: () => void): void {
  try {
    step();
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`shutdown (${what}):`, detail);
  }
}

/** Flush what is deferred, close what is open. Called once, on the way out. */
function teardown(): void {
  // Said out loud, because by this point the window it would otherwise be
  // reported through is already gone: a client that stops on the way out has
  // stopped somewhere, and this is the line that says where.
  console.log('shutdown: disconnecting and flushing what is deferred…');
  settle('workspace', () => workspace?.save());
  settle('internal', () => internal?.dispose());
  // Written before the sessions go: what the last fight taught is scheduled
  // lazily, and quitting is exactly when that schedule has not fired yet.
  settle('lore', () => lore?.flush());
  // And what every character saw of everybody else, for the same reason.
  settle('players', () => playerBook?.flush());
  // And where they were walking to, for the same reason again: a route started
  // in the last five seconds is on a deferred timer that quitting pre-empts.
  settle('destinations', () => destinations?.flush());
  // Same reason, same moment: a discovery made in the last two seconds of a
  // session is written on a deferred timer, and quitting is when that timer has
  // not fired.
  for (const [id, memory] of memories) settle(`memory ${id}`, () => memory.close());
  memories.clear();
  // The realm-wide half, on the same deferred timer and for the same reason.
  for (const [realm, memory] of realmMemories) {
    settle(`memory realm ${realm}`, () => memory.close());
  }
  realmMemories.clear();
  // Same reason again: a fight that ended in the last two seconds is held on a
  // timer, and quitting is when that timer has not fired.
  for (const [id, log] of fightLogs) settle(`fights ${id}`, () => log.dispose());
  fightLogs.clear();
  // And the conversation: a line said in the last two seconds is on the same
  // kind of deferred timer.
  for (const [id, log] of talkLogs) settle(`talk ${id}`, () => log.dispose());
  talkLogs.clear();
  // And once more for the character's own record: a `bank` answered or a helm
  // put on in the last two seconds is on the same kind of deferred timer.
  for (const [id, record] of belongings) settle(`belongings ${id}`, () => record.close());
  belongings.clear();
  settle('sessions', () => {
    host?.disposeAll();
    host = null;
  });
  // After the sessions: each MegaMUD engine hands over what it learned as it goes.
  settle('megamud learned', () => megaLearned?.flush());
  settle('profiles', () => {
    profiles?.dispose();
    profiles = null;
  });
  settle('messages', () => {
    realmMessages?.dispose();
    realmMessages = null;
    realmMonsters?.dispose();
    realmMonsters = null;
    realmItems?.dispose();
    realmItems = null;
  });
  settle('options', () => {
    config?.dispose();
    config = null;
  });
  // Last, after the sessions have gone: what the teardown said on its way
  // reaches a tab that is still connected, and the web host's server is the
  // thing that would otherwise hold the process open.
  settle('host', () => platform.close());
  // And the home is given up once nothing here can write to it any more.
  settle('lock', () => {
    homeLock?.release();
    homeLock = null;
  });
}

/**
 * The question, asked where somebody can still answer it.
 *
 * The specific cost, not a generic "are you sure": somebody who knows what a
 * hangup costs here will read this and somebody who does not will learn it at
 * the moment it matters.
 */
function askAboutQuitting(connected: SessionId[]): QuitAnswer {
  const names = connected
    .map((id) => host?.summaries.find((entry) => entry.id === id)?.name ?? id)
    .join(', ');
  return platform.askAboutQuitting({
    title: t('app.quit.dialogTitle'),
    message:
      connected.length === 1
        ? t('app.quit.whoIsConnected.one', { name: names })
        : t('app.quit.whoIsConnected.many', { count: connected.length, names }),
    detail: t('app.quit.consequenceDetail'),
    confirm: t('app.quit.confirmButton'),
    cancel: t('app.quit.cancelButton')
  });
}

/**
 * The one decision about ending the app, consulted from both places.
 *
 * A window's own `close` asks it first, so declining actually keeps the
 * window; `before-quit` asks it again on the way through and gets the latched
 * answer rather than putting the same dialog up twice. See `quitGuard`.
 */
const quitting = quitGuard({
  connected: () => host?.connectedIds ?? [],
  ask: askAboutQuitting,
  ensureWindow: () => {
    const windowsOf = platform.windows;
    if (windowsOf !== null && windowsOf.count() === 0) windowsOf.open([]);
  },
  teardown
});

/** Whether a signal has already been answered. See `startClient`. */
let signalled = false;

/**
 * Puts the handlers above back, because **opening a socket takes them away**.
 *
 * Measured rather than reasoned, and it took a bisect to find. With no
 * connection — or with one that was *refused* — a SIGTERM runs the handler and
 * the client shuts down cleanly. The moment a connection is **established**,
 * the same signal to the same pid does nothing at all: the process stays alive,
 * the event loop keeps turning (a timer beside this one went on firing), and
 * `process.listenerCount('SIGTERM')` still reads 1. Node believes it is
 * listening; the operating system is not delivering.
 *
 * Whatever replaces the disposition does it somewhere below Node — Chromium's
 * network or IO threads are the obvious suspects and neither is ours to change.
 * What *is* ours is that `process.on` makes libuv call `sigaction` again, and
 * whoever registers last wins: taking the listeners off and putting them back
 * takes the signal back.
 *
 * Keyed on a connection reaching `connected`, because that is exactly the
 * measured trigger. Idempotent and free — reconnecting simply does it again —
 * and it deliberately does **not** run on a timer: a client that could be
 * Ctrl-C'd only three seconds out of four would be worse than one that says it
 * cannot be.
 *
 * A client that cannot be ended from the terminal that launched it is not a
 * cosmetic fault. On this server family an unclean disconnect is penalised and
 * can kill (docs/greatermud/combat.md), and the fallback everyone reaches for
 * is `kill -9`, which is precisely the disconnect the whole shutdown path
 * exists to avoid.
 */
function keepSignalsWorking(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const listeners = process.listeners(signal);
    if (listeners.length === 0) continue;
    process.removeAllListeners(signal);
    for (const listener of listeners) process.on(signal, listener as NodeJS.SignalsListener);
  }
}

/**
 * Ends the process — but not before what it just said has actually gone.
 *
 * `teardown()` runs to completion without returning to the event loop, and
 * `app.exit` is immediate, so exiting on the next line kills the process with
 * its own explanation still in the pipe. Writing to a pipe is asynchronous in
 * Node whenever the buffer is not already empty, which on a quiet run it is and
 * on a busy one it is not — so this looked fine every time it was tried by hand
 * and failed every time under a harness, where the client's whole shutdown
 * reason vanished and it read as an app that had ignored the signal.
 *
 * It matters past the harness: that line is the only thing that says *where* a
 * client stopped, and somebody pressing Ctrl-C in the terminal that launched it
 * is exactly the person who needs it.
 *
 * Bounded, because a pipe nobody is reading never drains and the one thing
 * worse than losing the message is not exiting at all.
 */
function exitOnceItHasBeenSaid(code = 0): void {
  const leave = (): void => platform.exit(code);
  if (process.stdout.writableLength === 0) return leave();
  const deadline = setTimeout(leave, tuning().app.exitDrainMs);
  deadline.unref?.();
  process.stdout.once('drain', () => {
    clearTimeout(deadline);
    leave();
  });
}
