// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_CHARACTER, type CharacterState } from '@shared/character';
import type { PartyRoster } from '@shared/partyRoster';
import type { SessionSummary } from '@shared/ipc';

import { useParty, type Party, type PartyApi } from '../useParty';
import { renderHook, settle, summary, type RenderedHook } from './renderHook';

const roster = (id: string, realm: string, ...names: string[]): PartyRoster => ({
  id,
  realm,
  leader: names[0] ?? null,
  members: names.map((name) => ({ name, rank: null })),
  regroup: true,
  forgotten: [],
  places: []
});

const character = (name: string | null, phase: CharacterState['phase'] = 'in-game') => ({
  character: { ...EMPTY_CHARACTER, name, phase }
});

/** Main, as far as the party talks to it: rosters asked for, pushed, and each edit answered. */
function fakeMain(first: PartyRoster[]) {
  let push: ((rosters: PartyRoster[]) => void) | null = null;
  const unsubscribe = vi.fn();
  const api: PartyApi = {
    partyRosters: vi.fn(() => Promise.resolve(first)),
    onPartyRosters: vi.fn((handler) => {
      push = handler;
      return unsubscribe;
    }),
    saveRoster: vi.fn((saved: PartyRoster) => Promise.resolve([saved])),
    removeRoster: vi.fn(() => Promise.resolve([])),
    disbandParty: vi.fn(() => Promise.resolve([])),
    regroupParty: vi.fn(() => Promise.resolve(2)),
    musterParty: vi.fn(() => Promise.resolve(['Archer'])),
    partySay: vi.fn(() => Promise.resolve(['Archer']))
  };
  return { api, unsubscribe, push: (rosters: PartyRoster[]) => push?.(rosters) };
}

interface Props {
  sessions: SessionSummary[];
  views: Record<string, ReturnType<typeof character>>;
}

describe('useParty', () => {
  let rendered: RenderedHook<Props, Party> | null = null;
  afterEach(() => {
    rendered?.unmount();
    rendered = null;
  });

  const mount = (api: PartyApi, props: Props): RenderedHook<Props, Party> => {
    rendered = renderHook(({ sessions, views }: Props) => useParty(api, sessions, views), props);
    return rendered;
  };

  it('keeps the rosters main sends, at first and on every push', async () => {
    const main = fakeMain([roster('p1', 'Skinny Inc', 'Archer', 'Bowel')]);
    const party = mount(main.api, { sessions: [], views: {} });
    await settle();
    expect(party.current.rosters.map((entry) => entry.id)).toEqual(['p1']);

    await settle();
    main.push([roster('p2', 'Skinny Inc', 'Archer')]);
    await settle();
    expect(party.current.rosters.map((entry) => entry.id)).toEqual(['p2']);
  });

  it('stops listening when it goes', async () => {
    const main = fakeMain([]);
    mount(main.api, { sessions: [], views: {} });
    await settle();
    rendered?.unmount();
    rendered = null;
    expect(main.unsubscribe).toHaveBeenCalledOnce();
  });

  it("gives a character its realm's roster and the members of ours there, in the game or not", async () => {
    const main = fakeMain([
      roster('p1', 'Skinny Inc', 'Archer', 'Bowel'),
      roster('p2', 'Paradigm', 'Archer')
    ]);
    const party = mount(main.api, {
      sessions: [
        summary('a', 'Skinny Inc'),
        summary('b', 'Skinny Inc', 'closed'),
        summary('c', 'Paradigm'),
        // No name yet: nobody to put on a roster.
        summary('d', 'Skinny Inc')
      ],
      views: {
        a: character('Archer'),
        b: character('Bowel'),
        c: character('Archer'),
        d: character(null)
      }
    });
    await settle();

    const context = party.current.partyFor('a', character('Archer').character);
    expect(context.realm).toBe('Skinny Inc');
    expect(context.roster?.id).toBe('p1');
    expect(context.ours.map((member) => [member.session, member.inGame])).toEqual([
      ['a', true],
      ['b', false]
    ]);
    expect(party.current.partyFor('zz', character('Archer').character).realm).toBeNull();
  });

  it('takes the rosters main answers an edit with', async () => {
    const main = fakeMain([roster('p1', 'Skinny Inc', 'Archer')]);
    const party = mount(main.api, { sessions: [summary('a', 'Skinny Inc')], views: {} });
    await settle();
    const edited = roster('p1', 'Skinny Inc', 'Archer', 'Bowel');
    party.current.partyFor('a', character('Archer').character).save(edited);
    await settle();
    expect(main.api.saveRoster).toHaveBeenCalledWith(edited);
    expect(party.current.rosters).toEqual([edited]);

    party.current.disband('p1');
    await settle();
    expect(main.api.disbandParty).toHaveBeenCalledWith('p1');
    expect(party.current.rosters).toEqual([]);
  });
});
