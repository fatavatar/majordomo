import { afterEach, describe, expect, it, vi } from 'vitest';

import { newTerminal, parseData } from '../../megamud/input/ParseData';
import { defaultSettings } from '../../../shared/megamud/settings';
import type { RoomId, Route, RouteStep, WorldRoom } from '../../../shared/world';
import { session } from '../../megamud/__tests__/fixture';
import {
  MegaEngine,
  nameHash,
  worldSignature,
  type EngineLessons,
  type EngineMemory,
  type MegaEngineHost
} from '../MegaEngine';
import { coinItems, newMonster, type MonsterRec, type SpellRec } from '../../megamud/data';
import { collectItems } from '../../megamud/script/items';
import { newEntity } from '../../megamud/Session';
import type { PlayerFacts } from '../../../shared/players';
import type { WalkProgress } from '../../../shared/walk';
import type { LoopProgress } from '../../../shared/loops';

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
const ROOMS = [SQUARE, ALLEY, SHOP, BACK];

function step(from: number, to: number, command: string): RouteStep {
  return { from: `1/${from}`, to: `1/${to}`, direction: command, command } as RouteStep;
}

/** The ways between the three rooms; the shop's back room through its portal. */
function plan(from: string, to: string): Route {
  const ways: Record<string, RouteStep[]> = {
    '1/1>1/4': [step(1, 3, 'e'), { ...step(3, 4, 'go portal'), direction: 'portal' }],
    '1/1>1/2': [step(1, 2, 'n')],
    '1/2>1/1': [step(2, 1, 's')],
    '1/1>1/3': [step(1, 3, 'e')],
    '1/3>1/1': [step(3, 1, 'w')],
    '1/2>1/3': [step(2, 1, 's'), step(1, 3, 'e')],
    '1/3>1/2': [step(3, 1, 'w'), step(1, 2, 'n')]
  };
  return { steps: ways[`${from}>${to}`] ?? [], cost: 1, blocked: false };
}

