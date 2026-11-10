import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_INTERNAL } from '../../../shared/internal';
import { setTuning } from '../../app/tuning';
import { AccessTokens, COOKIE, SignInGuard } from '../web/access';
import { Downloads } from '../web/downloads';
import { receiveRealm } from '../web/uploads';
import { createWebServer, loginPage, withConnectSrc, type WebServer } from '../web/server';
import type { WebSocketConnection } from '../web/sockets';

/**
 * The gate, measured rather than assumed — the lesson the noVNC image's
 * write-up recorded about "Basic auth in front of it" not meaning what it
 * sounds like. Every row here is a request and the status it gets, against
 * a real listener on loopback.
 */
const PASSWORD = 'open-sesame';
const INDEX = [
  '<!doctype html><html><head>',
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; style-src 'self' 'unsafe-inline'\" />",
  '</head><body><div id="root"></div><script type="module" src="./assets/index-abc.js"></script></body></html>'
].join('');

let dir = '';
let server: WebServer;
let port = 0;
const tokens = new AccessTokens();
const downloads = new Downloads();
const sockets: WebSocketConnection[] = [];
const log: string[] = [];

beforeAll(async () => {
  // A wrong password waits `loginDelayMs`; a test is not the place to wait a second.
  // The guesses these tests make between them all come from loopback, so the
  // shutting out is left to its own server below (`a source that keeps guessing`).
  setTuning({
    ...DEFAULT_INTERNAL.tuning,
    web: { ...DEFAULT_INTERNAL.tuning.web, loginDelayMs: 1, loginGuesses: 1000 }
  });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-web-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), INDEX);
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc.js'), 'console.log("app")');
  server = createWebServer({
    rendererDir: dir,
    password: PASSWORD,
    tokens,
    trustProxy: false,
    onSocket: (connection) => {
      sockets.push(connection);
      connection.onMessage = (text) => connection.send(`echo:${text}`);
    },
    log: (line) => log.push(line),
    download: (token) => downloads.take(token),
    // A realm here is a file that says ROOMS; anything past 1 KB is too large.
    uploadRealm: (body, name) =>
      receiveRealm(body, {
        dir: path.join(dir, 'databases'),
        name,
        maxBytes: 1024,
        check: (file) => (fs.readFileSync(file, 'utf8').includes('ROOMS') ? null : 'not a realm'),
        say: { badName: 'bad name', tooLarge: (max) => `over ${max}`, failed: (m) => m }
      })
  });
  ({ port } = await server.listen(0, '127.0.0.1'));
});

afterAll(() => {
  setTuning(DEFAULT_INTERNAL.tuning);
  for (const socket of sockets) socket.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const base = (): string => `http://127.0.0.1:${port}`;

const get = (route: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base()}${route}`, { headers, redirect: 'manual' });

const login = (password: string): Promise<Response> =>
  fetch(`${base()}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }).toString(),
    redirect: 'manual'
  });

/** A signed-in cookie, by signing in. */
async function signIn(): Promise<string> {
  const response = await login(PASSWORD);
  expect(response.status).toBe(303);
  const cookie = response.headers.get('set-cookie') ?? '';
  const token = /mudengine_session=([0-9a-f]{64})/.exec(cookie)?.[1];
  expect(token).toBeDefined();
  return `${COOKIE}=${token}`;
}

/** The status line an upgrade attempt is answered with, by hand over TCP. */
async function upgrade(headers: string[]): Promise<{ status: string; socket: net.Socket }> {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.write(
    [
      'GET /ws HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      ...headers,
      '',
      ''
    ].join('\r\n')
  );
  const first = await new Promise<string>((resolve) =>
    socket.once('data', (chunk) => resolve(chunk.toString('latin1').split('\r\n')[0] ?? ''))
  );
  return { status: first, socket };
}

