import { describe, expect, it } from 'vitest';

import type { SpellRec } from '../data';
import { attackCommand, pendingPump, queueCommand } from '../script/send';
import { newEntity } from '../Session';
import { session } from './fixture';

/* `0x48b370`, `0x48bce0`, `0x48ad60`, read 2026-10-14. */

function spell(short: string, name: string, flags: number, cost = 5): SpellRec {
  return { layer: 0, id: 1, short, name, item: '', flags, magic: 0, level: 0, cost };
}

function inGame(spells: SpellRec[] = []) {
  const fixture = session({ spells });
  const { s } = fixture;
  s.inGame = 1;
  s.online = 1;
  s.mana = 100;
  s.hp = 100;
  s.now = fixture.clock.now;
  s.room = [Object.assign(newEntity(), { type: 2, count: 1, name: 'orc' })];
  return fixture;
}

describe('message spell processing (0x48b370)', () => {
  // Once a part is cast, the parts after it go in the same pass.
  it('casts a message’s spell through the round timer, and sends the rest as it is', () => {
    const { s, out } = inGame([spell('pghe', 'pagan healing', 0x10)]);
    queueCommand(s, 'pghe\rsay healed\r', 1, 0, 1);
    expect(pendingPump(s)).toBe(1);
    expect(out.sent).toEqual(['pghe\r', 'say healed\r']);
    expect(s.pending).toEqual([]);
  });

  it('drops one whose target is not here', () => {
    const { s, out } = inGame([spell('mmis', 'magic missile', 0x40)]);
    queueCommand(s, 'mmis goblin\r', 1, 0, 1);
    expect(pendingPump(s)).toBe(1);
    expect(out.sent).toEqual([]);
    expect(out.shown).toContain('[mmis: goblin not found]');
    expect(s.pending).toEqual([]);
  });

  it('holds one too soon in its round, and sends it as it is after five seconds', () => {
    const { s, out, clock } = inGame([spell('mmis', 'magic missile', 0x40)]);
    s.mana = 1;
    queueCommand(s, 'mmis orc\r', 1, 0, 1);
    expect(pendingPump(s)).toBe(0);
    expect(out.sent).toEqual([]);
    expect(s.waitingSpell).toBe('mmis');
    expect(s.pending).toHaveLength(1);
    clock.now += 6;
    s.now = clock.now;
    expect(pendingPump(s)).toBe(1);
    expect(out.sent).toEqual(['mmis orc\r']);
  });

  it('leaves a command nobody checked to the pump', () => {
    const { s, out } = inGame([spell('pghe', 'pagan healing', 0x10)]);
    queueCommand(s, 'pghe\r', 1, 0, 0);
    expect(pendingPump(s)).toBe(1);
    expect(out.sent).toEqual(['pghe\r']);
  });
});

describe('an attack sent from the list (0x48bce0)', () => {
  it('starts a fight on what is here', () => {
    const { s } = inGame();
    expect(attackCommand(s, 'att orc\r')).toBe(1);
    expect([s.state, s.target]).toEqual([0x11, 'orc']);
  });

  it('is not a bash at a door, nor a word that only begins like one', () => {
    const { s } = inGame();
    expect(attackCommand(s, 'bash n\r')).toBe(0);
    expect(attackCommand(s, 'ki orc\r')).toBe(0);
    expect(attackCommand(s, 'say orc\r')).toBe(0);
  });
});
