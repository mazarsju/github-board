import { describe, expect, test } from 'vitest';
import { REPOS, REQUIRED_APPROVALS } from './config.ts';
import {
  ageReadiness, byReadiness, defaultState, groupByRepo, matchesFilter, migrate, orderStacks, prStatus, readinessScore, toggleCollapsed,
} from './state.ts';
import type { PullRequest } from './types.ts';

const pr = (n: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  key: `DiliTrust/service-clm#${n}`, owner: 'DiliTrust', repo: 'service-clm', number: n,
  title: `PR ${n}`, url: '', draft: false, author: { login: 'alice', avatar: '' },
  baseRef: 'develop', headRef: `branch-${n}`, createdAt: '', updatedAt: '', ...extra,
});

describe('config', () => {
  test('REPOS lists the tracked DiliTrust repositories', () => {
    expect(REPOS).toEqual(['DiliTrust/service-clm', 'DiliTrust/DT_Public_API', 'DiliTrust/webapp-clm']);
  });

  test('a PR needs 2 approvals', () => {
    expect(REQUIRED_APPROVALS).toBe(2);
  });
});

describe('state', () => {
  test('default settings', () => {
    expect(defaultState()).toEqual({ settings: { refresh: 300, theme: 'auto', collapsed: [], dismissedReviews: [] } });
  });

  test('migrate fills in missing settings', () => {
    expect(migrate({})).toEqual(defaultState());
    expect(migrate({ settings: { theme: 'dark' } })).toEqual({ settings: { refresh: 300, theme: 'dark', collapsed: [], dismissedReviews: [] } });
    expect(migrate({ settings: { dismissedReviews: ['r1'] } }).settings.dismissedReviews).toEqual(['r1']);
    expect(migrate({ settings: { collapsed: ['a/b'] } }).settings.collapsed).toEqual(['a/b']);
  });

  test('toggleCollapsed collapses then expands a repository group', () => {
    const base = defaultState().settings;
    const collapsed = toggleCollapsed(base, 'a/b');
    expect(collapsed).toEqual({ ...base, collapsed: ['a/b'] });
    expect(toggleCollapsed(toggleCollapsed(collapsed, 'c/d'), 'a/b').collapsed).toEqual(['c/d']);
    expect(base.collapsed).toEqual([]);
  });

  test('migrate drops data saved by the old board version', () => {
    const old = {
      boards: [{ id: 'repos', name: 'Dépôts', columns: [] }], activeBoard: 'repos', prs: { 'o/r#1': { pinned: true } },
      seen: {}, reposSeeded: true, settings: { refresh: 60, theme: 'light', details: true, compact: false, view: 'list' },
    };
    expect(migrate(old as never)).toEqual({ settings: { refresh: 60, theme: 'light', collapsed: [], dismissedReviews: [] } });
  });
});

describe('matchesFilter', () => {
  const p = pr(42, { title: 'Fix login' });

  test('matches title, repository, number and author', () => {
    expect(matchesFilter(p, '')).toBe(true);
    expect(matchesFilter(p, 'LOGIN')).toBe(true);
    expect(matchesFilter(p, 'service-clm')).toBe(true);
    expect(matchesFilter(p, '#42')).toBe(true);
    expect(matchesFilter(p, 'alice')).toBe(true);
  });

  test('every term must match', () => {
    expect(matchesFilter(p, '  fix   alice ')).toBe(true);
    expect(matchesFilter(p, 'fix bob')).toBe(false);
  });
});

