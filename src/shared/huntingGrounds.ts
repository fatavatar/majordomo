/**
 * Hunting Grounds (2026-10-29): where a character, or a party, earns most,
 * by MMUD Explorer's own arithmetic. Each lair group in reach — the rooms
 * that spawn one group of the realm's `Summoned By` — is priced by MME's
 * exp/hour (`mmud/exphr.js`, a port of `modExpPerHour.bas`) against the
 * character as it plays: its attack, its heal-over-time blessings, and the
 * monsters' blows simulated against its own defences, as MME's *Calc dmg vs
 * char* does. Then the groups are gathered into areas, the places a player
 * thinks of as one (`groupAreas`), and an area is priced as a scripted loop
 * walks it (`priceArea`).
 *
 * Checked against Fatty on 2026-10-29: the dark oceanid druidess lairs at
 * 126.4M/h with his harmony counted as healing, the beastmistress's clock-
 * bound lairs adding about 27M/h, against the 143M/h he earned.
 */
import type { CharacterState } from './character';
import type { RoomId } from './world';

/** One room of a priced group: where it is and how far from the character. */
export interface GroundRoom {
  id: RoomId;
  map: number;
  room: number;
  name: string;
  /** Fewest steps from where the character stands. */
  steps: number;
}

/**
 * One lair group, or one monster placed on its own clock (a boss), as MME
 * prices it. What the Explorer answers (`explorerHunting`); the rooms are
 * named and stepped in main, which has the world.
 */
export interface LairPrice {
  /** `lair:<group index>` or `mob:<monster number>`. */
  key: string;
  kind: 'lair' | 'mob';
  mobs: string[];
  /** Its rooms, as the realm numbers them. */
  rooms: Array<{ map: number; room: number }>;
  /** MME's `nTotalLairs`: rooms that spawn it; 1 for a placed monster. */
  lairs: number;
  /** Monsters up at once, MME's average `nMaxRegen`. */
  perSpawn: number;
  /** Experience a clear pays, MME's `nAvgExp`. */
  expPerClear: number;
  /** Minutes until it is back, MME's `nAvgDelay` (a lair) or `RegenTime` (a placed monster). */
  respawnMinutes: number;
  /** MME's exp/hour; null where it is undefeatable or pays nothing. */
  expPerHour: number | null;
  /** MME's shares of the hour: attacking, moving, recovering. */
  attack: number;
  move: number;
  recovering: number;
  /** MME's rounds to clear one spawn. */
  roundsToClear: number | null;
  /** Damage it deals a round, against the character's own defences. */
  damagePerRound: number | null;
  /**
   * What the room spells did to a clear (`HowItFights.area`): their names,
   * the rounds to clear with them, and MME's rounds without, null where the
   * attack alone clears nothing. Absent where none was cast.
   */
  areaAttack?: { spells: string[]; rounds: number; without: number | null };
}

/** A priced group, its rooms named and stepped. */
export interface GroundGroup extends Omit<LairPrice, 'rooms'> {
  rooms: GroundRoom[];
  /**
   * How dangerous hunting it is for the character (2026-10-29): the router's
   * own check — one pass through a lair, or a room's spell — as a share of its
   * full health, the worst of its rooms (`SessionManager.huntingDanger`).
   * Null where nothing could be weighed.
   */
  danger?: number | null;
}

/** How a group counts toward its area's rate. */
export type GroupRole =
  /** Walked as the area's loop: busy, its lairs pooled with the others' (`pricePooled`). */
  | 'loop'
  /** On a clock longer than the loop: fought when a lap finds it back, on top. */
  | 'added'
  /** Too dangerous to hunt: a pass or a room's spell takes `maxDanger` of the bar or more. */
  | 'dangerous'
  /** Undefeatable, or pays nothing. */
  | 'none';

/** An area, priced as a loop walks it. */
export interface GroundArea {
  key: string;
  name: string;
  map: number;
  /** Its groups, best first, each with how it counts. */
  groups: Array<{ group: GroundGroup; role: GroupRole; contributes: number }>;
  /** Its loop: the busy groups' lairs pooled and priced as one by MME; null where none pays. */
  loop: GroundGroup | null;
  /** The area's rate: the loop, less the time added groups take, plus what they pay. */
  expPerHour: number | null;
  /** One lap of the loop, in minutes. */
  lapMinutes: number | null;
  /** The worst danger of what it is hunted for, the loop's groups and those added. */
  danger: number | null;
  /** Something here pays, but all of it is too dangerous for the character. */
  tooDangerous: boolean;
  /** Fewest steps to its nearest room. */
  steps: number;
  /**
   * The loop it is walked by: the main group's lairs and the added groups'
   * rooms in walking order, each added room with its own clock in seconds.
   * Drawn for the best areas only; empty past them.
   */
  walk: Array<GroundRoom & { respawnSeconds?: number }>;
}

