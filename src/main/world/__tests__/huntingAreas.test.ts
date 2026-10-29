import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { WorldGraph } from '../WorldGraph';
import { areaOfRooms, realmAreas } from '../huntingAreas';

function makeWorld(
  rooms: Array<Record<string, unknown>>,
  mobs: Array<Record<string, unknown>>
): WorldGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-areas-'));
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
function corridor(rooms: Array<{ n: string; lair?: string }>): Array<Record<string, unknown>> {
  return rooms.map((room, i) => ({
    m: 1,
    r: i + 1,
    n: room.n,
    x: {
      ...(i > 0 ? { w: { m: 1, r: i } } : {}),
      ...(i < rooms.length - 1 ? { e: { m: 1, r: i + 2 } } : {})
    },
    ...(room.lair === undefined ? {} : { lair: room.lair, dl: 1 })
  }));
}

/*
 * The realm's hunting areas (2026-10-29), worked out once per load of its
 * room data: lairs of a kind under one name, close by — walkable through
 * rooms of that name however far, or within the radius.
 */
describe('the realm’s hunting areas', () => {
  const mobs = [
    { n: 'dark oceanid', hp: 100, i: [1], xp: 100 },
    { n: 'giant lobster', hp: 100, i: [2], xp: 100 },
    { n: 'dark oceanid druidess', hp: 100, i: [3], xp: 100 },
    { n: 'dark oceanid beastmistress', hp: 900, i: [4], xp: 9000, rt: 1 }
  ];
  const lane = (n: string) => ({ n });
  const world = makeWorld(
    corridor([
      { n: 'Undersea Cavern', lair: '(Max 2): 1,' },
      // A long way through the cavern's own rooms, and no lair on it.
      ...Array.from({ length: 12 }, () => lane('Undersea Cavern')),
      { n: 'Undersea Cavern', lair: '(Max 2): 1,' },
      { n: 'Undersea Cavern', lair: '(Max 1): 2,' },
      { n: 'Undersea Cavern, Massive Gate' },
      { n: 'Ruined Palace, Dark Hall', lair: '(Max 3): 1,3,' },
      { n: 'Ruined Palace, Spawning Grounds', lair: '(Max 1): 4,' }
    ]),
    mobs
  );
  const realm = realmAreas(world, 6);
  const area = (room: number) => realm.areaOf.get(`1/${room}` as never);

  it('makes a named place’s lairs of a kind one area, however far apart through its own rooms', () => {
    expect(area(1)).toBe(area(14));
    expect(realm.areas.get(area(1)!)?.name).toBe('Undersea Cavern');
  });

  it('keeps lairs of another kind under that name apart, and the place beside it apart', () => {
    expect(area(15)).not.toBe(area(1));
    expect(area(17)).not.toBe(area(1));
  });

  it('puts a boss on its own clock with the place it stands in', () => {
    expect(area(18)).toBe(area(17));
    expect(realm.areas.get(area(17)!)?.name).toBe('Ruined Palace');
  });

  it('answers a group of rooms with the area most of them are in, and is worked out once', () => {
    expect(areaOfRooms(realm, ['1/1', '1/14', '1/17'] as never)).toBe(area(1));
    expect(realmAreas(world, 6)).toBe(realm);
  });
});
