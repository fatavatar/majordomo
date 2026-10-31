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
  explorerHunting,
  explorerList,
  explorerRoomSearch,
  explorerRoomTip,
  explorerRoom,
  explorerRoomView,
  explorerTextblock,
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

  // 2026-10-31: MR takes its share off a damage spell's casts; resisting outright is for the rest.
  it('reduces a damage spell against MR, and never resists it outright', async () => {
    const priest = character({ className: 'Priest' });
    const vs = { ...DEFAULT_EXPLORER_OPTIONS, mrCalc: true, vsMR: 80 };
    const harm = await explorerDetail(fixture(), priest, 'spells', 12, vs);
    const text = plain(harm!.text);
    expect(text).toContain('resisted');
    expect(text).not.toContain('fully-resist');
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

/* MME's textblocks pulled in (2026-10-24): frmResults, as mudtool's Rooms tab has it. */
describe('a textblock as MMUD Explorer shows it', () => {
  const asked = (n: number) =>
    explorerTextblock(fixture(), { n, mode: 'plain', hideTB: false, defaultMap: 1 });

  it('says what it does, line by line, its items links', async () => {
    const tb = await asked(2944);
    expect(tb.found).toBe(true);
    expect(tb.raw.startsWith('3:message 1428:giveitem 905')).toBe(true);
    const line = tb.command.kids[0]!;
    expect(line.kids.map((kid) => kid.place)).toContainEqual({ tab: 'sundry', n: 905 });
  });

  it('says what runs it, and where it is called from, as links', async () => {
    const tb = await asked(2944);
    expect(tb.executed.kids[0]!.place).toEqual({ tab: 'textblock', n: 2943 });
    expect(tb.calledFrom?.find((run) => 'kind' in run)).toMatchObject({
      kind: 'textblock',
      n: 2943,
      tab: 'textblock'
    });
  });

  it('answers a block the realm does not hold as not found', async () => {
    const tb = await asked(999999);
    expect([tb.supported, tb.found]).toEqual([true, false]);
  });

  /*
   * Dhelvanen's (2026-10-25): frmResults printed `levelcheck`, `minlevel 20
   * 2614` and `message 2639` as the realm wrote them, where they are the
   * server's filler, a level gate refused with block 2614's words, and block
   * 2639's words shown.
   */
  const words = (node: { text: ExplorerSegment[] }): string =>
    node.text.map((run) => run.text).join('');

  it('reads the steps frmResults leaves as written, the blocks they show linked', async () => {
    const tb = await asked(9022);
    expect(tb.command.kids.map(words)).toEqual(['Min level: 20', 'Text, words of: Textblock 9024']);
    expect(tb.command.kids[1]!.text.at(-1)).toMatchObject({
      kind: 'textblock',
      n: 9024,
      tab: 'textblock'
    });
  });

  it('reads a block as the realm uses it when no reading is asked for', async () => {
    const as = (n: number) =>
      explorerTextblock(fixture(), { n, mode: null, hideTB: false, defaultMap: 1 });
    // Dhelvanen's greeting: each word to the block it answers with, followed.
    const greet = await as(177);
    expect(greet.mode).toBe('greet');
    expect(words(greet.command.kids[0]!)).toBe('Command: dragon --> Textblock 179');
    // Their room's give-to-Dhelvanen trades.
    const room = await as(181);
    expect(room.mode).toBe('room');
    expect(words(room.command.kids[0]!)).toBe('Command: give spider silk to Dhelvanen');
    expect((await as(9046)).mode).toBe('plain');
  });

  it("draws the reading asked for over the realm's", async () => {
    const tb = await explorerTextblock(fixture(), {
      n: 177,
      mode: 'plain',
      hideTB: false,
      defaultMap: 1
    });
    expect(tb.mode).toBe('plain');
    expect(words(tb.command.kids[0]!)).toBe('Line 1');
  });

  it('says a guard and the block that refuses it, and a message as the words of a block', async () => {
    const tb = await asked(9046);
    const line = tb.command.kids[0]!.kids.map(words);
    expect(line).toContain('Min level: 20, else Textblock 2614');
    expect(line).toContain('Message, words of: Textblock 2639');
    expect(line.some((text) => /^check\b/.test(text))).toBe(false);
  });
});

/* MME's room as data, for the Room card and the room panel (2026-10-24). */
describe('a room as MMUD Explorer says it holds', () => {
  it("reads a lair's slots, regen, worth and monsters with their tempers", async () => {
    const room = await explorerRoom(fixture(), character(), 1, 552);
    expect(room.name).toBe('Sewer Tunnel');
    expect(room.lair).toMatchObject({ max: 1, regen: '@ 5 mins', exp: 14, hp: 19 });
    expect(room.lair?.monsters[0]).toMatchObject({
      n: 1,
      name: 'giant rat',
      hp: 12,
      disposition: 'hostile'
    });
  });

  it('names the shop a room holds, by its number', async () => {
    const room = await explorerRoom(fixture(), character(), 1, 355);
    expect(room.shop).toEqual({ n: 5, name: 'Sword Shop' });
    expect(room.lair).toBeUndefined();
  });
});

/*
 * Room spells (2026-10-29): MME clears a lair one monster at a time with the
 * one attack; MegaMUD opens on a room spell while the spawn is big enough.
 * Skinny's divine tempest annihilates a three-monster spawn in a cast.
 */
describe('a lair cleared with a room spell, as MegaMUD casts it', () => {
  const mage = character({
    name: 'Skinny',
    className: 'Mage',
    progress: {
      ...EMPTY_CHARACTER.progress,
      level: 30,
      strength: 40,
      intellect: 90,
      willpower: 60,
      agility: 50,
      health: 50,
      charm: 50
    }
  });
  const how = {
    attack: 'a',
    attackSpell: 'lbol',
    backstab: false,
    heal: '',
    blessings: [],
    meditate: false,
    area: []
  };
  const rooms = (): string[] => {
    const table = read(manifest.tables['Rooms']!.file) as { cols: string[]; rows: unknown[][] };
    const map = table.cols.indexOf('Map Number');
    const room = table.cols.indexOf('Room Number');
    return table.rows.map((row) => `${String(row[map])}/${String(row[room])}`);
  };

  it('opens a spawn of two or more with fireball, and leaves a spawn of one to the attack', async () => {
    const every = rooms();
    const plain = await explorerHunting(fixture(), mage, how, every);
    const fireball = { spell: 'fbal', monsters: 2, casts: 10, maxDamage: 99999 };
    const nuked = await explorerHunting(fixture(), mage, { ...how, area: [fireball] }, every);
    const before = new Map(plain.groups.map((group) => [group.key, group]));
    const sped = nuked.groups.filter((group) => group.areaAttack !== undefined);
    expect(sped.length).toBeGreaterThan(0);
    for (const group of sped) {
      expect(group.perSpawn).toBeGreaterThanOrEqual(2);
      expect(group.areaAttack!.spells).toEqual(['fireball']);
    }
    expect(nuked.groups.filter((group) => group.perSpawn < 2).every((g) => !g.areaAttack)).toBe(
      true
    );
    // Three famished cows a spawn: lightning bolt's nine rounds, fireball's one; it pays about three times.
    const cows = sped.find((group) => group.mobs[0] === 'famished cow')!;
    expect(cows.areaAttack).toEqual({ spells: ['fireball'], rounds: 1, without: 9 });
    expect(cows.expPerHour!).toBeGreaterThan(2.5 * before.get(cows.key)!.expPerHour!);
    // Giant rats die as fast to either, and fireball's 34 mana against the bolt's 5 is resting.
    const rats = sped.find((group) => group.mobs[0] === 'giant rat')!;
    expect(rats.recovering).toBeGreaterThan(before.get(rats.key)!.recovering);
    expect(rats.expPerHour!).toBeLessThan(before.get(rats.key)!.expPerHour!);
    expect(nuked.setup).toContain('room spells fbal');
  });

  // 2026-10-31: Skinny's forgotten dragons, placed by a room of the Dark Cavern, went unpriced.
  it('prices a boss that a room places, in that room', async () => {
    const priced = await explorerHunting(fixture(), mage, how, rooms());
    const champion = priced.groups.find((group) => group.key === 'mob:60');
    expect(champion).toMatchObject({
      kind: 'mob',
      mobs: ['minotaur champion'],
      rooms: [{ map: 1, room: 2124 }],
      expPerClear: 6000,
      respawnMinutes: 6000
    });
  });

  /*
   * The heal as MegaMUD casts it, when hurt (2026-10-31): MME's every round
   * charged Skinny's leech each round of every fight, where it covered three
   * of them.
   */
  it('casts the heal only as often as the fight needs it', async () => {
    const priest = character({
      name: 'Bowel',
      className: 'Priest',
      progress: { ...mage.progress, level: 30, willpower: 90, intellect: 60 }
    });
    const melee = { ...how, attackSpell: 'gwra' };
    const every = rooms();
    const bare = await explorerHunting(fixture(), priest, melee, every);
    const healed = await explorerHunting(fixture(), priest, { ...melee, heal: 'mahe' }, every);
    const without = new Map(bare.groups.map((group) => [group.key, group]));
    // Giant rats barely scratch a priest: healed every round the rate fell 29%, healed as hurt about 2%.
    const rats = healed.groups.find(
      (group) => group.mobs[0] === 'giant rat' && (group.expPerHour ?? 0) > 0
    )!;
    expect(rats.expPerHour!).toBeGreaterThan(0.95 * without.get(rats.key)!.expPerHour!);
  });

  it('never casts it under its monster count', async () => {
    const every = rooms();
    const fireball = { spell: 'fbal', monsters: 99, casts: 10, maxDamage: 99999 };
    const nuked = await explorerHunting(fixture(), mage, { ...how, area: [fireball] }, every);
    expect(nuked.groups.some((group) => group.areaAttack !== undefined)).toBe(false);
  });
});
