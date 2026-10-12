import { describe, expect, it } from 'vitest';

import { beginCast } from '../combat/casts';
import type { SpellRec } from '../data';
import { castLine } from '../player/cast';
import { addEntity } from '../room/entities';
import { session } from './fixture';

/* `0x47c280`, read 2026-10-12. */

function spell(short: string, name: string, flags = 0): SpellRec {
  return { layer: 0, id: 1, short, name, item: '', flags, magic: 0, level: 0, cost: 5 };
}

function fighting() {
  const rip = spell('rip', 'soul rip');
  const mihe = spell('mihe', 'minor healing');
  const fixture = session({ spells: [rip, mihe] });
  const { s } = fixture;
  s.inGame = 1;
  s.online = 1;
  s.inCombat = 1;
  s.Combat_AttackSpl = 'rip';
  s.state = 0xd;
  beginCast(s, 0xd, rip);
  s.lastCast = 'rip';
  return fixture;
}

describe('the fight spell (0x47c280)', () => {
  it('counts a cast of the spell being cast', () => {
    const { s } = fighting();
    castLine(s, 'You cast soul rip on the giant rat!');
    expect(s.f_a3f4).toBe(1);
  });

  it('counts an attempt that fizzles', () => {
    const { s } = fighting();
    castLine(s, 'You attempt to cast soul rip, but fail.');
    expect(s.f_a3f4).toBe(1);
  });

  it('does not count another spell', () => {
    const { s } = fighting();
    castLine(s, 'You cast minor healing on Skinny!');
    expect(s.f_a3f4).toBe(0);
  });

  it('spends the mode when the spell has no effect, and marks the monster immune', () => {
    const { s, out } = fighting();
    const rat = addEntity(s);
    rat.name = 'giant rat';
    rat.type = 2;
    rat.kind = 4;
    rat.mon = {
      layer: 0,
      name: 'giant rat',
      id: 1,
      flags: 0,
      relationship: 4,
      exp: 0,
      maxHp: 0,
      preSpell: '',
      attackSpell: '',
      preMax: 0,
      attackMax: 0
    };
    s.target = 'giant rat';
    castLine(s, 'Your spell has no effect!');
    expect(s.f_a3f4).toBe(9999);
    expect(rat.flags & 0x1000).toBe(0x1000);
    expect(out.shown).toContain('[giant rat now immune to CastMain]');
    expect(s.inCombat).toBe(0);
  });

  it('leaves the heal state settled when a heal is cast', () => {
    const { s } = fighting();
    s.state = 0x15;
    s.f_a448 = 0;
    castLine(s, 'You cast minor healing on Skinny!');
    expect(s.state).toBe(0);
  });
});
