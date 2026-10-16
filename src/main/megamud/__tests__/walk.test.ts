import { describe, expect, it } from 'vitest';

import { goStop, roam } from '../move/buttons';
import { goTo, headFor } from '../move/destinations';
import { doors, runBack } from '../move/go';
import { noAllowedExits, walkPath } from '../script/path';
import { fetchCash } from '../script/cash';
import { newPlayer } from '../data';
import { newPath, type PathRec, type PathStep, type SessionHost } from '../Session';
import { remoteCommand } from '../talk/remote';
import { session } from './fixture';

/* `0x409170`, `0x408870`, `0x408540`, `0x40ae00`, `0x408270`, `0x43d2a0` and the rest, read 2026-10-13. */

const A = 0x11100001;
const B = 0x22200002;
const C = 0x33300003;
const D = 0x44400004;
const E = 0x55500005;

function walker() {
  const r = session({
    rooms: [
      { signature: A, name: 'Town Square', code: 'TOWN' },
      { signature: C, name: 'Bank of Godfrey', code: 'BANK' },
      { signature: D, name: 'Trap Room', flags: 0x10 }
    ]
  });
  const { s } = r;
  s.inGame = 1;
  s.online = 1;
  s.hp = 100;
  s.Player_MaxHP = 100;
  s.now = r.clock.now;
  return r;
}

function path(name: string, steps: PathStep[], start: number, end: number): PathRec {
  return { ...newPath(), name, steps, count: steps.length, start, end };
}

const step = (room: number, command: string, flags = 0): PathStep => ({ room, flags, command });

/** A → B → C, then back to A: a loop. */
const LOOP = (): PathRec => path('TOWNLOOP.MP', [step(A, 'n'), step(B, 'e'), step(C, 'sw')], A, A);

function walking(r: ReturnType<typeof walker>, p: PathRec, at = 0) {
  const { s } = r;
  Object.assign(s.path, p);
  s.MegaMud_CurPathStep = at;
  s.path.step = at;
  s.walking = 1;
  s.f_8130 = p.steps![at]?.room ?? p.end;
  s.roomExits = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
}

describe('walking a path (D48)', () => {
  it('moves by the step taken from this room, and on to the next', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, LOOP());
    expect(walkPath(s)).toBe(1);
    expect(out.sent).toEqual(['n\r']);
    expect(s.state).toBe(0x16);
    expect(s.moveDir).toBe(0);
    expect([s.MegaMud_CurPathStep, s.path.step, s.path.prev]).toEqual([1, 1, 0]);
    expect(s.task).toBe(0xe);
  });

  /* Ours: a ward the room ahead wants goes before the step (2026-10-14). */
  it('asks the host before a step, and holds the step for what it queued', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, LOOP());
    let asked = 0;
    s.host.beforeStep = () => {
      asked += 1;
      if (asked === 1) s.pending.push({ text: 'use amulet\r', expand: 0, checked: 0, tag: 0 });
    };
    expect(walkPath(s)).toBe(0);
    expect(out.sent).toEqual([]);
    s.pending = [];
    expect(walkPath(s)).toBe(1);
    expect(out.sent).toEqual(['n\r']);
    expect(asked).toBe(2);
  });

  it('re-reads the room once when it is not the step’s, then steps back when the move did not happen', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, LOOP(), 1);
    s.path.prev = 0;
    s.f_8130 = A;
    s.state = 0;
    expect(walkPath(s)).toBe(1);
    expect(out.sent).toEqual([]);
    expect(s.f_e290).toBe(1);
    expect(walkPath(s)).toBe(1);
    // Still in A: the path is back a step, and `n` is sent again.
    expect(s.MegaMud_CurPathStep).toBe(1);
    expect(out.sent).toEqual(['n\r']);
  });

  it('moves on a step when the move went a room further', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, LOOP(), 0);
    s.f_8130 = B;
    s.stepTries = 1;
    expect(walkPath(s)).toBe(1);
    expect(out.sent).toEqual(['e\r']);
    expect(s.MegaMud_CurPathStep).toBe(2);
  });

  it('resyncs to the path after three tries off it', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, LOOP(), 0);
    s.f_8130 = C;
    s.roomExits = Array.from({ length: 10 }, () => 0);
    s.stepTries = 2;
    walkPath(s);
    expect(out.shown).toEqual(['[Resynced from path step 0 to 2 (TOWNLOOP.MP)]']);
    expect(out.sent).toEqual(['sw\r']);
  });

  it('takes the loop up again at its end', () => {
    const r = walker();
    const { s } = r;
    walking(r, LOOP(), 3);
    s.looping = 1;
    s.paths = [LOOP()];
    Object.assign(s.loopPath, LOOP());
    s.f_8130 = A;
    expect(walkPath(s)).toBe(2);
    expect(s.task).toBe(0xf);
    expect([s.MegaMud_CurPathStep, s.walking, s.looping]).toEqual([0, 1, 1]);
    expect(s.stepsToGo).toBe(3);
  });

  it('does not hang up for a low experience rate at a lap’s start, as MegaMUD never does (0x30e00 stays -1)', () => {
    const r = walker();
    const { s } = r;
    walking(r, LOOP(), 0);
    s.looping = 1;
    s.Comms_LogoffLowExp = 1;
    s.Comms_MinExpRate = 5000;
    expect(walkPath(s)).toBe(1);
    expect(s.walking).toBe(1);
    expect(s.online).toBe(1);
  });

  it('stops at the end of a path with nothing more to do', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, path('TOBANK.MP', [step(A, 'n'), step(B, 'e')], A, C), 2);
    s.f_8130 = C;
    expect(walkPath(s)).toBe(2);
    expect(s.walking).toBe(0);
    expect(s.task).toBe(0xb);
    expect(out.sent).toEqual([]);
  });

  it('types a step that is not a direction', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, path('X.MP', [step(A, 'rest'), step(A, 'n')], A, B));
    walkPath(s);
    expect(out.sent).toEqual(['rest\r']);
    expect(s.state).toBe(2);
    expect(s.MegaMud_CurPathStep).toBe(1);
  });

  it('says an @party step to the party, after queuing the command', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, path('X.MP', [step(A, '@party climb rope'), step(B, 'n')], A, C));
    s.partySize = 2;
    s.s_7d21 = 'gb ';
    walkPath(s);
    expect(s.pending.map((p) => p.text)).toEqual(['climb rope\r', 'par\r']);
    expect(out.sent).toEqual(['gb @party climb rope\r']);
    expect(s.f_e298).toBe(1);
  });

  it('stops before a room marked so (Rooms.md 0x10)', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, path('X.MP', [step(A, 'n'), step(B, 'e')], A, D), 1);
    s.detours[0]!.room = D;
    walkPath(s);
    expect(out.shown).toEqual(['[Stopped Before Entering (Trap Room)]']);
    expect(out.sent).toEqual([]);
    expect(s.walking).toBe(0);
  });
});

