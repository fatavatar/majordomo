import { describe, expect, it } from 'vitest';

import { combatEventLine } from '../combat/events';
import { addEntity } from '../room/entities';
import { session } from './fixture';

/* `0x427120`, read 2026-10-12. */

function fightingRat() {
  const fixture = session();
  const { s } = fixture;
  s.inGame = 1;
  s.online = 1;
  s.inCombat = 1;
  s.state = 0x11;
  s.Combat_AttackCmd = 'attack';
  const rat = addEntity(s);
  rat.name = 'giant rat';
  rat.type = 2;
  rat.kind = 4;
  s.target = 'giant rat';
  return fixture;
}

describe('a kill (0x427120)', () => {
  it('takes the monster out of the room, adds the experience and ends the fight', () => {
    const { s } = fightingRat();
    s.exp = 100;
    expect(combatEventLine(s, 'You gain 42 experience.')).toBe(1);
    expect(s.room).toHaveLength(0);
    expect(s.exp).toBe(142);
    expect(s.inCombat).toBe(0);
    expect(s.state).toBe(0);
  });
});

describe('an attack the server would not take', () => {
  it('drops the fight when the attack is echoed back as speech', () => {
    const { s } = fightingRat();
    expect(combatEventLine(s, 'You say "attack giant rat"')).toBe(1);
    expect(s.inCombat).toBe(0);
    expect(s.target).toBe('');
    expect(s.f_e290).toBe(1);
  });
});

describe('death', () => {
  it('ends the party and the path', () => {
    const { s } = fightingRat();
    s.partySize = 3;
    s.f_e184 = 1;
    combatEventLine(s, 'You have been killed!');
    expect(s.partySize).toBe(0);
    expect(s.f_e184).toBe(0);
  });
});
