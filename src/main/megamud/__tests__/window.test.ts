import { describe, expect, it } from 'vitest';

import { hitLine } from '../combat/hits';
import { combatRoundEnd } from '../combat/rounds';
import type { ItemRec } from '../data';
import { depositAll } from '../items/all';
import { carryLess, carryMore } from '../items/inventory';
import { addEntity } from '../room/entities';
import { session } from './fixture';
import { State } from '../states';
import { EntityType, ItemFlag, Stance } from '../flags';

/*
 * What MegaMUD's statistics window counts (`0x4a8a10`), read 2026-10-19:
 * the rungs (`0x426ef0`, `0x426f70`), the round (`0x425c40`), and the items
 * and copper (`0x4532d0`, `0x453900`, `0x4bc190`).
 */

function fighting(text: string) {
  const fixture = session();
  const { s } = fixture;
  s.inGame = 1;
  s.online = 1;
  s.inCombat = 1;
  const rat = addEntity(s);
  rat.name = 'giant rat';
  rat.type = EntityType.Monster;
  rat.kind = Stance.Enemy;
  s.line = { text, attr: text.split('').map(() => 0xc) };
  return fixture;
}

function item(name: string, flags = 0): ItemRec {
  return {
    id: 1,
    layer: 0,
    name,
    shop: '',
    ifNeeded: '',
    flags,
    type: 0,
    location: 0,
    min: 0,
    max: 0,
    weight: 1,
    price: 0
  };
}

describe("the statistics window's counts", () => {
  it('counts a pre-attack landing as its rung, named by its command', () => {
    const line = 'You cast stun on the giant rat for 9 damage!';
    const { s, out } = fighting(line);
    s.Combat_PreAttack = 'stun';
    s.state = State.CastPre;
    s.castMode = State.CastPre;
    expect(hitLine(s, line)).toBe(1);
    expect(out.counted).toContainEqual({ kind: 'blow', mode: 'pre', damage: 9, command: 'stun' });
    expect(out.counted).toContainEqual({ kind: 'cast', mode: 'pre', took: true, command: 'stun' });
  });

  it('counts no rung for a swing', () => {
    const line = 'You slash the giant rat for 12 damage!';
    const { s, out } = fighting(line);
    s.state = State.Attacking;
    expect(hitLine(s, line)).toBe(1);
    expect(out.counted).toEqual([]);
  });

  it("counts a round's damage at its end", () => {
    const { s, out } = session();
    s.probablyRoundFought = 1;
    s.roundBlowSeen = 1;
    s.probablyRoundCounted = 1;
    s.roundDamage = 31;
    combatRoundEnd(s);
    expect(out.counted).toEqual([{ kind: 'round', damage: 31 }]);
  });

  it('counts items collected, sold and stashed, and coins stashed', () => {
    const { s, out } = session({
      items: [item('dagger'), item('gold crowns', ItemFlag.Coin)]
    });
    carryMore(s, 'dagger', 2);
    carryMore(s, 'gold crowns', 5);
    carryLess(s, 'dagger', 1, State.Selling);
    carryLess(s, 'dagger', 1, State.Stashing);
    carryLess(s, 'gold crowns', 3, State.Stashing);
    carryLess(s, 'gold crowns', 1, State.Dropping);
    expect(out.counted).toEqual([
      { kind: 'items', how: 'collected', count: 2 },
      { kind: 'items', how: 'sold', count: 1 },
      { kind: 'items', how: 'stashed', count: 1 },
      { kind: 'copper', how: 'stashed', copper: 300 }
    ]);
  });

  it('counts the copper deposited', () => {
    const { s, out } = session();
    s.wealth = 5000;
    s.Cash_MinWealth = 1000;
    depositAll(s);
    expect(out.counted).toEqual([{ kind: 'copper', how: 'deposited', copper: 4000 }]);
  });
});
