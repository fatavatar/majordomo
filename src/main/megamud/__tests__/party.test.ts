import { describe, expect, it } from 'vitest';

import type { ClassRec } from '../data';
import { newPlayer } from '../data';
import { partyLine } from '../party/party';
import { session } from './fixture';

/* `0x47ec60` and `0x47d9a0`, read 2026-10-12; the listing is Skinny's, 2026-10-12. */

function cls(id: number, name: string): ClassRec {
  return {
    id,
    layer: 0,
    name,
    f28: 0,
    bytes: [0, 0, 0, 0, 0],
    magic: 0,
    abilities: [],
    values: []
  };
}

function party() {
  const r = session({ classes: [cls(7, 'Skald'), cls(12, 'Necrolyte')] });
  const { s } = r;
  s.inGame = 1;
  s.Player_Name = 'Skinny';
  s.hp = 70;
  s.Player_MaxHP = 1182;
  for (const name of ['Fatty', 'Skinny']) newPlayer(s.data, 0).name = name;
  return r;
}

const LISTING = [
  'The following people are in your travel party:',
  '  Fatty Fatterson                (Skald)      [M:100%] [H:100%]   - Frontrank',
  '  Skinny Fatterson               (Necrolyte)  [M: 95%] [H:  6%]   - Backrank'
];

describe('the party (0x47ec60)', () => {
  it('lists the members with their class and percents', () => {
    const { s } = party();
    for (const line of LISTING) partyLine(s, line);
    expect(s.partySize).toBe(2);
    const fatty = s.party[0]!;
    expect(fatty.name).toBe('Fatty');
    expect(fatty.cls).toBe(7);
    expect(fatty.hpPct).toBe(100);
    expect(fatty.manaPct).toBe(100);
    const me = s.party[1]!;
    expect(me.hpPct).toBe(6);
    expect(me.hp).toBe(70);
    expect(me.maxHp).toBe(1182);
  });

  it('works points back from percents once a maximum is known', () => {
    const { s } = party();
    for (const line of LISTING) partyLine(s, line);
    s.party[0]!.maxHp = 400;
    partyLine(s, LISTING[0]!);
    partyLine(s, '  Fatty Fatterson                (Skald)      [M:100%] [H: 50%]   - Frontrank');
    expect(s.party[0]!.hp).toBe(200);
  });

  it('ends at the prompt, and a follower calls a missing leader back', () => {
    const { s } = party();
    s.leaderName = 'Fatty';
    s.f_e2ec = 1;
    for (const line of LISTING) partyLine(s, line);
    s.lineFlags |= 1;
    expect(partyLine(s, '')).toBe(1);
    expect(s.lineFlags & 0x2000).toBe(0);
    expect(s.pending.map((p) => p.text)).toEqual(['/Fatty @comeback\r']);
  });

  it('learns who it is following', () => {
    const { s } = party();
    partyLine(s, 'You are following Fatty.');
    expect(s.leaderName).toBe('Fatty');
    expect(s.following).toBe(1);
  });

  it('forgets the party when it is not in one', () => {
    const { s } = party();
    for (const line of LISTING) partyLine(s, line);
    s.following = 1;
    partyLine(s, 'You are not in a party at the moment.');
    expect(s.partySize).toBe(0);
    expect(s.following).toBe(0);
  });
});
