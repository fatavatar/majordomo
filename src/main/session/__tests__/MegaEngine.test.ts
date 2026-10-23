import { afterEach, describe, expect, it, vi } from 'vitest';

import { newTerminal, parseData } from '../../megamud/input/ParseData';
import { defaultSettings } from '../../../shared/megamud/settings';
import type { RoomId, Route, RouteStep, WorldRoom } from '../../../shared/world';
import { session } from '../../megamud/__tests__/fixture';
import { roomNameHash } from '../../megamud/room/roomName';
import { worldSignature } from '../../world/megamudSignature';
import {
  MegaEngine,
  type AfterFetch,
  type EngineLessons,
  type EngineLogKind,
  type EngineMemory,
  type MegaEngineHost
} from '../MegaEngine';
import type { AfflictionCause } from '../../../shared/character';
import { MessageEffect } from '../../megamud/flags';
import { coinItems, newMonster, type MonsterRec, type SpellRec } from '../../megamud/data';
import { collectItems } from '../../megamud/script/items';
import { newEntity } from '../../megamud/Session';
import type { PlayerFacts } from '../../../shared/players';
import type { WalkProgress } from '../../../shared/walk';
import type { LoopProgress } from '../../../shared/loops';
import { State } from '../../megamud/states';
import { readMegaMudLoop } from '../../../shared/megamudPaths';
import { Darkness, ItemFlag, SpellFlag } from '../../megamud/flags';

function room(map: number, number: number, name: string, exits: WorldRoom['exits']): WorldRoom {
  return { map, room: number, name, exits } as WorldRoom;
}

function exit(direction: 'n' | 's' | 'e' | 'w', to: number, kind: string | null = null) {
  return {
    direction,
    map: 1,
    room: to,
    requirement: kind === null ? null : ({ kind, raw: '' } as never)
  };
}

const SQUARE = room(1, 1, 'Town Square', [exit('n', 2), exit('e', 3, 'door')]);
const ALLEY = room(1, 2, 'Dark Alley', [exit('s', 1)]);
const SHOP = room(1, 3, 'Shop', [exit('w', 1, 'door')]);
const BACK = room(1, 4, 'Back Room', []);
/** The alley's look-alike: its name and exits, so its signature. */
const OTHER_ALLEY = room(1, 5, 'Dark Alley', [exit('s', 3)]);
/** A room whose exit is of a kind the realm data cannot say how the game lists: no signature. */
const VAULT = room(1, 6, 'Vault', [exit('s', 1, 'mystery')]);
const ROOMS = [SQUARE, ALLEY, SHOP, BACK, OTHER_ALLEY, VAULT];

function step(from: number, to: number, command: string): RouteStep {
  return { from: `1/${from}`, to: `1/${to}`, direction: command, command } as RouteStep;
}

/** The ways between the three rooms; the shop's back room through its portal. */
function plan(from: string, to: string): Route {
  const ways: Record<string, RouteStep[]> = {
    '1/1>1/4': [step(1, 3, 'e'), { ...step(3, 4, 'go portal'), direction: 'portal' }],
    '1/2>1/4': [{ ...step(2, 4, 'go gate'), direction: 'n' }],
    '1/1>1/2': [step(1, 2, 'n')],
    '1/2>1/1': [step(2, 1, 's')],
    '1/1>1/3': [step(1, 3, 'e')],
    '1/3>1/1': [step(3, 1, 'w')],
    '1/2>1/3': [step(2, 1, 's'), step(1, 3, 'e')],
    '1/3>1/2': [step(3, 1, 'w'), step(1, 2, 'n')],
    '1/1>1/5': [step(1, 3, 'e'), step(3, 5, 'n')],
    '1/1>1/6': [step(1, 3, 'e'), step(3, 6, 'n')],
    '1/3>1/4': [{ ...step(3, 4, 'n'), requirement: { kind: 'key', raw: 'Key: 7', keyId: 7 } }]
  };
  return { steps: ways[`${from}>${to}`] ?? [], cost: 1, blocked: false };
}

function engine(here: string | null = '1/1', ways: Record<string, Route> = {}) {
  const sent: string[] = [];
  const shown: string[] = [];
  const fetches: Array<[string[], AfterFetch]> = [];
  const told: Array<[string, boolean, AfflictionCause | null]> = [];
  const world = {
    get: (map: number, n: number) => ROOMS.find((r) => r.map === map && r.room === n),
    everyRoom: () => ROOMS.values(),
    item: (id: number) => (id === 7 ? { name: 'shining steel key' } : undefined),
    // The lever in the square that opens the way north.
    leversHere: (from: string, direction: string) =>
      from === '1/1' && direction === 'n' ? [{ at: '1/1', roomName: '', say: 'pull lever' }] : []
  };
  const at = { here, locates: 0, canLocate: true };
  // What each plan was asked for: a walk, or a loop's leg.
  const planned: string[] = [];
  const host: MegaEngineHost = {
    write: (text) => sent.push(text),
    show: (text) => shown.push(text),
    afflicted: (name, on, cause) => told.push([name, on, cause]),
    hangUp: () => {},
    dial: () => {},
    here: () => at.here,
    locate: () => {
      at.locates += 1;
      return at.canLocate;
    },
    world: () => world as never,
    // Planned off main's thread in the client (`RoutePlanner`): answered later.
    plan: (from, to, walking) => {
      planned.push(walking);
      return Promise.resolve(ways[`${from}>${to}`] ?? plan(from, to));
    },
    fetchFirst: (items, then) => fetches.push([items.map((item) => item.name), then]),
    loopRooms: (name) =>
      name === 'Ring'
        ? { rooms: ['1/2', '1/3'], bounce: false, commands: [[], []] }
        : name === 'Hammer'
          ? { rooms: ['1/2', '1/3'], bounce: false, commands: [[], ['touch hammer', 'look']] }
          : 'no such loop'
  };
  const e = new MegaEngine(host, {
    settings: defaultSettings(),
    data: { monsters: [], items: [], spells: [] },
    grants: {}
  });
  return { e, sent, shown, at, fetches, told, planned };
}

afterEach(() => vi.useRealTimers());

