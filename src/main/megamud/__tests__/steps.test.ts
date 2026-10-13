import { describe, expect, it } from 'vitest';

import type { ItemRec } from '../data';
import { newItem } from '../data';
import { depositCash, discardCash, shareCash, stashItems, withdrawCash } from '../script/cash';
import { autoEquip, buyItems, collectItems, sellItems } from '../script/items';
import { gameSetup, refreshInventory, refreshStats, refreshWho } from '../script/setup';
import { listingTimedOut, thirtySeconds } from '../script/waits';
import { newEntity } from '../Session';
import { session } from './fixture';

/* The scheduler's set-up, cash and item steps, read 2026-10-12. */

function game() {
  const r = session();
  const { s } = r;
  s.inGame = 1;
  s.online = 1;
  s.active = 1;
  s.now = r.clock.now;
  s.hp = 100;
  s.Player_MaxHP = 100;
  return r;
}

function item(
  s: ReturnType<typeof game>['s'],
  name: string,
  fields: Partial<ItemRec> = {}
): ItemRec {
  const rec = newItem(s.data);
  Object.assign(rec, { name, weight: 1, ...fields });
  return rec;
}

const sent = (out: { sent: string[] }): string[] => out.sent;
const pending = (s: { pending: { text: string }[] }): string[] => s.pending.map((p) => p.text);

describe('set-up and refreshes (D13–D16)', () => {
  it('sets the game up when asked', () => {
    const { s, out } = game();
    s.f_e2c8 = 1;
    s.MegaMud_StatLine = 'full';
    expect(gameSetup(s)).toBe(1);
    expect(sent(out)).toEqual(['set statline full\r']);
    expect(pending(s)).toContain('brief\r');
    expect(gameSetup(s)).toBe(0);
  });

  it('asks for stat, then exp, then spells (powers for kai)', () => {
    const { s, out } = game();
    s.f_e29c = 1;
    expect(refreshStats(s)).toBe(1);
    s.f_e2a8 = 1;
    expect(refreshStats(s)).toBe(1);
    s.f_e2cc = 1;
    expect(refreshStats(s)).toBe(1);
    expect(sent(out)).toEqual(['stat\r', 'exp\r', 'spells\r']);
  });

  it('asks for the inventory when its encumbrance is not known, and who when wanted', () => {
    const { s, out } = game();
    expect(refreshInventory(s)).toBe(1);
    expect(refreshInventory(s)).toBe(0);
    s.f_e2a4 = 1;
    expect(refreshWho(s)).toBe(1);
    expect(sent(out)).toEqual(['i\r', 'who\r']);
    expect(s.state).toBe(0x23);
  });
});

describe('waits given up on', () => {
  it('gives up an inventory listing', () => {
    const { s, out } = game();
    s.state = 0x25;
    expect(listingTimedOut(s)).toBe(1);
    expect(out.shown).toEqual(['[Inventory listing timed out]']);
    expect(s.state).toBe(0);
  });

  it('takes the conditions as gone after thirty seconds at full health', () => {
    const { s } = game();
    s.poisoned = 1;
    s.blind = 1;
    expect(thirtySeconds(s)).toBe(1);
    expect([s.poisoned, s.blind]).toEqual([0, 0]);
  });
});

describe('cash (D18, D37, D40, D41, D46)', () => {
  it('drops coins not wanted', () => {
    const { s, out } = game();
    s.f_8468 = 100;
    s.Cash_WantCopper = -1;
    const copper = item(s, 'copper farthing', { flags: 0x8000000 });
    s.inventory = [{ count: 12, flags: 0, item: copper }];
    expect(discardCash(s)).toBe(1);
    expect(sent(out)).toEqual(['drop 12 copper farthing\r']);
  });

  it('shares coins with the party', () => {
    const { s } = game();
    s.partySize = 2;
    s.Party_ShareCash = 1;
    s.f_8870 = 1;
    const gold = item(s, 'gold crown', { flags: 0x8000000 });
    s.inventory = [{ count: 9, flags: 0, item: gold }];
    expect(shareCash(s, 0)).toBe(1);
    expect(pending(s)).toEqual(['share 9 gold with party\r']);
  });

  it('deposits the excess and withdraws what is wanted in the bank', () => {
    const { s, out } = game();
    s.roomRecord = { signature: 1, name: 'Bank of Godfrey' };
    s.f_8428 = 5000;
    s.f_850c = 1000;
    s.f_842c = -1;
    expect(depositCash(s)).toBe(1);
    expect(s.f_8428).toBe(1000);
    s.f_8430 = 300;
    expect(withdrawCash(s)).toBe(1);
    expect(sent(out)).toEqual(['deposit 4000\r', 'withdraw 300\r']);
  });

  it('stashes what is beyond the number kept', () => {
    const { s, out } = game();
    s.f_e2c0 = 1;
    const gem = item(s, 'opal', { flags: 8, min: 1 });
    s.inventory = [{ count: 3, flags: 0, item: gem }];
    expect(stashItems(s)).toBe(1);
    expect(sent(out)).toEqual(['stash opal\r']);
  });
});

describe('items (D19, D20, D42, D43)', () => {
  it('picks up an item it collects, within its encumbrance', () => {
    const { s, out } = game();
    s.f_8468 = 100;
    s.f_8464 = 10;
    s.MegaMud_AutoGet = 1;
    const gem = item(s, 'opal', { flags: 2, weight: 1 });
    s.room = [Object.assign(newEntity(), { type: 3, count: 1, name: 'opal', item: gem })];
    expect(collectItems(s)).toBe(1);
    expect(sent(out)).toEqual(['g opal\r']);
  });

  it('leaves what would take it past its encumbrance', () => {
    const { s, out } = game();
    s.f_8468 = 100;
    s.f_8464 = 99;
    s.MegaMud_AutoGet = 1;
    const anvil = item(s, 'anvil', { flags: 2, weight: 50 });
    s.room = [Object.assign(newEntity(), { type: 3, count: 1, name: 'anvil', item: anvil })];
    expect(collectItems(s)).toBe(0);
    expect(sent(out)).toEqual([]);
  });

  it('equips an item marked to wear when its slot has room', () => {
    const { s, out } = game();
    const ring = item(s, 'gold ring', { flags: 0x10, location: 4 });
    const worn = item(s, 'silver ring', { location: 4 });
    s.inventory = [
      { count: 1, flags: 1, item: worn },
      { count: 1, flags: 0, item: ring }
    ];
    expect(autoEquip(s)).toBe(1);
    expect(sent(out)).toEqual(['eq gold ring\r']);
  });

  it('buys and sells in the shop', () => {
    const { s, out } = game();
    s.roomRecord = { signature: 1, name: 'General Store', flags: 2 };
    s.f_8428 = 1000;
    s.Player_Charm = 50;
    item(s, 'torch', { flags: 4, shop: 'General Store', min: 2, price: 10 });
    expect(buyItems(s)).toBe(1);
    const pelt = item(s, 'pelt', { flags: 8, shop: 'General Store' });
    s.inventory = [{ count: 1, flags: 0, item: pelt }];
    expect(sellItems(s)).toBe(1);
    expect(sent(out)).toEqual(['buy torch\r', 'sell pelt\r']);
  });
});
