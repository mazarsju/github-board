import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { REPOS } from '../../shared/config.ts';
import { defaultState } from '../../shared/state.ts';
import { createApp, type AppOptions } from '../src/app.ts';
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
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
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

    const next = { settings: { refresh: 60, theme: 'dark', collapsed: ['DiliTrust/webapp-clm'] } };
    expect((await call('/state', { method: 'PUT', body: JSON.stringify(next) })).status).toBe(204);
    expect(await store.get('alice')).toEqual(next);
    expect((await call('/state', { method: 'PUT', body: JSON.stringify({ settings: { refresh: -1, theme: 'dark', collapsed: [] } }) })).status).toBe(400);

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

  test('details: parameters are validated', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/pulls/o/r/abc/details')).status).toBe(400);
  });
});