describe('without a session', () => {
  it('answers the page with the sign-in form, and a 401', async () => {
    const response = await get('/');
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<form method="post" action="/login">');
    expect(body).toContain('name="password"');
    expect(body).not.toContain('<script');
    expect(body).toContain('not encrypted');
  });

  it('serves the renderer to nobody', async () => {
    expect((await get('/assets/index-abc.js')).status).toBe(401);
    expect((await get('/index.html')).status).toBe(401);
  });

  it('answers /health to anybody, with nothing in it', async () => {
    const response = await get('/health');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('refuses the socket on the upgrade, before any channel', async () => {
    const { status, socket } = await upgrade([]);
    expect(status).toBe('HTTP/1.1 401 Unauthorized');
    socket.destroy();
    expect(log.some((line) => /refused a socket .* not signed in/.test(line))).toBe(true);
  });
});

describe('signing in', () => {
  it('refuses a wrong password with the form again and says so', async () => {
    const before = log.length;
    const response = await login('not-it');
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('That is not the password');
    expect(log.slice(before).some((line) => /refused a sign-in/.test(line))).toBe(true);
  });

  it('refuses an empty password', async () => {
    expect((await login('')).status).toBe(401);
  });

  it('sets a session cookie the browser will keep to itself', async () => {
    const response = await login(PASSWORD);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^mudengine_session=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\//);
    // Plain http: a `Secure` cookie would never be sent back and the sign-in
    // would loop for ever.
    expect(cookie).not.toContain('Secure');
  });

  it('accepts Basic credentials on any request, for a script', async () => {
    const authorization = `Basic ${Buffer.from(`anyone:${PASSWORD}`).toString('base64')}`;
    expect((await get('/', { Authorization: authorization })).status).toBe(200);
  });

  /*
   * The Basic door is a door: a guess through it is throttled and said out
   * loud exactly as one through the form is, or the form would be the only
   * route that was rate-limited and the other the one a guesser would use.
   */
  it('refuses a wrong Basic password slowly and says so, on the page and on the socket', async () => {
    const wrong = `Basic ${Buffer.from('anyone:wrong').toString('base64')}`;
    const before = log.length;
    expect((await get('/', { Authorization: wrong })).status).toBe(401);
    expect(log.slice(before).some((line) => /refused a sign-in \(Basic\)/.test(line))).toBe(true);

    const marker = log.length;
    const { status, socket } = await upgrade([`Authorization: ${wrong}`]);
    expect(status).toBe('HTTP/1.1 401 Unauthorized');
    socket.destroy();
    expect(log.slice(marker).some((line) => /refused a sign-in \(Basic\)/.test(line))).toBe(true);
  });

  /*
   * A header is something anybody can send. Without `trustProxy` the client
   * assumes cleartext whatever `X-Forwarded-Proto` says: the warning stays
   * on the page and the cookie is not marked `Secure`, which would otherwise
   * never be sent back over the plain hop the browser is actually on.
   */
  it('believes X-Forwarded-Proto only when told a proxy is in front', async () => {
    const forwarded = await fetch(`${base()}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Forwarded-Proto': 'https'
      },
      body: new URLSearchParams({ password: PASSWORD }).toString(),
      redirect: 'manual'
    });
    expect(forwarded.headers.get('set-cookie') ?? '').not.toContain('Secure');
    const page = await get('/', { 'X-Forwarded-Proto': 'https' });
    expect(await page.text()).toContain('not encrypted');

    const trusting = createWebServer({
      rendererDir: dir,
      password: PASSWORD,
      tokens: new AccessTokens(),
      trustProxy: true,
      onSocket: () => {},
      log: () => {}
    });
    const bound = await trusting.listen(0, '127.0.0.1');
    try {
      const signedIn = await fetch(`http://127.0.0.1:${bound.port}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Forwarded-Proto': 'https'
        },
        body: new URLSearchParams({ password: PASSWORD }).toString(),
        redirect: 'manual'
      });
      expect(signedIn.headers.get('set-cookie') ?? '').toContain('Secure');
      const quiet = await fetch(`http://127.0.0.1:${bound.port}/`, {
        headers: { 'X-Forwarded-Proto': 'https' }
      });
      expect(await quiet.text()).not.toContain('not encrypted');
    } finally {
      trusting.close();
    }
  });
});