/** The planner's answers let in: `RoutePlanner` answers on another thread. */
async function planned(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('room signatures from the realm data', () => {
  it('match what the engine reads off the screen', () => {
    const { s } = session();
    s.inGame = 1;
    parseData(
      s,
      newTerminal(),
      '\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n'
    );
    expect(s.roomSignature).not.toBe(0);
    expect(worldSignature(SQUARE)).toBe(s.roomSignature);
    expect(roomNameHash('Town Square') & 0xfff00000).toBe(s.roomSignature & 0xfff00000);
  });

  it('are unsure of an exit whose listing the realm data cannot say', () => {
    expect(worldSignature(room(1, 9, 'Gate', [exit('n', 1, 'toll')]))).toBeNull();
  });
});

/* An item errand's drop, a quest's monster: lent to the engine and given back (2026-10-14). */
describe('what an errand lends the engine', () => {
  it('picks an item up while lent, as it was after, through the table changing', () => {
    const { e } = engine();
    e.useItems([{ item: 'gate key', collect: false }]);
    const rec = () => e.s.data.items.find((item) => item.name === 'gate key')!;
    expect(rec().flags & ItemFlag.Collect).toBe(0);
    e.alsoTake('Gate Key', true);
    expect(rec().flags & ItemFlag.Collect).toBe(2);
    e.useItems([{ item: 'gate key', collect: false }]);
    expect(rec().flags & ItemFlag.Collect).toBe(2);
    e.alsoTake('gate key', false);
    expect(rec().flags & ItemFlag.Collect).toBe(0);
    e.dispose();
  });

  it('fights a monster while lent, as it was after', () => {
    const { e } = engine();
    e.useMonsters([{ mob: 'stone statue', relationship: 'friend', notHostile: true }]);
    const rec = () => e.s.data.monsters.find((m) => m.name === 'stone statue')!;
    const before = { relationship: rec().relationship, flags: rec().flags };
    e.alsoFight('stone statue', true);
    expect(rec().relationship).toBe(4);
    e.useMonsters([{ mob: 'stone statue', relationship: 'friend', notHostile: true }]);
    expect(rec().relationship).toBe(4);
    e.alsoFight('stone statue', false);
    expect({ relationship: rec().relationship, flags: rec().flags }).toEqual(before);
    e.dispose();
  });
});

/* Archer stood a minute after his webs dissolved, and nothing recorded why (2026-10-17). */
describe('the engine’s own log', () => {
  function logging() {
    const made = engine();
    const logged: [EngineLogKind, string][] = [];
    (made.e as unknown as { host: MegaEngineHost }).host.logged = (kind, text) =>
      logged.push([kind, text]);
    return { ...made, logged };
  }

  it('tells what changed of what its steps wait on, and what it is doing', () => {
    const { e, logged } = logging();
    e.received('\r\n');
    expect(logged).toEqual([]);
    e.s.held = 1;
    e.s.partyWait = 1;
    e.received('\r\n');
    expect(logged).toEqual([['gates', 'held 0→1, partyWait 0→1']]);
    e.s.host.activity('Resting because we can’t move');
    expect(logged.at(-1)).toEqual(['doing', 'Resting because we can’t move']);
    e.dispose();
  });

  it('keeps its debug step marks off the console, and its own lines on it', () => {
    const { e, shown, logged } = logging();
    e.s.host.trace('{D17}');
    e.s.host.trace('[Bueller?]');
    expect(logged).toEqual([
      ['step', '{D17}'],
      ['said', '[Bueller?]']
    ]);
    expect(shown).toEqual(['[Bueller?]']);
    e.dispose();
  });

  it('turns MegaMUD’s debug on only for a host that keeps the log', () => {
    expect(engine().e.s.debug).toBe(0);
  });
});

describe('the engine in a session', () => {
  it('walks a loop of ours as MegaMUD’s loop, from the room it is in', async () => {
    vi.useFakeTimers();
    const { e, sent, planned: asked } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.s.roomSignature).toBe(worldSignature(SQUARE));
    expect(e.startLoop('Ring')).toBeNull();
    await planned();
    expect(e.s.loopPath.start).toBe(worldSignature(ALLEY));
    // Loaded when it is walked (`0x482600` without loading); the path made:
    expect(e.s.paths[0]!.steps!.map((st) => st.command)).toEqual(['s', 'e', 'w', 'n']);
    // On the way to its start: the route from here is the path walked.
    expect(e.s.walking).toBe(1);
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['n']);
    // The legs as the loop was drawn, the way to its start as a walk (2026-10-18).
    expect([...new Set(asked)].sort()).toEqual(['lap', 'route']);
    expect(sent).toEqual([]);
    e.dispose();
  });

  /*
   * A loop handed to MegaMUD (2026-10-19): the path the engine walks it by,
   * written as MegaMUD writes one (`0x4888e0`), its first room's record on
   * the line MegaMUD files an unknown start by.
   */
  it('writes a loop as MegaMUD’s own path file', async () => {
    const { e } = engine('1/1');
    const made = await e.exportLoop('Ring');
    expect(typeof made).toBe('object');
    const { file, text } = made as { file: string; text: string };
    expect(file).toBe('RINGLOOP.mp');
    const hex = (n: number): string => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const alley = hex(worldSignature(ALLEY)!);
    const square = hex(worldSignature(SQUARE)!);
    expect(text.split('\r\n')).toEqual([
      '[Ring][mudengine]',
      '[DARK:mudengine:Dark Alley]',
      `${alley}:${alley}:4:-1:0:::`,
      `${alley}:0000:s`,
      `${square}:0000:e`,
      `${hex(worldSignature(SHOP)!)}:0000:w`,
      `${square}:0000:n`,
      ''
    ]);
    // What MegaMUD's own folder import reads it back as.
    const read = readMegaMudLoop(file, text);
    expect(read?.steps).toEqual(['s', 'e', 'w', 'n']);
    e.dispose();
  });

  /* A stop's commands (2026-10-23): typed in its room before the leg out of it. */
  it('types a stop’s commands in its room, as path steps that do not move', async () => {
    const { e } = engine('1/1');
    const made = await e.exportLoop('Hammer');
    const { text } = made as { file: string; text: string };
    const hex = (n: number): string => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const shop = hex(worldSignature(SHOP)!);
    expect(text.split('\r\n').slice(3, -1)).toEqual([
      `${hex(worldSignature(ALLEY)!)}:0000:s`,
      `${hex(worldSignature(SQUARE)!)}:0000:e`,
      `${shop}:0000:touch hammer`,
      `${shop}:0000:look`,
      `${shop}:0000:w`,
      `${hex(worldSignature(SQUARE)!)}:0000:n`
    ]);
    e.dispose();
  });

  it('makes a loop again once it is edited', async () => {
    const { e } = engine('1/1');
    const host = (e as unknown as { host: MegaEngineHost }).host;
    const commands = async (): Promise<string[]> => {
      const { text } = (await e.exportLoop('Ring')) as { file: string; text: string };
      return text
        .split('\r\n')
        .slice(3, -1)
        .map((line) => line.split(':').slice(2).join(':'));
    };
    expect(await commands()).toEqual(['s', 'e', 'w', 'n']);
    host.loopRooms = () => ({ rooms: ['1/2', '1/3'], bounce: false, commands: [['look'], []] });
    expect(await commands()).toEqual(['look', 's', 'e', 'w', 'n']);
    expect(e.s.paths.filter((p) => p.title === 'Ring')).toHaveLength(1);
    e.dispose();
  });

  it('says why a loop cannot be written, and fetches nothing for it', async () => {
    const { e, fetches } = engine('1/1', {
      '1/2>1/3': { steps: [], cost: 0, blocked: true, reason: 'The gate is shut.' }
    });
    expect(await e.exportLoop('Ring')).toBe('The gate is shut.');
    expect(await e.exportLoop('Nowhere')).toBe('no such loop');
    expect(fetches).toEqual([]);
    e.dispose();
  });

  /* The cards drew the old loop runner's idle progress while the engine looped (2026-10-13). */
  it('says its walk and loop as the cards draw them', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/1');
    const host = (e as unknown as { host: MegaEngineHost }).host;
    const said: [WalkProgress, LoopProgress][] = [];
    host.progressed = (walk, loop) => said.push([walk, loop]);
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.startLoop('Ring')).toBeNull();
    await planned();
    // On the way out to the loop: the lap's footwork, not a route asked for.
    const [walk, loop] = said.at(-1)!;
    expect(loop).toMatchObject({
      status: 'running',
      name: 'Ring',
      stop: 1,
      stops: 2,
      stopNames: ['Dark Alley', 'Shop'],
      laps: 0,
      lapBegunAt: null
    });
    expect(walk).toMatchObject({
      status: 'walking',
      asked: false,
      destination: 'Dark Alley',
      path: ['1/1', '1/2'],
      step: { command: 'n', name: 'Dark Alley' }
    });

    // On the loop, a step into the leg from the alley to the shop.
    e.s.path.name = e.s.loopPath.name;
    e.s.path.at = 1;
    e.s.looping = 1;
    expect(e.progress.loop).toMatchObject({ stop: 2, stopName: 'Shop', remainingStops: ['1/3'] });
    expect(e.progress.walk).toMatchObject({ destination: 'Shop', path: ['1/1', '1/3'] });

    e.s.walking = 0;
    expect(e.progress.loop.status).toBe('stopped');
    expect(e.progress.walk.status).toBe('idle');
    e.dispose();
  });

  /* MegaMUD has no flee; ours is MegaMUD's run, then `sys goto` (2026-10-14). */
  it('flees below the line: runs out of the fight, then sys goto, once until health is back', () => {
    vi.useFakeTimers();
    const { e, sent } = engine('1/1');
    const s = e.s;
    s.inGame = 1;
    s.Player_MaxHP = 100;
    s.hp = 15;
    s.inCombat = 1;
    e.useFlee({ belowHealth: 0.2, destination: 'sil' });
    vi.advanceTimersByTime(1000);
    expect(s.runCount).toBeGreaterThan(0);
    expect(sent.join('')).not.toContain('sys goto');
    s.inCombat = 0;
    s.runCount = 0;
    vi.advanceTimersByTime(1000);
    expect(sent.filter((text) => text === 'sys goto sil\r\r')).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(sent.filter((text) => text === 'sys goto sil\r\r')).toHaveLength(1);
    e.dispose();
  });

  it('does not flee with the switch off', () => {
    vi.useFakeTimers();
    const { e, sent } = engine('1/1');
    e.s.inGame = 1;
    e.s.Player_MaxHP = 100;
    e.s.hp = 5;
    e.useFlee(null);
    vi.advanceTimersByTime(2000);
    expect(sent.join('')).not.toContain('sys goto');
    e.dispose();
  });

  /* The stats board showed no loop on a run (2026-10-16): MegaMUD's path name is never set for a made path. */
  it('names the loop run for the stats board, on the way to it and on it', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.statsReport().path).toBeNull();
    expect(e.startLoop('Ring')).toBeNull();
    await planned();
    expect(e.statsReport().path).toBe('Ring - 1 step to loop');
    e.s.path.name = e.s.loopPath.name;
    e.s.looping = 1;
    expect(e.statsReport().path).toMatch(/^Ring - \d+ steps? to lap end$/);
    // Held in a fight, still on the loop.
    e.s.walking = 0;
    expect(e.statsReport().path).toBe('Ring');
    e.dispose();
  });

  it('refuses a loop it cannot make', () => {
    vi.useFakeTimers();
    const { e } = engine();
    expect(e.startLoop('Nowhere')).toBe('no such loop');
    e.dispose();
  });

  it('learns a room’s signature when it and the tracker stand there together', () => {
    vi.useFakeTimers();
    const { e } = engine('1/2');
    e.s.inGame = 1;
    e.received('\x1b[1;36mDark Alley\r\n\x1b[0;32mObvious exits: south, west\r\n');
    expect(e.learned.get('1/2')).toBe(e.s.roomSignature);
    expect(e.signatureOf('1/2')).toBe(e.s.roomSignature);
    e.dispose();
  });

  /* The route panel's Run it walked with auto-combat on (2026-10-14): `0x43e680`'s Go and Run. */
  it('walks a route with auto-combat on for Go and off for Run, the setting before kept', () => {
    vi.useFakeTimers();
    const { e } = engine('1/2');
    e.s.inGame = 1;
    e.received('\x1b[1;36mDark Alley\r\n\x1b[0;32mObvious exits: south, west\r\n');
    e.s.MegaMud_AutoCombat = 1;
    expect(e.walkTo('1/2', true)).toBeNull();
    expect([e.s.MegaMud_AutoCombat, e.s.detourCombat, e.s.idleCombat]).toEqual([0, 0, 1]);
    e.s.MegaMud_AutoCombat = 0;
    expect(e.walkTo('1/2')).toBeNull();
    expect([e.s.MegaMud_AutoCombat, e.s.detourCombat]).toEqual([1, 1]);
    e.dispose();
  });

  /*
   * A hunt walking to its lair: the Go To dialog's walk would take a loop
   * stopped earlier up again at its end, and the hunt wait for an arrival
   * that never came (2026-10-14).
   */
  it('walks a route alone, a stopped loop let go, and says it arrived', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.startLoop('Ring')).toBeNull();
    await planned();
    e.button(0x803);
    expect(e.s.loopPath.start).not.toBe(0);

    expect(e.walkTo('1/2', false, true)).toBeNull();
    await planned();
    expect([e.s.loopPath.start, e.s.looping]).toEqual([0, 0]);
    expect(e.progress.walk).toMatchObject({
      status: 'walking',
      asked: true,
      destination: 'Dark Alley'
    });

    // At its end, walking done.
    e.s.path.at = e.s.path.count;
    e.s.walking = 0;
    expect(e.progress.walk.status).toBe('arrived');
    e.dispose();
  });

  /* Archer telepathed himself `@health` after a settings save (2026-10-16). */
  it('keeps who the realm said the character is through a settings reload', () => {
    vi.useFakeTimers();
    const { e } = engine('1/1');
    e.s.Player_Name = 'Archer';
    e.s.Player_Level = 12;
    e.s.Player_MaxHP = 89;
    const settings = defaultSettings();
    settings.live['Combat']!['AttackCmd'] = 'kill';
    e.reload({ settings, data: { monsters: [], items: [], spells: [] }, grants: {} });
    expect([e.s.Player_Name, e.s.Player_Level, e.s.Player_MaxHP]).toEqual(['Archer', 12, 89]);
    e.dispose();
  });

  /* A run begun lights the character's tab (2026-10-17): counted once per run. */
  it('counts each run from a fight it begins, for the window', () => {
    vi.useFakeTimers();
    const { e } = engine('1/1');
    e.s.inGame = 1;
    expect(e.toggles.ran).toBe(0);
    e.s.runCount = 2;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.toggles.ran).toBe(1);
    // Still the same run, a room on.
    e.s.runCount = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.toggles.ran).toBe(1);
    e.s.runCount = 0;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    e.s.runCount = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect([e.toggles.ran, e.toggles.fled]).toEqual([2, 0]);
    e.dispose();
  });

  /* "That room has no signature yet." refused a walk our planner had the way for (2026-10-16). */
  it('walks to a room with no signature worked out, and takes its own on arrival', async () => {
    vi.useFakeTimers();
    const { e, at } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.signatureOf('1/6')).toBeNull();
    expect(e.walkTo('1/6')).toBeNull();
    await planned();
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['e', 'n']);
    const standIn = e.s.path.end;
    expect(e.s.detours[0]!.room).toBe(standIn);

    // There: the room's own signature, read off the screen, in its place.
    at.here = '1/6';
    e.received('\x1b[1;36mVault\r\n\x1b[0;32mObvious exits: south\r\n');
    const sig = e.s.roomSignature;
    expect(sig).not.toBe(standIn);
    expect(e.signatureOf('1/6')).toBe(sig);
    expect([e.s.path.end, e.s.detours[0]!.room]).toEqual([sig, sig]);
    expect(e.s.host.isRoom!(sig)).toBe(true);
    e.dispose();
  });

  /*
   * The way shown is the way walked (2026-10-18): Archer was shown the slums
   * and walked the Dragontooth Hills, the planner asked afresh for the lap's
   * traveller. Here the planner's own way north is not the one handed over.
   */
  it('walks the way it was handed, not one the planner would pick', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    const shown: Route = {
      steps: [step(1, 3, 'e'), step(3, 2, 'w')],
      cost: 9,
      blocked: false
    };
    expect(e.walkTo('1/2', false, true, shown)).toBeNull();
    await planned();
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['e', 'w']);
    e.dispose();
  });

  it('plans afresh where the way it was handed does not start where it stands', async () => {
    vi.useFakeTimers();
    const { e, planned: asked } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    const elsewhere: Route = { steps: [step(3, 2, 'go gate')], cost: 9, blocked: false };
    expect(e.walkTo('1/2', false, true, elsewhere)).toBeNull();
    await planned();
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['n']);
    // Planned afresh as a walk, the route panel's way, and not as a loop's leg.
    expect(asked).toEqual(['route']);
    e.dispose();
  });

  /* A walk to a room by number stopped in the nearest with its name and exits (2026-10-16). */
  it('walks to the room chosen, not a nearer one that looks the same, and arrives only there', async () => {
    vi.useFakeTimers();
    const { e, at } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.signatureOf('1/5')).toBe(e.signatureOf('1/2'));
    expect(e.walkTo('1/5')).toBeNull();
    await planned();
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['e', 'n']);

    const sig = e.signatureOf('1/5')!;
    e.s.roomSignature = sig;
    at.here = '1/2';
    expect(e.s.host.isRoom!(sig)).toBe(false);
    // And a step of the path known by its room: its end, here, not the look-alike.
    const p = e.s.path;
    expect(e.s.host.isStepRoom!(p, p.count)).toBe(false);
    at.here = '1/5';
    expect(e.s.host.isStepRoom!(p, p.count)).toBe(true);
    expect(e.s.host.isRoom!(sig)).toBe(true);
    // A tracker that has not caught up (another signature) says nothing.
    at.here = '1/3';
    expect(e.s.host.isStepRoom!(p, 0)).toBe(true);
    e.dispose();
  });

  /*
   * What collect-keys takes (2026-10-20): what the walk under way needs and
   * nothing else, and nothing with no walk at all.
   */
  it('needs the key its own door asks for, and nothing while not walking', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/3');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mShop\r\n\x1b[0;32mObvious exits: closed door west\r\n');
    expect([...e.walkNeeds()]).toEqual([]);
    expect(e.walkTo('1/4')).toBeNull();
    await planned();
    expect(e.s.walking).toBe(1);
    expect([...e.walkNeeds()]).toEqual([7]);
    // A way through no keyed door needs no key.
    expect(e.walkTo('1/1')).toBeNull();
    await planned();
    expect([...e.walkNeeds()]).toEqual([]);
    e.dispose();
  });

  /* A key not carried: fetched, then the walk or the loop again (2026-10-16). */
  const refusedForKey = (): Route => ({
    steps: [],
    cost: 0,
    blocked: true,
    reason: 'needs shining steel key',
    unlocks: { ...plan('1/1', '1/2'), needs: [{ id: 7, name: 'shining steel key' }] }
  });

  it('fetches the key a refused walk needs, the walk taken up after', async () => {
    vi.useFakeTimers();
    const { e, fetches } = engine('1/1', { '1/1>1/4': refusedForKey() });
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.walkTo('1/4')).toBeNull();
    await planned();
    expect(fetches).toEqual([[['shining steel key'], { walkTo: '1/4' }]]);
    expect(e.s.walking).toBe(0);
    e.dispose();
  });

  it('fetches the key a loop’s leg needs, the loop started after', async () => {
    vi.useFakeTimers();
    const { e, fetches, shown } = engine('1/1', { '1/2>1/3': refusedForKey() });
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.startLoop('Ring')).toBeNull();
    await planned();
    expect(fetches).toEqual([[['shining steel key'], { loop: 'Ring' }]]);
    expect(shown).toContain('[The loop "Ring" starts once the pack holds what its way needs.]');
    e.dispose();
  });

  /* The planner's levers and hidden exits, done by the engine's walk (2026-10-16). */
  it('pulls a lever elsewhere where the planner’s detour says, the loop’s legs still lined up', async () => {
    vi.useFakeTimers();
    const detour: Route = {
      steps: [
        step(2, 1, 's'),
        { ...step(1, 2, 'n'), pull: { say: ['pull lever', 'push stone'], opensName: 'Shop' } },
        step(2, 3, 'e')
      ],
      cost: 3,
      blocked: false
    };
    const { e, at } = engine('1/2', { '1/2>1/3': detour });
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mDark Alley\r\n\x1b[0;32mObvious exits: south\r\n');
    expect(e.startLoop('Ring')).toBeNull();
    await planned();
    const made = e.s.paths.find((p) => p.title === 'Ring')!;
    expect(made.steps!.map((st) => st.command)).toEqual([
      's',
      'pull lever',
      'push stone',
      'n',
      'e',
      'w',
      'n'
    ]);
    // The rooms line up with the steps past the pulls: step 5 leaves 1/3, step 4 does not.
    at.here = '1/3';
    e.s.roomSignature = e.signatureOf('1/3')!;
    expect([e.s.host.isStepRoom!(made, 5), e.s.host.isStepRoom!(made, 4)]).toEqual([true, false]);
    e.dispose();
  });

  /*
   * Archer, put in the east alley by a `go alley` planned for the west one
   * (2026-10-18): the tracker was sure of the wrong room and nothing asked.
   */
  it('asks the realm where it is when MegaMUD finds the room is not the step’s, once a step', async () => {
    vi.useFakeTimers();
    const { e, at } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.walkTo('1/2')).toBeNull();
    await planned();
    const before = at.locates;
    e.s.host.uncertain!(e.s.path, 0);
    e.s.host.uncertain!(e.s.path, 0);
    expect(at.locates).toBe(before + 1);
    e.s.host.uncertain!(e.s.path, 1);
    expect(at.locates).toBe(before + 2);
    e.dispose();
  });

  it('pulls the levers in the room while the way is not showing, a couple of times', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.walkTo('1/2')).toBeNull();
    await planned();
    const clear = () => e.s.host.clearWay!(e.s.path, 0, 0);
    // Showing: MegaMUD's own step.
    expect(clear()).toBe(0);
    e.s.roomExits[0] = 0;
    e.s.pending = [];
    expect(clear()).toBe(1);
    expect(e.s.pending.map((p) => p.text)).toEqual(['pull lever\r', '\r']);
    // Sent; the way still shut: once more, then the door code's.
    e.s.pending = [];
    expect([clear(), clear()]).toEqual([1, 0]);
    e.dispose();
  });

  /*
   * Archer, in the Closet off the keep's hallway (2026-10-18), searched west
   * twice, then walked into the wall some thirty times.
   */
  it('searches for a hidden exit the realm says is searchable until it shows', async () => {
    vi.useFakeTimers();
    const hidden: Route = {
      steps: [{ ...step(2, 1, 's'), requirement: { kind: 'hidden', raw: '', searchable: true } }],
      cost: 1,
      blocked: false
    };
    const { e } = engine('1/2', { '1/2>1/1': hidden });
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mDark Alley\r\n\x1b[0;32mObvious exits: south\r\n');
    expect(e.walkTo('1/1')).toBeNull();
    await planned();
    e.s.roomExits[1] = 0;
    e.s.pending = [];
    expect(e.s.host.clearWay!(e.s.path, 0, 1)).toBe(1);
    expect(e.s.pending.map((p) => p.text)).toEqual(['search s\r', '\r']);
    // Two searches that found nothing are rolls of a skill: the step holds and searches again.
    for (let i = 0; i < 5; i += 1) {
      e.s.pending = [];
      expect(e.s.host.clearWay!(e.s.path, 0, 1)).toBe(1);
      expect(e.s.pending.map((p) => p.text)).toEqual(['search s\r', '\r']);
    }
    // Found: the exit shows, and the step is MegaMUD's own again.
    e.s.roomExits[1] = 1;
    e.s.pending = [];
    expect(e.s.host.clearWay!(e.s.path, 0, 1)).toBe(0);
    expect(e.s.pending).toEqual([]);
    e.dispose();
  });

  /* Fatty went through the portal without telling Skinny (2026-10-14). */
  it('writes a portal step as MegaMUD’s @party step: said to a party, sent alone', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.walkTo('1/4')).toBeNull();
    await planned();
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['e', '@party go portal']);
    e.dispose();
  });

  /* Fatty bashed a gate whose key he carried (2026-10-16). */
  it('writes a locked exit’s key into its step, as MegaMUD’s paths carry it', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/3');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mShop\r\n\x1b[0;32mObvious exits: closed door west\r\n');
    expect(e.walkTo('1/4')).toBeNull();
    await planned();
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['n[use shining steel key n]']);
    e.dispose();
  });

  /* A text exit drops the party's follow on this realm (2026-09-29). */
  it('writes a text exit as an @party step too', async () => {
    vi.useFakeTimers();
    const { e } = engine('1/2');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mDark Alley\r\n\x1b[0;32mObvious exits: south\r\n');
    expect(e.walkTo('1/4')).toBeNull();
    await planned();
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['@party go gate']);
    e.dispose();
  });

  it('pauses half a second at a macro’s ~', () => {
    vi.useFakeTimers();
    const { e, sent } = engine();
    e.s.host.write('say a\r\x01say b\r');
    e.s.host.write('look\r');
    expect(sent).toEqual(['say a\r']);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual(['say a\r', 'say b\r', 'look\r']);
    e.dispose();
  });

  /* The realm moves a sys goto without showing the room; a blank line shows it (2026-10-14). */
  it('follows every sys goto with a blank Enter, however it was sent', () => {
    const { e, sent } = engine();
    e.s.host.write('break\r');
    e.s.host.write('sys goto ');
    e.s.host.write('sil');
    e.s.host.write('\r');
    e.s.host.write('rest\r');
    e.s.host.write('SYS GOTO town\rsay sys goto x\r');
    expect(sent.join('')).toBe('break\rsys goto sil\r\rrest\rSYS GOTO town\r\rsay sys goto x\r');
    e.dispose();
  });

  it('asks where it is on entering the game when our tracker cannot place it', () => {
    vi.useFakeTimers();
    const { e, at } = engine(null);
    expect(e.s.inGame).toBe(0);
    // The first prompt enters the game (`0x47b070`).
    e.received('[HP=100]:');
    expect(e.s.inGame).toBe(1);
    expect(at.locates).toBe(1);
    e.received('[HP=100]:');
    expect(at.locates).toBe(1);
    e.dispose();
  });

  it('puts a walk aside while the realm says where it is, and takes it up when placed', async () => {
    vi.useFakeTimers();
    const { e, at } = engine(null);
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    // Known to MegaMUD's room list, so it heads for its destinations from here.
    (e.s.data.rooms ??= []).push({ signature: e.s.roomSignature, name: 'Town Square' });
    expect(e.startLoop('Ring')).toBeNull();
    await planned();
    expect(at.locates).toBeGreaterThan(0);
    expect(e.s.walking).toBe(0);
    expect(e.s.lost).toBe(0);
    // The reply places the room.
    at.here = '1/1';
    e.received('\r\n');
    await planned();
    expect(e.s.walking).toBe(1);
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['n']);
    e.dispose();
  });

  it('answers as MegaMUD would when the realm never says', async () => {
    vi.useFakeTimers();
    const { e, at } = engine(null);
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    (e.s.data.rooms ??= []).push({ signature: e.s.roomSignature, name: 'Town Square' });
    e.startLoop('Ring');
    await planned();
    expect(e.s.lost).toBe(0);
    vi.advanceTimersByTime(5500);
    expect(e.s.lost).toBe(1);
    expect(at.locates).toBeGreaterThan(0);
    e.dispose();
  });

  /*
   * Archer, leaving the Lady of the Dark through the White Corridor's unlit
   * rooms (2026-10-19): a step refused in the dark, and MegaMUD's lost walk
   * sent forty moves into walls without asking the realm where he was.
   */
  it('asks the realm where it is when lost in the dark, and walks on from its answer', async () => {
    vi.useFakeTimers();
    const { e, at, sent } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.walkTo('1/2')).toBeNull();
    await planned();
    expect(e.s.walking).toBe(1);
    const before = at.locates;
    // Two refusals where nothing can be seen: lost.
    for (let i = 0; i < 2; i += 1) {
      e.s.darkness = Darkness.Dark;
      e.s.state = State.Moving;
      e.received('There is no exit in that direction!\r\n');
    }
    expect(at.locates).toBe(before + 1);
    expect(e.s.walking).toBe(0);
    expect(e.s.lost).toBe(0);
    // Our tracker's guess is not the answer: nothing goes on until it is read.
    at.here = '1/3';
    e.received('[HP=100]:');
    expect(e.s.walking).toBe(0);
    sent.length = 0;
    e.located();
    await planned();
    expect(e.s.walking).toBe(1);
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['w', 'n']);
    // Refused again in the room the realm named: MegaMUD's own search.
    for (let i = 0; i < 2; i += 1) {
      e.s.darkness = Darkness.Dark;
      e.s.state = State.Moving;
      e.received('There is no exit in that direction!\r\n');
    }
    expect(at.locates).toBe(before + 1);
    expect(e.s.lost).toBe(1);
    e.dispose();
  });

  /*
   * MegaMUD says only *There are no paths defined*; the planner knows why, and
   * Archer's walk to the Lava Tube was refused with nothing else said
   * (2026-10-19).
   */
  it('says why the planner found no way, beside MegaMUD’s own line', async () => {
    vi.useFakeTimers();
    const refused: Route = {
      steps: [],
      cost: 0,
      blocked: true,
      reason: 'Beyond opens only to "move boulder" said in Boulder Cave (1/9)'
    };
    const { e, shown } = engine('1/1', { '1/1>1/2': refused });
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    e.walkTo('1/2');
    await planned();
    expect(shown).toContain(`[${refused.reason}]`);
    e.dispose();
  });

  it('does not wait on a realm with no locate command', async () => {
    vi.useFakeTimers();
    const { e, at } = engine(null);
    at.canLocate = false;
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    (e.s.data.rooms ??= []).push({ signature: e.s.roomSignature, name: 'Town Square' });
    e.startLoop('Ring');
    await planned();
    expect(e.s.lost).toBe(1);
    e.dispose();
  });
});

