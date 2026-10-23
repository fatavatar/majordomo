import { describe, expect, it } from 'vitest';

import { defaultSettings } from '../../../shared/megamud/settings';
import { activateProfile, loadCharacter, useProfile } from '../character';
import { resetAll } from '../script/game';
import { session } from './fixture';

/* `0x446560`, `0x446910` and `0x4b3f70`, read 2026-10-14. */

function withProfiles() {
  const fixture = session();
  const settings = defaultSettings();
  const base = settings.profiles.Combat[0]!.values;
  settings.profiles.Combat[1] = {
    enabled: true,
    values: { ...base, AttackCmd: 'bash', MaxCastCnt: 3 }
  };
  settings.profiles.Combat[2] = { enabled: false, values: { ...base, AttackCmd: 'kick' } };
  loadCharacter(fixture.s, settings);
  return fixture;
}

describe('config profiles (0x446910)', () => {
  it('put a tab’s copy on, and say which tabs keep it', () => {
    const { s, out } = withProfiles();
    expect(useProfile(s, 2)).toBe(1);
    expect(s.Profiles_ActiveProfile).toBe(2);
    expect(s.Combat_AttackCmd).toBe('bash');
    expect(s.Combat_MaxCastCnt).toBe(3);
    expect(out.shown).toContain('[Config Profile 2 Activated (combat)]');
  });

  it('are refused where no tab has them enabled, or out of range', () => {
    const { s, out } = withProfiles();
    expect(activateProfile(s, 3)).toBe(0);
    expect(useProfile(s, 3)).toBe(0);
    expect(useProfile(s, 9)).toBe(0);
    expect(out.shown).toEqual([
      '[Config Profile 3 Not Activated (not enabled on any tab)]',
      '[Config Profile 1 Is Active (use 1-4)]'
    ]);
  });
});

describe('@reset (0x4b3f70)', () => {
  it('clears the conditions and waits, and starts the statistics again', () => {
    const { s } = session();
    Object.assign(s, { blind: 1, poisoned: 1, held: 1, partyWait: 1, waitLines: 2 });
    resetAll(s);
    expect([s.blind, s.poisoned, s.held, s.partyWait, s.waitLines]).toEqual([0, 0, 0, 0, 0]);
    expect(s.lookDue).toBe(1);
  });
});
