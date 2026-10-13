import { describe, expect, it } from 'vitest';

import {
  defaultSettings,
  settingDef,
  settingsFromDraft,
  settingsFromIni,
  switchProfile
} from '../settings';
import { SETTINGS_TABS } from '../settingsTabs';

describe('MegaMUD’s settings tabs', () => {
  it('are the sixteen tabs in the order 0x49eea0 adds them', () => {
    expect(SETTINGS_TABS.map((tab) => tab.title)).toEqual([
      'Auto-roam',
      'Talk',
      'Statline',
      'Sounds',
      'Other',
      'Health',
      'Spells',
      'Combat',
      'PvP',
      'Party',
      'Loot',
      'General',
      'Display',
      'Toolbar',
      'BBS',
      'Events'
    ]);
  });

  it('bind every control to a setting the schema knows, of a kind that can show it', () => {
    const wrong: string[] = [];
    for (const tab of SETTINGS_TABS) {
      for (const c of tab.controls) {
        const binds = [
          ...(c.bind ? [{ ...c.bind, kind: c.kind }] : []),
          ...(c.rows ?? [])
            .filter((row) => row.key !== undefined)
            .map((row) => ({ section: row.section!, key: row.key!, as: row.kind, kind: row.kind }))
        ];
        for (const b of binds) {
          const def = settingDef(b.section, b.key);
          if (!def) wrong.push(`${tab.title} ${c.id}: ${b.section}.${b.key} unknown`);
          else if ((b.as === 'text') !== (def.kind === 'str'))
            wrong.push(
              `${tab.title} ${c.id}: ${b.section}.${b.key} is ${def.kind}, shown as ${b.as}`
            );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('give the profiled tabs their profile buttons', () => {
    for (const title of ['Health', 'Spells', 'Combat']) {
      const tab = SETTINGS_TABS.find((t) => t.title === title)!;
      expect(tab.profiled).toBe(title);
      expect(tab.controls.filter((c) => c.profile !== undefined).map((c) => c.profile)).toEqual([
        1, 2, 3, 4
      ]);
    }
  });

  it('read a radio group as one value', () => {
    const pvp = SETTINGS_TABS.find((t) => t.title === 'PvP')!;
    const actions = pvp.controls.filter((c) => c.bind?.key === 'PvpAction');
    expect(actions.map((c) => c.bind!.value)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('settings from the window’s draft', () => {
  it('takes each key at its own type and keeps text to one line of its buffer', () => {
    const base = defaultSettings();
    const draft = structuredClone(base);
    draft.live['Health']!['HpRest%'] = 42.7;
    draft.live['Combat']!['AttackCmd'] = 'a\r\n[Rules]\r\nR1=evil';
    draft.live['Health']!['HpHeal%'] = 'lots' as never;
    const next = settingsFromDraft(draft, base)!;
    expect(next.live['Health']!['HpRest%']).toBe(42);
    expect(next.live['Combat']!['AttackCmd']).toMatch(/^a\[Rules\]R/);
    expect(String(next.live['Combat']!['AttackCmd'])).not.toMatch(/[\r\n]/);
    expect(next.live['Health']!['HpHeal%']).toBe(base.live['Health']!['HpHeal%']);
    expect(next.extra).toEqual([]);
  });

  it('keeps the sections outside the schema from the file, not the draft', () => {
    const base = settingsFromIni('[Rules]\r\nR1=1:2:3:x\r\n');
    const draft = { ...structuredClone(base), extra: [{ name: 'Evil', entries: [['a', 'b']] }] };
    const next = settingsFromDraft(draft, base)!;
    expect(next.extra.map((s) => s.name)).toEqual(['Rules']);
  });

  it('carries a profile switch through', () => {
    const base = defaultSettings();
    let draft = switchProfile(base, 2);
    draft.live['Health']!['HpRest%'] = 30;
    draft = switchProfile(draft, 1);
    const next = settingsFromDraft(draft, base)!;
    expect(next.profiles.Health[1]!.values['HpRest%']).toBe(30);
  });

  it('refuses what is not settings', () => {
    expect(settingsFromDraft('nope', defaultSettings())).toBeNull();
    expect(settingsFromDraft({}, defaultSettings())).toBeNull();
  });
});
