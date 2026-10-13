/**
 * Rows of what to do about particular items (`shared/itemRules.ts`): a
 * searchable list, a row that opens into its editor, and a way to add one —
 * MegaMUD's *Game Item Details*, its options and its keep, get, path and
 * shop fields. The realm's facts the dialog also shows (weight, price, type,
 * where it is worn) are the realm data's, and are not edited here.
 *
 * Shared by the realm's imported table (`RealmItems`) and a character's own
 * rows, laid over it field by field, so every field has an *unset* choice.
 * The list keeps the monster table's look (`MonsterRules`).
 */
import { useMemo, useState } from 'react';

import { NumberField, TextField } from './FormField';
import Icon from './Icon';
import { t } from '../lib/i18n';
import { ITEM_FLAGS, itemKey, type ItemFlag, type ItemRule } from '@shared/itemRules';

/** How many rows are drawn at once. The search narrows the rest. */
const SHOWN = 50;

/** One literal `t()` per option, for `i18n-coverage.test.ts`. */
const FLAG_WORD: Record<ItemFlag, () => string> = {
  collect: () => t('settings.items.flags.collect'),
  discard: () => t('settings.items.flags.discard'),
  equip: () => t('settings.items.flags.equip'),
  find: () => t('settings.items.flags.find'),
  open: () => t('settings.items.flags.open'),
  buy: () => t('settings.items.flags.buy'),
  sell: () => t('settings.items.flags.sell'),
  cannotTake: () => t('settings.items.flags.cannotTake'),
  backstab: () => t('settings.items.flags.backstab'),
  mustHaveMin: () => t('settings.items.flags.mustHaveMin')
};

function flagLabel(flag: ItemFlag): string {
  return FLAG_WORD[flag]();
}

interface Editing {
  /** The row's item when editing one, or null for a new row. */
  item: string | null;
  draft: ItemRule;
}

export interface ItemRuleListProps {
  rows: readonly ItemRule[];
  /** Replace the rows. Resolves to a refusal, or null once saved. */
  onChange(rows: ItemRule[], said: string): Promise<string | null>;
  /** Name prefix for the fields, so two lists on one page stay distinct. */
  namePrefix: string;
  addLabel: string;
  emptyText: string;
}

