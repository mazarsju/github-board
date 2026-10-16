import { describe, expect, test } from 'vitest';
import { listQuery, REPOS, REQUIRED_APPROVALS } from './config.ts';
import { defaultState, groupByRepo, matchesFilter, migrate, prStatus, toggleCollapsed } from './state.ts';
import type { PullRequest } from './types.ts';

const pr = (n: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  key: `DiliTrust/service-clm#${n}`, owner: 'DiliTrust', repo: 'service-clm', number: n,
  title: `PR ${n}`, url: '', draft: false, author: { login: 'alice', avatar: '' },
  createdAt: '', updatedAt: '', ...extra,
});

describe('config', () => {
  test('REPOS lists the tracked DiliTrust repositories', () => {
    expect(REPOS).toEqual(['DiliTrust/service-clm', 'DiliTrust/DT_Public_API', 'DiliTrust/webapp-clm']);
  });

  test('listQuery targets the open PRs of every tracked repository', () => {
    expect(listQuery(['a/b', 'c/d'])).toBe('is:open repo:a/b repo:c/d');
    for (const r of REPOS) expect(listQuery()).toContain(`repo:${r}`);
  });

  test('a PR needs 2 approvals', () => {
    expect(REQUIRED_APPROVALS).toBe(2);
  });
});

describe('state', () => {
  test('default settings', () => {
    expect(defaultState()).toEqual({ settings: { refresh: 300, theme: 'auto', collapsed: [] } });
  });

  test('migrate fills in missing settings', () => {
    expect(migrate({})).toEqual(defaultState());
    expect(migrate({ settings: { theme: 'dark' } })).toEqual({ settings: { refresh: 300, theme: 'dark', collapsed: [] } });
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
    expect(migrate(old as never)).toEqual({ settings: { refresh: 60, theme: 'light', collapsed: [] } });
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
