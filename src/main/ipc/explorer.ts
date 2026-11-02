/**
 * MMUD Explorer, over IPC: whose character a screen reads as, its lists,
 * details and comparisons, rooms and textblocks, gear and finds, and buying,
 * learning and wearing from it.
 */
import type { CharacterState } from '../../shared/character';
import {
  asEqPlan,
  asExplorerAs,
  asExplorerOptions,
  asGearOptions,
  asRoomViewRequest,
  asTextblockRequest,
  COMPARE_KINDS,
  type CompareKind,
  EXPLORER_KINDS,
  type ExplorerBuyPlan,
  type ExplorerKind,
  NO_EQ_VIEW,
  type RoomSearch,
  viewedAs
} from '../../shared/explorer';
import { asToolRequest } from '../../shared/explorerTools';
import { Invoke, Push, type SessionId } from '../../shared/ipc';
import { errorMessage } from '../../shared/values';
import { t } from '../app/i18n';
import type { IpcContext } from '../client';
import type { Transport } from '../host/Host';
import { explorerAsk } from '../mme/ExplorerThread';

export function registerExplorerIpc(transport: Transport, ctx: IpcContext): void {
  const { handle } = transport;

  /**
   * Everything the realm knows about a name — monster, item or spell.
   *
   * The Reference card's query, and the one behind every "what is this thing"
   * click on a card. One handler across the three indexes because the caller
   * has a *name* and should not need to know which table answers it.
   */
  /*
   * MMUD Explorer for one character (2026-10-18): its realm's own database
   * file, read with MME's logic, and the character as it is now.
   */
  /*
   * Who each character's Explorer answers for, where not the character as
   * played (`ExplorerAs`, 2026-10-29). The reading calls take the character
   * through it; Buy, Wear, Learn and the Gear card do not.
   */
  const viewedBy = (session: SessionId, character: CharacterState): CharacterState =>
    viewedAs(character, ctx.explorerAs.get(session) ?? null);
  const tellExplorerAs = (session: SessionId): void =>
    ctx.push(Push.explorerAs, { session, payload: ctx.explorerAs.get(session) ?? null });
  handle(Invoke.explorerAs, (_caller, session: SessionId, as: unknown) => {
    if (!ctx.host?.has(session)) return null;
    const asked = asExplorerAs(as);
    if (asked === null) ctx.explorerAs.delete(session);
    else ctx.explorerAs.set(session, asked);
    tellExplorerAs(session);
    return asked;
  });
  handle(Invoke.explorerAsOf, (_caller, session: SessionId) => ctx.explorerAs.get(session) ?? null); // MajorMUD's stat sheet and pack, which say the class, race, level, stats and what is worn.
  handle(Invoke.explorerSync, (_caller, session: SessionId) => {
    const manager = ctx.host?.get(session)?.manager;
    if (manager === undefined) return false;
    if (ctx.explorerAs.delete(session)) tellExplorerAs(session);
    const stat = manager.ask('stat');
    const pack = manager.ask('i');
    return stat || pack;
  }); /** A finder's question off the wire, or null for one that does not parse. */
  const asRoomSearch = (value: unknown): RoomSearch | null => {
    const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const text = (key: string): string | null =>
      typeof o[key] === 'string' ? (o[key] as string).slice(0, 200) : null;
    const find = text('find');
    if (find !== null) return { find, after: text('after') };
    const list = text('list');
    if (list !== null) return { list };
    const leads = text('leads');
    return leads !== null && /^\d+\/\d+$/.test(leads) ? { leads } : null;
  }; /** A list's name off the wire; anything else is the Weapons list. */
  const explorerKindOf = (kind: unknown): ExplorerKind =>
    EXPLORER_KINDS.includes(kind as ExplorerKind) ? (kind as ExplorerKind) : 'weapons';
  handle(
    Invoke.explorerList,
    async (_caller, session: SessionId, kind: unknown, options: unknown) => {
      const none = { supported: false, columns: [], rows: [], abilities: [] };
      const realm = ctx.explorerRealm(session);
      const manager = ctx.host?.get(session)?.manager;
      if (typeof realm === 'string' || manager === undefined)
        return { ...none, reason: typeof realm === 'string' ? realm : '' };
      const which = explorerKindOf(kind);
      try {
        const list = await explorerAsk(
          'list',
          realm.file,
          viewedBy(session, manager.character),
          which,
          { ...asExplorerOptions(options), fights: ctx.fightsOf(session) }
        );
        return list.supported ? list : { ...list, reason: t('app.explorer.unsupported') };
      } catch (error) {
        return { ...none, reason: t('app.explorer.unreadable', { reason: errorMessage(error) }) };
      }
    }
  );
  handle(
    Invoke.explorerDetail,
    async (_caller, session: SessionId, kind: unknown, item: unknown, options: unknown) => {
      const realm = ctx.explorerRealm(session);
      const manager = ctx.host?.get(session)?.manager;
      if (typeof realm === 'string' || manager === undefined || typeof item !== 'number')
        return null;
      try {
        return await explorerAsk(
          'detail',
          realm.file,
          viewedBy(session, manager.character),
          explorerKindOf(kind),
          item,
          { ...asExplorerOptions(options), fights: ctx.fightsOf(session) }
        );
      } catch {
        return null;
      }
    }
  ); /*
   * Buy and Buy + Wear: the counter, the price and the vault off the session
   * (`purchaseFor`, which the press acts on too), and what comes off for it
   * off MME's slot rule. The item is the realm's, by number.
   */
  const explorerWearing = async (
    session: SessionId,
    item: number
  ): Promise<ExplorerBuyPlan['wear']> => {
    const realm = ctx.explorerRealm(session);
    const manager = ctx.host?.get(session)?.manager;
    if (typeof realm === 'string' || manager === undefined) return { wearable: false, remove: [] };
    try {
      return await explorerAsk('wear', realm.file, manager.character, item);
    } catch {
      return { wearable: false, remove: [] };
    }
  };
  handle(Invoke.explorerBuyPlan, async (_caller, session: SessionId, item: unknown) => {
    const manager = ctx.host?.get(session)?.manager;
    const row = typeof item === 'number' ? ctx.worldFor(session)?.item(item) : undefined;
    if (manager === undefined || row === undefined) return null;
    // Unplaced, the realm is asked first, as a route is (`ensureLocated`).
    if (manager.character.room.map === null) await manager.ensureLocated();
    const wear = await explorerWearing(session, row.id);
    return { ...manager.purchaseFor({ id: row.id, name: row.name }), wear };
  });
  handle(Invoke.explorerBuy, async (_caller, session: SessionId, item: unknown, wear: unknown) => {
    const manager = ctx.host?.get(session)?.manager;
    const row = typeof item === 'number' ? ctx.worldFor(session)?.item(item) : undefined;
    if (manager === undefined || row === undefined) return t('app.explorer.noSuchItem');
    if (manager.character.room.map === null) await manager.ensureLocated();
    let remove: string[] | null = null;
    if (wear === true) {
      const wearing = await explorerWearing(session, row.id);
      if (!wearing.wearable) return t('app.explorer.notWorn', { item: row.name });
      remove = wearing.remove;
    }
    return manager.buyNow({ id: row.id, name: row.name }, remove);
  }); /*
   * Buy + Learn: the scroll that teaches a spell, as Buy plans it, and the
   * press, which buys it and reads it. The spell and the item are the
   * realm's, by number.
   */
  handle(Invoke.explorerLearnPlan, async (_caller, session: SessionId, spell: unknown) => {
    const manager = ctx.host?.get(session)?.manager;
    if (manager === undefined || typeof spell !== 'number') return null;
    if (manager.character.room.map === null) await manager.ensureLocated();
    const plan = manager.learnPlanFor(spell);
    return plan === null ? null : { ...plan, wear: { wearable: false, remove: [] } };
  });
  handle(Invoke.explorerLearn, async (_caller, session: SessionId, item: unknown) => {
    const manager = ctx.host?.get(session)?.manager;
    const row = typeof item === 'number' ? ctx.worldFor(session)?.item(item) : undefined;
    if (manager === undefined || row === undefined) return t('app.explorer.noSuchItem');
    if (manager.character.room.map === null) await manager.ensureLocated();
    return manager.buyNow({ id: row.id, name: row.name }, null, true);
  }); /*
   * The Rooms tab: MME's map and finders on the realm's own rooms, the
   * character's room marked. A request that does not parse is answered as
   * no such room rather than a throw.
   */
  /*
   * A textblock as MME's frmResults shows it (2026-10-24): the Explorer's
   * Rooms tab and the cards' textblock panel both ask it.
   */
  handle(Invoke.explorerTextblock, async (_caller, session: SessionId, request: unknown) => {
    const realm = ctx.explorerRealm(session);
    const asked = asTextblockRequest(request);
    const empty = { text: [], icon: 'PAPER', place: null, bold: false, kids: [] };
    const none = {
      supported: false,
      found: false,
      number: asked?.n ?? 0,
      linkTo: null,
      calledFrom: null,
      commands: null,
      command: empty,
      executed: empty,
      raw: ''
    };
    if (typeof realm === 'string' || asked === null)
      return { ...none, reason: typeof realm === 'string' ? realm : '' };
    try {
      const tb = await explorerAsk('textblock', realm.file, asked);
      return tb.supported ? tb : { ...tb, reason: t('app.explorer.unsupported') };
    } catch (error) {
      return { ...none, reason: t('app.explorer.unreadable', { reason: errorMessage(error) }) };
    }
  }); /*
   * What MME says a room holds, as data (2026-10-24): the Room card's Lair and
   * Shop faces and the room panel, without the Rooms tab's map.
   */
  handle(
    Invoke.explorerRoom,
    async (_caller, session: SessionId, rawMap: unknown, rawRoom: unknown) => {
      const realm = ctx.explorerRealm(session);
      const manager = ctx.host?.get(session)?.manager;
      const map = typeof rawMap === 'number' && Number.isInteger(rawMap) ? rawMap : 0;
      const room = typeof rawRoom === 'number' && Number.isInteger(rawRoom) ? rawRoom : 0;
      const none = { supported: false, found: false, map, room, name: '', refs: [], info: '' };
      if (typeof realm === 'string' || manager === undefined)
        return { ...none, reason: typeof realm === 'string' ? realm : '' };
      try {
        const facts = await explorerAsk(
          'room',
          realm.file,
          viewedBy(session, manager.character),
          map,
          room
        );
        return facts.supported ? facts : { ...facts, reason: t('app.explorer.unsupported') };
      } catch (error) {
        return { ...none, reason: t('app.explorer.unreadable', { reason: errorMessage(error) }) };
      }
    }
  );
  handle(Invoke.explorerRoomView, async (_caller, session: SessionId, request: unknown) => {
    const realm = ctx.explorerRealm(session);
    const manager = ctx.host?.get(session)?.manager;
    const asked = asRoomViewRequest(request);
    const none = {
      supported: false,
      found: false,
      map: asked?.map ?? 0,
      room: asked?.room ?? 0,
      name: '',
      grid: null,
      compass: [],
      refs: [],
      info: '',
      here: null
    };
    if (typeof realm === 'string' || manager === undefined || asked === null)
      return { ...none, reason: typeof realm === 'string' ? realm : '' };
    try {
      const view = await explorerAsk(
        'roomView',
        realm.file,
        viewedBy(session, manager.character),
        asked
      );
      return view.supported ? view : { ...view, reason: t('app.explorer.unsupported') };
    } catch (error) {
      return { ...none, reason: t('app.explorer.unreadable', { reason: errorMessage(error) }) };
    }
  });
  handle(
    Invoke.explorerRoomTip,
    async (_caller, session: SessionId, map: unknown, room: unknown, options: unknown) => {
      const realm = ctx.explorerRealm(session);
      const manager = ctx.host?.get(session)?.manager;
      const asked = asRoomViewRequest({ map, room, options });
      if (typeof realm === 'string' || manager === undefined || asked === null) return '';
      try {
        return await explorerAsk(
          'roomTip',
          realm.file,
          viewedBy(session, manager.character),
          asked.map,
          asked.room,
          asked.options
        );
      } catch {
        return '';
      }
    }
  );
  handle(Invoke.explorerRoomSearch, async (_caller, session: SessionId, search: unknown) => {
    const realm = ctx.explorerRealm(session);
    const manager = ctx.host?.get(session)?.manager;
    const asked = asRoomSearch(search);
    if (typeof realm === 'string' || manager === undefined || asked === null) return {};
    try {
      return await explorerAsk(
        'roomSearch',
        realm.file,
        viewedBy(session, manager.character),
        asked
      );
    } catch {
      return {};
    }
  });
  handle(Invoke.explorerGear, async (_caller, session: SessionId, options: unknown) => {
    const none = { supported: false, criteria: [], slots: [] };
    const realm = ctx.explorerRealm(session);
    const manager = ctx.host?.get(session)?.manager;
    if (typeof realm === 'string' || manager === undefined)
      return { ...none, reason: typeof realm === 'string' ? realm : '' };
    const world = ctx.worldFor(session);
    try {
      const board = await explorerAsk(
        'gear',
        realm.file,
        manager.character,
        asGearOptions(options),
        world?.soldItems() ?? null
      );
      return board.supported ? board : { ...board, reason: t('app.explorer.unsupported') };
    } catch (error) {
      return { ...none, reason: t('app.explorer.unreadable', { reason: errorMessage(error) }) };
    }
  });
  /*
   * The EQ tab: MME's page for the plan, Find Best over it, and the plan put
   * on. A plan or a search that does not parse is the default.
   */
  handle(Invoke.explorerEq, async (_caller, session: SessionId, plan: unknown) => {
    const realm = ctx.explorerRealm(session);
    const manager = ctx.host?.get(session)?.manager;
    if (typeof realm === 'string' || manager === undefined)
      return { ...NO_EQ_VIEW, reason: typeof realm === 'string' ? realm : '' };
    try {
      const view = await explorerAsk(
        'eq',
        realm.file,
        viewedBy(session, manager.character),
        asEqPlan(plan)
      );
      return view.supported ? view : { ...view, reason: t('app.explorer.unsupported') };
    } catch (error) {
      return {
        ...NO_EQ_VIEW,
        reason: t('app.explorer.unreadable', { reason: errorMessage(error) })
      };
    }
  });
  handle(
    Invoke.explorerEqBest,
    async (_caller, session: SessionId, plan: unknown, find: unknown) => {
      const realm = ctx.explorerRealm(session);
      const manager = ctx.host?.get(session)?.manager;
      const asked = asEqPlan(plan);
      if (typeof realm === 'string' || manager === undefined)
        return { equipped: asked.equipped ?? [], found: false };
      const f = (typeof find === 'object' && find !== null ? find : {}) as Record<string, unknown>;
      try {
        return await explorerAsk(
          'eqBest',
          realm.file,
          viewedBy(session, manager.character),
          asked,
          {
            criterion:
              typeof f['criterion'] === 'number' ? Math.max(0, Math.trunc(f['criterion'])) : 0,
            next: f['next'] === true,
            noLimited: f['noLimited'] === true
          }
        );
      } catch {
        return { equipped: asked.equipped ?? [], found: false };
      }
    }
  );
  handle(Invoke.explorerEqWear, async (_caller, session: SessionId, plan: unknown) => {
    const realm = ctx.explorerRealm(session);
    const manager = ctx.host?.get(session)?.manager;
    if (typeof realm === 'string' || manager === undefined)
      return { refusal: t('app.explorer.noCharacter'), buy: [] };
    try {
      const wear = await explorerAsk('eqWear', realm.file, manager.character, asEqPlan(plan));
      return { refusal: manager.wearLoadout(wear.commands), buy: wear.buy };
    } catch (error) {
      return { refusal: t('app.explorer.unreadable', { reason: errorMessage(error) }), buy: [] };
    }
  });
  /*
   * The Lists tab: a compare list, a picker's matches and the Item Manager's
   * columns, numbers and words parsed at the door.
   */
  const numbersOf = (value: unknown): number[] =>
    Array.isArray(value)
      ? value
          .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
          .slice(0, 500)
      : [];
  const compareKindOf = (value: unknown): CompareKind =>
    COMPARE_KINDS.includes(value as CompareKind) ? (value as CompareKind) : 'weapons';
  handle(
    Invoke.explorerCompare,
    async (_caller, session: SessionId, kind: unknown, numbers: unknown) => {
      const realm = ctx.explorerRealm(session);
      const manager = ctx.host?.get(session)?.manager;
      const none = { supported: false, columns: [], rows: [] };
      if (typeof realm === 'string' || manager === undefined)
        return { ...none, reason: typeof realm === 'string' ? realm : '' };
      try {
        const list = await explorerAsk(
          'compare',
          realm.file,
          viewedBy(session, manager.character),
          compareKindOf(kind),
          numbersOf(numbers)
        );
        return list.supported ? list : { ...list, reason: t('app.explorer.unsupported') };
      } catch (error) {
        return { ...none, reason: t('app.explorer.unreadable', { reason: errorMessage(error) }) };
      }
    }
  );
  handle(Invoke.explorerFind, async (_caller, session: SessionId, kind: unknown, text: unknown) => {
    const realm = ctx.explorerRealm(session);
    if (typeof realm === 'string' || typeof text !== 'string') return [];
    try {
      return await explorerAsk(
        'find',
        realm.file,
        kind === 'items' ? 'items' : compareKindOf(kind),
        text.slice(0, 64)
      );
    } catch {
      return [];
    }
  });
  handle(
    Invoke.explorerItems,
    async (_caller, session: SessionId, numbers: unknown, names: unknown) => {
      const realm = ctx.explorerRealm(session);
      const manager = ctx.host?.get(session)?.manager;
      if (typeof realm === 'string' || manager === undefined) return [];
      const words = Array.isArray(names)
        ? names.filter((name): name is string => typeof name === 'string').slice(0, 500)
        : [];
      try {
        return await explorerAsk(
          'items',
          realm.file,
          viewedBy(session, manager.character),
          numbersOf(numbers),
          words
        );
      } catch {
        return [];
      }
    }
  );
  handle(Invoke.explorerTool, async (_caller, session: SessionId, request: unknown) => {
    const realm = ctx.explorerRealm(session);
    const manager = ctx.host?.get(session)?.manager;
    const asked = asToolRequest(request);
    if (typeof realm === 'string' || manager === undefined || asked === null) return null;
    try {
      return await explorerAsk('tool', realm.file, viewedBy(session, manager.character), asked);
    } catch {
      return null;
    }
  });
}
