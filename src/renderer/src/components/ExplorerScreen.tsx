import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent
} from 'react';

import { Splitter } from './Splitter';
import { keepFocus } from '../lib/focus';
import type { SplitRange } from '../lib/splitter';
import { t } from '../lib/i18n';
import { coinText } from '../lib/coins';
import { copperSpread } from '@shared/coins';
import {
  abilityValue,
  DEFAULT_FILTERS,
  orderRows,
  passes,
  type ExplorerFilters
} from '../lib/explorer';
import type { SessionId } from '@shared/ipc';
import {
  DEFAULT_EXPLORER_OPTIONS,
  EXPLORER_ATTACKS,
  type ExplorerAttack,
  type ExplorerBuyPlan,
  type ExplorerColumn,
  type ExplorerDetail,
  type ExplorerKind,
  type ExplorerList,
  type ExplorerOptions,
  type ExplorerRow,
  type ExplorerSegment
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
  detail(item: number): Promise<ExplorerDetail | null>;
  buyPlan(item: number): Promise<ExplorerBuyPlan | null>;
  /** Why not, or null where the character is on its way. */
  buy(item: number, wear: boolean): Promise<string | null>;
  /** An item to open on, from the Gear card; `at` tells one ask of the same item from the next. */
  focus: { kind: ExplorerKind; item: number; at: number } | null;
  onClose(): void;
}

