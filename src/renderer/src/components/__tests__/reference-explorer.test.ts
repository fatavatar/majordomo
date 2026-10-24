import { describe, expect, it } from 'vitest';

import { explorerPlace } from '../ReferenceExplorer';
import type { ReferenceEntry } from '../ReferenceDetail';
import type { WorldItem, WorldMob } from '@shared/world';

const item = (over: Partial<WorldItem>): ReferenceEntry => ({
  kind: 'item',
  name: 'thing',
  item: { id: 64, name: 'thing', ...over } as WorldItem
});

const mob = (over: Partial<WorldMob>): ReferenceEntry => ({
  kind: 'mob',
  name: 'rat',
  mob: { name: 'rat', ...over } as WorldMob,
  learned: null,
  fights: null,
  verdict: null,
  places: null
});

/* Which of MMUD Explorer's lists a card's entry is asked of (2026-10-24). */
describe("a Reference entry's place in MMUD Explorer", () => {
  it('puts an item where mudtool does: a weapon, worn armour, and the rest on Sundry', () => {
    expect(explorerPlace(item({ kind: 'weapon' }))).toEqual({ kind: 'weapons', n: 64 });
    expect(explorerPlace(item({ kind: 'armour', slot: 'head' }))).toEqual({
      kind: 'armour',
      n: 64
    });
    expect(explorerPlace(item({ kind: 'armour' }))).toEqual({ kind: 'sundry', n: 64 });
    expect(explorerPlace(item({}))).toEqual({ kind: 'sundry', n: 64 });
  });

  it('asks for a monster only where one row answers for its name', () => {
    expect(explorerPlace(mob({ ids: [12] }))).toEqual({ kind: 'monsters', n: 12 });
    expect(explorerPlace(mob({ ids: [12, 40], row: { id: 40 } } as Partial<WorldMob>))).toEqual({
      kind: 'monsters',
      n: 40
    });
    expect(explorerPlace(mob({ ids: [12, 40] }))).toBeNull();
  });
});
