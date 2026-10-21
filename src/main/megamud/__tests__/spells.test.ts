import { describe, expect, it } from 'vitest';
import type { SpellRec } from '../data';
import { findSpell } from '../spells/lookup';
import { spellbookLine } from '../spells/spellbook';
import { session } from './fixture';
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
