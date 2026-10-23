import { describe, expect, it } from 'vitest';

import { blowLine } from '../combat/blows';
import { hitLine } from '../combat/hits';
import type { MonsterRec } from '../data';
import { addEntity } from '../room/entities';
import { session } from './fixture';
import { State } from '../states';
import { EntityFlag, Stance, EntityType } from '../flags';

/* `0x428e60` and `0x429bb0`, read 2026-10-12. */

const RAT: MonsterRec = {
  layer: 0,
  name: 'giant rat',
  id: 1,
  flags: 0,
  relationship: Stance.Enemy,
  exp: 42,
  maxHp: 12,
  preSpell: '',
  attackSpell: '',
  preMax: 0,
  attackMax: 0
};

function withRat(colour: number, text: string) {
  const fixture = session({ monsters: [RAT] });
  const { s } = fixture;
  s.inGame = 1;
  s.online = 1;
  s.hp = 50;
  const rat = addEntity(s);
  rat.name = 'giant rat';
  rat.type = EntityType.Monster;
  rat.kind = Stance.Avoid;
  rat.mon = RAT;
  s.line = { text, attr: text.split('').map(() => colour) };
  return { ...fixture, rat };
}

describe('a blow taken (0x428e60)', () => {
  it('takes the damage off HP and marks the attacker hostile and attacking', () => {
    const line = 'The giant rat bites you for 5 damage!';
    const { s, rat } = withRat(9, line);
    expect(blowLine(s, line)).toBe(1);
    expect(s.hp).toBe(45);
    expect(rat.kind).toBe(4);
    expect(rat.flags & (EntityFlag.Kept | EntityFlag.Fought)).toBe(0x11);
  });

  it('ignores a line not drawn in a combat colour', () => {
    const line = 'The giant rat bites you for 5 damage!';
    const { s } = withRat(7, line);
    expect(blowLine(s, line)).toBe(0);
    expect(s.hp).toBe(50);
  });
});

describe('a hit landed (0x429bb0)', () => {
  it("counts the round's damage", () => {
    const line = 'You slash the giant rat for 12 damage!';
    const { s } = withRat(0xc, line);
    s.inCombat = 1;
    s.state = State.Attacking;
    expect(hitLine(s, line)).toBe(1);
    expect(s.roundDamage).toBe(12);
  });

  it('counts a miss as a blow', () => {
    const line = 'You swing at the giant rat!';
    const { s } = withRat(0xc, line);
    s.inCombat = 1;
    s.state = State.Attacking;
    expect(hitLine(s, line)).toBe(1);
  });
});
