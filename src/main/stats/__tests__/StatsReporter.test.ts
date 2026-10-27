import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatsReporter } from '../StatsReporter';
import type { Reading } from '../MudStatsApi';

/* The board's ingest specification (2026-10-16), answered by a fake board. */

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  key: string | null;
}

/** A board that answers each route from `routes`, a list per route taken in turn. */
function board(
  routes: Record<string, Array<{ status: number; body?: object; retryAfter?: number }>>
) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      method: init?.method ?? 'GET',
      path,
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      key: headers['X-Mudstats-Key'] ?? null
    });
    const queue = routes[path] ?? [];
    const answer = queue.length > 1 ? queue.shift()! : (queue[0] ?? { status: 404 });
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status,
      headers: answer.retryAfter === undefined ? {} : { 'retry-after': String(answer.retryAfter) }
    });
  }) as typeof fetch;
  return { calls, fetcher };
}

const FIELDS = {
  status: 200,
  body: { fields: { hp: 'int', hp_max: 'int', level: 'int' }, min_interval: 15 }
};

function reporter(
  fetcher: typeof fetch,
  snapshot: Record<string, Reading> | null = { hp: 311, hp_max: 375, level: 33, exits: 'n' }
) {
  const notices: string[] = [];
  const state = { snapshot, name: 'Fatty' as string | null };
  const r = new StatsReporter(
    {
      snapshot: () => state.snapshot,
      playerName: () => state.name,
      notice: (text) => notices.push(text)
    },
    'Majordomo test',
    fetcher,
    () => Promise.resolve()
  );
  return { r, notices, state };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the link (the handshake)', () => {
  it('asks for a code, reads it off the telepath, and keeps the key', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/request': [{ status: 200, body: { ticket: 'api:abc', expires_in: 600 } }],
      '/api/ingest/claim': [
        { status: 400, body: { detail: 'the code has not reached the character yet' } },
        { status: 200, body: { player: 'Fatty', key: 'mudk_86fb_secret' } }
      ]
    });
    const { r, notices } = reporter(fetcher);
    r.configure({ url: 'http://board:8099/', key: '' }, { enabled: false, everySeconds: 60 });
    const kept: string[] = [];
    const linking = r.link((key) => (kept.push(key), null));
    await flush();
    expect(calls[0]).toMatchObject({ path: '/api/ingest/request', body: { player: 'Fatty' } });
    expect(notices.at(-1)).toContain('Fatty');

    // Talk that is not the code, then the code.
    r.heard('{HP=1455/1505,MA=232/290}');
    r.heard('Your mudstats code is 481923, good for ten minutes');
    expect(await linking).toContain('Fatty');
    expect(kept).toEqual(['mudk_86fb_secret']);
    const claims = calls.filter((c) => c.path === '/api/ingest/claim');
    expect(claims).toHaveLength(2);
    expect(claims[0]!.body).toEqual({ ticket: 'api:abc', code: '481923', label: 'Majordomo test' });
  });

  it('says what the board said, and never asks twice on its own', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/request': [{ status: 400, body: { detail: 'a code was just sent…' } }]
    });
    const { r } = reporter(fetcher);
    r.configure({ url: 'http://board:8099', key: '' }, { enabled: false, everySeconds: 60 });
    expect(await r.link(() => null)).toContain('a code was just sent');
    expect(calls).toHaveLength(1);
  });

  it('is refused out of the game, where no telepath can reach the character', async () => {
    const { calls, fetcher } = board({});
    const { r, state } = reporter(fetcher);
    state.name = null;
    r.configure({ url: 'http://board:8099', key: '' }, { enabled: false, everySeconds: 60 });
    await r.link(() => null);
    expect(calls).toHaveLength(0);
  });

  it('gives up when no code comes before it expires', async () => {
    const { fetcher } = board({
      '/api/ingest/request': [{ status: 200, body: { ticket: 'api:abc', expires_in: 30 } }]
    });
    const { r } = reporter(fetcher);
    r.configure({ url: 'http://board:8099', key: '' }, { enabled: false, everySeconds: 60 });
    const kept: string[] = [];
    const linking = r.link((key) => (kept.push(key), null));
    await flush();
    vi.advanceTimersByTime(30_000);
    expect(await linking).toContain('expired');
    r.heard('481923');
    expect(kept).toEqual([]);
  });
});