describe('blessings told by our tracker’s buffs', () => {
  /*
   * MudRev's Messages.md names none of Skinny's blessings, so on 13 October
   * 2026 the engine cast them again at every step while our tracker had
   * every one of them up.
   */
  function blessed() {
    const settings = defaultSettings();
    settings.live['Spells']!['BlessCmd1'] = 'npot';
    const { e } = engine();
    e.s.data.spells = [
      {
        layer: 0,
        id: 1526,
        short: 'npot',
        name: 'necropotence',
        item: '',
        flags: SpellFlag.Timed | SpellFlag.Unknown_8 | SpellFlag.Self,
        magic: 3,
        level: 76,
        cost: 28
      }
    ];
    e.reload({ settings, data: e.s.data, grants: {} });
    return e;
  }

  const up = (appliedAt: number) => [{ spell: 'necropotence', by: null, appliedAt }];

  it('takes one going up as cast, settling the cast awaited', () => {
    const e = blessed();
    e.s.state = State.Blessing;
    e.s.blessSlot = 0;
    e.buffs(up(1));
    expect(e.s.blessCastAt[0]).not.toBe(0);
    expect(e.s.state).toBe(0);
  });

  it('makes one going down due again', () => {
    const e = blessed();
    e.buffs(up(1));
    e.buffs([]);
    expect(e.s.blessCastAt[0]).toBe(0);
  });

  it('takes one put up again as cast again', () => {
    const e = blessed();
    e.buffs(up(1));
    e.s.blessCastAt[0] = 5;
    e.buffs(up(1));
    expect(e.s.blessCastAt[0]).toBe(5);
    e.buffs(up(2));
    expect(e.s.blessCastAt[0]).not.toBe(5);
  });

  /*
   * The stat display takes every blessing as gone (`0x494e70`), and MegaMUD
   * sees each one still up again on the display's lines. Skinny's `st`
   * had all of his cast again on 13 October 2026.
   */
  it('keeps one up through the stat display', () => {
    const e = blessed();
    e.s.inGame = 1;
    e.buffs(up(1));
    e.received('Name: Skinny Fatterson                 Lives/CP:      9/7    \r\n');
    expect(e.s.blessCastAt[0]).not.toBe(0);
  });

  it('leaves alone a buff somebody else cast', () => {
    const e = blessed();
    e.buffs([{ spell: 'necropotence', by: 'Fatty', appliedAt: 1 }]);
    expect(e.s.blessCastAt[0]).toBe(0);
  });

  /*
   * Skinny's Messages.md has no row for divine restoration, so every stat
   * sheet took his regen as ended and he cast `rsto` again (2026-10-14).
   */
  /*
   * Skinny's Messages.md files `You are diseased` as losing HP: never cured
   * (2026-10-14). Taken as MegaMUD's own, Fatty rested through it (2026-10-16).
   */
  it('takes an affliction our tracker has on as on, through the stat display, and off when it ends', () => {
    const e = blessed();
    e.s.inGame = 1;
    const none = {
      blind: 'unknown',
      poisoned: 'unknown',
      diseased: 'unknown',
      held: 'no',
      confused: 'unknown'
    } as const;
    e.afflictions({ ...none, blind: 'yes', diseased: 'yes' });
    expect(e.s.blind).toBe(1);
    expect(e.s.diseaseHeard).toBe(1);
    // Only for curing: MegaMUD's own flag, which rests, is left to its rows.
    expect(e.s.diseased).toBe(0);
    e.received('Name: Skinny Fatterson                 Lives/CP:      9/7    \r\n');
    expect(e.s.blind).toBe(1);
    expect(e.s.diseaseHeard).toBe(1);
    e.afflictions({ ...none, diseased: 'no' });
    expect(e.s.blind).toBe(0);
    expect(e.s.diseaseHeard).toBe(0);
    // One the tracker never had is MegaMUD's own to say.
    e.s.poisoned = 1;
    e.afflictions(none);
    expect(e.s.poisoned).toBe(1);
  });

  /*
   * One record of afflictions with our tracker's (2026-10-18): what the
   * engine turns on is told, with the line and the Messages.md row that did.
   */
  it('tells what it turns on, with the line and the row, and when it goes off', () => {
    const { e, told } = engine();
    e.s.inGame = 1;
    e.s.online = 1;
    e.s.data.messages = [
      {
        layer: 0,
        name: 'venom',
        msg: 'The venom burns',
        endMsg: 'The venom fades',
        action: '',
        effects: MessageEffect.Poisoned,
        flags: 0,
        number: 0,
        firedAt: 0
      }
    ];
    e.received('The venom burns in your veins!\r\n');
    expect(told).toEqual([
      [
        'poisoned',
        true,
        expect.objectContaining({
          line: 'The venom burns in your veins!',
          how: 'message',
          spell: 'venom'
        })
      ]
    ]);
    e.received('The venom fades.\r\n');
    expect(told.at(-1)).toEqual(['poisoned', false, null]);
    e.dispose();
  });

  it('does not tell back what our tracker had on, nor take back as ours what it told', () => {
    const { e, told } = engine();
    e.s.inGame = 1;
    const none = {
      blind: 'unknown',
      poisoned: 'unknown',
      diseased: 'unknown',
      held: 'unknown',
      confused: 'unknown'
    } as const;
    e.afflictions({ ...none, blind: 'yes' });
    e.received('\r\n');
    expect(told).toEqual([]);
    // MegaMUD's own disease, told and back again from the tracker as the engine's.
    e.s.diseased = 1;
    e.received('\r\n');
    expect(told.at(-1)?.slice(0, 2)).toEqual(['diseased', true]);
    e.afflictions(
      { ...none, blind: 'yes', diseased: 'yes' },
      { diseased: { line: '', at: 0, how: 'message', spell: 'pox' } }
    );
    expect(e.s.diseaseHeard).toBe(0);
    // Ended by MegaMUD's own row: off, and told.
    e.s.diseased = 0;
    e.received('\r\n');
    expect(told.at(-1)).toEqual(['diseased', false, null]);
    e.dispose();
  });

  it('keeps the regen spell working while it is up, through the stat display', () => {
    const e = blessed();
    const settings = defaultSettings();
    settings.live['Spells']!['RegenCmd'] = 'npot';
    e.reload({ settings, data: e.s.data, grants: {} });
    e.s.inGame = 1;
    e.buffs(up(1));
    expect(e.s.hpRegen).toBe(1);
    e.received('Name: Skinny Fatterson                 Lives/CP:      9/7    \r\n');
    expect(e.s.hpRegen).toBe(1);
    e.buffs([]);
    expect(e.s.hpRegen).toBe(0);
  });
});

