// GitHub REST API client, used server-side (the token never leaves the backend).
import { REQUIRED_APPROVALS } from '../../shared/config.ts';
import type { CiState, MyAction, PrDetails, PullList, PullRequest, RateInfo, RepoAccess, ReviewDecision } from '../../shared/types.ts';

const API = 'https://api.github.com';
/** Pages of 100 PRs read per repository at most. */
const MAX_PAGES = 10;

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
  rate: RateInfo = { core: null };
  private detailsCache = new Map<string, Promise<PrDetails>>();
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  /** GET `path`, or POST `body` as JSON when given. */
  async request<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'github-board',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    if (resource !== 'core' || remaining == null) return;
    this.rate.core = {
      remaining: Number(remaining),
      limit: Number(res.headers.get('x-ratelimit-limit')),
      reset: Number(res.headers.get('x-ratelimit-reset')) * 1000,
    };
  }

  /** GraphQL query; GraphQL errors (answered with HTTP 200) are thrown as a 502. */
  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.request<{ data?: T; errors?: { message: string }[] }>('/graphql', { query, variables });
    if (res.errors?.length || !res.data) throw new GitHubError(res.errors?.map((e) => e.message).join(', ') || 'Empty GraphQL response', 502);
    return res.data;
  }

  /**
   * Open PRs authored by `login` in `repos` that wait for them: approved enough to be merged,
   * or with discussions they have not answered. Uses GraphQL, the only API telling whether a
   * review thread is resolved.
   */
  async myActions(login: string, repos: readonly string[]): Promise<MyAction[]> {
    const q = `is:pr is:open author:${login} sort:updated-desc ${repos.map((r) => `repo:${r}`).join(' ')}`;
    const data = await this.graphql<{ search: { nodes: (MyPullNode | Record<string, never>)[] } }>(MY_PULLS_QUERY, { q });
    return data.search.nodes
      .filter((node): node is MyPullNode => 'number' in node)
      .map((node) => toMyAction(node, login))
      .filter((action): action is MyAction => !!action);
  }

  getUser(): Promise<GitHubUser> {
    return this.request<GitHubUser>('/user');
  }

  /**
   * Checks that the token can read each repository ("owner/repo").
   * Without access, GitHub answers 404 (private repository) or 403 (SAML SSO not authorized)
   * and their PRs are left out of the list (see listOpenPRs): hence this explicit check.
   */
  checkRepoAccess(repos: readonly string[]): Promise<RepoAccess[]> {
    return Promise.all(repos.map((repo) => this.request<{ private: boolean }>(`/repos/${repo}`).then(
      (data): RepoAccess => ({ repo, ok: true, private: data.private }),
      (err: GitHubError): RepoAccess => ({ repo, ok: false, status: err.status, error: err.message }),
    )));
  }

  /** Open PRs of one repository ("owner/repo"), newest first. */
  async listOpenPulls(repo: string): Promise<PullRequest[]> {
    const items: PullRequest[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await this.request<PullListItem[]>(`/repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=100&page=${page}`);
      items.push(...data.map((item) => normalizePull(repo, item)));
      if (data.length < 100) break;
    }
    return items;
  }

  /**
   * Open PRs of several repositories, the `limit` newest ones first. A repository the token
   * cannot read (403/404) is skipped: checkRepoAccess reports it.
   */
  async listOpenPRs(repos: readonly string[], limit: number): Promise<PullList> {
    const lists = await Promise.all(repos.map((repo) => this.listOpenPulls(repo).catch((err: unknown) => {
      if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) return [];
      throw err;
    })));
    const all = lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { total: all.length, items: all.slice(0, limit) };
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