/** What the card is answered. */
export interface HuntingGrounds {
  from: { id: RoomId; name: string } | null;
  /** Rooms the sweep reached. */
  swept: number;
  areas: GroundArea[];
  /** Who it was priced for: the character, or the party (MME's party box). */
  party: { members: string[]; size: number } | null;
  /** How the character was priced to fight: its attack, heal and blessings, in words. */
  setup: string | null;
  refusal: string | null;
}

/**
 * How a character fights, read off its MegaMUD settings (the live ones, its
 * profile copy in use): what MME's Attack settings are filled from. Spells by
 * their short words; the Explorer numbers them from the realm.
 */
export interface HowItFights {
  /** `Combat.AttackCmd`, the word sent to attack (`bash`, `a`, `kick`…). */
  attack: string;
  /** `Combat.AttackSpl`: an attack spell, which MME prices instead of the swing. */
  attackSpell: string;
  /** `Combat.CanBackStab`: opens with a backstab. */
  backstab: boolean;
  /** `Spells.HealCmd`: the heal it casts. */
  heal: string;
  /** `Spells.BlessCmd1`–`10`: the blessings it keeps up, a heal-over-time among them counted as healing. */
  blessings: string[];
  /** `Health.MeditateB4Rest`: meditates for mana. */
  meditate: boolean;
  /**
   * The room spells it opens a fight with, in the order MegaMUD tries them
   * (`wantsRoomSpell`, `0x42c700`): the pre-multi-attack, then the
   * multi-attack. Only those switched on while scripting are here.
   */
  area: AreaAttack[];
}

/**
 * A room spell MegaMUD casts while enough monsters are in the room
 * (2026-10-29): `Combat.PreMultAttack` or `Combat.MultAttack`, with the
 * monsters it waits for (`…MstrCnt`), the casts a fight it makes at most
 * (`…CastCnt`), and the damage after which it stops (`…MaxDmg`).
 */
export interface AreaAttack {
  spell: string;
  monsters: number;
  casts: number;
  maxDamage: number;
}

/**
 * Whether the character is known well enough to price (2026-10-29): its
 * sheet read (class and level) and its pack listed (what it wears), and where
 * it stands. Before `stat` answers, MME priced one of Bowel's 609 lair groups
 * in reach; after it, before `i`, 79; with both, 465. The card asks again when
 * this turns true, so one opened before the character entered the realm fills
 * itself in.
 */
export function readyToPrice(state: CharacterState): boolean {
  return sheetRead(state) && state.room.map !== null && state.room.number !== null;
}

/** Its sheet read and its pack listed: what MME prices the character from. */
export function sheetRead(state: CharacterState): boolean {
  return (
    state.className !== null && state.progress.level !== null && state.inventory.listedAt !== null
  );
}

