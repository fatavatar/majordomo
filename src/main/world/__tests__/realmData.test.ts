import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parse } from 'yaml';

import { WorldGraph } from '../WorldGraph';
import { bossRooms } from '../huntingAreas';
import { realmLoopCount, realmLoops } from '../realmLoops';
import type { RoomId } from '../../../shared/world';
import {
  DATABASE_LOOPS_MANIFEST,
  databaseLoopsCurrent,
  writeDatabaseLoops
} from '../realmLoopFiles';
import { mergeMonsterRules } from '../../../shared/monsterRules';
import { realmItemRules, realmMonsterRules } from '../realmTables';

function makeWorld(
  rooms: Array<Record<string, unknown>>,
  mobs: Array<Record<string, unknown>>
): WorldGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-realm-data-'));
  const file = path.join(dir, 'rooms.jsonl.gz');
  const head = JSON.stringify({
    v: 36,
    source: 'test',
    rooms: rooms.length,
    generatedAt: 'x',
    mobs
  });
  fs.writeFileSync(
    file,
    zlib.gzipSync([head, ...rooms.map((room) => JSON.stringify(room))].join('\n') + '\n')
  );
  const graph = WorldGraph.load(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return graph;
}

/** A corridor of rooms on map 1, each one east of the last. */
function corridor(
  rooms: Array<{ n: string; lair?: string; npc?: number }>
): Array<Record<string, unknown>> {
  return rooms.map((room, i) => ({
    m: 1,
    r: i + 1,
    n: room.n,
    x: {
      ...(i > 0 ? { w: { m: 1, r: i } } : {}),
      ...(i < rooms.length - 1 ? { e: { m: 1, r: i + 2 } } : {})
    },
    ...(room.lair === undefined ? {} : { lair: room.lair, dl: 1 }),
    ...(room.npc === undefined ? {} : { npc: room.npc })
  }));
}

describe('the monster table from a realm database', () => {
  const row = (Number: number, Name: string, Align: number, Type = 0) => ({
    Number,
    Name,
    Align,
    Type
  });

  it('befriends shopkeepers and monsters it costs alignment to attack, fights the hostile first, and leaves the rest alone', () => {
    const rules = realmMonsterRules(
      [
        row(1, 'Mariana', 3),
        row(2, 'town guard', 0),
        row(3, 'black griffon', 2),
        row(4, 'seagull', 3),
        row(5, 'giant rat', 2),
        row(6, 'giant rat', 0)
      ],
      new Set([1])
    );
    expect(rules).toEqual([
      { mob: 'mariana', relationship: 'friend', notHostile: true },
      { mob: 'town guard', relationship: 'friend', notHostile: true },
      { mob: 'black griffon', priority: 'high' },
      { mob: 'seagull', notHostile: true, relationship: 'avoid' }
      // Two giant rats that disagree: neither a friend nor always hostile, so no row.
    ]);
    // A character's own row still fights it.
    expect(
      mergeMonsterRules(rules, [{ mob: 'seagull', relationship: 'enemy' }]).find(
        (rule) => rule.mob === 'seagull'
      )
    ).toEqual({ mob: 'seagull', notHostile: true, relationship: 'enemy' });
  });
});

describe('the item table from a realm database', () => {
  it('marks weapons with backstab accuracy and what cannot be picked up', () => {
    const rules = realmItemRules([
      { Number: 1, Name: 'Dagger', ItemType: 1, Gettable: 1, 'Abil-0': 116, 'AbilVal-0': 5 },
      { Number: 2, Name: 'stove', ItemType: 0, Gettable: 0 },
      { Number: 3, Name: 'club', ItemType: 1, Gettable: 1 },
      // A shield with the ability is no weapon to backstab with.
      { Number: 4, Name: 'spiked shield', ItemType: 0, Gettable: 1, 'Abil-3': 116 }
    ]);
    expect(rules).toEqual([
      { item: 'dagger', backstab: true },
      { item: 'stove', cannotTake: true }
    ]);
  });
});

