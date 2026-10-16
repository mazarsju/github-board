import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  approvalCount, type CheckRun, ciState, GitHubClient, type MyPullNode, reviewDecision, toMyAction, unansweredCount,
} from '../src/github.ts';

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
  const detailsRoutes = (pull: object, reviews: unknown[], runs: CheckRun[]): Record<string, [number, unknown]> => ({
    '/repos/o/r/pulls/1': [200, { head: { sha: 'abc' }, additions: 0, deletions: 0, changed_files: 0, mergeable_state: 'clean', ...pull }],
    '/repos/o/r/pulls/1/reviews': [200, reviews],
    '/repos/o/r/commits/abc/check-runs': [200, { check_runs: runs }],
    '/repos/o/r/commits/abc/status': [200, { state: 'pending', statuses: [] }],
  });

  test('getDetails combines the PR, its reviews and its CI, cached by updatedAt', async () => {
    const fetch = mockFetch(detailsRoutes(
      { additions: 3, deletions: 1, changed_files: 2, mergeable_state: 'dirty' },
      [{ user: { login: 'bob' }, state: 'APPROVED' }],
      [{ id: 5, name: 'c5', status: 'completed', conclusion: 'failure' }],
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
    const fetch = mockFetch(detailsRoutes({}, [], [{ id: 6, name: 'c6', status: 'in_progress', conclusion: null }]));
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
    expect(ciState({ check_runs: [{ id: 7, name: 'c7', status: 'completed', conclusion: 'success' }] }, null)).toBe('success');
    expect(ciState({ check_runs: [{ id: 8, name: 'c8', status: 'completed', conclusion: 'skipped' }] }, null)).toBe('success');
    expect(ciState({ check_runs: [{ id: 9, name: 'c9', status: 'in_progress', conclusion: null }] }, null)).toBe('pending');
    expect(ciState({ check_runs: [{ id: 10, name: 'c10', status: 'completed', conclusion: 'timed_out' }] }, null)).toBe('failure');
    expect(ciState({ check_runs: [{ id: 11, name: 'c11', status: 'completed', conclusion: 'success' }] }, { state: 'error', statuses: [{}] })).toBe('failure');
    // A failure wins over checks still running.
    expect(ciState({ check_runs: [{ id: 12, name: 'c12', status: 'in_progress', conclusion: null }, { id: 13, name: 'c13', status: 'completed', conclusion: 'failure' }] }, null)).toBe('failure');
    // Only the latest run of each check counts: a cancelled then re-run workflow is a success.
    const rerun = { check_runs: [
      { id: 10, name: 'Test', app: { id: 1 }, status: 'completed', conclusion: 'cancelled' },
      { id: 11, name: 'CI result', app: { id: 1 }, status: 'completed', conclusion: 'failure' },
      { id: 21, name: 'CI result', app: { id: 1 }, status: 'completed', conclusion: 'success' },
      { id: 20, name: 'Test', app: { id: 1 }, status: 'completed', conclusion: 'success' },
    ] };
    expect(ciState(rerun, null)).toBe('success');
    // …whatever the order the API lists them in, and a newer failing run still fails.
    expect(ciState({ check_runs: [...rerun.check_runs, { id: 30, name: 'Test', app: { id: 1 }, status: 'completed', conclusion: 'failure' }] }, null)).toBe('failure');
    // Same name from two apps: two different checks.
    expect(ciState({ check_runs: [
      { id: 1, name: 'build', app: { id: 1 }, status: 'completed', conclusion: 'failure' },
      { id: 2, name: 'build', app: { id: 2 }, status: 'completed', conclusion: 'success' },
    ] }, null)).toBe('failure');
    // Without any classic status, the combined "pending" state is ignored.
    expect(ciState({ check_runs: [] }, { state: 'pending', statuses: [] })).toBe('none');
  });
});

