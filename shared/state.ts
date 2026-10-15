// Logique pure de l'état personnel (valeurs par défaut, migration, métadonnées PR).
import { REPOS, reposQuery } from './config.ts';
import type { AppState, Board, PrMeta, PullRequest } from './types.ts';

export const REPOS_BOARD_ID = 'repos';
const REPO_COLORS = ['#0969da', '#8957e5', '#1a7f37', '#bf3989', '#9a6700', '#cf222e'];

export const uid = (): string => Math.random().toString(36).slice(2, 10);

/** Tableau des dépôts suivis (shared/config.ts) : PRs à relire, puis une colonne par dépôt. */
export function reposBoard(repos: readonly string[] = REPOS): Board {
  return {
    id: REPOS_BOARD_ID,
    name: 'Dépôts',
    columns: [
      { id: uid(), name: 'À relire', query: `is:open review-requested:@me ${reposQuery(repos)}`, color: '#cf222e', sort: 'updated', limit: 30, notify: true },
      ...repos.map((repo, i) => ({
        id: uid(), name: repo.split('/')[1] ?? repo, query: `is:open ${reposQuery([repo])}`,
        color: REPO_COLORS[i % REPO_COLORS.length]!, sort: 'updated' as const, limit: 30, notify: false,
      })),
    ],
  };
}

export function defaultBoards(): Board[] {
  return [
    reposBoard(),
    {
      id: uid(),
      name: 'Mon travail',
      columns: [
        { id: uid(), name: 'À relire', query: 'is:open review-requested:@me archived:false', color: '#cf222e', sort: 'updated', limit: 30, notify: true },
        { id: uid(), name: 'Mes PRs ouvertes', query: 'is:open author:@me archived:false', color: '#8957e5', sort: 'updated', limit: 30, notify: false },
        { id: uid(), name: 'Assignées', query: 'is:open assignee:@me archived:false', color: '#0969da', sort: 'updated', limit: 30, notify: false },
        { id: uid(), name: 'Mergées récemment', query: 'is:merged author:@me', color: '#1a7f37', sort: 'updated', limit: 15, notify: false },
      ],
    },
    {
      id: uid(),
      name: 'Veille',
      columns: [
        { id: uid(), name: 'Mentionné', query: 'is:open mentions:@me archived:false', color: '#9a6700', sort: 'updated', limit: 30, notify: false },
        { id: uid(), name: 'Déjà relues', query: 'is:open reviewed-by:@me -author:@me archived:false', color: '#656d76', sort: 'updated', limit: 30, notify: false },
      ],
    },
  ];
}

export function defaultState(): AppState {
  const boards = defaultBoards();
  return {
    boards,
    activeBoard: boards[0]!.id,
    settings: { refresh: 300, theme: 'auto', details: true, compact: false },
    prs: {},
    seen: {},
    reposSeeded: true,
  };
}

/**
 * Fusionne des données sauvegardées (éventuellement anciennes ou importées) avec les valeurs par défaut.
 * Le tableau des dépôts est ajouté une seule fois aux anciennes configurations (s'il est supprimé ensuite, il ne revient pas).
 */
export function migrate(data: Partial<AppState>): AppState {
  const base = defaultState();
  const next: AppState = { ...base, ...data, settings: { ...base.settings, ...data.settings } };
  if (!Array.isArray(next.boards) || !next.boards.length) next.boards = base.boards;
  if (!data.reposSeeded) {
    if (!next.boards.some((b) => b.id === REPOS_BOARD_ID)) next.boards = [reposBoard(), ...next.boards];
    next.reposSeeded = true;
  }
  if (!next.boards.some((b) => b.id === next.activeBoard)) next.activeBoard = next.boards[0]!.id;
  return next;
}

/** Applique un patch aux métadonnées d'une PR en supprimant les champs vides. */
export function patchPrMeta(prs: Record<string, PrMeta>, key: string, patch: Partial<PrMeta>): Record<string, PrMeta> {
  const merged: Record<string, unknown> = { ...prs[key], ...patch };
  for (const [k, v] of Object.entries(merged)) {
    if (v === '' || v === false || v == null || (Array.isArray(v) && !v.length)) delete merged[k];
  }
  const next = { ...prs };
  if (Object.keys(merged).length) next[key] = merged as PrMeta;
  else delete next[key];
  return next;
}

export function isSnoozed(meta: PrMeta, now = Date.now()): boolean {
  return !!meta.snoozeUntil && new Date(meta.snoozeUntil).getTime() > now;
}

/** Filtre texte : chaque terme doit correspondre ; `#x` cible tags perso et labels. */
export function matchesFilter(pr: PullRequest, meta: PrMeta, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  return f.split(/\s+/).every((term) => {
    if (term.startsWith('#') && term.length > 1) {
      const t = term.slice(1);
      return (meta.tags ?? []).some((x) => x.toLowerCase().includes(t)) || pr.labels.some((l) => l.name.toLowerCase().includes(t));
    }
    const hay = `${pr.title} ${pr.owner}/${pr.repo} ${pr.author?.login ?? ''} ${pr.labels.map((l) => l.name).join(' ')} ${(meta.tags ?? []).join(' ')} ${meta.note ?? ''}`.toLowerCase();
    return hay.includes(term);
  });
}

const PRIO = { high: 0, medium: 1, low: 2 } as const;

/** PRs visibles d'une colonne, triées : épinglées, puis priorité, puis ordre GitHub. */
export function visiblePrs(
  items: PullRequest[], prs: Record<string, PrMeta>, filter: string, showHidden: boolean, now = Date.now(),
): { pr: PullRequest; meta: PrMeta }[] {
  return items
    .map((pr, idx) => ({ pr, meta: prs[pr.key] ?? {}, idx }))
    .filter(({ pr, meta }) => matchesFilter(pr, meta, filter))
    .filter(({ meta }) => showHidden || (!meta.hidden && !isSnoozed(meta, now)))
    .sort((a, b) =>
      Number(!!b.meta.pinned) - Number(!!a.meta.pinned)
      || (a.meta.priority ? PRIO[a.meta.priority] : 3) - (b.meta.priority ? PRIO[b.meta.priority] : 3)
      || a.idx - b.idx)
    .map(({ pr, meta }) => ({ pr, meta }));
}

/** Déplace la colonne `fromId` à la place de `toId`. */
export function moveColumn(board: Board, fromId: string, toId: string): Board {
  if (fromId === toId) return board;
  const cols = [...board.columns];
  const from = cols.findIndex((c) => c.id === fromId);
  const to = cols.findIndex((c) => c.id === toId);
  if (from < 0 || to < 0) return board;
  const [moved] = cols.splice(from, 1);
  cols.splice(to, 0, moved!);
  return { ...board, columns: cols };
}
