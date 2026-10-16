import { afterEach, describe, expect, test, vi } from 'vitest';
import { approvalCount, ciState, GitHubClient, reviewDecision } from '../src/github.ts';

afterEach(() => { vi.unstubAllGlobals(); });

function mockFetch(routes: Record<string, [number, unknown]>) {
  const fetch = vi.fn(async (url: string) => {
    const { pathname } = new URL(url);
    const [status, body] = routes[pathname] ?? [404, { message: 'Not Found' }];
    return new Response(JSON.stringify(body), { status, headers: { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '42', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1' } });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('GitHubClient', () => {
  test('checkRepoAccess tells readable and inaccessible repositories apart', async () => {
    mockFetch({
      '/repos/DiliTrust/service-clm': [200, { private: true }],
      '/repos/DiliTrust/webapp-clm': [403, { message: 'Resource protected by organization SAML enforcement.' }],
    });
    const res = await new GitHubClient('t').checkRepoAccess(['DiliTrust/service-clm', 'DiliTrust/DT_Public_API', 'DiliTrust/webapp-clm']);
    expect(res).toEqual([
      { repo: 'DiliTrust/service-clm', ok: true, private: true },
      { repo: 'DiliTrust/DT_Public_API', ok: false, status: 404, error: 'Not Found' },
      { repo: 'DiliTrust/webapp-clm', ok: false, status: 403, error: 'Resource protected by organization SAML enforcement.' },
    ]);
  });

  /** Open PR as listed by GET /repos/{repo}/pulls. */
  const pull = (n: number, created: string, extra: object = {}) => ({
    number: n, title: `T${n}`, html_url: `u${n}`, draft: false, user: { login: 'bob', avatar_url: 'a' },
    base: { ref: 'develop' }, head: { ref: `b${n}`, repo: { full_name: 'o/r' } }, created_at: created, updated_at: 'u', ...extra,
  });

  /** Mocks GET /repos/{repo}/pulls pages: repo → pages of PRs; other repos answer `missing`. */
  function mockPulls(pages: Record<string, unknown[][]>, missing = 404) {
    const fetch = vi.fn(async (url: string) => {
      const { pathname, searchParams } = new URL(url);
      const repo = /^\/repos\/(.+)\/pulls$/.exec(pathname)?.[1] ?? '';
      const page = pages[repo]?.[Number(searchParams.get('page')) - 1];
      const headers = { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '42', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1' };
      if (!pages[repo]) return new Response(JSON.stringify({ message: 'Not Found' }), { status: missing, headers });
      return new Response(JSON.stringify(page ?? []), { status: 200, headers });
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  test('listOpenPulls reads every page, sends the token and normalises PRs', async () => {
    const full = Array.from({ length: 100 }, (_, i) => pull(200 - i, '2026-10-02'));
    const fetch = mockPulls({ 'o/r': [full, [pull(1, '2026-10-01', {
      draft: true, base: { ref: 'b7' }, head: { ref: 'feat', repo: { full_name: 'fork/r' } },
    })]] });
    const client = new GitHubClient('secret');
    const items = await client.listOpenPulls('o/r');
    expect(items).toHaveLength(101);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({ state: 'open', sort: 'created', direction: 'desc', per_page: '100', page: '1' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(items[0]).toEqual({
      key: 'o/r#200', owner: 'o', repo: 'r', number: 200, title: 'T200', url: 'u200', draft: false,
      author: { login: 'bob', avatar: 'a' }, baseRef: 'develop', headRef: 'b200', createdAt: '2026-10-02', updatedAt: 'u',
    });
    // A PR from a fork has no usable head branch here.
    expect(items[100]).toMatchObject({ number: 1, draft: true, baseRef: 'b7', headRef: null });
    expect(client.rate.core).toEqual({ remaining: 42, limit: 5000, reset: 1000 });
  });

  test('listOpenPRs merges repositories newest first, truncates and skips unreadable ones', async () => {
    mockPulls({
      'o/a': [[pull(3, '2026-10-03'), pull(1, '2026-10-01')]],
      'o/b': [[pull(2, '2026-10-02')]],
    });
    const { total, items } = await new GitHubClient('t').listOpenPRs(['o/a', 'o/b', 'o/private'], 2);
    expect(total).toBe(3);
    expect(items.map((p) => p.key)).toEqual(['o/a#3', 'o/b#2']);
  });

  test('listOpenPRs reports other GitHub errors', async () => {
    mockPulls({}, 500);
    await expect(new GitHubClient('t').listOpenPRs(['o/a'], 10)).rejects.toMatchObject({ status: 500 });
  });

  /** Routes of a PR's details: the PR, its reviews and the CI of its head commit "abc". */
  const detailsRoutes = (pull: object, reviews: unknown[], runs: { status: string; conclusion: string | null }[]): Record<string, [number, unknown]> => ({
    '/repos/o/r/pulls/1': [200, { head: { sha: 'abc' }, additions: 0, deletions: 0, changed_files: 0, mergeable_state: 'clean', ...pull }],
    '/repos/o/r/pulls/1/reviews': [200, reviews],
    '/repos/o/r/commits/abc/check-runs': [200, { check_runs: runs }],
    '/repos/o/r/commits/abc/status': [200, { state: 'pending', statuses: [] }],
  });

  test('getDetails combines the PR, its reviews and its CI, cached by updatedAt', async () => {
    const fetch = mockFetch(detailsRoutes(
      { additions: 3, deletions: 1, changed_files: 2, mergeable_state: 'dirty' },
      [{ user: { login: 'bob' }, state: 'APPROVED' }],
      [{ status: 'completed', conclusion: 'failure' }],
    ));
    const client = new GitHubClient('t');
    const d = await client.getDetails('o', 'r', 1, 'v1');
    expect(d).toEqual({ additions: 3, deletions: 1, changedFiles: 2, mergeableState: 'dirty', review: 'approved', approvals: 1, ci: 'failure' });
    await client.getDetails('o', 'r', 1, 'v1');
    expect(fetch).toHaveBeenCalledTimes(4);
    await client.getDetails('o', 'r', 1, 'v2');
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  test('getDetails does not cache a mergeability GitHub has not computed yet', async () => {
    const fetch = mockFetch(detailsRoutes({ mergeable_state: 'unknown' }, [], []));
    const client = new GitHubClient('t');
    expect((await client.getDetails('o', 'r', 1, 'v1')).mergeableState).toBe('unknown');
    await client.getDetails('o', 'r', 1, 'v1');
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  test('getDetails does not cache a running CI, whose completion does not change updatedAt', async () => {
    const fetch = mockFetch(detailsRoutes({}, [], [{ status: 'in_progress', conclusion: null }]));
    const client = new GitHubClient('t');
    expect((await client.getDetails('o', 'r', 1, 'v1')).ci).toBe('pending');
    await client.getDetails('o', 'r', 1, 'v1');
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  test('getDetails tolerates unreadable CI endpoints', async () => {
    const routes = detailsRoutes({}, [], []);
    delete routes['/repos/o/r/commits/abc/check-runs'];
    delete routes['/repos/o/r/commits/abc/status'];
    mockFetch(routes);
    expect((await new GitHubClient('t').getDetails('o', 'r', 1, 'v1')).ci).toBe('none');
  });
});

describe('reviewDecision', () => {
  test('keeps the latest meaningful review of each reviewer', () => {
    expect(reviewDecision([])).toBe('pending');
    expect(reviewDecision([{ user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'a' }, state: 'APPROVED' }])).toBe('approved');
    expect(reviewDecision([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'b' }, state: 'CHANGES_REQUESTED' }])).toBe('changes');
    expect(reviewDecision([{ user: { login: 'a' }, state: 'COMMENTED' }])).toBe('pending');
  });
});

describe('approvalCount', () => {
  test('counts reviewers whose latest review is an approval', () => {
    expect(approvalCount(null)).toBe(0);
    expect(approvalCount([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'b' }, state: 'APPROVED' }])).toBe(2);
    // Same reviewer approving twice counts once; comments do not cancel an approval.
    expect(approvalCount([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'a' }, state: 'COMMENTED' }])).toBe(1);
    // Changes requested after an approval, or a dismissed approval, no longer count.
    expect(approvalCount([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'a' }, state: 'CHANGES_REQUESTED' }])).toBe(0);
    expect(approvalCount([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'a' }, state: 'DISMISSED' }])).toBe(0);
    expect(approvalCount([{ user: null, state: 'APPROVED' }])).toBe(0);
  });
});

describe('ciState', () => {
  test('combines check runs and commit statuses', () => {
    expect(ciState(null, null)).toBe('none');
    expect(ciState({ check_runs: [{ status: 'completed', conclusion: 'success' }] }, null)).toBe('success');
    expect(ciState({ check_runs: [{ status: 'completed', conclusion: 'skipped' }] }, null)).toBe('success');
    expect(ciState({ check_runs: [{ status: 'in_progress', conclusion: null }] }, null)).toBe('pending');
    expect(ciState({ check_runs: [{ status: 'completed', conclusion: 'timed_out' }] }, null)).toBe('failure');
    expect(ciState({ check_runs: [{ status: 'completed', conclusion: 'success' }] }, { state: 'error', statuses: [{}] })).toBe('failure');
    // A failure wins over checks still running.
    expect(ciState({ check_runs: [{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'failure' }] }, null)).toBe('failure');
    // Without any classic status, the combined "pending" state is ignored.
    expect(ciState({ check_runs: [] }, { state: 'pending', statuses: [] })).toBe('none');
  });
});
