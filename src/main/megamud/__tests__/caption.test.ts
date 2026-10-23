import { describe, expect, it } from 'vitest';

import { caption, Task } from '../script/task';
import { session } from './fixture';

/* `0x4aac80`'s captions, read 2026-10-16: what `@status` and the stats board say. */
describe('the task caption (0x4aac80)', () => {
  it('says what the task is, as MegaMUD’s title bar does', () => {
    const { s } = session();
    s.online = 1;
    s.inGame = 1;
    s.task = Task.InGame;
    expect(caption(s)).toBe('MANUAL: Waiting for instructions ...');
    s.active = 1;
    expect(caption(s)).toBe('ACTIVE: Waiting for instructions ...');

    s.task = Task.Looping;
    s.laps = 11;
    expect(caption(s)).toBe('Looping ... (Lap 12)');
    s.laps = -1;
    expect(caption(s)).toBe('Completing current loop ...');

    s.task = Task.Walking;
    s.destination = 'Temple';
    s.MegaMud_AutoCombat = 1;
    expect(caption(s)).toBe('Walking to Temple');
    s.MegaMud_AutoCombat = 0;
    s.detours[1]!.room = 5;
    s.detours[0]!.why = 'for torch';
    expect(caption(s)).toBe('Running to Temple (for torch)');

    s.task = Task.Lost;
    expect(caption(s)).toBe('Currently lost ... Looking for a known room');
  });

  it('counts down a redial in seconds, and minutes past one', () => {
    const { s } = session();
    s.task = Task.Redial;
    s.now = 1000;
    s.redialAt = 1001;
    expect(caption(s)).toBe('Reconnecting in 1 second ...');
    s.redialAt = 1090;
    expect(caption(s)).toBe('Reconnecting in 90 seconds (1 min) ...');
  });
});
