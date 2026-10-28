import { describe, expect, it } from 'vitest';

import { EMPTY_CHARACTER, type CharacterState, type PartyMember } from '@shared/character';
import type { PartyRoster } from '@shared/partyRoster';
import { boardRows, rosterFromListing, together, type OurMember } from '../partyBoard';

const member = (name: string, over: Partial<PartyMember> = {}): PartyMember => ({
  name,
  className: null,
  health: 0.5,
  mana: null,
  rank: 'front',
  activity: null,
  invited: false,
  vitals: null,
  ...over
});

function character(
  name: string,
  over: { party?: PartyMember[]; following?: string | null; room?: number; hp?: number } = {}
): CharacterState {
  return {
    ...EMPTY_CHARACTER,
    name,
    vitals: { ...EMPTY_CHARACTER.vitals, hp: over.hp ?? 90, hpMax: 100 },
    room: {
      ...EMPTY_CHARACTER.room,
      map: 1,
      number: over.room ?? 1,
      name: `Room ${over.room ?? 1}`
    },
    party: {
      ...EMPTY_CHARACTER.party,
      members: over.party ?? [],
      following: over.following ?? null
    }
  };
}

const ours = (c: CharacterState, inGame = true): OurMember => ({
  session: c.name!.toLowerCase(),
  character: c,
  inGame
});

const roster = (names: string[], over: Partial<PartyRoster> = {}): PartyRoster => ({
  id: 'p',
  realm: 'Skinny Inc',
  leader: names[0]!,
  members: names.map((name) => ({ name, rank: null })),
  regroup: true,
  forgotten: [],
  places: [],
  ...over
});

describe('the Party card’s rows', () => {
  it('reads a member of ours from their own tab, and somebody else from the leader’s listing', () => {
    const fatty = character('Fatty', {
      party: [member('Fatty'), member('Skinny', { health: 0.2 }), member('Zed', { health: 0.7 })]
    });
    const skinny = character('Skinny', { hp: 52, following: 'Fatty' });
    const rows = boardRows(roster(['Fatty', 'Skinny', 'Zed']), skinny, [ours(fatty), ours(skinny)]);
    expect(rows.map((r) => [r.name, r.status, r.health, r.ours])).toEqual([
      ['Fatty', 'in', 0.9, 'fatty'],
      ['Skinny', 'in', 0.52, 'skinny'],
      ['Zed', 'in', 0.7, null]
    ]);
    expect(rows[1]!.vitals).toEqual({ hp: 52, hpMax: 100, mana: null, manaMax: null });
  });

  it('says who has dropped out, who is offline, who is only invited and who asked to be forgotten', () => {
    const fatty = character('Fatty', {
      party: [member('Fatty'), member('Zed', { invited: true })]
    });
    const skinny = character('Skinny', { room: 7 });
    const healbot = character('healbot');
    const rows = boardRows(
      roster(['Fatty', 'Skinny', 'healbot', 'Zed', 'Bob'], { forgotten: ['Bob'] }),
      fatty,
      [ours(fatty), ours(skinny), ours(healbot, false)]
    );
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ['Fatty', 'in'],
      ['Skinny', 'out'],
      ['healbot', 'offline'],
      ['Zed', 'invited'],
      ['Bob', 'forgotten']
    ]);
    expect(rows[1]!.away).toBe('Room 7');
    expect(together(rows)).toEqual({ in: 1, of: 4 });
  });

  it('draws whoever else the party lists after the roster, as a guest, counted apart', () => {
    const bowel = character('Bowel', {
      party: [member('Archer'), member('Bowel'), member('Fatty', { health: 0.8 })]
    });
    const archer = character('Archer', { following: 'Bowel' });
    const rows = boardRows(roster(['Bowel', 'Archer']), archer, [ours(bowel), ours(archer)]);
    expect(rows.map((r) => [r.name, r.status, r.guest, r.health])).toEqual([
      ['Bowel', 'in', false, 0.9],
      ['Archer', 'in', false, 0.9],
      ['Fatty', 'in', true, 0.8]
    ]);
    expect(together(rows)).toEqual({ in: 2, of: 2 });
  });

  it('draws the listing as it stands when there is no roster, whoever this character follows first', () => {
    const skinny = character('Skinny', {
      following: 'Fatty',
      party: [member('Skinny'), member('Fatty')]
    });
    expect(boardRows(null, skinny, [ours(skinny)]).map((r) => [r.name, r.leader])).toEqual([
      ['Fatty', true],
      ['Skinny', false]
    ]);
  });

  it('makes a roster from the party as it stands, led by whoever this character follows', () => {
    const skinny = character('Skinny', {
      following: 'Fatty',
      party: [member('Fatty', { rank: 'front' }), member('Zed', { invited: true })]
    });
    expect(rosterFromListing('p', 'Skinny Inc', skinny)).toEqual({
      id: 'p',
      realm: 'Skinny Inc',
      leader: 'Fatty',
      members: [
        { name: 'Skinny', rank: null },
        { name: 'Fatty', rank: 'front' }
      ],
      regroup: true,
      forgotten: [],
      places: []
    });
  });
});
