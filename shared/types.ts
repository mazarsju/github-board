// Types shared by the frontend and the backend.

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
  /** Branch the PR merges into. */
  baseRef: string;
  /** Branch of the PR, or null when it lives in a fork (it cannot be the base of another PR here). */
  headRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PullList {
  /** Number of open PRs across the tracked repositories (items may be truncated). */
  total: number;
  /** Newest first. */
  items: PullRequest[];
}

/** A PR placed in the list: depth 0 for a stack root or a standalone PR, then 1, 2… along the stack. */
export interface StackedPr {
  pr: PullRequest;
  depth: number;
  /** Number of PRs in the stack, on the root row only (1 for a standalone PR). */
  stackSize?: number;
  /** PR this one is stacked on (its base branch is that PR's branch). */
  parent?: PullRequest;
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
}

export interface SessionInfo {
  user: { login: string; avatarUrl: string };
  /** Token provided by the GITHUB_TOKEN environment variable (no logout possible). */
  envToken: boolean;
}
