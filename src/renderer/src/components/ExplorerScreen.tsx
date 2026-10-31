import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent
} from 'react';

import ExplorerEq, { type ExplorerEqProps } from './ExplorerEq';
import ExplorerLists, { type CompareLists, type ExplorerListsProps } from './ExplorerLists';
import ExplorerTools, { type ExplorerToolsProps } from './ExplorerTools';
import ExplorerRooms from './ExplorerRooms';
import { ExplorerAsRow, type ExplorerCharacter } from './ExplorerAsRow';
import { Check, Choice, Field, Figure, Pick } from './ExplorerFields';
import ExplorerMonsterBar from './ExplorerMonsterBar';
import TextblockView, { useTextblock } from './TextblockView';
import { BuyBox, Chest, Runs, Stock } from './ExplorerDetailParts';
import { Splitter } from './Splitter';
import { Kept } from './Kept';
import { keepFocus } from '../lib/focus';
import type { SplitRange } from '../lib/splitter';
import { t } from '../lib/i18n';
import {
  abilityValue,
  DEFAULT_FILTERS,
  orderRows,
  passes,
  type ExplorerFilters
} from '../lib/explorer';
import type { SessionId } from '@shared/ipc';
import {
  COMPARE_KINDS,
  DEFAULT_EXPLORER_OPTIONS,
  EXPLORER_ATTACKS,
  type CompareKind,
  type ExplorerAs,
  type ExplorerAttack,
  type ExplorerBuyPlan,
  type ExplorerColumn,
  type ExplorerDetail,
  type ExplorerKind,
  type ExplorerList,
  type ExplorerOptions,
  type ExplorerPlace,
  type ExplorerRoomView,
  type ExplorerRow,
  type ExplorerSegment,
  type ExplorerTab,
  type RoomMapOptions,
  type RoomSearch,
  type RoomSearchResult,
  type RoomViewRequest,
  type ExplorerTextblock,
  type TextblockRequest
} from '@shared/explorer';

/**
 * MMUD Explorer's lists for the character on screen (2026-10-18): MME's own
 * columns, filters and detail, worked out in main on the realm's database and
 * the character as it is (`main/mme/Explorer.ts`) and laid out as mudtool lays
 * them out (`../mudtool`, `style.css`, `styles/explorers.css`, `tabs/*.js`).
 * The goal is mudtool's whole data and every feature, linked to this client's
 * character, routes and errands.
 *
 * The columns are main's to send, MME's full set per list, so a list draws
 * whatever it is given; the filters are mudtool's `passes`, applied here
 * (`lib/explorer.ts`). Calc. Combat changes the figures themselves, so it is
 * asked of main. A screen and not a card, for the twenty columns; the shown
 * character's, as the Loops screen is.
 */
export interface ExplorerScreenProps {
  open: boolean;
  session: SessionId;
  characterName: string;
  /**
   * Changes when what the lists answer for does — the class, the level, what
   * is worn — so a list read before is read again.
   */
  characterKey: string;
  /** Changes when what Buy would do might: the purse, the room, a bank's balance. */
  purseKey: string;
  list(kind: ExplorerKind, options: ExplorerOptions): Promise<ExplorerList>;
  detail(
    kind: ExplorerKind,
    item: number,
    options: ExplorerOptions
  ): Promise<ExplorerDetail | null>;
  buyPlan(item: number): Promise<ExplorerBuyPlan | null>;
  /** Why not, or null where the character is on its way. */
  buy(item: number, wear: boolean): Promise<string | null>;
  /** Buy + Learn (2026-10-20): the scroll that teaches a spell, as Buy plans it, and the press. */
  learnPlan(spell: number): Promise<ExplorerBuyPlan | null>;
  learn(item: number): Promise<string | null>;
  /** An item to open on, from the Gear card; `at` tells one ask of the same item from the next. */
  focus: { kind: ExplorerTab; item: number | string; at: number } | null;
  /** The character's room, `map/room`, which the Rooms tab opens on and marks. */
  hereRoom: string | null;
  roomView(request: RoomViewRequest): Promise<ExplorerRoomView>;
  /** A textblock as MME's frmResults shows it, under the Rooms tab as mudtool has it. */
  textblock(request: TextblockRequest): Promise<ExplorerTextblock>;
  roomTip(map: number, room: number, options: RoomMapOptions): Promise<string>;
  roomSearch(search: RoomSearch): Promise<RoomSearchResult>;
  /** Send the character to a room by the route panel, the Explorer put away. */
  walkTo(room: string): void;
  /** The EQ tab's page, Find Best and wear, and what it answers for (`ExplorerEq`). */
  eq: Pick<ExplorerEqProps, 'view' | 'best' | 'wear' | 'copy' | 'characterKey'>;
  /** The Lists tab's calls, the pack, and what its Item Manager answers for (`ExplorerLists`). */
  lists: Pick<
    ExplorerListsProps,
    'pack' | 'characterKey' | 'compare' | 'find' | 'items' | 'rules' | 'saveRules' | 'copy'
  >;
  /** The Tools tab's calculators, and the Combat Stats its Swing calculator reads (`ExplorerTools`). */
  tools: Pick<ExplorerToolsProps, 'tool' | 'fromStats' | 'copy' | 'characterKey'>;
  onClose(): void;
  /** Into a window of its own (2026-10-29); absent where it already has one. */
  popOut?: () => void;
  /** The top row's: who it answers for, the character as played, and Sync (`ExplorerAsRow`). */
  as: ExplorerAs | null;
  own: ExplorerAs;
  setAs(as: ExplorerAs | null): void;
  sync(): void;
  /** The chooser's characters and its choice, in the Explorer's own window. */
  characters?: readonly ExplorerCharacter[];
  onCharacter?: (id: SessionId) => void;
  /** The whole of a window of its own, over nothing (`ExplorerWindow`). */
  windowed?: boolean;
}

/** The compare lists, kept per character (mudtool keeps them on the character). */
const compareKey = (session: string): string => `mudengine.explorer.compare.${session}`;
const NO_COMPARE: CompareLists = { weapons: [], armour: [], spells: [], monsters: [] };

