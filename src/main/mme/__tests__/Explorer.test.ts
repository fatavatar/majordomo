import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  explorerDetail,
  explorerGear,
  explorerList,
  explorerWear,
  type MmeRealm
} from '../Explorer';
import { EMPTY_CHARACTER, type CharacterState } from '../../../shared/character';
import type { ExplorerSegment } from '../../../shared/explorer';

/*
 * mudtool's pinned v1.11p export (`vendor/fixtures`), which its own tests'
 * expected values were worked out against by hand from MME's code: the same
 * records give the same answers here.
 */
const FIXTURE = path.join(__dirname, '..', 'vendor', 'fixtures', 'v1.11p');
const read = (file: string): unknown =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURE, `${file}.gz`))).toString('utf8'));
const manifest = read('manifest.json') as { tables: Record<string, { file: string }> };

function fixture(over: { legit?: number } = {}): MmeRealm {
  return {
    key: `fixture:${over.legit ?? ''}`,
    async read(name) {
      const entry = manifest.tables[name];
      if (entry === undefined) return null;
      const table = read(entry.file) as { cols: string[]; rows: unknown[][] };
      if (name !== 'Info' || over.legit === undefined) return table;
      const at = table.cols.indexOf('Legit');
      return {
        ...table,
        rows: table.rows.map((row) => row.map((v, i) => (i === at ? over.legit : v)))
      };
    }
  };
}

function character(over: Partial<CharacterState> = {}): CharacterState {
  const base = structuredClone(EMPTY_CHARACTER);
  return {
    ...base,
    name: 'Archer',
    className: 'Warrior',
    race: 'Human',
    progress: { ...base.progress, level: 50, strength: 60, agility: 50 },
    ...over
  };
}

const plain = (runs: ExplorerSegment[]): string => runs.map((run) => run.text).join('');

