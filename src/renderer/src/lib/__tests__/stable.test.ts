import { describe, expect, it } from 'vitest';

import { stableBlocks } from '../stable';
import type { PartyRoster } from '@shared/partyRoster';

const roster = (over: Partial<PartyRoster>): PartyRoster => ({
  id: 'r1',
  realm: 'Skinny Inc',
  leader: null,
  members: [],
  regroup: true,
  forgotten: [],
  places: [],
  ...over
});

const names: Record<string, string> = { a: 'Archer', b: 'Bowel', s: 'Skinny', f: 'Fatty' };
const nameOf = (id: string): string | null => names[id] ?? null;
const row = (id: string, server = 'Skinny Inc') => ({ id, server });

/* The Stable's rows grouped (2026-10-31): Bowel's party of two, and two characters alone. */
describe('stableBlocks', () => {
  const party = roster({
    leader: 'Bowel',
    members: [
      { name: 'Archer', rank: null },
      { name: 'Bowel', rank: null }
    ]
  });

  it('puts a party together, its leader first, where its first member is', () => {
    expect(stableBlocks([row('s'), row('a'), row('f'), row('b')], nameOf, [party])).toEqual([
      { kind: 'solo', id: 's' },
      { kind: 'party', roster: party, ids: ['b', 'a'] },
      { kind: 'solo', id: 'f' }
    ]);
  });

  it('leaves a party with one member in the realm, or on another realm, a row of its own', () => {
    expect(stableBlocks([row('a'), row('s')], nameOf, [party])).toEqual([
      { kind: 'solo', id: 'a' },
      { kind: 'solo', id: 's' }
    ]);
    expect(stableBlocks([row('a'), row('b', 'Elsewhere')], nameOf, [party])).toEqual([
      { kind: 'solo', id: 'a' },
      { kind: 'solo', id: 'b' }
    ]);
  });

  it('orders the rest by the roster where no leader is named', () => {
    const led = roster({ members: party.members });
    expect(stableBlocks([row('b'), row('a')], nameOf, [led])).toEqual([
      { kind: 'party', roster: led, ids: ['a', 'b'] }
    ]);
  });
});
