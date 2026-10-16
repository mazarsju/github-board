// Pure logic: default state, migration, PR filter, grouping and status.
import { REPOS, REQUIRED_APPROVALS } from './config.ts';
import type { AppState, PrDetails, PrStatus, PullRequest, Settings } from './types.ts';

export function defaultState(): AppState {
  return { settings: { refresh: 300, theme: 'auto', collapsed: [] } };
}

/**
 * Builds a valid state from saved data, filling in missing settings. Data saved by
 * older versions (boards, columns, PR metadata…) is dropped.
 */
export function migrate(data: { settings?: Partial<Settings> }): AppState {
  const base = defaultState().settings;
  const { refresh = base.refresh, theme = base.theme, collapsed = base.collapsed } = data.settings ?? {};
  return { settings: { refresh, theme, collapsed } };
}

/** Collapses or expands the group of a repository in the list. */
export function toggleCollapsed(settings: Settings, repo: string): Settings {
  const collapsed = settings.collapsed.includes(repo)
    ? settings.collapsed.filter((r) => r !== repo)
    : [...settings.collapsed, repo];
  return { ...settings, collapsed };
}

/** Text filter: every term must match the title, repository, number or author. */
export function matchesFilter(pr: PullRequest, filter: string): boolean {
  const hay = `${pr.title} ${pr.owner}/${pr.repo} #${pr.number} ${pr.author?.login ?? ''}`.toLowerCase();
  return filter.toLowerCase().split(/\s+/).filter(Boolean).every((term) => hay.includes(term));
}

/**
 * Groups PRs by repository ("owner/repo"), in the order of `repos`; repositories without PRs
 * are left out and unlisted ones come last. PRs keep their order within each group.
 */
export function groupByRepo(prs: PullRequest[], repos: readonly string[] = REPOS): { repo: string; prs: PullRequest[] }[] {
  const groups = new Map<string, PullRequest[]>(repos.map((r) => [r, []]));
  for (const pr of prs) {
    const repo = `${pr.owner}/${pr.repo}`;
    groups.set(repo, [...(groups.get(repo) ?? []), pr]);
  }
  return [...groups].filter(([, list]) => list.length).map(([repo, list]) => ({ repo, prs: list }));
}

/**
 * Status of an open PR, the most blocking one winning: failed CI, draft, merge conflict,
 * changes requested, approved (REQUIRED_APPROVALS reached), otherwise review pending.
 */
export function prStatus(pr: Pick<PullRequest, 'draft'>, d: Pick<PrDetails, 'mergeableState' | 'review' | 'approvals' | 'ci'>): PrStatus {
  if (d.ci === 'failure') return 'ci-failed';
  if (pr.draft) return 'draft';
  if (d.mergeableState === 'dirty') return 'conflict';
  if (d.review === 'changes') return 'changes';
  if (d.approvals >= REQUIRED_APPROVALS) return 'approved';
  return 'pending';
}
