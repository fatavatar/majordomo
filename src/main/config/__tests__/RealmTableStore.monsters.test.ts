import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { homeAt, type Home } from '../../app/home';
import { MONSTER_TABLE, RealmTableStore } from '../RealmTableStore';
import type { MonsterRule, MonsterTable } from '../../../shared/monsterRules';

let root: string;
let home: Home;
let store: RealmTableStore<MonsterTable>;
let errors: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-monsters-'));
  home = homeAt(root);
  fs.mkdirSync(home.server('paradigm').dir, { recursive: true });
  errors = [];
  store = new RealmTableStore(home, MONSTER_TABLE, (message) => errors.push(message));
});

afterEach(() => {
  store.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

const ooze: MonsterRule = { mob: 'gigantic black ooze', relationship: 'escape', priority: 'high' };
const lich: MonsterRule = {
  mob: 'lich',
  noBackstab: true,
  preAttack: { spell: 'dspl', max: 1 },
  attack: { spell: 'turn', max: 0 }
};

describe('RealmTableStore, the monster table', () => {
  it('reads a realm with no file as an empty table', () => {
    expect(store.forServer('paradigm')).toEqual({ source: null, monsters: [] });
  });

  it('writes a table beside the realm and reads it back', () => {
    const source = { file: 'Monsters.md', importedAt: '2026-09-23T12:00:00.000Z' };
    expect(store.write('paradigm', { source, monsters: [ooze, lich] })).toEqual({ ok: true });
    expect(fs.existsSync(path.join(home.server('paradigm').dir, 'monsters.yaml'))).toBe(true);
    expect(store.forServer('paradigm')).toEqual({ source, monsters: [ooze, lich] });
  });

  /* A spell with no cap is the bare word, which is what a person would type. */
  it('writes an uncapped spell as its bare name', () => {
    store.write('paradigm', { source: null, monsters: [lich] });
    const text = fs.readFileSync(store.file('paradigm'), 'utf8');
    expect(text).toMatch(/attack: turn\n/);
    expect(text).toMatch(/spell: dspl/);
  });

  /* A same-length edit in the mtime tick the table was cached in is still an edit (2026-10-18). */
  it('reads a hand edit of the same length made in the tick the table was read in', () => {
    const tick = Math.floor(Date.now() / 1000);
    const file = store.file('paradigm');
    fs.writeFileSync(file, 'monsters:\n  - mob: lich\n    relationship: escape\n');
    fs.utimesSync(file, tick, tick);
    expect(store.forServer('paradigm').monsters[0]?.mob).toBe('lich');
    fs.writeFileSync(file, 'monsters:\n  - mob: orcs\n    relationship: escape\n');
    fs.utimesSync(file, tick, tick);
    expect(store.forServer('paradigm').monsters[0]?.mob).toBe('orcs');
  });

  it('says so, once, when the file does not parse, and reads as empty', () => {
    fs.writeFileSync(store.file('paradigm'), 'monsters: [unclosed\n');
    expect(store.forServer('paradigm').monsters).toEqual([]);
    expect(store.forServer('paradigm').monsters).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
