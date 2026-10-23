/**
 * A mudstats board's ingest API, as its own specification states it
 * (2026-10-16): the handshake that proves a character is ours by a code
 * telepathed to it in the game, the posts of its readings, and the key's own
 * calls. Every call answers rather than throws: a board that is down is an
 * answer (`status` 0) the reporter acts on, not a fault.
 *
 * `request`, `claim` and `fields` carry no key; everything else carries it
 * in `X-Mudstats-Key`. The key is never put anywhere else — not in a URL,
 * not in a notice — because it may write the character's record.
 */

/** One call's answer: the status (0 when the board was never reached) and its body. */
export interface IngestAnswer {
  status: number;
  body: Record<string, unknown>;
  /** `Retry-After`, in seconds, on a 429. */
  retryAfter: number | null;
}

/** A reading's value: a number or a short text, as `GET /api/ingest/fields` types them. */
export type Reading = number | string;

/**
 * How long one call may take. The board is on the local network; a call
 * still waiting after this is one whose board has gone, and the reporter
 * backs off from it.
 */
const CALL_TIMEOUT_MS = 10_000;

export class MudStatsApi {
  private readonly base: string;

  constructor(
    url: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.base = url.replace(/\/+$/, '');
  }

  /** The readings a post may hold and the board's floor between posts. No key. */
  fields(): Promise<IngestAnswer> {
    return this.call('GET', '/api/ingest/fields');
  }

  /** A code telepathed to `player` in the game; the answer's `ticket` is our half. */
  request(player: string): Promise<IngestAnswer> {
    return this.call('POST', '/api/ingest/request', { player });
  }

  /** The code read in the game, redeemed for the key. */
  claim(ticket: string, code: string, label: string): Promise<IngestAnswer> {
    return this.call('POST', '/api/ingest/claim', { ticket, code, label });
  }

  /** Which character a key writes, and how often it has. */
  whoami(key: string): Promise<IngestAnswer> {
    return this.call('GET', '/api/ingest/whoami', undefined, key);
  }

  /** The key retired, for good. */
  revoke(key: string): Promise<IngestAnswer> {
    return this.call('POST', '/api/ingest/revoke', {}, key);
  }

  /** One snapshot of the character's readings. */
  post(key: string, metrics: Record<string, Reading>): Promise<IngestAnswer> {
    return this.call('POST', '/api/ingest', { metrics }, key);
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    key?: string
  ): Promise<IngestAnswer> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key !== undefined) headers['X-Mudstats-Key'] = key;
    try {
      const response = await this.fetcher(`${this.base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
      });
      let parsed: unknown = {};
      try {
        parsed = await response.json();
      } catch {
        parsed = {};
      }
      const retry = Number(response.headers.get('retry-after'));
      return {
        status: response.status,
        body: isRecord(parsed) ? parsed : {},
        retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null
      };
    } catch (error) {
      return {
        status: 0,
        body: { detail: error instanceof Error ? error.message : String(error) },
        retryAfter: null
      };
    }
  }
}

/** The board's own sentence for an answer, meant to be shown as it is. */
export function detailOf(answer: IngestAnswer): string {
  const detail = answer.body['detail'];
  return typeof detail === 'string' && detail.length > 0 ? detail : `HTTP ${answer.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
