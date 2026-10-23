import { useCallback, useEffect, useMemo, useState } from 'react';

import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import {
  COMPARE_KINDS,
  type CompareKind,
  type CompareList,
  type ExplorerPlace,
  type ItemFacts
} from '@shared/explorer';
import { itemKey, mergeItemRules, type ItemRule } from '@shared/itemRules';
import { acted, commandsOf, flagText, type Action } from '../lib/itemManager';

/**
 * MMUD Explorer's Lists tab (2026-10-19), mudtool's `tabs/lists.js`: the
 * four compare lists, and the Item Manager.
 *
 * The Item Manager is the character as the game reports it: its rows are
 * what the pack holds and what its item rules name, and MME's flags *are*
 * those rules — Sell / Buy, Drop and Pick up / Equip, with MME's count as
 * the rule's *Min. to keep* or *Max to get* — written to the character's
 * own rows over the realm's table (`setItemDetails`), so a flag changed here
 * is what the engine does next. MME's Copy commands is kept.
 */
export type ListsSection = CompareKind | 'im';

export type CompareLists = Record<CompareKind, number[]>;

export interface PackItem {
  number: number | null;
  name: string;
  count: number;
  equipped: boolean;
}

export interface ExplorerListsProps {
  session: string;
  /** Changes when the pack does. */
  characterKey: string;
  pack: readonly PackItem[];
  lists: CompareLists;
  setLists(next: CompareLists): void;
  compare(kind: CompareKind, numbers: number[]): Promise<CompareList>;
  find(kind: CompareKind | 'items', text: string): Promise<Array<[number, string]>>;
  items(numbers: number[], names: string[]): Promise<ItemFacts[]>;
  rules(): Promise<{ realm: ItemRule[]; own: ItemRule[] }>;
  saveRules(own: ItemRule[]): Promise<string | null>;
  copy(text: string): void;
  follow(place: ExplorerPlace): void;
}

const SECTION_LABEL: Record<ListsSection, () => string> = {
  weapons: () => t('explorer.kinds.weapons'),
  armour: () => t('explorer.kinds.armour'),
  spells: () => t('explorer.kinds.spells'),
  monsters: () => t('explorer.kinds.monsters'),
  im: () => t('explorer.lists.itemManager')
};

/** The items added by hand, kept per character until a flag makes them a rule. */
const addedKey = (session: string): string => `mudengine.explorer.im.${session}`;

function recallAdded(session: string): number[] {
  try {
    const kept = JSON.parse(localStorage.getItem(addedKey(session)) ?? '[]') as unknown;
    return Array.isArray(kept) ? kept.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

function keepAdded(session: string, added: readonly number[]): void {
  try {
    localStorage.setItem(addedKey(session), JSON.stringify(added));
  } catch {
    // Storage refused: the additions last this visit.
  }
}

/** A picker: a box offering the realm's matches as it is typed, and Add. */
function Picker({
  kind,
  find,
  onPick
}: {
  kind: CompareKind | 'items';
  find: ExplorerListsProps['find'];
  onPick(n: number): void;
}) {
  const [typed, setTyped] = useState('');
  const [matches, setMatches] = useState<Array<[number, string]>>([]);
  const [said, setSaid] = useState<string | null>(null);
  /*
   * The name alone is asked for: a suggestion picked fills the box with
   * `name (n)`, which no name holds (2026-10-20), and its number is what Add
   * takes.
   */
  const asked = typed.replace(/\s*\(\d+\)\s*$/, '');
  useEffect(() => {
    let live = true;
    void find(kind, asked).then((found) => {
      if (live) setMatches(found);
    });
    return () => {
      live = false;
    };
  }, [find, kind, asked]);
  const id = `ex-pick-${kind}`;
  const add = (): void => {
    const exact = /\((\d+)\)\s*$/.exec(typed) ?? /^\s*(\d+)\s*$/.exec(typed);
    const n =
      exact !== null
        ? Number(exact[1])
        : (matches.find(([, name]) => name.toLowerCase() === asked.trim().toLowerCase())?.[0] ??
          matches[0]?.[0]);
    if (n === undefined || !matches.some(([m]) => m === n)) {
      setSaid(t('explorer.lists.noMatch', { typed }));
      return;
    }
    setSaid(null);
    setTyped('');
    onPick(n);
  };
  return (
    <div className="lists-add">
      <input
        list={id}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') add();
        }}
        placeholder={t('explorer.lists.pickPlaceholder')}
        type="search"
        value={typed}
      />
      <datalist id={id}>
        {matches.map(([n, name]) => (
          <option key={n} value={`${name} (${n})`} />
        ))}
      </datalist>
      <button className="ex-btn" onClick={add} onMouseDown={keepFocus} type="button">
        {t('explorer.lists.add')}
      </button>
      {said !== null && (
        <span className="ex-buy-said" data-tone="danger">
          {said}
        </span>
      )}
    </div>
  );
}

