/**
 * Loops another player shared, from the file they exported (2026-10-19): a
 * mudengine loop file, read here and filed in this realm beside its own
 * (`importLoopFile`), one of the same name replaced.
 */
import { useRef, useState } from 'react';

import Icon from './Icon';
import type { TableStatus } from './RealmTableBar';
import { t } from '../lib/i18n';

export interface LoopFileImportProps {
  /** The realm's name; null while there is no realm on disk to add to. */
  realm: string | null;
  importFile(
    realm: string,
    text: string
  ): Promise<{ ok: true; count: number; replaced: number } | { ok: false; error: string }>;
  /** Called first, so an edit waiting to be saved is written before the file is. */
  beforeImport(): void;
  /** Called after loops were written, so the page takes up the list on disk. */
  onImported(): void;
}

export default function LoopFileImport({
  realm,
  importFile,
  beforeImport,
  onImported
}: LoopFileImportProps): React.JSX.Element | null {
  const input = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<TableStatus>(null);
  const picked = async (file: File | undefined): Promise<void> => {
    if (realm === null || file === undefined) return;
    try {
      beforeImport();
      const result = await importFile(realm, await file.text());
      if (!result.ok) {
        setStatus({ tone: 'bad', text: result.error });
        return;
      }
      setStatus({
        tone: 'ok',
        text:
          result.count === 1
            ? t('settings.loopSection.fileImported.one', { replaced: result.replaced })
            : t('settings.loopSection.fileImported.many', {
                count: result.count,
                replaced: result.replaced
              })
      });
      onImported();
    } catch (reason: unknown) {
      console.error('loop file import failed', reason);
      setStatus({ tone: 'bad', text: t('settings.loopSection.importUnreadable') });
    }
  };
  if (realm === null) return null;
  return (
    <>
      <input
        accept=".yaml,.yml,.txt"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared first, so the same file can be picked again.
          event.target.value = '';
          void picked(file);
        }}
        ref={input}
        tabIndex={-1}
        type="file"
      />
      <button className="quiet add-step" onClick={() => input.current?.click()} type="button">
        <Icon name="plus" />
        <span>{t('settings.loopSection.fileImportLabel')}</span>
      </button>
      <p className="settings-note">{t('settings.loopSection.fileImportNote')}</p>
      {status !== null && (
        <p className={`messages-status ${status.tone}`} role="status">
          {status.text}
        </p>
      )}
    </>
  );
}
