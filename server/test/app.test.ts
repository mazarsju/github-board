import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { REPOS } from '../../shared/config.ts';
import { defaultState } from '../../shared/state.ts';
import { createApp, type AppOptions } from '../src/app.ts';
import type { BackgroundSession, ClaudeCli } from '../src/claude.ts';
import { GitHubClient, GitHubError } from '../src/github.ts';
import { MemoryStore } from '../src/store.ts';

/** Fake GitHub client: only the "good" token is valid. */
class FakeClient extends GitHubClient {
  tokenValue: string;
  constructor(token: string) { super(token); this.tokenValue = token; }
  override async getUser() {
    if (this.tokenValue !== 'good') throw new GitHubError('Bad credentials', 401);
    return { login: 'alice', avatar_url: 'https://avatar' };
  }
  override async checkRepoAccess(repos: readonly string[]) {
    return repos.map((repo) => ({ repo, ok: repo !== 'DiliTrust/webapp-clm', status: 404 }));
  }
  override async myActions(login: string, repos: readonly string[]) {
    return [{ login, repos }] as never;
  }
  override async fileLines(_owner: string, _repo: string, path: string) {
    if (path !== 'a.ts') throw new GitHubError('Not Found', 404);
    return ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
  }
  override async listOpenPRs(repos: readonly string[], limit: number) {
    if (limit === 13) throw new GitHubError('Server Error', 500);
    return { total: repos.length, items: [] };
  }
}

let server: Server | null = null;
afterEach(() => { server?.close(); server = null; });

async function start(opts: Partial<AppOptions> = {}) {
  const store = new MemoryStore();
  const app = createApp({ store, createClient: (t) => new FakeClient(t), ...opts });
  server = app.listen(0);
  await new Promise((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = '';
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as Record<string, string>) },
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set };
  };
  return { call, store };
}

