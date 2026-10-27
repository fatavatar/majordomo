/**
 * The Party card's rows (2026-10-27): the roster the player arranged, read
 * against what the realm says this minute and against what this client's own
 * characters know about themselves.
 *
 * Three sources, in order of trust:
 *
 * 1. **A character of this client's** knows its own figures exactly — its
 *    prompt, its room, whether it is fighting — and whether it is connected
 *    at all. That is the cross-tab half: every tab's state is already in the
 *    window, so a member who is one of ours is read from their own tab, not
 *    from a percentage in somebody else's listing.
 * 2. **A party listing** — the leader's when the leader is ours, else any of
 *    ours that has one — says who is in the party, who is only invited, and
 *    everybody else's health as a share.
 * 3. **The roster** says who should be there, who leads and where they stand.
 */
import type { CharacterState, PartyActivity, PartyMember } from '@shared/character';
import { ratio } from '@shared/character';
import { isForgotten, sameName, type PartyRoster, type RosterRank } from '@shared/partyRoster';
import type { SessionId } from '@shared/ipc';

/** One of this client's characters on the realm. */
export interface OurMember {
  session: SessionId;
  character: CharacterState;
  /** Connected and in the game; a character at a menu cannot be invited. */
  inGame: boolean;
}

/**
 * Where a member stands against the roster.
 *
 * `out` is the case Regroup exists for: on the roster, in the game as far as
 * anybody knows, and not in the party. `offline` is one of ours that is not
 * in the game, which no invitation reaches.
 */
export type MemberStatus = 'in' | 'invited' | 'out' | 'offline' | 'forgotten';

export interface BoardRow {
  name: string;
  leader: boolean;
  /** The session when the member is one of this client's characters. */
  ours: SessionId | null;
  rank: RosterRank | null;
  /** The roster's own rank, as opposed to the listing's: what the editor shows. */
  rosterRank: RosterRank | null;
  status: MemberStatus;
  className: string | null;
  health: number | null;
  mana: number | null;
  vitals: PartyMember['vitals'];
  /** Maximum health guessed from damage seen, for a member whose client never said it. */
  hpMaxGuess: number | null;
  activity: PartyActivity | { state: 'fighting' } | null;
  /** The room a member of ours is in, when it is not the leader's. */
  away: string | null;
}

/** `name`'s row in the first listing that has one: the leader's first. */
function listed(listings: readonly CharacterState[], name: string): PartyMember | null {
  for (const character of listings) {
    const found = character.party.members.find((member) => sameName(member.name, name));
    if (found) return found;
  }
  return null;
}

function ourOf(ours: readonly OurMember[], name: string): OurMember | null {
  return ours.find((m) => m.character.name !== null && sameName(m.character.name, name)) ?? null;
}

const sameRoom = (a: CharacterState, b: CharacterState): boolean | null =>
  a.room.map === null || a.room.number === null || b.room.map === null || b.room.number === null
    ? null
    : a.room.map === b.room.map && a.room.number === b.room.number;

/** A row for `name`, from whichever sources know about them. */
function rowFor(
  name: string,
  leaderName: string | null,
  rosterRank: RosterRank | null,
  forgotten: boolean,
  ours: readonly OurMember[],
  listings: readonly CharacterState[],
  fallbackStatus: MemberStatus
): BoardRow {
  const own = ourOf(ours, name);
  const entry = listed(listings, name);
  const leader = leaderName !== null && sameName(name, leaderName);
  const leading = leaderName === null ? null : ourOf(ours, leaderName);

  let status: MemberStatus;
  if (own !== null && !own.inGame) status = 'offline';
  else if (forgotten) status = 'forgotten';
  else if (entry !== null) status = entry.invited ? 'invited' : 'in';
  // A leader of ours who is in the game is the party, listing or none.
  else if (leader && own !== null) status = 'in';
  else status = fallbackStatus;

  let health = entry?.health ?? null;
  let mana = entry?.mana ?? null;
  let vitals = entry?.vitals ?? null;
  let activity: BoardRow['activity'] = entry?.activity ?? null;
  let away: string | null = null;
  if (own !== null) {
    const { hp, hpMax, mana: ma, manaMax, resting, meditating } = own.character.vitals;
    health = ratio(hp, hpMax) ?? health;
    mana = ratio(ma, manaMax) ?? mana;
    if (hp !== null && hpMax !== null) vitals = { hp, hpMax, mana: ma, manaMax };
    activity = own.character.inCombat
      ? { state: 'fighting' }
      : resting
        ? { state: 'resting' }
        : meditating
          ? { state: 'meditating' }
          : null;
    if (leading !== null && leading !== own && sameRoom(own.character, leading.character) === false)
      away = own.character.room.name;
  }
  return {
    name: entry?.name ?? own?.character.name ?? name,
    leader,
    ours: own?.session ?? null,
    rank: rosterRank ?? entry?.rank ?? null,
    rosterRank,
    status,
    className: entry?.className ?? own?.character.className ?? null,
    health,
    mana,
    vitals,
    hpMaxGuess: own === null ? (entry?.hpMaxGuess ?? null) : null,
    activity,
    away
  };
}

/**
 * Every row the card draws: the roster's members when there is a roster,
 * leader first; else whoever `self`'s own listing names, as the card always
 * drew them.
 */
export function boardRows(
  roster: PartyRoster | null,
  self: CharacterState,
  ours: readonly OurMember[]
): BoardRow[] {
  if (roster === null) {
    const head = self.party.following ?? self.name;
    const rows = self.party.members.map((member) =>
      rowFor(member.name, head, null, false, ours, [self], 'in')
    );
    return rows.sort((a, b) => Number(b.leader) - Number(a.leader));
  }
  const leading = roster.leader === null ? null : ourOf(ours, roster.leader);
  const listings = [
    ...(leading !== null ? [leading.character] : []),
    self,
    ...ours.map((m) => m.character)
  ].filter((character, index, all) => all.indexOf(character) === index);
  const rows = roster.members.map((member) =>
    rowFor(
      member.name,
      roster.leader,
      member.rank,
      isForgotten(roster, member.name),
      ours,
      listings,
      'out'
    )
  );
  return rows.sort((a, b) => Number(b.leader) - Number(a.leader));
}

/** How many rows are travelling together, against how many should be. */
export function together(rows: readonly BoardRow[]): { in: number; of: number } {
  return {
    in: rows.filter((row) => row.status === 'in').length,
    of: rows.filter((row) => row.status !== 'forgotten').length
  };
}

/**
 * A roster made from the party as it stands: whoever `self`'s listing names,
 * plus `self`, led by whoever `self` follows (or `self`). The ranks are the
 * listing's.
 */
export function rosterFromListing(id: string, realm: string, self: CharacterState): PartyRoster {
  const members = self.party.members
    .filter((member) => !member.invited)
    .map((member) => ({ name: member.name, rank: member.rank }));
  const name = self.name;
  if (name !== null && !members.some((member) => sameName(member.name, name)))
    members.unshift({ name, rank: null });
  const head = self.party.following ?? name;
  return {
    id,
    realm,
    leader: members.find((member) => head !== null && sameName(member.name, head))?.name ?? null,
    members,
    regroup: true,
    forgotten: [],
    places: []
  };
}