interface PullListItem {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  user: { login: string; avatar_url: string } | null;
  base: { ref: string };
  /** `repo` is null when the fork was deleted. */
  head: { ref: string; repo: { full_name: string } | null };
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

export interface CheckRun {
  id: number;
  name: string;
  app?: { id: number } | null;
  status: string;
  conclusion: string | null;
}

export interface ChecksPayload {
  check_runs: CheckRun[];
}

export interface StatusPayload {
  state: string;
  statuses: unknown[];
}

export function normalizePull(repo: string, item: PullListItem): PullRequest {
  const [owner = '', name = ''] = repo.split('/');
  return {
    key: `${repo}#${item.number}`,
    owner,
    repo: name,
    number: item.number,
    title: item.title,
    url: item.html_url,
    draft: !!item.draft,
    author: item.user ? { login: item.user.login, avatar: item.user.avatar_url } : null,
    baseRef: item.base.ref,
    headRef: item.head.repo?.full_name === repo ? item.head.ref : null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

const MY_PULLS_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt updatedAt
        repository { nameWithOwner }
        author { login avatarUrl }
        baseRefName headRefName
        headRepository { nameWithOwner }
        latestOpinionatedReviews(first: 100) { nodes { state } }
        reviewThreads(first: 100) { nodes { isResolved isOutdated comments(last: 1) { nodes { author { __typename login } } } } }
        comments(last: 100) { nodes { createdAt author { __typename login } } }
        reviews(last: 100) { nodes { state body submittedAt author { __typename login } } }
      }
    }
  }
}`;

interface GqlAuthor {
  __typename?: string;
  login: string;
}

export interface MyPullNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  baseRefName: string;
  headRefName: string;
  headRepository: { nameWithOwner: string } | null;
  latestOpinionatedReviews: { nodes: { state: string }[] };
  reviewThreads: { nodes: { isResolved: boolean; isOutdated: boolean; comments: { nodes: { author: GqlAuthor | null }[] } }[] };
  comments: { nodes: { createdAt: string; author: GqlAuthor | null }[] };
  reviews: { nodes: { state: string; body: string; submittedAt: string | null; author: GqlAuthor | null }[] };
}

/** A person other than `me`: bots (CodeRabbit…) and deleted accounts are left out. */
const isOtherHuman = (a: GqlAuthor | null, me: string): a is GqlAuthor =>
  !!a && a.__typename !== 'Bot' && !a.login.endsWith('[bot]') && a.login !== me;

/**
 * Discussions of a PR whose last word is someone else's: each unresolved review thread whose
 * last comment is not `me`'s, unless outdated (the commented code has changed since: taken as
 * addressed), plus 1 when the conversation (PR comments and the text of
 * "comment" / "changes requested" reviews) ends with someone else's message. Bots are ignored.
 */
export function unansweredCount(node: Pick<MyPullNode, 'reviewThreads' | 'comments' | 'reviews'>, me: string): number {
  const threads = node.reviewThreads.nodes.filter((t) => !t.isResolved && !t.isOutdated && isOtherHuman(t.comments.nodes[0]?.author ?? null, me)).length;
  const conversation = [
    ...node.comments.nodes.map((c) => ({ at: c.createdAt, author: c.author })),
    ...node.reviews.nodes
      .filter((r) => r.body.trim() && r.submittedAt && (r.state === 'COMMENTED' || r.state === 'CHANGES_REQUESTED'))
      .map((r) => ({ at: r.submittedAt!, author: r.author })),
  ]
    .filter((m) => m.author && m.author.__typename !== 'Bot' && !m.author.login.endsWith('[bot]'))
    .sort((a, b) => a.at.localeCompare(b.at));
  const last = conversation.at(-1);
  return threads + (last && isOtherHuman(last.author, me) ? 1 : 0);
}

/** The action `me` has to take on their PR, or null when it waits for nobody but reviewers. */
export function toMyAction(node: MyPullNode, me: string): MyAction | null {
  const approved = node.latestOpinionatedReviews.nodes.filter((r) => r.state === 'APPROVED').length >= REQUIRED_APPROVALS;
  const unanswered = unansweredCount(node, me);
  if (!approved && !unanswered) return null;
  const repo = node.repository.nameWithOwner;
  const [owner = '', name = ''] = repo.split('/');
  const pr: PullRequest = {
    key: `${repo}#${node.number}`,
    owner,
    repo: name,
    number: node.number,
    title: node.title,
    url: node.url,
    draft: node.isDraft,
    author: node.author ? { login: node.author.login, avatar: node.author.avatarUrl } : null,
    baseRef: node.baseRefName,
    headRef: node.headRepository?.nameWithOwner === repo ? node.headRefName : null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
  return { pr, approved, unanswered };
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

/**
 * Latest run of each check (same name, same app). A commit keeps the runs of every workflow
 * execution, e.g. a cancelled run followed by a successful re-run: only the latest one counts,
 * as on GitHub's PR page. Run ids grow over time.
 */
function latestRuns(runs: CheckRun[]): CheckRun[] {
  const latest = new Map<string, CheckRun>();
  for (const run of runs) {
    const key = `${run.app?.id ?? ''}/${run.name}`;
    const seen = latest.get(key);
    if (!seen || run.id > seen.id) latest.set(key, run);
  }
  return [...latest.values()];
}

/** Combines check runs and classic commit statuses → success / failure / pending / none. */
export function ciState(checks: ChecksPayload | null, status: StatusPayload | null): CiState {
  const results: string[] = [];
  for (const run of latestRuns(checks?.check_runs ?? [])) {
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
