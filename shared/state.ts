// Pure logic: default state, migration, PR filter, grouping, status and review readiness.
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
 * keep the input order of their first PR in that order; inside a stack, PRs follow the stack, oldest
 * sibling first.
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

/**
 * How much a status calls for a review, 0..1: a PR waiting for reviewers first, then one whose
 * changes were requested (to re-review), then an approved one; a failed CI, a draft or a merge
 * conflict can't be reviewed as is.
 */
const STATUS_READINESS: Record<PrStatus, number> = {
  pending: 1, changes: 0.8, approved: 0.6, 'ci-failed': 0.2, draft: 0.2, conflict: 0.2,
};

const DAY = 86_400_000;

/** How fresh a PR is, 0..1: opened < 2 days ago 1, up to 5 days 0.9, up to 10 days 0.7, older 0.6. */
export function ageReadiness(createdAt: string, now = Date.now()): number {
  const days = (now - new Date(createdAt).getTime()) / DAY;
  if (days < 2) return 1;
  if (days <= 5) return 0.9;
  if (days <= 10) return 0.7;
  return 0.6;
}

/** Review readiness of a PR over 100 (status × freshness), or null while its status is unknown. */
export function readinessScore(pr: Pick<PullRequest, 'createdAt'>, status: PrStatus | null, now = Date.now()): number | null {
  return status ? Math.round(100 * STATUS_READINESS[status] * ageReadiness(pr.createdAt, now)) : null;
}

/**
 * PRs from the most to the least ready for a review; PRs whose status is not known yet come
 * last. Ties keep the input order (newest first). Passed to orderStacks, a stack then sits where
 * its best-scored PR would be: the whole stack gets its best score.
 */
export function byReadiness(prs: PullRequest[], statusOf: (pr: PullRequest) => PrStatus | null, now = Date.now()): PullRequest[] {
  const score = new Map(prs.map((pr) => [pr, readinessScore(pr, statusOf(pr), now) ?? -1]));
  return [...prs].sort((a, b) => score.get(b)! - score.get(a)!);
}