describe('the player sending a line', () => {
  /*
   * MegaMUD's re-prompt is a bare Enter after `LagWait` + 15 seconds with
   * nothing sent (`0x4653d0`), counted from its sender, which sends the
   * player's lines too. Ours go out past it, and the Enter cut into what the
   * player was typing (2026-10-13).
   */
  it('starts the re-prompt clock over', () => {
    const { e } = engine();
    e.s.lastSentAt = 1;
    e.typed('gossip hello');
    expect(e.s.lastSentAt).toBe(Math.floor(Date.now() / 1000));
    e.s.lastSentAt = 1;
    e.playerSent();
    expect(e.s.lastSentAt).toBe(Math.floor(Date.now() / 1000));
  });
});

describe('what the engine learns, kept between sessions', () => {
  /*
   * MegaMUD writes the databases it marked changed on the way out
   * (`0x43bfa0`); ours go to our own stores. Until 13 October 2026 every
   * monster, item, player and room signature learned was lost with the
   * session.
   */
  function remembering(memory: Partial<EngineMemory> = {}) {
    vi.useFakeTimers();
    const handed: EngineLessons[] = [];
    const { e: plain } = engine();
    const host = (plain as unknown as { host: MegaEngineHost }).host;
    plain.dispose();
    const e = new MegaEngine(host, {
      settings: defaultSettings(),
      data: { monsters: [], items: [], spells: [] },
      grants: {},
      memory: {
        stances: new Map(),
        players: [],
        items: [],
        signatures: [],
        keep: (lessons) => handed.push(lessons),
        ...memory
      }
    });
    return { e, handed };
  }

  it('starts from what our stores know', () => {
    const { e } = remembering({
      stances: new Map([['kobold thief', 'enemy']]),
      items: [{ name: 'Krabby Pattie', weight: 2, slot: null, weapon: false }],
      players: [{ name: 'Fatty', lastSeen: Date.now(), level: 64 } as PlayerFacts],
      signatures: [['1/2' as RoomId, 0x36804010]]
    });
    expect(e.s.data.monsters.map((m) => [m.name, m.relationship])).toEqual([['kobold thief', 4]]);
    expect(e.s.data.items.find((i) => i.name === 'Krabby Pattie')?.weight).toBe(2);
    expect(e.s.data.players?.find((p) => p.name === 'Fatty')?.level).toBe(64);
    expect(e.learned.get('1/2' as RoomId)).toBe(0x36804010);
    e.dispose();
  });

  /*
   * The immunities learned (`0x471060`'s marks) were let go at every settings
   * save and every restart, and learned again fight after fight (2026-10-14).
   */
  it('keeps the monsters it marked through a reload, hands them over, and starts from them', () => {
    const { e, handed } = remembering({
      marks: [
        ['sinister dragon', 0x200, ['ltch']],
        // A rung's immunity from before marks named their spell is let go.
        ['old dragon', 0x200 | 0x1000]
      ]
    });
    expect(e.s.monsterMarks).toEqual([
      { name: 'sinister dragon', flags: 0x200, spells: ['ltch'] },
      { name: 'old dragon', flags: 0x200 }
    ]);
    e.s.monsterMarks.push({ name: 'forgotten dragon slayer', flags: 0, spells: ['dfur'] });
    e.reload({ settings: defaultSettings(), data: e.s.data, grants: {} });
    expect(e.s.monsterMarks.map((m) => m.name)).toEqual([
      'sinister dragon',
      'old dragon',
      'forgotten dragon slayer'
    ]);
    vi.advanceTimersByTime(1000);
    expect(handed.at(-1)?.marks).toEqual([
      ['sinister dragon', 0x200, ['ltch']],
      ['old dragon', 0x200],
      ['forgotten dragon slayer', 0, ['dfur']]
    ]);
    // Said once: unchanged, nothing more is handed over for them.
    const said = handed.length;
    vi.advanceTimersByTime(1000);
    expect(handed.length).toBe(said);
    e.dispose();
  });

  /*
   * Skinny (2026-10-21): profile 3's `lite` had no effect on the black
   * rosebush, and after profile 2 was chosen in the settings its `dfur` was
   * never tried there, the rosebush still marked immune to the main spell.
   * The mark names `lite` now, and is kept: it says nothing of `dfur`.
   */
  it('puts another profile on from the settings, keeping what each spell is known to do', () => {
    const { e } = remembering({ marks: [['black rosebush', 0, ['lite']]] });
    const settings = defaultSettings();
    settings.live['Profiles']!['ActiveProfile'] = 2;
    settings.live['Combat']!['AttackSpl'] = 'dfur';
    settings.profiles.Combat[1] = {
      enabled: true,
      values: { ...settings.profiles.Combat[0]!.values, AttackSpl: 'dfur' }
    };
    e.s.castMode = State.CastMain;
    e.reload({ settings, data: e.s.data, grants: {} });
    expect(e.s.Profiles_ActiveProfile).toBe(2);
    expect(e.s.castMode).toBe(State.Nothing);
    expect(e.s.monsterMarks).toEqual([{ name: 'black rosebush', flags: 0, spells: ['lite'] }]);
    e.dispose();
  });

  it('hands over what it marks changed at the next second, and the rest on the way out', () => {
    const { e, handed } = remembering();
    const mon = newMonster(e.s.data);
    mon.name = 'mutated dragon hatchling';
    mon.relationship = 4;
    e.s.monstersChanged = 1;
    vi.advanceTimersByTime(1000);
    expect(handed.map((l) => l.stances)).toEqual([[['mutated dragon hatchling', 'enemy']]]);
    expect(e.s.monstersChanged).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(handed).toHaveLength(1);
    e.dispose();
    expect(handed).toHaveLength(1);
  });

  it('copies the data it was given, which other sessions share', () => {
    const data = {
      monsters: [{ name: 'kobold', relationship: 4 } as MonsterRec],
      items: [],
      spells: []
    };
    const { e: plain } = engine();
    const host = (plain as unknown as { host: MegaEngineHost }).host;
    plain.dispose();
    const e = new MegaEngine(host, { settings: defaultSettings(), data, grants: {} });
    e.s.data.monsters[0]!.relationship = 2;
    expect(data.monsters[0]!.relationship).toBe(4);
    e.dispose();
  });
});

