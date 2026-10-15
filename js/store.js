// État persistant de l'application (localStorage, propre à ce navigateur).
import { REPOS, reposQuery } from './config.js';

const KEY = 'github-board:v1';
export const REPOS_BOARD_ID = 'repos';
const REPO_COLORS = ['#0969da', '#8957e5', '#1a7f37', '#bf3989', '#9a6700', '#cf222e'];

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Tableau des dépôts suivis (js/config.js) : toutes les PRs ouvertes, puis une colonne par dépôt. */
export function reposBoard(repos = REPOS) {
  return {
    id: REPOS_BOARD_ID,
    name: 'Dépôts',
    columns: [
      { id: uid(), name: 'À relire', query: `is:open review-requested:@me ${reposQuery(repos)}`, color: '#cf222e', sort: 'updated', limit: 30, notify: true },
      ...repos.map((repo, i) => ({
        id: uid(), name: repo.split('/')[1], query: `is:open ${reposQuery([repo])}`,
        color: REPO_COLORS[i % REPO_COLORS.length], sort: 'updated', limit: 30, notify: false,
      })),
    ],
  };
}

export function defaultBoards() {
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

function defaults() {
  const boards = defaultBoards();
  return {
    token: '',
    settings: { refresh: 300, theme: 'auto', details: true, compact: false },
    boards,
    activeBoard: boards[0].id,
    prs: {},  // clé "owner/repo#n" → { pinned, hidden, snoozeUntil, note, tags, priority }
    seen: {}, // id colonne → clés déjà vues (détection des nouveautés)
    reposSeeded: true, // tableau des dépôts suivis déjà ajouté (cf. migrate)
  };
}

/** Fusionne des données sauvegardées avec les valeurs par défaut. */
export function migrate(data) {
  const base = defaults();
  const next = { ...base, ...data, settings: { ...base.settings, ...data.settings } };
  // Configurations antérieures au tableau des dépôts : on l'ajoute une seule fois
  // (s'il est supprimé ensuite, il ne revient pas).
  if (!data.reposSeeded) {
    if (!next.boards.some((b) => b.id === REPOS_BOARD_ID)) next.boards = [reposBoard(), ...next.boards];
    next.reposSeeded = true;
  }
  return next;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return migrate(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

export const state = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Sauvegarde impossible', e);
  }
}

export function activeBoard() {
  return state.boards.find((b) => b.id === state.activeBoard) || state.boards[0];
}

export function prMeta(key) {
  return state.prs[key] || {};
}

export function setPrMeta(key, patch) {
  const next = { ...prMeta(key), ...patch };
  // Nettoyage des champs vides pour garder le stockage léger.
  for (const k of Object.keys(next)) {
    const v = next[k];
    if (v === '' || v === false || v == null || (Array.isArray(v) && !v.length)) delete next[k];
  }
  if (Object.keys(next).length) state.prs[key] = next;
  else delete state.prs[key];
  save();
}

export function isSnoozed(meta) {
  return !!meta.snoozeUntil && new Date(meta.snoozeUntil).getTime() > Date.now();
}

export function exportConfig() {
  const { token, seen, ...rest } = state;
  return JSON.stringify({ version: 1, ...rest }, null, 2);
}

export function importConfig(json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data.boards) || !data.boards.length) throw new Error('Fichier invalide : aucun tableau.');
  state.boards = data.boards;
  state.activeBoard = data.activeBoard && data.boards.some((b) => b.id === data.activeBoard) ? data.activeBoard : data.boards[0].id;
  if (data.settings) state.settings = { ...state.settings, ...data.settings };
  if (data.prs) state.prs = data.prs;
  save();
}

export function resetConfig() {
  const token = state.token;
  Object.assign(state, defaults(), { token });
  save();
}
