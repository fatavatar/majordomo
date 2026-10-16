/**
 * MegaMUD's databases built from our own stores rather than read from its
 * `.md` files (2026-10-13): the realm's facts from its converted data
 * (`WorldGraph`), and the player's choices from the realm's tables —
 * monsters (`monsters.yaml`, put on by `rememberRule`), items (`items.yaml`)
 * and messages (`messages.yaml`).
 *
 * Every field below was checked against Skinny's own MegaMUD files on the
 * same realm (`Classes.md`, `Races.md`, `Spells.md`, `Monsters.md`,
 * `Items.md`): where the realm's data and MegaMUD's agreed the field is read
 * straight; where MegaMUD keeps its own numbering, the mapping is the one
 * every row of those files follows. MegaMUD's own databases were a copy of a
 * realm's tables, a version or two behind; the realm is the authority.
 */
import type { WorldGraph } from '../world/WorldGraph';
import { loadedItem, RELATIONSHIP_NUMBER } from './saved';
import { COPPER_PER, counterPriceInCopper } from '../../shared/coins';
import { ITEM_KINDS } from '../../shared/items';
import { ITEM_FLAG_BITS, ITEM_FLAGS, itemKey, type ItemRule } from '../../shared/itemRules';
import {
  MEGAMUD_ANYWHERE,
  MEGAMUD_CHASE,
  MEGAMUD_CONVERSATIONS,
  MEGAMUD_DISABLED,
  MEGAMUD_EFFECT_BITS,
  MESSAGE_ACTIONS,
  type MessageTrigger
} from '../../shared/messageTriggers';
import type { WorldClass, WorldItem, WorldMob, WorldRace, WorldSpell } from '../../shared/world';
import {
  coinItems,
  type ClassRec,
  type ItemRec,
  type MegaData,
  type MessageRec,
  type MonsterRec,
  type RaceRec,
  type SpellRec
} from './data';
import { ItemFlag, SpellFlag } from './flags';

/** What the player has chosen about this realm's items and sentences. */
export interface RealmChoices {
  items: readonly ItemRule[];
  messages: readonly MessageTrigger[];
}

/** The realm's `LoyalItem` ability: an item kept through death (`0x459860`'s 100). */
const LOYAL_ABILITY = 100;
const CANNOT_TAKE = ITEM_FLAG_BITS.cannotTake;
/** The ring code MegaMUD files under `Finger` (4): mudrev's second finger slot. */
const SECOND_FINGER = 13;
const FINGER = 4;

/** `Damage`, `DrainLife`, `Damage(-MR)` and `EvilInCombat`: a spell MegaMUD marks `SpellFlag.EvilInCombat`, an attack. */
const ATTACK_ABILITIES = new Set([1, 8, 17, 52]);

/**
 * `Spells.Targets` as MegaMUD's target bits (`0x10` self, `0x20` a player,
 * `0x40` a monster, `0x80` the room): every row of Skinny's `Spells.md`
 * against the realm's column. A number the realm has and MegaMUD's file
 * never showed reads as none.
 */
const TARGET_BITS: Readonly<Record<number, number>> = {
  0: 0x20,
  1: 0x10,
  2: 0x30,
  4: 0x40,
  6: 0x50,
  7: 0x70,
  8: 0x60,
  9: 0,
  11: 0x80,
  12: 0x80,
  13: 0x90
};

/**
 * MegaMUD's magic number for a spell (`SpellRec.magic`), from the realm's
 * `Magery` and `MageryLVL`: 1–3 mage, 4–6 priest, 7–9 druid, 10, 12 and 13
 * bard, 11 kai, the level taken as 1 where the realm states 0. The realm's
 * `Magery` numbers spells 2 mage, 1 priest, 3 druid, 4 bard, 5 kai.
 */
export function spellMagic(magery: number, level: number): number {
  const l = Math.min(Math.max(level, 1), 3);
  switch (magery) {
    case 2:
      return l;
    case 1:
      return 3 + l;
    case 3:
      return 6 + l;
    case 4:
      return l === 1 ? 10 : 10 + l;
    case 5:
      return 11;
    default:
      return 0;
  }
}

