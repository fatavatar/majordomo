import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MegaLearned } from '../MegaLearned';
import type { RoomId } from '../../../shared/world';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mega-learned-'));
  file = path.join(dir, 'megamud-learned.json');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const PATTIE = { name: 'Krabby Pattie', weight: 2, slot: null, weapon: false };

describe('what the MegaMUD engine learned of items and rooms, kept between sessions', () => {
  it('is read back by realm after it is written', () => {
    const store = new MegaLearned({ file, saveDelayMs: 0 });
    store.keep('mudrev.mdb', { items: [PATTIE], signatures: [] });
    store.keep('mudrev.mdb', { items: [], signatures: [['1/9650' as RoomId, 0x36804010]] });
    store.flush();

    const again = new MegaLearned({ file });
    expect(again.forRealm('mudrev.mdb')).toEqual({
      items: [PATTIE],
      signatures: [['1/9650', 0x36804010]],
      marks: {}
    });
    expect(again.forRealm('paradigm')).toEqual({ items: [], signatures: [], marks: {} });
  });

  it("keeps each character's marked monsters, its list whole", () => {
    const store = new MegaLearned({ file, saveDelayMs: 0 });
    store.keep('r', { marks: { Skinny: [['sinister dragon', 0x80]] } });
    store.keep('r', { marks: { Fatty: [['kobold', 0x200]] } });
    store.keep('r', {
      marks: {
        Skinny: [
          ['sinister dragon', 0x80],
          ['slayer', 0x1000]
        ]
      }
    });
    store.flush();
    expect(new MegaLearned({ file }).forRealm('r').marks).toEqual({
      fatty: [['kobold', 0x200]],
      skinny: [
        ['sinister dragon', 0x80],
        ['slayer', 0x1000]
      ]
    });
  });

  it('keeps an item by name, the newer over the older', () => {
    const store = new MegaLearned({ file, saveDelayMs: 0 });
    store.keep('r', { items: [PATTIE], signatures: [] });
    store.keep('r', { items: [{ ...PATTIE, name: 'krabby pattie', weight: 3 }], signatures: [] });
    expect(store.forRealm('r').items.map((i) => i.weight)).toEqual([3]);
  });

  /* The first version, written 13 October 2026, kept MegaMUD's own records. */
  it('takes up the first version: items and signatures kept, stances handed on, players dropped', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        realms: {
          'mudrev.mdb': {
            monsters: [{ name: 'mutated dragon hatchling', relationship: 4 }],
            items: [{ name: 'Staff of the Undead', weight: 300, type: 1, location: 0 }],
            players: [{ name: 'Fatty' }],
            signatures: [['1/2', 7]]
          }
        }
      })
    );
    const store = new MegaLearned({ file, saveDelayMs: 0 });
    expect(store.forRealm('mudrev.mdb')).toEqual({
      items: [{ name: 'Staff of the Undead', weight: 300, slot: null, weapon: true }],
      signatures: [['1/2', 7]],
      marks: {}
    });
    expect(store.takeStances()).toEqual([
      { realm: 'mudrev.mdb', mob: 'mutated dragon hatchling', relationship: 'enemy' }
    ]);
    expect(store.takeStances()).toEqual([]);
    store.flush();
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(written.v).toBe(2);
    expect(Object.keys(written.realms['mudrev.mdb'])).toEqual(['items', 'signatures', 'marks']);
  });

  it('writes nothing over a file that will not parse, and says so', () => {
    fs.writeFileSync(file, '{ not json');
    const said: string[] = [];
    const store = new MegaLearned({ file, saveDelayMs: 0, notify: (m) => said.push(m) });
    store.keep('r', { items: [PATTIE], signatures: [] });
    store.flush();
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
    expect(said).toHaveLength(1);
  });
});
