/**
 * MMUD Explorer's calls for one character, as `ExplorerScreen` takes them.
 *
 * One hook for both of the Explorer's places (2026-10-29): over the console in
 * the main window, and popped out into a window of its own (`ExplorerWindow`).
 * Every call goes to main by the character's id, so a window that shows no
 * console asks the same questions and gets the same answers; what the hook
 * needs besides is the character as last pushed, for what each answer is read
 * again on.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  CompareKind,
  EqFind,
  EqPlan,
  ExplorerAlignment,
  ExplorerAs,
  ExplorerKind,
  ExplorerOptions,
  RoomMapOptions,
  RoomSearch,
  RoomViewRequest,
  TextblockRequest
} from '@shared/explorer';
import type { ToolRequest } from '@shared/explorerTools';
import { ownAlignment, type CharacterState } from '@shared/character';
import type { Alignment } from '@shared/alignment';
import type { IpcApi, SessionId } from '@shared/ipc';
import type { ItemRule } from '@shared/itemRules';
import { mean, sinceCardBaseline, swings } from '@shared/tally';
import type { ExplorerScreenProps } from '../components/ExplorerScreen';

/** What the Explorer is drawn from: everything but where it is and how it goes. */
export type ExplorerCallProps = Omit<
  ExplorerScreenProps,
  | 'open'
  | 'session'
  | 'characterName'
  | 'focus'
  | 'walkTo'
  | 'onClose'
  | 'popOut'
  | 'windowed'
  | 'characters'
  | 'onCharacter'
>;

/**
 * What MMUD Explorer's answers for a character turn on: its class, race,
 * level and what it wears. The Explorer's lists and the Gear card are read
 * again when it changes.
 */
export function wornKey(character: CharacterState): string {
  return [
    character.className ?? '',
    character.race ?? '',
    character.progress.level ?? '',
    character.inventory.items
      .filter((item) => item.equipped)
      .map((item) => item.name)
      .sort()
      .join(',')
  ].join('|');
}

/** What Buy's plan answers for beside the gear: the purse, the room, the vaults. */
export function purseKey(character: CharacterState): string {
  return [
    character.inventory.wealth ?? '',
    character.room.name ?? '',
    character.room.map ?? '',
    character.room.number ?? '',
    character.banks.map((bank) => `${bank.name}:${bank.copper}`).join(',')
  ].join('|');
}

/** MME's three standings, as a character's own reads (`ALIGNMENT_INDEX` in `mme/Explorer.ts`). */
const MME_STANDING: Record<Alignment, ExplorerAlignment> = {
  Saint: 'good',
  Good: 'good',
  Lawful: 'neutral',
  Neutral: 'neutral',
  Seedy: 'neutral',
  Outlaw: 'evil',
  Criminal: 'evil',
  Villain: 'evil',
  FIEND: 'evil'
};

