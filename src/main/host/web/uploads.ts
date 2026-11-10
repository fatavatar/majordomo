/**
 * A realm database sent up from a browser tab (2026-11-10), in place of
 * choosing a file on the client's own disk: a tab's player has the database
 * on their machine, and the client's disk is somewhere they cannot reach —
 * a container's volume, a server across the room. MudRev's is 20 MB and
 * more, so it never rides the socket: the tab posts the file's bytes to
 * `/upload/realm` and they are written to disk as they arrive.
 *
 * Kept under the home's `databases` folder by the name it was sent with, a
 * number added where that name is taken: a realm reading the file already
 * there is never written over under it. Written to a hidden name first and
 * renamed only once it opens as a realm, so a refused or broken upload
 * leaves nothing behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { REALM_EXTENSIONS, type RealmSummary } from '../../../shared/realmFiles';

export type UploadResult =
  | { ok: true; path: string; summary: RealmSummary | null }
  | { ok: false; status: number; error: string };

export interface RealmUploadOptions {
  /** The folder kept files go in, made when the first arrives. */
  dir: string;
  /** The name the file had where it was sent from. */
  name: string;
  /** The most bytes taken; past it the upload is refused and nothing kept. */
  maxBytes: number;
  /** Why the written file is not a realm, or null when it opens as one. */
  check(file: string): string | null;
  /** What the kept file holds, said back to whoever sent it; null where it cannot be said. */
  describe?(file: string): RealmSummary | null;
  /** The sentences for a refusal, from the caller's locale. */
  say: {
    badName: string;
    tooLarge: (max: string) => string;
    failed: (message: string) => string;
  };
}

/** A name as sent, safe to keep: its last segment, and nothing that walks or hides. */
export function realmFileName(sent: string): string | null {
  const base = path.basename(sent.replace(/\\/g, '/')).trim();
  const extension = path.extname(base).slice(1).toLowerCase();
  if (!(REALM_EXTENSIONS as readonly string[]).includes(extension)) return null;
  const stem = base
    .slice(0, base.length - extension.length - 1)
    .replace(/[^A-Za-z0-9 ._()-]/g, '_')
    .replace(/^[.\s]+/, '')
    .slice(0, 80);
  return stem === '' ? null : `${stem}.${extension}`;
}

/** The name in `dir` not yet taken: `mudrev.mdb`, then `mudrev-2.mdb`, and on. */
export function freeName(dir: string, name: string): string {
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? name : `${stem}-${n}${extension}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
}

/** Megabytes, as a refusal says them. */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Streams `body` to disk under `dir`, checks it, and keeps it; or says why not. */
export function receiveRealm(body: Readable, options: RealmUploadOptions): Promise<UploadResult> {
  const name = realmFileName(options.name);
  if (name === null) {
    body.resume();
    return Promise.resolve({ ok: false, status: 400, error: options.say.badName });
  }
  fs.mkdirSync(options.dir, { recursive: true });
  // Hidden until kept, and with the extension the realm's reader goes by.
  const temp = path.join(
    options.dir,
    `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(name)}`
  );
  const out = fs.createWriteStream(temp);
  let size = 0;
  let refused: UploadResult | null = null;

  return new Promise<UploadResult>((resolve) => {
    const fail = (result: UploadResult): void => {
      if (refused !== null) return;
      refused = result;
      body.unpipe(out);
      body.resume();
      out.destroy();
      fs.rm(temp, { force: true }, () => resolve(result));
    };
    body.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBytes) {
        fail({ ok: false, status: 413, error: options.say.tooLarge(megabytes(options.maxBytes)) });
      }
    });
    body.on('error', (error) =>
      fail({ ok: false, status: 400, error: options.say.failed(String(error)) })
    );
    out.on('error', (error) =>
      fail({ ok: false, status: 500, error: options.say.failed(String(error)) })
    );
    out.on('finish', () => {
      if (refused !== null) return;
      const why = options.check(temp);
      if (why !== null) {
        fail({ ok: false, status: 422, error: why });
        return;
      }
      const kept = path.join(options.dir, freeName(options.dir, name));
      fs.rename(temp, kept, (error) => {
        if (error) {
          fail({ ok: false, status: 500, error: options.say.failed(String(error)) });
          return;
        }
        let summary: RealmSummary | null = null;
        try {
          summary = options.describe?.(kept) ?? null;
        } catch {
          // Kept all the same: what it holds is said once a realm reads it.
        }
        resolve({ ok: true, path: kept, summary });
      });
    });
    body.pipe(out);
  });
}