/** One compare list: its picker, its table, and Clear. */
function CompareSection({
  kind,
  numbers,
  setNumbers,
  compare,
  find,
  follow
}: {
  kind: CompareKind;
  numbers: number[];
  setNumbers(next: number[]): void;
  compare: ExplorerListsProps['compare'];
  find: ExplorerListsProps['find'];
  follow(place: ExplorerPlace): void;
}) {
  const [list, setList] = useState<CompareList | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    let live = true;
    void compare(kind, numbers).then((found) => {
      if (live) setList(found);
    });
    return () => {
      live = false;
    };
  }, [compare, kind, numbers]);
  return (
    <div className="lists-body">
      <Picker
        find={find}
        kind={kind}
        onPick={(n) => {
          if (!numbers.includes(n)) setNumbers([...numbers, n]);
        }}
      />
      {list === null ? (
        <div className="ex-empty">{t('explorer.loading')}</div>
      ) : !list.supported ? (
        <div className="ex-empty">{list.reason ?? t('explorer.unsupported')}</div>
      ) : list.rows.length === 0 ? (
        <p className="eq-hint">{t('explorer.lists.compareEmpty')}</p>
      ) : (
        <>
          <table className="lists-table">
            <thead>
              <tr>
                {list.columns.map((column) => (
                  <th data-numeric={column.numeric === true ? 'true' : undefined} key={column.id}>
                    {column.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr data-unusable={row.usable ? undefined : 'true'} key={row.number}>
                  {list.columns.map((column) => (
                    <td
                      data-numeric={column.numeric === true ? 'true' : undefined}
                      data-worked={
                        column.id === 'damage' && row.worked === true ? 'true' : undefined
                      }
                      key={column.id}
                    >
                      {column.id === 'Number' ? (
                        row.number
                      ) : column.id === 'Name' ? (
                        <button
                          className="ex-link"
                          onClick={() => follow({ tab: kind, n: row.number })}
                          onMouseDown={keepFocus}
                          type="button"
                        >
                          {row.name}
                        </button>
                      ) : (
                        String(row.cells[column.id] ?? '')
                      )}
                    </td>
                  ))}
                  <td>
                    <button
                      className="lists-remove"
                      onClick={() => setNumbers(numbers.filter((n) => n !== row.number))}
                      onMouseDown={keepFocus}
                      title={t('explorer.lists.remove')}
                      type="button"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="lists-actions">
            <button
              className="ex-btn"
              data-danger={clearing ? 'true' : undefined}
              onBlur={() => setClearing(false)}
              onClick={() => {
                if (!clearing) {
                  setClearing(true);
                  return;
                }
                setClearing(false);
                setNumbers([]);
              }}
              type="button"
            >
              {clearing ? t('explorer.lists.clearSure') : t('explorer.lists.clear')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ItemManager({
  session,
  characterKey,
  pack,
  find,
  items,
  rules,
  saveRules,
  copy,
  follow
}: Omit<ExplorerListsProps, 'lists' | 'setLists' | 'compare'>) {
  const [added, setAdded] = useState<number[]>(() => recallAdded(session));
  useEffect(() => keepAdded(session, added), [session, added]);
  const [held, setHeld] = useState<{ realm: ItemRule[]; own: ItemRule[] } | null>(null);
  const [facts, setFacts] = useState<ItemFacts[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const reload = useCallback(() => {
    void rules().then(setHeld);
  }, [rules]);
  useEffect(reload, [reload, characterKey]);

  const effective = useMemo(() => {
    const merged = new Map<string, ItemRule>();
    if (held !== null)
      for (const rule of mergeItemRules(held.realm, held.own)) merged.set(rule.item, rule);
    return merged;
  }, [held]);
  const ownKeys = useMemo(() => new Set(held?.own.map((rule) => itemKey(rule.item)) ?? []), [held]);

  useEffect(() => {
    const numbers = [
      ...pack.flatMap((item) => (item.number === null ? [] : [item.number])),
      ...added
    ];
    const names = [...ownKeys];
    let live = true;
    void items(numbers, names).then((found) => {
      if (live) setFacts(found);
    });
    return () => {
      live = false;
    };
  }, [items, pack, added, ownKeys]);

  /** The rows: the pack, then the character's own rules, then what was added by hand. */
  const rows = useMemo(() => {
    const byKey = new Map<
      string,
      {
        key: string;
        name: string;
        carried: number;
        equipped: boolean;
        source: string;
        fact?: ItemFacts;
      }
    >();
    const factByKey = new Map(facts.map((fact) => [itemKey(fact.name), fact]));
    for (const item of pack) {
      const key = itemKey(item.name);
      const was = byKey.get(key);
      byKey.set(key, {
        key,
        name: item.name,
        carried: (was?.carried ?? 0) + Math.max(1, item.count),
        equipped: (was?.equipped ?? false) || item.equipped,
        source:
          item.equipped || was?.equipped
            ? t('explorer.lists.sourceEquipped')
            : t('explorer.lists.sourceInventory'),
        fact: factByKey.get(key)
      });
    }
    for (const key of ownKeys) {
      if (byKey.has(key)) continue;
      const fact = factByKey.get(key);
      byKey.set(key, {
        key,
        name: fact?.name ?? key,
        carried: 0,
        equipped: false,
        source: t('explorer.lists.sourceRule'),
        fact
      });
    }
    for (const n of added) {
      const fact = facts.find((f) => f.number === n);
      if (fact === undefined) continue;
      const key = itemKey(fact.name);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        name: fact.name,
        carried: 0,
        equipped: false,
        source: t('explorer.lists.sourceAdded'),
        fact
      });
    }
    return [...byKey.values()].map((row) => ({ ...row, rule: effective.get(row.key) }));
  }, [pack, ownKeys, added, facts, effective]);

  const write = async (
    change: (key: string, row: (typeof rows)[number]) => Partial<ItemRule> | null
  ): Promise<void> => {
    if (held === null) return;
    if (selected.size === 0) {
      setSaid({ text: t('explorer.lists.selectFirst'), ok: false });
      return;
    }
    const own = new Map(held.own.map((rule) => [itemKey(rule.item), rule]));
    let changed = 0;
    for (const row of rows) {
      if (!selected.has(row.key)) continue;
      const patch = change(row.key, row);
      if (patch === null) continue;
      const next: ItemRule = {
        ...(own.get(row.key) ?? { item: row.key }),
        ...patch,
        item: row.key
      };
      for (const field of Object.keys(next) as Array<keyof ItemRule>)
        if (next[field] === undefined) delete next[field];
      own.set(row.key, next);
      changed += 1;
    }
    if (changed === 0) return;
    const refusal = await saveRules([...own.values()]);
    setSaid(
      refusal === null
        ? { text: t('explorer.lists.saved', { count: changed }), ok: true }
        : { text: refusal, ok: false }
    );
    reload();
  };
  const act = (action: Action): void => {
    void write((_key, row) => acted(row.rule, action, row.carried));
  };
  const remove = async (): Promise<void> => {
    if (held === null || selected.size === 0) return;
    const keep = held.own.filter((rule) => !selected.has(itemKey(rule.item)));
    setAdded(
      added.filter((n) => {
        const fact = facts.find((f) => f.number === n);
        return fact === undefined || !selected.has(itemKey(fact.name));
      })
    );
    if (keep.length !== held.own.length) {
      const refusal = await saveRules(keep);
      if (refusal !== null) setSaid({ text: refusal, ok: false });
      reload();
    }
    setSelected(new Set());
  };
  const toggle = (key: string, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
  };
  const carriedWeight = rows.reduce((sum, row) => sum + (row.fact?.enc ?? 0) * row.carried, 0);
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.key));

  return (
    <div className="lists-body">
      <Picker
        find={find}
        kind="items"
        onPick={(n) => {
          if (!added.includes(n)) setAdded([...added, n]);
        }}
      />
      <div className="lists-actions">
        <button
          className="ex-btn"
          onClick={() => act('sell')}
          title={t('explorer.lists.sellTitle')}
          type="button"
        >
          {t('explorer.lists.sellBuy')}
        </button>
        <button
          className="ex-btn"
          onClick={() => act('drop')}
          title={t('explorer.lists.dropTitle')}
          type="button"
        >
          {t('explorer.lists.drop')}
        </button>
        <button
          className="ex-btn"
          onClick={() => act('pickup')}
          title={t('explorer.lists.pickupTitle')}
          type="button"
        >
          {t('explorer.lists.pickupEquip')}
        </button>
        <button
          className="ex-btn"
          onClick={() => act('minus')}
          title={t('explorer.lists.minusTitle')}
          type="button"
        >
          −
        </button>
        <button
          className="ex-btn"
          onClick={() => act('plus')}
          title={t('explorer.lists.plusTitle')}
          type="button"
        >
          +
        </button>
        <button className="ex-btn" onClick={() => act('clear')} type="button">
          {t('explorer.lists.clearFlags')}
        </button>
        <button
          className="ex-btn"
          onClick={() => void remove()}
          title={t('explorer.lists.removeTitle')}
          type="button"
        >
          {t('explorer.lists.removeRows')}
        </button>
        <button
          className="ex-btn"
          onClick={() => {
            const picked = selected.size > 0 ? rows.filter((row) => selected.has(row.key)) : rows;
            const text = commandsOf(picked);
            if (text === '') {
              setSaid({ text: t('explorer.lists.noCommands'), ok: false });
              return;
            }
            copy(text);
            setSaid({
              text: t('explorer.lists.copied', { count: text.split('\r\n').length }),
              ok: true
            });
          }}
          type="button"
        >
          {t('explorer.lists.copyCommands')}
        </button>
        <span className="eq-hint">
          {t('explorer.lists.summary', { rows: rows.length, weight: carriedWeight })}
        </span>
        {said !== null && (
          <span className="ex-buy-said" data-tone={said.ok ? 'ok' : 'danger'}>
            {said.text}
          </span>
        )}
      </div>
      {held === null ? (
        <div className="ex-empty">{t('explorer.loading')}</div>
      ) : rows.length === 0 ? (
        <p className="eq-hint">{t('explorer.lists.imEmpty')}</p>
      ) : (
        <table className="lists-table">
          <thead>
            <tr>
              <th>
                <input
                  checked={allSelected}
                  onChange={(event) =>
                    setSelected(new Set(event.target.checked ? rows.map((row) => row.key) : []))
                  }
                  title={t('explorer.lists.selectAll')}
                  type="checkbox"
                />
              </th>
              <th data-numeric="true">#</th>
              <th>{t('explorer.columns.name')}</th>
              <th>{t('explorer.lists.flag')}</th>
              <th data-numeric="true">{t('explorer.lists.qty')}</th>
              <th>{t('explorer.lists.source')}</th>
              <th data-numeric="true">{t('explorer.lists.enc')}</th>
              <th>{t('explorer.lists.type')}</th>
              <th>{t('explorer.lists.worn')}</th>
              <th>{t('explorer.lists.usable')}</th>
              <th>{t('explorer.lists.value')}</th>
              <th>{t('explorer.lists.shop')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                data-selected={selected.has(row.key) ? 'true' : undefined}
                data-unusable={row.fact !== undefined && !row.fact.usable ? 'true' : undefined}
                key={row.key}
              >
                <td>
                  <input
                    checked={selected.has(row.key)}
                    onChange={(event) => toggle(row.key, event.target.checked)}
                    type="checkbox"
                  />
                </td>
                <td data-numeric="true">{row.fact?.number ?? ''}</td>
                <td>
                  {row.fact === undefined ? (
                    row.name
                  ) : (
                    <button
                      className="ex-link"
                      onClick={() =>
                        follow({
                          tab:
                            row.fact!.type === 'Weapon'
                              ? 'weapons'
                              : row.fact!.type === 'Armour'
                                ? 'armour'
                                : 'sundry',
                          n: row.fact!.number
                        })
                      }
                      onMouseDown={keepFocus}
                      type="button"
                    >
                      {row.name}
                    </button>
                  )}
                  {ownKeys.has(row.key) && (
                    <span className="lists-own">{t('explorer.lists.own')}</span>
                  )}
                </td>
                <td className="lists-flag">{flagText(row.rule)}</td>
                <td data-numeric="true">{row.carried > 0 ? row.carried : ''}</td>
                <td>{row.source}</td>
                <td data-numeric="true">{row.fact?.enc ?? ''}</td>
                <td>{row.fact?.type ?? ''}</td>
                <td>{row.fact?.worn ?? ''}</td>
                <td>
                  {row.fact === undefined
                    ? ''
                    : row.fact.usable
                      ? t('explorer.lists.yes')
                      : t('explorer.lists.no')}
                </td>
                <td>{row.fact?.value ?? ''}</td>
                <td>
                  {row.fact?.shop ?? t('explorer.lists.noShop')}
                  {row.fact !== undefined && row.fact.more > 0 && ` +${row.fact.more}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="eq-hint">{t('explorer.lists.imHint')}</p>
    </div>
  );
}

export default function ExplorerLists(props: ExplorerListsProps) {
  const { lists, setLists } = props;
  const [section, setSection] = useState<ListsSection>('weapons');
  return (
    <div className="lists-page">
      <nav className="lists-nav">
        {[...COMPARE_KINDS, 'im' as const].map((id) => (
          <button
            aria-selected={section === id}
            className="ex-tab"
            key={id}
            onClick={() => setSection(id)}
            onMouseDown={keepFocus}
            type="button"
          >
            {id === 'im' ? SECTION_LABEL[id]() : `${SECTION_LABEL[id]()} (${lists[id].length})`}
          </button>
        ))}
      </nav>
      {section === 'im' ? (
        <ItemManager {...props} />
      ) : (
        <CompareSection
          compare={props.compare}
          find={props.find}
          follow={props.follow}
          kind={section}
          numbers={lists[section]}
          setNumbers={(next) => setLists({ ...lists, [section]: next })}
        />
      )}
    </div>
  );
}