describe('the posts', () => {
  it('posts a whole snapshot of the readings the board takes, every interval', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/fields': [FIELDS],
      '/api/ingest': [{ status: 200, body: { stored: ['hp', 'hp_max', 'level'] } }]
    });
    const { r } = reporter(fetcher);
    r.configure({ url: 'http://board:8099', key: 'mudk_k' }, { enabled: true, everySeconds: 60 });
    vi.advanceTimersByTime(0);
    await flush();
    const posts = (): Call[] => calls.filter((c) => c.path === '/api/ingest');
    // `exits` is not among the board's fields, so it is left out rather than 422'd.
    expect(posts()[0]).toMatchObject({
      key: 'mudk_k',
      body: { metrics: { hp: 311, hp_max: 375, level: 33 } }
    });
    vi.advanceTimersByTime(59_000);
    await flush();
    expect(posts()).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    await flush();
    expect(posts()).toHaveLength(2);
  });

  it('never posts sooner than the board allows', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/fields': [{ status: 200, body: { fields: { hp: 'int' }, min_interval: 30 } }],
      '/api/ingest': [{ status: 200 }]
    });
    const { r } = reporter(fetcher);
    r.configure({ url: 'http://board:8099', key: 'mudk_k' }, { enabled: true, everySeconds: 15 });
    vi.advanceTimersByTime(0);
    await flush();
    vi.advanceTimersByTime(15_000);
    await flush();
    expect(calls.filter((c) => c.path === '/api/ingest')).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    await flush();
    expect(calls.filter((c) => c.path === '/api/ingest')).toHaveLength(2);
  });

  it('posts nothing out of the game, and nothing without a key or the switch', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/fields': [FIELDS],
      '/api/ingest': [{ status: 200 }]
    });
    const { r } = reporter(fetcher, null);
    r.configure({ url: 'http://board:8099', key: 'mudk_k' }, { enabled: true, everySeconds: 60 });
    vi.advanceTimersByTime(0);
    await flush();
    expect(calls.filter((c) => c.path === '/api/ingest')).toHaveLength(0);
    r.configure({ url: 'http://board:8099', key: '' }, { enabled: true, everySeconds: 60 });
    expect(r.posting).toBe(false);
  });

  it('waits out a 429, then posts afresh', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/fields': [FIELDS],
      '/api/ingest': [{ status: 429, retryAfter: 7 }, { status: 200 }]
    });
    const { r } = reporter(fetcher);
    r.configure({ url: 'http://board:8099', key: 'mudk_k' }, { enabled: true, everySeconds: 60 });
    vi.advanceTimersByTime(0);
    await flush();
    vi.advanceTimersByTime(7_000);
    await flush();
    expect(calls.filter((c) => c.path === '/api/ingest')).toHaveLength(2);
  });

  it('stops on a refused key, said once, until the settings change', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/fields': [FIELDS],
      '/api/ingest': [{ status: 401, body: { detail: 'key revoked' } }]
    });
    const { r, notices } = reporter(fetcher);
    r.configure({ url: 'http://board:8099', key: 'mudk_k' }, { enabled: true, everySeconds: 60 });
    vi.advanceTimersByTime(0);
    await flush();
    vi.advanceTimersByTime(600_000);
    await flush();
    expect(calls.filter((c) => c.path === '/api/ingest')).toHaveLength(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('key revoked');
  });

  it('backs off from a board that does not answer, and says when it is back', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/fields': [FIELDS],
      '/api/ingest': [{ status: 503 }, { status: 503 }, { status: 200 }]
    });
    const { r, notices } = reporter(fetcher);
    r.configure({ url: 'http://board:8099', key: 'mudk_k' }, { enabled: true, everySeconds: 60 });
    vi.advanceTimersByTime(0);
    await flush();
    // Twice the interval, then four times.
    vi.advanceTimersByTime(120_000);
    await flush();
    vi.advanceTimersByTime(239_000);
    await flush();
    expect(calls.filter((c) => c.path === '/api/ingest')).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    await flush();
    expect(calls.filter((c) => c.path === '/api/ingest')).toHaveLength(3);
    expect(notices).toHaveLength(2);
  });
});

describe('the unlink', () => {
  it('retires the key at the board and forgets it here', async () => {
    const { calls, fetcher } = board({
      '/api/ingest/revoke': [{ status: 200, body: { revoked: true } }]
    });
    const { r } = reporter(fetcher);
    r.configure({ url: 'http://board:8099', key: 'mudk_k' }, { enabled: false, everySeconds: 60 });
    const kept: string[] = [];
    await r.unlink((key) => (kept.push(key), null));
    expect(calls[0]).toMatchObject({ path: '/api/ingest/revoke', key: 'mudk_k' });
    expect(kept).toEqual(['']);
  });
});
