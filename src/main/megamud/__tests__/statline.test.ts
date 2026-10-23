import { describe, expect, it } from 'vitest';

import { combatEngaged } from '../combat/engaged';
import { messagesFrom } from '../data';
import { newTerminal, parseData } from '../input/ParseData';
import { statusLine } from '../input/statline';
import { send } from '../script/send';
import { setState } from '../script/state';
import type { LineBuf } from '../Session';
import { session } from './fixture';
import { State } from '../states';
import { LineFlag } from '../flags';

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
    expect(s.lineFlags & LineFlag.Prompted).toBe(1);
  });

  it('holds the scheduler while lines are still awaited', () => {
    const { s } = inGame();
    s.waitLines = 2;
    statusLine(s, line('[HP=57/MA=10]:'), 0);
    expect(s.lineFlags & LineFlag.Prompted).toBe(0);
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
    s.state = State.PendingCmd;
    combatEngaged(s, '*Combat Engaged*');
    expect(s.state).toBe(0x11);
    expect(s.engagedMode).toBe(0x11);
  });

  it('ignores other lines', () => {
    const { s } = inGame();
    expect(combatEngaged(s, 'You are in combat.')).toBe(0);
  });

  /*
   * MudRev draws each line over its prompt (`ESC[79D ESC[K`), so the prompt
   * and the line arrive as one; Skinny's spell attack was sent twenty times in
   * a second on 13 October 2026 when the engagement behind one went unseen.
   */
  it('reads a line that came behind its prompt', () => {
    const { s } = inGame();
    parseData(s, newTerminal(), '[HP=57/MA=6');
    parseData(s, newTerminal(), '0]:\x1b[79D\x1b[K*Combat Engaged*\r\n');
    expect(s.hp).toBe(57);
    expect(s.inCombat).toBe(1);
  });
});

describe('the activity state (0x4aa770)', () => {
  it('picks the attack back up when going idle in a fight', () => {
    const { s } = inGame();
    s.inCombat = 1;
    setState(s, State.Attacking);
    setState(s, State.Casting);
    s.stateBefore = State.Attacking;
    setState(s, State.Nothing);
    expect(s.state).toBe(0x11);
  });

  it('goes back to meditating when idle while still meditating below ManaFull%', () => {
    const { s } = inGame();
    s.meditating = 1;
    s.mana = 10;
    setState(s, State.Nothing);
    expect(s.state).toBe(5);
  });

  it('awaits the attacks and casts', () => {
    const { s } = inGame();
    setState(s, State.CastMain);
    expect(s.stateAwaited).toBe(0xd);
    setState(s, State.Getting);
    expect(s.stateAwaited).toBe(0xd);
  });
});

/*
 * Ours (2026-10-14): MegaMUD took any two lines after a command, or any prompt
 * in a fight, as its answer, so a room redraw on its way answered a heal
 * before the realm had read it: the double step, and the attack again and
 * again. Lines before a command's echo are not its answer.
 */
describe('a command answered only after its echo', () => {
  const ready = (s: { lineFlags: number }): boolean => (s.lineFlags & LineFlag.Prompted) !== 0;

  it('waits through a redraw that was on its way, and goes on after the echo', () => {
    const { s } = inGame();
    s.waitLines = 2;
    send(s, 'pghe\r');
    parseData(
      s,
      newTerminal(),
      'Dark Cavern\r\nAlso here: forgotten dragon slayer.\r\n[HP=57/MA=6]:'
    );
    expect(ready(s)).toBe(false);
    parseData(s, newTerminal(), 'pghe\r\nYou cast pagan healing on Skinny!\r\n[HP=80/MA=6]:');
    expect(ready(s)).toBe(true);
  });

  it('waits in a fight too, where any prompt answered', () => {
    const { s } = inGame();
    s.inCombat = 1;
    send(s, 'pghe\r');
    parseData(s, newTerminal(), '[HP=57/MA=6]:');
    expect(ready(s)).toBe(false);
    parseData(s, newTerminal(), '[HP=57/MA=6]:pghe\r\n[HP=80/MA=6]:');
    expect(ready(s)).toBe(true);
  });

  it('gives up on an echo that never comes', () => {
    const { s, clock } = inGame();
    s.waitLines = 2;
    send(s, 'pghe\r');
    clock.ms += 3001;
    parseData(s, newTerminal(), 'one\r\ntwo\r\n[HP=57/MA=6]:');
    expect(ready(s)).toBe(true);
  });
});

/* Fatty's log, 2026-10-16: prompts the realm bunched while resting, each with its rest mark. */
describe('stacked prompts with rest marks', () => {
  const SANDSTORM = [
    'sandstorm:0001:2:',
    'A sandstorm surrounds you!',
    'The sandstorm subsides, allowing your scathed flesh to heal.',
    ''
  ].join('\n');

  it('cuts every prompt, so the line behind them is read', () => {
    const { s } = session({ messages: messagesFrom(SANDSTORM) });
    s.inGame = 1;
    s.online = 1;
    const t = newTerminal();
    parseData(s, t, '[HP=1100/MA=180]:A sandstorm surrounds you!\r\n');
    expect(s.blind).toBe(1);
    parseData(
      s,
      t,
      '[HP=1467/MA=274]: (Resting) [HP=1461/MA=274]: (Resting) The sandstorm subsides, allowing your scathed flesh to heal.\r\n'
    );
    expect(s.blind).toBe(0);
    expect(s.hp).toBe(1461);
  });

  it('still reads the last rest mark as resting', () => {
    const { s } = session();
    s.inGame = 1;
    s.online = 1;
    parseData(s, newTerminal(), '[HP=10/MA=5]: (Resting) [HP=12/MA=5]: (Resting) ');
    expect(s.resting).toBe(1);
    expect(s.hp).toBe(12);
  });
});
