import { describe, expect, it } from 'vitest';

import { loadMonitors } from '../abilities/monitors';
import { newTerminal } from '../input/ParseData';
import { afk } from '../move/buttons';
import { newQuietClock, quietTick, secondTick, setActive } from '../script/timer';
import { session } from './fixture';
import { Task } from '../script/task';

/* `0x4653d0`, `0x464910`, `0x42c910`'s quiet timers and `0x4c09a0`, read 2026-10-13. */

function ticking() {
  const r = session();
  const { s } = r;
  s.online = 1;
  s.inGame = 1;
  s.hp = 100;
  s.Player_MaxHP = 100;
  s.now = r.clock.now;
  return r;
}

describe('the one-second timer (0x4653d0)', () => {
  it('stamps the clock and runs the ability monitors’ timer', () => {
    const r = ticking();
    const { s, clock } = r;
    loadMonitors(s, (k) => ({ Monitor0: '0:7:0:0:5:1:1:30:0:0:0::cast shield' })[k] ?? '');
    clock.now += 5;
    secondTick(s);
    expect(s.now).toBe(clock.now);
    expect(s.monitors[0]!.due).toBe(1);
  });

  it('turns AFK on after MegaMud.AfkTimeout minutes with nothing done', () => {
    const r = ticking();
    const { s, out, clock } = r;
    s.MegaMud_AutoAfk = 1;
    s.MegaMud_AfkTimeout = 5;
    s.unknown_322c0 = clock.now;
    s.probablyLastTypedAt = clock.now - 100;
    clock.now += 299;
    secondTick(s);
    expect(s.active).toBe(0);
    clock.now += 2;
    secondTick(s);
    expect(s.active).toBe(1);
    expect(out.shown).toEqual(['[AFK now ON]']);
  });

  it('prompts again when nothing came back for LagWait + 15 seconds', () => {
    const r = ticking();
    const { s, out, clock } = r;
    s.Comms_LagWait = 5;
    s.lastSentAt = clock.now;
    clock.now += 19;
    secondTick(s);
    expect(out.sent).toEqual([]);
    clock.now += 1;
    secondTick(s);
    expect(out.sent).toEqual(['\r']);
  });

  it('gives a state stuck for LagWait + 30 seconds the thirty-second wait', () => {
    const r = ticking();
    const { s, clock } = r;
    s.poisoned = 1;
    s.stateSince = clock.now;
    clock.now += 30;
    secondTick(s);
    expect(s.poisoned).toBe(0);
    expect(s.stateSince).toBe(clock.now);
  });

  it('sets the statline once LagWait + 10 seconds have passed (task 0x12)', () => {
    const r = ticking();
    const { s, out, clock } = r;
    s.task = Task.Entering;
    s.MegaMud_StatLine = 'full';
    s.unknown_323a0 = clock.now;
    clock.now += 10;
    secondTick(s);
    expect(out.sent).toEqual(['set statline full\r']);
    expect(s.task).toBe(0xb);
  });
});

describe('the quiet timers (0x42c910)', () => {
  it('makes three ten-second silences a thirty, and the third thirty drops the connection', () => {
    const r = ticking();
    const { s, out, clock } = r;
    const q = newQuietClock(clock.ms);
    s.task = Task.Walking;
    s.loginQuietTens = 2;
    s.loginQuietStrikes = 2;
    clock.ms += 10_000;
    quietTick(s, newTerminal(), q);
    expect(out.trace.filter((t) => t.startsWith('[No BBS response'))).toHaveLength(1);
    // `Comms.RedialNoResponse` (on by default): redialled after the pause.
    expect([s.task, s.dialState, s.inGame, s.loginQuietTens, s.loginQuietStrikes]).toEqual([
      9, 3, 0, 0, 0
    ]);
  });

  it('runs nothing of the kind offline', () => {
    const r = ticking();
    const { s, out, clock } = r;
    s.online = 0;
    const q = newQuietClock(clock.ms);
    clock.ms += 200_000;
    quietTick(s, newTerminal(), q);
    expect(out.trace).toEqual([]);
  });
});

describe('AFK (0x4c09a0)', () => {
  it('lets NoHangup go when AFK goes on, and tells of messages missed when it goes off', () => {
    const r = ticking();
    const { s, out } = r;
    s.MegaMud_NoHangup = 1;
    afk(s);
    expect([s.active, s.MegaMud_NoHangup]).toEqual([1, 0]);
    expect(out.shown).toEqual(['[Assuming hangup should be re-allowed]']);
    const told: string[] = [];
    s.host.message = (text) => told.push(text);
    s.afkMessages = 2;
    s.Display_PopupAfkMsgs = 1;
    setActive(s, 0);
    expect(told).toEqual(['While AFK, you received 2 messages.']);
  });
});
