import { describe, expect, it } from 'vitest';

import { abilitiesListLine } from '../abilities/list';
import {
  abilityLine,
  abilityMonitors,
  abilityPrompt,
  abilTimedOut,
  loadMonitors,
  monitorTimer
} from '../abilities/monitors';
import { session } from './fixture';

/* `0x404140`, `0x403c70`, `0x4045b0`, `0x403280`, `0x403720` and `0x4056d0`, read 2026-10-12. */

function monitored(ini: Record<string, string>) {
  const r = session();
  const { s } = r;
  s.inGame = 1;
  s.online = 1;
  s.hp = 100;
  s.now = r.clock.now;
  loadMonitors(s, (key) => ini[key] ?? '');
  return r;
}

/** Ability 7 (DR) below 5: send `cast shield`, checked every 30 seconds. */
const LOW_DR = { Monitor0: '0:7:0:0:5:1:1:30:0:0:0::cast shield' };

describe('the ability monitors', () => {
  it('asks the ability when its timed check is due, and fires on the reply', () => {
    const { s, out } = monitored(LOW_DR);
    monitorTimer(s);
    expect(s.monitors[0]!.due).toBe(1);
    expect(abilityMonitors(s)).toBe(1);
    expect(out.sent).toEqual(['abil 7\r']);
    expect(s.state).toBe(0x2e);
    expect(abilityLine(s, 'DR(7) 3')).toBe(1);
    abilityPrompt(s);
    expect(s.monitors[0]!.lastValue).toBe(3);
    expect(s.pending.map((p) => [p.text, p.tag])).toEqual([['cast shield\r', 1]]);
    expect(s.state).toBe(0);
  });

  it('does nothing when the value does not compare', () => {
    const { s } = monitored(LOW_DR);
    monitorTimer(s);
    abilityMonitors(s);
    abilityLine(s, 'DR(7) 12');
    abilityPrompt(s);
    expect(s.pending).toEqual([]);
  });

  it('tests a part of the value when the reply gives them', () => {
    const { s } = monitored({ Monitor0: '0:7:2:0:5:1:1:30:0:0:0::cast shield' });
    monitorTimer(s);
    abilityMonitors(s);
    abilityLine(s, 'DR(7) 9');
    abilityLine(s, 'granted: DR(7) 7');
    abilityLine(s, 'worn: DR(7) 2');
    abilityPrompt(s);
    expect(s.monitors[0]!.lastValue).toBe(2);
    expect(s.pending.map((p) => p.text)).toEqual(['cast shield\r']);
  });

  it('suspends a monitor whose ability is not found', () => {
    const { s, out } = monitored(LOW_DR);
    monitorTimer(s);
    abilityMonitors(s);
    expect(abilityLine(s, 'Ability 7 not found.')).toBe(1);
    expect(s.monitors[0]!.state).toBe(2);
    expect(out.shown).toEqual(['[Ability monitor: ability 7 not found - monitor suspended]']);
  });

  it('suspends one after three asks go unanswered', () => {
    const { s, out } = monitored(LOW_DR);
    for (let i = 0; i < 3; i += 1) {
      s.monitors[0]!.due = 1;
      s.now += 2;
      abilityMonitors(s);
      abilTimedOut(s);
    }
    expect(s.monitors[0]!.state).toBe(2);
    expect(out.shown).toEqual(['[Ability monitor: no reply to "abil 7" - monitor suspended]']);
  });

  it("reads the player's own abil reply for a watched ability", () => {
    const { s } = monitored(LOW_DR);
    expect(abilityLine(s, 'DR(7) 1')).toBe(1);
    expect(s.abilUnasked).toBe(1);
    abilityPrompt(s);
    expect(s.pending.map((p) => p.text)).toEqual(['cast shield\r']);
  });

  it('makes a monitor due on its message', () => {
    const { s } = monitored({ ...LOW_DR, Monitor0Msg: 'Your shield fades' });
    s.monitors[0]!.when |= 0x100;
    abilityLine(s, 'Your shield fades away.');
    expect(s.monitors[0]!.due).toBe(1);
  });
});

describe('the abilities listing (0x4056d0)', () => {
  it('names each ability and sums up the quests', () => {
    const { s, out } = monitored({});
    expect(abilitiesListLine(s, 'User abilities: 1(5) 126(3) 133(9)')).toBe(1);
    expect(out.shown).toContain('Ability   1(5):   Damage');
    expect(out.shown).toContain(
      'MOD 1 good quest incomplete (need to speak with Chancellor Annora).'
    );
    expect(out.shown).toContain('MOD 5 low-level quest done.');
    expect(out.shown).toContain('Ice Sorceress throne quest not yet done.');
  });
});
