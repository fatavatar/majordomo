import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { WorldGraph } from '../WorldGraph';
import { buildAreas } from '../areas';
import { layOut } from '../areaLayout';
import { areaMap } from '../areaMap';
import { roomBrief } from '../roomBrief';
import { layoutMap, levelBeside, levelNumber } from '../../../shared/map';

function makeWorld(rooms: Array<Record<string, unknown>>): WorldGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-area-'));
  const file = path.join(dir, 'rooms.jsonl.gz');
  const header = JSON.stringify({ v: 1, source: 'test', rooms: rooms.length, generatedAt: 'x' });
  fs.writeFileSync(
    file,
    zlib.gzipSync([header, ...rooms.map((r) => JSON.stringify(r))].join('\n') + '\n')
  );
  const graph = WorldGraph.load(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return graph;
}

/** A row of `count` rooms called `name`, east to west from room `first`, joined both ways. */
function row(name: string, first: number, count: number, map = 1): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => {
    const r = first + i;
    const x: Record<string, unknown> = {};
    if (i > 0) x['w'] = { m: map, r: r - 1 };
    if (i < count - 1) x['e'] = { m: map, r: r + 1 };
    return { m: map, r, n: name, x };
  });
}

/** Joins room `a`'s `way` to room `b`, and back the opposite way. */
function join(
  rooms: Array<Record<string, unknown>>,
  a: number,
  way: string,
  b: number,
  back: string
): void {
  const from = rooms.find((room) => room['r'] === a)!;
  const to = rooms.find((room) => room['r'] === b)!;
  (from['x'] as Record<string, unknown>)[way] = { m: 1, r: b };
  (to['x'] as Record<string, unknown>)[back] = { m: 1, r: a };
}

describe('carving the realm into areas (mudmaps)', () => {
  it('keeps a long run of one name its own area, and folds a short one into its neighbour', () => {
    const rooms = [...row('Darkwood Forest', 1, 12), ...row('Woodcutter Hut', 20, 3)];
    join(rooms, 12, 'e', 20, 'w');
    const { areas, areaOf } = buildAreas(makeWorld(rooms));
    expect(areas).toHaveLength(1);
    expect(areas[0]!.name).toBe('Darkwood Forest');
    expect(areaOf.get('1/21')).toBe(areaOf.get('1/1'));
  });

  it('keeps two places apart that one exit joins, and names each by its rooms', () => {
    // Joined both ways by one exit: 2 / √(100 × 100) is under the coupling.
    const rooms = [...row('Darkwood Forest', 1, 100), ...row('Silver River', 200, 100)];
    join(rooms, 100, 'e', 200, 'w');
    const { areas, areaOf } = buildAreas(makeWorld(rooms));
    expect(areas.map((area) => area.name).sort()).toEqual(['Darkwood Forest', 'Silver River']);
    expect(areaOf.get('1/1')).not.toBe(areaOf.get('1/200'));
  });

  it('joins a family: Copper Mine and Copper Mine Tunnel are one mine', () => {
    const rooms = [...row('Copper Mine', 1, 30), ...row('Copper Mine Tunnel', 100, 30)];
    join(rooms, 30, 'e', 100, 'w');
    expect(buildAreas(makeWorld(rooms)).areas).toHaveLength(1);
  });

  it('takes the hand tuning: a name, and a join', () => {
    const rooms = [...row('Darkwood Forest', 1, 100), ...row('Silver River', 200, 100)];
    join(rooms, 100, 'e', 200, 'w');
    const { areas } = buildAreas(makeWorld(rooms), {
      names: { '1/1': 'The Wood' },
      join: [['1/1', '1/200']]
    });
    expect(areas.map((area) => area.name)).toEqual(['The Wood']);
  });
});

