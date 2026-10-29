import { describe, expect, it } from 'vitest';

import {
  areaStem,
  attackTypeOf,
  groupAreas,
  howItFights,
  loopGroups,
  priceArea,
  waitsOnClock,
  type GroundGroup
} from '../huntingGrounds';

/** A priced group on `map`, its rooms under `names`. */
function group(
  key: string,
  figures: Partial<GroundGroup> & { map?: number; names?: string[] } = {}
): GroundGroup {
  const { map = 1, names = ['Ruined Palace'], ...rest } = figures;
  return {
    key,
    kind: 'lair',
    mobs: ['dark oceanid'],
    rooms: names.map((name, i) => ({ id: `${map}/${key}${i}`, map, room: i + 1, name, steps: 3 })),
    lairs: 10,
    perSpawn: 2,
    expPerClear: 1_000_000,
    respawnMinutes: 5,
    expPerHour: 100_000_000,
    attack: 0.9,
    move: 0.05,
    recovering: 0.05,
    roundsToClear: 5,
    damagePerRound: 20,
    ...rest
  };
}

describe('what a character fights with, off its MegaMUD settings', () => {
  it('reads the attack, the heal and the blessings, as Fatty’s profile states them', () => {
    expect(
      howItFights({
        Combat: { AttackCmd: 'bash', AttackSpl: '', CanBackStab: 0 },
        Spells: {
          HealCmd: '',
          BlessCmd1: 'gpow',
          BlessCmd2: 'agil',
          BlessCmd3: 'hrmy',
          BlessCmd4: '',
          BlessCmd5: 'soot'
        },
        Health: { MeditateB4Rest: 0 }
      })
    ).toEqual({
      attack: 'bash',
      attackSpell: '',
      backstab: false,
      heal: '',
      blessings: ['gpow', 'agil', 'hrmy', 'soot'],
      meditate: false
    });
  });

  it('names MME’s attack type for the word, abbreviations as the realm takes them', () => {
    expect(attackTypeOf('bash')).toEqual({ type: 6, ma: 0 });
    expect(attackTypeOf('ba')).toEqual({ type: 6, ma: 0 });
    expect(attackTypeOf('smash')).toEqual({ type: 7, ma: 0 });
    expect(attackTypeOf('kick')).toEqual({ type: 4, ma: 2 });
    expect(attackTypeOf('jk')).toEqual({ type: 4, ma: 3 });
    expect(attackTypeOf('a')).toEqual({ type: 1, ma: 0 });
    expect(attackTypeOf('')).toEqual({ type: 1, ma: 0 });
  });
});

describe('hunting areas', () => {
  it('takes the part of a room name before a comma as its area', () => {
    expect(areaStem('Volcano, Magma Tunnels')).toBe('Volcano');
  });

  /*
   * The user's rule (2026-10-29): an area is lairs of a kind under one name.
   * The Undersea Cavern's plain dark oceanids are one, apart from the lobsters
   * spawning under that name and from the Ruined Palace beside it.
   */
  it('joins lairs under one name, close and of a kind, and a boss to the place it stands in', () => {
    const things = [
      group('palace', {
        names: ['Ruined Palace'],
        mobs: ['dark oceanid', 'dark oceanid druidess']
      }),
      group('temple', {
        names: ['Ruined Palace, Temple'],
        mobs: ['dark oceanid priestess', 'dark oceanid druidess']
      }),
      group('cavern', { names: ['Undersea Cavern'], mobs: ['dark oceanid'] }),
      group('lobsters', { names: ['Undersea Cavern'], mobs: ['giant lobster'] }),
      group('mistress', {
        kind: 'mob',
        names: ['Ruined Palace, Spawning Grounds'],
        mobs: ['dark oceanid beastmistress']
      }),
      group('far', { names: ['Ruined Palace'], mobs: ['dark oceanid druidess'] }),
      group('elsewhere', { map: 2, names: ['Ruined Palace'], mobs: ['dark oceanid druidess'] })
    ];
    const apart = new Set(['far', 'elsewhere']);
    const areas = groupAreas(things, (x, y) => !apart.has(x.key) && !apart.has(y.key));
    expect(areas.map((area) => area.members.map((thing) => thing.key))).toEqual([
      ['palace', 'temple', 'mistress'],
      ['cavern'],
      ['lobsters'],
      ['far'],
      ['elsewhere']
    ]);
  });

  it('names an area by what most of its rooms are called', () => {
    const [area] = groupAreas(
      [
        group('a', { names: ['Troll Caves, Gate'] }),
        group('b', { names: ['Troll Caves', 'Troll Caves, Deep', 'Gate'] })
      ],
      () => true
    );
    expect(area!.name).toBe('Troll Caves');
  });
});