describe('the hunting loops from a realm database', () => {
  const mobs = [
    { n: 'black griffon', hp: 100, i: [1], xp: 100 },
    { n: 'seagull', hp: 100, i: [2], xp: 100 },
    // On a clock, but in every lair of the cliffs: part of the hunt.
    { n: 'opalescant griffon', hp: 300, i: [3], xp: 1000, rt: 1 },
    // On a clock, and in one room: a boss.
    { n: 'Rathi Dragonite', hp: 16055, i: [4], xp: 100000, rt: 21 }
  ];
  const world = makeWorld(
    corridor([
      { n: 'Rocky Cliffs', lair: '(Max 2): 1,3' },
      { n: 'Rocky Cliffs' },
      { n: 'Rocky Cliffs', lair: '(Max 2): 1,3' },
      { n: 'Rocky Cliffs', lair: '(Max 2): 1,3', npc: 4 },
      { n: 'Rocky Cliffs', lair: '(Max 2): 1,3' },
      ...Array.from({ length: 12 }, () => ({ n: 'Long Road' })),
      { n: 'Sandy Beach', lair: '(Max 1): 2' },
      { n: 'Sandy Beach', lair: '(Max 1): 2' },
      ...Array.from({ length: 12 }, () => ({ n: 'Long Road' })),
      { n: 'Lone Hill', lair: '(Max 1): 2' }
    ]),
    mobs
  );

  it('walks each area of two lairs or more, nearest first, named for the place and what spawns there', () => {
    expect(realmLoops(world, 6)).toContainEqual({
      name: 'Sandy Beach: seagull',
      stops: [{ room: 'Sandy Beach 1/18' }, { room: 'Sandy Beach 1/19' }]
    });
    expect(realmLoopCount(world, 6)).toBe(3);
  });

  it('makes an area with a boss twice: with its bosses, and never entering their rooms', () => {
    const cliffs = realmLoops(world, 6).filter((loop) => loop.name.startsWith('Rocky Cliffs'));
    expect(cliffs).toEqual([
      {
        // 1/5 is reached only through the boss's room, so it is left out with it.
        name: 'Rocky Cliffs: black griffon, opalescant griffon (no bosses)',
        stops: [{ room: 'Rocky Cliffs 1/1' }, { room: 'Rocky Cliffs 1/3' }],
        avoid: ['Rocky Cliffs 1/4']
      },
      {
        name: 'Rocky Cliffs: black griffon, opalescant griffon (with bosses)',
        stops: [
          { room: 'Rocky Cliffs 1/1' },
          { room: 'Rocky Cliffs 1/3' },
          { room: 'Rocky Cliffs 1/4' },
          { room: 'Rocky Cliffs 1/5' }
        ]
      }
    ]);
  });

  it('takes a monster on a clock in one room for a boss, and one in every room for the hunt', () => {
    expect([...bossRooms(world, ['1/1', '1/3', '1/4', '1/5'] as RoomId[])]).toEqual(['1/4']);
    expect([...bossRooms(world, ['1/1', '1/3'] as RoomId[])]).toEqual([]);
  });
});

describe('the loops folder a realm database fills', () => {
  let dir: string;
  const source = { file: '/realms/mudrev.mdb', builtAt: 1000 };
  const loop = (name: string, room = 'Rocky Cliffs 1/1') => ({ name, stops: [{ room }] });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-realm-loops-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const names = (): string[] =>
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.yaml'))
      .map(
        (name) => (parse(fs.readFileSync(path.join(dir, name), 'utf8')) as { name: string }).name
      )
      .sort();

  it('writes them once, and knows they are current until the database changes', () => {
    expect(databaseLoopsCurrent(dir, source.file, source.builtAt)).toBe(false);
    expect(writeDatabaseLoops(dir, source, [loop('Cliffs'), loop('Beach')], ' made')).toBe(2);
    expect(names()).toEqual(['Beach', 'Cliffs']);
    expect(fs.existsSync(path.join(dir, DATABASE_LOOPS_MANIFEST))).toBe(true);
    expect(databaseLoopsCurrent(dir, source.file, source.builtAt)).toBe(true);
    expect(databaseLoopsCurrent(dir, source.file, 2000)).toBe(false);
  });

  it('makes them again when the way they are made has changed', () => {
    // Written before loops were made with and without their bosses.
    fs.writeFileSync(
      path.join(dir, DATABASE_LOOPS_MANIFEST),
      JSON.stringify({ ...source, written: {} })
    );
    expect(databaseLoopsCurrent(dir, source.file, source.builtAt)).toBe(false);
  });

  it('replaces only its own untouched files, and leaves the player’s', () => {
    fs.writeFileSync(path.join(dir, 'mine.yaml'), 'name: Mine\nstops:\n  - Town 1/1\n');
    writeDatabaseLoops(dir, source, [loop('Cliffs'), loop('Beach'), loop('Hill')], ' made');
    // The player edits Beach; Hill is left as written.
    const beach = path.join(dir, 'beach.yaml');
    fs.writeFileSync(beach, fs.readFileSync(beach, 'utf8').replace('1/1', '1/2'));
    const rebuilt = writeDatabaseLoops(
      dir,
      { ...source, builtAt: 2000 },
      [loop('Cliffs'), loop('Beach'), loop('Dunes')],
      ' made'
    );
    // Beach is theirs now, so it is not written again beside it; Hill is gone with the database's.
    expect(rebuilt).toBe(2);
    expect(names()).toEqual(['Beach', 'Cliffs', 'Dunes', 'Mine']);
    expect(fs.readFileSync(beach, 'utf8')).toContain('1/2');
  });
});
