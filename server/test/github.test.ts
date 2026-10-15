import { afterEach, describe, expect, test, vi } from 'vitest';
import { ciState, GitHubClient, reviewDecision } from '../src/github.ts';

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
  test('checkRepoAccess distingue dépôts lisibles et inaccessibles', async () => {
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

  test('searchPRs ajoute is:pr, envoie le token et normalise les résultats', async () => {
    const fetch = mockFetch({
      '/search/issues': [200, {
        total_count: 1,
        items: [{ id: 1, number: 7, title: 'T', html_url: 'u', state: 'closed', pull_request: { merged_at: '2026-01-01' },
          repository_url: 'https://api.github.com/repos/DiliTrust/service-clm', user: null, labels: [], comments: 0, created_at: 'c', updated_at: 'u' }],
      }],
    });
    const client = new GitHubClient('secret');
    const { total, items } = await client.searchPRs('repo:DiliTrust/service-clm', { limit: 500 });
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get('q')).toBe('is:pr repo:DiliTrust/service-clm');
    expect(new URL(url).searchParams.get('per_page')).toBe('100');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ key: 'DiliTrust/service-clm#7', state: 'merged', author: null });
    expect(client.rate.core).toEqual({ remaining: 42, limit: 5000, reset: 1000 });
  });

  test('getDetails combine PR, reviews et CI, avec cache par updatedAt', async () => {
    const fetch = mockFetch({
      '/repos/o/r/pulls/1': [200, { head: { sha: 'abc' }, additions: 3, deletions: 1, changed_files: 2, merged: false, mergeable_state: 'dirty', requested_reviewers: [{ login: 'bob' }] }],
      '/repos/o/r/pulls/1/reviews': [200, [{ user: { login: 'bob' }, state: 'APPROVED' }]],
      '/repos/o/r/commits/abc/check-runs': [200, { check_runs: [{ status: 'completed', conclusion: 'success' }] }],
      '/repos/o/r/commits/abc/status': [200, { state: 'pending', statuses: [] }],
    });
    const client = new GitHubClient('t');
    const d = await client.getDetails('o', 'r', 1, 'v1');
    expect(d).toEqual({ additions: 3, deletions: 1, changedFiles: 2, merged: false, mergeableState: 'dirty', requestedReviewers: ['bob'], review: 'approved', ci: 'success' });
    await client.getDetails('o', 'r', 1, 'v1');
    expect(fetch).toHaveBeenCalledTimes(4);
    await client.getDetails('o', 'r', 1, 'v2');
    expect(fetch).toHaveBeenCalledTimes(8);
  });
});

describe('reviewDecision', () => {
  test('retient le dernier avis significatif par relecteur', () => {
    expect(reviewDecision([])).toBe('pending');
    expect(reviewDecision([{ user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'a' }, state: 'APPROVED' }])).toBe('approved');
    expect(reviewDecision([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'b' }, state: 'CHANGES_REQUESTED' }])).toBe('changes');
    expect(reviewDecision([{ user: { login: 'a' }, state: 'COMMENTED' }])).toBe('pending');
  });
});

describe('ciState', () => {
  test('combine check-runs et statuts', () => {
    expect(ciState(null, null)).toBe('none');
    expect(ciState({ check_runs: [{ status: 'completed', conclusion: 'success' }] }, null)).toBe('success');
    expect(ciState({ check_runs: [{ status: 'in_progress', conclusion: null }] }, null)).toBe('pending');
    expect(ciState({ check_runs: [{ status: 'completed', conclusion: 'timed_out' }] }, null)).toBe('failure');
    expect(ciState({ check_runs: [{ status: 'completed', conclusion: 'success' }] }, { state: 'error', statuses: [{}] })).toBe('failure');
  });
});
