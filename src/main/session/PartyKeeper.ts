/**
 * Regroup (2026-10-27): a member of a roster who has dropped out of the party
 * is put back, across this client's characters.
 *
 * MegaMUD already invites back a member gone from the party — but only from
 * the leader, and only once the member is standing in the leader's room
 * (`invitePlayers`, `0x407ee0`). What it cannot do is the case the player was
 * doing by hand forty times: one of their own characters relogged somewhere
 * else, so it has to be brought to the leader first. This client runs both
 * ends, so it can:
 *
 * - **The leader is ours.** A member in the leader's room is invited; one of
 *   ours who is invited joins; one of ours somewhere else walks to the
 *   leader, and is invited on arrival.
 * - **The leader is not ours.** One of ours standing with the leader asks
 *   for an invitation (`@invite`, which MegaMUD answers). Accepting it is
 *   MegaMUD's own *Join When Invited*, granted to that leader on the
 *   character's Remotes page: nothing here says a character was invited.
 *
 * A member who said `@forget` is left out until the player puts them back on
 * the card (`PartyRoster.forgotten`). Nothing is done for a member of ours
 * who is fighting or already walking: Regroup waits for them rather than
 * taking the character away from what it is doing.
 *
 * Driven by the characters' own state as it changes — no timer — and each act
 * is tried at most once per `tuning.session.partyRegroupAgainMs` for the same
 * member, so a refused invitation is not repeated every prompt.
 */
import type { CharacterState } from '../../shared/character';
import {
  isForgotten,
  sameName,
  type MusterTarget,
  type PartyRoster,
  type RosterRank
} from '../../shared/partyRoster';
import type { SessionId } from '../../shared/ipc';
import { roomId, type RoomId } from '../../shared/world';

/** One of this client's characters, as the keeper sees it. */
export interface KeptMember {
  session: SessionId;
  character: CharacterState;
  /** Connected and in the game. */
  inGame: boolean;
  /** Fighting, or walking a route or a loop: not to be sent anywhere. */
  busy: boolean;
}

export type RegroupAct =
  /** The leader (ours) invites `name`. */
  | { session: SessionId; act: 'invite'; name: string }
  /** A member of ours accepts the leader's invitation. */
  | { session: SessionId; act: 'join'; leader: string }
  /** A member of ours asks a leader who is not ours for an invitation. */
  | { session: SessionId; act: 'askInvite'; leader: string }
  /** A member of ours walks to the leader's room. */
  | { session: SessionId; act: 'walk'; leader: string; to: RoomId }
  /** A member of ours stops following somebody who is not the roster's leader (`leave`). */
  | { session: SessionId; act: 'leave'; name: string }
  /** A member of ours takes the rank the roster gives it (`frontrank`, `midrank`, `backrank`). */
  | { session: SessionId; act: 'rank'; rank: RosterRank };

const here = (character: CharacterState): RoomId | null =>
  character.room.map === null || character.room.number === null
    ? null
    : roomId(character.room.map, character.room.number);

const sees = (character: CharacterState, name: string): boolean =>
  character.room.occupants.some((occupant) => sameName(occupant.name, name));

const ourOf = (ours: readonly KeptMember[], name: string): KeptMember | null =>
  ours.find((m) => m.character.name !== null && sameName(m.character.name, name)) ?? null;

/** What would put the roster's party back together, this moment. */
export function regroupActs(
  roster: PartyRoster,
  ours: readonly KeptMember[],
  /** The card's Regroup pressed: asked for, so the automatic switch does not decide. */
  asked = false
): RegroupAct[] {
  if ((!roster.regroup && !asked) || roster.leader === null) return [];
  const leaderName = roster.leader;
  const leader = ourOf(ours, leaderName);
  const acts: RegroupAct[] = [];
  /*
   * A leader changed on the card (2026-10-28): one of ours made leader while
   * still following the last one leaves that party first, and nothing else
   * is done until it has — it cannot invite anybody into a party it is not
   * leading. The card's Lead only renamed the roster's leader, and the realm
   * went on following the old one.
   */
  if (leader !== null && leader.inGame) {
    const led = leader.character.party.following;
    if (led !== null && !sameName(led, leaderName) && !leader.character.inCombat)
      return [{ session: leader.session, act: 'leave', name: leaderName }];
  }

  for (const { name } of roster.members) {
    if (sameName(name, leaderName) || isForgotten(roster, name)) continue;
    const member = ourOf(ours, name);
    if (member !== null && !member.inGame) continue;
    // One of ours following somebody else: out of that party first.
    const following = member?.character.party.following ?? null;
    if (member !== null && following !== null && !sameName(following, leaderName)) {
      if (!member.character.inCombat) acts.push({ session: member.session, act: 'leave', name });
      continue;
    }

    if (leader !== null) {
      if (!leader.inGame) return [];
      const row = leader.character.party.members.find((m) => sameName(m.name, name));
      if (row !== undefined && !row.invited) continue;
      const together = sees(leader.character, name);
      if (member === null) {
        // Somebody else: invited once they are standing with the leader.
        if (together && row === undefined)
          acts.push({ session: leader.session, act: 'invite', name });
        continue;
      }
      if (together) {
        acts.push(
          row?.invited === true
            ? { session: member.session, act: 'join', leader: leaderName }
            : { session: leader.session, act: 'invite', name }
        );
        continue;
      }
      const to = here(leader.character);
      if (!member.busy && to !== null && here(member.character) !== null)
        acts.push({ session: member.session, act: 'walk', leader: leaderName, to });
      continue;
    }

    // The leader is somebody else's: only our own members can act.
    if (member === null) continue;
    if (following !== null) continue;
    if (!sees(member.character, leaderName)) continue;
    acts.push({ session: member.session, act: 'askInvite', leader: leaderName });
  }
  return acts;
}