function recallCompare(session: string): CompareLists {
  try {
    const kept = JSON.parse(localStorage.getItem(compareKey(session)) ?? 'null') as Record<
      string,
      unknown
    > | null;
    const list = (v: unknown): number[] =>
      Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
    return {
      weapons: list(kept?.['weapons']),
      armour: list(kept?.['armour']),
      spells: list(kept?.['spells']),
      monsters: list(kept?.['monsters'])
    };
  } catch {
    return NO_COMPARE;
  }
}

function keepCompare(session: string, lists: CompareLists): void {
  try {
    localStorage.setItem(compareKey(session), JSON.stringify(lists));
  } catch {
    // Storage refused: the lists last this visit.
  }
}

/** The lists, in MME's order. */
const KINDS: ReadonlyArray<{ id: ExplorerKind; label: () => string }> = [
  { id: 'weapons', label: () => t('explorer.kinds.weapons') },
  { id: 'armour', label: () => t('explorer.kinds.armour') },
  { id: 'sundry', label: () => t('explorer.kinds.sundry') },
  { id: 'spells', label: () => t('explorer.kinds.spells') },
  { id: 'monsters', label: () => t('explorer.kinds.monsters') },
  // One tab for both lists, as mudtool's Class/Race; races are its second view.
  { id: 'classes', label: () => t('explorer.kinds.classRace') },
  { id: 'shops', label: () => t('explorer.kinds.shops') }
];

/** Where the Rooms tab opens with neither the character placed nor a room walked: mudtool's own. */
const FIRST_ROOM = '1/2140';

/** How far back the Back button walks. */
const TRAIL_MAX = 50;

/** A place on the trail Back walks: a tab, and the record on it, null for none chosen. */
interface Visit {
  tab: ExplorerTab;
  n: number | string | null;
}

/**
 * A list's own place (2026-10-30): its search and filters, its order, how far
 * down it was and the record chosen, kept while another list is shown, as
 * each of MME's lists keeps its own. They were one for every list, so a search
 * typed on Weapons was Armour's too, and a list gone back to was in name order
 * at its top.
 */
interface ListView {
  filters: ExplorerFilters;
  sort: { id: string; dir: 1 | -1 };
  scrollTop: number;
  chosen: number | null;
  /** A record gone to, listed (faint) though the filters would hide it, until they change. */
  pinned: number | null;
}

const NEW_VIEW: ListView = {
  filters: DEFAULT_FILTERS,
  sort: { id: 'Name', dir: 1 },
  scrollTop: 0,
  chosen: null,
  pinned: null
};

/** The filters that are the whole Explorer's and not a list's: mudtool's global filter and in-game setting. */
type SharedFilters = Pick<ExplorerFilters, 'usableOnly' | 'inGameOnly'>;

/** A list as last answered, and what it answered for (`listKey`). */
interface HeldList {
  session: SessionId;
  key: string;
  list: ExplorerList;
}

/** How many records' details are kept to be shown again without asking. */
const DETAILS_KEPT = 200;

/** The Spells bar's choices (`FilterSpells`), each list's place its value. */
const MAGERIES = (): string[] => [
  t('explorer.anyType'),
  t('explorer.spells.mage'),
  t('explorer.spells.priest'),
  t('explorer.spells.druid'),
  t('explorer.spells.bard'),
  t('explorer.spells.kai')
];
const TARGETS = (): string[] => [
  t('explorer.anyType'),
  t('explorer.spells.self'),
  t('explorer.spells.user'),
  t('explorer.spells.monster'),
  t('explorer.spells.party'),
  t('explorer.spells.room')
];
const ATTACK_TYPES = (): string[] => [
  t('explorer.anyType'),
  t('explorer.spells.cold'),
  t('explorer.spells.fire'),
  t('explorer.spells.stone'),
  t('explorer.spells.lightning'),
  t('explorer.spells.normal'),
  t('explorer.spells.water'),
  t('explorer.spells.poison')
];

/** Calc. Combat's attacks, as MME names them. */
const ATTACK_LABEL: Record<ExplorerAttack, () => string> = {
  normal: () => t('explorer.attacks.normal'),
  surprise: () => t('explorer.attacks.surprise'),
  bash: () => t('explorer.attacks.bash'),
  smash: () => t('explorer.attacks.smash')
};

/** A row's height, which the list draws only the visible rows of. */
const ROW_PX = 22;
/** Rows drawn past each edge of the visible ones, so a quick scroll does not flash. */
const OVERSCAN = 12;
/** The Ability column, drawn while the ability filter names one, as mudtool's `abilCol`. */
const ABILITY_COLUMN = 'abil';
/** The name column's least width, and the head's and rows' gap and padding (`.ex-row`). */
const NAME_EM = 14;
const GAP_PX = 10;
const PAD_PX = 10;
/**
 * The panels under the list (2026-10-18), as MMUD Explorer itself lays them
 * out: the item's detail and how it compares with what is worn on the left,
 * its references on the right, both under the list so the list has the
 * screen's whole width for its columns. Their sizes, by their handles.
 */
interface ExplorerSplit {
  /** The lower panels' height, px. */
  lower: number;
  /** The references panel's width, px. */
  refs: number;
}

const DEFAULT_SPLIT: ExplorerSplit = { lower: 260, refs: 520 };
const LOWER_MIN_PX = 120;
const LIST_MIN_PX = 160;
const REFS_MIN_PX = 200;
const DETAIL_MIN_PX = 260;
/** Per client, as a layout is: one person's screen, every character's Explorer. */
const SPLIT_KEY = 'mudengine.explorer.split';

function recallSplit(): ExplorerSplit {
  try {
    const stored = JSON.parse(localStorage.getItem(SPLIT_KEY) ?? 'null') as Partial<ExplorerSplit>;
    return {
      lower: typeof stored?.lower === 'number' ? stored.lower : DEFAULT_SPLIT.lower,
      refs: typeof stored?.refs === 'number' ? stored.refs : DEFAULT_SPLIT.refs
    };
  } catch {
    return DEFAULT_SPLIT;
  }
}

function keepSplit(split: ExplorerSplit): void {
  try {
    localStorage.setItem(SPLIT_KEY, JSON.stringify(split));
  } catch {
    // Storage refused: the sizes last this visit.
  }
}

/** How long a typed figure waits before the list is asked again for it. */
const RETYPE_MS = 350;

