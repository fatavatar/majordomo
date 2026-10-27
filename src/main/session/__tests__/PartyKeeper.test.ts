import { describe, expect, it } from 'vitest';

import { EMPTY_CHARACTER, type CharacterState, type PartyMember } from '../../../shared/character';
import type { PartyRoster } from '../../../shared/partyRoster';
import {
  musterActs,
  PartyKeeper,
  regroupActs,
  type KeptMember,
  type RegroupAct
} from '../PartyKeeper';

const member = (name: string, invited = false): PartyMember => ({
  name,
  className: null,
  health: 1,
  mana: null,
  rank: null,
  activity: null,
  invited,
  vitals: null
});

function kept(
  name: string,
  over: {
    room?: number;
    party?: PartyMember[];
    following?: string | null;
    sees?: string[];
    inGame?: boolean;
    busy?: boolean;
  } = {}
): KeptMember {
  const character: CharacterState = {
    ...EMPTY_CHARACTER,
    name,
    phase: 'in-game',
    room: {
      ...EMPTY_CHARACTER.room,
      map: 1,
      number: over.room ?? 1,
      occupants: (over.sees ?? []).map((who) => ({ name: who }) as never)
    },
    party: {
      ...EMPTY_CHARACTER.party,
      members: over.party ?? [],
      following: over.following ?? null
    }
  };
  return {
    session: name.toLowerCase(),
    character,
    inGame: over.inGame ?? true,
    busy: over.busy ?? false
  };
}

const roster = (over: Partial<PartyRoster> = {}): PartyRoster => ({
  id: 'p',
  realm: 'Skinny Inc',
  leader: 'Fatty',
  members: ['Fatty', 'Skinny', 'healbot'].map((name) => ({ name, rank: null })),
  regroup: true,
  forgotten: [],
  places: [],
  ...over
});

describe('Regroup, when the leader is ours', () => {
  it('does nothing while everybody is in the party', () => {
    const fatty = kept('Fatty', {
      party: [member('Fatty'), member('Skinny'), member('healbot')]
    });
    expect(regroupActs(roster(), [fatty, kept('Skinny'), kept('healbot')])).toEqual([]);
  });

  it('invites a member standing with the leader, and has one of ours join once invited', () => {
    const fatty = kept('Fatty', {
      party: [member('Fatty'), member('healbot', true)],
      sees: ['Skinny', 'healbot']
    });
    expect(regroupActs(roster(), [fatty, kept('Skinny'), kept('healbot')])).toEqual([
      { session: 'fatty', act: 'invite', name: 'Skinny' },
      { session: 'healbot', act: 'join', leader: 'Fatty' }
    ]);
  });

  it('walks one of ours elsewhere to the leader, unless it is fighting or walking', () => {
    const fatty = kept('Fatty', { room: 9, party: [member('Fatty')] });
    expect(
      regroupActs(roster(), [fatty, kept('Skinny', { room: 3 }), kept('healbot', { busy: true })])
    ).toEqual([{ session: 'skinny', act: 'walk', leader: 'Fatty', to: '1/9' }]);
  });

  it('invites somebody else only once they are standing with the leader', () => {
    const r = roster({
      members: [
        { name: 'Fatty', rank: null },
        { name: 'Zed', rank: null }
      ]
    });
    expect(regroupActs(r, [kept('Fatty')])).toEqual([]);
    expect(regroupActs(r, [kept('Fatty', { sees: ['Zed'] })])).toEqual([
      { session: 'fatty', act: 'invite', name: 'Zed' }
    ]);
  });

  it('leaves out a member who said @forget, one offline, and everybody while it is off', () => {
    const fatty = kept('Fatty', { sees: ['Skinny', 'healbot'] });
    const acts = regroupActs(roster({ forgotten: ['Skinny'] }), [
      fatty,
      kept('Skinny'),
      kept('healbot', { inGame: false })
    ]);
    expect(acts).toEqual([]);
    expect(regroupActs(roster({ regroup: false }), [fatty, kept('Skinny')])).toEqual([]);
  });

  it('does nothing while the leader is out of the game', () => {
    expect(regroupActs(roster(), [kept('Fatty', { inGame: false }), kept('Skinny')])).toEqual([]);
  });
});

