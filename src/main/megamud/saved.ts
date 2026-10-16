/**
 * What MegaMUD's database writers save of each record, read 2026-10-13 —
 * monsters (`0x46fa70`), items (`0x45a240`) and players (`0x494640`), run by
 * `0x43bfa0` for each database marked changed — and what of it reaches our
 * own stores. The decisions are MegaMUD's; the shapes are ours (a monster's
 * stance in the monster table's words, an item's weight and slot).
 *
 * - **Monsters and items** go when they carry `0x40000000` (set by
 *   `newMonster`/`newItem` and by whatever changes one in play) and are not
 *   deleted (`0x80000000`).
 * - **Players** are not saved by the engine: our tracker writes what it sees
 *   of them to `PlayerBook`, and the engine starts from that. MegaMUD's own
 *   rule for them stands: one not seen for `Other.DelPlayers` days (and not
 *   kept, `0x200`) is dropped, here when the engine takes them up.
 */
import { findClassByName, findRaceByName, newPlayer } from './data';
import type { ItemRec, MonsterRec } from './data';
import type { Session } from './Session';
import type { Alignment } from '../../shared/alignment';
import type { MobPriorityBand } from '../../shared/config';
import type { MonsterRule, Relationship } from '../../shared/monsterRules';
import { mobKey } from '../../shared/world';
import type { PlayerFacts } from '../../shared/players';
import type { LearnedItem } from '../world/MegaLearned';

const CHANGED = 0x40000000;
const DELETED = 0x80000000;
const SECONDS_A_DAY = 0x15180;

/** MegaMUD's relationship numbers (`MonsterRec.relationship`) in the monster table's words. */
export const RELATIONSHIP_NUMBER: Record<Relationship, number> = {
  friend: 2,
  avoid: 3,
  enemy: 4,
  escape: 5,
  hangup: 6
};

const RELATIONSHIP_WORD = new Map(
  Object.entries(RELATIONSHIP_NUMBER).map(([word, n]) => [n, word as Relationship])
);

/** `who`'s alignment numbers (`players/who.ts`): 4 is neutral. */
const ALIGNMENT_NUMBER: Record<Alignment, number> = {
  Lawful: 1,
  Saint: 2,
  Good: 3,
  Neutral: 4,
  Seedy: 5,
  Outlaw: 6,
  Criminal: 7,
  Villain: 8,
  FIEND: 9
};

function changed(flags: number): boolean {
  return (flags & DELETED) === 0 && (flags & CHANGED) !== 0;
}

/** `0x46fa70`: the monsters to save, as the stance each was learned to have. */
export function savedStances(s: Session): [string, Relationship][] {
  const stances: [string, Relationship][] = [];
  for (const rec of s.data.monsters) {
    if (!changed(rec.flags)) continue;
    const word = RELATIONSHIP_WORD.get(rec.relationship);
    if (word) stances.push([rec.name, word]);
  }
  return stances;
}

/** `0x45a240`: the items to save, as what was learned of each. */
export function savedItems(s: Session): LearnedItem[] {
  return s.data.items
    .filter((rec) => changed(rec.flags))
    .map((rec) => ({
      name: rec.name,
      weight: rec.weight >= 0 ? rec.weight : null,
      slot: rec.type === 0 && rec.location > 0 ? rec.location : null,
      weapon: rec.type === 1
    }));
}

/**
 * The monster's records on the engine's list — one for each of the realm's
 * rows of the name (`megamud/fromWorld.ts`) — or one made as the loader would
 * have read it when there are none.
 */
export function monsterRecords(s: Session, name: string): MonsterRec[] {
  const key = mobKey(name);
  const found = s.data.monsters.filter((m) => mobKey(m.name) === key);
  if (found.length > 0) return found;
  const rec: MonsterRec = {
    layer: 0,
    name: name.slice(0, 30),
    id: 0,
    flags: 0,
    relationship: 0,
    exp: 0,
    maxHp: 0,
    preSpell: '',
    attackSpell: '',
    preMax: 0,
    attackMax: 0
  };
  s.data.monsters.push(rec);
  return [rec];
}

/** A monster learned before, put on the engine's list as the loader would have read it. */
export function rememberStance(s: Session, name: string, relationship: Relationship): void {
  for (const rec of monsterRecords(s, name)) {
    rec.relationship = RELATIONSHIP_NUMBER[relationship];
    // "Marked as non-enemy" sets 2 beside avoid (`0x426940`).
    if (relationship === 'avoid') rec.flags |= 2;
  }
}