function classRec(c: WorldClass): ClassRec {
  const abilities: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const [id, value] = c.abilities?.[i] ?? [0, 0];
    abilities.push(id);
    values.push(value);
  }
  return {
    id: c.id,
    layer: 0,
    name: c.name.slice(0, 30),
    f28: 100 + (c.expTable ?? 0),
    // `CombatLVL`, two hit-dice columns the engine does not read, `WeaponType`, `ArmourType`.
    bytes: [c.combat ?? 0, 0, 0, c.weaponType ?? 0, 0],
    magic: ((c.mageryType ?? 0) << 8) | (c.magery ?? 0),
    abilities,
    values
  };
}

function raceRec(r: WorldRace): RaceRec {
  return { id: r.id, layer: 0, name: r.name.slice(0, 30), exp: r.expTable ?? 0 };
}

function spellRec(spell: WorldSpell): SpellRec {
  let flags = TARGET_BITS[spell.targets ?? 0] ?? 0;
  if ((spell.duration ?? 0) > 0) flags |= SpellFlag.Timed;
  if (spell.abilities?.some(([id]) => ATTACK_ABILITIES.has(id))) flags |= SpellFlag.EvilInCombat;
  return {
    layer: 0,
    id: spell.id,
    short: (spell.short ?? '').slice(0, 6),
    name: spell.name.slice(0, 30),
    item: '',
    flags,
    magic: spellMagic(spell.magery ?? 0, spell.mageryLevel ?? 0),
    level: spell.level ?? 0,
    cost: spell.mana ?? 0
  };
}

/**
 * A monster's records, one for each of the realm's rows, as MegaMUD's
 * `Monsters.md` holds one for each: a name the realm uses for several rows
 * (`giant rat` eight times) gets each row's own health and worth, in the
 * realm's order. MegaMUD finds the first of them by name, and its file's
 * order is its B-tree's pages', which follows nothing in the realm. A name
 * with one row is its fold.
 */
function monsterRecs(world: WorldGraph, mob: WorldMob): MonsterRec[] {
  const ids = [...(mob.ids ?? [0])].sort((a, b) => a - b);
  return ids.map((id) => {
    const row = ids.length > 1 ? world.mobRow(id) : undefined;
    return {
      layer: 0,
      // As the realm prints it: MegaMUD finds a monster case and all (`0x46f9f0`).
      name: (mob.spelled ?? mob.name).slice(0, 30),
      id,
      flags: 0,
      // Enemy: what MegaMUD's own database said of every monster nothing set
      // otherwise (1,117 of Skinny's 1,475, and none at 0), and what our
      // monster table means by a monster with no row. 0 is a monster met in
      // play and not yet known, which the engine does not start on.
      relationship: RELATIONSHIP_NUMBER.enemy,
      exp: row
        ? (row.experience ?? 0) * (row.expMulti ?? 1)
        : (mob.experience ?? 0) * (mob.expMulti ?? 1),
      maxHp: row?.hp ?? mob.hp,
      preSpell: '',
      attackSpell: '',
      preMax: 0,
      attackMax: 0
    };
  });
}

/**
 * What `shop` charges for one, in copper, before the buyer's charm: MegaMUD's
 * item price is the one a shop lists, which the engine adjusts for charm
 * itself (`buyItems`). The realm's own price where no shop of the name is known.
 */
function priceAt(world: WorldGraph, item: WorldItem, shop: string): number {
  const currency = item.currency ?? 'copper';
  const markup = shop === '' ? undefined : world.shopNamed(shop)?.markup;
  return markup === undefined
    ? (item.price ?? 0) * COPPER_PER[currency]
    : counterPriceInCopper(item.price ?? 0, currency, markup);
}

function itemRec(item: WorldItem): ItemRec {
  let flags = 0;
  if (item.abilities?.some(([id]) => id === LOYAL_ABILITY)) flags |= ItemFlag.Loyal;
  if (item.gettable === false) flags |= CANNOT_TAKE;
  return {
    id: item.id,
    layer: 0,
    name: item.name.slice(0, 30),
    // MegaMUD's *Bought/sold*, the first shop the realm stocks it in.
    shop: (item.shops?.[0] ?? '').trim().slice(0, 40),
    ifNeeded: '',
    flags,
    type: item.kind === undefined ? 0 : ITEM_KINDS.indexOf(item.kind),
    location: item.worn === SECOND_FINGER ? FINGER : (item.worn ?? 0),
    min: 0,
    max: 0,
    weight: item.encumbrance ?? 0,
    price: 0
  };
}

