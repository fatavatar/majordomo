/**
 * `0x4c14b0`: who is online, read 2026-10-12. The `who` listing (in either
 * of its forms: alignment, name, `- title of gang`, or the `Title` columns)
 * fills the who list; each player is learned or brought up to date (surname,
 * gang, alignment, and the class and level their title implies); a player
 * in this character's gang is taken as a friend. Arrivals and departures
 * (`just entered the Realm`, `just left the Realm`, `just hung up!!!`) keep
 * the list current between listings. `LineFlag.WhoTitled` (the first form),
 * `WhoPlain` (the second), `WhoRowSeen` (a row seen); state `State.Who`.
 */
import { indexFrom, indexOf, splitWord, trimSpaces } from '../cstr';
import { newPlayer, type PlayerRec } from '../data';
import { findPlayer, partyIndex } from '../room/checkNames';
import { removeEntity } from '../room/entities';
import { forgetAwaited, setState } from '../script/state';
import type { Session } from '../Session';
import { GREATERMUD_TITLES, TITLES } from './titles';
import { State } from '../states';
import { LineFlag, WHO_LISTING, PlayerFlag, PartyFlag, Stance, EntityType } from '../flags';

/** One row of the listing, as read. */
interface Row {
  name: string;
  surname: string;
  alignment: number;
  gang: string;
  title: string;
}

const ALIGNMENTS: [string, number][] = [
  ['Lawful', 1],
  ['Saint', 2],
  ['Good', 3],
  ['', 4],
  ['Neutral', 4],
  ['Seedy', 5],
  ['Outlaw', 6],
  ['Criminal', 7],
  ['Villain', 8],
  ['FIEND', 9]
];

/** The alignment column: its word padded to `width` (right-aligned and a space in the first form). */
function alignmentOf(text: string, width: number, right: boolean): number {
  for (const [word, n] of ALIGNMENTS) {
    // The first form has no "Neutral" (a neutral player's column is blank).
    if (right && word === 'Neutral') continue;
    const padded = right ? word.padStart(width - 1) + ' ' : word.padEnd(width);
    if (text.startsWith(padded)) return n;
  }
  return 0;
}

/** `0x4c1d00`: `   Saint Damyr SmashEm         -  Demonhunter of Gang`. */
function adventurerRow(s: Session, line: string): Row | null {
  const alignment = alignmentOf(line, 9, true);
  if (alignment === 0) return null;
  let [name, rest] = splitWord(line.slice(9), ' ', 0xb);
  let surname = '';
  if (!rest.startsWith('- ') && !rest.startsWith('x '))
    [surname, rest] = splitWord(rest, ' ', 0x13);
  name = trimSpaces(name);
  if (name === '' || !/[A-Za-z]/.test(name[0]!)) return null;
  if (rest[0] !== '-' && rest[0] !== 'x') return null;
  const offset = line.length - rest.length + 1;
  let src = rest.slice(1);
  const lead = src.length - src.replace(/^ +/, '').length;
  src = src.slice(lead);
  let of = indexOf(src, ' of ');
  // A gang is shown in green: an " of " in another colour is part of the title.
  if (of !== -1 && s.line.attr[offset + lead + of + 1] !== 2) of = indexFrom(src, of + 4, ' of ');
  if (of !== -1) {
    return {
      name,
      surname,
      alignment,
      title: trimSpaces(src.slice(0, of)),
      gang: trimSpaces(src.slice(of + 4, of + 4 + 20))
    };
  }
  return { name, surname, alignment, title: trimSpaces(src.slice(0, 49)), gang: '' };
}

/** `0x4c1fc0`: the `Title` columns: title, name and surname, alignment, gang. */
function titleRow(line: string): Row | null {
  if (line.length <= 0x10) return null;
  const title = trimSpaces(line.slice(0, 0x10));
  const [name0, rest] = splitWord(line.slice(0x10, 0x24), ' ', 0xb);
  const [surname] = splitWord(rest, ' ', 0x13);
  const name = trimSpaces(name0);
  if (name === '' || !/[A-Za-z]/.test(name[0]!)) return null;
  const alignment = alignmentOf(line.slice(0x27), 11, false);
  if (alignment === 0) return null;
  let gang = trimSpaces(line.slice(0x32, 0x32 + 20));
  if (gang === 'None') gang = '';
  return { name, surname, alignment, title, gang };
}

/** `0x4c1450`: two titles are the same, spaces and case aside. */
function sameTitle(a: string, b: string): boolean {
  return a.replace(/ /g, '').toUpperCase() === b.replace(/ /g, '').toUpperCase();
}

/**
 * `0x4c12b0`: the class and level a title implies: a level is a guess
 * (`flags` 2) until known, and moves when it falls outside the title's
 * range (four levels; open-ended at the top titles).
 */
function titleLevel(s: Session, p: PlayerRec, title: string): void {
  if (title === 'Apprentice') {
    if (p.level !== 1) {
      p.flags &= ~PlayerFlag.LevelGuessed;
      p.level = 1;
      s.playersChanged = 1;
    }
    return;
  }
  const greater = s.BBS_GreaterMUD !== 0;
  const top = greater ? 100 : 0x46;
  for (const [cls, name, level] of greater ? GREATERMUD_TITLES : TITLES) {
    if (!sameTitle(title, name)) continue;
    let upper = level === 2 ? 4 : level + 4;
    if (level >= top) upper = 9999;
    if (p.cls !== cls) {
      p.cls = cls;
      s.playersChanged = 1;
    }
    if (p.level < level || upper < p.level) {
      if (p.name !== s.Player_Name) p.level = level;
      p.flags |= PlayerFlag.LevelGuessed;
      s.playersChanged = 1;
    }
    if ((p.flags & PlayerFlag.LevelGuessed) !== 0 && p.level !== level) {
      p.level = level;
      s.playersChanged = 1;
    }
  }
}

