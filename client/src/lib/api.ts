// Client HTTP du backend (/api). Le token GitHub n'est jamais manipulé par le navigateur.
import type {
  AppState, PrDetails, PullRequest, RateInfo, RepoAccess, SearchResult, SessionInfo, SortKey,
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
    } catch { /* corps non JSON */ }
    throw new ApiError(msg, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Limite le nombre de requêtes simultanées (détails PR : ~4 appels GitHub chacune). */
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
  /** Session courante, ou null si non connecté. */
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
  search: (q: string, sort: SortKey, limit: number) =>
    request<SearchResult>(`/search?${new URLSearchParams({ q, sort, limit: String(limit) })}`),
  details: (pr: PullRequest) => detailsLimit(() =>
    request<PrDetails>(`/pulls/${pr.owner}/${pr.repo}/${pr.number}/details?${new URLSearchParams({ updatedAt: pr.updatedAt })}`)),
};
