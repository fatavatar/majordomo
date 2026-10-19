import { describe, expect, it } from 'vitest';

import type { ItemRec } from '../data';
import { newItem, newPlayer } from '../data';
import { addMember } from '../party/members';
import { recoverCorpse } from '../player/corpse';
import { exitStep } from '../script/exit';
import { searchRoom } from '../script/misc';
import { invitePlayers, lookAtPlayer, partyStatus } from '../script/party';
import { loadRules, rulesStep } from '../script/rules';
import { depositCash, discardCash, shareCash, stashItems, withdrawCash } from '../script/cash';
import { autoEquip, buyItems, collectItems, sellItems } from '../script/items';
import { gameSetup, refreshInventory, refreshStats, refreshWho } from '../script/setup';
import { listingTimedOut, thirtySeconds } from '../script/waits';
import { newEntity } from '../Session';
import { session } from './fixture';
import { State } from '../states';
import { CarriedFlag, PartyFlag } from '../flags';

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
    s.setupDue = 1;
    s.MegaMud_StatLine = 'full';
    expect(gameSetup(s)).toBe(1);
    expect(sent(out)).toEqual(['set statline full\r']);
    expect(pending(s)).toContain('brief\r');
    expect(gameSetup(s)).toBe(0);
  });

  it('asks for stat, then exp, then spells (powers for kai)', () => {
    const { s, out } = game();
    s.statDue = 1;
    expect(refreshStats(s)).toBe(1);
    s.expDue = 1;
    expect(refreshStats(s)).toBe(1);
    s.spellsDue = 1;
    expect(refreshStats(s)).toBe(1);
    expect(sent(out)).toEqual(['stat\r', 'exp\r', 'spells\r']);
  });

  it('asks for the inventory when its encumbrance is not known, and who when wanted', () => {
    const { s, out } = game();
    expect(refreshInventory(s)).toBe(1);
    expect(refreshInventory(s)).toBe(0);
    s.whoDue = 1;
    expect(refreshWho(s)).toBe(1);
    expect(sent(out)).toEqual(['i\r', 'who\r']);
    expect(s.state).toBe(0x23);
  });
});

describe('waits given up on', () => {
  it('gives up an inventory listing', () => {
    const { s, out } = game();
    s.state = State.Inventory;
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
    s.weightMax = 100;
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
    s.shareCashDue = 1;
    const gold = item(s, 'gold crown', { flags: 0x8000000 });
    s.inventory = [{ count: 9, flags: 0, item: gold }];
    expect(shareCash(s, 0)).toBe(1);
    expect(pending(s)).toEqual(['share 9 gold with party\r']);
  });

  it('deposits the excess and withdraws what is wanted in the bank', () => {
    const { s, out } = game();
    s.roomRecord = { signature: 1, name: 'Bank of Godfrey' };
    s.wealth = 5000;
    s.Cash_MinWealth = 1000;
    s.depositAsked = -1;
    expect(depositCash(s)).toBe(1);
    expect(s.wealth).toBe(1000);
    s.cashNeeded = 300;
    expect(withdrawCash(s)).toBe(1);
    expect(sent(out)).toEqual(['deposit 4000\r', 'withdraw 300\r']);
  });

  it('stashes what is beyond the number kept', () => {
    const { s, out } = game();
    s.stashing = 1;
    const gem = item(s, 'opal', { flags: 8, min: 1 });
    s.inventory = [{ count: 3, flags: 0, item: gem }];
    expect(stashItems(s)).toBe(1);
    expect(sent(out)).toEqual(['stash opal\r']);
  });
});

