import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { REPOS } from '../../shared/config.ts';
import { defaultState } from '../../shared/state.ts';
import { createApp, type AppOptions } from '../src/app.ts';
import { GitHubClient, GitHubError } from '../src/github.ts';
import { MemoryStore } from '../src/store.ts';

/** Client GitHub factice : seul le token "good" est valide. */
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
  override async searchPRs(query: string) {
    if (query.includes('bad')) throw new GitHubError('Validation Failed', 422);
    return { total: 0, items: [] };
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
  test('exige une session', async () => {
    const { call } = await start();
    expect((await call('/session')).status).toBe(401);
    expect((await call('/state')).status).toBe(401);
  });

  test('refuse un token invalide', async () => {
    const { call } = await start();
    const res = await call('/session', { method: 'POST', body: JSON.stringify({ token: 'nope' }) });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Bad credentials');
  });

  test('connexion, état, sauvegarde et déconnexion', async () => {
    const { call, store } = await start();
    const login = await call('/session', { method: 'POST', body: JSON.stringify({ token: 'good' }) });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ user: { login: 'alice', avatarUrl: 'https://avatar' }, envToken: false });
    expect(login.setCookie).toMatch(/HttpOnly/);
    expect(login.setCookie).toMatch(/SameSite=Strict/);

    const state = await call('/state');
    expect(state.body.boards[0].id).toBe('repos');

    const next = { ...defaultState(), prs: { 'o/r#1': { pinned: true } } };
    expect((await call('/state', { method: 'PUT', body: JSON.stringify(next) })).status).toBe(204);
    expect((await store.get('alice')).prs).toEqual({ 'o/r#1': { pinned: true } });
    expect((await call('/state', { method: 'PUT', body: JSON.stringify({ boards: [] }) })).status).toBe(400);

    expect((await call('/session', { method: 'DELETE' })).status).toBe(204);
    expect((await call('/state')).status).toBe(401);
  });

  test('contrôle d’accès aux dépôts suivis', async () => {
    const { call } = await start({ envToken: 'good' });
    const res = await call('/repos/access');
    expect(res.body.map((r: { repo: string }) => r.repo)).toEqual(REPOS);
    expect(res.body.filter((r: { ok: boolean }) => !r.ok).map((r: { repo: string }) => r.repo)).toEqual(['DiliTrust/webapp-clm']);
  });

  test('recherche : validation et erreurs GitHub relayées', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/search?q=is:open')).body).toEqual({ total: 0, items: [] });
    expect((await call('/search')).status).toBe(400);
    expect((await call('/search?q=x&limit=500')).status).toBe(400);
    const bad = await call('/search?q=bad');
    expect(bad).toMatchObject({ status: 422, body: { error: 'Validation Failed' } });
  });

  test('avec GITHUB_TOKEN : session automatique, connexion manuelle refusée', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/session')).body).toEqual({ user: { login: 'alice', avatarUrl: 'https://avatar' }, envToken: true });
    expect((await call('/session', { method: 'POST', body: JSON.stringify({ token: 'good' }) })).status).toBe(409);
  });

  test('détails : paramètres validés', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/pulls/o/r/abc/details')).status).toBe(400);
  });
});
