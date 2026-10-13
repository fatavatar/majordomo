import { afterEach, describe, expect, it, vi } from 'vitest';

import { newTerminal, parseData } from '../../megamud/input/ParseData';
import { defaultSettings } from '../../../shared/megamud/settings';
import type { Route, RouteStep, WorldRoom } from '../../../shared/world';
import { session } from '../../megamud/__tests__/fixture';
import { MegaEngine, nameHash, worldSignature, type MegaEngineHost } from '../MegaEngine';

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
const ROOMS = [SQUARE, ALLEY, SHOP];

function step(from: number, to: number, command: string): RouteStep {
  return { from: `1/${from}`, to: `1/${to}`, direction: command, command } as RouteStep;
}

/** The ways between the three rooms. */
function plan(from: string, to: string): Route {
  const ways: Record<string, RouteStep[]> = {
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
    plan,
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

describe('the engine in a session', () => {
  it('walks a loop of ours as MegaMUD’s loop, from the room it is in', () => {
    vi.useFakeTimers();
    const { e, sent } = engine('1/1');
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    expect(e.s.f_8130).toBe(worldSignature(SQUARE));
    expect(e.startLoop('Ring')).toBeNull();
    expect(e.s.loopPath.start).toBe(worldSignature(ALLEY));
    // Loaded when it is walked (`0x482600` without loading); the path made:
    expect(e.s.paths[0]!.steps!.map((st) => st.command)).toEqual(['s', 'e', 'w', 'n']);
    // On the way to its start: the route from here is the path walked.
    expect(e.s.walking).toBe(1);
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['n']);
    expect(sent).toEqual([]);
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

  it('puts a walk aside while the realm says where it is, and takes it up when placed', () => {
    vi.useFakeTimers();
    const { e, at } = engine(null);
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    // Known to MegaMUD's room list, so it heads for its destinations from here.
    (e.s.data.rooms ??= []).push({ signature: e.s.f_8130, name: 'Town Square' });
    expect(e.startLoop('Ring')).toBeNull();
    expect(at.locates).toBeGreaterThan(0);
    expect(e.s.walking).toBe(0);
    expect(e.s.lost).toBe(0);
    // The reply places the room.
    at.here = '1/1';
    e.received('\r\n');
    expect(e.s.walking).toBe(1);
    expect(e.s.path.steps!.map((st) => st.command)).toEqual(['n']);
    e.dispose();
  });

  it('answers as MegaMUD would when the realm never says', () => {
    vi.useFakeTimers();
    const { e, at } = engine(null);
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    (e.s.data.rooms ??= []).push({ signature: e.s.f_8130, name: 'Town Square' });
    e.startLoop('Ring');
    expect(e.s.lost).toBe(0);
    vi.advanceTimersByTime(5500);
    expect(e.s.lost).toBe(1);
    expect(at.locates).toBeGreaterThan(0);
    e.dispose();
  });

  it('does not wait on a realm with no locate command', () => {
    vi.useFakeTimers();
    const { e, at } = engine(null);
    at.canLocate = false;
    e.s.inGame = 1;
    e.s.online = 1;
    e.received('\x1b[1;36mTown Square\r\n\x1b[0;32mObvious exits: north, closed door east\r\n');
    (e.s.data.rooms ??= []).push({ signature: e.s.f_8130, name: 'Town Square' });
    e.startLoop('Ring');
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
});