describe('items (D19, D20, D42, D43)', () => {
  it('picks up an item it collects, within its encumbrance', () => {
    const { s, out } = game();
    s.weightMax = 100;
    s.weightCarried = 10;
    s.MegaMud_AutoGet = 1;
    const gem = item(s, 'opal', { flags: 2, weight: 1 });
    s.room = [Object.assign(newEntity(), { type: 3, count: 1, name: 'opal', item: gem })];
    expect(collectItems(s)).toBe(1);
    expect(sent(out)).toEqual(['g opal\r']);
  });

  /* A key dropped by the guard, picked up with Auto-get off and no rule for it (2026-10-16). */
  it('picks up an item that opens a way the pack lacks, whatever its record says', () => {
    const { s, out } = game();
    s.weightMax = 100;
    s.weightCarried = 10;
    s.MegaMud_AutoGet = 0;
    const key = item(s, 'shining steel key', { flags: 0, weight: 1 });
    s.room = [
      Object.assign(newEntity(), { type: 3, count: 4, name: 'shining steel key', item: key })
    ];
    expect(collectItems(s)).toBe(0);
    (s.host as { opensAWay?: (name: string) => boolean }).opensAWay = (name) =>
      name === 'shining steel key';
    expect(collectItems(s)).toBe(1);
    expect(sent(out)).toEqual(['g shining steel key\r']);
  });

  /* Bowel's collect-keys took the gate key Archer's errand had come for (2026-10-19). */
  it('leaves an item on the floor for the party member fetching it', () => {
    const { s, out } = game();
    s.weightMax = 100;
    s.weightCarried = 10;
    s.MegaMud_AutoGet = 1;
    const key = item(s, 'gate key', { flags: 2, weight: 1 });
    const gem = item(s, 'opal', { flags: 2, weight: 1 });
    s.room = [
      Object.assign(newEntity(), { type: 3, count: 1, name: 'gate key', item: key }),
      Object.assign(newEntity(), { type: 3, count: 1, name: 'opal', item: gem })
    ];
    (s.host as { leaveFor?: (name: string) => boolean }).leaveFor = (name) => name === 'gate key';
    expect(collectItems(s)).toBe(1);
    expect(sent(out)).toEqual(['g opal\r']);
  });

  it('leaves what would take it past its encumbrance', () => {
    const { s, out } = game();
    s.weightMax = 100;
    s.weightCarried = 99;
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
      { count: 1, flags: CarriedFlag.Equipped, item: worn },
      { count: 1, flags: 0, item: ring }
    ];
    expect(autoEquip(s)).toBe(1);
    expect(sent(out)).toEqual(['eq gold ring\r']);
  });

  it('buys and sells in the shop', () => {
    const { s, out } = game();
    s.roomRecord = { signature: 1, name: 'General Store', flags: 2 };
    s.wealth = 1000;
    s.Player_Charm = 50;
    item(s, 'torch', { flags: 4, shop: 'General Store', min: 2, price: 10 });
    expect(buyItems(s)).toBe(1);
    const pelt = item(s, 'pelt', { flags: 8, shop: 'General Store' });
    s.inventory = [{ count: 1, flags: 0, item: pelt }];
    expect(sellItems(s)).toBe(1);
    expect(sent(out)).toEqual(['buy torch\r', 'sell pelt\r']);
  });
});

describe('exit, corpse and searching (D31, D51, D45)', () => {
  it('leaves the game for a relog once no monster is here', () => {
    const { s, out } = game();
    s.exitForRelog = 1;
    s.Other_ExitCmd = 'rest';
    expect(exitStep(s)).toBe(1);
    expect(sent(out)).toEqual(['rest\r', 'x\r']);
    expect(s.task).toBe(0x13);
  });

  it("recovers this character's corpse (GreaterMUD)", () => {
    const { s, out } = game();
    s.BBS_GreaterMUD = 1;
    s.MegaMud_AutoGet = 1;
    s.Cash_AutoRecoverCorpse = 1;
    s.Player_Name = 'Skinny';
    s.room = [
      Object.assign(newEntity(), { type: 3, count: 1, name: 'corpse of Skinny', flags: 0x8000 })
    ];
    expect(recoverCorpse(s)).toBe(1);
    expect(sent(out)).toEqual(['recover corpse of Skinny\r']);
  });

  it('searches for an item a path needs, up to the limit', () => {
    const { s, out } = game();
    s.itemPickingUp = 'key';
    s.searchesLeft = 1;
    expect(searchRoom(s)).toBe(1);
    expect(searchRoom(s)).toBe(0);
    expect(sent(out)).toEqual(['sea\r']);
  });
});

describe('party and players (D17, D27, D35)', () => {
  it('asks for the party when a member is unknown, and a member for its health', () => {
    const { s, out } = game();
    s.Player_Name = 'Skinny';
    addMember(s, 'Skinny', 1);
    addMember(s, 'Fatty', 0);
    s.party[1]!.flags28 = PartyFlag.ChangedSinceListing;
    expect(partyStatus(s)).toBe(1);
    s.party[1]!.flags28 = PartyFlag.HealthUnknown;
    expect(partyStatus(s)).toBe(1);
    expect(sent(out)).toEqual(['par\r', '/Fatty @health\r']);
  });

  it('invites a player it invites when seen', () => {
    const { s, out } = game();
    const p = newPlayer(s.data, 0);
    Object.assign(p, { name: 'Fatty', flags: 0x10 });
    s.room = [Object.assign(newEntity(), { type: 1, name: 'Fatty', player: p })];
    expect(invitePlayers(s)).toBe(1);
    expect(sent(out)).toEqual(['invite Fatty\r']);
    expect(s.party[0]!.flags28 & PartyFlag.Invited).toBe(4);
  });

  it('looks at a player whose race is unknown', () => {
    const { s, out } = game();
    s.Talk_LookPlayers = 1;
    const p = newPlayer(s.data, 0);
    p.name = 'Warrax';
    s.room = [Object.assign(newEntity(), { type: 1, name: 'Warrax', player: p })];
    expect(lookAtPlayer(s)).toBe(1);
    expect(sent(out)).toEqual(['l Warrax\r']);
  });
});

describe('timed events and rules (D29, D21)', () => {
  it('reads [Rules] and runs an action when its conditions hold', () => {
    const { s, out } = game();
    loadRules(s, (k) => ({ R1: '0:0:0:low', R2: '1:1:4:50', R3: '3:14:0:quaff potion' })[k] ?? '');
    s.hp = 40;
    expect(rulesStep(s)).toBe(1);
    expect(sent(out)).toEqual(['quaff potion\r']);
    s.hp = 90;
    expect(rulesStep(s)).toBe(0);
  });
});
