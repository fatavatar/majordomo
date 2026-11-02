import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CharacterState } from '@shared/character';
import type { IpcApi, SessionId, SessionSummary } from '@shared/ipc';
import { rosterOf, type MusterTarget, type PartyRoster } from '@shared/partyRoster';

import type { OurMember } from '../lib/partyBoard';

/**
 * The Party card's world: this character's realm, the roster naming it, and
 * every character of this client's on that realm, read from their own tabs
 * — so every member of ours draws, and edits, the same party.
 */
export interface PartyContext {
  realm: string | null;
  roster: PartyRoster | null;
  ours: readonly OurMember[];
  save(roster: PartyRoster): void;
  remove(id: string): void;
  /** The party broken up in the realm and its roster forgotten. */
  disband(id: string): void;
  regroup(id: string): Promise<number>;
  muster(id: string, target: MusterTarget): Promise<string[]>;
  say(id: string, sessions: readonly SessionId[], line: string, others: boolean): Promise<string[]>;
}

/** What the party reads from main. */
export type PartyApi = Pick<
  IpcApi,
  | 'partyRosters'
  | 'onPartyRosters'
  | 'saveRoster'
  | 'removeRoster'
  | 'disbandParty'
  | 'regroupParty'
  | 'musterParty'
  | 'partySay'
>;

export interface Party {
  /** Every realm's rosters, as main last pushed them. */
  rosters: PartyRoster[];
  regroup(id: string): Promise<number>;
  disband(id: string): void;
  muster(id: string, target: MusterTarget): Promise<string[]>;
  say(id: string, sessions: readonly SessionId[], line: string, others: boolean): Promise<string[]>;
  /** One character's Party card context. */
  partyFor(sid: SessionId, character: CharacterState): PartyContext;
}

/**
 * The Party card's rosters and actions, across every character this window
 * holds (2026-10-27).
 *
 * `views` is each character's state from its own tab: only its character is
 * read, for the members of ours in each realm.
 */
export function useParty(
  api: PartyApi,
  sessions: readonly SessionSummary[],
  views: Readonly<Record<SessionId, { readonly character: CharacterState } | undefined>>
): Party {
  /*
   * The Party card's rosters, every realm's, kept in main and pushed on every
   * change — an edit on one character's card reaches every other's at once.
   */
  const [rosters, setRosters] = useState<PartyRoster[]>([]);
  useEffect(() => {
    void api.partyRosters().then(setRosters);
    return api.onPartyRosters(setRosters);
  }, [api]);
  const save = useCallback(
    (roster: PartyRoster) => void api.saveRoster(roster).then(setRosters),
    [api]
  );
  const remove = useCallback((id: string) => void api.removeRoster(id).then(setRosters), [api]);
  const regroup = useCallback((id: string) => api.regroupParty(id), [api]);
  // Disband: the party broken up in the realm, and its roster forgotten (2026-10-31).
  const disband = useCallback((id: string) => void api.disbandParty(id).then(setRosters), [api]);
  const muster = useCallback(
    (id: string, target: MusterTarget) => api.musterParty(id, target),
    [api]
  );
  /* The Party card's Say to: each character sends the line through its own talk box's path. */
  const say = useCallback(
    (id: string, sids: readonly SessionId[], line: string, others: boolean) =>
      api.partySay(id, sids, line, others),
    [api]
  );
  /* Each realm's characters of ours, from their own tabs: the cross-tab half of the Party card. */
  const oursByRealm = useMemo(() => {
    const byRealm = new Map<string, OurMember[]>();
    for (const summary of sessions) {
      const character = views[summary.id]?.character;
      if (character === undefined || character.name === null) continue;
      const list = byRealm.get(summary.server) ?? [];
      list.push({
        session: summary.id,
        character,
        inGame: summary.state.phase === 'connected' && character.phase === 'in-game'
      });
      byRealm.set(summary.server, list);
    }
    return byRealm;
  }, [sessions, views]);
  const partyFor = useCallback(
    (sid: SessionId, character: CharacterState): PartyContext => {
      const realm = sessions.find((summary) => summary.id === sid)?.server ?? null;
      return {
        realm,
        roster: realm === null ? null : rosterOf(rosters, realm, character.name),
        ours: realm === null ? [] : (oursByRealm.get(realm) ?? []),
        save,
        remove,
        disband,
        regroup,
        muster,
        say
      };
    },
    [sessions, rosters, oursByRealm, save, remove, disband, regroup, muster, say]
  );
  return { rosters, regroup, disband, muster, say, partyFor };
}