/** A character's way of fighting, from its MegaMUD settings' live sections. */
export function howItFights(
  live: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>
): HowItFights {
  const text = (section: string, key: string): string => {
    const value = live[section]?.[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const on = (section: string, key: string): boolean => {
    const value = live[section]?.[key];
    return typeof value === 'number' ? value !== 0 : value === true;
  };
  const count = (section: string, key: string, fallback: number): number => {
    const value = live[section]?.[key];
    return typeof value === 'number' ? value : fallback;
  };
  /*
   * Scripting, MegaMUD switches its room spells to the mode's defaults
   * (`modeDefaults`: `DefPreAttack2`, `DefNuke2`) unless *No mode defaults*
   * keeps the toolbar's own; the schema's defaults where a key is not stored.
   */
  const keepsOwn = count('MegaMud', 'NoModeDefs', 0) !== 0;
  const preAttack = count('MegaMud', keepsOwn ? 'AutoPreAttack' : 'DefPreAttack2', 1) !== 0;
  const nuke = count('MegaMud', keepsOwn ? 'AutoNuke' : 'DefNuke2', 1) !== 0;
  const area: AreaAttack[] = [];
  const roomSpell = (prefix: 'PreMult' | 'Mult'): void => {
    const spell = text('Combat', `${prefix}Attack`);
    const casts = count('Combat', `${prefix}CastCnt`, 1);
    if (spell === '' || casts <= 0) return;
    area.push({
      spell,
      monsters: count('Combat', `${prefix}MstrCnt`, 3),
      casts,
      maxDamage: count('Combat', `${prefix}MaxDmg`, 99999)
    });
  };
  // The pre-multi-attack wants pre-attacking and nuking both on (`attack.ts`, `0x42c700`).
  if (preAttack && nuke) roomSpell('PreMult');
  if (nuke) roomSpell('Mult');
  const blessings: string[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const short = text('Spells', `BlessCmd${i}`);
    if (short !== '') blessings.push(short);
  }
  return {
    attack: text('Combat', 'AttackCmd'),
    attackSpell: text('Combat', 'AttackSpl'),
    backstab: on('Combat', 'CanBackStab'),
    heal: text('Spells', 'HealCmd'),
    blessings,
    meditate: on('Health', 'MeditateB4Rest'),
    area
  };
}

/**
 * MME's attack type for an attack word (`ATTACK` in `mmud/combat.js`): bash 6,
 * smash 7, punch, kick or jumpkick 4 (martial arts, with which), anything else
 * a swing of the weapon, 1. Prefixes as the realm's abbreviations go.
 */
export function attackTypeOf(word: string): { type: number; ma: number } {
  const w = word.trim().toLowerCase();
  if (w === '') return { type: 1, ma: 0 };
  if ('bash'.startsWith(w) && w.length >= 2) return { type: 6, ma: 0 };
  if ('smash'.startsWith(w) && w.length >= 2) return { type: 7, ma: 0 };
  if ('punch'.startsWith(w) && w.length >= 2) return { type: 4, ma: 1 };
  if ('kick'.startsWith(w) && w.length >= 2) return { type: 4, ma: 2 };
  if (w === 'jk' || ('jumpkick'.startsWith(w) && w.length >= 2)) return { type: 4, ma: 3 };
  return { type: 1, ma: 0 };
}

/** A room name's area: the part before any comma, as `Volcano, Magma Tunnels` is the Volcano. */
export function areaStem(name: string): string {
  return (name.split(',')[0] ?? name).trim();
}

/** What `groupAreas` reads of a thing to group. */
export interface Placeable {
  key: string;
  /** `mob`, a monster on a clock of its own: it belongs to whatever place it stands in. */
  kind?: 'lair' | 'mob';
  rooms: ReadonlyArray<{ map: number; name: string }>;
  mobs: readonly string[];
}

/** An area as `groupAreas` finds it: its members in the order given. */
export interface Grouped<T extends Placeable> {
  key: string;
  name: string;
  map: number;
  members: T[];
}

/**
 * Things in reach into areas (2026-10-29). Two on one map are one area when
 * their rooms carry one name (`areaStem`), `near` says they lie close, and
 * they are lairs of a kind — they spawn a monster in common; a chain of such
 * is one place. The kind is the user's rule: the Undersea Cavern's plain dark
 * oceanid lairs are an area of their own, apart from what else spawns under
 * that name, and apart from the Ruined Palace beside them, whose lairs share
 * the dark oceanid but not the name. A monster on its own clock (a boss)
 * needs only the name and to be close: it belongs to the place it stands in,
 * as the beastmistress belongs to the palace. Close is asked too: a name such
 * as *Dark Tunnels* is given to several places on one map. Members keep the
 * order given and the areas take the order of their first member.
 */
export function groupAreas<T extends Placeable>(
  things: readonly T[],
  near: (a: T, b: T) => boolean
): Grouped<T>[] {
  const parent = things.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const join = (a: number, b: number): void => {
    const [x, y] = [root(a), root(b)];
    if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
  };
  const mapOf = (thing: T): number | null => thing.rooms[0]?.map ?? null;
  const spawns = things.map((thing) => new Set(thing.mobs.map((name) => name.toLowerCase())));
  /** Of a kind: a monster in common, or either a monster on its own clock. */
  const akin = (i: number, j: number): boolean =>
    things[i]!.kind === 'mob' ||
    things[j]!.kind === 'mob' ||
    [...spawns[i]!].some((mob) => spawns[j]!.has(mob));
  // Under one name on one map, of a kind and close: a chain of them is one place.
  const named = new Map<string, number[]>();
  things.forEach((thing, i) => {
    const map = mapOf(thing);
    if (map === null) return;
    for (const stem of new Set(thing.rooms.map((room) => areaStem(room.name).toLowerCase()))) {
      const key = `${map}|${stem}`;
      const before = named.get(key) ?? [];
      for (const j of before) {
        // Both ways: `near` may sweep only from a few of a large group's rooms.
        if (
          root(i) !== root(j) &&
          akin(i, j) &&
          (near(things[j]!, thing) || near(thing, things[j]!))
        ) {
          join(j, i);
        }
      }
      before.push(i);
      named.set(key, before);
    }
  });
  const members = new Map<number, T[]>();
  things.forEach((thing, i) => {
    if (mapOf(thing) === null) return;
    const at = root(i);
    members.set(at, [...(members.get(at) ?? []), thing]);
  });
  return [...members.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, list]) => {
      const lead = list[0]!;
      // The name most of its rooms carry, the first member's own on a tie.
      const counts = new Map<string, number>();
      for (const room of list.flatMap((thing) => thing.rooms)) {
        const stem = areaStem(room.name);
        counts.set(stem, (counts.get(stem) ?? 0) + 1);
      }
      let name = areaStem(lead.rooms[0]?.name ?? '');
      for (const [stem, count] of counts) if (count > (counts.get(name) ?? 0)) name = stem;
      return { key: lead.key, name, map: mapOf(lead)!, members: list };
    });
}

