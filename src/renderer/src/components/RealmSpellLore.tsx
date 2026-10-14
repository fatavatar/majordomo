/**
 * A realm's learned spell sentences, on the realm's page (2026-10-14): what
 * the client worked out a spell prints when it lands and when it ends, where
 * the shipped table has nothing for it. Read, put right, added and forgotten
 * here, because a sentence paired with the wrong spell is acted on: Fatty's
 * great power was learned as ending with a monster's death, so its wearing
 * off was never seen and it was not sung again.
 *
 * Its own save, for `RealmMessages`' reason: a row is saved when its editor
 * says so.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { TextField } from './FormField';
import Icon from './Icon';
import type { TableStatus } from './RealmTableBar';
import { t } from '../lib/i18n';
import type { LearnedSpellRow, LearnedSpellTable } from '@shared/ipc';

export interface RealmSpellLoreProps {
  /** The saved realm's name, or null for a realm not saved yet. */
  realm: string | null;
  load(realm: string): Promise<LearnedSpellTable>;
  save(realm: string, rows: LearnedSpellRow[]): Promise<string | null>;
}

/** More than this many are found with the search, not scrolled through. */
const SHOWN = 100;

const BLANK: LearnedSpellRow = { spell: '', start: '', stop: '' };

export default function RealmSpellLore({
  realm,
  load,
  save
}: RealmSpellLoreProps): React.JSX.Element {
  const [table, setTable] = useState<LearnedSpellTable | null>(null);
  const [status, setStatus] = useState<TableStatus>(null);
  const [query, setQuery] = useState('');
  /** The row open in the editor: its place in the table, or null for a new one. */
  const [editing, setEditing] = useState<{ index: number | null; draft: LearnedSpellRow } | null>(
    null
  );

  const reload = useCallback(async (): Promise<void> => {
    if (realm === null) return;
    setTable(await load(realm));
  }, [realm, load]);

  useEffect(() => {
    setTable(null);
    setStatus(null);
    setEditing(null);
    setQuery('');
    void reload();
  }, [reload]);

  const rows = useMemo(() => table?.rows ?? [], [table]);
  const matching = useMemo(() => {
    const words = query.trim().toLowerCase();
    return rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          words === '' ||
          [row.spell, row.start, row.stop].some((text) => text.toLowerCase().includes(words))
      );
  }, [rows, query]);

  if (realm === null) {
    return <p className="settings-note">{t('settings.spellLore.saveFirst')}</p>;
  }
  if (table !== null && !table.known) {
    return <p className="settings-note">{t('settings.spellLore.noData')}</p>;
  }

  const write = async (next: LearnedSpellRow[], said: string): Promise<void> => {
    const refusal = await save(realm, next);
    if (refusal !== null) {
      setStatus({ tone: 'bad', text: refusal });
      return;
    }
    setEditing(null);
    await reload();
    setStatus({ tone: 'ok', text: said });
  };

  const commit = async (): Promise<void> => {
    if (editing === null) return;
    const draft = {
      spell: editing.draft.spell.trim(),
      start: editing.draft.start.trim(),
      stop: editing.draft.stop.trim()
    };
    if (draft.spell === '') {
      setStatus({ tone: 'bad', text: t('settings.spellLore.nameNeeded') });
      return;
    }
    const next =
      editing.index === null
        ? [...rows, draft]
        : rows.map((row, i) => (i === editing.index ? draft : row));
    await write(next, t('settings.spellLore.saved', { spell: draft.spell }));
  };

  const forget = async (): Promise<void> => {
    if (editing === null || editing.index === null) return;
    const gone = rows[editing.index];
    if (gone === undefined) return;
    await write(
      rows.filter((_, i) => i !== editing.index),
      t('settings.spellLore.forgot', { spell: gone.spell })
    );
  };

  const patch = (change: Partial<LearnedSpellRow>): void =>
    setEditing((open) => (open === null ? open : { ...open, draft: { ...open.draft, ...change } }));

  const editor = (
    <div className="message-editor">
      <TextField
        label={t('settings.spellLore.spellLabel')}
        name="spell-lore-spell"
        onChange={(value) => patch({ spell: value })}
        onSubmit={() => void commit()}
        placeholder={t('settings.spellLore.spellPlaceholder')}
        value={editing?.draft.spell ?? ''}
      />
      <TextField
        hint={t('settings.spellLore.startHint')}
        label={t('settings.spellLore.startLabel')}
        name="spell-lore-start"
        onChange={(value) => patch({ start: value })}
        onSubmit={() => void commit()}
        spellCheck={false}
        value={editing?.draft.start ?? ''}
        wide
      />
      <TextField
        hint={t('settings.spellLore.stopHint')}
        label={t('settings.spellLore.stopLabel')}
        name="spell-lore-stop"
        onChange={(value) => patch({ stop: value })}
        onSubmit={() => void commit()}
        spellCheck={false}
        value={editing?.draft.stop ?? ''}
        wide
      />
      <div className="message-editor-actions">
        <button className="primary" onClick={() => void commit()} type="button">
          {t('settings.spellLore.saveRow')}
        </button>
        <button className="quiet" onClick={() => setEditing(null)} type="button">
          {t('settings.spellLore.cancel')}
        </button>
        {editing?.index !== null && editing?.index !== undefined && (
          <button className="danger" onClick={() => void forget()} type="button">
            {t('settings.spellLore.forget')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="realm-messages">
      <div className="messages-bar">
        <span className="messages-summary">
          {table === null
            ? t('settings.spellLore.loading')
            : rows.length === 0
              ? t('settings.spellLore.none')
              : rows.length === 1
                ? t('settings.spellLore.count.one')
                : t('settings.spellLore.count.many', { count: rows.length })}
        </span>
        <button
          className="quiet"
          onClick={() => setEditing({ index: null, draft: { ...BLANK } })}
          type="button"
        >
          <Icon name="plus" />
          <span>{t('settings.spellLore.add')}</span>
        </button>
      </div>
      {status !== null && (
        <p className={`messages-status ${status.tone}`} role="status">
          {status.text}
        </p>
      )}

      {editing !== null && editing.index === null && editor}

      {rows.length > 0 && (
        <>
          <input
            aria-label={t('settings.spellLore.searchLabel')}
            className="messages-search"
            id="realm-spell-lore-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // The realm form around this saves on Enter; a search does not.
              if (event.key === 'Enter') event.preventDefault();
            }}
            placeholder={t('settings.spellLore.searchPlaceholder')}
            spellCheck={false}
            type="search"
            value={query}
          />
          <ul className="messages-list">
            {matching.slice(0, SHOWN).map(({ row, index }) => (
              <li key={`${row.spell}-${index}`}>
                <div className="message-row">
                  <button
                    aria-expanded={editing?.index === index}
                    className="message-summary"
                    onClick={() =>
                      setEditing(editing?.index === index ? null : { index, draft: { ...row } })
                    }
                    type="button"
                  >
                    <span className="message-name">{row.spell}</span>
                    <span className="message-match">
                      {row.start || t('settings.spellLore.notLearned')}
                    </span>
                    <span className="message-chips">
                      <span className="chip">
                        {t('settings.spellLore.endsChip', {
                          stop: row.stop || t('settings.spellLore.notLearned')
                        })}
                      </span>
                    </span>
                  </button>
                </div>
                {editing?.index === index && editor}
              </li>
            ))}
          </ul>
          {matching.length > SHOWN && (
            <p className="settings-note">
              {t('settings.spellLore.more', { shown: SHOWN, count: matching.length })}
            </p>
          )}
          {matching.length === 0 && (
            <p className="settings-note">{t('settings.spellLore.noMatch')}</p>
          )}
        </>
      )}
    </div>
  );
}
