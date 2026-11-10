/**
 * A realm's tables from its own database (2026-11-10): the message, monster
 * and item tables MegaMUD kept in `Messages.md`, `Monsters.md` and
 * `Items.md`, worked out from the realm's records instead, so a realm played
 * from its database needs nothing else.
 *
 * - **Messages**: the database's own `Messages` table where it carries one
 *   (`realmMessageTriggers`): a realm's server can build it from its spells;
 *   a stock MMUD Explorer export has none, which leaves the realm's table as
 *   it is.
 * - **Monsters**: what MegaMUD's hand-tuned rows were found to say, read off
 *   the facts behind them (MudRev's 510 rows against its database,
 *   2026-11-10). Its friends are shopkeepers and monsters attacking which
 *   costs alignment (`costsAlignment`); its first-fought are the monsters
 *   that attack on sight; and a monster that never starts a fight is not
 *   hostile, so a character may rest beside it.
 * - **Items**: a weapon with backstab accuracy (`BSAccu`) is one to backstab
 *   with, as MegaMUD's rows chose 432 times of 534; one the realm will not
 *   let be picked up cannot be taken.
 *
 * A name several rows share answers for all of them: a friend only where
 * every row is one, never hostile only where none is.
 */
import { BACKSTAB_ACCURACY } from '../../shared/abilities';
import { itemKey, type ItemRule } from '../../shared/itemRules';
import { realmMessageTriggers, type MessageTrigger } from '../../shared/messageTriggers';
import { costsAlignment, dispositionOf } from '../../shared/mobs';
import type { MonsterRule } from '../../shared/monsterRules';
import { mobKey } from '../../shared/world';
import { openRealm } from './RealmSource';
import type { WorldGraph } from './WorldGraph';

export interface DatabaseTables {
  /** Null where the database carries no `Messages` table. */
  messages: MessageTrigger[] | null;
  monsters: MonsterRule[];
  items: ItemRule[];
}

type Row = Record<string, unknown>;

function whole(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function named(row: Row): string {
  return typeof row['Name'] === 'string' ? row['Name'].trim() : '';
}

/** The monster rows a realm's facts call for, by name, in the realm's order. */
export function realmMonsterRules(
  monsters: readonly Row[],
  keepers: ReadonlySet<number>
): MonsterRule[] {
  const byName = new Map<string, Row[]>();
  for (const row of monsters) {
    const name = named(row);
    if (name === '') continue;
    const key = mobKey(name);
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  const rules: MonsterRule[] = [];
  for (const [mob, rows] of byName) {
    const disposition = rows.map((row) => dispositionOf(whole(row['Align']), whole(row['Type'])));
    const friend = rows.every(
      (row) => keepers.has(whole(row['Number'])) || costsAlignment(whole(row['Align']))
    );
    const rule: MonsterRule = { mob };
    if (friend) rule.relationship = 'friend';
    else if (disposition.every((one) => one === 'hostile')) rule.priority = 'high';
    if (disposition.every((one) => one === 'passive')) rule.notHostile = true;
    if (Object.keys(rule).length > 1) rules.push(rule);
  }
  return rules;
}

/** The item rows a realm's facts call for, by name, in the realm's order. */
export function realmItemRules(items: readonly Row[]): ItemRule[] {
  const byName = new Map<string, ItemRule>();
  for (const row of items) {
    const name = named(row);
    if (name === '') continue;
    const item = itemKey(name);
    const rule: ItemRule = { item };
    // ItemType 1 is a weapon.
    if (whole(row['ItemType']) === 1) {
      for (let at = 0; at < 20; at += 1) {
        if (whole(row[`Abil-${at}`]) === BACKSTAB_ACCURACY) rule.backstab = true;
      }
    }
    if (row['Gettable'] !== undefined && whole(row['Gettable']) === 0) rule.cannotTake = true;
    const was = byName.get(item);
    if (was === undefined) {
      byName.set(item, rule);
      continue;
    }
    // A name several items share: only what all of them say.
    if (was.backstab && !rule.backstab) delete was.backstab;
    if (was.cannotTake && !rule.cannotTake) delete was.cannotTake;
  }
  return [...byName.values()].filter((rule) => rule.backstab || rule.cannotTake);
}

/** The monsters standing behind a shop's counter, by number: `Rooms.NPC` where `Rooms.Shop` is one. */
export function shopkeepers(world: WorldGraph): Set<number> {
  const keepers = new Set<number>();
  for (const room of world.everyRoom()) {
    if (room.shop !== undefined && room.shop > 0 && room.npcId !== undefined)
      keepers.add(room.npcId);
  }
  return keepers;
}

/**
 * The three tables out of a realm database, its shopkeepers read off the
 * realm's rooms as already loaded (`shopkeepers`) rather than its 57,000
 * rows read again. Throws on a file it cannot open.
 */
export function databaseTables(file: string, keepers: ReadonlySet<number>): DatabaseTables {
  const realm = openRealm(file);
  try {
    const messages = realm.table('Messages');
    return {
      messages: messages === null ? null : realmMessageTriggers(messages.rows),
      monsters: realmMonsterRules(realm.table('Monsters')?.rows ?? [], keepers),
      items: realmItemRules(realm.table('Items')?.rows ?? [])
    };
  } finally {
    realm.close();
  }
}
