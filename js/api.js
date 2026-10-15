// Client minimal pour l'API REST GitHub (exécuté dans le navigateur).
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class GitHubAPI {
  constructor(token) {
    this.token = token;
    this.rate = { core: null, search: null };
    this.detailsCache = new Map();
  }

  async request(path, { method = 'GET', body } = {}) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    this.#trackRate(res);
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const data = await res.json();
        if (data.message) msg = data.message;
        if (data.errors?.length) msg += ' — ' + data.errors.map((e) => e.message || e.code).join(', ');
      } catch { /* corps non JSON */ }
      throw new GitHubError(msg, res.status);
    }
    return res.status === 204 ? null : res.json();
  }

  #trackRate(res) {
    const resource = res.headers.get('x-ratelimit-resource');
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (!resource || remaining == null) return;
    this.rate[resource === 'search' ? 'search' : 'core'] = {
      remaining: Number(remaining),
      limit: Number(res.headers.get('x-ratelimit-limit')),
      reset: Number(res.headers.get('x-ratelimit-reset')) * 1000,
    };
  }

  getUser() {
    return this.request('/user');
  }

  /** Recherche de PRs via /search/issues. */
  async searchPRs(query, { sort = 'updated', limit = 30 } = {}) {
    let q = query.trim();
    if (!/\b(is|type):pr\b/.test(q)) q = `is:pr ${q}`;
    const params = new URLSearchParams({
      q,
      sort,
      order: 'desc',
      per_page: String(Math.min(Math.max(limit, 1), 100)),
    });
    const data = await this.request(`/search/issues?${params}`);
    return { total: data.total_count, items: data.items.map(normalizeSearchItem) };
  }

  /** Détails d'une PR : diff, état CI, décision de review. Mis en cache par updated_at. */
  async getDetails(pr) {
    const cacheKey = `${pr.key}@${pr.updatedAt}`;
    if (this.detailsCache.has(cacheKey)) return this.detailsCache.get(cacheKey);
    const promise = this.#fetchDetails(pr).catch((err) => {
      this.detailsCache.delete(cacheKey);
      throw err;
    });
    this.detailsCache.set(cacheKey, promise);
    return promise;
  }

  async #fetchDetails(pr) {
    const base = `/repos/${pr.owner}/${pr.repo}`;
    const [pull, reviews] = await Promise.all([
      this.request(`${base}/pulls/${pr.number}`),
      this.request(`${base}/pulls/${pr.number}/reviews?per_page=100`),
    ]);
    const sha = pull.head.sha;
    const [checks, status] = await Promise.all([
      this.request(`${base}/commits/${sha}/check-runs?per_page=100`).catch(() => null),
      this.request(`${base}/commits/${sha}/status`).catch(() => null),
    ]);
    return {
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changed_files,
      merged: pull.merged,
      mergeableState: pull.mergeable_state,
      requestedReviewers: (pull.requested_reviewers || []).map((u) => u.login),
      review: reviewDecision(reviews),
      ci: ciState(checks, status),
    };
  }
}

function normalizeSearchItem(item) {
  const [owner, repo] = item.repository_url.split('/repos/')[1].split('/');
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
    labels: (item.labels || []).map((l) => ({ name: l.name, color: l.color })),
    comments: item.comments,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

/** Dernier avis significatif par relecteur → approved / changes / pending. */
export function reviewDecision(reviews) {
  const latest = new Map();
  for (const r of reviews || []) {
    if (!r.user || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(r.user.login, r.state);
  }
  const states = [...latest.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'changes';
  if (states.includes('APPROVED')) return 'approved';
  return 'pending';
}

/** Combine check-runs et statuts classiques → success / failure / pending / none. */
export function ciState(checks, status) {
  const results = [];
  for (const run of checks?.check_runs || []) {
    if (run.status !== 'completed') results.push('pending');
    else if (['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(run.conclusion)) results.push('failure');
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
