import { describe, expect, it } from 'vitest';

import {
  atol,
  defaultSettings,
  num,
  parseIni,
  settingsFromIni,
  settingsToIni,
  settingsToStored,
  settingsFromStored,
  switchProfile,
  text
} from '../settings';

/*
 * The loader (`0x449aa0`) and the defaults (`0x447f40`) as read on
 * 2026-10-12. Every expectation is a branch of one of them.
 */
describe('MegaMUD settings defaults', () => {
  it('starts each key at the value 0x447f40 sets', () => {
    const settings = defaultSettings();
    expect(num(settings, 'Health', 'HpFull%')).toBe(99);
    expect(num(settings, 'Health', 'HpRest%')).toBe(90);
    expect(num(settings, 'Health', 'HpHeal%')).toBe(80);
    expect(num(settings, 'Health', 'ManaRest%')).toBe(20);
    expect(num(settings, 'Health', 'PrePostRest')).toBe(1);
    expect(num(settings, 'Combat', 'MaxCastCnt')).toBe(10);
    expect(num(settings, 'Profiles', 'ActiveProfile')).toBe(1);
  });

  it('has copy 1 of each profiled section and no others', () => {
    const settings = defaultSettings();
    expect(settings.profiles.Health[0]?.values['HpFull%']).toBe(99);
    expect(settings.profiles.Health.slice(1)).toEqual([null, null, null]);
  });
});

describe('reading a number as 0x4475d0 does', () => {
  it('is atol', () => {
    expect(atol('42')).toBe(42);
    expect(atol('  -7')).toBe(-7);
    expect(atol('12abc')).toBe(12);
    expect(atol('abc')).toBe(0);
    expect(atol('')).toBe(0);
  });

  it('keeps the default for a missing key and reads text as 0', () => {
    const settings = settingsFromIni('[Health]\r\nHpRest%=junk\r\n');
    expect(num(settings, 'Health', 'HpRest%')).toBe(0);
    expect(num(settings, 'Health', 'HpFull%')).toBe(99);
  });
});

describe('reading an INI file', () => {
  it('matches sections and keys without regard to case', () => {
    const settings = settingsFromIni('[health]\nhprest%=55\n');
    expect(num(settings, 'Health', 'HpRest%')).toBe(55);
  });

  it('strips blanks and one pair of quotes, as GetPrivateProfileString does', () => {
    const settings = settingsFromIni('[Health]\nPreRestCmd = "eq healing stone" \n');
    expect(text(settings, 'Health', 'PreRestCmd')).toBe('eq healing stone');
  });

  it('cuts text to the buffer the loader reads it into, less its terminator', () => {
    // `HealCmd` is read into 0x14 bytes.
    const settings = settingsFromIni(`[Spells]\nHealCmd=${'x'.repeat(40)}\n`);
    expect(text(settings, 'Spells', 'HealCmd')).toBe('x'.repeat(19));
  });

  it('clamps HpHeal% the way the loader does', () => {
    expect(num(settingsFromIni('[Health]\nHpHeal%=0\n'), 'Health', 'HpHeal%')).toBe(0);
    expect(num(settingsFromIni('[Health]\nHpHeal%=150\n'), 'Health', 'HpHeal%')).toBe(100);
    expect(num(settingsFromIni('[Health]\nHpHeal%=99\n'), 'Health', 'HpHeal%')).toBe(99);
  });

  it('falls back to the older names', () => {
    const settings = settingsFromIni('[Combat]\nActiveProfile=3\n[Party]\nPartyHeal=mahe\n');
    expect(num(settings, 'Profiles', 'ActiveProfile')).toBe(3);
    expect(text(settings, 'Party', 'PartyHeal1')).toBe('mahe');
  });

  it('treats an ActiveProfile outside 1 to 4 as 1', () => {
    expect(num(settingsFromIni('[Profiles]\nActiveProfile=7\n'), 'Profiles', 'ActiveProfile')).toBe(
      1
    );
  });

  it('lets HangupWhenAfk clear HangupNotAfk', () => {
    const settings = settingsFromIni('[Other]\nHangupNotAfk=1\nHangupWhenAfk=1\n');
    expect(num(settings, 'Other', 'HangupNotAfk')).toBe(0);
  });
});

describe('profile copies', () => {
  const ini = [
    '[Profiles]',
    'ActiveProfile=2',
    '[Health]',
    'HpRest%=70',
    '[Health.P1]',
    'Enabled=1',
    'HpRest%=40',
    '[Health.P2]',
    'Enabled=0',
    'HpRest%=10'
  ].join('\r\n');

  it('reads each copy, with missing keys as 0', () => {
    const settings = settingsFromIni(ini);
    expect(settings.profiles.Health[0]?.values['HpRest%']).toBe(40);
    expect(settings.profiles.Health[0]?.values['HpFull%']).toBe(0);
    expect(settings.profiles.Health[1]?.enabled).toBe(false);
  });

  it('copies the live values into the active copy', () => {
    const settings = settingsFromIni(ini);
    expect(settings.profiles.Health[1]?.values['HpRest%']).toBe(70);
    expect(num(settings, 'Health', 'HpRest%')).toBe(70);
  });

  it('makes copy 1 from the live values when there is none', () => {
    const settings = settingsFromIni('[Combat]\nMaxCastCnt=3\n');
    expect(settings.profiles.Combat[0]?.values['MaxCastCnt']).toBe(3);
  });

  it('switches by storing the live values and loading the chosen copy', () => {
    const switched = switchProfile(settingsFromIni(ini), 1);
    expect(num(switched, 'Profiles', 'ActiveProfile')).toBe(1);
    expect(num(switched, 'Health', 'HpRest%')).toBe(40);
    expect(switched.profiles.Health[1]?.values['HpRest%']).toBe(70);
  });
});

describe('our own storage', () => {
  it('keeps only what differs from MegaMUD’s defaults, and reads back the same', () => {
    const source =
      '[Health]\nHpRest%=61\nSomethingNew=yes\n[Health.P2]\nEnabled=0\nHpRest%=40\n[Mystery]\nA=1\n';
    const read = settingsFromIni(source);
    const stored = settingsToStored(read);
    expect(stored['Health']).toEqual({ 'HpRest%': 61, SomethingNew: 'yes' });
    expect(stored['Health.P2']).toMatchObject({ Enabled: 0, 'HpRest%': 40 });
    expect(settingsFromStored(stored)).toEqual(read);
    expect(settingsFromStored(settingsToStored(defaultSettings()))).toEqual(defaultSettings());
  });
});

describe('writing an INI file', () => {
  it('round-trips what it read, unknown keys included', () => {
    const source = '[Health]\nHpRest%=61\nSomethingNew=yes\n[Mystery]\nA=1\n';
    const again = settingsFromIni(settingsToIni(settingsFromIni(source)));
    expect(num(again, 'Health', 'HpRest%')).toBe(61);
    const raw = parseIni(settingsToIni(again));
    expect(raw.find((s) => s.name === 'Mystery')?.entries).toEqual([['A', '1']]);
    expect(raw.find((s) => s.name === 'Health')?.entries).toContainEqual(['SomethingNew', 'yes']);
  });

  it('writes CRLF and no legacy keys', () => {
    const written = settingsToIni(defaultSettings());
    expect(written).toContain('\r\n');
    expect(written).not.toMatch(/\[Combat\][^[]*ActiveProfile=/);
    expect(written).toMatch(/\[Profiles\]\r\nActiveProfile=1/);
  });
});