/** MME's sub-line under an item's name: what it is, at a glance. */
function subLine(kind: ExplorerKind, row: ExplorerRow | undefined): string {
  if (row === undefined) return '';
  const c = row.cells;
  const spell = row.spell;
  // mudtool's Spells heading: `#7 · smit · Priest-1 · level 3 · 4 mana · Monster`.
  if (kind === 'shops') return `#${row.number} · ${c['ShopType'] ?? ''}`;
  if (kind === 'spells' && spell !== undefined)
    return `#${row.number} · ${spell.short} · ${spell.mageryName} · ${t('explorer.spells.level', { level: spell.level })} · ${t('explorer.spells.mana', { mana: spell.mana })} · ${spell.target}`;
  return kind === 'weapons'
    ? `#${row.number} · ${row.facts.type} · ${c['Min'] ?? 0}-${c['Max'] ?? 0} @ ${c['Speed'] ?? 0}`
    : `#${row.number} · ${row.facts.slot ?? ''} · ${row.facts.type} · AC/DR ${row.shown?.['acdr'] ?? ''}`;
}

export default function ExplorerScreen({
  open,
  session,
  characterName,
  characterKey,
  purseKey,
  list,
  detail,
  buyPlan,
  buy,
  learnPlan,
  learn,
  focus,
  hereRoom,
  roomView,
  textblock,
  roomTip,
  roomSearch,
  walkTo,
  eq,
  lists,
  tools,
  onClose,
  popOut,
  as,
  own,
  setAs,
  sync,
  characters,
  onCharacter,
  windowed = false
}: ExplorerScreenProps) {
  const [compared, setCompared] = useState<CompareLists>(() => recallCompare(session));
  useEffect(() => setCompared(recallCompare(session)), [session]);
  useEffect(() => keepCompare(session, compared), [session, compared]);
  const [kind, setKind] = useState<ExplorerKind>('weapons');
  // The tab shown: a list, which keeps `kind` and all of its state, or the Rooms walker.
  const [tab, setTab] = useState<ExplorerTab>('weapons');
  const [roomAt, setRoomAt] = useState<string | null>(null);
  const [tbAt, setTbAt] = useState<number | null>(null);
  // A teleport that names no map lands on the one the Rooms tab was showing.
  const tbMap = Number((roomAt ?? hereRoom ?? FIRST_ROOM).split('/')[0]) || 1;
  const tbView = useTextblock(textblock, tbAt, tbMap);
  const [trail, setTrail] = useState<Visit[]>([]);
  const [views, setViews] = useState<Partial<Record<ExplorerKind, ListView>>>({});
  const view = views[kind] ?? NEW_VIEW;
  const { sort, chosen, scrollTop } = view;
  const changeView = useCallback(
    (which: ExplorerKind, change: (was: ListView) => Partial<ListView>): void =>
      setViews((was) => {
        const now = was[which] ?? NEW_VIEW;
        return { ...was, [which]: { ...now, ...change(now) } };
      }),
    []
  );
  const [shared, setShared] = useState<SharedFilters>({
    usableOnly: DEFAULT_FILTERS.usableOnly,
    inGameOnly: DEFAULT_FILTERS.inGameOnly
  });
  const filters = useMemo(() => ({ ...view.filters, ...shared }), [view.filters, shared]);
  const [options, setOptions] = useState<ExplorerOptions>(DEFAULT_EXPLORER_OPTIONS);
  // The options the list was last asked for, a beat behind the typing.
  const [asked, setAsked] = useState<ExplorerOptions>(DEFAULT_EXPLORER_OPTIONS);
  // The detail shown, and the list and record it is of.
  const [shownFor, setShownFor] = useState<{ of: string; detail: ExplorerDetail } | null>(null);
  const [viewRows, setViewRows] = useState(40);
  /*
   * The list's scrolling box as it is drawn now (2026-10-19): the Rooms tab
   * takes the list away and coming back draws a new one, where the rows it
   * holds were measured off the box taken away, 0 tall, and the scroll said
   * was the old box's, and the list came back a row or two or blank.
   */
  const [rowsBox, setRowsBox] = useState<HTMLDivElement | null>(null);
  // The two panels under the list, sized by their handles and kept for next time.
  const [split, setSplit] = useState<ExplorerSplit>(recallSplit);
  useEffect(() => keepSplit(split), [split]);
  const bodyBoxRef = useRef<HTMLDivElement>(null);
  const lowerRef = useRef<HTMLDivElement>(null);
  const refsRef = useRef<HTMLElement>(null);
  // The list keeps a few rows and the detail a little width, however far a handle goes.
  const lowerRange = useCallback(
    (): SplitRange => ({
      min: LOWER_MIN_PX,
      max: (bodyBoxRef.current?.getBoundingClientRect().height ?? 600) - LIST_MIN_PX
    }),
    []
  );
  const refsRange = useCallback(
    (): SplitRange => ({
      min: REFS_MIN_PX,
      max: (lowerRef.current?.getBoundingClientRect().width ?? 900) - DETAIL_MIN_PX
    }),
    []
  );
  /** A filter changed: the shared two the Explorer's, the rest this list's. */
  const set = (change: Partial<ExplorerFilters>): void => {
    const { usableOnly, inGameOnly, ...own } = change;
    if (usableOnly !== undefined || inGameOnly !== undefined)
      setShared((was) => ({
        usableOnly: usableOnly ?? was.usableOnly,
        inGameOnly: inGameOnly ?? was.inGameOnly
      }));
    // A record listed only because it was gone to is let go.
    changeView(kind, (was) => ({ filters: { ...was.filters, ...own }, pinned: null }));
  };
  const setOption = (change: Partial<ExplorerOptions>): void =>
    setOptions((was) => ({ ...was, ...change }));

  useEffect(() => {
    const timer = setTimeout(() => setAsked(options), RETYPE_MS);
    return () => clearTimeout(timer);
  }, [options]);

  /*
   * Each list as last answered (2026-10-30), drawn again at once when its tab
   * is: asked of main only when what it answers for has changed, and drawn as
   * it was until the new answer comes. Every swap of tabs asked main for the
   * whole list again, Loading between, and the Monsters list priced every
   * monster each time.
   */
  const listKey = `${session}|${characterKey}|${JSON.stringify(asked)}`;
  const [answers, setAnswers] = useState<Partial<Record<ExplorerKind, HeldList>>>({});
  const held = answers[kind];
  const answer = held !== undefined && held.session === session ? held.list : null;
  const heldKey = held?.key;
  // What each list is being asked for, so a tab swapped away and back does not ask twice.
  const asking = useRef(new Map<ExplorerKind, string>());
  useEffect(() => {
    if (!open || heldKey === listKey || asking.current.get(kind) === listKey) return;
    asking.current.set(kind, listKey);
    void list(kind, asked).then((found) => {
      if (asking.current.get(kind) === listKey) asking.current.delete(kind);
      setAnswers((was) => ({ ...was, [kind]: { session, key: listKey, list: found } }));
    });
  }, [open, kind, list, listKey, heldKey, asked, session]);

  // Records' details as answered, by list and what it answered for.
  const details = useRef(new Map<string, ExplorerDetail>());
  const shownOf = `${kind}|${chosen}`;
  useEffect(() => {
    if (!open || chosen === null) return;
    const key = `${listKey}|${shownOf}`;
    const kept = details.current.get(key);
    if (kept !== undefined) {
      setShownFor({ of: shownOf, detail: kept });
      return;
    }
    let live = true;
    void detail(kind, chosen, asked).then((found) => {
      if (found === null) return;
      details.current.set(key, found);
      if (details.current.size > DETAILS_KEPT)
        details.current.delete(details.current.keys().next().value!);
      if (live) setShownFor({ of: shownOf, detail: found });
    });
    return () => {
      live = false;
    };
  }, [open, kind, chosen, detail, listKey, shownOf, asked]);
  // The chosen record's detail; another's, until its own comes, is not drawn.
  const shown = shownFor !== null && shownFor.of === shownOf ? shownFor.detail : null;

  // Escape puts it away, as every surface over the console does.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // How many rows the list's box holds, for drawing only those.
  useEffect(() => {
    if (!open || rowsBox === null) return;
    const measure = (): void => setViewRows(Math.ceil(rowsBox.clientHeight / ROW_PX) + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rowsBox);
    return () => observer.disconnect();
  }, [open, rowsBox]);

  const all = useMemo(() => answer?.rows ?? [], [answer]);
  const types = useMemo(() => [...new Set(all.map((row) => row.facts.type))].sort(), [all]);
  const slots = useMemo(
    () =>
      [
        ...new Set(all.flatMap((row) => (row.facts.slot === undefined ? [] : [row.facts.slot])))
      ].sort(),
    [all]
  );
  const abilityOptions = useMemo<Array<[string, string]>>(
    () => [
      ...(answer?.abilities ?? []).map(([n, name]): [string, string] => [String(n), name]),
      ['-1', t('explorer.negates')]
    ],
    [answer]
  );

  // MME's columns as sent, and the Ability column while the filter names one.
  const columns = useMemo<ExplorerColumn[]>(
    () => [
      ...(answer?.columns ?? []),
      ...(filters.ability.abil > 0
        ? [{ id: ABILITY_COLUMN, label: t('explorer.ability'), width: '5em', numeric: true }]
        : [])
    ],
    [answer, filters.ability.abil]
  );
  const cellOf = useCallback(
    (row: ExplorerRow, id: string) =>
      id === ABILITY_COLUMN ? abilityValue(row, filters.ability.abil) : row.cells[id],
    [filters.ability.abil]
  );

  // The rows that do not match, where the extra monster filters show every one, greyed.
  const [rows, dimmed] = useMemo(() => {
    const backstabForced = asked.calc && asked.attack === 'surprise';
    const showAll = kind === 'monsters' && filters.extra.enabled && filters.extra.showAll;
    const dim = new Set<number>();
    const kept = all.filter((row) => {
      const ok = passes(row, kind, filters, backstabForced, asked.byLair);
      if (!ok && (row.number === view.pinned || (showAll && (!filters.inGameOnly || row.inGame))))
        dim.add(row.number);
      return ok || dim.has(row.number);
    });
    return [orderRows(kept, (row) => cellOf(row, sort.id), sort.dir), dim] as const;
  }, [all, kind, filters, sort, asked, cellOf, view.pinned]);

  /*
   * Going somewhere (2026-10-18): a list, with the record chosen, listed and
   * brought into view; or the Rooms walker at a room. What a reference, the
   * Gear card and Back all do. A list gone to with no record named is as it
   * was left.
   */
  const scrollToRef = useRef<number | null>(null);
  const goTo = useCallback(
    (visit: Visit): void => {
      setTab(visit.tab);
      if (visit.tab === 'eq' || visit.tab === 'lists' || visit.tab === 'tools') return;
      if (visit.tab === 'rooms') {
        if (visit.n !== null) setRoomAt(String(visit.n));
        return;
      }
      if (visit.tab === 'textblock') {
        if (visit.n !== null) setTbAt(Number(visit.n));
        return;
      }
      setKind(visit.tab);
      if (visit.n === null) return;
      const n = Number(visit.n);
      changeView(visit.tab, () => ({ chosen: n, pinned: n }));
      scrollToRef.current = n;
    },
    [changeView]
  );
  // Where Back returns to: the tab shown, and its record.
  const visitNow = (): Visit =>
    tab === 'rooms'
      ? { tab, n: roomAt }
      : tab === 'textblock'
        ? { tab, n: tbAt }
        : tab === 'eq' || tab === 'lists' || tab === 'tools'
          ? { tab, n: null }
          : { tab: kind, n: chosen };
  /** Go somewhere, remembering where from. */
  const follow = (visit: Visit | ExplorerPlace): void => {
    const now = visitNow();
    setTrail((was) => [...was.slice(1 - TRAIL_MAX), now]);
    goTo(visit);
  };
  const back = (): void => {
    const last = trail.at(-1);
    if (last === undefined) return;
    setTrail(trail.slice(0, -1));
    goTo(last);
  };
  const links = (text: readonly ExplorerSegment[]): ReactNode => (
    <Runs follow={follow} runs={text} />
  );
  useEffect(() => {
    if (focus !== null) goTo({ tab: focus.kind, n: focus.item });
  }, [focus, goTo]);
  /*
   * The list shown where it was left, or the record gone to brought into view
   * where it is out of it, a third of the way down as mudtool's `select` has
   * it (2026-10-30). Put away, the box forgets how far down it was; and a list
   * swapped in for another draws in the same box.
   */
  const listShown = open && tab === kind;
  const placeRef = useRef(scrollTop);
  placeRef.current = scrollTop;
  // Read by the box's scroll handler, which a list put away keeps as it was drawn.
  const listShownRef = useRef(listShown);
  listShownRef.current = listShown;
  useLayoutEffect(() => {
    if (!listShown || rowsBox === null) return;
    const wanted = scrollToRef.current;
    if (wanted !== null) {
      const at = rows.findIndex((row) => row.number === wanted);
      if (at >= 0) {
        scrollToRef.current = null;
        const top = at * ROW_PX;
        const place = placeRef.current;
        // The rows under the head that are in view.
        const seen = rowsBox.clientHeight - ROW_PX * 2;
        const next =
          top < place || top + ROW_PX > place + seen ? Math.max(0, top - seen / 3) : place;
        rowsBox.scrollTop = next;
        if (next !== place) changeView(kind, () => ({ scrollTop: next }));
        return;
      }
      // Not on this list at all, once it has come.
      if (answer !== null) scrollToRef.current = null;
    }
    if (rowsBox.scrollTop !== placeRef.current) rowsBox.scrollTop = placeRef.current;
  }, [listShown, rowsBox, kind, rows, answer, changeView]);

  /*
   * One width for the head and every row, so twenty columns line up when they
   * scroll sideways: every track's own width, the name's floor of
   * `NAME_EM`, the gaps between them and the row's padding.
   */
  const tracks = columns.map((column) =>
    column.id === 'Name' ? `minmax(${NAME_EM}em, 1fr)` : column.width
  );
  const template = tracks.join(' ');
  const ems = columns.reduce(
    (sum, column) =>
      sum +
      (column.id === 'Name'
        ? NAME_EM
        : // A `minmax(14em, 3fr)` track is its floor.
          Number.parseFloat(column.width.replace(/^minmax\(/, '')) || 4),
    0
  );
  const tableWidth = `max(100%, calc(${ems}em + ${GAP_PX * (columns.length - 1) + PAD_PX * 2}px))`;
  const first = Math.max(0, Math.floor(scrollTop / ROW_PX) - OVERSCAN);
  const last = Math.min(rows.length, first + viewRows + OVERSCAN * 2);
  const chosenRow = all.find((row) => row.number === chosen);
  const switchTab = (next: ExplorerTab): void => {
    if (next === tab) return;
    follow(
      next === 'rooms'
        ? { tab: 'rooms', n: roomAt ?? hereRoom ?? FIRST_ROOM }
        : { tab: next, n: null }
    );
  };

  const abilityField = (
    <Field label={t('explorer.ability')}>
      <select
        onChange={(event) =>
          set({ ability: { ...filters.ability, abil: Number(event.target.value) } })
        }
        value={String(filters.ability.abil)}
      >
        <option value="0">{t('explorer.anyType')}</option>
        {abilityOptions.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      <select
        onChange={(event) =>
          set({ ability: { ...filters.ability, op: event.target.value === 'le' ? 'le' : 'ge' } })
        }
        value={filters.ability.op}
      >
        <option value="le">&lt;=</option>
        <option value="ge">&gt;=</option>
      </select>
      <input
        inputMode="numeric"
        onChange={(event) =>
          set({
            ability: { ...filters.ability, value: Number.parseInt(event.target.value, 10) || 0 }
          })
        }
        style={{ width: '4.5em' }}
        value={String(filters.ability.value)}
      />
    </Field>
  );

  const screen = (
    <div
      aria-label={t('explorer.dialogLabel', { characterName })}
      aria-modal={windowed ? undefined : 'true'}
      className="explorer-screen"
      data-windowed={windowed ? 'true' : undefined}
      onMouseDown={(event) => event.stopPropagation()}
      role={windowed ? 'main' : 'dialog'}
    >
      <ExplorerAsRow
        as={as}
        characters={characters}
        list={list}
        onCharacter={onCharacter}
        own={own}
        session={session}
        setAs={setAs}
        sync={sync}
      />
      <header className="ex-top">
        <nav className="ex-tabs" role="tablist">
          <button
            aria-selected={tab === 'eq'}
            className="ex-tab"
            onClick={() => switchTab('eq')}
            onMouseDown={keepFocus}
            role="tab"
            type="button"
          >
            {t('explorer.kinds.eq')}
          </button>
          <button
            aria-selected={tab === 'lists'}
            className="ex-tab"
            onClick={() => switchTab('lists')}
            onMouseDown={keepFocus}
            role="tab"
            type="button"
          >
            {t('explorer.kinds.lists')}
          </button>
          {KINDS.map((entry) => (
            <button
              aria-selected={tab === entry.id || (entry.id === 'classes' && tab === 'races')}
              className="ex-tab"
              key={entry.id}
              onClick={() => switchTab(entry.id)}
              onMouseDown={keepFocus}
              role="tab"
              type="button"
            >
              {entry.label()}
            </button>
          ))}
          <button
            aria-selected={tab === 'rooms' || tab === 'textblock'}
            className="ex-tab"
            onClick={() => switchTab('rooms')}
            onMouseDown={keepFocus}
            role="tab"
            type="button"
          >
            {t('explorer.kinds.rooms')}
          </button>
          <button
            aria-selected={tab === 'tools'}
            className="ex-tab"
            onClick={() => switchTab('tools')}
            onMouseDown={keepFocus}
            role="tab"
            type="button"
          >
            {t('explorer.kinds.tools')}
          </button>
        </nav>
        <button
          className="ex-btn ex-back"
          disabled={trail.length === 0}
          onClick={back}
          onMouseDown={keepFocus}
          title={t('explorer.backTitle')}
          type="button"
        >
          {t('explorer.back')}
        </button>
        <label className="ex-global" data-on={filters.usableOnly ? 'true' : 'false'}>
          <input
            checked={filters.usableOnly}
            onChange={(event) => set({ usableOnly: event.target.checked })}
            type="checkbox"
          />
          {t('explorer.usableOnly', { characterName })}
        </label>
        {popOut !== undefined && (
          <button
            className="ex-btn"
            onClick={popOut}
            onMouseDown={keepFocus}
            title={t('explorer.popOutTitle')}
            type="button"
          >
            {t('explorer.popOut')}
          </button>
        )}
        <button className="ex-btn" onClick={onClose} onMouseDown={keepFocus} type="button">
          {t('explorer.close')}
        </button>
      </header>

      {/* Each tab kept as it was left while another is shown (`Kept`). */}
      <Kept shown={tab === 'eq'}>
        <ExplorerEq
          addCompare={(added) =>
            setCompared((was) => {
              const next = { ...was };
              for (const { kind: list, n } of added)
                if (!next[list].includes(n)) next[list] = [...next[list], n];
              return next;
            })
          }
          buy={buy}
          characterKey={eq.characterKey}
          copy={eq.copy}
          follow={follow}
          session={session}
          view={eq.view}
          best={eq.best}
          wear={eq.wear}
        />
      </Kept>
      <Kept shown={tab === 'tools'}>
        <ExplorerTools {...tools} follow={follow} session={session} />
      </Kept>
      <Kept shown={tab === 'lists'}>
        <ExplorerLists
          {...lists}
          follow={follow}
          lists={compared}
          session={session}
          setLists={setCompared}
        />
      </Kept>
      {tab === 'textblock' && (
        <section className="ex-textblock">
          <h2 className="ex-name">{t('explorer.textblock.title', { n: tbAt ?? 0 })}</h2>
          <TextblockView {...tbView} follow={follow} />
        </section>
      )}
      <Kept shown={tab === 'rooms'}>
        <ExplorerRooms
          at={roomAt ?? hereRoom ?? FIRST_ROOM}
          characterName={characterName}
          follow={follow}
          here={hereRoom}
          onWalk={(room) => follow({ tab: 'rooms', n: room })}
          runs={links}
          search={roomSearch}
          tip={roomTip}
          view={roomView}
          walkTo={walkTo}
        />
      </Kept>
      <Kept shown={tab === kind}>
        <>
          <div className="ex-toolbar">
            <input
              aria-label={t('explorer.find')}
              className="ex-search"
              onChange={(event) => set({ query: event.target.value })}
              placeholder={t('explorer.find')}
              spellCheck={false}
              value={filters.query}
            />
            {kind === 'classes' || kind === 'races' ? (
              <div className="ex-seg" role="group">
                {(['classes', 'races', 'builder'] as const).map((view) => {
                  const on =
                    view === 'builder'
                      ? kind === 'classes' && options.builder
                      : kind === view && !(view === 'classes' && options.builder);
                  return (
                    <button
                      aria-pressed={on}
                      className="ex-btn"
                      key={view}
                      onClick={() => {
                        setOption({ builder: view === 'builder' });
                        const list = view === 'races' ? 'races' : 'classes';
                        if (list !== kind) follow({ tab: list, n: null });
                      }}
                      onMouseDown={keepFocus}
                      type="button"
                    >
                      {view === 'classes'
                        ? t('explorer.classes.classes')
                        : view === 'races'
                          ? t('explorer.classes.races')
                          : t('explorer.classes.builder')}
                    </button>
                  );
                })}
              </div>
            ) : kind === 'sundry' ? null : kind === 'monsters' ? (
              <ExplorerMonsterBar
                abilityOptions={abilityOptions.filter(([id]) => id !== '-1')}
                byLair={options.byLair}
                filters={filters}
                lairsStated={answer?.lairs ?? true}
                set={set}
                setByLair={(byLair) => setOption({ byLair })}
              />
            ) : kind === 'shops' ? (
              <>
                <button
                  className="ex-btn"
                  onClick={() => set({ trainersOnly: !filters.trainersOnly })}
                  onMouseDown={keepFocus}
                  type="button"
                >
                  {filters.trainersOnly
                    ? t('explorer.shops.showAll')
                    : t('explorer.shops.showTrainers')}
                </button>
                <div className="ex-checks">
                  <Check
                    checked={options.shopCharm}
                    label={t('explorer.shops.charm')}
                    onChange={(shopCharm) => setOption({ shopCharm, shopSell: false })}
                  />
                  <Check
                    checked={options.shopSell}
                    label={t('explorer.shops.sell')}
                    onChange={(shopSell) => setOption({ shopSell, shopCharm: false })}
                  />
                </div>
                <Figure
                  label={t('explorer.shops.charmValue')}
                  onChange={(charm) => setOption({ charm })}
                  value={options.charm}
                  width="4.5em"
                />
              </>
            ) : kind === 'spells' ? (
              <>
                <Pick
                  label={t('explorer.spells.magery')}
                  labels={MAGERIES()}
                  onChange={(magery) => set({ magery })}
                  value={filters.magery}
                />
                <Pick
                  label={t('explorer.spells.mageryLevel')}
                  labels={[t('explorer.anyType'), '1', '2', '3']}
                  onChange={(mageryLevel) => set({ mageryLevel })}
                  value={filters.mageryLevel}
                />
                <Pick
                  label={t('explorer.spells.target')}
                  labels={TARGETS()}
                  onChange={(target) => set({ target })}
                  value={filters.target}
                />
                <Pick
                  label={t('explorer.spells.attack')}
                  labels={ATTACK_TYPES()}
                  onChange={(attType) => set({ attType })}
                  value={filters.attType}
                />
                <Field label={t('explorer.spells.hasAbility')}>
                  <select
                    onChange={(event) => set({ hasAbility: Number(event.target.value) })}
                    value={String(filters.hasAbility)}
                  >
                    <option value="0">{t('explorer.anyType')}</option>
                    {abilityOptions.map(([id, text]) => (
                      <option key={id} value={id}>
                        {text}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="ex-checks">
                  <Check
                    checked={filters.learnableOnly}
                    label={t('explorer.spells.learnableOnly')}
                    onChange={(learnableOnly) => set({ learnableOnly })}
                  />
                </div>
              </>
            ) : kind === 'weapons' ? (
              <>
                <Choice
                  any={t('explorer.anyType')}
                  label={t('explorer.weaponType')}
                  onChange={(type) => set({ type })}
                  options={types}
                  value={filters.type}
                />
                <Figure
                  label={t('explorer.maxSpeed')}
                  onChange={(maxSpeed) => set({ maxSpeed })}
                  value={filters.maxSpeed}
                />
                <Figure
                  label={t('explorer.maxStrength')}
                  onChange={(maxStrength) => set({ maxStrength })}
                  value={filters.maxStrength}
                  width="4em"
                />
                <Choice
                  any={t('explorer.anyType')}
                  label={t('explorer.minMagic')}
                  onChange={(magic) => set({ magic: Number(magic) || 0 })}
                  options={Array.from({ length: 15 }, (_, i): [string, string] => [
                    String(i + 1),
                    i === 14 ? '15+' : String(i + 1)
                  ])}
                  value={filters.magic === 0 ? '' : String(filters.magic)}
                />
                <div className="ex-checks">
                  <Check
                    checked={filters.nonMagic}
                    label={t('explorer.nonMagic')}
                    onChange={(nonMagic) => set({ nonMagic })}
                  />
                  <Check
                    checked={filters.backstabs}
                    label={t('explorer.backstabs')}
                    onChange={(backstabs) => set({ backstabs })}
                  />
                  <Check
                    checked={filters.limiteds}
                    label={t('explorer.limiteds')}
                    onChange={(limiteds) => set({ limiteds })}
                  />
                </div>
              </>
            ) : (
              <>
                <Choice
                  any={t('explorer.anywhere')}
                  label={t('explorer.worn')}
                  onChange={(slot) => set({ slot })}
                  options={slots}
                  value={filters.slot}
                />
                <Choice
                  any={t('explorer.anyType')}
                  label={t('explorer.armourType')}
                  onChange={(type) => set({ type })}
                  options={types}
                  value={filters.type}
                />
                <div className="ex-checks">
                  <Check
                    checked={filters.nonMagic}
                    label={t('explorer.nonMagic')}
                    onChange={(nonMagic) => set({ nonMagic })}
                  />
                  <Check
                    checked={filters.noLimit}
                    label={t('explorer.noLimit')}
                    onChange={(noLimit) => set({ noLimit })}
                  />
                </div>
              </>
            )}
            {(kind === 'weapons' || kind === 'armour' || kind === 'sundry') && abilityField}
            <div className="ex-checks">
              <Check
                checked={filters.inGameOnly}
                label={t('explorer.inGameOnly')}
                onChange={(inGameOnly) => set({ inGameOnly })}
              />
            </div>
            {kind === 'spells' && (
              <div className="ex-calc">
                <Check
                  checked={options.mrCalc}
                  label={t('explorer.spells.vsMR')}
                  onChange={(mrCalc) => setOption({ mrCalc })}
                />
                {options.mrCalc && (
                  <>
                    <Figure
                      label={t('explorer.spells.mr')}
                      onChange={(vsMR) => setOption({ vsMR: vsMR ?? 0 })}
                      value={options.vsMR}
                      width="4em"
                    />
                    <Check
                      checked={options.antiMagic}
                      label={t('explorer.spells.antiMagic')}
                      onChange={(antiMagic) => setOption({ antiMagic })}
                    />
                  </>
                )}
              </div>
            )}
            {kind === 'weapons' && (
              <div className="ex-calc">
                <Check
                  checked={options.calc}
                  label={t('explorer.calcCombat')}
                  onChange={(calc) => setOption({ calc })}
                />
                {options.calc && (
                  <>
                    <Field label={t('explorer.attack')}>
                      <select
                        onChange={(event) =>
                          setOption({ attack: event.target.value as ExplorerAttack })
                        }
                        value={options.attack}
                      >
                        {EXPLORER_ATTACKS.map((attack) => (
                          <option key={attack} value={attack}>
                            {ATTACK_LABEL[attack]()}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Check
                      checked={options.fast}
                      label={t('explorer.fast')}
                      onChange={(fast) => setOption({ fast })}
                    />
                    <Figure
                      label={t('explorer.vsAC')}
                      onChange={(vsAC) => setOption({ vsAC: vsAC ?? 0 })}
                      value={options.vsAC}
                      width="4em"
                    />
                    <Figure
                      label={t('explorer.vsDR')}
                      onChange={(vsDR) => setOption({ vsDR: vsDR ?? 0 })}
                      value={options.vsDR}
                      width="4em"
                    />
                    <Figure
                      label={t('explorer.vsDodge')}
                      onChange={(vsDodge) => setOption({ vsDodge: vsDodge ?? 0 })}
                      value={options.vsDodge}
                      width="4em"
                    />
                    <Figure
                      label={t('explorer.minDamage')}
                      onChange={(minDamage) => set({ minDamage: minDamage ?? 0 })}
                      value={filters.minDamage}
                      width="4.5em"
                    />
                  </>
                )}
              </div>
            )}
            <span className="ex-count">
              {t('explorer.count', { shown: rows.length, of: all.length })}
            </span>
          </div>

          <div
            className="ex-body"
            ref={bodyBoxRef}
            style={{
              ['--ex-lower' as string]: `${split.lower}px`,
              ['--ex-refs' as string]: `${split.refs}px`
            }}
          >
            <div className="ex-list">
              {answer === null ? (
                <div className="ex-empty">{t('explorer.loading')}</div>
              ) : !answer.supported ? (
                <div className="ex-empty">{answer.reason ?? t('explorer.unsupported')}</div>
              ) : (
                <div
                  className="ex-table"
                  role="grid"
                  style={{
                    ['--ex-cols' as string]: template,
                    ['--ex-width' as string]: tableWidth
                  }}
                >
                  <div
                    className="ex-rows"
                    onScroll={(event: UIEvent<HTMLDivElement>) => {
                      const top = event.currentTarget.scrollTop;
                      // Put away, the box scrolls to its top, which is not where the list was.
                      if (listShownRef.current) changeView(kind, () => ({ scrollTop: top }));
                    }}
                    ref={setRowsBox}
                  >
                    <div className="ex-head" role="row">
                      {columns.map((column) => (
                        <button
                          aria-sort={
                            sort.id === column.id
                              ? sort.dir === 1
                                ? 'ascending'
                                : 'descending'
                              : undefined
                          }
                          className="ex-th"
                          data-numeric={column.numeric === true ? 'true' : undefined}
                          key={column.id}
                          // A figure's first press is the largest first, as mudtool's is.
                          onClick={() =>
                            changeView(kind, ({ sort: was }) => ({
                              sort:
                                was.id === column.id
                                  ? { id: column.id, dir: was.dir === 1 ? -1 : 1 }
                                  : { id: column.id, dir: column.numeric === true ? -1 : 1 }
                            }))
                          }
                          onMouseDown={keepFocus}
                          role="columnheader"
                          title={column.label}
                          type="button"
                        >
                          {column.label}
                        </button>
                      ))}
                    </div>
                    {rows.length === 0 ? (
                      <div className="ex-empty">{t('explorer.empty')}</div>
                    ) : (
                      <div className="ex-spacer" style={{ height: rows.length * ROW_PX }}>
                        {rows.slice(first, last).map((row, i) => (
                          <div
                            aria-selected={chosen === row.number}
                            className="ex-row"
                            data-unusable={
                              row.usable && !dimmed.has(row.number) ? undefined : 'true'
                            }
                            data-worn={row.worn ? 'true' : undefined}
                            key={row.number}
                            onClick={() => changeView(kind, () => ({ chosen: row.number }))}
                            role="row"
                            style={{ top: (first + i) * ROW_PX }}
                          >
                            {columns.map((column) => (
                              <span
                                className="ex-td"
                                data-numeric={column.numeric === true ? 'true' : undefined}
                                data-tone={row.tones?.[column.id]}
                                key={column.id}
                                role="gridcell"
                              >
                                {row.shown?.[column.id] ?? cellOf(row, column.id) ?? ''}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <Splitter
              edge="bottom"
              label={t('explorer.lowerHeight')}
              measure={() => lowerRef.current?.getBoundingClientRect().height ?? split.lower}
              onChange={(lower) => setSplit((was) => ({ ...was, lower }))}
              onReset={() => setSplit((was) => ({ ...was, lower: DEFAULT_SPLIT.lower }))}
              rangeFor={lowerRange}
            />
            <div className="ex-lower" ref={lowerRef}>
              <section className="ex-detail">
                {chosen === null ? (
                  <div className="ex-empty">{t('explorer.choose')}</div>
                ) : shown === null ? (
                  <div className="ex-empty">{t('explorer.loading')}</div>
                ) : (
                  <>
                    <h2 className="ex-name">{shown.name}</h2>
                    <div className="ex-sub">{shown.sub ?? subLine(kind, chosenRow)}</div>
                    {/* MME's Add to compare, to the Lists tab's list of this kind. */}
                    {(COMPARE_KINDS as readonly string[]).includes(kind) && (
                      <button
                        className="ex-btn ex-compare"
                        disabled={compared[kind as CompareKind].includes(shown.number)}
                        onClick={() =>
                          setCompared((was) => ({
                            ...was,
                            [kind]: [...was[kind as CompareKind], shown.number]
                          }))
                        }
                        onMouseDown={keepFocus}
                        type="button"
                      >
                        {compared[kind as CompareKind].includes(shown.number)
                          ? t('explorer.lists.compared')
                          : t('explorer.lists.addCompare')}
                      </button>
                    )}
                    {(kind === 'weapons' || kind === 'armour' || kind === 'sundry') && (
                      <BuyBox
                        buy={buy}
                        buyPlan={buyPlan}
                        characterKey={characterKey}
                        item={shown.number}
                        purseKey={purseKey}
                      />
                    )}
                    {kind === 'spells' && (
                      <BuyBox
                        buy={buy}
                        buyPlan={buyPlan}
                        characterKey={characterKey}
                        item={shown.number}
                        learn={{
                          plan: learnPlan,
                          press: learn,
                          refused:
                            chosenRow === undefined || chosenRow.usable
                              ? null
                              : t('explorer.buy.notLearnable', { characterName })
                        }}
                        purseKey={purseKey}
                      />
                    )}
                    {shown.races !== undefined && (
                      <Field label={t('explorer.classes.race')}>
                        <select
                          onChange={(event) =>
                            setOption({ builderRace: Number(event.target.value) })
                          }
                          value={String(options.builderRace)}
                        >
                          <option value="0">{t('explorer.classes.chooseRace')}</option>
                          {shown.races.map(([n, name]) => (
                            <option key={n} value={n}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <p className="ex-text">{links(shown.text)}</p>
                    {shown.note !== undefined && <p className="ex-note">{shown.note}</p>}
                    {shown.stock !== undefined && shown.stock.rows.length > 0 && (
                      <Stock follow={follow} stock={shown.stock} />
                    )}
                    {shown.chest !== undefined && <Chest chest={shown.chest} follow={follow} />}
                    {shown.table !== undefined && (
                      <table className="ex-mon">
                        <tbody>
                          {shown.table.map((row, i) => (
                            <tr data-cls={row.cls} key={i}>
                              <th>{links(row.label)}</th>
                              <td>{links(row.text)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </section>
              <Splitter
                edge="right"
                label={t('explorer.referencesWidth')}
                measure={() => refsRef.current?.getBoundingClientRect().width ?? split.refs}
                onChange={(refs) => setSplit((was) => ({ ...was, refs }))}
                onReset={() => setSplit((was) => ({ ...was, refs: DEFAULT_SPLIT.refs }))}
                rangeFor={refsRange}
              />
              <section className="ex-references" ref={refsRef}>
                <h3 className="ex-heading">{shown?.refsTitle ?? t('explorer.references')}</h3>
                {shown === null || shown.refs.length === 0 ? (
                  <div className="ex-empty">
                    {chosen === null ? '' : t('explorer.noReferences')}
                  </div>
                ) : (
                  <table className="ex-refs">
                    <tbody>
                      {shown.refs.map((ref, i) => (
                        <tr key={i}>
                          <td className="ex-pct">{ref.pct === undefined ? '' : `${ref.pct}%`}</td>
                          <td>{links(ref.text)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </div>
        </>
      </Kept>
    </div>
  );
  // Put away, it is kept as it was for the next time it is opened.
  return (
    <Kept shown={open}>
      {windowed ? (
        screen
      ) : (
        <div className="palette-scrim" onMouseDown={onClose} role="presentation">
          {screen}
        </div>
      )}
    </Kept>
  );
}