/** The lists, in MME's order. */
const KINDS: ReadonlyArray<{ id: ExplorerKind; label: () => string }> = [
  { id: 'weapons', label: () => t('explorer.kinds.weapons') },
  { id: 'armour', label: () => t('explorer.kinds.armour') }
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

/** A run of MME's text: a reference drawn as one, the rest as it is. */
function Runs({ runs }: { runs: readonly ExplorerSegment[] }) {
  return (
    <>
      {runs.map((run, i) =>
        'kind' in run ? (
          <span className="ex-ref" data-kind={run.kind} key={i}>
            {run.text}
          </span>
        ) : (
          <span key={i}>{run.text}</span>
        )
      )}
    </>
  );
}

/** A labelled field on the filter bar, as mudtool's `.field`. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ex-field">
      <span className="ex-field-label">{label}</span>
      <span className="ex-field-row">{children}</span>
    </label>
  );
}

/** A dropdown of `Any` and then the values given. */
function Choice({
  label,
  any,
  value,
  options,
  onChange
}: {
  label: string;
  any: string;
  value: string;
  options: ReadonlyArray<string | [string, string]>;
  onChange(value: string): void;
}) {
  return (
    <Field label={label}>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{any}</option>
        {options.map((option) => {
          const [id, text] = typeof option === 'string' ? [option, option] : option;
          return (
            <option key={id} value={id}>
              {text}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

/** A figure, or blank for none; committed as typed. */
function Figure({
  label,
  value,
  onChange,
  width = '5em'
}: {
  label: string;
  value: number | null;
  onChange(value: number | null): void;
  width?: string;
}) {
  return (
    <Field label={label}>
      <input
        inputMode="numeric"
        onChange={(event) => {
          const text = event.target.value.trim();
          const n = Number.parseInt(text, 10);
          onChange(text === '' || Number.isNaN(n) ? null : n);
        }}
        style={{ width }}
        value={value === null ? '' : String(value)}
      />
    </Field>
  );
}

/** A filter's tick, as mudtool draws one. */
function Check({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <label className="ex-check">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

/** MME's sub-line under an item's name: what it is, at a glance. */
/** A copper total as the coins it makes, as the purse is shown. */
const coins = (copper: number): string => coinText(copperSpread(copper), 1) || '0';

/**
 * Buy and Buy + Wear (2026-10-18): where the character would go and what it
 * would pay, the bank it draws the shortfall from first, or why it cannot;
 * then the press, which sends it. The plan is main's (`purchaseFor`), the one
 * the purchase acts on, asked again as the purse, the room or the gear change.
 */
function BuyBox({
  item,
  purseKey,
  characterKey,
  buyPlan,
  buy
}: {
  item: number;
  purseKey: string;
  characterKey: string;
  buyPlan: ExplorerScreenProps['buyPlan'];
  buy: ExplorerScreenProps['buy'];
}) {
  const [plan, setPlan] = useState<ExplorerBuyPlan | null>(null);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => setSaid(null), [item]);
  useEffect(() => {
    let live = true;
    void buyPlan(item).then((found) => {
      if (live) setPlan(found);
    });
    return () => {
      live = false;
    };
  }, [item, buyPlan, purseKey, characterKey]);
  if (plan === null || plan.item !== item) return null;
  const press = (wear: boolean): void => {
    setSending(true);
    void buy(item, wear)
      .then((why) =>
        setSaid(
          why === null ? { text: t('explorer.buy.sent'), ok: true } : { text: why, ok: false }
        )
      )
      .finally(() => setSending(false));
  };
  const shop = plan.shop;
  const blocked = plan.refusal !== undefined || sending;
  const removes = plan.wear.remove.join(', ');
  return (
    <div className="ex-buy">
      <h3 className="ex-heading">{t('explorer.buy.heading')}</h3>
      {shop !== undefined && (
        <div className="ex-buy-line">
          {t('explorer.buy.where', {
            shop: shop.name,
            room: shop.roomName,
            moves: shop.moves,
            price: plan.price === null ? t('explorer.buy.unpriced') : coins(plan.price)
          })}
        </div>
      )}
      {plan.refusal !== undefined ? (
        <div className="ex-buy-line" data-tone="danger">
          {plan.refusal}
        </div>
      ) : plan.bank !== undefined ? (
        <div className="ex-buy-line" data-tone="pending">
          {plan.bank.balance === null
            ? t('explorer.buy.bankUnread', {
                amount: coins(plan.bank.withdraw),
                bank: plan.bank.name,
                room: plan.bank.roomName
              })
            : t('explorer.buy.bankFirst', {
                amount: coins(plan.bank.withdraw),
                bank: plan.bank.name,
                room: plan.bank.roomName,
                balance: coins(plan.bank.balance)
              })}
        </div>
      ) : (
        <div className="ex-buy-line" data-tone="ok">
          {t('explorer.buy.onHand', { purse: plan.purse === null ? '?' : coins(plan.purse) })}
        </div>
      )}
      <div className="ex-buy-actions">
        <button
          className="ex-buy-button"
          disabled={blocked}
          onClick={() => press(false)}
          type="button"
        >
          {t('explorer.buy.buy')}
        </button>
        <button
          className="ex-buy-button"
          disabled={blocked || !plan.wear.wearable}
          onClick={() => press(true)}
          title={
            !plan.wear.wearable
              ? t('explorer.buy.notWorn')
              : removes === ''
                ? undefined
                : t('explorer.buy.takesOff', { items: removes })
          }
          type="button"
        >
          {t('explorer.buy.buyWear')}
        </button>
        {said !== null && (
          <span className="ex-buy-said" data-tone={said.ok ? 'ok' : 'danger'}>
            {said.text}
          </span>
        )}
      </div>
    </div>
  );
}

function subLine(kind: ExplorerKind, row: ExplorerRow | undefined): string {
  if (row === undefined) return '';
  const c = row.cells;
  return kind === 'weapons'
    ? `#${row.number} · ${row.facts.type} · ${c['Min'] ?? 0}-${c['Max'] ?? 0} @ ${c['Speed'] ?? 0}`
    : `#${row.number} · ${row.facts.slot ?? ''} · ${row.facts.type} · AC/DR ${row.shown?.['acdr'] ?? ''}`;
}

export default function ExplorerScreen({
  open,
  characterName,
  characterKey,
  purseKey,
  list,
  detail,
  buyPlan,
  buy,
  focus,
  onClose
}: ExplorerScreenProps) {
  const [kind, setKind] = useState<ExplorerKind>('weapons');
  const [answer, setAnswer] = useState<ExplorerList | null>(null);
  const [filters, setFilters] = useState<ExplorerFilters>(DEFAULT_FILTERS);
  const [options, setOptions] = useState<ExplorerOptions>(DEFAULT_EXPLORER_OPTIONS);
  // The options the list was last asked for, a beat behind the typing.
  const [asked, setAsked] = useState<ExplorerOptions>(DEFAULT_EXPLORER_OPTIONS);
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>({ id: 'Name', dir: 1 });
  const [chosen, setChosen] = useState<number | null>(null);
  const [shown, setShown] = useState<ExplorerDetail | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewRows, setViewRows] = useState(40);
  const bodyRef = useRef<HTMLDivElement>(null);
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
  const set = (change: Partial<ExplorerFilters>): void =>
    setFilters((was) => ({ ...was, ...change }));
  const setOption = (change: Partial<ExplorerOptions>): void =>
    setOptions((was) => ({ ...was, ...change }));

  useEffect(() => {
    const timer = setTimeout(() => setAsked(options), RETYPE_MS);
    return () => clearTimeout(timer);
  }, [options]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void list(kind, asked).then((found) => {
      if (live) setAnswer(found);
    });
    return () => {
      live = false;
    };
  }, [open, kind, list, characterKey, asked]);

  useEffect(() => {
    setShown(null);
    if (!open || chosen === null) return;
    let live = true;
    void detail(chosen).then((found) => {
      if (live) setShown(found);
    });
    return () => {
      live = false;
    };
  }, [open, chosen, detail, characterKey]);

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
    const body = bodyRef.current;
    if (!open || body === null) return;
    const measure = (): void => setViewRows(Math.ceil(body.clientHeight / ROW_PX) + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [open, answer]);

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

  const rows = useMemo(() => {
    const backstabForced = asked.calc && asked.attack === 'surprise';
    const kept = all.filter((row) => passes(row, kind, filters, backstabForced));
    return orderRows(kept, (row) => cellOf(row, sort.id), sort.dir);
  }, [all, kind, filters, sort, asked, cellOf]);

  // Opened on an item: its list, the search cleared, the item chosen and scrolled to.
  const scrollToRef = useRef<number | null>(null);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  useEffect(() => {
    if (focus === null) return;
    if (kindRef.current !== focus.kind) {
      setKind(focus.kind);
      setAnswer(null);
      setFilters((f) => ({ ...f, type: '', slot: '', ability: DEFAULT_FILTERS.ability }));
      setSort({ id: 'Name', dir: 1 });
    }
    setFilters((f) => ({ ...f, query: '' }));
    setChosen(focus.item);
    scrollToRef.current = focus.item;
  }, [focus]);
  useEffect(() => {
    const wanted = scrollToRef.current;
    if (wanted === null) return;
    const at = rows.findIndex((row) => row.number === wanted);
    if (at < 0) return;
    scrollToRef.current = null;
    const top = Math.max(0, at * ROW_PX - ROW_PX * 3);
    bodyRef.current?.scrollTo({ top });
    setScrollTop(top);
  }, [rows]);

  if (!open) return null;

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
    (sum, column) => sum + (column.id === 'Name' ? NAME_EM : Number.parseFloat(column.width) || 4),
    0
  );
  const tableWidth = `max(100%, calc(${ems}em + ${GAP_PX * (columns.length - 1) + PAD_PX * 2}px))`;
  const first = Math.max(0, Math.floor(scrollTop / ROW_PX) - OVERSCAN);
  const last = Math.min(rows.length, first + viewRows + OVERSCAN * 2);
  const chosenRow = all.find((row) => row.number === chosen);
  const switchKind = (next: ExplorerKind): void => {
    setKind(next);
    setAnswer(null);
    setChosen(null);
    set({ type: '', slot: '', ability: DEFAULT_FILTERS.ability });
    setSort({ id: 'Name', dir: 1 });
    setScrollTop(0);
    bodyRef.current?.scrollTo({ top: 0 });
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

  return (
    <div className="palette-scrim" onMouseDown={onClose} role="presentation">
      <div
        aria-label={t('explorer.dialogLabel', { characterName })}
        aria-modal="true"
        className="explorer-screen"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="ex-top">
          <nav className="ex-tabs" role="tablist">
            {KINDS.map((entry) => (
              <button
                aria-selected={kind === entry.id}
                className="ex-tab"
                key={entry.id}
                onClick={() => switchKind(entry.id)}
                onMouseDown={keepFocus}
                role="tab"
                type="button"
              >
                {entry.label()}
              </button>
            ))}
          </nav>
          <label className="ex-global" data-on={filters.usableOnly ? 'true' : 'false'}>
            <input
              checked={filters.usableOnly}
              onChange={(event) => set({ usableOnly: event.target.checked })}
              type="checkbox"
            />
            {t('explorer.usableOnly', { characterName })}
          </label>
          <button className="ex-btn" onClick={onClose} onMouseDown={keepFocus} type="button">
            {t('explorer.close')}
          </button>
        </header>

        <div className="ex-toolbar">
          <input
            aria-label={t('explorer.find')}
            className="ex-search"
            onChange={(event) => set({ query: event.target.value })}
            placeholder={t('explorer.find')}
            spellCheck={false}
            value={filters.query}
          />
          {kind === 'weapons' ? (
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
          {abilityField}
          <div className="ex-checks">
            <Check
              checked={filters.inGameOnly}
              label={t('explorer.inGameOnly')}
              onChange={(inGameOnly) => set({ inGameOnly })}
            />
          </div>
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
                style={{ ['--ex-cols' as string]: template, ['--ex-width' as string]: tableWidth }}
              >
                <div
                  className="ex-rows"
                  onScroll={(event: UIEvent<HTMLDivElement>) =>
                    setScrollTop(event.currentTarget.scrollTop)
                  }
                  ref={bodyRef}
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
                          setSort((was) =>
                            was.id === column.id
                              ? { id: column.id, dir: was.dir === 1 ? -1 : 1 }
                              : { id: column.id, dir: column.numeric === true ? -1 : 1 }
                          )
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
                          data-unusable={row.usable ? undefined : 'true'}
                          data-worn={row.worn ? 'true' : undefined}
                          key={row.number}
                          onClick={() => setChosen(row.number)}
                          role="row"
                          style={{ top: (first + i) * ROW_PX }}
                        >
                          {columns.map((column) => (
                            <span
                              className="ex-td"
                              data-numeric={column.numeric === true ? 'true' : undefined}
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
                  <div className="ex-sub">{subLine(kind, chosenRow)}</div>
                  <BuyBox
                    buy={buy}
                    buyPlan={buyPlan}
                    characterKey={characterKey}
                    item={shown.number}
                    purseKey={purseKey}
                  />
                  <p className="ex-text">
                    <Runs runs={shown.text} />
                  </p>
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
              <h3 className="ex-heading">{t('explorer.references')}</h3>
              {shown === null || shown.refs.length === 0 ? (
                <div className="ex-empty">{chosen === null ? '' : t('explorer.noReferences')}</div>
              ) : (
                <table className="ex-refs">
                  <tbody>
                    {shown.refs.map((ref, i) => (
                      <tr key={i}>
                        <td className="ex-pct">{ref.pct === undefined ? '' : `${ref.pct}%`}</td>
                        <td>
                          <Runs runs={ref.text} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