describe('my actions', () => {
  const user = (login: string) => ({ __typename: 'User', login });
  const bot = (login: string) => ({ __typename: 'Bot', login });
  const thread = (last: { __typename: string; login: string }, isResolved = false) => ({ isResolved, comments: { nodes: [{ author: last }] } });
  const node = (extra: Partial<MyPullNode> = {}): MyPullNode => ({
    number: 7, title: 'T', url: 'u', isDraft: false, createdAt: 'c', updatedAt: 'u',
    repository: { nameWithOwner: 'o/r' }, author: { login: 'me', avatarUrl: 'a' },
    baseRefName: 'develop', headRefName: 'feat', headRepository: { nameWithOwner: 'o/r' },
    latestOpinionatedReviews: { nodes: [] }, reviewThreads: { nodes: [] }, comments: { nodes: [] }, reviews: { nodes: [] },
    ...extra,
  });

  test('unanswered review threads: unresolved, last comment by another person', () => {
    expect(unansweredCount(node({ reviewThreads: { nodes: [
      thread(user('bob')), // waiting for me
      thread(user('me')), // I answered last
      thread(user('bob'), true), // resolved
      thread(bot('coderabbitai')), // bots are ignored
    ] } }), 'me')).toBe(1);
  });

  test('the conversation counts once, when its last human message is someone else\'s', () => {
    const comments = (...msgs: [string, ReturnType<typeof user>][]) => ({ nodes: msgs.map(([createdAt, author]) => ({ createdAt, author })) });
    expect(unansweredCount(node({ comments: comments(['1', user('me')], ['2', user('bob')], ['3', user('carol')]) }), 'me')).toBe(1);
    expect(unansweredCount(node({ comments: comments(['1', user('bob')], ['2', user('me')]) }), 'me')).toBe(0);
    // A bot speaking after me does not reopen the conversation.
    expect(unansweredCount(node({ comments: comments(['1', user('me')], ['2', bot('coderabbitai')]) }), 'me')).toBe(0);
    // The text of a "comment" or "changes requested" review is part of the conversation, not an approval's.
    const review = (state: string, body: string, submittedAt: string) => ({ state, body, submittedAt, author: user('bob') });
    expect(unansweredCount(node({ comments: comments(['1', user('me')]), reviews: { nodes: [review('CHANGES_REQUESTED', 'Please fix', '2')] } }), 'me')).toBe(1);
    expect(unansweredCount(node({ comments: comments(['1', user('me')]), reviews: { nodes: [review('APPROVED', 'LGTM', '2')] } }), 'me')).toBe(0);
    expect(unansweredCount(node({ comments: comments(['1', user('me')]), reviews: { nodes: [review('COMMENTED', '  ', '2')] } }), 'me')).toBe(0);
  });

  test('toMyAction keeps approved PRs and PRs with unanswered discussions', () => {
    const approvals = (n: number) => ({ latestOpinionatedReviews: { nodes: Array.from({ length: n }, () => ({ state: 'APPROVED' })) } });
    expect(toMyAction(node(approvals(1)), 'me')).toBeNull();
    expect(toMyAction(node({ latestOpinionatedReviews: { nodes: [{ state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }] } }), 'me')).toBeNull();
    expect(toMyAction(node(approvals(2)), 'me')).toMatchObject({ approved: true, unanswered: 0 });
    const action = toMyAction(node({ reviewThreads: { nodes: [thread(user('bob'))] }, headRepository: { nameWithOwner: 'fork/r' } }), 'me');
    expect(action).toEqual({
      approved: false, unanswered: 1,
      pr: {
        key: 'o/r#7', owner: 'o', repo: 'r', number: 7, title: 'T', url: 'u', draft: false,
        author: { login: 'me', avatar: 'a' }, baseRef: 'develop', headRef: null, createdAt: 'c', updatedAt: 'u',
      },
    });
  });

  test('myActions searches the user\'s open PRs in the tracked repositories through GraphQL', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: { search: { nodes: [
      node({ number: 1, latestOpinionatedReviews: { nodes: [{ state: 'APPROVED' }, { state: 'APPROVED' }] } }),
      node({ number: 2 }), // nothing to do
      {}, // non-PR search result
    ] } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const actions = await new GitHubClient('secret').myActions('me', ['o/r', 'o/s']);
    expect(actions.map((a) => a.pr.key)).toEqual(['o/r#1']);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/graphql');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).variables.q).toBe('is:pr is:open author:me sort:updated-desc repo:o/r repo:o/s');
  });

  test('myActions reports GraphQL errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'Bad query' }] }), { status: 200 })));
    await expect(new GitHubClient('t').myActions('me', ['o/r'])).rejects.toMatchObject({ status: 502, message: 'Bad query' });
  });
});
