/**
 * Posting one character's readings to its realm's mudstats board, and the
 * handshake that gets the key to do it (the board's ingest specification,
 * 2026-10-16).
 *
 * ## The handshake
 *
 * The board proves a character is ours by telepathing it a one-time code in
 * the game; whoever can read that window is its player. This client *is* that
 * window, so it reads the code itself: after `request`, the first telepath
 * carrying a six-digit code is redeemed (`claim`), and the key is kept beside
 * the character's password. The board does not say who sends the code or in
 * what words, so nothing more than *a code, after we asked, before it expires*
 * is matched; a code that arrives and is refused is said, with what the board
 * said. `request` is never repeated on its own: each one writes a line in the
 * game.
 *
 * ## The posts
 *
 * A whole snapshot (`statsSnapshot`) every `logging.stats.everySeconds`, never
 * sooner than the board's own floor (`min_interval`), and only while the
 * character is in the game: a silence out of it is what the board's
 * dropped-out alert listens for. What the board answers decides what happens
 * next — a 429 waits its `Retry-After` and posts afresh rather than the
 * stale snapshot; 401, 404 and 422 stop, said once, until the settings
 * change; anything unreachable backs off, doubling to a ceiling, said once
 * per outage.
 */
import { t } from '../app/i18n';
import type { StatsReportConfig, StatsTarget } from '../../shared/config';
import { detailOf, MudStatsApi, type IngestAnswer, type Reading } from './MudStatsApi';

export interface ReporterHost {
  /** The character's readings now, or null out of the game. */
  snapshot(): Record<string, Reading> | null;
  /** The character's name as the board knows it: its first. Null before it is known. */
  playerName(): string | null;
  /** Said on this character's console. */
  notice(text: string): void;
}

/** The key kept beside the password, or none (`''`); a refusal to keep it, else null. */
export type KeepKey = (key: string) => string | null;

/** What the board says when it does not say: its own documented floor between posts. */
const BOARD_FLOOR_S = 15;
/** The longest an unreachable board is waited out between tries. */
const BACKOFF_CEILING_MS = 15 * 60_000;
/** How often a claim the board says has not reached the character yet is tried again. */
const CLAIM_RETRY_MS = 5_000;
/** How many times. */
const CLAIM_TRIES = 6;
/** How long a code is waited for, where the board does not say (`expires_in`). */
const CODE_WAIT_S = 600;
/** A six-digit code standing alone in a telepath. */
const CODE = /(?<!\d)(\d{6})(?!\d)/;

export class StatsReporter {
  private target: StatsTarget = { url: '', key: '' };
  private report: StatsReportConfig = { enabled: false, everySeconds: 60 };
  private api: MudStatsApi | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** The board's readings and floor, once asked (`GET /api/ingest/fields`). */
  private board: { fields: Set<string> | null; floorS: number } | null = null;
  /** Posting stopped until the settings change: what the board said. */
  private stopped: string | null = null;
  private failures = 0;
  /** The code a link is waiting for. */
  private waiting: { resolve: (code: string) => void; until: number } | null = null;
  private linking = false;
  private disposed = false;

