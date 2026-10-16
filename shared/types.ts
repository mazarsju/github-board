// Types shared by the frontend and the backend.

export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  /** Refresh interval in seconds (0 = disabled). */
  refresh: number;
  theme: Theme;
  /** Repositories ("owner/repo") whose group is collapsed in the list. */
  collapsed: string[];
  /** Ids of finished review sessions whose synthesis was marked as read. */
  dismissedReviews: string[];
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

/** One of the user's own PRs waiting for an action from them. */
export interface MyAction {
  pr: PullRequest;
  /** REQUIRED_APPROVALS reached: ready to merge. */
  approved: boolean;
  /** Discussions whose last word is someone else's: unresolved review threads, plus the conversation. */
  unanswered: number;
  /** Merge conflict with the base branch. */
  conflict: boolean;
  /** A CI check or commit status of the last commit failed (as the list's "CI FAILED"). */
  ciFailed: boolean;
}

/** A background Claude Code session of this machine whose process still runs (any, not only the board's). */
export interface RunningSession {
  id: string;
  name: string;
  /** Raw state from the CLI (working, waiting, blocked, done…): a finished session keeps its process until stopped. */
  state: string;
  startedAt: number;
}

/** Background Claude Code session started by the "Review" button, latest one per PR. */
export interface ReviewSession {
  /** PR key, "owner/repo#number". */
  key: string;
  /** Id taken by `claude attach`. */
  id: string;
  /** Session name, `review <repo>#<number>`; also accepted by `claude attach`. */
  name: string;
  running: boolean;
  /** Raw state from the CLI (working, waiting, done, failed…). */
  state: string;
  startedAt: number;
}

export type FindingSeverity = 'critical' | 'major' | 'minor' | 'nit';

/** A finding of the `/pr-review` skill (its `findings.json`), most severe first. */
export interface ReviewFinding {
  id: number;
  severity: FindingSeverity;
  /** Repo-relative path. */
  file: string;
  /** Line in the PR head version, and the first line of a multi-line range. */
  line: number | null;
  startLine: number | null;
  title: string;
  /** The review comment, Markdown. */
  body: string;
  /** Exact replacement code for the lines, when the fix is that local. */
  suggestion: string | null;
  /** Plain-words explanation of the problem for the user, in French; never posted. */
  easySummary: string | null;
  /** What was decided, from the app or `/pick-change`: posted on GitHub (see `url`) or dropped. */
  decision: 'posted' | 'dropped' | null;
  url: string | null;
  /** Rewritten at the user's request. */
  edited: boolean;
  /** A Claude session is rewriting it. */
  editing: boolean;
  /** Why the last edit could not be applied. */
  editError: string | null;
  /** The commented lines and their surroundings at the reviewed commit, when available. */
  code?: CodeExcerpt | null;
}

/** Consecutive lines of a file, the first one being line `start`. */
export interface CodeExcerpt {
  start: number;
  lines: string[];
}

/** Where a finding is posted: inline on its lines, on its file (lines outside the diff), or on the PR. */
export type FindingPlacement = 'inline' | 'file' | 'pr';

/** What a finished review session produced. */
export interface ReviewResult {
  /** Last answer of the session (Markdown), or null. */
  text: string | null;
  /** Findings saved by the skill during this session, or null when it saved none. */
  findings: ReviewFinding[] | null;
  /** Head commit the findings refer to, when known. */
  head: string | null;
  /** Jira tickets the review read and used as context. */
  jiraTickets: JiraTicket[];
}

/** A Jira ticket, e.g. `{ key: 'CLM-4638', url: 'https://dilitrust.atlassian.net/browse/CLM-4638' }`. */
export interface JiraTicket {
  key: string;
  url: string;
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