export function ItemRuleList({
  rows,
  onChange,
  namePrefix,
  addLabel,
  emptyText
}: ItemRuleListProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const matching = useMemo(() => {
    const words = query.trim().toLowerCase();
    return rows.filter((row) => words.length === 0 || row.item.includes(words));
  }, [rows, query]);

  const write = async (next: ItemRule[], said: string): Promise<boolean> => {
    const refusal = await onChange(next, said);
    if (refusal !== null) {
      setStatus({ tone: 'bad', text: refusal });
      return false;
    }
    setStatus({ tone: 'ok', text: said });
    return true;
  };

  const commit = async (): Promise<void> => {
    if (editing === null) return;
    const item = itemKey(editing.draft.item);
    if (item.length === 0) {
      setStatus({ tone: 'bad', text: t('settings.items.needsName') });
      return;
    }
    const draft: ItemRule = { ...editing.draft, item };
    if (rows.some((row) => row.item === item && row.item !== editing.item)) {
      setStatus({ tone: 'bad', text: t('settings.items.duplicate', { item }) });
      return;
    }
    const next =
      editing.item === null
        ? [...rows, draft]
        : rows.map((row) => (row.item === editing.item ? draft : row));
    if (await write(next, t('settings.items.savedRow'))) setEditing(null);
  };

  const remove = async (): Promise<void> => {
    if (editing === null || editing.item === null) return;
    const gone = editing.item;
    if (
      await write(
        rows.filter((row) => row.item !== gone),
        t('settings.items.removedRow')
      )
    ) {
      setEditing(null);
    }
  };

  /** Sets or clears one optional field; `undefined` removes the key outright. */
  const setField = <K extends keyof ItemRule>(key: K, value: ItemRule[K] | undefined): void =>
    setEditing((was) => {
      if (was === null) return was;
      const draft = { ...was.draft };
      if (value === undefined) delete draft[key];
      else draft[key] = value;
      return { ...was, draft };
    });

  const countField = (key: 'keep' | 'most', label: string) => (
    <NumberField
      label={label}
      name={`${namePrefix}-${key}`}
      onChange={(value) => {
        const n = Number.parseInt(value, 10);
        setField(key, Number.isFinite(n) && n > 0 ? n : undefined);
      }}
      placeholder="0"
      value={editing?.draft[key] !== undefined ? String(editing.draft[key]) : ''}
    />
  );

  const textField = (key: 'ifNeeded' | 'shop', label: string, hint: string) => (
    <TextField
      hint={hint}
      label={label}
      name={`${namePrefix}-${key}`}
      onChange={(value) => setField(key, value.trim().length === 0 ? undefined : value)}
      onSubmit={() => void commit()}
      spellCheck={false}
      value={editing?.draft[key] ?? ''}
    />
  );

  const editor = (
    <div className="message-editor">
      <div className="settings-inline">
        <TextField
          label={t('settings.items.nameLabel')}
          name={`${namePrefix}-item`}
          onChange={(value) => setField('item', value)}
          onSubmit={() => void commit()}
          placeholder={t('settings.items.namePlaceholder')}
          spellCheck={false}
          value={editing?.draft.item ?? ''}
        />
      </div>
      <div className="message-effects" role="group" aria-label={t('settings.items.flagsLabel')}>
        <span className="message-effects-label">{t('settings.items.flagsLabel')}</span>
        {ITEM_FLAGS.map((flag) => {
          const on = editing?.draft[flag] === true;
          return (
            <button
              aria-pressed={on}
              className="chip pick"
              key={flag}
              onClick={() => setField(flag, on ? undefined : true)}
              type="button"
            >
              {flagLabel(flag)}
            </button>
          );
        })}
      </div>
      <div className="settings-inline">
        {countField('keep', t('settings.items.keepLabel'))}
        {countField('most', t('settings.items.mostLabel'))}
      </div>
      {textField('ifNeeded', t('settings.items.ifNeededLabel'), t('settings.items.ifNeededHint'))}
      {textField('shop', t('settings.items.shopLabel'), t('settings.items.shopHint'))}
      <div className="message-editor-actions">
        <button className="primary" onClick={() => void commit()} type="button">
          {t('settings.items.saveRow')}
        </button>
        <button className="quiet" onClick={() => setEditing(null)} type="button">
          {t('settings.items.cancel')}
        </button>
        {editing?.item !== null && editing?.item !== undefined && (
          <button className="danger" onClick={() => void remove()} type="button">
            {t('settings.items.removeRow')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="messages-bar">
        <span className="messages-summary">
          {rows.length === 0
            ? emptyText
            : rows.length === 1
              ? t('settings.items.count.one')
              : t('settings.items.count.many', { count: rows.length })}
        </span>
        <button
          className="quiet"
          onClick={() => setEditing({ item: null, draft: { item: '' } })}
          type="button"
        >
          <Icon name="plus" />
          <span>{addLabel}</span>
        </button>
      </div>

      {status !== null && (
        <p className={`messages-status ${status.tone}`} role="status">
          {status.text}
        </p>
      )}

      {editing !== null && editing.item === null && editor}

      {rows.length > 0 && (
        <>
          <input
            aria-label={t('settings.items.searchLabel')}
            className="messages-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // The form around this saves on Enter; a search does not.
              if (event.key === 'Enter') event.preventDefault();
            }}
            placeholder={t('settings.items.searchPlaceholder')}
            spellCheck={false}
            type="search"
            value={query}
          />
          <ul className="messages-list">
            {matching.slice(0, SHOWN).map((row) => (
              <li key={row.item}>
                <div className="message-row">
                  <button
                    aria-expanded={editing?.item === row.item}
                    className="message-summary"
                    onClick={() =>
                      setEditing(
                        editing?.item === row.item ? null : { item: row.item, draft: { ...row } }
                      )
                    }
                    type="button"
                  >
                    <span className="message-name">{row.item}</span>
                    <span className="message-chips">
                      {ITEM_FLAGS.filter((flag) => row[flag] === true).map((flag) => (
                        <span className="chip quiet" key={flag}>
                          {flagLabel(flag)}
                        </span>
                      ))}
                      {row.keep !== undefined && (
                        <span className="chip">
                          {t('settings.items.keepChip', { count: row.keep })}
                        </span>
                      )}
                      {row.most !== undefined && (
                        <span className="chip">
                          {t('settings.items.mostChip', { count: row.most })}
                        </span>
                      )}
                      {row.shop !== undefined && <span className="chip info">{row.shop}</span>}
                      {row.ifNeeded !== undefined && (
                        <span className="chip info">{row.ifNeeded}</span>
                      )}
                    </span>
                  </button>
                </div>
                {editing?.item === row.item && editor}
              </li>
            ))}
          </ul>
          {matching.length > SHOWN && (
            <p className="settings-note">
              {t('settings.items.more', { shown: SHOWN, count: matching.length })}
            </p>
          )}
          {matching.length === 0 && <p className="settings-note">{t('settings.items.noMatch')}</p>}
        </>
      )}
    </>
  );
}
