/**
 * A realm's item table, on the realm's page: import MegaMUD's `Items.md`,
 * then read, edit and add rows. Decoded here, in the window, for
 * `RealmMonsters`' reason; only the rows that choose something cross.
 */
import { useCallback, useEffect, useState } from 'react';

import { ItemRuleList } from './ItemRules';
import RealmTableBar, { importedOn, type TableStatus } from './RealmTableBar';
import { t } from '../lib/i18n';
import { itemTableRows } from '@shared/megamudDb';
import { type ItemImport, type ItemRule, type ItemTable } from '@shared/itemRules';

export interface RealmItemsProps {
  /** The saved realm's name, or null for a realm not saved yet. */
  realm: string | null;
  load(realm: string): Promise<ItemTable>;
  importRows(realm: string, fileName: string, items: ItemRule[]): Promise<ItemImport>;
  save(realm: string, items: ItemRule[]): Promise<string | null>;
}

export default function RealmItems({
  realm,
  load,
  importRows,
  save
}: RealmItemsProps): React.JSX.Element {
  const [table, setTable] = useState<ItemTable | null>(null);
  const [status, setStatus] = useState<TableStatus>(null);
  /** A decoded file waiting on *replace the table this realm has?* */
  const [pending, setPending] = useState<{
    name: string;
    rows: ItemRule[];
    read: number;
  } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (realm === null) return;
    setTable(await load(realm));
  }, [realm, load]);

  useEffect(() => {
    setTable(null);
    setStatus(null);
    setPending(null);
    void reload();
  }, [reload]);

  if (realm === null) {
    return <p className="settings-note">{t('settings.items.saveFirst')}</p>;
  }

  const rows = table?.items ?? [];

  const runImport = async (file: { name: string; rows: ItemRule[]; read: number }) => {
    setPending(null);
    const result = await importRows(realm, file.name, file.rows);
    if (!result.ok) {
      setStatus({ tone: 'bad', text: result.error });
      return;
    }
    await reload();
    setStatus({
      tone: 'ok',
      text: t('settings.items.imported', { count: result.count, read: file.read })
    });
  };

  const picked = async (file: File): Promise<void> => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setStatus({ tone: 'bad', text: t('settings.items.unreadable') });
      return;
    }
    // One row per item name, the first kept (`itemTableRows`).
    const { rows: kept, read } = itemTableRows(bytes);
    if (read === 0) {
      setStatus({ tone: 'bad', text: t('settings.items.notItems', { file: file.name }) });
      return;
    }
    if (kept.length === 0) {
      setStatus({
        tone: 'bad',
        text: t('settings.items.nothingSaid', { count: read, file: file.name })
      });
      return;
    }
    const chosen = { name: file.name, rows: kept, read };
    // Replacing a table is not undoable from here, so it is asked about --
    // but only when there is a table to lose.
    if (rows.length > 0) setPending(chosen);
    else await runImport(chosen);
  };

  // The list says what happened to a row itself; this only keeps the table.
  const change = async (next: ItemRule[]): Promise<string | null> => {
    const refusal = await save(realm, next);
    if (refusal === null) {
      setTable({ source: table?.source ?? null, items: next });
      setStatus(null);
    }
    return refusal;
  };

  const imported = importedOn(table?.source);

  return (
    <div className="realm-messages">
      <RealmTableBar
        accept=".md,.bak"
        confirm={
          pending === null
            ? null
            : {
                text: t('settings.items.confirmReplace', {
                  count: rows.length,
                  file: pending.name
                }),
                replaceLabel: t('settings.items.replace'),
                cancelLabel: t('settings.items.cancel'),
                onReplace: () => void runImport(pending),
                onCancel: () => setPending(null)
              }
        }
        importLabel={t('settings.items.import')}
        inputId="realm-items-file"
        onFile={(file) => void picked(file)}
        status={status}
        summary={
          table === null
            ? t('settings.items.loading')
            : table.source && imported
              ? t('settings.items.source', {
                  file: table.source.file,
                  date: imported.toLocaleDateString()
                })
              : null
        }
      />

      {table !== null && (
        <ItemRuleList
          addLabel={t('settings.items.add')}
          emptyText={t('settings.items.none')}
          namePrefix="realm-item"
          onChange={change}
          rows={rows}
        />
      )}
    </div>
  );
}
