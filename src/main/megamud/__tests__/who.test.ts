import { describe, expect, it } from 'vitest';

import { findPlayer } from '../room/checkNames';
import { newPlayer } from '../data';
import { whoLine } from '../players/who';
import { session } from './fixture';

/* `0x4c14b0`, `0x4c1d00` and `0x4c12b0`, read 2026-10-12; the listing is Skinny's, 2026-10-12. */

const WHO = [
  '         Current Adventurers',
  '         ===================',
  '',
  '   Saint Damyr SmashEm         -  Demonhunter   ',
  '    Good David LoPan           -  Apprentice Sage   ',
  '         Fatty Fatterson       -  Swashbuckler   ',
  '  Lawful Healbot AtDoGdheUser  -  Acolyte  EDITED',
  '         Skinny Fatterson      -  Dark Bishop   '
];

function listed() {
  const r = session();
  r.s.inGame = 1;
  r.s.Player_Name = 'Skinny';
  r.s.Player_Level = 80;
  newPlayer(r.s.data, 0).name = 'Skinny';
  for (const line of WHO) whoLine(r.s, line);
  r.s.lineFlags |= 1;
  whoLine(r.s, '');
  return r;
}

describe('who (0x4c14b0)', () => {
  it('lists everyone online', () => {
    const { s } = listed();
    expect(s.whoList.map((w) => w.name)).toEqual(['Damyr', 'David', 'Fatty', 'Healbot', 'Skinny']);
    expect(s.lineFlags & 0x380).toBe(0);
  });

  it('learns new players with their surname and alignment', () => {
    const { s, out } = listed();
    const damyr = findPlayer(s, 'Damyr')!;
    expect(damyr.surname).toBe('SmashEm');
    expect(damyr.alignment).toBe(2);
    expect(out.shown).toContain('[Damyr added to known players]');
  });

  it('guesses a level from the title', () => {
    const { s } = listed();
    const fatty = findPlayer(s, 'Fatty')!;
    expect(fatty.level).toBeGreaterThan(1);
    expect(fatty.flags & 2).toBe(2);
  });

  it('keeps the list current as players come and go', () => {
    const { s } = listed();
    whoLine(s, 'Fatty just left the Realm.');
    expect(s.whoList.some((w) => w.name === 'Fatty')).toBe(false);
    whoLine(s, 'Warrax just entered the Realm.');
    expect(s.whoList.some((w) => w.name === 'Warrax')).toBe(true);
  });
});