/**
 * Whether a priced group waits on its clock (2026-10-29): it spends less than
 * `clockBound` of the hour attacking and moving by MME's estimate — Fatty's
 * beastmistress 1% — or it is a monster on a clock of its own. Such a group is
 * fought when the loop finds it back, not walked as the loop.
 */
export function waitsOnClock(
  group: Pick<LairPrice, 'kind' | 'attack' | 'move'>,
  clockBound: number
): boolean {
  return group.kind === 'mob' || group.attack + group.move < clockBound;
}

/** Whether hunting a group takes `maxDanger` of the character's bar or more (`GroundGroup.danger`). */
export function tooDangerous(group: Pick<GroundGroup, 'danger'>, maxDanger: number): boolean {
  return (group.danger ?? 0) >= maxDanger;
}

/**
 * The groups an area's loop is made of, none too dangerous to hunt: those that pay and are busy — MME
 * pools them as it pools a monster's lairs (`pricePooled`) — or, where every
 * group waits on its clock, its lair groups that pay.
 */
export function loopGroups(
  groups: readonly GroundGroup[],
  clockBound: number,
  maxDanger: number
): GroundGroup[] {
  const paying = groups.filter(
    (group) =>
      (group.expPerHour ?? 0) > 0 && group.kind === 'lair' && !tooDangerous(group, maxDanger)
  );
  const busy = paying.filter((group) => !waitsOnClock(group, clockBound));
  return busy.length > 0 ? busy : paying;
}

/**
 * An area as a scripted loop walks it (2026-10-29).
 *
 * The **loop** is its busy groups pooled and priced as one by MME (`loop`,
 * from `loopGroups`): one lap is its lairs at the time a clear costs at its
 * rate. A group that waits on its clock (`waitsOnClock`) is **added**: fought
 * when the loop finds it back, which on average is half a lap after it is, so
 * it pays its own MME rate scaled by `respawn / (respawn + lap / 2)`, and the
 * time it takes comes off the loop's. Fatty's beastmistress came back every
 * 76–83 minutes on a 60-minute clock (2026-10-29).
 */
export function priceArea(
  groups: readonly GroundGroup[],
  loop: GroundGroup | null,
  clockBound: number,
  maxDanger: number
): Pick<GroundArea, 'groups' | 'loop' | 'expPerHour' | 'lapMinutes' | 'danger' | 'tooDangerous'> {
  const paying = (group: GroundGroup): number => group.expPerHour ?? 0;
  const ordered = [...groups].sort((a, b) => paying(b) - paying(a));
  const unsafe = (group: GroundGroup): boolean =>
    paying(group) > 0 && tooDangerous(group, maxDanger);
  if (loop === null || paying(loop) <= 0) {
    return {
      groups: ordered.map((group) => ({
        group,
        role: unsafe(group) ? 'dangerous' : 'none',
        contributes: 0
      })),
      loop: null,
      expPerHour: null,
      lapMinutes: null,
      danger: Math.max(0, ...groups.map((group) => group.danger ?? 0)),
      tooDangerous: groups.some(unsafe)
    };
  }
  const inLoop = new Set(loopGroups(groups, clockBound, maxDanger).map((group) => group.key));
  const lapMinutes = (loop.lairs * loop.expPerClear * 60) / paying(loop);
  let taken = 0;
  let added = 0;
  const roles = ordered.map((group) => {
    if (inLoop.has(group.key)) return { group, role: 'loop' as const, contributes: 0 };
    if (unsafe(group)) return { group, role: 'dangerous' as const, contributes: 0 };
    if (paying(group) <= 0) return { group, role: 'none' as const, contributes: 0 };
    const factor = group.respawnMinutes / (group.respawnMinutes + lapMinutes / 2);
    taken += (group.attack + group.move) * factor;
    const contributes = paying(group) * factor;
    added += contributes;
    return { group, role: 'added' as const, contributes };
  });
  const loopShare = paying(loop) * Math.max(0, 1 - taken);
  const hunted = roles.filter((entry) => entry.role === 'loop' || entry.role === 'added');
  return {
    groups: roles,
    loop,
    expPerHour: loopShare + added,
    lapMinutes,
    danger: Math.max(0, ...hunted.map((entry) => entry.group.danger ?? 0)),
    tooDangerous: false
  };
}
