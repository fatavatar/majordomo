import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { homeAt, type Home } from '../../app/home';
import { ITEM_TABLE, RealmTableStore } from '../RealmTableStore';
import type { ItemRule, ItemTable } from '../../../shared/itemRules';

let root: string;
let home: Home;
let store: RealmTableStore<ItemTable>;
let errors: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-items-'));
  home = homeAt(root);
  fs.mkdirSync(home.server('paradigm').dir, { recursive: true });
  errors = [];
  store = new RealmTableStore(home, ITEM_TABLE, (message) => errors.push(message));
});

afterEach(() => {
  store.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

const potion: ItemRule = {
  item: 'healing potion',
  buy: true,
  mustHaveMin: true,
  keep: 5,
  shop: 'General Store'
};
const dagger: ItemRule = { item: 'rusty dagger', backstab: true, discard: true };

describe('RealmTableStore, the item table', () => {
  it('reads a realm with no file as an empty table', () => {
    expect(store.forServer('paradigm')).toEqual({ source: null, items: [] });
  });

  it('writes a table beside the realm and reads it back', () => {
    const source = { file: 'Items.md', importedAt: '2026-10-13T12:00:00.000Z' };
    expect(store.write('paradigm', { source, items: [potion, dagger] })).toEqual({ ok: true });
    expect(fs.existsSync(path.join(home.server('paradigm').dir, 'items.yaml'))).toBe(true);
    expect(store.forServer('paradigm')).toEqual({ source, items: [potion, dagger] });
  });

  it('says so, once, when the file does not parse, and reads as empty', () => {
    fs.writeFileSync(store.file('paradigm'), 'items: [unclosed\n');
    expect(store.forServer('paradigm').items).toEqual([]);
    expect(store.forServer('paradigm').items).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