describe('groupByRepo', () => {
  const at = (repo: string, n: number) => pr(n, { key: `DiliTrust/${repo}#${n}`, repo });

  test('groups in the order of the tracked repositories, keeping PR order', () => {
    const prs = [at('webapp-clm', 9), at('service-clm', 8), at('webapp-clm', 7), at('service-clm', 6)];
    expect(groupByRepo(prs, ['DiliTrust/service-clm', 'DiliTrust/DT_Public_API', 'DiliTrust/webapp-clm'])).toEqual([
      { repo: 'DiliTrust/service-clm', prs: [prs[1], prs[3]] },
      { repo: 'DiliTrust/webapp-clm', prs: [prs[0], prs[2]] },
    ]);
  });

  test('repositories missing from the list come last', () => {
    expect(groupByRepo([at('other', 1), at('service-clm', 2)], ['DiliTrust/service-clm']).map((g) => g.repo))
      .toEqual(['DiliTrust/service-clm', 'DiliTrust/other']);
    expect(groupByRepo([])).toEqual([]);
  });
});

describe('orderStacks', () => {
  /** PR `n` created on day `day`, stacked on PR `on` (its base is that PR's branch). */
  const at = (n: number, day: number, on?: number) =>
    pr(n, { createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, baseRef: on ? `branch-${on}` : 'develop' });
  const view = (rows: ReturnType<typeof orderStacks>) =>
    rows.map((r) => [r.pr.number, r.depth, r.stackSize ?? null, r.parent?.number ?? null]);

  test('standalone PRs keep their order, each as a stack of one', () => {
    expect(view(orderStacks([at(3, 3), at(2, 2), at(1, 1)]))).toEqual([[3, 0, 1, null], [2, 0, 1, null], [1, 0, 1, null]]);
  });

  test('a chain of stacked PRs follows its root, one level deeper each time', () => {
    // Newest first, as listed by GitHub: 3 is stacked on 2, itself stacked on 1.
    expect(view(orderStacks([at(3, 3, 2), at(9, 2), at(2, 2, 1), at(1, 1)]))).toEqual([
      [1, 0, 3, null], [2, 1, null, 1], [3, 2, null, 2], [9, 0, 1, null],
    ]);
  });

  test('a stack is placed where its newest PR is', () => {
    // 5 (newest overall) is stacked on 1 (oldest): the stack comes before 4.
    expect(view(orderStacks([at(5, 5, 1), at(4, 4), at(1, 1)])).map(([n]) => n)).toEqual([1, 5, 4]);
  });

  test('a PR with several stacked children forms a tree, oldest child first', () => {
    expect(view(orderStacks([at(4, 4, 2), at(3, 3, 1), at(2, 2, 1), at(1, 1)]))).toEqual([
      [1, 0, 4, null], [2, 1, null, 1], [4, 2, null, 2], [3, 1, null, 1],
    ]);
  });

  test('a PR stacked on a PR missing from the list stands alone', () => {
    expect(view(orderStacks([at(2, 2, 7)]))).toEqual([[2, 0, 1, null]]);
  });

  test('a PR from a fork cannot be the base of another PR', () => {
    expect(view(orderStacks([at(2, 2, 1), pr(1, { headRef: null, createdAt: '2026-10-01T00:00:00Z' })]))).toEqual([
      [2, 0, 1, null], [1, 0, 1, null],
    ]);
  });

  test('branch cycles do not loop and keep every PR', () => {
    const rows = orderStacks([at(2, 2, 1), at(1, 1, 2)]);
    expect(rows.map((r) => r.pr.number).sort()).toEqual([1, 2]);
    expect(rows[0]!.depth).toBe(0);
  });
});