describe('API', () => {
  test('requires a session', async () => {
    const { call } = await start();
    expect((await call('/session')).status).toBe(401);
    expect((await call('/state')).status).toBe(401);
  });

  test('rejects an invalid token', async () => {
    const { call } = await start();
    const res = await call('/session', { method: 'POST', body: JSON.stringify({ token: 'nope' }) });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Bad credentials');
  });

  test('login, state, save and logout', async () => {
    const { call, store } = await start();
    const login = await call('/session', { method: 'POST', body: JSON.stringify({ token: 'good' }) });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ user: { login: 'alice', avatarUrl: 'https://avatar' }, envToken: false });
    expect(login.setCookie).toMatch(/HttpOnly/);
    expect(login.setCookie).toMatch(/SameSite=Strict/);

    expect((await call('/state')).body).toEqual(defaultState());

    const next = { settings: { refresh: 60, theme: 'dark', collapsed: ['DiliTrust/webapp-clm'], dismissedReviews: [] } };
    expect((await call('/state', { method: 'PUT', body: JSON.stringify(next) })).status).toBe(204);
    expect(await store.get('alice')).toEqual(next);
    expect((await call('/state', { method: 'PUT', body: JSON.stringify({ settings: { refresh: -1, theme: 'dark', collapsed: [], dismissedReviews: [] } }) })).status).toBe(400);

    expect((await call('/session', { method: 'DELETE' })).status).toBe(204);
    expect((await call('/state')).status).toBe(401);
  });

  test('access check of the tracked repositories', async () => {
    const { call } = await start({ envToken: 'good' });
    const res = await call('/repos/access');
    expect(res.body.map((r: { repo: string }) => r.repo)).toEqual(REPOS);
    expect(res.body.filter((r: { ok: boolean }) => !r.ok).map((r: { repo: string }) => r.repo)).toEqual(['DiliTrust/webapp-clm']);
  });

  test('pulls: tracked repositories, validation and forwarded GitHub errors', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/pulls')).body).toEqual({ total: REPOS.length, items: [] });
    expect((await call('/pulls?limit=0')).status).toBe(400);
    expect((await call('/pulls?limit=5000')).status).toBe(400);
    expect(await call('/pulls?limit=13')).toMatchObject({ status: 502, body: { error: 'Server Error' } });
  });

  test('with GITHUB_TOKEN: automatic session, manual login refused', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/session')).body).toEqual({ user: { login: 'alice', avatarUrl: 'https://avatar' }, envToken: true });
    expect((await call('/session', { method: 'POST', body: JSON.stringify({ token: 'good' }) })).status).toBe(409);
  });

  test('actions: the session user\'s PRs in the tracked repositories', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/actions')).body).toEqual([{ login: 'alice', repos: REPOS }]);
  });

  test('review: starts a named background Claude session, only when asked by the app', async () => {
    const started: [string, string][] = [];
    const claude: ClaudeCli = {
      async startBackground(prompt, name) {
        if (name.includes('#13')) throw new Error('Not logged in');
        started.push([prompt, name]);
        return 'abc123';
      },
      listBackground: async () => [],
      readResult: async () => null,
      readFindings: async () => null,
    };
    const { call } = await start({ envToken: 'good', claude });
    const post = (path: string, headers: Record<string, string> = { 'X-Github-Board': '1' }) => call(path, { method: 'POST', headers });

    expect(await post('/pulls/DiliTrust/service-clm/7/review')).toMatchObject({ status: 200, body: { name: 'review service-clm#7', output: 'abc123' } });
    expect(started).toEqual([['/pr-review https://github.com/DiliTrust/service-clm/pull/7', 'review service-clm#7']]);
    // Without the app's header (e.g. a request from another website): refused, nothing started.
    expect((await post('/pulls/DiliTrust/service-clm/7/review', {})).status).toBe(403);
    expect((await post('/pulls/o/r;rm/7/review')).status).toBe(400);
    expect((await post('/pulls/o/r/7/review')).status).toBe(404); // not a tracked repository
    expect(await post('/pulls/DiliTrust/service-clm/13/review')).toMatchObject({ status: 500, body: { error: 'Lancement de Claude impossible : Not logged in' } });
    expect(started).toHaveLength(1);
  });

  test('reviews: sessions of the tracked repositories, and the result of a finished one', async () => {
    const sessions: BackgroundSession[] = [
      { id: 'a1', sessionId: 'uuid-1', name: 'review service-clm#7', state: 'working', startedAt: 2 },
      { id: 'a0', sessionId: 'uuid-0', name: 'review service-clm#7', state: 'done', startedAt: 1 },
      { id: 'b1', sessionId: 'uuid-2', name: 'review webapp-clm#3', state: 'done', startedAt: 1 },
      { id: 'c1', sessionId: 'uuid-3', name: 'something else', state: 'done', startedAt: 1 },
      { id: 'd1', sessionId: '../../etc/passwd', name: 'review webapp-clm#4', state: 'done', startedAt: 1 },
    ];
    const read: string[] = [];
    const found: string[] = [];
    const finding = { id: 1, severity: 'major' as const, file: 'a.ts', line: 4, startLine: null, title: 'Bug', body: 'Details', suggestion: null };
    const claude: ClaudeCli = {
      startBackground: async () => '',
      listBackground: async () => sessions,
      readResult: async (sessionId) => { read.push(sessionId); return sessionId === 'uuid-2' ? 'LGTM' : null; },
      readFindings: async (owner, repo, number, since) => {
        found.push(`${owner}/${repo}#${number}@${since}`);
        return number === 3 ? { findings: [finding, { ...finding, id: 2, file: 'gone.ts' }], head: 'abc1234' } : null;
      },
    };
    const { call } = await start({ envToken: 'good', claude });
    const get = (path: string, headers: Record<string, string> = { 'X-Github-Board': '1' }) => call(path, { headers });

    expect((await get('/reviews')).body).toEqual([
      { key: 'DiliTrust/service-clm#7', id: 'a1', name: 'review service-clm#7', running: true, state: 'working', startedAt: 2 },
      { key: 'DiliTrust/webapp-clm#3', id: 'b1', name: 'review webapp-clm#3', running: false, state: 'done', startedAt: 1 },
      { key: 'DiliTrust/webapp-clm#4', id: 'd1', name: 'review webapp-clm#4', running: false, state: 'done', startedAt: 1 },
    ]);
    // Each finding comes with its code at the reviewed commit, when GitHub has it.
    expect(await get('/reviews/b1/result')).toMatchObject({ status: 200, body: { text: 'LGTM', head: 'abc1234', findings: [
      { ...finding, code: { start: 1, lines: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'] } },
      { ...finding, id: 2, file: 'gone.ts', code: null },
    ] } });
    expect((await get('/reviews/a1/result')).status).toBe(404); // no answer yet
    expect((await get('/reviews/zz/result')).status).toBe(404); // unknown session
    // A transcript id that is not a plain id is never turned into a path.
    expect((await get('/reviews/d1/result')).status).toBe(404);
    expect(read).toEqual(['uuid-2', 'uuid-1']);
    // Findings are looked up for the session's own PR, written since the session started.
    expect(found).toEqual(['DiliTrust/webapp-clm#3@1', 'DiliTrust/service-clm#7@2', 'DiliTrust/webapp-clm#4@1']);
    expect((await get('/reviews', {})).status).toBe(403);
    expect((await get('/reviews/b1/result', {})).status).toBe(403);
  });

  test('details: parameters are validated', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/pulls/o/r/abc/details')).status).toBe(400);
  });
});