/** The priority nibble's bands (`readMegaMudMonsters` reads them the other way). */
const PRIORITY_BITS: Record<MobPriorityBand, number> = {
  first: 0x80,
  high: 0x40,
  default: 0,
  low: 0x20,
  last: 0x10
};
const NO_BACKSTAB = 0x100;
const NOT_HOSTILE = 0x200;
const STOP_TO_KILL = 0x800;

/**
 * A row of our monster table put on the engine's record for that monster, as
 * MegaMUD's Monster Details dialog would have edited it. What the row does
 * not say is left as the record has it; a cast count of 0 leaves it to the
 * combat setting, as MegaMUD's does. Not marked changed: it is ours already.
 */
export function rememberRule(s: Session, rule: MonsterRule): void {
  for (const rec of monsterRecords(s, rule.mob)) ruleOnto(rec, rule);
}

export function ruleOnto(rec: MonsterRec, rule: MonsterRule): void {
  if (rule.relationship !== undefined) {
    rec.relationship = RELATIONSHIP_NUMBER[rule.relationship];
    if (rule.relationship === 'avoid') rec.flags |= 2;
    else rec.flags &= ~2;
  }
  if (rule.priority !== undefined) rec.flags = (rec.flags & ~0xf0) | PRIORITY_BITS[rule.priority];
  const bit = (on: boolean | undefined, mask: number): void => {
    if (on !== undefined) rec.flags = on ? rec.flags | mask : rec.flags & ~mask;
  };
  bit(rule.noBackstab, NO_BACKSTAB);
  bit(rule.notHostile, NOT_HOSTILE);
  bit(rule.stopToKill, STOP_TO_KILL);
  if (rule.preAttack) {
    rec.preSpell = rule.preAttack.spell.slice(0, 4);
    rec.preMax = rule.preAttack.max;
  }
  if (rule.attack) {
    rec.attackSpell = rule.attack.spell.slice(0, 4);
    rec.attackMax = rule.attack.max;
  }
}

/**
 * An item record as the loader reads one the file names and nothing else:
 * flag 1 and not marked changed (`newItem`'s `0x40000000`), its weight not
 * known (-1).
 */
export function loadedItem(name: string): ItemRec {
  return {
    id: 0,
    layer: 0,
    name: name.slice(0, 30),
    shop: '',
    ifNeeded: '',
    flags: 1,
    type: 0,
    location: 0,
    min: 0,
    max: 0,
    weight: -1,
    price: 0
  };
}

/** An item learned before, put on the engine's list as the loader would have read it. */
export function rememberItem(s: Session, item: LearnedItem): void {
  const key = item.name.toLowerCase();
  let rec = s.data.items.find((i) => i.name.toLowerCase() === key);
  if (!rec) {
    rec = loadedItem(item.name);
    s.data.items.push(rec);
  }
  if (item.weight !== null) rec.weight = item.weight;
  if (item.weapon) rec.type = 1;
  else if (item.slot !== null) {
    rec.type = 0;
    rec.location = item.slot;
  }
}

/**
 * The players this realm has seen, put on the engine's list: every one
 * `PlayerBook` holds but those MegaMUD would have dropped for not being seen
 * in `Other.DelPlayers` days (`0x494640`).
 */
export function rememberPlayers(s: Session, players: readonly PlayerFacts[]): void {
  const list = (s.data.players ??= []);
  for (const facts of players) {
    const seenAt = Math.floor(facts.lastSeen / 1000);
    const days = Math.trunc((s.now - seenAt) / SECONDS_A_DAY);
    if (s.Other_DelPlayers >= 1 && s.now > seenAt && days > s.Other_DelPlayers) continue;
    if (list.some((p) => p.name.toLowerCase() === facts.name.toLowerCase())) continue;
    const rec = newPlayer(s.data, seenAt);
    rec.name = facts.name.slice(0, 10);
    rec.gang = (facts.gang ?? '').slice(0, 20);
    if (facts.level !== null) rec.level = facts.level;
    if (facts.alignment !== null) rec.alignment = ALIGNMENT_NUMBER[facts.alignment];
    if (facts.race !== null) rec.race = findRaceByName(s.data, facts.race)?.id ?? 0;
    if (facts.className !== null) rec.cls = findClassByName(s.data, facts.className)?.id ?? 0;
    // Details wanted until race and class are known (`0x494640`).
    if (rec.race !== 0 && rec.cls !== 0) rec.flags &= ~1;
  }
}