describe('prStatus', () => {
  const ready = { mergeableState: 'clean', review: 'approved' as const, approvals: 2, ci: 'success' as const };

  test('approved once the required approvals are reached', () => {
    expect(prStatus(pr(1), ready)).toBe('approved');
    expect(prStatus(pr(1), { ...ready, approvals: 3 })).toBe('approved');
  });

  test('a single approval is not enough: review still pending', () => {
    expect(prStatus(pr(1), { ...ready, approvals: 1 })).toBe('pending');
    expect(prStatus(pr(1), { ...ready, review: 'pending', approvals: 0 })).toBe('pending');
  });

  test('changes requested wins over approvals', () => {
    expect(prStatus(pr(1), { ...ready, review: 'changes' })).toBe('changes');
  });

  test('a merge conflict wins over the review state', () => {
    expect(prStatus(pr(1), { ...ready, mergeableState: 'dirty' })).toBe('conflict');
    expect(prStatus(pr(1), { ...ready, mergeableState: 'dirty', review: 'changes' })).toBe('conflict');
  });

  test('a draft is always reported as draft', () => {
    expect(prStatus(pr(1, { draft: true }), { ...ready, mergeableState: 'dirty' })).toBe('draft');
  });

  test('a failed CI wins over every other status', () => {
    expect(prStatus(pr(1), { ...ready, ci: 'failure' })).toBe('ci-failed');
    expect(prStatus(pr(1, { draft: true }), { ...ready, ci: 'failure', mergeableState: 'dirty', review: 'changes' })).toBe('ci-failed');
  });

  test('a running or missing CI does not change the status', () => {
    expect(prStatus(pr(1), { ...ready, ci: 'pending' })).toBe('approved');
    expect(prStatus(pr(1), { ...ready, ci: 'none' })).toBe('approved');
  });

  test('mergeability not computed yet is not a conflict', () => {
    expect(prStatus(pr(1), { ...ready, mergeableState: 'unknown' })).toBe('approved');
  });
});

describe('review readiness', () => {
  const NOW = Date.parse('2026-10-20T12:00:00Z');
  const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

  test('ageReadiness: the fresher the better', () => {
    expect([0, 1.9, 2, 5, 5.1, 10, 10.1, 60].map((d) => ageReadiness(daysAgo(d), NOW))).toEqual([1, 1, 0.9, 0.9, 0.7, 0.7, 0.6, 0.6]);
  });

  test('readinessScore is 100 × status × freshness, unknown until the status is', () => {
    expect(readinessScore({ createdAt: daysAgo(1) }, 'pending', NOW)).toBe(100);
    expect(readinessScore({ createdAt: daysAgo(3) }, 'changes', NOW)).toBe(72);
    expect(readinessScore({ createdAt: daysAgo(7) }, 'approved', NOW)).toBe(42);
    expect(readinessScore({ createdAt: daysAgo(20) }, 'ci-failed', NOW)).toBe(12);
    expect(readinessScore({ createdAt: daysAgo(1) }, 'draft', NOW)).toBe(20);
    expect(readinessScore({ createdAt: daysAgo(1) }, 'conflict', NOW)).toBe(20);
    expect(readinessScore({ createdAt: daysAgo(1) }, null, NOW)).toBeNull();
  });

  test('byReadiness: most ready first, unknown statuses last, ties in the input order', () => {
    const prs = [pr(1, { createdAt: daysAgo(1) }), pr(2, { createdAt: daysAgo(1) }), pr(3, { createdAt: daysAgo(1) }), pr(4, { createdAt: daysAgo(30) })];
    const status = { 1: 'approved', 2: null, 3: 'pending', 4: 'pending' } as const;
    expect(byReadiness(prs, (p) => status[p.number as 1 | 2 | 3 | 4], NOW).map((p) => p.number)).toEqual([3, 1, 4, 2]); // #1 and #4 both score 60
  });

  test('a stack takes the best score of its PRs', () => {
    // #2 (draft, 20) carries #3 (pending, 100) on top of it: the stack goes before #1 (approved, 60).
    const prs = [
      pr(1, { createdAt: daysAgo(1), headRef: 'b1' }),
      pr(2, { createdAt: daysAgo(1), headRef: 'b2' }),
      pr(3, { createdAt: daysAgo(1), headRef: 'b3', baseRef: 'b2' }),
    ];
    const status = { 1: 'approved', 2: 'draft', 3: 'pending' } as const;
    const rows = orderStacks(byReadiness(prs, (p) => status[p.number as 1 | 2 | 3], NOW));
    expect(rows.map((r) => [r.pr.number, r.depth])).toEqual([[2, 0], [3, 1], [1, 0]]);
  });
});
