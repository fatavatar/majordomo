import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { WorldGraph } from '../../world/WorldGraph';
import { roomTagsNamed } from '../roomTags';

/*
 * What a room asks of whoever would leave it, as the console's tags (2026-10-18),
 * read off the shipped realm: the rooms of Archer's way through the Black House.
 */
const REALM = path.resolve('resources/world/paradigm.jsonl.gz');
const world = fs.existsSync(REALM) ? WorldGraph.load(REALM) : null;
const has = world !== null && world.size > 0;
const nameOf = (id: string): string => world!.byId(id)!.name;

describe('the tags beside a room’s name', () => {
  it.runIf(has)('says which key a locked door wants, and whether it is carried', () => {
    const none = roomTagsNamed(world!, nameOf('1/1224'), () => false, '1/1224')!;
    const door = none.notes.find((note) => note.label.startsWith('e:'))!;
    expect(door).toMatchObject({ tone: 'key' });
    expect(door.label).toMatch(/needs .+/);
    expect(door.title).toContain('Black House, Foyer (1/1313)');
    const carried = roomTagsNamed(world!, nameOf('1/1224'), (item) => item === 172, '1/1224')!;
    expect(carried.notes.find((note) => note.label.startsWith('e:'))!.label).toMatch(/, carried$/);
  });

  it.runIf(has)(
    'makes a lever pulled here a button with its own phrase, saying what it opens',
    () => {
      const tags = roomTagsNamed(world!, nameOf('1/1442'), () => false, '1/1442')!;
      expect(tags.commands).toEqual([
        expect.objectContaining({ label: 'push brick', commands: ['push brick'] })
      ]);
      expect(tags.commands[0]!.title).toContain('Black House, Basement (1/1450)');
    }
  );

  it.runIf(has)('offers a search for a hidden way the realm marks searchable', () => {
    const tags = roomTagsNamed(world!, nameOf('7/148'), () => false, '7/148')!;
    expect(tags.commands.map((command) => command.commands)).toContainEqual(['search s']);
  });

  it.runIf(has)('says where a room command leads', () => {
    const room = world!.findByName('Filthy Aerie')[0]!;
    const tags = roomTagsNamed(world!, room.name, () => false)!;
    expect(tags.commands[0]).toMatchObject({ label: 'climb vines', commands: ['climb vines'] });
    expect(tags.commands[0]!.title).toContain('Black Mountains, Dead End');
  });

  /* A name 108 rooms share says nothing by name alone; the room the tracker expects, its own. */
  it.runIf(has)('answers a shared name only for the room the tracker knows it is', () => {
    expect(roomTagsNamed(world!, 'Slum Street', () => false)).toBeNull();
    expect(roomTagsNamed(world!, 'Slum Street', () => false, '1/1224')).not.toBeNull();
  });
});