describe('MMUD Explorer for the character being played', () => {
  it('lists every weapon, with whether this character can use it', async () => {
    const warrior = await explorerList(fixture(), character(), 'weapons');
    expect(warrior.supported).toBe(true);
    const longsword = warrior.rows.find((row) => row.number === 64);
    expect(longsword).toMatchObject({ name: 'longsword', usable: true });
    expect(longsword?.facts.type).toBe('1H Sharp');
    // MME's own column, as mudtool's test pins it: no backstab with it.
    expect(longsword?.cells['bs']).toBe(-10);
    // A Thief (any 1H) cannot swing a greatsword, which no class list opens to it.
    const thief = await explorerList(fixture(), character({ className: 'Thief' }), 'weapons');
    expect(thief.rows.find((row) => row.number === 78)).toMatchObject({
      name: 'greatsword',
      usable: false,
      facts: { type: '2H Sharp' }
    });
    expect(warrior.rows.find((row) => row.number === 78)?.usable).toBe(true);
  });

  it('lists armour with its slot and MME’s AC column', async () => {
    const list = await explorerList(fixture(), character(), 'armour');
    const vest = list.rows.find((row) => row.number === 332);
    expect(vest).toMatchObject({ name: 'padded vest', facts: { slot: 'Torso' } });
    // Shown as MME prints it, sorted by MME's tag: AC, then DR.
    expect(vest?.shown?.['acdr']).toBe('6/0.1');
    expect(vest?.cells['acdr']).toBe(60 * 100000 + 1);
  });

  /* mudtool's whole Weapons set: its fourteen and the six combat columns its hook adds. */
  it('gives the Weapons list every column mudtool draws, in its order', async () => {
    const list = await explorerList(fixture(), character(), 'weapons');
    expect(list.columns.map((column) => column.id)).toEqual([
      'Number',
      'Name',
      'WeaponType',
      'Min',
      'Max',
      'Speed',
      'level',
      'StrReq',
      'Encum',
      'ac',
      'acc',
      'bs',
      'crits',
      'Limit',
      'dmgspd',
      'swings',
      'xswings',
      'extra',
      'dmgrnd',
      'dmg1st'
    ]);
    expect(list.abilities.length).toBeGreaterThan(100);
    const longsword = list.rows.find((row) => row.number === 64)!;
    expect(typeof longsword.cells['dmgrnd']).toBe('number');
    expect(longsword.facts.roundTotal).toBe(longsword.cells['dmgrnd']);
  });

  it('marks what the character wears, slotted by MME’s own rule', async () => {
    const state = character();
    state.inventory = {
      ...state.inventory,
      items: [
        {
          name: 'padded vest',
          source: 'wire',
          slot: 'Torso',
          equipped: true,
          charges: null,
          row: { id: 332 }
        } as CharacterState['inventory']['items'][number]
      ]
    };
    const list = await explorerList(fixture(), state, 'armour');
    expect(list.rows.find((row) => row.number === 332)?.worn).toBe(true);
    expect(list.rows.filter((row) => row.worn)).toHaveLength(1);
  });

  it('writes an item’s detail as MME does, its references kept', async () => {
    const detail = await explorerDetail(fixture(), character(), 64);
    expect(detail?.name).toBe('longsword');
    expect(plain(detail!.text).length).toBeGreaterThan(0);
    expect(detail!.refs.length).toBeGreaterThan(0);
  });

  it('answers a GreaterMUD realm unsupported rather than computing it wrong', async () => {
    const list = await explorerList(fixture({ legit: 2 }), character(), 'weapons');
    expect(list).toEqual({ supported: false, columns: [], rows: [], abilities: [] });
  });

  /* Buy + Wear: MME's slot for it, and what comes off for it (2026-10-18). */
  it('says what comes off to wear an item, a two-handed weapon and a shield giving way', async () => {
    const wearing = (worn: Array<[number, string]>): CharacterState => {
      const base = character();
      return {
        ...base,
        inventory: {
          ...base.inventory,
          items: worn.map(([id, name]) => ({ id, name, equipped: true }))
        }
      } as unknown as CharacterState;
    };
    const armed = wearing([
      [64, 'longsword'],
      [370, 'tower shield'],
      [332, 'padded vest']
    ]);
    expect(await explorerWear(fixture(), armed, 336)).toEqual({ wearable: true, remove: [] });
    expect(await explorerWear(fixture(), armed, 64)).toEqual({ wearable: true, remove: [] });
    expect(await explorerWear(fixture(), armed, 47)).toEqual({
      wearable: true,
      remove: ['tower shield']
    });
    expect(await explorerWear(fixture(), armed, 78)).toEqual({
      wearable: true,
      remove: ['longsword', 'tower shield']
    });
    const twoHanded = wearing([[78, 'greatsword']]);
    expect(await explorerWear(fixture(), twoHanded, 370)).toEqual({
      wearable: true,
      remove: ['greatsword']
    });
    expect(await explorerWear(fixture(), armed, 1008)).toEqual({ wearable: false, remove: [] });
  });

  /* The Gear card: MME's Find Best, each slot beside what is worn (2026-10-18). */
  it('finds the best of each slot by the criterion, beside what is worn', async () => {
    const base = character();
    const vested = {
      ...base,
      inventory: {
        ...base.inventory,
        items: [{ id: 332, name: 'padded vest', equipped: true }]
      }
    } as unknown as CharacterState;
    const options = { criterion: 0, noLimited: false, soldOnly: false };
    const board = await explorerGear(fixture(), vested, options, () => true);
    expect(board.criteria[0]).toEqual(['Armour', 'AC/DR Combo']);
    expect(board.criteria.some(([, label]) => label === 'VileWard')).toBe(false);
    const torso = board.slots.find((slot) => slot.label === 'Torso');
    expect(torso?.worn).toMatchObject({ number: 332, name: 'padded vest', value: 61 });
    expect(torso?.best?.value).toBeGreaterThan(61);
    // Kept to what a counter stocks, the vest, sold nowhere here, stays the best.
    const sold = await explorerGear(fixture(), vested, { ...options, soldOnly: true }, () => false);
    expect(sold.slots.find((slot) => slot.label === 'Torso')?.best?.number).toBe(332);
  });
});