describe('with a session', () => {
  it('serves the renderer, with connect-src stated for this host', async () => {
    const cookie = await signIn();
    const response = await get('/', { Cookie: cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain(`connect-src 'self' ws://127.0.0.1:${port} wss://127.0.0.1:${port};`);
    expect(html).toContain('id="root"');
  });

  it('serves a hashed asset as immutable, and nothing outside the renderer', async () => {
    const cookie = await signIn();
    const asset = await get('/assets/index-abc.js', { Cookie: cookie });
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect((await get('/assets/missing.js', { Cookie: cookie })).status).toBe(404);
    expect((await get('/%2e%2e/%2e%2e/etc/passwd', { Cookie: cookie })).status).toBe(404);
    expect((await get('/assets/../../../../etc/passwd', { Cookie: cookie })).status).toBe(404);
    expect((await get('/index.html.bak', { Cookie: cookie })).status).toBe(404);
  });

  it('hands an offered file over once, as a download, behind the password', async () => {
    const report = path.join(dir, 'debug-Vaelor.txt');
    fs.writeFileSync(report, 'the trace');
    const link = downloads.offer(7, report);
    expect(link).toMatch(/^\/download\/[0-9a-f]{32}\/debug-Vaelor\.txt$/);
    expect((await get(link)).status).toBe(401);
    const cookie = await signIn();
    // A HEAD does not spend it; the GET does.
    expect(
      (await fetch(`${base()}${link}`, { method: 'HEAD', headers: { Cookie: cookie } })).status
    ).toBe(404);
    const first = await get(link, { Cookie: cookie });
    expect(first.status).toBe(200);
    expect(first.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''debug-Vaelor.txt"
    );
    expect(await first.text()).toBe('the trace');
    expect((await get(link, { Cookie: cookie })).status).toBe(404);
    expect((await get('/download/abc123/index.html', { Cookie: cookie })).status).toBe(404);
  });

  /* A realm database sent up from a tab (2026-11-10). */
  it('keeps a realm database a signed-in tab sends up, beside one of its name', async () => {
    const send = (name: string, body: string, headers: Record<string, string>): Promise<Response> =>
      fetch(`${base()}/upload/realm?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...headers },
        body
      });
    const ours = { 'X-Majordomo-Upload': '1' };
    expect((await send('mudrev.mdb', 'ROOMS', ours)).status).toBe(401);
    const cookie = await signIn();
    const signed = { ...ours, Cookie: cookie };
    // The header a form elsewhere cannot set, and this host's origin.
    expect((await send('mudrev.mdb', 'ROOMS', { Cookie: cookie })).status).toBe(403);
    expect(
      (await send('mudrev.mdb', 'ROOMS', { ...signed, Origin: 'http://evil.example' })).status
    ).toBe(403);
    const first = await send('mudrev.mdb', 'ROOMS', signed);
    expect(first.status).toBe(200);
    const kept = ((await first.json()) as { path: string }).path;
    expect(kept).toBe(path.join(dir, 'databases', 'mudrev.mdb'));
    expect(fs.readFileSync(kept, 'utf8')).toBe('ROOMS');
    const again = (await (await send('mudrev.mdb', 'ROOMS too', signed)).json()) as {
      path: string;
    };
    expect(path.basename(again.path)).toBe('mudrev-2.mdb');
    // Refused: not a realm, not a realm's name, past the size; nothing left behind.
    const notRealm = await send('other.mdb', 'nothing', signed);
    expect([notRealm.status, ((await notRealm.json()) as { error: string }).error]).toEqual([
      422,
      'not a realm'
    ]);
    expect((await send('../../evil.sh', 'ROOMS', signed)).status).toBe(400);
    expect((await send('big.mdb', `ROOMS${'x'.repeat(4096)}`, signed)).status).toBe(413);
    expect(fs.readdirSync(path.join(dir, 'databases')).sort()).toEqual([
      'mudrev-2.mdb',
      'mudrev.mdb'
    ]);
  });

  it('refuses a socket opened from another origin', async () => {
    const cookie = await signIn();
    const { status, socket } = await upgrade([`Cookie: ${cookie}`, 'Origin: http://evil.example']);
    expect(status).toBe('HTTP/1.1 403 Forbidden');
    socket.destroy();
  });

  it('upgrades a socket from this origin and carries a message', async () => {
    const cookie = await signIn();
    const { status, socket } = await upgrade([
      `Cookie: ${cookie}`,
      `Origin: http://127.0.0.1:${port}`
    ]);
    expect(status).toBe('HTTP/1.1 101 Switching Protocols');
    // A masked text frame, as a client sends one, and the echo back.
    const mask = Buffer.from([1, 2, 3, 4]);
    const payload = Buffer.from('ping');
    for (let i = 0; i < payload.length; i += 1) payload[i] = payload[i]! ^ mask[i & 3]!;
    const echoed = new Promise<string>((resolve) =>
      socket.once('data', (chunk) => resolve(chunk.subarray(2).toString('utf8')))
    );
    socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | 4]), mask, payload]));
    expect(await echoed).toBe('echo:ping');
    socket.destroy();
  });

  it('refuses a socket on any other path', async () => {
    const cookie = await signIn();
    const socket = net.connect(port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(
      [
        'GET /elsewhere HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        `Cookie: ${cookie}`,
        '',
        ''
      ].join('\r\n')
    );
    const first = await new Promise<string>((resolve) =>
      socket.once('data', (chunk) => resolve(chunk.toString('latin1').split('\r\n')[0] ?? ''))
    );
    expect(first).toBe('HTTP/1.1 404 Not Found');
    socket.destroy();
  });
});

