// Types shared by the frontend and the backend.

export type SortKey = 'updated' | 'created' | 'comments';
export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  /** Refresh interval in seconds (0 = disabled). */
  refresh: number;
  theme: Theme;
  /** Repositories ("owner/repo") whose group is collapsed in the list. */
  collapsed: string[];
}

/** Personal state of a user, persisted by the backend. */
export interface AppState {
  settings: Settings;
}

export interface PullRequest {
  /** "owner/repo#number" */
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  draft: boolean;
  author: { login: string; avatar: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  total: number;
  items: PullRequest[];
}

export type ReviewDecision = 'approved' | 'changes' | 'pending';
export type CiState = 'success' | 'failure' | 'pending' | 'none';

export interface PrDetails {
  additions: number;
  deletions: number;
  changedFiles: number;
  /** GitHub mergeable_state: "dirty" means merge conflicts, "unknown" means not computed yet. */
  mergeableState: string;
  review: ReviewDecision;
  /** Reviewers whose latest review is an approval. */
  approvals: number;
  /** Combined CI state of the head commit (check runs + commit statuses). */
  ci: CiState;
}

/** Status of a PR in the list, from most to least blocking. */
export type PrStatus = 'ci-failed' | 'draft' | 'conflict' | 'changes' | 'approved' | 'pending';

export interface RepoAccess {
  repo: string;
  ok: boolean;
  private?: boolean;
  status?: number;
  error?: string;
}

export interface RateBucket {
  remaining: number;
  limit: number;
  reset: number;
}

export interface RateInfo {
  core: RateBucket | null;
  search: RateBucket | null;
}

export interface SessionInfo {
  user: { login: string; avatarUrl: string };
  /** Token provided by the GITHUB_TOKEN environment variable (no logout possible). */
  envToken: boolean;
}