describe('doors and traps (0x408870)', () => {
  it('opens, picks and bashes', () => {
    const r = walker();
    const { s, out } = r;
    s.roomExits[0] = 5;
    expect(doors(s, 0, 0, null)).toBe(1);
    s.roomExits[0] = 2;
    s.Other_CanPickLocks = 1;
    s.Other_PickMax = 1;
    expect(doors(s, 0, 0, null)).toBe(1);
    s.f_db50 = 2;
    expect(doors(s, 0, 0, null)).toBe(1);
    expect(out.sent).toEqual(['open n\r', 'pi n\r', 'bash north\r']);
  });

  it('uses the key a step names, the rest queued', () => {
    const r = walker();
    const { s, out } = r;
    s.roomExits[2] = 2;
    expect(doors(s, 2, 0, 'e[use silver key,e]')).toBe(1);
    expect(out.sent).toEqual(['use silver key', '\r']);
    expect(s.pending.map((p) => p.text)).toEqual(['e\r']);
  });

  it('searches for a trap, then disarms it', () => {
    const r = walker();
    const { s, out } = r;
    s.Other_CanDisarmTraps = 1;
    s.Other_DisarmMax = 2;
    doors(s, 1, 0x200, 's');
    s.f_e2e0 = 1;
    doors(s, 1, 0x200, 's');
    expect(out.sent).toEqual(['search s\r', 'disarm trap s\r']);
  });

  it('gives the path up at a [fail] door with no retry path', () => {
    const r = walker();
    const { s } = r;
    s.walking = 1;
    s.roomExits[0] = 2;
    expect(doors(s, 0, 0, 'n[fail]')).toBe(0);
    expect(s.walking).toBe(0);
  });
});

