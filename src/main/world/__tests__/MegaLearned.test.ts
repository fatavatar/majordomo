import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MegaLearned, type MegaLearnedData } from '../MegaLearned';
import type { MonsterRec, PlayerRec } from '../../megamud/data';
import type { RoomId } from '../../../shared/world';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mega-learned-'));
  file = path.join(dir, 'megamud-learned.json');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const hatchling = {
  layer: 0,
  name: 'mutated dragon hatchling',
  id: 10000,
  flags: 0x40000002,
  relationship: 4,
  exp: 63520,
  maxHp: 0,
  preSpell: '',
  attackSpell: '',
  preMax: 0,
  attackMax: 0
} satisfies MonsterRec;

const fatty = { name: 'Fatty', layer: 2, flags: 0, level: 64 } as PlayerRec;

function learned(over: Partial<MegaLearnedData> = {}): MegaLearnedData {
  return { monsters: [], items: [], players: [], signatures: [], ...over };
}

describe('what the MegaMUD engine learned, kept between sessions', () => {
  it('is read back by realm after it is written', () => {
    const store = new MegaLearned({ file, saveDelayMs: 0 });
    store.keep('mudrev.mdb', learned({ monsters: [hatchling], players: [fatty] }));
    store.keep('mudrev.mdb', learned({ signatures: [['1/9650' as RoomId, 0x36804010]] }));
    store.flush();

    const again = new MegaLearned({ file });
    const back = again.forRealm('mudrev.mdb');
    expect(back.monsters).toEqual([hatchling]);
    expect(back.players.map((p) => p.name)).toEqual(['Fatty']);
    expect(back.signatures).toEqual([['1/9650', 0x36804010]]);
    expect(again.forRealm('paradigm').monsters).toEqual([]);
  });

  it('keeps a record by name, the newer over the older', () => {
    const store = new MegaLearned({ file, saveDelayMs: 0 });
    store.keep('r', learned({ monsters: [hatchling] }));
    store.keep(
      'r',
      learned({ monsters: [{ ...hatchling, name: 'Mutated Dragon Hatchling', exp: 1 }] })
    );
    expect(store.forRealm('r').monsters.map((m) => m.exp)).toEqual([1]);
  });

  it('forgets a player MegaMUD removed', () => {
    const store = new MegaLearned({ file, saveDelayMs: 0 });
    store.keep('r', learned({ players: [fatty] }));
    store.keep('r', learned({ removedPlayers: ['fatty'] }));
    expect(store.forRealm('r').players).toEqual([]);
  });

  it('writes nothing over a file that will not parse, and says so', () => {
    fs.writeFileSync(file, '{ not json');
    const said: string[] = [];
    const store = new MegaLearned({ file, saveDelayMs: 0, notify: (m) => said.push(m) });
    store.keep('r', learned({ monsters: [hatchling] }));
    store.flush();
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
    expect(said).toHaveLength(1);
  });
});
