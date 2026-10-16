import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { REPOS } from '../../shared/config.ts';
import { defaultState } from '../../shared/state.ts';
import { createApp, type AppOptions } from '../src/app.ts';
import type { BackgroundSession, ClaudeCli } from '../src/claude.ts';
import { PlacementChanged, type PrTarget, type SavedFinding, type Skills } from '../src/skills.ts';
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

const finding = (extra: Partial<SavedFinding> = {}): SavedFinding => ({
  id: 1, severity: 'major', file: 'a.ts', line: 4, startLine: null, title: 'Bug', body: 'Details', suggestion: null,
  easySummary: null, decision: null, url: null, edited: false, editError: null, editSession: null, ...extra,
});

/** A saved finding as the API shows it: without its edit session. */
const shown = ({ editSession: _, ...f }: SavedFinding) => f;

/** Skills keeping the findings of each PR (`owner/repo#n`) in memory, written since `since`. */
function memorySkills(byPr: Record<string, { since: number; findings: SavedFinding[] }>, place: Skills['placement'] = async () => 'inline') {
  const key = (pr: PrTarget) => `${pr.owner}/${pr.repo}#${pr.number}`;
  const calls: string[] = [];
  const posted: [string, number, string, string, string][] = [];
  // The skill's field names, as written by updateFinding.
  const names: Record<string, keyof SavedFinding> = {
    decision: 'decision', url: 'url', edited: 'edited', edit_session: 'editSession', edit_error: 'editError',
    title: 'title', body: 'body', suggestion: 'suggestion', easy_summary: 'easySummary',
  };
  const skills: Skills = {
    async readFindings(pr, since) {
      calls.push(`${key(pr)}@${since}`);
      const saved = byPr[key(pr)];
      return saved && saved.since >= since ? { findings: saved.findings.map((f) => ({ ...f })), head: 'abc1234' } : null;
    },
    async updateFinding(pr, id, fields) {
      const f = byPr[key(pr)]!.findings.find((x) => x.id === id)!;
      for (const [k, v] of Object.entries(fields)) (f as Record<string, unknown>)[names[k]!] = v ?? (k === 'edited' ? false : null);
    },
    placement: place,
    async post(pr, f, head, body, mode) {
      if (f.file === 'moved.ts') throw new PlacementChanged('The comment would now land elsewhere: review it again.');
      posted.push([key(pr), f.id, head, body, mode]);
      return `https://github.com/comment/${f.id}`;
    },
  };
  return { skills, calls, posted, byPr };
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
    };
    const { call } = await start({ envToken: 'good', claude });
    const post = (path: string, headers: Record<string, string> = { 'X-Github-Board': '1' }) => call(path, { method: 'POST', headers });

    expect(await post('/pulls/DiliTrust/service-clm/7/review')).toMatchObject({ status: 200, body: { name: 'review service-clm#7', output: 'abc123' } });
    expect(started).toEqual([['/pr-review https://github.com/DiliTrust/service-clm/pull/7', 'review service-clm#7']]);
    // Without the app's header (e.g. a request from another website): refused, nothing started.
    expect((await post('/pulls/DiliTrust/service-clm/7/review', {})).status).toBe(403);
    expect((await post('/pulls/o/r;rm/7/review')).status).toBe(400);
    expect((await post('/pulls/o/r/7/review')).status).toBe(404); // not a tracked repository
    expect(await post('/pulls/DiliTrust/service-clm/13/review')).toMatchObject({ status: 500, body: { error: 'Could not start Claude: Not logged in' } });
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
    const claude: ClaudeCli = {
      startBackground: async () => '',
      listBackground: async () => sessions,
      readResult: async (sessionId) => { read.push(sessionId); return sessionId === 'uuid-2' ? 'LGTM' : null; },
    };
    const { skills, calls } = memorySkills({ 'DiliTrust/webapp-clm#3': { since: 1, findings: [finding(), finding({ id: 2, file: 'gone.ts' })] } });
    const { call } = await start({ envToken: 'good', claude, skills });
    const get = (path: string, headers: Record<string, string> = { 'X-Github-Board': '1' }) => call(path, { headers });

    expect((await get('/reviews')).body).toEqual([
      { key: 'DiliTrust/service-clm#7', id: 'a1', name: 'review service-clm#7', running: true, state: 'working', startedAt: 2 },
      { key: 'DiliTrust/webapp-clm#3', id: 'b1', name: 'review webapp-clm#3', running: false, state: 'done', startedAt: 1 },
      { key: 'DiliTrust/webapp-clm#4', id: 'd1', name: 'review webapp-clm#4', running: false, state: 'done', startedAt: 1 },
    ]);
    // Each finding comes with its code at the reviewed commit, when GitHub has it.
    expect(await get('/reviews/b1/result')).toMatchObject({ status: 200, body: { text: 'LGTM', head: 'abc1234', findings: [
      { ...shown(finding()), editing: false, code: { start: 1, lines: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'] } },
      { ...shown(finding({ id: 2, file: 'gone.ts' })), editing: false, code: null },
    ] } });
    expect((await get('/reviews/a1/result')).status).toBe(404); // no answer yet
    expect((await get('/reviews/zz/result')).status).toBe(404); // unknown session
    // A transcript id that is not a plain id is never turned into a path.
    expect((await get('/reviews/d1/result')).status).toBe(404);
    expect(read).toEqual(['uuid-2', 'uuid-1']);
    // Findings are looked up for the session's own PR, written since the session started.
    expect(calls).toEqual(['DiliTrust/webapp-clm#3@1', 'DiliTrust/service-clm#7@2', 'DiliTrust/webapp-clm#4@1']);
    expect((await get('/reviews', {})).status).toBe(403);
    expect((await get('/reviews/b1/result', {})).status).toBe(403);
  });

  describe('findings', () => {
    const review: BackgroundSession = { id: 'r1', sessionId: 'uuid-r', name: 'review service-clm#7', state: 'done', startedAt: 5 };
    /** An app with one finished review of service-clm#7 and its findings; `sessions` can be changed. */
    async function withFindings(findings: SavedFinding[], answers: Record<string, string> = {}) {
      const sessions: BackgroundSession[] = [review];
      const started: [string, string][] = [];
      const claude: ClaudeCli = {
        async startBackground(prompt, name) {
          started.push([prompt, name]);
          sessions.push({ id: 'e1', sessionId: 'uuid-e1', name, state: 'working', startedAt: 9 });
          return 'started';
        },
        listBackground: async () => sessions,
        readResult: async (sessionId) => answers[sessionId] ?? null,
      };
      const mem = memorySkills({ 'DiliTrust/service-clm#7': { since: 5, findings } });
      const { call } = await start({ envToken: 'good', claude, skills: mem.skills });
      const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'X-Github-Board': '1' }) =>
        call(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { ...mem, sessions, started, send, found: () => mem.byPr['DiliTrust/service-clm#7']!.findings };
    }

    test('approve: shows the exact comment and placement, then posts only that', async () => {
      const { send, posted, found } = await withFindings([finding({ suggestion: 'ok();' })]);
      const body = '**🟠 Major**: Bug\n\nDetails\n\n```suggestion\nok();\n```';
      expect(await send('GET', '/reviews/r1/findings/1/placement')).toMatchObject({ status: 200, body: { mode: 'inline', body } });
      // A body other than the one shown is refused, nothing is posted.
      expect((await send('POST', '/reviews/r1/findings/1/post', { mode: 'inline', body: 'Something else' })).status).toBe(409);
      expect(posted).toEqual([]);
      expect(await send('POST', '/reviews/r1/findings/1/post', { mode: 'inline', body })).toMatchObject({ status: 200, body: { url: 'https://github.com/comment/1' } });
      expect(posted).toEqual([['DiliTrust/service-clm#7', 1, 'abc1234', body, 'inline']]);
      expect(found()[0]).toMatchObject({ decision: 'posted', url: 'https://github.com/comment/1' });
      // Decided once.
      expect(await send('POST', '/reviews/r1/findings/1/post', { mode: 'inline', body })).toMatchObject({ status: 409, body: { error: 'This finding was already posted.' } });
    });

    test('approve: a placement that changed since is reported, nothing is recorded', async () => {
      const { send, found } = await withFindings([finding({ file: 'moved.ts' })]);
      expect(await send('POST', '/reviews/r1/findings/1/post', { mode: 'inline', body: '**🟠 Major**: Bug\n\nDetails' }))
        .toMatchObject({ status: 409, body: { error: 'The comment would now land elsewhere: review it again.' } });
      expect(found()[0]!.decision).toBeNull();
    });

    test('reject: the finding is dropped', async () => {
      const { send, found } = await withFindings([finding(), finding({ id: 2 })]);
      expect((await send('POST', '/reviews/r1/findings/2/reject')).status).toBe(204);
      expect(found().map((f) => f.decision)).toEqual([null, 'dropped']);
      expect((await send('POST', '/reviews/r1/findings/3/reject')).status).toBe(404);
    });

    test('edit: a Claude session rewrites the finding, applied once it is over', async () => {
      const { send, started, sessions, found } = await withFindings([finding()], {
        'uuid-e1': '{"title": "Shorter bug", "body": "Short.", "suggestion": null, "easy_summary": "Plus court."}',
      });
      expect((await send('POST', '/reviews/r1/findings/1/edit', { request: '   ' })).status).toBe(400);
      expect(await send('POST', '/reviews/r1/findings/1/edit', { request: 'Make it shorter' })).toMatchObject({ status: 200, body: { name: 'edit service-clm#7 finding 1', id: 'e1' } });
      expect(started[0]![1]).toBe('edit service-clm#7 finding 1');
      expect(started[0]![0]).toContain('Make it shorter');
      // While it runs, the finding says so and cannot be decided.
      expect((await send('GET', '/reviews/r1/result')).body.findings[0]).toMatchObject({ title: 'Bug', editing: true });
      expect((await send('POST', '/reviews/r1/findings/1/reject')).status).toBe(409);

      sessions[1]!.state = 'done';
      expect((await send('GET', '/reviews/r1/result')).body.findings[0]).toMatchObject({
        title: 'Shorter bug', body: 'Short.', easySummary: 'Plus court.', edited: true, editing: false, decision: null,
      });
      expect(found()[0]).toMatchObject({ title: 'Shorter bug', edited: true, editSession: null });
    });

    test('edit: a session that answers no finding leaves an error, the finding unchanged', async () => {
      const { send, sessions, found } = await withFindings([finding()], { 'uuid-e1': 'Sorry, I could not.' });
      await send('POST', '/reviews/r1/findings/1/edit', { request: 'Rewrite' });
      sessions[1]!.state = 'failed';
      expect((await send('GET', '/reviews/r1/result')).body.findings[0]).toMatchObject({
        title: 'Bug', editing: false, editError: 'Claude did not return an edited finding.',
      });
      expect(found()[0]).toMatchObject({ editSession: null, edited: false });
    });

    test('decisions are only taken from the app on this machine', async () => {
      const { send, found } = await withFindings([finding()]);
      expect((await send('POST', '/reviews/r1/findings/1/reject', undefined, {})).status).toBe(403);
      expect((await send('GET', '/reviews/r1/findings/1/placement', undefined, {})).status).toBe(403);
      expect((await send('POST', '/reviews/r1/findings/x/reject')).status).toBe(400);
      expect(found()[0]!.decision).toBeNull();
    });
  });

  test('details: parameters are validated', async () => {
    const { call } = await start({ envToken: 'good' });
    expect((await call('/pulls/o/r/abc/details')).status).toBe(400);
  });
});
