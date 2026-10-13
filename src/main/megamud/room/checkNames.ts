/**
 * Sorting the room's entries into players, monsters and items, and learning
 * the ones MegaMUD has never seen: `CheckNames` (`0x471a10`) and the lookups
 * it uses. Read 2026-10-12.
 */
import { indexFrom, indexOf, strcmp, stricmp, trimSpaces } from '../cstr';
import {
  newItem,
  newMonster,
  newPlayer,
  type ItemRec,
  type MonsterRec,
  type PlayerRec
} from '../data';
import { hangUp } from '../script/game';
import { queue } from '../script/send';
import type { RoomEntity, Session } from '../Session';
import { removeEntity } from './entities';

/** MajorMUD's random monster adjectives (the table at `0x564300`). */
export const ADJECTIVES = [
  'angry',
  'big',
  'fat',
  'fierce',
  'happy',
  'large',
  'nasty',
  'short',
  'small',
  'tall',
  'thin'
];

/** `0x474d70`: a name without one leading adjective ("big rat" is "rat"). */
export function stripAdjective(name: string): string {
  for (const adj of ADJECTIVES) {
    if (name.startsWith(adj) && name[adj.length] === ' ') return name.slice(adj.length + 1);
  }
  return name;
}

/**
 * `0x46f9f0`: `name` occurs in `text` as whole words: at the start or after a
 * space, and followed by the end, a space, `.`, `,` or `'`.
 */
export function nameIn(text: string, name: string): number {
  if (name.length === 0) return 0;
  for (let at = indexOf(text, name); at !== -1; at = indexFrom(text, at + 1, name)) {
    const after = text[at + name.length];
    if (
      (at === 0 || text[at - 1] === ' ') &&
      (after === undefined || after === ' ' || after === '.' || after === ',' || after === "'")
    ) {
      return 1;
    }
  }
  return 0;
}

/**
 * Find first (flag 8) set on every monster whose name holds another's as
 * whole words, and those put in front longest first, so `findMonster` takes
 * `forgotten dragon slayer` for itself rather than for the `forgotten dragon`
 * its name holds. MegaMUD leaves the flag to be set by hand (its Monster
 * Details' *Find first*); our monster table always means the longest name
 * (`ruleFor`), so the engine sets it wherever it is needed (2026-10-13: the
 * slayer, read as the dragon, was fought with the dragon's settings).
 */
export function findLongestFirst(s: Session): void {
  const monsters = s.data.monsters;
  for (const m of monsters) {
    if (monsters.some((o) => o.name.length < m.name.length && nameIn(m.name, o.name) !== 0))
      m.flags |= 8;
  }
  const first = monsters
    .filter((m) => (m.flags & 8) !== 0)
    .sort((a, b) => b.name.length - a.name.length);
  s.data.monsters = [...first, ...monsters.filter((m) => (m.flags & 8) === 0)];
}

/** `0x46c3f0`: the monster whose name `text` holds; "find first" monsters (flag 8) are tried first. */
export function findMonster(s: Session, text: string): MonsterRec | null {
  for (const m of s.data.monsters) if ((m.flags & 8) !== 0 && nameIn(text, m.name) !== 0) return m;
  for (const m of s.data.monsters) if ((m.flags & 8) === 0 && nameIn(text, m.name) !== 0) return m;
  return null;
}

/** `0x491a50`: the known player of this name (without regard to case). */
export function findPlayer(s: Session, name: string): PlayerRec | null {
  if (name === '') return null;
  return s.data.players?.find((p) => stricmp(name, p.name) === 0) ?? null;
}

/** `0x472e70`: 1 to 10 letters, the shape of a player's name. */
export function looksLikeName(name: string): number {
  return name.length >= 1 && name.length <= 10 && /^[A-Za-z]+$/.test(name) ? 1 : 0;
}

/**
 * `0x45a100`: the same item, apostrophes aside, or one the other's plural by
 * a trailing `s`.
 */