/** The listing is over. */
function listingDone(s: Session): number {
  s.lineFlags &= ~WHO_LISTING;
  forgetAwaited(s, State.Who);
  setState(s, State.Nothing);
  return 0;
}

/** One row: the player learned or brought up to date, and listed as online. */
function listed(s: Session, row: Row, titleForm: boolean): void {
  s.lineFlags |= LineFlag.WhoRowSeen;
  s.whoQuietAt = s.host.tickMs();
  let p = findPlayer(s, row.name);
  if (!p) {
    p = newPlayer(s.data, s.now);
    Object.assign(p, {
      name: row.name.slice(0, 10),
      surname: row.surname.slice(0, 18),
      alignment: row.alignment,
      gang: row.gang.slice(0, 20),
      kind: 0,
      level: 1,
      flags: 5,
      seenAt: s.now
    });
    s.playersChanged = 1;
    s.host.show(`[${row.name} added to known players]`);
  } else {
    p.flags |= PlayerFlag.OnWhoList;
    p.seenAt = s.now;
    s.playersChanged = 1;
    if (p.alignment !== row.alignment) p.alignment = row.alignment;
    if (p.surname !== row.surname) {
      // The title form cuts surnames short: a known one that starts the same is kept.
      const truncated =
        titleForm && p.surname !== '' && row.surname !== '' && p.surname.startsWith(row.surname);
      if (!truncated) {
        if (p.surname !== '') s.host.show(`[${row.name}'s surname updated]`);
        p.surname = row.surname.slice(0, 18);
      }
    }
    if (p.gang !== row.gang) {
      if (p.gang !== '') s.host.show(`[${row.name}'s gang updated]`);
      p.gang = row.gang.slice(0, 20);
    }
  }
  if (row.name === s.Player_Name) {
    s.Player_Gang = row.gang.slice(0, 20);
    p.cls = s.Player_Class;
    p.race = s.Player_Race;
    p.level = s.Player_Level;
    p.kind = Stance.Friend;
    p.flags =
      (p.flags & ~(PlayerFlag.DetailsUnknown | PlayerFlag.LevelGuessed)) |
      PlayerFlag.ConfirmedPlayer;
    s.playersChanged = 1;
  }
  if (s.Player_Gang !== '' && p.gang === s.Player_Gang && p.kind === Stance.Unknown) {
    p.kind = Stance.Friend;
    s.playersChanged = 1;
    s.host.show(`[${row.name} assumed to be friend]`);
  }
  if (p.name !== s.Player_Name) {
    const was = p.level;
    titleLevel(s, p, row.title);
    if (p.level !== was) {
      if (was > 1) s.host.show(`[${row.name}'s level updated]`);
      s.playersChanged = 1;
      p.flags &= ~PlayerFlag.LookedAt;
    }
  }
  s.whoList.push({ kind: 0, name: row.name.slice(0, 30), player: p });
}

/** The first word of a line (a name), up to 10 characters. */
function firstName(line: string): string {
  return line.slice(0, 11).split(' ')[0]!;
}

export function whoLine(s: Session, line: string): number {
  if (indexOf(line, ' just entered the Realm') !== -1) {
    const name = firstName(line);
    const p = findPlayer(s, name);
    const entry = { kind: 3, name, player: p };
    if (!p) {
      s.whoDue = 1;
    } else {
      entry.kind = p.kind;
      p.seenAt = s.now;
      p.flags |= PlayerFlag.OnWhoList;
      s.playersChanged = 1;
    }
    s.whoList.push(entry);
    if (p && (p.flags & PlayerFlag.AlertOnEnter) !== 0) s.host.alert?.('playerEntered');
    return 1;
  }
  if (indexOf(line, ' just left the Realm') !== -1 || indexOf(line, ' just hung up!!!') !== -1) {
    const name = firstName(line);
    const gone = s.whoList.findIndex((w) => w.name === name);
    if (gone !== -1) s.whoList.splice(gone, 1);
    for (let i = s.room.length - 1; i >= 0; i -= 1) {
      if (s.room[i]!.type === EntityType.Player && s.room[i]!.name === name) {
        removeEntity(s, i);
        break;
      }
    }
    if (s.chaseTarget === name) s.chaseTarget = '';
    const i = partyIndex(s, name);
    if (i !== -1) {
      const m = s.party[i]!;
      s.partyWaitAt = s.now;
      m.flags28 = (m.flags28 & ~PartyFlag.Invited) | PartyFlag.Offline;
      m.leftAt = s.now;
    }
    return 1;
  }
  if ((s.lineFlags & (LineFlag.WhoTitled | LineFlag.WhoPlain)) === 0) {
    s.lineFlags &= ~LineFlag.WhoRowSeen;
    let form: number;
    if (indexOf(line, '  Current Adventurers') !== -1 || line.startsWith('Current Adventurers')) {
      form = 0x80;
    } else if (indexOf(line, 'Title   ') !== -1) {
      form = 0x100;
    } else {
      return 0;
    }
    setState(s, State.Who);
    s.lineFlags = (s.lineFlags & ~LineFlag.Prompted) | form;
    s.whoList = [];
    return 1;
  }
  if ((s.lineFlags & LineFlag.Prompted) !== 0) return listingDone(s);
  const titleForm = (s.lineFlags & LineFlag.WhoTitled) === 0;
  const row = titleForm ? titleRow(line) : adventurerRow(s, line);
  if (!row) return (s.lineFlags & LineFlag.WhoRowSeen) === 0 ? 0 : listingDone(s);
  listed(s, row, titleForm);
  return 1;
}
