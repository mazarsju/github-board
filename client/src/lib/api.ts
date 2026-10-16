// HTTP client of the backend (/api). The GitHub token is never handled by the browser.
import type {
  AppState, MyAction, PrDetails, PullList, PullRequest, RateInfo, RepoAccess, ReviewSession, SessionInfo,
} from '../../../shared/types.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch { /* non-JSON body */ }
    throw new ApiError(msg, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Required by the server on the review routes: a request from another website cannot carry it. */
const LOCAL = { 'X-Github-Board': '1' };

/** Limits the number of concurrent requests (PR details: 4 GitHub calls each). */
function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
const detailsLimit = limiter(4);

export const api = {
  /** Current session, or null when logged out. */
  async getSession(): Promise<SessionInfo | null> {
    try {
      return await request<SessionInfo>('/session');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  login: (token: string) => request<SessionInfo>('/session', { method: 'POST', body: JSON.stringify({ token }) }),
  logout: () => request<void>('/session', { method: 'DELETE' }),
  getState: () => request<AppState>('/state'),
  saveState: (state: AppState) => request<void>('/state', { method: 'PUT', body: JSON.stringify(state) }),
  repoAccess: () => request<RepoAccess[]>('/repos/access'),
  rate: () => request<RateInfo>('/rate'),
  /** The user's own PRs waiting for an action from them. */
  actions: () => request<MyAction[]>('/actions'),
  /** Open PRs of the tracked repositories, newest first. */
  pulls: (limit: number) => request<PullList>(`/pulls?${new URLSearchParams({ limit: String(limit) })}`),
  /** Starts a background Claude Code session reviewing `pr` on the server's machine. */
  review: (pr: PullRequest) => request<{ name: string; output: string }>(`/pulls/${pr.owner}/${pr.repo}/${pr.number}/review`, {
    method: 'POST',
    headers: LOCAL,
  }),
  /** Review sessions of the tracked repositories, latest one per PR. */
  reviews: () => request<ReviewSession[]>('/reviews', { headers: LOCAL }),
  /** Final answer of a finished review session. */
  reviewResult: (id: string) => request<{ text: string }>(`/reviews/${encodeURIComponent(id)}/result`, { headers: LOCAL }),
  details: (pr: PullRequest) => detailsLimit(() =>
    request<PrDetails>(`/pulls/${pr.owner}/${pr.repo}/${pr.number}/details?${new URLSearchParams({ updatedAt: pr.updatedAt })}`)),
};
