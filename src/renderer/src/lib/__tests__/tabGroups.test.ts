import { describe, expect, it } from 'vitest';

import {
  groupOf,
  parseGroups,
  railOrder,
  shownGroups,
  withAdded,
  withRemoved,
  type TabGroup
} from '../tabGroups';

/* Tab groups (2026-11-09): characters added to the view on screen, a row each. */
describe('tab groups', () => {
  let made = 0;
  const newId = (): string => `g${++made}`;

  it('makes a group of the character on screen and the one added', () => {
    expect(withAdded([], 'fatty', 'skinny', () => 'g1')).toEqual([
      { id: 'g1', members: ['fatty', 'skinny'] }
    ]);
    // Adding the one on screen to itself is nothing.
    expect(withAdded([], 'fatty', 'fatty', newId)).toEqual([]);
  });

  it('adds to the group on screen, taking the character out of its own', () => {
    const groups: TabGroup[] = [
      { id: 'a', members: ['fatty', 'skinny'] },
      { id: 'b', members: ['archer', 'bowel'] }
    ];
    // Archer leaves Bowel alone, which undoes that group.
    expect(withAdded(groups, 'skinny', 'archer', newId)).toEqual([
      { id: 'a', members: ['fatty', 'skinny', 'archer'] }
    ]);
  });

  it('undoes a group left with one member', () => {
    const groups: TabGroup[] = [{ id: 'a', members: ['fatty', 'skinny', 'archer'] }];
    expect(withRemoved(groups, 'archer')).toEqual([{ id: 'a', members: ['fatty', 'skinny'] }]);
    expect(withRemoved(withRemoved(groups, 'archer'), 'fatty')).toEqual([]);
    expect(groupOf(groups, 'skinny')?.id).toBe('a');
    expect(groupOf(groups, 'bowel')).toBeNull();
  });

  it('shows a group while two of it are loaded, in the rail order, its tabs together', () => {
    const groups: TabGroup[] = [{ id: 'a', members: ['fatty', 'skinny', 'gone'] }];
    const shown = shownGroups(groups, ['skinny', 'archer', 'fatty']);
    expect(shown).toEqual([['skinny', 'fatty']]);
    expect(shownGroups(groups, ['archer', 'fatty'])).toEqual([]);
    const tab = (id: string) => ({ id });
    expect(
      railOrder([tab('skinny'), tab('archer'), tab('fatty'), tab('bowel')], shown).map(
        (entry) => entry.id
      )
    ).toEqual(['skinny', 'fatty', 'archer', 'bowel']);
  });

  // The value is on the player's own disk and an older build may have written it.
  it('reads back only whole groups, a character in one at most', () => {
    expect(
      parseGroups(
        JSON.stringify([
          { id: 'a', members: ['fatty', 'skinny', 3] },
          { id: 'b', members: ['skinny', 'archer', 'bowel'] },
          { id: 'c', members: ['archer'] },
          { members: ['x', 'y'] },
          'junk'
        ])
      )
    ).toEqual([
      { id: 'a', members: ['fatty', 'skinny'] },
      { id: 'b', members: ['archer', 'bowel'] }
    ]);
    expect(parseGroups('{}')).toEqual([]);
  });
});
