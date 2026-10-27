import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PartyBook } from '../PartyBook';
import { readRoster, rosterOf, type PartyRoster } from '../../../shared/partyRoster';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function book(changed?: (rosters: PartyRoster[]) => void): { book: PartyBook; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-party-'));
  dirs.push(dir);
  const file = path.join(dir, 'parties.json');
  return { book: new PartyBook({ file, changed }), file };
}

const roster = (id: string, names: string[], over: Partial<PartyRoster> = {}): PartyRoster => ({
  id,
  realm: 'Skinny Inc',
  leader: names[0] ?? null,
  members: names.map((name) => ({ name, rank: null })),
  regroup: true,
  forgotten: [],
  places: [],
  ...over
});

describe('a party roster, read', () => {
  it('keeps a name once, drops a leader who is not a member, and defaults regroup on', () => {
    const read = readRoster({
      id: 'a',
      realm: 'Skinny Inc',
      leader: 'Nobody',
      members: [{ name: 'Fatty', rank: 'front' }, { name: 'fatty' }, { name: 'not a name!' }],
      forgotten: ['Skinny']
    });
    expect(read).toEqual({
      id: 'a',
      realm: 'Skinny Inc',
      leader: null,
      members: [{ name: 'Fatty', rank: 'front' }],
      regroup: true,
      forgotten: [],
      places: []
    });
  });

  it('is found from any member, in any case, on its own realm only', () => {
    const rosters = [roster('a', ['Fatty', 'Skinny'])];
    expect(rosterOf(rosters, 'Skinny Inc', 'skinny')?.id).toBe('a');
    expect(rosterOf(rosters, 'Paradigm', 'Skinny')).toBeNull();
    expect(rosterOf(rosters, 'Skinny Inc', null)).toBeNull();
  });
});

describe('the rosters kept (PartyBook)', () => {
  it('keeps a roster across a restart, and tells every window', () => {
    const seen: PartyRoster[][] = [];
    const { book: first, file } = book((rosters) => seen.push(rosters));
    first.save(roster('a', ['Fatty', 'Skinny', 'healbot']));
    expect(seen).toHaveLength(1);
    const again = new PartyBook({ file });
    expect(again.all.map((r) => r.members.map((m) => m.name))).toEqual([
      ['Fatty', 'Skinny', 'healbot']
    ]);
  });

  it('moves a member out of another roster on the same realm, and drops a roster left empty', () => {
    const { book: kept } = book();
    kept.save(roster('a', ['Fatty', 'Skinny']));
    kept.save(roster('b', ['Archer']));
    kept.save(roster('c', ['Skinny', 'Archer']));
    expect(kept.all.map((r) => [r.id, r.members.map((m) => m.name), r.leader])).toEqual([
      ['a', ['Fatty'], 'Fatty'],
      ['c', ['Skinny', 'Archer'], 'Skinny']
    ]);
  });

  it('leaves another realm’s roster alone', () => {
    const { book: kept } = book();
    kept.save(roster('a', ['Fatty'], { realm: 'Paradigm' }));
    kept.save(roster('b', ['Fatty']));
    expect(kept.all).toHaveLength(2);
  });

  it('marks a member who said @forget, once, and only on their realm', () => {
    const seen: PartyRoster[][] = [];
    const { book: kept } = book((rosters) => seen.push(rosters));
    kept.save(roster('a', ['Fatty', 'Skinny']));
    kept.forget('Skinny Inc', 'skinny');
    kept.forget('Skinny Inc', 'Skinny');
    kept.forget('Paradigm', 'Fatty');
    expect(kept.all[0]!.forgotten).toEqual(['Skinny']);
    expect(seen).toHaveLength(2);
  });

  it('removes a roster, and one saved with nobody in it', () => {
    const { book: kept } = book();
    kept.save(roster('a', ['Fatty']));
    kept.save(roster('b', ['Archer']));
    kept.remove('a');
    kept.save(roster('b', []));
    expect(kept.all).toEqual([]);
  });

  it('writes nothing over a file it could not read', () => {
    const { file } = book();
    fs.writeFileSync(file, '{ not json');
    const notices: string[] = [];
    const kept = new PartyBook({ file, notify: (message) => notices.push(message) });
    kept.save(roster('a', ['Fatty']));
    expect(notices).toHaveLength(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
  });
});