describe('laying an area out (mudmaps)', () => {
  it('keeps a staircase in its column, a level apart', () => {
    const graph = makeWorld([
      { m: 1, r: 1, n: 'Hall', x: { e: { m: 1, r: 2 }, u: { m: 1, r: 3 } } },
      { m: 1, r: 2, n: 'Hall', x: { w: { m: 1, r: 1 } } },
      { m: 1, r: 3, n: 'Loft', x: { d: { m: 1, r: 1 } } }
    ]);
    const spots = layOut(graph, ['1/1', '1/2', '1/3'], '1/1');
    expect(spots.get('1/1')).toEqual({ x: 0, y: 0, z: 0 });
    expect(spots.get('1/2')).toEqual({ x: 1, y: 0, z: 0 });
    expect(spots.get('1/3')).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('places a room two exits put in one square apart from the other, touching nothing', () => {
    // East of 1 is 2, and north-east of 1 is 3 — but 3's own south is 2's
    // square too: not Euclidean. Every room is placed, no two on one square.
    const graph = makeWorld([
      { m: 1, r: 1, n: 'A', x: { e: { m: 1, r: 2 }, n: { m: 1, r: 3 } } },
      { m: 1, r: 2, n: 'A', x: { w: { m: 1, r: 1 }, n: { m: 1, r: 4 } } },
      { m: 1, r: 3, n: 'A', x: { s: { m: 1, r: 1 }, e: { m: 1, r: 4 } } },
      { m: 1, r: 4, n: 'A', x: { s: { m: 1, r: 2 }, w: { m: 1, r: 5 } } },
      { m: 1, r: 5, n: 'A', x: { e: { m: 1, r: 4 } } }
    ]);
    const spots = layOut(graph, ['1/1', '1/2', '1/3', '1/4', '1/5'], '1/1');
    expect(spots.size).toBe(5);
    const squares = [...spots.values()].map(({ x, y, z }) => `${x},${y},${z}`);
    expect(new Set(squares).size).toBe(5);
  });
});

describe('one level of an area, for the Map card', () => {
  /** A courtyard with a stair up from its sixth room, and a river south of its third. */
  const tower = (): WorldGraph => {
    const rooms = [
      ...row('Courtyard', 1, 60),
      { m: 1, r: 500, n: 'Courtyard', x: {} },
      ...row('Silver River', 600, 100)
    ];
    join(rooms, 6, 'u', 500, 'd');
    join(rooms, 3, 's', 600, 'n');
    return makeWorld(rooms);
  };

  it('draws the whole level, centred on the room, with every level the area has', () => {
    const map = areaMap(tower(), '1/1', null)!;
    expect(map.whole).toBe(true);
    expect(map.area.name).toBe('Courtyard');
    expect(map.centre).toBe('1/1');
    expect(map.cells.find((cell) => cell.id === '1/1')).toMatchObject({ gx: 0, gy: 0 });
    expect(map.cells).toHaveLength(60);
    expect(map.levels).toEqual([
      { level: 1, rooms: 1 },
      { level: 0, rooms: 60 }
    ]);
  });

  it('centres another level on its room nearest the one asked about, the stair', () => {
    const map = areaMap(tower(), '1/1', 1)!;
    expect(map.level).toBe(1);
    expect(map.centre).toBe('1/500');
    expect(map.cells.map((cell) => cell.id)).toEqual(['1/500']);
  });

  it('draws a way out of the area as an arrow, where a radius would leave it past the edge', () => {
    const map = areaMap(tower(), '1/1', null)!;
    const drawing = layoutMap(map);
    const out = drawing.nodes.find((node) => node.id === '1/3')!.arrows;
    expect(out).toEqual([expect.objectContaining({ direction: 's', to: '1/600', local: false })]);
  });

  it('steps to the level above and below, and counts the levels from the bottom', () => {
    const ground = areaMap(tower(), '1/1', null)!;
    expect(levelBeside(ground, -1)).toBe(1);
    expect(levelBeside(ground, 1)).toBeNull();
    expect(levelNumber(ground)).toBe(1);
    expect(levelNumber(areaMap(tower(), '1/1', 1)!)).toBe(2);
    expect(levelBeside(null, 1)).toBeNull();
  });

  it('answers nothing for a room the realm does not have', () => {
    expect(areaMap(tower(), '9/9', null)).toBeNull();
  });
});

/*
 * Reported 2026-10-26: mudmaps says how to open the Obsidian Fortress's
 * barracks door at 16/5006, and the map said only *Door, pick/bash 251* —
 * its button is at the gates, two rooms back, and only a lever in the door's
 * own room was named.
 */
describe('a door opened from another room', () => {
  const gates = (): WorldGraph =>
    makeWorld([
      {
        m: 1,
        r: 1,
        n: 'Main Gates',
        x: { e: { m: 1, r: 2 } },
        cmd: [{ say: ['push button'], opens: { room: '1/2', direction: 's' } }]
      },
      {
        m: 1,
        r: 2,
        n: 'Hallway',
        x: { w: { m: 1, r: 1 }, s: { m: 1, r: 3, i: 'Door [251 picklocks/strength]' } }
      },
      { m: 1, r: 3, n: 'Barracks', x: { n: { m: 1, r: 2, i: 'Door [51 picklocks/strength]' } } }
    ]);

  it('names the switch and the room it is in, on the map', () => {
    const map = areaMap(gates(), '1/2', null)!;
    const door = map.cells.find((cell) => cell.id === '1/2')!.blocked!.s!;
    expect(door.label).toBe('“push button” in Main Gates (1/1)');
    expect(door.detail).toContain('pick/bash 251');
  });

  it('says on the switch’s room what it opens', () => {
    const brief = roomBrief(gates(), '1/1', null)!;
    expect(brief.commands).toEqual([
      expect.objectContaining({ opens: { room: '1/2', direction: 's' }, opensName: 'Hallway' })
    ]);
  });
});