describe('databases that arrive after the engine started', () => {
  /*
   * 2026-10-13: an engine set up before its realm's data was in hand kept the
   * empty databases it started with, and knew no monster all session.
   */
  it('are taken up on the next reload, with our tables and what it carries kept', () => {
    const { e } = engine();
    const settings = defaultSettings();
    e.useMonsters([{ mob: 'forgotten dragon slayer', relationship: 'escape' }]);
    e.s.inventory.push({ count: 1, flags: 0, item: { ...coinItems('runic')[0]! } });
    const data = {
      monsters: [
        {
          ...newMonster({ monsters: [], items: [], spells: [] }),
          name: 'forgotten dragon slayer',
          exp: 900
        }
      ],
      items: coinItems('runic'),
      spells: []
    };
    e.reload({ settings, data, grants: {} });
    expect(e.s.data.monsters.map((m) => [m.name, m.exp, m.relationship])).toEqual([
      ['forgotten dragon slayer', 900, 5]
    ]);
    expect(e.s.inventory[0]!.item).toBe(e.s.data.items[0]);
    expect(data.monsters[0]!.relationship).toBe(0);
    e.dispose();
  });
});

describe('blessings the realm says last', () => {
  /*
   * Spells.md had necropotence without the lasting bit a blessing needs, so
   * it was never cast; the realm's spell table says it lasts (2026-10-13).
   */
  it('are marked lasting from the realm’s spell table, once it is loaded', () => {
    const { e } = engine();
    const host = (e as unknown as { host: MegaEngineHost }).host;
    const npot = { short: 'npot', name: 'necropotence', flags: 0x18 } as never as SpellRec;
    const mend = { short: 'gmen', name: 'greater mend', flags: 0x18 } as never as SpellRec;
    e.s.data.spells.push(npot, mend);
    const world = host.world();
    host.world = () =>
      ({
        ...world,
        spellNamed: (name: string) =>
          name === 'necropotence' ? { durationGrowth: [5, 1] } : { duration: undefined }
      }) as never;
    e.buffs([]);
    expect([npot.flags & SpellFlag.Timed, mend.flags & SpellFlag.Timed]).toEqual([2, 0]);
    e.dispose();
  });

  /*
   * By its number, not its name (2026-10-21): another of mudrev's spells is
   * called divine intervention too, and lasts, which held `intr` to the
   * round timer.
   */
  it('are marked lasting by their own row, where a name is another spell’s too', () => {
    const { e } = engine();
    const host = (e as unknown as { host: MegaEngineHost }).host;
    const intr = { id: 1479, short: 'intr', name: 'divine intervention', flags: 0x84 } as SpellRec;
    e.s.data.spells.push(intr);
    const world = host.world();
    host.world = () =>
      ({
        ...world,
        spellNamed: () => ({ id: 9001, name: 'divine intervention', duration: 160 }),
        spellById: (id: number) => (id === 1479 ? { id, name: 'divine intervention' } : null)
      }) as never;
    e.buffs([]);
    expect(intr.flags & SpellFlag.Timed).toBe(0);
    e.dispose();
  });

  /* MudRev's songs cast the spell that lasts; Fatty's agility was never kept up (2026-10-14). */
  it('are marked lasting when the spell they cast lasts', () => {
    const { e } = engine();
    const host = (e as unknown as { host: MegaEngineHost }).host;
    const agil = { short: 'agil', name: 'song of agility', flags: 0x30 } as never as SpellRec;
    e.s.data.spells.push(agil);
    const world = host.world();
    host.world = () =>
      ({
        ...world,
        spellNamed: () => ({ id: 48, name: 'song of agility', casts: [2169, 2156] }),
        spellById: (id: number) =>
          id === 2156 ? { id, name: 'song of agility', duration: 40 } : { id, name: 'remove agil' }
      }) as never;
    e.buffs([]);
    expect(agil.flags & SpellFlag.Timed).toBe(2);
    e.dispose();
  });

  /* Our tracker asks for a sheet through the engine's own wish for one (`0xe29c`). */
  it('want a stat sheet when our tracker asks, without undoing a forced one', () => {
    const { e } = engine();
    e.s.statDue = 0;
    e.wantStat();
    expect(e.s.statDue).toBe(1);
    e.s.statDue = -1;
    e.wantStat();
    expect(e.s.statDue).toBe(-1);
    e.dispose();
  });
});

