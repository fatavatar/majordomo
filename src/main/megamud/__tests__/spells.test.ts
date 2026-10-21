import { describe, expect, it } from 'vitest';
import { beginCast } from '../combat/casts';
import { hitLine } from '../combat/hits';
import { messagesFrom, type SpellRec } from '../data';
import { messageLine } from '../messages/messages';
import { findSpell } from '../spells/lookup';
import { spellbookLine } from '../spells/spellbook';
import { session } from './fixture';
import { State } from '../states';
import { SpellFlag } from '../flags';

/*
 * mudrev's `intr` is divine intervention and demonic intervention, and
 * Skinny, who casts the demonic, was taken for the divine (2026-10-21): its
 * messages never seen, and the divine's lasting bit holding it to the round
 * timer, so `lite` went out after every heal.
 */
function spell(id: number, short: string, name: string, flags = 0x84): SpellRec {
  return { layer: 0, id, short, name, item: '', flags, magic: 0, level: 0, cost: 60 };
}

describe('the spell a short word names', () => {
  it('is the one the spellbook lists, where several share the word', () => {
    const divine = spell(1479, 'intr', 'divine intervention');
    const demonic = spell(1481, 'intr', 'demonic intervention');
    const { s } = session({ spells: [divine, demonic] });
    expect(findSpell(s, 'intr')).toBe(divine);
    s.spellbookNames = new Set(['demonic intervention']);
    expect(findSpell(s, 'intr')).toBe(demonic);
  });

  it('is marked known by the spellbook row’s own name', () => {
    const divine = spell(1479, 'intr', 'divine intervention');
    const demonic = spell(1481, 'intr', 'demonic intervention');
    const { s } = session({ spells: [divine, demonic] });
    s.inGame = 1;
    spellbookLine(s, 'Level Mana Short Spell Name');
    spellbookLine(s, ' 67   60   intr  demonic intervention          ');
    expect(demonic.flags & SpellFlag.Known).toBe(SpellFlag.Known);
    expect(divine.flags & SpellFlag.Known).toBe(0);
    expect(findSpell(s, 'intr')).toBe(demonic);
  });
});

/*
 * mudrev's lucifer's touch drains with deathtouch's line, which the realm's
 * table files under deathtouch alone, and every one of Skinny's `ltch` read
 * as somebody's deathtouch until the spell was given up for the fight
 * (2026-10-21, the Demon Trolloc).
 */
describe('a damage line another spell’s row carries', () => {
  const DRAIN = 'Dark energy drains Demon Trolloc of life for 169 damage!';
  const TABLE = ['deathtouch:0000:0:', 'Dark energy drains {target} of life for {dmg} damage!', ''];

  function casting(table: string[], book: string[]) {
    const touch = spell(1439, 'ltch', "lucifer's touch");
    const fixture = session({
      spells: [spell(58, 'dtch', 'deathtouch'), touch],
      messages: messagesFrom(table.join('\n'))
    });
    const { s } = fixture;
    s.inGame = 1;
    s.online = 1;
    s.inCombat = 1;
    s.spellbookNames = new Set(book);
    s.Combat_AttackSpl = 'ltch';
    s.state = State.CastMain;
    beginCast(s, State.CastMain, touch);
    s.line = { text: DRAIN, attr: DRAIN.split('').map(() => 9) };
    messageLine(s, DRAIN, 0);
    return { ...fixture, landed: hitLine(s, DRAIN) };
  }

  it('is the cast spell landing where the row’s spell is not this character’s', () => {
    const { s, landed } = casting(TABLE, ["lucifer's touch"]);
    expect(landed).toBe(1);
    expect(s.castMessageSeen).toBe(1);
    expect(s.roundDamage).toBe(169);
  });

  it('is not, where the character knows the row’s spell', () => {
    const { s } = casting(TABLE, ["lucifer's touch", 'deathtouch']);
    expect(s.castMessageSeen).toBe(0);
  });

  it('is not, where the cast spell has a line of its own', () => {
    const own = [
      ...TABLE,
      "lucifer's touch:0000:0:",
      'Hellish energy sears {target} for {dmg} damage!',
      ''
    ];
    const { s } = casting(own, ["lucifer's touch"]);
    expect(s.castMessageSeen).toBe(0);
  });
});