function engine(here: string | null = '1/1') {
  const sent: string[] = [];
  const shown: string[] = [];
  const world = {
    get: (map: number, n: number) => ROOMS.find((r) => r.map === map && r.room === n),
    everyRoom: () => ROOMS.values()
  };
  const at = { here, locates: 0, canLocate: true };
  const host: MegaEngineHost = {
    write: (text) => sent.push(text),
    show: (text) => shown.push(text),
    hangUp: () => {},
    dial: () => {},
    here: () => at.here,
    locate: () => {
      at.locates += 1;
      return at.canLocate;
    },
    world: () => world as never,
    // Planned off main's thread in the client (`RoutePlanner`): answered later.
    plan: (from, to) => Promise.resolve(plan(from, to)),
    loopRooms: (name) =>
      name === 'Ring' ? { rooms: ['1/2', '1/3'], bounce: false } : 'no such loop'
  };
  const e = new MegaEngine(host, {
    settings: defaultSettings(),
    data: { monsters: [], items: [], spells: [] },
    grants: {}
  });
  return { e, sent, shown, at };
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
    expect(s.f_8130).not.toBe(0);
    expect(worldSignature(SQUARE)).toBe(s.f_8130);
    expect(nameHash('Town Square') & 0xfff00000).toBe(s.f_8130 & 0xfff00000);
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
    expect(rec().flags & 2).toBe(0);
    e.alsoTake('Gate Key', true);
    expect(rec().flags & 2).toBe(2);
    e.useItems([{ item: 'gate key', collect: false }]);
    expect(rec().flags & 2).toBe(2);
    e.alsoTake('gate key', false);
    expect(rec().flags & 2).toBe(0);
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

describe('the engine in a session', () => {
  it('walks a loop of ours as MegaMUD’s loop, from the room it is in', async () => {
    vi.useFakeTimers();
    const { e, sent } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.s.f_8130).toBe(worldSignature(SQUARE));
    expect(e.startLoop('Ring')).toBeNull();
    await planned();
    expect(e.s.loopPath.start).toBe(worldSignature(ALLEY));
    // Loaded when it is walked (`0x482600` without loading); the path made:
    expect(e.s.paths[0]!.steps!.map((st) => st.command)).toEqual(['s', 'e', 'w', 'n']);
    // On the way to its start: the route from here is the path walked.
    expect(e.s.walking).toBe(1);
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['n']);
    expect(sent).toEqual([]);
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
    expect(e.learned.get('1/2')).toBe(e.s.f_8130);
    expect(e.signatureOf('1/2')).toBe(e.s.f_8130);
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
    (e.s.data.rooms ??= []).push({ signature: e.s.f_8130, name: 'Town Square' });
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
    (e.s.data.rooms ??= []).push({ signature: e.s.f_8130, name: 'Town Square' });
    e.startLoop('Ring');
    await planned();
    expect(e.s.lost).toBe(0);
    vi.advanceTimersByTime(5500);
    expect(e.s.lost).toBe(1);
    expect(at.locates).toBeGreaterThan(0);
    e.dispose();
  });

  it('does not wait on a realm with no locate command', async () => {
    vi.useFakeTimers();
    const { e, at } = engine(null);
    at.canLocate = false;
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    (e.s.data.rooms ??= []).push({ signature: e.s.f_8130, name: 'Town Square' });
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
        flags: 26,
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
    e.s.state = 0x10;
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
  /* Skinny's Messages.md files `You are diseased` as losing HP: never cured (2026-10-14). */
  it('takes an affliction our tracker has on as on, through the stat display, and off when it ends', () => {
    const e = blessed();
    e.s.inGame = 1;
    const none = {
      blind: 'unknown',
      poisoned: 'unknown',
      diseased: 'unknown',
      held: 'no'
    } as const;
    e.afflictions({ ...none, diseased: 'yes' });
    expect(e.s.diseased).toBe(1);
    e.received('Name: Skinny Fatterson                 Lives/CP:      9/7    \r\n');
    expect(e.s.diseased).toBe(1);
    e.afflictions({ ...none, diseased: 'no' });
    expect(e.s.diseased).toBe(0);
    // One the tracker never had is MegaMUD's own to say.
    e.s.poisoned = 1;
    e.afflictions(none);
    expect(e.s.poisoned).toBe(1);
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
    e.s.f_322a0 = 1;
    e.typed('gossip hello');
    expect(e.s.f_322a0).toBe(Math.floor(Date.now() / 1000));
    e.s.f_322a0 = 1;
    e.playerSent();
    expect(e.s.f_322a0).toBe(Math.floor(Date.now() / 1000));
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
    const { e, handed } = remembering({ marks: [['sinister dragon', 0x80]] });
    expect(e.s.monsterMarks).toEqual([{ name: 'sinister dragon', flags: 0x80 }]);
    e.s.monsterMarks.push({ name: 'forgotten dragon slayer', flags: 0x1000 });
    e.reload({ settings: defaultSettings(), data: e.s.data, grants: {} });
    expect(e.s.monsterMarks.map((m) => m.name)).toEqual([
      'sinister dragon',
      'forgotten dragon slayer'
    ]);
    vi.advanceTimersByTime(1000);
    expect(handed.at(-1)?.marks).toEqual([
      ['sinister dragon', 0x80],
      ['forgotten dragon slayer', 0x1000]
    ]);
    // Said once: unchanged, nothing more is handed over for them.
    const said = handed.length;
    vi.advanceTimersByTime(1000);
    expect(handed.length).toBe(said);
    e.dispose();
  });

  it('hands over what it marks changed at the next second, and the rest on the way out', () => {
    const { e, handed } = remembering();
    const mon = newMonster(e.s.data);
    mon.name = 'mutated dragon hatchling';
    mon.relationship = 4;
    e.s.f_e254 = 1;
    vi.advanceTimersByTime(1000);
    expect(handed.map((l) => l.stances)).toEqual([[['mutated dragon hatchling', 'enemy']]]);
    expect(e.s.f_e254).toBe(0);
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
    expect([npot.flags & 2, mend.flags & 2]).toEqual([2, 0]);
    e.dispose();
  });

  /* Our tracker asks for a sheet through the engine's own wish for one (`0xe29c`). */
  it('want a stat sheet when our tracker asks, without undoing a forced one', () => {
    const { e } = engine();
    e.s.f_e29c = 0;
    e.wantStat();
    expect(e.s.f_e29c).toBe(1);
    e.s.f_e29c = -1;
    e.wantStat();
    expect(e.s.f_e29c).toBe(-1);
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
    s.f_8468 = 1000;
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