describe('heading for a destination (0x43d2a0)', () => {
  it('takes the way the route gives, from a known room', () => {
    const r = walker();
    const { s } = r;
    s.f_8130 = A;
    const way = path('TOBANK.MP', [step(A, 'n'), step(B, 'e')], A, C);
    s.paths = [way];
    (s.host as SessionHost).route = () => ({ flags: 0, path: way, steps: 2 });
    expect(goTo(s, C, null)).toBe(1);
    expect(headFor(s, 2)).toBe(0);
    expect(s.MegaMud_CurPath).toBe('TOBANK.MP');
    expect([s.walking, s.task, s.stepsToGo]).toEqual([1, 0xe, 2]);
    expect(s.destination).toBe('Bank of Godfrey');
  });

  it('says so when there is no way', () => {
    const r = walker();
    const { s, out } = r;
    s.f_8130 = A;
    goTo(s, C, null);
    headFor(s, 0);
    expect(out.shown[0]).toMatch(
      /^\[There are no paths defined to get from the current room to "Bank of Godfrey" \(/
    );
    expect([s.lost, s.task]).toEqual([1, 0x11]);
  });

  it('detours to the bank for cash', () => {
    const r = walker();
    const { s } = r;
    s.f_8130 = A;
    s.Cash_Bank = 'Bank of Godfrey';
    const way = path('TOBANK.MP', [step(A, 'n'), step(B, 'e')], A, C);
    s.paths = [way];
    (s.host as SessionHost).route = () => ({ flags: 0, path: way, steps: 2 });
    expect(fetchCash(s, 0, 500)).toBe(0);
    expect(s.f_8430).toBe(500);
    expect(s.detours[0]).toEqual({ room: C, path: '', why: 'for cash' });
  });
});

describe('roaming (D47) and running back (0x40ae00)', () => {
  it('roams by an allowed exit', () => {
    const r = walker();
    const { s, out } = r;
    roam(s);
    expect([s.roaming, s.walking, s.task]).toEqual([1, 1, 0x10]);
    s.roomExits = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    expect(noAllowedExits(s)).toBe(1);
    expect(out.sent).toEqual(['e\r']);
  });

  it('stops roaming where no exit is allowed', () => {
    const r = walker();
    const { s, out } = r;
    roam(s);
    s.Auto_roam_AutoMove = 0;
    s.roomExits = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(noAllowedExits(s)).toBe(0);
    expect(out.shown).toEqual(['[No allowed exits]']);
    expect(s.walking).toBe(0);
  });

  it('runs back along the path for a rescue', () => {
    const r = walker();
    const { s, out } = r;
    walking(r, LOOP(), 2);
    s.f_8130 = C;
    s.rescueCount = 3;
    expect(runBack(s, 0)).toBe(1);
    expect(out.sent).toEqual(['w\r']);
    expect(s.MegaMud_CurPathStep).toBe(1);
    expect(s.rescueCount).toBe(2);
  });
});

describe('the walking buttons and remote commands', () => {
  it('Go with nowhere to go stops again; Stop stops', () => {
    const r = walker();
    const { s } = r;
    goStop(s);
    expect([s.walking, s.task]).toEqual([0, 0xb]);
    s.detours[0]!.room = C;
    goStop(s);
    expect([s.walking, s.task]).toEqual([1, 0xe]);
    goStop(s);
    expect(s.walking).toBe(0);
  });

  it('@goto walks to a Rooms.md room by its code', () => {
    const r = walker();
    const { s } = r;
    for (const name of ['Fatty', 'Skinny']) newPlayer(s.data, 0).name = name;
    s.data.players![0]!.remote = 0x100;
    s.Player_Name = 'Skinny';
    s.f_8130 = A;
    const way = path('TOBANK.MP', [step(A, 'n'), step(B, 'e')], A, C);
    s.paths = [way];
    (s.host as SessionHost).route = () => ({ flags: 0, path: way, steps: 2 });
    remoteCommand(s, 'Fatty telepaths: @goto bank', 0x10);
    expect(s.pending.map((x) => x.text)).toEqual(['/Fatty {ok}\r']);
    expect([s.walking, s.MegaMud_CurPath]).toEqual([1, 'TOBANK.MP']);
  });

  it('@loop on the loop already walks on from here', () => {
    const r = walker();
    const { s } = r;
    for (const name of ['Fatty', 'Skinny']) newPlayer(s.data, 0).name = name;
    s.data.players![0]!.remote = 0x100;
    s.Player_Name = 'Skinny';
    s.f_8130 = B;
    s.paths = [{ ...LOOP(), title: 'Town loop' }];
    remoteCommand(s, 'Fatty telepaths: @loop town loop', 0x10);
    expect(s.pending.map((x) => x.text)).toEqual(['/Fatty {ok}\r']);
    expect([s.MegaMud_CurPath, s.MegaMud_CurPathStep, s.looping, s.task]).toEqual([
      'TOWNLOOP.MP',
      1,
      1,
      0xf
    ]);
  });

  it('@loop makes a known path the loop and heads for its start', () => {
    const r = walker();
    const { s } = r;
    for (const name of ['Fatty', 'Skinny']) newPlayer(s.data, 0).name = name;
    s.data.players![0]!.remote = 0x100;
    s.Player_Name = 'Skinny';
    s.data.rooms!.push({ signature: E, name: 'Gate' });
    s.f_8130 = E;
    const way = path('TOTOWN.MP', [step(E, 's')], E, A);
    s.paths = [{ ...LOOP(), title: 'Town loop' }, way];
    (s.host as SessionHost).route = () => ({ flags: 0, path: way, steps: 1 });
    remoteCommand(s, 'Fatty telepaths: @loop town loop', 0x10);
    expect(s.pending.map((x) => x.text)).toEqual(['/Fatty {ok}\r']);
    expect([s.MegaMud_SelPath, s.MegaMud_CurPath]).toEqual(['TOWNLOOP.MP', 'TOTOWN.MP']);
  });
});
