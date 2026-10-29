/**
 * A party as the player arranged it (2026-10-27): who belongs in it, who
 * leads, and where each stands — the Party card's roster.
 *
 * The realm's own listing (`Party` in `character.ts`) says who **is**
 * travelling together this minute; a roster says who **should** be. The two
 * differ exactly when the card is worth having: a member relogged, fell
 * behind, or never got the invite. The roster is what the card draws and what
 * Regroup puts back.
 *
 * Made from the card, case by case, and edited there while playing — not a
 * setting. Members are names: a character of this client's, or anybody else
 * on the realm, since a party is not limited to the characters one person
 * runs. A name is in at most one roster per realm (`PartyBook` keeps that),
 * so every character of this client's on the realm finds the same one.
 */

export type RosterRank = 'front' | 'mid' | 'back';

export interface RosterMember {
  /** As the realm prints it. Compared case-insensitively (`sameName`). */
  name: string;
  /** Where they stand; null leaves it to the realm's listing. */
  rank: RosterRank | null;
}

export interface PartyRoster {
  id: string;
  /** The realm's name, as a character's file names its server. */
  realm: string;
  /** Who leads, one of `members`; null until somebody is chosen. */
  leader: string | null;
  members: RosterMember[];
  /**
   * Put a member back who has dropped out of the party. On by default.
   * A member who sent `@forget` is left out (`forgotten`) until put back.
   */
  regroup: boolean;
  /**
   * Members who asked to be left out with `@forget`: still on the roster,
   * never invited back by Regroup until the player puts them back on the card.
   */
  forgotten: string[];
  /**
   * Where Muster can send the party by `sys goto`, as the realm's own words
   * for them (`kha`, `sil`, `lost`): for a character whose MegaMUD settings
   * say it is a MudOp (`BBS.IsMudop`). Seeded with the characters' own
   * MegaMUD `SysGoto` word when the roster is made.
   */
  places: string[];
}

/** Where the card's Muster sends the party: to the leader, or by `sys goto` to a place. */
export type MusterTarget = { to: 'leader' } | { to: 'place'; place: string };

/** A `sys goto` word, as a realm takes one: a few letters, digits or spaces. */
export function readPlace(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const place = value.trim().replace(/\s+/g, ' ');
  return /^[A-Za-z0-9][A-Za-z0-9 '-]{0,19}$/.test(place) ? place : null;
}

/** Names are the realm's, and the realm does not care about case. */
export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The roster on `realm` that names `name`, or null. */
export function rosterOf(
  rosters: readonly PartyRoster[],
  realm: string,
  name: string | null
): PartyRoster | null {
  if (name === null) return null;
  return (
    rosters.find(
      (roster) =>
        roster.realm === realm && roster.members.some((member) => sameName(member.name, name))
    ) ?? null
  );
}

/**
 * A roster's places with ones the realm stated added: a place kept as the
 * start of exactly one of them (MegaMUD's `sil` for SILVERMERE) gives way to
 * the realm's whole word where it stands, and the rest follow in the realm's
 * order. Places the player added that the realm did not state stay.
 */
export function withStatedPlaces(kept: readonly string[], stated: readonly string[]): string[] {
  const whole = kept.map((place) => {
    const matches = stated.filter((word) => word.toLowerCase().startsWith(place.toLowerCase()));
    return matches.length === 1 ? matches[0]! : place;
  });
  const out: string[] = [];
  for (const place of [...whole, ...stated])
    if (!out.some((held) => sameName(held, place))) out.push(place);
  return out;
}

/** Whether `name` asked to be left out of this roster's regrouping. */
export function isForgotten(roster: PartyRoster, name: string): boolean {
  return roster.forgotten.some((entry) => sameName(entry, name));
}

const RANKS: readonly RosterRank[] = ['front', 'mid', 'back'];

/** A name as a realm would print one: a word, at most 19 letters (MegaMUD's own limit). */
function readName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return /^[A-Za-z][A-Za-z0-9'-]{0,18}$/.test(name) ? name : null;
}

/**
 * A roster from anywhere — the file or the renderer — checked field by field.
 * Null when it is not one. Duplicate names keep the first; a leader or a
 * forgotten name that is not a member is dropped.
 */
export function readRoster(value: unknown): PartyRoster | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'].trim() : '';
  const realm = typeof record['realm'] === 'string' ? record['realm'].trim() : '';
  if (id === '' || realm === '' || !Array.isArray(record['members'])) return null;
  const members: RosterMember[] = [];
  for (const entry of record['members']) {
    const row =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const name = readName(row['name']);
    if (name === null || members.some((member) => sameName(member.name, name))) continue;
    const rank = RANKS.find((r) => r === row['rank']) ?? null;
    members.push({ name, rank });
  }
  const named = (raw: unknown): string | null => {
    const name = readName(raw);
    return members.find((member) => name !== null && sameName(member.name, name))?.name ?? null;
  };
  const forgotten = Array.isArray(record['forgotten'])
    ? record['forgotten'].map(named).filter((name): name is string => name !== null)
    : [];
  const places = Array.isArray(record['places'])
    ? record['places'].map(readPlace).filter((place): place is string => place !== null)
    : [];
  return {
    id,
    realm,
    leader: named(record['leader']),
    members,
    regroup: record['regroup'] !== false,
    forgotten: [...new Set(forgotten)],
    places: [...new Set(places)]
  };
}