describe('the page and the policy', () => {
  it('states connect-src only for a host worth writing into a policy', () => {
    const html = "<meta content=\"default-src 'self'; img-src 'self'\">";
    expect(withConnectSrc(html, 'example.test:8080')).toContain(
      "connect-src 'self' ws://example.test:8080 wss://example.test:8080;"
    );
    expect(withConnectSrc(html, '[::1]:8080')).toContain('ws://[::1]:8080');
    expect(withConnectSrc(html, 'evil host; script-src *')).toBe(html);
  });

  it('draws the sign-in page without a script and says when the link is cleartext', () => {
    const page = loginPage({ wrong: true, cleartext: true });
    expect(page).not.toContain('<script');
    expect(page).toContain('not encrypted');
    expect(page).toContain('That is not the password');
    expect(loginPage({ wrong: false, cleartext: false })).not.toContain('not encrypted');
  });

  it('says how long a shut-out address waits, in minutes', () => {
    expect(loginPage({ wrong: false, cleartext: false, waitSeconds: 900 })).toContain(
      'Try again in 15 minutes.'
    );
    expect(loginPage({ wrong: false, cleartext: false, waitSeconds: 20 })).toContain(
      'Try again in a minute.'
    );
  });
});

/*
 * Code review B3 (2026-11-02): the delay slowed each request, so a hundred
 * connections each waited their own second. Here an address that keeps
 * guessing is shut out, measured against a server of its own whose clock the
 * test moves.
 */
describe('a source that keeps guessing', () => {
  const clock = { now: 5_000_000 };
  const guarded = { server: null as WebServer | null, port: 0, log: [] as string[] };
  const at = (route: string): string => `http://127.0.0.1:${guarded.port}${route}`;
  const guess = (password: string): Promise<Response> =>
    fetch(at('/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password }).toString(),
      redirect: 'manual'
    });
  const basic = (password: string): string =>
    `Basic ${Buffer.from(`anyone:${password}`).toString('base64')}`;

  beforeAll(async () => {
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      web: {
        ...DEFAULT_INTERNAL.tuning.web,
        loginDelayMs: 1,
        loginGuesses: 3,
        loginWindowMs: 600_000
      }
    });
    guarded.server = createWebServer({
      rendererDir: dir,
      password: PASSWORD,
      tokens,
      trustProxy: false,
      guard: new SignInGuard(() => clock.now),
      onSocket: (connection) => sockets.push(connection),
      log: (line) => guarded.log.push(line)
    });
    ({ port: guarded.port } = await guarded.server.listen(0, '127.0.0.1'));
  });
  afterAll(() => {
    guarded.server?.close();
    setTuning({
      ...DEFAULT_INTERNAL.tuning,
      web: { ...DEFAULT_INTERNAL.tuning.web, loginDelayMs: 1, loginGuesses: 1000 }
    });
  });

  it('is refused for the window once its guesses are used up, the right password included', async () => {
    const held = await guess(PASSWORD);
    expect(held.status).toBe(303);
    const cookie = /mudengine_session=[0-9a-f]{64}/.exec(held.headers.get('set-cookie') ?? '')![0];

    expect((await guess('one')).status).toBe(401);
    expect((await guess('two')).status).toBe(401);
    expect((await guess('three')).status).toBe(401);
    const shutOut = guarded.log.filter((line) => /wrong passwords from 127\.0\.0\.1/.test(line));
    expect(shutOut).toHaveLength(1);

    // Now nothing it sends as a password is read: the right one is answered as the wrong ones are.
    const refused = await guess(PASSWORD);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('600');
    expect(await refused.text()).toContain('Try again in 10 minutes.');
    expect((await fetch(at('/'), { headers: { Authorization: basic(PASSWORD) } })).status).toBe(
      429
    );
    expect((await fetch(at('/'), { headers: { Authorization: basic('four') } })).status).toBe(429);

    // Said once, not per refusal.
    expect(guarded.log.filter((line) => /wrong passwords from/.test(line))).toHaveLength(1);
    expect(guarded.log.filter((line) => /refused a sign-in/.test(line))).toHaveLength(3);

    // A tab already signed in carries a cookie, and is never asked.
    expect((await fetch(at('/'), { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it('refuses a password on the socket too, and says when to come back', async () => {
    const socket = net.connect(guarded.port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(
      [
        'GET /ws HTTP/1.1',
        `Host: 127.0.0.1:${guarded.port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        `Authorization: ${basic(PASSWORD)}`,
        '',
        ''
      ].join('\r\n')
    );
    const answer = await new Promise<string>((resolve) =>
      socket.once('data', (chunk) => resolve(chunk.toString('latin1')))
    );
    socket.destroy();
    expect(answer.split('\r\n')[0]).toBe('HTTP/1.1 429 Too Many Requests');
    expect(answer).toMatch(/Retry-After: \d+/);
  });

  it('reads its password again once the window has passed', async () => {
    clock.now += 600_000;
    expect((await guess(PASSWORD)).status).toBe(303);
  });
});
