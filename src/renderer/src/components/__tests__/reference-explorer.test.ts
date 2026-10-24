import { describe, expect, it } from 'vitest';

import { explorerPlace, followFor, sharedRows } from '../ReferenceExplorer';
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
  places: null,
  rows: null
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

  it("asks for a monster's row: the one settled, else the one picked, else the first", () => {
    expect(explorerPlace(mob({ ids: [12] }))).toEqual({ kind: 'monsters', n: 12 });
    const settled = mob({ ids: [12, 40], row: { id: 40 } } as Partial<WorldMob>);
    expect(explorerPlace(settled)).toEqual({ kind: 'monsters', n: 40 });
    expect(sharedRows(settled)).toBeNull();
    // Ctrl+K asks by name alone (2026-10-24): seven rows are a giant rat.
    const shared = mob({ ids: [12, 40, 41] });
    expect(explorerPlace(shared)).toEqual({ kind: 'monsters', n: 12 });
    expect(explorerPlace(shared, 41)).toEqual({ kind: 'monsters', n: 41 });
    expect(sharedRows(shared)).toEqual([12, 40, 41]);
  });
});

/* A reference clicked in MME's detail on a card (2026-10-24). */
describe("where a reference in MMUD Explorer's detail leads from a card", () => {
  const anchor = {} as HTMLElement;
  const calls = () => {
    const went: string[] = [];
    const follow = followFor(
      {
        explore: (kind, n) => went.push(`explore ${kind} ${n}`),
        openRoom: (room) => went.push(`room ${room}`)
      },
      (name) => went.push(`name ${name}`)
    );
    return { went, follow: follow! };
  };

  it("opens a room's panel, with the way there on it", () => {
    const { went, follow } = calls();
    follow({ tab: 'rooms', n: '1/355' }, 'Helfgrim', anchor);
    expect(went).toEqual(['room 1/355']);
  });

  it('opens the slide-out on a name, and the Explorer on a shop', () => {
    const { went, follow } = calls();
    follow({ tab: 'monsters', n: 747 }, 'massive white dragon', anchor);
    follow({ tab: 'shops', n: 12 }, "Helfgrim's Blades", anchor);
    expect(went).toEqual(['name massive white dragon', 'explore shops 12']);
  });

  it('leaves the references as text where nothing can be opened', () => {
    expect(followFor({ explore: null, openRoom: null }, null)).toBeUndefined();
  });
});