describe('the realm’s BBS set-up', () => {
  /* MegaMUD's BBS.INI keys, from the realm's own settings (2026-10-13). */
  it('is read at the start and again on a settings reload', () => {
    const { e } = engine();
    expect(e.s.logoffCmd).toBe('');
    e.reload({
      settings: defaultSettings(),
      data: e.s.data,
      grants: {},
      bbs: { LogoffCmd: 'x', PvpLevel: '40' }
    });
    expect([e.s.logoffCmd, e.s.pvpLevel]).toEqual(['x', 40]);
    e.dispose();
  });
});

describe('the realm’s coins', () => {
  /* Skinny Inc's runic coin is a Krabby Patty: `g Krabby Patties` without a count was refused 2,375 times (2026-10-13). */
  it('picks up a renamed runic coin as a coin, by its count', () => {
    const { e: plain, sent } = engine();
    const host = (plain as unknown as { host: MegaEngineHost }).host;
    plain.dispose();
    const e = new MegaEngine(host, {
      settings: defaultSettings(),
      data: { monsters: [], items: coinItems('Krabby Patties'), spells: [] },
      grants: {},
      bbs: { RunicName: 'Krabby Patties' }
    });
    const { s } = e;
    s.hp = 100;
    s.weightMax = 1000;
    s.MegaMud_AutoCash = 1;
    s.Cash_WantRunic = 1;
    s.room = [
      Object.assign(newEntity(), {
        type: 3,
        count: 23,
        name: 'Krabby Patties',
        item: s.data.items[4]
      })
    ];
    sent.length = 0;
    expect(collectItems(s)).toBe(1);
    expect(sent).toContain('g 23 Krabby Patties\r');
    e.dispose();
  });
});

