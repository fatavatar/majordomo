import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  explorerCompare,
  explorerDetail,
  explorerEq,
  explorerFind,
  explorerItems,
  explorerEqBest,
  explorerEqWear,
  explorerGear,
  explorerList,
  explorerRoomSearch,
  explorerRoomTip,
  explorerRoomView,
  explorerWear,
  type MmeRealm
} from '../Explorer';
import { EMPTY_CHARACTER, type CharacterState } from '../../../shared/character';
import {
  DEFAULT_EQ_PLAN,
  DEFAULT_EXPLORER_OPTIONS,
  DEFAULT_ROOM_MAP_OPTIONS,
  type ExplorerSegment
} from '../../../shared/explorer';

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
    const detail = await explorerDetail(fixture(), character(), 'weapons', 64);
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

  /*
   * The EQ tab (2026-10-19): MME's equipment page for the character as the
   * game reports it — the vest worn, a longsword in the pack, 500 the
   * reported encumbrance — and a plan picked over it.
   */
  describe('the EQ tab', () => {
    const base = character();
    const packed = {
      ...base,
      inventory: {
        ...base.inventory,
        encumbrance: 500,
        items: [
          { id: 332, name: 'padded vest', equipped: true },
          { id: 64, name: 'longsword', equipped: false }
        ]
      }
    } as unknown as CharacterState;
    const planned = (equipped: Record<number, number>) => ({
      ...DEFAULT_EQ_PLAN,
      equipped: Array.from({ length: 20 }, (_, x) => equipped[x] ?? 0)
    });

    it('opens on what is worn, the pack weighed at what the game reports', async () => {
      const page = await explorerEq(fixture(), packed, DEFAULT_EQ_PLAN);
      expect(page.supported).toBe(true);
      const torso = page.slots.find((slot) => slot.label === 'Torso');
      expect(torso).toMatchObject({ chosen: 332, worn: 332, carried: true });
      expect(page.encumbrance.now).toBe(500);
      expect(page.packWeight).toBeGreaterThan(0);
      expect(page.left.map((stat) => stat.label)).toContain('Accuracy');
      expect(page.criteria[0]).toEqual(['Armour', 'AC/DR Combo']);
    });

    it('moves the longsword from the pack to the hand, the weight the same', async () => {
      const page = await explorerEq(fixture(), packed, planned({ 4: 332, 16: 64 }));
      expect(page.slots[16]).toMatchObject({ chosen: 64, worn: 0, carried: true });
      expect(page.encumbrance.now).toBe(500);
      const wear = await explorerEqWear(fixture(), packed, planned({ 4: 332, 16: 64 }));
      expect(wear).toEqual({ commands: ['eq longsword'], buy: [] });
    });

    it('names what the pack lacks for Buy + Wear, and sends nothing for it', async () => {
      const wear = await explorerEqWear(fixture(), packed, planned({ 4: 332, 16: 78 }));
      expect(wear.commands).toEqual([]);
      expect(wear.buy).toEqual([{ number: 78, name: 'greatsword' }]);
      const page = await explorerEq(fixture(), packed, planned({ 4: 332, 16: 78 }));
      expect(page.slots[16]?.carried).toBe(false);
    });

    it('finds better than the vest, and keeps a held slot', async () => {
      const found = await explorerEqBest(fixture(), packed, planned({ 4: 332 }), {
        criterion: 0,
        next: false,
        noLimited: false
      });
      expect(found.found).toBe(true);
      expect(found.equipped[4]).not.toBe(332);
      const held = await explorerEqBest(
        fixture(),
        packed,
        { ...planned({ 4: 332 }), holds: Array.from({ length: 20 }, (_, x) => x === 4) },
        { criterion: 0, next: false, noLimited: false }
      );
      expect(held.equipped[4]).toBe(332);
    });

    it('adds a manual adjustment to its figure', async () => {
      const before = await explorerEq(fixture(), packed, DEFAULT_EQ_PLAN);
      const adjustments = DEFAULT_EQ_PLAN.adjustments.map((v, i) => (i === 10 ? 5 : v));
      const after = await explorerEq(fixture(), packed, { ...DEFAULT_EQ_PLAN, adjustments });
      const accuracy = (page: typeof before) => page.left.find((stat) => stat.i === 10)!;
      expect(accuracy(after).adjusted).toBe(true);
      expect(Number(accuracy(after).text.replace('+', ''))).toBe(
        Number(accuracy(before).text.replace('+', '')) + 5
      );
    });
  });

  /* The Lists tab (2026-10-19): mudtool's compare lists, the picker and the Item Manager's columns. */
  describe('the Lists tab', () => {
    it('lists the weapons asked for, with mudtool’s compare columns', async () => {
      const list = await explorerCompare(fixture(), character(), 'weapons', [64, 78, 999999]);
      expect(list.columns.map((column) => column.label)).toEqual([
        '#',
        'Name',
        'Type',
        'Min-Max',
        'Speed',
        'Accy',
        'Str',
        'Enc',
        'AC/DR',
        '#Swings',
        'Dmg/Rnd'
      ]);
      expect(list.rows.map((row) => row.name)).toEqual(['longsword', 'greatsword']);
      expect(list.rows[0]?.cells['type']).toBe('1H Sharp');
      expect(Number(list.rows[0]?.cells['swings'])).toBeGreaterThan(0);
      // A Thief cannot swing the greatsword.
      const thief = await explorerCompare(
        fixture(),
        character({ className: 'Thief' }),
        'weapons',
        [78]
      );
      expect(thief.rows[0]?.usable).toBe(false);
    });

    it('offers matches for a number or a name, weapons only on the weapons list', async () => {
      expect((await explorerFind(fixture(), 'weapons', '64'))[0]).toEqual([64, 'longsword']);
      const swords = await explorerFind(fixture(), 'weapons', 'sword');
      expect(swords.some(([, name]) => name === 'longsword')).toBe(true);
      expect((await explorerFind(fixture(), 'armour', 'longsword')).length).toBe(0);
    });

    it('gives the Item Manager’s columns, by number or by a rule’s name', async () => {
      const facts = await explorerItems(fixture(), character(), [64], ['Padded Vest']);
      expect(facts.map((fact) => fact.name)).toEqual(['longsword', 'padded vest']);
      expect(facts[0]).toMatchObject({ type: 'Weapon', worn: '1H Sharp', usable: true });
      expect(facts[1]).toMatchObject({ type: 'Armour', worn: 'Torso' });
    });
  });

  /* The Spells tab: mudtool's columns, its filter, the book (2026-10-18). */
  it('lists spells with mudtool’s columns, the book’s marked', async () => {
    const mage = character({
      className: 'Mage',
      spellbook: [{ name: 'fireball' }] as unknown as CharacterState['spellbook']
    });
    const list = await explorerList(fixture(), mage, 'spells');
    expect(list.columns.map((column) => column.id)).toEqual([
      'Number',
      'Name',
      'Short',
      'Magery',
      'ReqLevel',
      'mana',
      'diff',
      'dmg',
      'dmgm',
      'heal',
      'healm',
      'detail'
    ]);
    const fireball = list.rows.find((row) => row.name === 'fireball')!;
    expect(fireball).toMatchObject({ usable: true, worn: true });
    expect(fireball.shown?.['diff']).toMatch(/^\d+%$/);
    const detail = await explorerDetail(fixture(), mage, 'spells', fireball.number);
    expect(plain(detail!.text)).toContain('Target: ');
  });

  /*
   * What mudtool's own `spell filters (FilterSpells)` test reads of fireball,
   * as main sends it; the window's filter is tested on these facts
   * (`renderer/src/lib/__tests__/explorer.test.ts`).
   */
  it('gives the Spells filter fireball’s facts as FilterSpells reads them', async () => {
    const list = await explorerList(fixture(), character({ className: 'Priest' }), 'spells');
    const fireball = list.rows.find((row) => row.name === 'fireball')!;
    expect(fireball.spell).toMatchObject({ magery: 1, attType: 1, targets: 12 });
    expect(fireball.facts.abilities.some(([abil]) => abil === 17)).toBe(true);
    expect(fireball.facts.abilities.some(([abil]) => abil === 1)).toBe(false);
    // A Priest cannot cast it.
    expect(fireball.usable).toBe(false);
  });

  /* The Shops tab, and references that say which tab opens them (2026-10-18). */
  it('lists shops, a trainer fitting by class and level, a shelf whose items link', async () => {
    const list = await explorerList(fixture(), character({ className: 'Warrior' }), 'shops');
    expect(list.columns.map((column) => column.id)).toEqual(['Number', 'Name', 'ShopType']);
    // `Leave this blank` is not listed, as MME leaves it out.
    expect(list.rows.some((row) => row.name === 'Leave this blank')).toBe(false);
    const school = list.rows.find((row) => row.number === 14)!;
    expect(school.shop).toEqual({ type: 8, trainerFits: false });
    const novice = character({
      className: 'Warrior',
      progress: { ...character().progress, level: 5 }
    });
    const forNovice = await explorerList(fixture(), novice, 'shops');
    expect(forNovice.rows.find((row) => row.number === 14)?.shop?.trainerFits).toBe(true);

    const swords = await explorerDetail(fixture(), character(), 'shops', 5);
    expect(swords?.stock?.trainer).toBe(false);
    expect(swords?.stock?.rows[0]).toMatchObject({ tab: 'weapons' });
    // Located in Room 1/355, a link to the Rooms tab.
    const room = swords!.refs.flatMap((ref) => ref.text).find((run) => 'kind' in run);
    expect(room).toMatchObject({ kind: 'room', n: '1/355', tab: 'rooms' });
  });

  /* The Rooms tab: MME's map from Newhaven's entrance, its references, its finders. */
  it('draws MME’s map from a room, with its compass, the character’s room and its finders', async () => {
    const standing = character({
      room: { ...character().room, map: 1, number: 2141 }
    });
    const request = {
      map: 1,
      room: 2140,
      size: 'main',
      options: DEFAULT_ROOM_MAP_OPTIONS,
      center: null
    };
    const view = await explorerRoomView(fixture(), standing, request);
    expect(view).toMatchObject({ found: true, name: 'Newhaven, Village Entrance', here: '1/2141' });
    expect(view.grid?.cells).toHaveLength(30 * 23);
    expect(view.grid?.cells[view.grid.center]).toMatchObject({ map: 1, room: 2140 });
    expect(view.compass.find((exit) => exit.dir === 'N')?.target).toBe('1/2141');
    // Drawn as the client's maps draw (2026-10-18): each corridor once, from one end.
    const grid = view.grid!;
    const step: Record<string, number> = {
      n: -grid.cols,
      s: grid.cols,
      e: 1,
      w: -1,
      ne: 1 - grid.cols,
      nw: -1 - grid.cols,
      se: 1 + grid.cols,
      sw: -1 + grid.cols
    };
    const corridors = grid.cells.flatMap((cell, i) =>
      cell === null ? [] : cell.links.map((link) => [i, i + step[link.dir]!].sort().join('-'))
    );
    expect(corridors.length).toBeGreaterThan(0);
    expect(new Set(corridors).size).toBe(corridors.length);
    const junkyard = await explorerRoomView(fixture(), standing, { ...request, room: 39 });
    expect(junkyard.grid!.cells[junkyard.grid!.center]).toMatchObject({
      map: 1,
      room: 39,
      kind: 'shop'
    });
    expect(view.info).toContain('Newhaven, Village Entrance (1/2140)');
    expect(await explorerRoomTip(fixture(), standing, 1, 2141, DEFAULT_ROOM_MAP_OPTIONS)).toContain(
      '(1/2141)'
    );

    const found = await explorerRoomSearch(fixture(), standing, { find: 'Junkyard', after: null });
    expect(found.room).toBe('1/39');
    const listed = await explorerRoomSearch(fixture(), standing, { list: 'junkyard' });
    expect(listed.lines?.[0]?.place).toEqual({ tab: 'rooms', n: '1/39' });
    const leads = await explorerRoomSearch(fixture(), standing, { leads: '1/2141' });
    expect(leads.lines?.some((line) => line.place?.n === '1/2140')).toBe(true);
    // A room the realm has not: no map, said so.
    expect((await explorerRoomView(fixture(), standing, { ...request, room: 32000 })).found).toBe(
      false
    );
  });

  /* The rest of MME's tabs (2026-10-18): Sundry, Monsters, Class/Race. */
  it('lists sundry items, a chest’s contents linked, and links an unworn item there', async () => {
    const list = await explorerList(fixture(), character(), 'sundry');
    expect(list.columns.map((column) => column.id)).toEqual([
      'Number',
      'Name',
      'ItemType',
      'Encum',
      'Limit'
    ]);
    // MME applies no global filter to Sundry.
    expect(list.rows.every((row) => row.usable)).toBe(true);
    expect(list.rows.some((row) => row.number === 1008)).toBe(true);
    const box = await explorerDetail(fixture(), character(), 'sundry', 906);
    expect(box?.chest?.length).toBeGreaterThan(0);
    expect(box?.chest?.[0]?.tab).not.toBeNull();
    expect(box?.sub).toMatch(/^#906 · /);
  });

  it('lists monsters by mob and by lair, with MME’s columns and what its filter reads', async () => {
    const byMob = await explorerList(fixture(), character(), 'monsters');
    expect(byMob.columns.map((column) => column.id)).toContain('exphr');
    expect(byMob.lairs).toBe(true);
    const rogue = byMob.rows.find((row) => row.name === 'orc rogue')!;
    expect(rogue.monster).toMatchObject({ hp: 30, exp: 22, coins: [20, 10, 0, 0, 0] });
    const byLair = await explorerList(fixture(), character(), 'monsters', {
      ...DEFAULT_EXPLORER_OPTIONS,
      byLair: true
    });
    // By lair the lair's averages: HP and damage over its spawns, the damage marked.
    const lairRogue = byLair.rows.find((row) => row.name === 'orc rogue')!;
    expect(lairRogue.shown?.['dmg']).toMatch(/\*$/);
    const detail = await explorerDetail(fixture(), character(), 'monsters', rogue.number);
    expect(detail?.table?.[0]?.label.map((run) => run.text).join('')).toBe('Experience');
  });

  it('lists classes and races, a race’s stats toned, and builds a class with a race', async () => {
    const classes = await explorerList(fixture(), character(), 'classes');
    expect(classes.rows.find((row) => row.name === 'Warrior')?.cells['abilities']).toBe('Bash');
    const races = await explorerList(fixture(), character(), 'races');
    expect(races.rows.some((row) => row.tones !== undefined)).toBe(true);
    const warrior = classes.rows.find((row) => row.name === 'Warrior')!;
    const built = await explorerDetail(fixture(), character(), 'classes', warrior.number, {
      ...DEFAULT_EXPLORER_OPTIONS,
      builder: true
    });
    expect(built?.races?.length).toBeGreaterThan(0);
    expect(built?.text.map((run) => run.text).join('').length).toBeGreaterThan(0);
  });
});
