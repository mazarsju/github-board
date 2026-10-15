// Types partagés entre le frontend et le backend.

export type SortKey = 'updated' | 'created' | 'comments';
export type Priority = 'high' | 'medium' | 'low';
export type Theme = 'auto' | 'light' | 'dark';

export interface Column {
  id: string;
  name: string;
  /** Requête de recherche GitHub (`is:pr` ajouté automatiquement). */
  query: string;
  color: string;
  sort: SortKey;
  limit: number;
  notify: boolean;
}

export interface Board {
  id: string;
  name: string;
  columns: Column[];
}

export interface Settings {
  /** Intervalle de rafraîchissement en secondes (0 = désactivé). */
  refresh: number;
  theme: Theme;
  details: boolean;
  compact: boolean;
}

/** Organisation personnelle d'une PR (champs vides omis). */
export interface PrMeta {
  pinned?: boolean;
  hidden?: boolean;
  snoozeUntil?: string;
  note?: string;
  tags?: string[];
  priority?: Priority;
}

/** État personnel d'un utilisateur, persisté par le backend. */
export interface AppState {
  boards: Board[];
  activeBoard: string;
  settings: Settings;
  /** Clé "owner/repo#n" → métadonnées perso. */
  prs: Record<string, PrMeta>;
  /** Id colonne → clés déjà vues (détection des nouveautés). */
  seen: Record<string, string[]>;
  /** Tableau des dépôts suivis déjà ajouté (cf. migrate). */
  reposSeeded: boolean;
}

export interface Label {
  name: string;
  color: string;
}

export interface PullRequest {
  key: string;
  id: number;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  author: { login: string; avatar: string } | null;
  labels: Label[];
  comments: number;
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
  merged: boolean;
  mergeableState: string;
  requestedReviewers: string[];
  review: ReviewDecision;
  ci: CiState;
}

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
  /** Token fourni par la variable d'environnement GITHUB_TOKEN (pas de déconnexion possible). */
  envToken: boolean;
}
