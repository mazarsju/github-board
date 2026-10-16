// GitHub REST API client, used server-side (the token never leaves the backend).
import type { CiState, PrDetails, PullRequest, RateInfo, RepoAccess, ReviewDecision, SearchResult, SortKey } from '../../shared/types.ts';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
}

export class GitHubClient {
  rate: RateInfo = { core: null, search: null };
  private detailsCache = new Map<string, Promise<PrDetails>>();
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async request<T>(path: string): Promise<T> {
    const res = await fetch(API + path, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'github-board',
      },
    });
    this.trackRate(res);
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const data = (await res.json()) as { message?: string; errors?: { message?: string; code?: string }[] };
        if (data.message) msg = data.message;
        if (data.errors?.length) msg += ' — ' + data.errors.map((e) => e.message || e.code).join(', ');
      } catch { /* non-JSON body */ }
      throw new GitHubError(msg, res.status);
    }
    return (res.status === 204 ? null : await res.json()) as T;
  }

  private trackRate(res: Response): void {
    const resource = res.headers.get('x-ratelimit-resource');
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (!resource || remaining == null) return;
    this.rate[resource === 'search' ? 'search' : 'core'] = {
      remaining: Number(remaining),
      limit: Number(res.headers.get('x-ratelimit-limit')),
      reset: Number(res.headers.get('x-ratelimit-reset')) * 1000,
    };
  }

  getUser(): Promise<GitHubUser> {
    return this.request<GitHubUser>('/user');
  }

  /**
   * Checks that the token can read each repository ("owner/repo").
   * Without access, GitHub answers 404 (private repository) or 403 (SAML SSO not authorized)
   * and the search silently ignores those repositories: hence this explicit check.
   */
  checkRepoAccess(repos: readonly string[]): Promise<RepoAccess[]> {
    return Promise.all(repos.map((repo) => this.request<{ private: boolean }>(`/repos/${repo}`).then(
      (data): RepoAccess => ({ repo, ok: true, private: data.private }),
      (err: GitHubError): RepoAccess => ({ repo, ok: false, status: err.status, error: err.message }),
    )));
  }

  /** PR search through /search/issues. */
  async searchPRs(query: string, { sort = 'updated', limit = 30 }: { sort?: SortKey; limit?: number } = {}): Promise<SearchResult> {
    let q = query.trim();
    if (!/\b(is|type):pr\b/.test(q)) q = `is:pr ${q}`;
    const params = new URLSearchParams({
      q,
      sort,
      order: 'desc',
      per_page: String(Math.min(Math.max(limit, 1), 100)),
    });
    const data = await this.request<{ total_count: number; items: SearchItem[] }>(`/search/issues?${params}`);
    return { total: data.total_count, items: data.items.map(normalizeSearchItem) };
  }

  /**
   * PR details: diff, mergeability, reviews, CI. Cached by updatedAt, except while GitHub is still
   * computing mergeability ("unknown") or CI is running: neither updates the PR's updatedAt, so the
   * next call must see the result.
   */
  getDetails(owner: string, repo: string, number: number, updatedAt: string): Promise<PrDetails> {
    const cacheKey = `${owner}/${repo}#${number}@${updatedAt}`;
    const cached = this.detailsCache.get(cacheKey);
    if (cached) return cached;
    const promise = this.fetchDetails(owner, repo, number).then((details) => {
      if (details.mergeableState === 'unknown' || details.ci === 'pending') this.detailsCache.delete(cacheKey);
      return details;
    }, (err: unknown) => {
      this.detailsCache.delete(cacheKey);
      throw err;
    });
    this.detailsCache.set(cacheKey, promise);
    return promise;
  }

  private async fetchDetails(owner: string, repo: string, number: number): Promise<PrDetails> {
    const base = `/repos/${owner}/${repo}`;
    const [pull, reviews] = await Promise.all([
      this.request<PullPayload>(`${base}/pulls/${number}`),
      this.request<ReviewPayload[]>(`${base}/pulls/${number}/reviews?per_page=100`),
    ]);
    // CI of the PR's head commit: check runs (GitHub Actions…) and classic commit statuses.
    const sha = pull.head.sha;
    const [checks, status] = await Promise.all([
      this.request<ChecksPayload>(`${base}/commits/${sha}/check-runs?per_page=100`).catch(() => null),
      this.request<StatusPayload>(`${base}/commits/${sha}/status`).catch(() => null),
    ]);
    return {
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changed_files,
      mergeableState: pull.mergeable_state,
      review: reviewDecision(reviews),
      approvals: approvalCount(reviews),
      ci: ciState(checks, status),
    };
  }
}

interface SearchItem {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  repository_url: string;
  user: { login: string; avatar_url: string } | null;
  created_at: string;
  updated_at: string;
}

interface PullPayload {
  head: { sha: string };
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable_state: string;
}

export interface ReviewPayload {
  user: { login: string } | null;
  state: string;
}

export interface ChecksPayload {
  check_runs: { status: string; conclusion: string | null }[];
}

export interface StatusPayload {
  state: string;
  statuses: unknown[];
}

export function normalizeSearchItem(item: SearchItem): PullRequest {
  const [owner = '', repo = ''] = (item.repository_url.split('/repos/')[1] ?? '').split('/');
  return {
    key: `${owner}/${repo}#${item.number}`,
    owner,
    repo,
    number: item.number,
    title: item.title,
    url: item.html_url,
    draft: !!item.draft,
    author: item.user ? { login: item.user.login, avatar: item.user.avatar_url } : null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

/** Latest meaningful review state of each reviewer (comments and pending reviews ignored). */
function latestReviewStates(reviews: ReviewPayload[] | null): string[] {
  const latest = new Map<string, string>();
  for (const r of reviews ?? []) {
    if (!r.user || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(r.user.login, r.state);
  }
  return [...latest.values()];
}

/** Latest meaningful review of each reviewer → approved / changes / pending. */
export function reviewDecision(reviews: ReviewPayload[] | null): ReviewDecision {
  const states = latestReviewStates(reviews);
  if (states.includes('CHANGES_REQUESTED')) return 'changes';
  if (states.includes('APPROVED')) return 'approved';
  return 'pending';
}

/** Number of reviewers whose latest review is an approval (a dismissed approval does not count). */
export function approvalCount(reviews: ReviewPayload[] | null): number {
  return latestReviewStates(reviews).filter((s) => s === 'APPROVED').length;
}

const FAILED = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'];

/** Combines check runs and classic commit statuses → success / failure / pending / none. */
export function ciState(checks: ChecksPayload | null, status: StatusPayload | null): CiState {
  const results: string[] = [];
  for (const run of checks?.check_runs ?? []) {
    if (run.status !== 'completed') results.push('pending');
    else if (FAILED.includes(run.conclusion ?? '')) results.push('failure');
    else results.push('success');
  }
  if (status?.statuses?.length) {
    results.push(status.state === 'error' ? 'failure' : status.state);
  }
  if (!results.length) return 'none';
  if (results.includes('failure')) return 'failure';
  if (results.includes('pending')) return 'pending';
  return 'success';
}