describe('Regroup, when the leader is somebody else', () => {
  const zedLeads = roster({
    leader: 'Zed',
    members: [
      { name: 'Zed', rank: null },
      { name: 'Skinny', rank: null }
    ]
  });

  it('asks the leader for an invitation once one of ours is standing with them', () => {
    expect(regroupActs(zedLeads, [kept('Skinny')])).toEqual([]);
    expect(regroupActs(zedLeads, [kept('Skinny', { sees: ['Zed'] })])).toEqual([
      { session: 'skinny', act: 'askInvite', leader: 'Zed' }
    ]);
  });

  it('asks nothing of a member already following the leader', () => {
    expect(regroupActs(zedLeads, [kept('Skinny', { sees: ['Zed'], following: 'Zed' })])).toEqual(
      []
    );
  });
});

describe('the keeper', () => {
  it('tries the same act for the same member once per interval', () => {
    let now = 0;
    const ran: RegroupAct[] = [];
    const keeper = new PartyKeeper({
      againMs: () => 20_000,
      run: (act) => {
        ran.push(act);
        return true;
      },
      now: () => now
    });
    const ours = [kept('Fatty', { sees: ['Skinny'] }), kept('Skinny')];
    keeper.check([roster()], () => ours);
    now = 5_000;
    keeper.check([roster()], () => ours);
    now = 21_000;
    keeper.check([roster()], () => ours);
    expect(ran.map((act) => act.act)).toEqual(['invite', 'invite']);
  });
});

describe('Muster', () => {
  const mudops = new Set(['fatty', 'skinny']);
  const mudop = (session: string): boolean => mudops.has(session);

  it('walks ours to the leader’s room, and says why one stays put', () => {
    const fighting = kept('healbot', { room: 4 });
    fighting.character = { ...fighting.character, inCombat: true };
    expect(
      musterActs(
        roster(),
        [kept('Fatty', { room: 9 }), kept('Skinny', { room: 3 }), fighting],
        {
          to: 'leader'
        },
        mudop
      )
    ).toEqual([
      { session: 'fatty', name: 'Fatty', act: 'skip', why: 'isLeader' },
      { session: 'skinny', name: 'Skinny', act: 'walk', to: '1/9' },
      { session: 'healbot', name: 'healbot', act: 'skip', why: 'fighting' }
    ]);
  });

  it('sends a MudOp by sys goto, leader and all, and nobody else', () => {
    expect(
      musterActs(
        roster(),
        [kept('Fatty'), kept('Skinny'), kept('healbot')],
        { to: 'place', place: 'kha' },
        mudop
      ).map((act) => [act.name, act.act])
    ).toEqual([
      ['Fatty', 'sysGoto'],
      ['Skinny', 'sysGoto'],
      ['healbot', 'skip']
    ]);
  });

  it('has nowhere to walk while the leader is not one of ours in the game', () => {
    expect(
      musterActs(roster(), [kept('Skinny')], { to: 'leader' }, mudop).map((act) =>
        act.act === 'skip' ? act.why : act.act
      )
    ).toEqual(['leaderUnknown']);
  });
});

describe('Regroup, pressed', () => {
  it('acts at once, even with the switch off and an act tried a moment ago', () => {
    const ran: RegroupAct[] = [];
    const keeper = new PartyKeeper({
      againMs: () => 20_000,
      run: (act) => {
        ran.push(act);
        return true;
      },
      now: () => 0
    });
    const ours = [kept('Fatty', { sees: ['Skinny'] }), kept('Skinny')];
    keeper.check([roster()], () => ours);
    expect(keeper.now(roster({ regroup: false }), ours)).toBe(1);
    expect(ran).toHaveLength(2);
  });
});
