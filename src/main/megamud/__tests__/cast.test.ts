import { refreshImmunities } from '../combat/immunity';
import { describe, expect, it } from 'vitest';

import { beginCast } from '../combat/casts';
import type { SpellRec } from '../data';
import { castLine } from '../player/cast';
import { addEntity } from '../room/entities';
import { session } from './fixture';
import { State } from '../states';
import { EntityFlag, EntityType, Stance } from '../flags';

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
  s.state = State.CastMain;
  beginCast(s, State.CastMain, rip);
  s.lastCast = 'rip';
  return fixture;
}

describe('the fight spell (0x47c280)', () => {
  it('counts a cast of the spell being cast', () => {
    const { s } = fighting();
    castLine(s, 'You cast soul rip on the giant rat!');
    expect(s.castsMain).toBe(1);
  });

  it('counts an attempt that fizzles', () => {
    const { s } = fighting();
    castLine(s, 'You attempt to cast soul rip, but fail.');
    expect(s.castsMain).toBe(1);
  });

  it('does not count another spell', () => {
    const { s } = fighting();
    castLine(s, 'You cast minor healing on Skinny!');
    expect(s.castsMain).toBe(0);
  });

  it('spends the mode when the spell has no effect, and marks the monster immune', () => {
    const { s, out } = fighting();
    const rat = addEntity(s);
    rat.name = 'giant rat';
    rat.type = EntityType.Monster;
    rat.kind = Stance.Enemy;
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
    expect(s.castsMain).toBe(9999);
    expect(rat.flags & EntityFlag.ImmuneMainCast).toBe(0x1000);
    expect(s.monsterMarks).toEqual([{ name: 'giant rat', flags: 0, spells: ['rip'] }]);
    expect(out.shown).toContain('[giant rat now immune to soul rip]');
    expect(s.inCombat).toBe(0);
  });

  /*
   * Skinny (2026-10-21): `lite` had no effect on the black rosebush, and the
   * main spell changed to `dfur` kept it immune. The mark is the spell's.
   */
  it('marks the spell, so another main spell is not immune', () => {
    const { s } = fighting();
    const rat = addEntity(s);
    rat.name = 'giant rat';
    rat.type = EntityType.Monster;
    rat.kind = Stance.Enemy;
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
    s.Combat_AttackSpl = 'mihe';
    refreshImmunities(s);
    expect(rat.flags & EntityFlag.ImmuneMainCast).toBe(0);
    // The second spell is now the one it is immune to.
    s.Combat_AttackSpl2 = 'rip';
    refreshImmunities(s);
    expect(rat.flags & EntityFlag.ImmuneAuxCast).toBe(EntityFlag.ImmuneAuxCast);
  });

  it('leaves the heal state settled when a heal is cast', () => {
    const { s } = fighting();
    s.state = State.Casting;
    s.castMode = 0;
    castLine(s, 'You cast minor healing on Skinny!');
    expect(s.state).toBe(0);
  });
});