/** The Explorer's calls and keys for `session`, whose state is `character`. */
export function useExplorer(
  api: IpcApi,
  session: SessionId,
  character: CharacterState
): ExplorerCallProps {
  /*
   * Who it answers for where not the character as played (2026-10-29): main
   * keeps it, so every window's Explorer of this character agrees, and says
   * when it changes.
   */
  const [as, setAsHeld] = useState<ExplorerAs | null>(null);
  useEffect(() => {
    let live = true;
    setAsHeld(null);
    void api.explorerAsOf(session).then((held) => {
      if (live) setAsHeld(held);
    });
    const off = api.onExplorerAs(({ session: id, payload }) => {
      if (id === session) setAsHeld(payload);
    });
    return () => {
      live = false;
      off();
    };
  }, [api, session]);
  const setAs = useCallback(
    (next: ExplorerAs | null) => void api.explorerAs(session, next),
    [api, session]
  );
  const sync = useCallback(() => void api.explorerSync(session), [api, session]);
  const standing = ownAlignment(character);
  const own: ExplorerAs = {
    className: character.className,
    race: character.race,
    level: character.progress.level,
    alignment: standing === null ? 'any' : MME_STANDING[standing]
  };
  const textblock = useCallback(
    (request: TextblockRequest) => api.explorerTextblock(session, request),
    [api, session]
  );
  const list = useCallback(
    (kind: ExplorerKind, options: ExplorerOptions) => api.explorerList(session, kind, options),
    [api, session]
  );
  const detail = useCallback(
    (kind: ExplorerKind, item: number, options: ExplorerOptions) =>
      api.explorerDetail(session, kind, item, options),
    [api, session]
  );
  const roomView = useCallback(
    (request: RoomViewRequest) => api.explorerRoomView(session, request),
    [api, session]
  );
  const roomTip = useCallback(
    (map: number, room: number, options: RoomMapOptions) =>
      api.explorerRoomTip(session, map, room, options),
    [api, session]
  );
  const roomSearch = useCallback(
    (search: RoomSearch) => api.explorerRoomSearch(session, search),
    [api, session]
  );
  // The character's room as the Rooms tab keys one.
  const hereRoom =
    character.room.map === null || character.room.number === null
      ? null
      : `${character.room.map}/${character.room.number}`;
  const buyPlan = useCallback((item: number) => api.explorerBuyPlan(session, item), [api, session]);
  const buy = useCallback(
    (item: number, wear: boolean) => api.explorerBuy(session, item, wear),
    [api, session]
  );
  const learnPlan = useCallback(
    (spell: number) => api.explorerLearnPlan(session, spell),
    [api, session]
  );
  const learn = useCallback((item: number) => api.explorerLearn(session, item), [api, session]);
  // What the lists answer for: read again when the class, level or gear change, or who they are read as.
  const characterKey = `${wornKey(character)}|${JSON.stringify(as)}`;
  /*
   * The EQ tab's calls, and what its page answers for beside the gear: the
   * pack, its reported weight, and the blessings up.
   */
  const eqKey = [
    characterKey,
    character.inventory.items.map((item) => `${item.name}x${item.count ?? 1}`).join(','),
    character.inventory.encumbrance ?? '',
    character.buffs.map((buff) => buff.spell).join(',')
  ].join('|');
  const eq = useMemo(
    () => ({
      characterKey: eqKey,
      view: (plan: EqPlan) => api.explorerEq(session, plan),
      best: (plan: EqPlan, find: EqFind) => api.explorerEqBest(session, plan, find),
      wear: (plan: EqPlan) => api.explorerEqWear(session, plan),
      copy: (text: string) => void api.copyText(text)
    }),
    [api, session, eqKey]
  );
  /*
   * The Tools tab's: its calculators, and the Combat Stats card's own Hit,
   * Crit and Weapon rows as MegaMUD's Hit, Crit and Extra, % of every swing
   * and the average, for the Swing calculator's true average.
   */
  const statsShown = sinceCardBaseline(character.tally, character.statsBase);
  const swungAll = swings(statsShown);
  const fromStats =
    swungAll === 0
      ? null
      : {
          hitP: Math.round((statsShown.dealt.melee.hits / swungAll) * 100),
          hitA: Math.round(mean(statsShown.dealt.melee.damage, statsShown.dealt.melee.hits) ?? 0),
          extraP: Math.round((statsShown.dealt.proc.hits / swungAll) * 100),
          extraA: Math.round(mean(statsShown.dealt.proc.damage, statsShown.dealt.proc.hits) ?? 0),
          critP: Math.round((statsShown.dealt.critical.hits / swungAll) * 100),
          critA: Math.round(
            mean(statsShown.dealt.critical.damage, statsShown.dealt.critical.hits) ?? 0
          )
        };
  const fromStatsKey = JSON.stringify(fromStats);
  const tools = useMemo(
    () => ({
      characterKey: eqKey,
      tool: <R extends ToolRequest>(request: R) => api.explorerTool(session, request),
      fromStats: JSON.parse(fromStatsKey) as typeof fromStats,
      copy: (text: string) => void api.copyText(text)
    }),
    [api, session, eqKey, fromStatsKey] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // The Lists tab's: the pack as the game lists it, and the item rules its Item Manager writes.
  const pack = useMemo(
    () =>
      character.inventory.items.map((item) => ({
        number: item.row?.id ?? item.id ?? null,
        name: item.name,
        count: item.count ?? 1,
        equipped: item.equipped
      })),
    [character.inventory.items]
  );
  const lists = useMemo(
    () => ({
      pack,
      characterKey: eqKey,
      compare: (kind: CompareKind, numbers: number[]) =>
        api.explorerCompare(session, kind, numbers),
      find: (kind: CompareKind | 'items', text: string) => api.explorerFind(session, kind, text),
      items: (numbers: number[], names: string[]) => api.explorerItems(session, numbers, names),
      rules: () => api.itemRulesFor(session),
      saveRules: (own: ItemRule[]) => api.setItemDetails(session, own),
      copy: (text: string) => void api.copyText(text)
    }),
    [api, session, pack, eqKey]
  );
  return {
    as,
    own,
    setAs,
    sync,
    characterKey,
    purseKey: purseKey(character),
    list,
    detail,
    buyPlan,
    buy,
    learnPlan,
    learn,
    hereRoom,
    roomView,
    textblock,
    roomTip,
    roomSearch,
    eq,
    lists,
    tools
  };
}
