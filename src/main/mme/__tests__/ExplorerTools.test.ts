import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { explorerTool } from '../ExplorerTools';
import type { MmeRealm } from '../Explorer';
import { EMPTY_CHARACTER, type CharacterState } from '../../../shared/character';
import { asToolRequest, type SwingInput } from '../../../shared/explorerTools';

/* The Tools tab's calculators (2026-10-19), on mudtool's pinned v1.11p export. */
const FIXTURE = path.join(__dirname, '..', 'vendor', 'fixtures', 'v1.11p');
const read = (file: string): unknown =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURE, `${file}.gz`))).toString('utf8'));
const manifest = read('manifest.json') as { tables: Record<string, { file: string }> };
const realm: MmeRealm = {
  key: 'fixture:tools',
  async read(name) {
    const entry = manifest.tables[name];
    return entry === undefined ? null : (read(entry.file) as { cols: string[]; rows: unknown[][] });
  }
};

function warrior(over: Partial<CharacterState> = {}): CharacterState {
  const base = structuredClone(EMPTY_CHARACTER);
  return {
    ...base,
    name: 'Archer',
    className: 'Warrior',
    race: 'Human',
    progress: { ...base.progress, level: 50, strength: 60, agility: 50, charm: 40 },
    inventory: {
      ...base.inventory,
      items: [{ id: 64, name: 'longsword', equipped: true }]
    } as unknown as CharacterState['inventory'],
    ...over
  };
}

describe('the Tools tab', () => {
  it('opens on the character, with the pickers’ records', async () => {
    const start = await explorerTool(realm, warrior(), { tool: 'start' });
    expect(start.supported).toBe(true);
    expect(start.profile).toMatchObject({ level: 50, str: 60, agi: 50, weapon: 64 });
    expect(start.profile.accuracy).toBeGreaterThan(0);
    expect(start.weapons.some(([n]) => n === 64)).toBe(true);
    expect(start.bsWeapons.length).toBeGreaterThan(0);
    expect(start.monsters.length).toBeGreaterThan(0);
  });

  it('works out a swing table, and a true average from MegaMUD’s figures', async () => {
    const input: SwingInput = {
      weapon: 64,
      combat: 3,
      level: 50,
      agi: 50,
      str: 60,
      encum: 500,
      maxEncum: 2880,
      speed: 1,
      customSpeed: 100,
      slow: false,
      bash: false,
      tru: { hitP: 60, hitA: 20, extraP: 0, extraA: 0, critP: 5, critA: 60 },
      swings: null
    };
    const out = await explorerTool(realm, warrior(), { tool: 'swing', input });
    expect(out.found).toBe(true);
    expect(out.rounds).toHaveLength(10);
    expect(out.rawSwings).toBeGreaterThan(0);
    expect(out.roundTotal).toBeGreaterThan(0);
    expect(out.trueAverage).toBeGreaterThan(0);
  });

  it('gives a hit rate between the caps', async () => {
    const out = await explorerTool(realm, warrior(), {
      tool: 'hit',
      input: {
        backstab: false,
        accy: 100,
        ac: 20,
        dodge: 10,
        protEv: 0,
        vileWard: 0,
        perception: 0,
        evil: 0,
        shadow: false,
        seeHidden: false,
        vsPlayer: false,
        cls: 0
      }
    });
    expect(out.hit).toBeGreaterThanOrEqual(out.minHit);
    expect(out.hit).toBeLessThanOrEqual(out.maxHit);
    expect(out.overall).toBeLessThanOrEqual(out.hit);
  });

  it('works out a backstab, and lists the exp and the spell book', async () => {
    const start = await explorerTool(realm, warrior(), { tool: 'start' });
    const bs = await explorerTool(realm, warrior(), {
      tool: 'backstab',
      input: {
        weapon: start.bsWeapons[0]![0],
        level: 50,
        stealth: 100,
        maxDmg: 0,
        bsMin: 0,
        bsMax: 0,
        str: 60,
        classStealth: true
      }
    });
    expect(bs?.noBS).toBe(false);
    expect(bs!.min).toBeLessThanOrEqual(bs!.max);
    const exp = await explorerTool(realm, warrior(), {
      tool: 'exp',
      start: 2,
      end: 10,
      chart: 100
    });
    expect(exp.rows.map((row) => row.level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const coin = await explorerTool(realm, warrior(), {
      tool: 'coin',
      amount: 1,
      from: 100,
      to: 1
    });
    expect(coin.amount).toBe(100);
    const mage = warrior({
      className: 'Mage',
      spellbook: [{ name: 'magic missile' }] as unknown as CharacterState['spellbook']
    });
    const mageStart = await explorerTool(realm, mage, { tool: 'start' });
    const book = await explorerTool(realm, mage, {
      tool: 'spellbook',
      cls: mageStart.profile.cls,
      level: 50,
      align: 0
    });
    expect(book.length).toBeGreaterThan(0);
    expect(book.find((row) => row.name === 'magic missile')?.learned).toBe(true);
  });

  it('runs a monster’s attacks against the character’s defences', async () => {
    const start = await explorerTool(realm, warrior(), { tool: 'start' });
    const sim = await explorerTool(realm, warrior(), {
      tool: 'attacksim',
      input: {
        monster:
          start.monsters.find(([, name]) => name === 'giant rat')?.[0] ?? start.monsters[0]![0],
        rounds: 200,
        dynamic: false,
        maxRoundOnly: true,
        hideEnergy: false,
        def: {
          ac: 0,
          dr: 0,
          mr: 50,
          dodge: 0,
          protEvil: 0,
          rsto: 0,
          rcol: 0,
          rwat: 0,
          rfir: 0,
          rlit: 0
        },
        antiMagic: false,
        megaDodge: false
      }
    });
    expect(sim.rounds).toBe(200);
  });

  it('parses a request off the wire, and refuses one it does not know', () => {
    expect(asToolRequest({ tool: 'coin', amount: 2, from: 'x', to: 1 })).toEqual({
      tool: 'coin',
      amount: 2,
      from: 1,
      to: 1
    });
    expect(asToolRequest({ tool: 'rm -rf' })).toBeNull();
    expect(asToolRequest(null)).toBeNull();
  });
});
