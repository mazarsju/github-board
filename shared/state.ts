// Pure logic: default state, migration, PR filter, grouping and status.
import { REPOS, REQUIRED_APPROVALS } from './config.ts';
import type { AppState, PrDetails, PrStatus, PullRequest, Settings, StackedPr } from './types.ts';

export function defaultState(): AppState {
  return { settings: { refresh: 300, theme: 'auto', collapsed: [], dismissedReviews: [] } };
}

/**
 * Builds a valid state from saved data, filling in missing settings. Data saved by
 * older versions (boards, columns, PR metadata…) is dropped.
 */
export function migrate(data: { settings?: Partial<Settings> }): AppState {
  const base = defaultState().settings;
  const {
    refresh = base.refresh, theme = base.theme, collapsed = base.collapsed, dismissedReviews = base.dismissedReviews,
  } = data.settings ?? {};
  return { settings: { refresh, theme, collapsed, dismissedReviews } };
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
 * Orders the PRs of one repository so that stacked PRs sit together: a PR whose base branch is
 * another listed PR's branch comes right after it, one level deeper. Stacks (and standalone PRs)
 * keep the input order of their newest PR; inside a stack, PRs follow the stack, oldest sibling first.
 */
export function orderStacks(prs: PullRequest[]): StackedPr[] {
  const byHead = new Map<string, PullRequest>();
  for (const pr of prs) if (pr.headRef) byHead.set(pr.headRef, pr);
  const parentOf = (pr: PullRequest) => {
    const parent = byHead.get(pr.baseRef);
    return parent && parent !== pr ? parent : undefined;
  };
  const children = new Map<PullRequest, PullRequest[]>();
  for (const pr of prs) {
    const parent = parentOf(pr);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), pr]);
  }
  const rank = new Map(prs.map((pr, i) => [pr, i]));
  const placed = new Set<PullRequest>();

  // Depth-first walk of one stack; `placed` also guards against branch cycles.
  const walk = (pr: PullRequest, depth: number, out: StackedPr[]) => {
    if (placed.has(pr)) return;
    placed.add(pr);
    const parent = depth ? parentOf(pr) : undefined;
    out.push(parent ? { pr, depth, parent } : { pr, depth });
    const kids = [...(children.get(pr) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const kid of kids) walk(kid, depth + 1, out);
  };

  // A root is a PR not stacked on another listed PR; PRs caught in a cycle become roots too.
  const stacks: { rows: StackedPr[]; first: number }[] = [];
  for (const pr of [...prs.filter((p) => !parentOf(p)), ...prs]) {
    if (placed.has(pr)) continue;
    const rows: StackedPr[] = [];
    walk(pr, 0, rows);
    rows[0]!.stackSize = rows.length;
    stacks.push({ rows, first: Math.min(...rows.map((r) => rank.get(r.pr)!)) });
  }
  return stacks.sort((a, b) => a.first - b.first).flatMap((s) => s.rows);
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
