import { describe, expect, it } from 'vitest';

import { beginCast } from '../combat/casts';
import { messagesFrom, type SpellRec } from '../data';
import { messageLine, templateMatch } from '../messages/messages';
import { session } from './fixture';

/* `0x46a920`, `0x467ec0`, `0x46bb70` and `0x467b60`, read 2026-10-12. */

const TABLE = [
  'poison:0004:0:',
  'You have been poisoned!',
  'You feel better.',
  'soul rip:0000:0:',
  '{source} rips at the soul of {target}!',
  '',
  'refresh:0000:1:',
  'A cloud of smoke appears',
  ''
].join('\n');

describe('reading Messages.md (0x467b60)', () => {
  it('reads three lines a row: name, effects in hex, number, action; start; end', () => {
    const rows = messagesFrom(TABLE);
    expect(rows.map((r) => r.name)).toEqual(['poison', 'soul rip', 'refresh']);
    expect(rows[0]!.effects).toBe(4);
    expect(rows[1]!.flags & 4).toBe(4);
    expect(rows[2]!.number).toBe(1);
  });
});

describe('a template (0x467ec0)', () => {
  it('captures the fields between its literal text', () => {
    const { s } = session();
    expect(
      templateMatch(
        s,
        '{source} rips at the soul of {target}!',
        'You rips at the soul of the giant rat!'
      )
    ).toBe(1);
    expect(s.msgSource).toBe('You');
    expect(s.msgTarget).toBe('the giant rat');
  });

  it('finds its leading text anywhere in the line', () => {
    const { s } = session();
    expect(templateMatch(s, 'hits {target} for {dmg}!', 'The orc hits Skinny for 12!')).toBe(1);
    expect(s.msgDamage).toBe(12);
  });

  it('fails when the literal text does not follow', () => {
    const { s } = session();
    expect(templateMatch(s, '{source} rips at {target}!', 'Nothing here.')).toBe(0);
  });
});

describe('running the rows (0x46a920)', () => {
  it('sets a condition on its start and clears it on its end', () => {
    const { s } = session({ messages: messagesFrom(TABLE) });
    expect(messageLine(s, 'You have been poisoned!', 0)).toBe(1);
    expect(s.poisoned).toBe(1);
    messageLine(s, 'You feel better.', 0);
    expect(s.poisoned).toBe(0);
  });

  it('asks for the room again on a row numbered 1', () => {
    const { s } = session({ messages: messagesFrom(TABLE) });
    s.f_e290 = 0;
    messageLine(s, 'A cloud of smoke appears', 0);
    expect(s.f_e290).toBe(1);
  });

  it("counts a cast of the fight's spell by the spell's own message", () => {
    const rip: SpellRec = {
      layer: 0,
      id: 1,
      short: 'rip',
      name: 'soul rip',
      item: '',
      flags: 0,
      magic: 0,
      level: 0,
      cost: 5
    };
    const { s } = session({ messages: messagesFrom(TABLE), spells: [rip] });
    s.inGame = 1;
    s.online = 1;
    s.state = 0xd;
    beginCast(s, 0xd, rip);
    messageLine(s, 'You rips at the soul of the giant rat!', 0);
    expect(s.f_a3f4).toBe(1);
  });
});
