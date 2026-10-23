import { describe, expect, it } from 'vitest';

import {
  asMonsterRule,
  asMonsterRules,
  mergeMonsterRules,
  withRealmMonsters,
  type MonsterRule
} from '../monsterRules';

describe('reading a row', () => {
  it('keeps what it knows and drops the rest of the field, not the row', () => {
    expect(
      asMonsterRule({
        mob: 'The Giant Rat',
        relationship: 'nemesis',
        priority: 'high',
        notHostile: true,
        attack: { spell: ' mmis ', max: 2 },
        preAttack: 'dspl'
      })
    ).toEqual({
      mob: 'giant rat',
      priority: 'high',
      notHostile: true,
      attack: { spell: 'mmis', max: 2 },
      preAttack: { spell: 'dspl', max: 0 }
    });
  });

  it('drops a row with no monster, and a second row for the same one', () => {
    expect(asMonsterRules([{ relationship: 'friend' }, { mob: 'rat' }, { mob: 'Rat' }])).toEqual([
      { mob: 'rat' }
    ]);
  });
});

/*
 * The shaman's case (2026-09-23): the realm marks a monster Flee, a
 * character names only a spell for it, and both hold.
 */
describe('laying a character over its realm', () => {
  const realm: MonsterRule[] = [
    { mob: 'gigantic black ooze', relationship: 'escape', priority: 'high' },
    { mob: 'shopkeeper', relationship: 'friend' }
  ];

  it('changes only what the narrower row states', () => {
    const merged = mergeMonsterRules(realm, [
      { mob: 'gigantic black ooze', attack: { spell: 'mmis', max: 0 } }
    ]);
    expect(merged).toContainEqual({
      mob: 'gigantic black ooze',
      relationship: 'escape',
      priority: 'high',
      attack: { spell: 'mmis', max: 0 }
    });
    expect(merged).toContainEqual({ mob: 'shopkeeper', relationship: 'friend' });
  });

  it('merges into the combat settings, and leaves them alone with no realm table', () => {
    const combat = { monsters: [{ mob: 'rat', relationship: 'friend' as const }] };
    expect(withRealmMonsters(combat, [])).toBe(combat);
    expect(withRealmMonsters(combat, realm).monsters).toHaveLength(3);
  });
});
