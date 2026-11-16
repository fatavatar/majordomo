import { describe, expect, it } from 'vitest';

import { beginCast } from '../combat/casts';
import { messagesFrom, type SpellRec } from '../data';
import { messageRec } from '../fromWorld';
import { messageLine, templateMatch } from '../messages/messages';
import { blankTrigger, type MessageTrigger } from '../../../shared/messageTriggers';
import { session } from './fixture';
import { State } from '../states';
import { MessageFlag } from '../flags';

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
    expect(rows[1]!.flags & MessageFlag.StartHasFields).toBe(4);
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
    s.lookDue = 0;
    messageLine(s, 'A cloud of smoke appears', 0);
    expect(s.lookDue).toBe(1);
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
    s.state = State.CastMain;
    beginCast(s, State.CastMain, rip);
    messageLine(s, 'You rips at the soul of the giant rat!', 0);
    expect(s.castsMain).toBe(1);
  });
});

/* "Find in conversations" is 0x100 (0x468730), read as 0x800 until 2026-10-15. */
describe('a row found in conversations', () => {
  it('answers a telepath before the talk handler takes it, with the sender’s name', () => {
    const { s } = session();
    s.inGame = 1;
    s.data.messages = [
      messageRec({
        ...blankTrigger(),
        name: 'heal on ask',
        match: '{source} telepaths: @heal',
        response: 'mend {source}',
        conversations: true
      })
    ];
    expect(messageLine(s, 'Fatty telepaths: @heal', 1)).toBe(1);
    expect(s.pending.map((p) => p.text)).toEqual(['mend Fatty\r']);
  });
});

/*
 * Ours (2026-11-12): one line two realm spells print, which mean different
 * things. The Quest Knights' ethereal chains (#1620) holds; the monsters'
 * other one (#309) also stops a fight. Bowel stood through every Quest
 * Knight's chaining without a swing.
 */
describe('a row two spells print (landedEffects)', () => {
  const chains = (): MessageTrigger => ({
    ...blankTrigger(),
    name: 'ethereal chains',
    match: 'You are restrained by silvery manacles!',
    endsWith: 'The silvery manacles restraining you shimmer and fade.',
    effects: ['held'],
    spells: [
      { spell: 309, effects: ['held', 'no-attack'] },
      { spell: 1620, effects: ['held'] }
    ]
  });
  const chained = (landable?: (spells: readonly number[]) => number[], trigger = chains()) => {
    const { s } = session({ messages: [messageRec(trigger)] });
    if (landable) Object.assign(s.host, { landable });
    messageLine(s, 'You are restrained by silvery manacles!', 0);
    return s;
  };

  it('means what the spell cast here means', () => {
    const s = chained(() => [1620]);
    expect([s.held, s.attackPrevented]).toEqual([1, 0]);
  });

  it('means the other where that is the one cast here, and ends what it set', () => {
    const s = chained(() => [309]);
    expect([s.held, s.attackPrevented]).toEqual([1, 1]);
    messageLine(s, 'The silvery manacles restraining you shimmer and fade.', 0);
    expect([s.held, s.attackPrevented]).toEqual([0, 0]);
  });

  it('means what the row states where the room cannot say', () => {
    expect(chained(() => [309, 1620]).attackPrevented).toBe(0);
    expect(chained().attackPrevented).toBe(0);
  });

  it('keeps the effects the player gave the row', () => {
    const s = chained(() => [309], { ...chains(), effects: ['blind'] });
    expect([s.blind, s.held, s.attackPrevented]).toEqual([1, 0, 0]);
  });
});