/**
 * Each member of ours to the rank the roster gives it (2026-10-28): the
 * card's rank was only ever drawn, so a party set out on the card stood
 * wherever the realm put it (Archer, Front on the card and on MegaMUD's
 * Party tab, at Midrank behind Bowel). A member left "As listed" has no rank
 * here, and MegaMUD's own `Party.PartyRank`, taken on every join, decides.
 * Only once the listing shows them travelling with the party, and not in a
 * fight.
 */
export function rankActs(roster: PartyRoster, ours: readonly KeptMember[]): RegroupAct[] {
  const leader = roster.leader === null ? null : ourOf(ours, roster.leader);
  const acts: RegroupAct[] = [];
  for (const { name, rank } of roster.members) {
    if (rank === null || isForgotten(roster, name)) continue;
    const member = ourOf(ours, name);
    if (member === null || !member.inGame || member.character.inCombat) continue;
    // The leader's listing where the leader is ours, else the member's own.
    const listing = (leader?.inGame ? leader : member).character.party.members;
    const row = listing.find((m) => sameName(m.name, name));
    if (row === undefined || row.invited || row.rank === null || row.rank === rank) continue;
    acts.push({ session: member.session, act: 'rank', rank });
  }
  return acts;
}

/**
 * One command sent across the party (2026-10-27): what Muster's `sys goto`,
 * the card's Say to, and any other party-wide command go through.
 *
 * - **Each member of ours** does it itself (`direct`): this client runs it,
 *   so nothing has to be asked of anybody.
 * - **Everybody else travelling with a leader of ours** gets it as the
 *   leader's `@party <command>` (`atParty`, once), MegaMUD's leader's
 *   command, which every member running MegaMUD carries out where it grants
 *   the leader what the command needs (`sys` wants sysop commands).
 *
 * Our own members hear that `@party` too; the client remembers what it had
 * them do (`partyAlreadyDone`), so none of them does it twice.
 */
export type FanAct =
  | { session: SessionId; name: string; act: 'direct' }
  | { session: SessionId; name: string; act: 'atParty'; others: string[] }
  | { session: SessionId; name: string; act: 'skip'; why: FanSkip };

export type FanSkip =
  | 'offline'
  | 'fighting'
  | 'notMudop'
  | 'leaderUnknown'
  | 'isLeader'
  /** Left out by the player (Say to's chips). */
  | 'leftOut';

/**
 * Who does a command and how. `chosen`, where given, is the members of ours
 * it goes to (the rest are left out, and skip the leader's `@party` too);
 * `others` whether everybody else travelling with the leader gets it by
 * `@party`; `can` says why a member of ours cannot, or null.
 */
export function fanOutActs(
  roster: PartyRoster,
  ours: readonly KeptMember[],
  options: {
    chosen?: ReadonlySet<SessionId>;
    others: boolean;
    can?(member: KeptMember): FanSkip | null;
  }
): FanAct[] {
  const acts: FanAct[] = [];
  for (const { name } of roster.members) {
    const member = ourOf(ours, name);
    if (member === null) continue;
    const { session } = member;
    const why: FanSkip | null = !member.inGame
      ? 'offline'
      : options.chosen !== undefined && !options.chosen.has(session)
        ? 'leftOut'
        : (options.can?.(member) ?? null);
    acts.push(
      why === null ? { session, name, act: 'direct' } : { session, name, act: 'skip', why }
    );
  }
  const leader = roster.leader === null ? null : ourOf(ours, roster.leader);
  if (options.others && leader !== null && leader.inGame) {
    const others = leader.character.party.members
      .filter((m) => !m.invited && ourOf(ours, m.name) === null)
      .map((m) => m.name);
    if (others.length > 0)
      acts.push({ session: leader.session, name: roster.leader!, act: 'atParty', others });
  }
  return acts;
}

