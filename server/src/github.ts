// Client de l'API REST GitHub, utilisé côté serveur (le token ne quitte jamais le backend).
import type {
  CiState, PrDetails, PullRequest, RateInfo, RepoAccess, ReviewDecision, SearchResult, SortKey,
} from '../../shared/types.ts';

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
      } catch { /* corps non JSON */ }
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
   * Vérifie que le token peut lire chaque dépôt ("owner/repo").
   * Sans accès, GitHub répond 404 (dépôt privé) ou 403 (SSO SAML non autorisé)
   * et la recherche ignore silencieusement ces dépôts : d'où ce contrôle explicite.
   */
  checkRepoAccess(repos: readonly string[]): Promise<RepoAccess[]> {
    return Promise.all(repos.map((repo) => this.request<{ private: boolean }>(`/repos/${repo}`).then(
      (data): RepoAccess => ({ repo, ok: true, private: data.private }),
      (err: GitHubError): RepoAccess => ({ repo, ok: false, status: err.status, error: err.message }),
    )));
  }

  /** Recherche de PRs via /search/issues. */
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

  /** Détails d'une PR : diff, état CI, décision de review. Mis en cache par updatedAt. */
  getDetails(owner: string, repo: string, number: number, updatedAt: string): Promise<PrDetails> {
    const cacheKey = `${owner}/${repo}#${number}@${updatedAt}`;
    const cached = this.detailsCache.get(cacheKey);
    if (cached) return cached;
    const promise = this.fetchDetails(owner, repo, number).catch((err: unknown) => {
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
    const sha = pull.head.sha;
    const [checks, status] = await Promise.all([
      this.request<ChecksPayload>(`${base}/commits/${sha}/check-runs?per_page=100`).catch(() => null),
      this.request<StatusPayload>(`${base}/commits/${sha}/status`).catch(() => null),
    ]);
    return {
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changed_files,
      merged: pull.merged,
      mergeableState: pull.mergeable_state,
      requestedReviewers: (pull.requested_reviewers ?? []).map((u) => u.login),
      review: reviewDecision(reviews),
      ci: ciState(checks, status),
    };
  }
}

interface SearchItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  repository_url: string;
  user: { login: string; avatar_url: string } | null;
  labels?: { name: string; color: string }[];
  comments: number;
  created_at: string;
  updated_at: string;
  pull_request?: { merged_at: string | null };
}

interface PullPayload {
  head: { sha: string };
  additions: number;
  deletions: number;
  changed_files: number;
  merged: boolean;
  mergeable_state: string;
  requested_reviewers?: { login: string }[];
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
    id: item.id,
    owner,
    repo,
    number: item.number,
    title: item.title,
    url: item.html_url,
    state: item.pull_request?.merged_at ? 'merged' : item.state,
    draft: !!item.draft,
    author: item.user ? { login: item.user.login, avatar: item.user.avatar_url } : null,
    labels: (item.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    comments: item.comments,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

/** Dernier avis significatif par relecteur → approved / changes / pending. */
export function reviewDecision(reviews: ReviewPayload[] | null): ReviewDecision {
  const latest = new Map<string, string>();
  for (const r of reviews ?? []) {
    if (!r.user || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(r.user.login, r.state);
  }
  const states = [...latest.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'changes';
  if (states.includes('APPROVED')) return 'approved';
  return 'pending';
}

const FAILED = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'];

/** Combine check-runs et statuts classiques → success / failure / pending / none. */
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
