import { describe, expect, it } from 'vitest';

import { formedParty, type PartyRoster } from '../partyRoster';

/* A party formed in the realm keeps a roster without being asked (2026-10-31). */
describe('formedParty', () => {
  const realm = 'Skinny Inc';
  const member = (name: string, invited = false) => ({ name, rank: null, invited });
  const archer = (members: ReturnType<typeof member>[], following: string | null = 'Bowel') => ({
    name: 'Archer',
    party: { following, members }
  });
  const newId = (): string => 'made';

  it('makes a roster from the listing, led by whoever is followed', () => {
    expect(formedParty([], realm, archer([member('Bowel'), member('Archer')]), newId)).toEqual({
      id: 'made',
      realm,
      leader: 'Bowel',
      members: [
        { name: 'Bowel', rank: null },
        { name: 'Archer', rank: null }
      ],
      regroup: true,
      forgotten: [],
      places: []
    });
  });

  it('makes none for a party of one, or one with only an invitation out', () => {
    expect(formedParty([], realm, archer([member('Archer')], null), newId)).toBeNull();
    expect(
      formedParty([], realm, archer([member('Archer'), member('Bowel', true)], null), newId)
    ).toBeNull();
  });

  const kept: PartyRoster = {
    id: 'r1',
    realm,
    leader: 'Bowel',
    members: [
      { name: 'Bowel', rank: null },
      { name: 'Archer', rank: null }
    ],
    regroup: true,
    forgotten: [],
    places: ['kha']
  };

  it('leaves a roster that already names everybody alone', () => {
    expect(
      formedParty([kept], realm, archer([member('Bowel'), member('Archer')]), newId)
    ).toBeNull();
  });

  it('grows the roster by whoever joined, keeping what it had', () => {
    const grown = formedParty(
      [kept],
      realm,
      archer([member('Bowel'), member('Archer'), member('Sneaky')]),
      newId
    );
    expect(grown).toEqual({
      ...kept,
      members: [...kept.members, { name: 'Sneaky', rank: null }]
    });
  });

  it('finds the roster through anybody in the party, and on its own realm only', () => {
    const bowels: PartyRoster = { ...kept, members: [{ name: 'Bowel', rank: null }] };
    expect(
      formedParty([bowels], realm, archer([member('Bowel'), member('Archer')]), newId)?.id
    ).toBe('r1');
    expect(
      formedParty(
        [{ ...kept, realm: 'Elsewhere' }],
        realm,
        archer([member('Bowel'), member('Archer')]),
        newId
      )?.id
    ).toBe('made');
  });
});