/**
 * A row of the realm's item table put on the engine's record, as dialog 316
 * would have. A shop the realm has no shop of that name for is left as it
 * was: the engine finds a shop by the realm's name for it (`know`).
 */
export function applyItemRule(rec: ItemRec, rule: ItemRule, world?: WorldGraph): void {
  for (const flag of ITEM_FLAGS) {
    const on = rule[flag];
    if (on !== undefined)
      rec.flags = on ? rec.flags | ITEM_FLAG_BITS[flag] : rec.flags & ~ITEM_FLAG_BITS[flag];
  }
  if (rule.keep !== undefined) rec.min = rule.keep;
  if (rule.most !== undefined) rec.max = rule.most;
  if (rule.ifNeeded !== undefined) rec.ifNeeded = rule.ifNeeded.slice(0, 13);
  if (rule.shop !== undefined && (world === undefined || world.shopNamed(rule.shop) !== undefined))
    rec.shop = rule.shop.slice(0, 40);
}

/** One of our message rows as MegaMUD's (`0x467b60`'s record). */
export function messageRec(trigger: MessageTrigger): MessageRec {
  let effects = 0;
  for (const effect of trigger.effects) effects |= MEGAMUD_EFFECT_BITS[effect];
  if (trigger.anywhere) effects |= MEGAMUD_ANYWHERE;
  if (trigger.conversations) effects |= MEGAMUD_CONVERSATIONS;
  if (trigger.chase) effects |= MEGAMUD_CHASE;
  if (!trigger.enabled) effects |= MEGAMUD_DISABLED;
  const msg = trigger.match.slice(0, 0x50);
  const endMsg = trigger.endsWith.slice(0, 0x50);
  let flags = 0;
  if (msg.includes('{')) flags |= 4;
  if (endMsg.includes('{')) flags |= 8;
  return {
    layer: 0,
    name: trigger.name.slice(0, 30),
    msg,
    endMsg,
    action: trigger.response.slice(0, 0x50),
    effects,
    flags,
    number: Math.max(0, MESSAGE_ACTIONS.indexOf(trigger.action)),
    firedAt: 0
  };
}

/**
 * The engine's databases for a realm: its facts from `world` (none when the
 * realm has no data: MegaMUD then learns monsters and items as it meets
 * them), the player's item choices and sentences laid on, and the five coins
 * ahead of the items as MegaMUD's loader puts them.
 */
export function megaDataFrom(
  world: WorldGraph | undefined,
  choices: RealmChoices,
  runic = 'runic coin'
): MegaData {
  const items: ItemRec[] = coinItems(runic);
  const byName = new Map<string, ItemRec>();
  const facts = new Map<ItemRec, WorldItem>();
  for (const item of world?.allItems() ?? []) {
    if (item.name.trim().length === 0) continue;
    const rec = itemRec(item);
    const key = itemKey(rec.name);
    if (byName.has(key)) continue;
    byName.set(key, rec);
    facts.set(rec, item);
    items.push(rec);
  }
  for (const rule of choices.items) {
    let rec = byName.get(rule.item);
    if (rec === undefined) {
      // A row for an item the realm data does not name.
      rec = loadedItem(rule.item);
      byName.set(rule.item, rec);
      items.push(rec);
    }
    applyItemRule(rec, rule, world);
  }
  // Priced at the shop chosen, once the choices are on.
  if (world) for (const [rec, item] of facts) rec.price = priceAt(world, item, rec.shop);
  return {
    classes: world?.allClasses().map(classRec) ?? [],
    races: world?.allRaces().map(raceRec) ?? [],
    monsters: world ? [...world.allMobs()].flatMap((mob) => monsterRecs(world, mob)) : [],
    items,
    spells: world?.allSpells().map(spellRec) ?? [],
    messages: choices.messages.map(messageRec)
  };
}