  constructor(
    private readonly host: ReporterHost,
    private readonly label: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  configure(target: StatsTarget, report: StatsReportConfig): void {
    const changed =
      target.url !== this.target.url ||
      target.key !== this.target.key ||
      report.enabled !== this.report.enabled ||
      report.everySeconds !== this.report.everySeconds;
    if (!changed) return;
    if (target.url !== this.target.url) {
      this.api = target.url === '' ? null : new MudStatsApi(target.url, this.fetcher);
      this.board = null;
    }
    this.target = target;
    this.report = report;
    this.stopped = null;
    this.failures = 0;
    this.schedule(0);
  }

  /** Whether posting is asked for and possible: a board, a key, and the switch on. */
  get posting(): boolean {
    return this.report.enabled && this.api !== null && this.target.key !== '';
  }

  /** A telepath to this character: the code a link is waiting for, perhaps. */
  heard(message: string): void {
    const waiting = this.waiting;
    if (waiting === null || Date.now() > waiting.until) return;
    const code = CODE.exec(message)?.[1];
    if (code === undefined) return;
    this.waiting = null;
    waiting.resolve(code);
  }

  /**
   * The handshake: a code asked for, read off the telepath that brings it,
   * and redeemed for the key, which is kept. What happened, in a sentence.
   */
  async link(keep: KeepKey): Promise<string> {
    const api = this.api;
    if (api === null) return t('mudstats.link.noBoard');
    if (this.linking) return t('mudstats.link.busy');
    const player = this.host.playerName();
    if (player === null) return t('mudstats.link.notInGame');
    this.linking = true;
    try {
      const asked = await api.request(player);
      if (asked.status !== 200) return t('mudstats.link.refused', { detail: detailOf(asked) });
      const ticket = asked.body['ticket'];
      if (typeof ticket !== 'string')
        return t('mudstats.link.refused', { detail: detailOf(asked) });
      const expires = Number(asked.body['expires_in']);
      const waitS = Number.isFinite(expires) && expires > 0 ? expires : CODE_WAIT_S;
      this.host.notice(t('mudstats.link.waiting', { player }));
      const code = await this.codeWithin(waitS * 1000);
      if (code === null) return t('mudstats.link.noCode');
      const claimed = await this.claim(api, ticket, code);
      if (claimed.status !== 200) return t('mudstats.link.refused', { detail: detailOf(claimed) });
      const key = claimed.body['key'];
      if (typeof key !== 'string' || key.length === 0) {
        return t('mudstats.link.refused', { detail: detailOf(claimed) });
      }
      const refused = keep(key);
      if (refused !== null) return refused;
      const who = typeof claimed.body['player'] === 'string' ? claimed.body['player'] : player;
      return t('mudstats.link.linked', { player: who });
    } finally {
      this.waiting = null;
      this.linking = false;
    }
  }

  /** The key retired at the board and forgotten here: it is one of only three. */
  async unlink(keep: KeepKey): Promise<string> {
    const key = this.target.key;
    if (key === '') return t('mudstats.unlink.none');
    let said = t('mudstats.unlink.done');
    if (this.api !== null) {
      const answer = await this.api.revoke(key);
      // Already revoked or never known: forgotten here all the same.
      if (answer.status !== 200 && answer.status !== 401) {
        said = t('mudstats.unlink.forgottenOnly', { detail: detailOf(answer) });
      }
    }
    const refused = keep('');
    return refused ?? said;
  }

  /** What the board says of this key (`whoami`), or why it cannot say. */
  async status(): Promise<string> {
    if (this.api === null) return t('mudstats.status.noBoard');
    if (this.target.key === '') return t('mudstats.status.notLinked');
    const answer = await this.api.whoami(this.target.key);
    if (answer.status !== 200) return t('mudstats.status.refused', { detail: detailOf(answer) });
    const player = String(answer.body['player'] ?? '?');
    const posts = Number(answer.body['posts'] ?? 0);
    const state =
      this.stopped ?? (this.posting ? t('mudstats.status.posting') : t('mudstats.status.off'));
    return t('mudstats.status.linked', { player, posts, state });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.waiting = null;
  }

  private codeWithin(ms: number): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.waiting = null;
        resolve(null);
      }, ms);
      this.waiting = {
        until: Date.now() + ms,
        resolve: (code) => {
          clearTimeout(timeout);
          resolve(code);
        }
      };
    });
  }

  /** Redeemed, tried again while the board says the code has not reached us yet. */
  private async claim(api: MudStatsApi, ticket: string, code: string): Promise<IngestAnswer> {
    let answer = await api.claim(ticket, code, this.label);
    for (let i = 1; i < CLAIM_TRIES && answer.status === 400; i += 1) {
      if (!detailOf(answer).includes('not reached the character')) break;
      await this.sleep(CLAIM_RETRY_MS);
      answer = await api.claim(ticket, code, this.label);
    }
    return answer;
  }

  private schedule(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed || !this.posting || this.stopped !== null) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private intervalMs(): number {
    const floor = this.board?.floorS ?? BOARD_FLOOR_S;
    return Math.max(this.report.everySeconds, floor) * 1000;
  }

  private async tick(): Promise<void> {
    this.timer = null;
    const api = this.api;
    if (api === null || !this.posting) return;
    if (this.board === null) {
      const fields = await api.fields();
      if (fields.status === 200) {
        const named = fields.body['fields'];
        const floor = Number(fields.body['min_interval']);
        this.board = {
          fields: typeof named === 'object' && named !== null ? new Set(Object.keys(named)) : null,
          floorS: Number.isFinite(floor) && floor > 0 ? floor : BOARD_FLOOR_S
        };
      } else if (fields.status === 404) {
        return this.stop(t('mudstats.post.switchedOff', { detail: detailOf(fields) }));
      } else if (fields.status === 0 || fields.status >= 500) {
        return this.unreachable(fields);
      }
    }
    const snapshot = this.host.snapshot();
    if (snapshot === null) return this.schedule(this.intervalMs());
    const allowed = this.board?.fields ?? null;
    const metrics =
      allowed === null
        ? snapshot
        : Object.fromEntries(Object.entries(snapshot).filter(([name]) => allowed.has(name)));
    if (Object.keys(metrics).length === 0) return this.schedule(this.intervalMs());

    const answer = await api.post(this.target.key, metrics);
    if (this.disposed) return;
    switch (true) {
      case answer.status === 200:
        if (this.failures > 0) this.host.notice(t('mudstats.post.back'));
        this.failures = 0;
        return this.schedule(this.intervalMs());
      case answer.status === 429:
        // Not resent: the next post is a fresh snapshot.
        return this.schedule(Math.max((answer.retryAfter ?? BOARD_FLOOR_S) * 1000, 1000));
      case answer.status === 401:
        return this.stop(t('mudstats.post.keyRefused', { detail: detailOf(answer) }));
      case answer.status === 404:
        return this.stop(t('mudstats.post.switchedOff', { detail: detailOf(answer) }));
      case answer.status === 422:
        return this.stop(t('mudstats.post.rejected', { detail: detailOf(answer) }));
      default:
        return this.unreachable(answer);
    }
  }

  private stop(said: string): void {
    this.stopped = said;
    this.host.notice(said);
  }

  private unreachable(answer: IngestAnswer): void {
    if (this.failures === 0) {
      this.host.notice(t('mudstats.post.unreachable', { detail: detailOf(answer) }));
    }
    this.failures += 1;
    const wait = Math.min(this.intervalMs() * 2 ** this.failures, BACKOFF_CEILING_MS);
    this.schedule(wait);
  }
}
