import { describe, expect, it } from 'vitest';

import {
  eventsOf,
  monitorsOf,
  newMonitorRow,
  statlineAdd,
  healthShare,
  statlinePreview,
  withEvents,
  withMonitors
} from '../lists';
import { settingsFromIni } from '../settings';

/* `0x437870`, `0x435f80` and `0x437a10`, read 2026-10-14. */
describe('timed events', () => {
  it('reads daily, repeating and disabled events until one is missing', () => {
    const settings = settingsFromIni(
      '[Schedule]\r\nEvent0=5:14:30:say hi\r\nEvent1=-6:-1:20:Loop A\r\nEvent2=2:-3:4:\r\nEvent4=1:0:0:\r\n'
    );
    expect(eventsOf(settings)).toEqual([
      { type: 5, disabled: false, at: { hour: 14, minute: 30 }, text: 'say hi' },
      { type: 6, disabled: true, at: { every: 20, unit: -1 }, text: 'Loop A' },
      { type: 2, disabled: false, at: { every: 4, unit: -3 }, text: '' }
    ]);
  });

  it('writes them back as MegaMUD does, a period of at least one', () => {
    const settings = withEvents(settingsFromIni(''), [
      { type: 4, disabled: true, at: { every: 0, unit: -2 }, text: 'Bank' },
      { type: 1, disabled: false, at: { hour: 7, minute: 5 }, text: '' }
    ]);
    expect(settings.extra).toEqual([
      {
        name: 'Schedule',
        entries: [
          ['Event0', '-4:-2:1:Bank'],
          ['Event1', '1:7:5:']
        ]
      }
    ]);
    expect(eventsOf(settings)).toHaveLength(2);
    expect(withEvents(settings, []).extra).toEqual([]);
  });
});

/* `0x404140` and `0x4048f0`. */
describe('ability monitors', () => {
  it('reads old and new rows, and their messages', () => {
    const settings = settingsFromIni(
      '[AbilMon]\r\nMonitor0=0:145:3:0:20:0:257:30:1:mrgn:\r\nMonitor0Msg=You feel\r\nMonitor1=1:1:0:2:5:1:8:5:0:1:1::rest\r\n'
    );
    const [a, b] = monitorsOf(settings);
    expect(a).toMatchObject({
      ability: 145,
      part: 3,
      value: 20,
      when: 257,
      spell: 'mrgn',
      message: 'You feel'
    });
    expect(b).toMatchObject({
      disabled: true,
      compare: 2,
      useCommand: 1,
      chained: true,
      urgent: true,
      command: 'rest'
    });
  });

  it('round-trips through the writer', () => {
    const row = { ...newMonitorRow(), ability: 7, command: 'cast x', message: 'Ouch' };
    const settings = withMonitors(settingsFromIni(''), [row]);
    expect(settings.extra[0]!.entries).toEqual([
      ['Monitor0', '0:7:0:0:0:1:1:60:0:0:0::cast x'],
      ['Monitor0Msg', 'Ouch']
    ]);
    expect(monitorsOf(settings)).toEqual([row]);
  });
});

/* `0x4a5f00`, `0x4a6300` and `0x4a6920`. */
describe('the statline builder', () => {
  it('starts a custom line from full, with the hit points first', () => {
    expect(statlineAdd('full', 0, 0, false)).toBe('full custom [HP=%h]:%r');
    expect(statlineAdd('full', 2, 0, true)).toBe('full custom [HP=%h,KAI=%m]:%r');
  });

  it('puts an item before the closing bracket, a colour with its number', () => {
    expect(statlineAdd('full custom [HP=%h]:%r', 1, 0, false)).toBe('full custom [HP=%h/%H]:%r');
    expect(statlineAdd('full custom [HP=%h]:%r', 10, 2, false)).toBe('full custom [HP=%h%f2]:%r');
    expect(statlineAdd('custom x', 4, 0, false)).toBe('full custom x,Wealth=%c]:%r');
  });

  it('shows the line with the figures, colours and styles left out', () => {
    const sample = {
      hp: 50,
      maxHp: 80,
      mana: 3,
      maxMana: 9,
      wealth: 12,
      exp: 1,
      need: 2,
      kai: false
    };
    expect(statlinePreview('full', sample)).toBe('[HP=50,MA=3]: (Resting) ');
    expect(statlinePreview('full custom %f2[HP=%h/%H%B]:', sample)).toBe('[HP=50/80]:');
  });
});

describe('the Health tab figures (0x442dc0)', () => {
  it('shows a percentage as its share of the maximum', () => {
    expect(healthShare(90, 243)).toBe('[218/243]');
    expect(healthShare(0, 243)).toBe('[0/243]');
    expect(healthShare(150, 40)).toBe('[40/40]');
  });

  it('drops the maximum once it is past 999', () => {
    expect(healthShare(50, 1200)).toBe('[600]');
  });
});