/** What Muster does for one member of ours, or why it does nothing. */
export type MusterAct = FanAct | { session: SessionId; name: string; act: 'walk'; to: RoomId };

/**
 * Muster, pressed (2026-10-27). To the leader: every member of ours walks to
 * the leader's room. To a place: `sys goto <place>`, fanned out across the
 * party (`fanOutActs`) — each member of ours that its MegaMUD settings say
 * is a MudOp (`BBS.IsMudop`, the switch MegaMUD's own teleport out at
 * critical HP reads) sends it itself, everybody else gets the leader's
 * `@party`. One that cannot go is said, with why. A fight is no reason not
 * to teleport out of it: the client breaks it off first (2026-10-27), where
 * a walk waits for it to end.
 */
export function musterActs(
  roster: PartyRoster,
  ours: readonly KeptMember[],
  target: MusterTarget,
  mudop: (session: SessionId) => boolean
): MusterAct[] {
  if (target.to === 'place')
    return fanOutActs(roster, ours, {
      others: true,
      can: (member) => (mudop(member.session) ? null : 'notMudop')
    });
  const leader = roster.leader === null ? null : ourOf(ours, roster.leader);
  const to = leader !== null && leader.inGame ? here(leader.character) : null;
  const acts: MusterAct[] = [];
  for (const { name } of roster.members) {
    const member = ourOf(ours, name);
    if (member === null) continue;
    const { session } = member;
    const skip = (why: FanSkip): MusterAct => ({ session, name, act: 'skip', why });
    if (!member.inGame) acts.push(skip('offline'));
    else if (member.character.inCombat) acts.push(skip('fighting'));
    else if (member === leader) acts.push(skip('isLeader'));
    else if (to === null) acts.push(skip('leaderUnknown'));
    else acts.push({ session, name, act: 'walk', to });
  }
  return acts;
}

/** A key for one act on one member: what the cooldown is kept by. */
const keyOf = (roster: PartyRoster, act: RegroupAct): string =>
  `${roster.id}:${act.session}:${act.act}:${'name' in act ? act.name.toLowerCase() : ''}`;

/**
 * The acts, applied: each at most once per `againMs` for the same member.
 * `run` carries one out and says whether it was taken.
 */
export class PartyKeeper {
  private readonly tried = new Map<string, number>();
  /** Rosters a Muster's `sys goto` took apart, and until when they are put back (`reform`). */
  private readonly reforming = new Map<string, number>();

  constructor(
    private readonly options: {
      againMs(): number;
      run(act: RegroupAct): boolean;
      now?(): number;
    }
  ) {}

  /**
   * The card's Regroup, pressed: every act for this roster at once, whatever
   * the automatic switch says and however recently each was tried. How many.
   */
  now(roster: PartyRoster, ours: readonly KeptMember[]): number {
    const at = this.options.now?.() ?? Date.now();
    let taken = 0;
    for (const act of [...regroupActs(roster, ours, true), ...rankActs(roster, ours)]) {
      if (!this.options.run(act)) continue;
      this.tried.set(keyOf(roster, act), at);
      taken += 1;
    }
    return taken;
  }

  /**
   * A Muster's `sys goto` sent (2026-10-27): the teleport always takes the
   * party apart, so for `forMs` it is put back together whatever Regroup's
   * switch says — invited and joined as each member lands with the leader,
   * and nobody walked, since where everybody stands is only known once they
   * have landed. What was tried before the teleport is tried again at once.
   */
  reform(roster: PartyRoster, forMs: number): void {
    const now = this.options.now?.() ?? Date.now();
    this.reforming.set(roster.id, now + forMs);
    for (const key of [...this.tried.keys()])
      if (key.startsWith(`${roster.id}:`)) this.tried.delete(key);
  }

  /** Looks at every roster against our characters on its realm. */
  check(rosters: readonly PartyRoster[], oursOn: (realm: string) => readonly KeptMember[]): void {
    const now = this.options.now?.() ?? Date.now();
    const again = this.options.againMs();
    for (const roster of rosters) {
      const until = this.reforming.get(roster.id);
      const reform = until !== undefined && now < until;
      if (until !== undefined && !reform) this.reforming.delete(roster.id);
      const ours = oursOn(roster.realm);
      const acts = [
        ...(reform
          ? regroupActs(roster, ours, true).filter((act) => act.act !== 'walk')
          : regroupActs(roster, ours)),
        ...rankActs(roster, ours)
      ];
      for (const act of acts) {
        const key = keyOf(roster, act);
        const at = this.tried.get(key);
        if (at !== undefined && now - at < again) continue;
        if (this.options.run(act)) this.tried.set(key, now);
      }
    }
  }
}
