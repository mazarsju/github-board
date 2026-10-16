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

  test('searchPRs adds is:pr, sends the token and normalises the results', async () => {
    const fetch = mockFetch({
      '/search/issues': [200, {
        total_count: 1,
        items: [{ number: 7, title: 'T', html_url: 'u', draft: true, repository_url: 'https://api.github.com/repos/DiliTrust/service-clm',
          user: { login: 'bob', avatar_url: 'a' }, created_at: 'c', updated_at: 'u' }],
      }],
    });
    const client = new GitHubClient('secret');
    const { total, items } = await client.searchPRs('repo:DiliTrust/service-clm', { limit: 500 });
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get('q')).toBe('is:pr repo:DiliTrust/service-clm');
    expect(new URL(url).searchParams.get('per_page')).toBe('100');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(total).toBe(1);
    expect(items[0]).toEqual({
      key: 'DiliTrust/service-clm#7', owner: 'DiliTrust', repo: 'service-clm', number: 7, title: 'T', url: 'u',
      draft: true, author: { login: 'bob', avatar: 'a' }, createdAt: 'c', updatedAt: 'u',
    });
    expect(client.rate.core).toEqual({ remaining: 42, limit: 5000, reset: 1000 });
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