export function sameItem(a: string, b: string): boolean {
  const x = a.slice(0, 99).replace(/'/g, '');
  const y = b.slice(0, 99).replace(/'/g, '');
  if (strcmp(x, y) === 0) return true;
  if (x.length === y.length + 1 && x[x.length - 1] === 's' && x.startsWith(y)) return true;
  if (x.length + 1 === y.length && y[y.length - 1] === 's' && y.startsWith(x)) return true;
  return false;
}

/**
 * `0x456770`: the item record for this name. The coins first, by their full
 * names or bare words; then the realm's items.
 */
export function findItem(s: Session, name: string): ItemRec | null {
  const coins = s.data.items.slice(0, 5);
  for (const coin of coins) if (sameItem(name, coin.name)) return coin;
  const bare: Record<string, number> = { copper: 0, silver: 1, gold: 2, platinum: 3 };
  if (name in bare) return coins[bare[name]!] ?? null;
  if (sameItem(name, 'runic') || sameItem(name, s.runicName)) return coins[4] ?? null;
  for (const item of s.data.items.slice(5)) if (sameItem(name, item.name)) return item;
  return null;
}

/** `0x453400`: a coin's worth in copper, or 0 for anything else. */
export function coinValue(s: Session, name: string): number {
  if (sameItem(name, 'copper farthing')) return 1;
  if (sameItem(name, 'silver noble')) return 10;
  if (sameItem(name, 'gold crown')) return 100;
  if (sameItem(name, 'platinum piece')) return 10000;
  if (sameItem(name, 'runic coin') || sameItem(name, s.runicName)) return 1000000;
  return 0;
}

/** `0x47dcd0`: the party member of this name, or -1. */
export function partyIndex(s: Session, name: string): number {
  for (let i = 0; i < s.partySize && i < s.party.length; i += 1) {
    if (stricmp(s.party[i]!.name, name) === 0) return i;
  }
  return -1;
}

/**
 * `0x472ca0`: a player within `PvP.LevelRange` of this character's level (its
 * level, or the range a guessed level stands for, flag 2).
 */
export function playerInRange(s: Session, p: PlayerRec | null): number {
  if (!p) return 0;
  const mine = s.Player_Level;
  const range = s.pvpLevel;
  if (mine === 0 || p.level === 0 || range === 0 || p.level === 1) return 0;
  let other = p.level;
  if ((p.flags & 2) !== 0) other = p.level === 2 ? 4 : p.level + 4;
  return Math.abs(mine - p.level) <= range || Math.abs(mine - other) <= range ? 1 : 0;
}

/** `0x42e070`: hanging up is allowed now. */
export function hangupAllowed(s: Session): number {
  let ok = 1;
  if (s.f_a32c !== 0 && s.Other_HangupAllOff === 0) ok = 0;
  if (s.active === 0 && s.Other_HangupNotAfk === 0) ok = 0;
  if (s.f_8130 === 0x67110001 || s.state === 7 || s.state === 8 || s.state === 0x2a) ok = 0;
  return s.MegaMud_NoHangup === 0 ? ok : 0;
}

/** `0x471400`: marks remembered for monsters by name (`0x2524`, 36-byte entries) applied to those here. */
export function applyMonsterMarks(s: Session): void {
  for (const e of s.room) {
    if (e.type !== 2) continue;
    for (const mark of s.monsterMarks) {
      if (stricmp(e.name, mark.name) === 0 || (e.mon && stricmp(e.mon.name, mark.name) === 0)) {
        e.flags |= mark.flags;
        break;
      }
    }
  }
}

/** `0x4714e0`: marks remembered for players by name (`0x6b78`, 16-byte entries) applied to those here. */
export function applyPlayerMarks(s: Session): void {
  for (const e of s.room) {
    if (e.type !== 1) continue;
    for (const mark of s.playerMarks) {
      if (stricmp(e.name, mark.name) === 0) {
        e.flags |= mark.flags;
        break;
      }
    }
  }
}

/** `0x471060`: mark the monsters of this name here, and remember it (up to 500 names). */
export function markMonsters(s: Session, name: string, flags: number): number {
  let marked = 0;
  for (const e of s.room) {
    if (e.type !== 2) continue;
    if (stricmp(e.name, name) === 0 || (e.mon && stricmp(e.mon.name, name) === 0)) {
      e.flags |= flags;
      marked += 1;
    }
  }
  if (marked > 0) {
    const known = s.monsterMarks.find((m) => stricmp(m.name, name) === 0);
    if (known) known.flags |= flags;
    else if (s.monsterMarks.length < 500) s.monsterMarks.push({ name: name.slice(0, 30), flags });
  }
  return marked;
}

/** `0x471300`: mark the players of this name here, and remember it (up to 100 names). */
export function markPlayers(s: Session, name: string, flags: number): number {
  let marked = 0;
  for (const e of s.room) {
    if (e.type === 1 && stricmp(e.name, name) === 0) {
      e.flags |= flags;
      marked += 1;
    }
  }
  if (marked === 0 && flags === 0) return 0;
  const known = s.playerMarks.find((m) => stricmp(m.name, name) === 0);
  if (known) known.flags |= flags;
  else if (s.playerMarks.length < 100) s.playerMarks.push({ name: name.slice(0, 10), flags });
  return marked;
}

/** The ten exit words, in `0x813c`'s order (`0x4c03b0`). */
const EXIT_WORDS = [
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
  'up',
  'down'
];

/**
 * `0x471a10`: every room entry is tidied (a trailing `*` dropped), then
 * sorted out by its name: a known player, a known monster, an item, or, for
 * a capitalised name of up to ten letters MegaMUD does not know, a player it
 * asks about once (the room is re-read) and then learns. A monster it does
 * not know is learned too. Party members are friends; a player out of PvP
 * range is not to be attacked (kind 5); an entry the realm says to hang up on
 * (kind 6) hangs up. Seeing a player stamps where and when.
 */
export function checkNames(s: Session): void {
  for (let i = 0; i < s.room.length; i += 1) {
    const e = s.room[i]!;
    e.name = trimSpaces(e.name);
    if (e.name.endsWith('*')) e.name = e.name.slice(0, -1);
    if (e.name.length === 0) {
      removeEntity(s, i);
      i -= 1;
      continue;
    }
    const name = e.name;
    let asPlayer = false;
    if (e.type === 0) {
      let notPlayer: boolean;
      if (looksLikeName(name) === 0) notPlayer = true;
      else if (/^[a-z]/.test(name)) notPlayer = true;
      else {
        e.player = findPlayer(s, name);
        notPlayer = false;
        if (!e.player && s.f_e2a4 !== 0) {
          if (s.debug !== 0) s.host.trace(`{who-${name}}`);
          s.f_e2a4 = -1;
        }
      }
      let mon = e.mon;
      if (!mon) {
        mon = findMonster(s, name);
        e.mon = mon;
      }
      if (e.player) {
        e.kind = e.player.kind;
        e.type = 1;
        asPlayer = true;
      } else if (!mon) {
        if (!notPlayer) {
          if (s.s_2500 !== name) {
            s.s_2500 = name.slice(0, 30);
            removeEntity(s, i);
            s.f_32390 = 0;
            s.f_e290 = 1;
            return;
          }
          s.s_2500 = '';
          e.type = 1;
          e.kind = 3;
          asPlayer = true;
        } else {
          e.type = 2;
          if (e.kind === 0) e.kind = 3;
        }
      } else {
        e.kind = mon.relationship === 0 ? 3 : mon.relationship;
        e.type = 2;
      }
    } else if (e.type === 1) {
      asPlayer = true;
    }
    if (asPlayer && !e.player) {
      e.player = findPlayer(s, name);
      if (!e.player) {
        const p = newPlayer(s.data, s.now);
        p.name = name.slice(0, 10);
        p.kind = e.kind;
        p.flags |= 1;
        e.player = p;
        s.host.show(`[${name} added to known players]`);
        s.f_e24c = 1;
      }
    }
    if (e.type === 2 && !e.mon) {
      e.mon = findMonster(s, name);
      if (!e.mon) {
        const m = newMonster(s.data);
        m.name = stripAdjective(name).slice(0, 30);
        m.relationship = 0;
        m.flags |= 2;
        e.mon = m;
        s.host.show(`[${m.name} added to known monsters]`);
        s.f_e254 = 1;
      }
    }
    if (e.type === 3) {
      if (!e.item && (e.flags & 0x18000) === 0) {
        const item = findItem(s, name);
        if (!item) {
          const rec = newItem(s.data);
          rec.name = name.slice(0, 30);
          rec.flags |= 1;
          rec.weight = -1;
          e.item = rec;
          s.host.show(`[${name} added to known items]`);
          s.f_e258 = 1;
        } else {
          e.item = item;
          e.name = item.name.slice(0, 30);
          if ((item.flags & 0x2000000) !== 0) {
            item.flags &= ~0x2000000;
            if ((item.flags & 1) !== 0) {
              item.flags |= 0x40;
              s.f_e258 = 1;
              s.host.show(`[Item ${item.name} marked as un-gettable]`);
            }
          }
        }
      }
      if (e.type === 3) {
        for (let j = s.room.length - 1; j > i; j -= 1) {
          if (sameItem(e.name, s.room[j]!.name)) {
            e.count += s.room[j]!.count;
            removeEntity(s, j);
          }
        }
      }
    }
    if (partyIndex(s, e.name) !== -1) e.kind = 2;
    if (e.type === 1 && e.kind === 4 && playerInRange(s, e.player) === 0) e.kind = 5;
    if (e.type !== 3 && e.kind === 6 && s.f_8130 !== 0x67110001 && hangupAllowed(s) !== 0) {
      s.host.trace(`[Hangup player/monster detected (${e.name})]`);
      s.f_30de8 = 1;
      s.f_30de4 = 1;
      hangUp(s, 1);
    }
    if (e.player) sawPlayer(s, e, e.player);
    if (e.player && (e.player.flags & 0x40) !== 0) s.chaseTarget = e.name.slice(0, 10);
    if (e.mon) s.MegaMud_LastEditMonster = e.name.slice(0, 30);
    if (e.item) s.MegaMud_LastEditItem = e.name.slice(0, 30);
  }
  applyMonsterMarks(s);
  applyPlayerMarks(s);
  s.s_2500 = '';
}

/** `0x471a10`'s note on a player seen: where, when, and a greeting a day after the last. */
function sawPlayer(s: Session, e: RoomEntity, p: PlayerRec): void {
  const exits = EXIT_WORDS.filter((_, i) => (s.roomExits[i] ?? 0) !== 0).map(
    (w) => w.toUpperCase().slice(0, 1) + w.slice(1)
  );
  p.where = `${s.roomName} (Exits: ${exits.length > 0 ? exits.join(', ') : 'none'})`.slice(0, 0x4f);
  if ((p.flags & 0x8000) === 0) {
    p.flags |= 0x8000;
    if (p.seen === 0) s.f_32528 += 1;
    p.seen += 1;
  }
  s.MegaMud_LastEditPlayer = e.name.slice(0, 10);
  if (s.now - p.greetedAt > 0x15180) {
    p.flags &= ~0x20000;
    if (s.Talk_GreetPlayers !== 0 && s.f_a32c === 0 && p.kind === 2) queue(s, `greet ${p.name}\r`);
  }
  p.seenAt = s.now;
  p.greetedAt = s.now;
  s.f_e24c = 1;
}
