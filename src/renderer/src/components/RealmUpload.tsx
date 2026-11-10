import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import Icon from './Icon';
import { keepFocus } from '../lib/focus';
import { t } from '../lib/i18n';
import { REALM_EXTENSIONS } from '@shared/realmFiles';

export interface RealmUploadProps {
  /** The path the client kept the file at, or null when put away unsent. */
  onDone(file: string | null): void;
}

/** Where the window sends a realm's database, and the header that says it is this page. */
const UPLOAD_PATH = '/upload/realm';
const UPLOAD_HEADER = 'X-Majordomo-Upload';

/** Bytes as a person reads them. */
function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'sending'; percent: number }
  | { kind: 'checking' }
  | { kind: 'refused'; error: string };

/**
 * A realm database sent up from this browser (2026-11-10): the realm picker
 * in a browser tab, in place of choosing from the client's own disk, which a
 * tab's player cannot reach. The file goes as the body of one request
 * (`/upload/realm`, `main/host/web/uploads.ts`) rather than over the socket,
 * since MudRev's is 20 MB and more, with how far it has got drawn as it
 * goes; the client checks it opens as a realm, keeps it, and answers with
 * the path the realm then reads.
 *
 * The same box every dialog over the console is drawn in (`.palette`), and
 * the same rules: Escape puts it away and a click on the scrim does, unless
 * a file is on its way.
 */
export default function RealmUpload({ onDone }: RealmUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const input = useRef<HTMLInputElement | null>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const busy = stage.kind === 'sending' || stage.kind === 'checking';

  useEffect(() => {
    frame.current?.focus();
    // A dialog put away mid-send takes the send with it.
    return () => request.current?.abort();
  }, []);

  const dismiss = (): void => {
    if (busy) return;
    onDone(null);
  };

  const send = (): void => {
    if (file === null || busy) return;
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open('POST', `${UPLOAD_PATH}?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader(UPLOAD_HEADER, '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setStage(percent >= 100 ? { kind: 'checking' } : { kind: 'sending', percent });
    };
    xhr.upload.onload = () => setStage({ kind: 'checking' });
    xhr.onload = () => {
      request.current = null;
      let answer: { path?: unknown; error?: unknown } = {};
      try {
        answer = JSON.parse(xhr.responseText) as typeof answer;
      } catch {
        // An answer that is not ours: said below as a stopped upload.
      }
      if (xhr.status === 200 && typeof answer.path === 'string') {
        onDone(answer.path);
        return;
      }
      setStage({
        kind: 'refused',
        error: typeof answer.error === 'string' ? answer.error : t('web.upload.lost')
      });
    };
    xhr.onerror = () => {
      request.current = null;
      setStage({ kind: 'refused', error: t('web.upload.lost') });
    };
    setStage({ kind: 'sending', percent: 0 });
    xhr.send(file);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  };

  return (
    <div className="palette-scrim realm-upload-scrim" onMouseDown={dismiss} role="presentation">
      <div
        aria-label={t('web.upload.title')}
        aria-modal="true"
        className="surface palette realm-upload"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={frame}
        role="dialog"
        tabIndex={-1}
      >
        <header className="realm-upload-head">
          <span className="realm-upload-title">{t('web.upload.title')}</span>
          <button
            aria-label={t('web.upload.cancel')}
            className="quiet"
            disabled={busy}
            onClick={dismiss}
            onMouseDown={keepFocus}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>
        <p className="hint">{t('web.upload.lead')}</p>
        <input
          accept={REALM_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
          hidden
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setStage({ kind: 'idle' });
          }}
          ref={input}
          type="file"
        />
        <div className="realm-upload-row">
          <button disabled={busy} onClick={() => input.current?.click()} type="button">
            <Icon name="folder" />
            {t('web.upload.choose')}
          </button>
          {file !== null && (
            <span className="realm-upload-file">
              {t('web.upload.chosen', { name: file.name, size: formatSize(file.size) })}
            </span>
          )}
        </div>
        {busy && (
          <div className="realm-upload-progress" role="status">
            <span className="realm-upload-bar">
              <span
                style={{ width: `${stage.kind === 'sending' ? stage.percent : 100}%` }}
                data-checking={stage.kind === 'checking' ? 'true' : undefined}
              />
            </span>
            <span className="hint">
              {stage.kind === 'sending'
                ? t('web.upload.sending', { percent: stage.percent })
                : t('web.upload.checking')}
            </span>
          </div>
        )}
        {stage.kind === 'refused' && <p className="settings-warn">{stage.error}</p>}
        <footer className="realm-upload-actions">
          <button className="quiet" disabled={busy} onClick={dismiss} type="button">
            {t('web.upload.cancel')}
          </button>
          <button className="primary" disabled={file === null || busy} onClick={send} type="button">
            <Icon name="upload" />
            {t('web.upload.send')}
          </button>
        </footer>
      </div>
    </div>
  );
}