/*
 * The arithmetic checked against Fatty (2026-10-29): the oceanid lairs as his
 * loop, the beastmistress on her hour added for the laps that find her back.
 */
describe('an area priced as a loop walks it', () => {
  const druidess = group('lair:35-5-13', {
    lairs: 49,
    expPerClear: 1_111_121,
    expPerHour: 126_400_000,
    attack: 0.95,
    move: 0.04
  });
  const beastmistress = group('mob:2026', {
    kind: 'mob',
    mobs: ['dark oceanid beastmistress'],
    lairs: 1,
    expPerClear: 33_061_400,
    respawnMinutes: 60,
    expPerHour: 33_060_000,
    attack: 0.01,
    move: 0
  });
  const undefeatable = group('lair:9', { expPerHour: null });

  it('tells a group waiting on its clock from a busy one', () => {
    expect(waitsOnClock(druidess, 0.25)).toBe(false);
    expect(waitsOnClock(beastmistress, 0.25)).toBe(true);
    expect(waitsOnClock({ kind: 'lair', attack: 0.1, move: 0.05 }, 0.25)).toBe(true);
  });

  it('walks the busy groups as the loop, and a clock-bound one only where nothing is busy', () => {
    expect(loopGroups([druidess, beastmistress, undefeatable], 0.25, 0.5)).toEqual([druidess]);
    const quiet = group('lair:7', { attack: 0.02, move: 0 });
    expect(loopGroups([quiet, undefeatable], 0.25, 0.5)).toEqual([quiet]);
  });

  it('adds a clock-bound group at its rate for half a lap’s lateness, off the loop’s time', () => {
    const priced = priceArea([druidess, beastmistress, undefeatable], druidess, 0.25, 0.5);
    // One lap: 49 clears at 126.4M/h is 25.8 minutes.
    expect(priced.lapMinutes!).toBeCloseTo(25.84, 1);
    const factor = 60 / (60 + priced.lapMinutes! / 2);
    const added = priced.groups.find((entry) => entry.role === 'added')!;
    expect(added.contributes).toBeCloseTo(33_060_000 * factor, -3);
    expect(priced.expPerHour!).toBeCloseTo(
      126_400_000 * (1 - 0.01 * factor) + 33_060_000 * factor,
      -3
    );
    expect(priced.groups.map((entry) => entry.role)).toEqual(['loop', 'added', 'none']);
  });

  /*
   * The router's danger check (2026-10-29): Bowel and Archer were offered the
   * Ruined Palace and the dragoon encampment, which would kill them.
   */
  it('hunts no group a pass through which takes half the bar or more, and says so', () => {
    const deadly = { ...druidess, danger: 0.8 };
    expect(loopGroups([deadly, beastmistress], 0.25, 0.5)).toEqual([]);
    const priced = priceArea([deadly], null, 0.25, 0.5);
    expect(priced).toMatchObject({ expPerHour: null, tooDangerous: true, danger: 0.8 });
    expect(priced.groups[0]!.role).toBe('dangerous');
    // Safe beside it, the dangerous one is left out of the loop and of what is added.
    const safe = { ...druidess, key: 'lair:safe', danger: 0.1 };
    const both = priceArea([safe, deadly, { ...beastmistress, danger: 0.9 }], safe, 0.25, 0.5);
    expect(both.groups.map((entry) => entry.role)).toEqual(['loop', 'dangerous', 'dangerous']);
    expect(both.expPerHour).toBe(safe.expPerHour);
    expect(both.danger).toBe(0.1);
  });

  it('pays nothing where no group does', () => {
    expect(priceArea([undefeatable], null, 0.25, 0.5)).toMatchObject({
      expPerHour: null,
      loop: null
    });
  });
});