describe('the toolbar’s toggles on the engine', () => {
  it('say when they change, and press through to MegaMUD’s commands', () => {
    const { e } = engine();
    const host = (e as unknown as { host: MegaEngineHost }).host;
    let said = 0;
    host.toggled = () => (said += 1);
    const before = e.toggles.on.nuke;
    e.toggle('nuke');
    expect(e.toggles.on.nuke).toBe(!before);
    expect(said).toBe(1);
    e.typed('look');
    expect(said).toBe(1);
    e.dispose();
  });

  /* `0x460d50`: under All Off every other toggle is drawn off, and Go cannot be pressed. */
  it('read off under All Off, and walking as the engine walks', () => {
    const { e } = engine();
    e.s.inGame = 1;
    e.s.MegaMud_AutoCombat = 1;
    e.s.detours[0]!.path = 'loop';
    expect([e.toggles.on.combat, e.toggles.canGo]).toEqual([true, true]);
    e.toggle('allOff');
    expect([e.toggles.on.allOff, e.toggles.on.combat, e.toggles.canGo]).toEqual([
      true,
      false,
      false
    ]);
    e.toggle('allOff');
    e.s.walking = 1;
    e.s.looping = 1;
    expect([e.toggles.walking, e.toggles.looping, e.toggles.on.combat]).toEqual([true, true, true]);
    e.dispose();
  });

  it('are kept through a settings reload', () => {
    const { e } = engine();
    const before = e.toggles.on.nuke;
    e.toggle('nuke');
    e.reload({ settings: defaultSettings(), data: e.s.data, grants: {} });
    expect(e.toggles.on.nuke).toBe(!before);
    e.dispose();
  });
});

describe('MegaMUD’s alerts', () => {
  /* `0x4c0640`: sound on, a sound named, and with AlertWhenAfk only while AFK. */
  it('are said where MegaMUD would play a sound', () => {
    const settings = defaultSettings();
    settings.live['Alerts']!['AlertIdle'] = 'ding.wav';
    const { e } = engine();
    const host = (e as unknown as { host: MegaEngineHost }).host;
    const said: string[] = [];
    host.alert = (which) => said.push(which);
    e.reload({ settings, data: e.s.data, grants: {} });
    const alert = (which: string) => e.s.host.alert?.(which);
    e.s.Alerts_AlertWhenAfk = 1;
    e.s.active = 0;
    alert('idle');
    expect(said).toEqual([]);
    e.s.active = 1;
    alert('idle');
    alert('train');
    expect(said).toEqual(['idle']);
    e.dispose();
  });
});
