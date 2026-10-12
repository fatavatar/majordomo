import { describe, expect, it } from 'vitest';

import { combatEngaged } from '../combat/engaged';
import { statusLine } from '../input/statline';
import { setState } from '../script/state';
import type { LineBuf } from '../Session';
import { session } from './fixture';

/* `0x47b070`, `0x428ab0` and `0x4aa770`, read 2026-10-12. */

function line(text: string): LineBuf {
  return { text, attr: text.split('').map(() => 7) };
}

function inGame() {
  const fixture = session();
  fixture.s.inGame = 1;
  fixture.s.online = 1;
  fixture.s.Player_MaxHP = 100;
  fixture.s.Player_MaxMana = 40;
  return fixture;
}

describe('the prompt (0x47b070)', () => {
  it('reads HP and mana, caps mana at its maximum, and takes the prompt off the line', () => {
    const { s } = inGame();
    const buf = line('[HP=57/MA=55]: You are hungry.');
    statusLine(s, buf, 1);
    expect(s.hp).toBe(57);
    expect(s.mana).toBe(40);
    expect(buf.text).toBe('You are hungry.');
    expect(buf.attr).toHaveLength('You are hungry.'.length);
  });

  it('reads kai as mana', () => {
    const { s } = inGame();
    statusLine(s, line('[HP=57/KAI=3]:'), 0);
    expect(s.mana).toBe(3);
  });

  it('lets the scheduler run when a bare prompt ends the chunk', () => {
    const { s } = inGame();
    expect(statusLine(s, line('[HP=57/MA=10]:'), 0)).toBe(1);
    expect(s.lineFlags & 1).toBe(1);
  });

  it('holds the scheduler while lines are still awaited', () => {
    const { s } = inGame();
    s.waitLines = 2;
    statusLine(s, line('[HP=57/MA=10]:'), 0);
    expect(s.lineFlags & 1).toBe(0);
  });

  it('counts a whole line off the lines awaited', () => {
    const { s } = inGame();
    s.waitLines = 2;
    statusLine(s, line('A goblin is here.'), 1);
    expect(s.waitLines).toBe(1);
  });

  it('takes (Resting) as resting and (Meditating) as meditating', () => {
    const { s } = inGame();
    statusLine(s, line('[HP=57/MA=10]: (Resting) '), 0);
    expect(s.state).toBe(3);
    statusLine(s, line('[HP=57/MA=10]: (Meditating) '), 0);
    expect(s.state).toBe(5);
    expect(s.meditating).toBe(1);
  });

  it('stops resting when a prompt comes without the mark', () => {
    const { s } = inGame();
    statusLine(s, line('[HP=57/MA=10]: (Resting) '), 0);
    statusLine(s, line('[HP=58/MA=10]:'), 0);
    expect(s.state).toBe(0);
  });
});

describe('combat frames (0x428ab0)', () => {
  it('engages and disengages', () => {
    const { s } = inGame();
    expect(combatEngaged(s, '*Combat Engaged*')).toBe(1);
    expect(s.inCombat).toBe(1);
    expect(combatEngaged(s, '*Combat Off*')).toBe(1);
    expect(s.inCombat).toBe(0);
    expect(s.state).toBe(0);
  });

  it('turns a pending attack command into the attacking state', () => {
    const { s } = inGame();
    s.state = 0x2d;
    combatEngaged(s, '*Combat Engaged*');
    expect(s.state).toBe(0x11);
    expect(s.engagedMode).toBe(0x11);
  });

  it('ignores other lines', () => {
    const { s } = inGame();
    expect(combatEngaged(s, 'You are in combat.')).toBe(0);
  });
});

describe('the activity state (0x4aa770)', () => {
  it('picks the attack back up when going idle in a fight', () => {
    const { s } = inGame();
    s.inCombat = 1;
    setState(s, 0x11);
    setState(s, 0x15);
    s.stateBefore = 0x11;
    setState(s, 0);
    expect(s.state).toBe(0x11);
  });

  it('goes back to meditating when idle while still meditating below ManaFull%', () => {
    const { s } = inGame();
    s.meditating = 1;
    s.mana = 10;
    setState(s, 0);
    expect(s.state).toBe(5);
  });

  it('awaits the attacks and casts', () => {
    const { s } = inGame();
    setState(s, 0xd);
    expect(s.stateAwaited).toBe(0xd);
    setState(s, 0x1c);
    expect(s.stateAwaited).toBe(0xd);
  });
});
