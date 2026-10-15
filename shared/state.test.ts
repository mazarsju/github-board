import { describe, expect, test } from 'vitest';
import { REPOS, reposQuery } from './config.ts';
import {
  defaultState, isSnoozed, matchesFilter, migrate, moveColumn, patchPrMeta, reposBoard, REPOS_BOARD_ID, visiblePrs,
} from './state.ts';
import type { Board, PullRequest } from './types.ts';

const pr = (n: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  key: `DiliTrust/service-clm#${n}`, id: n, owner: 'DiliTrust', repo: 'service-clm', number: n,
  title: `PR ${n}`, url: '', state: 'open', draft: false, author: { login: 'alice', avatar: '' },
  labels: [], comments: 0, createdAt: '', updatedAt: '', ...extra,
});

describe('config', () => {
  test('REPOS liste les dépôts DiliTrust suivis', () => {
    expect(REPOS).toEqual(['DiliTrust/service-clm', 'DiliTrust/DT_Public_API', 'DiliTrust/webapp-clm']);
  });

  test('reposQuery produit un qualificatif repo: par dépôt', () => {
    expect(reposQuery(['a/b', 'c/d'])).toBe('repo:a/b repo:c/d');
  });
});

describe('état par défaut et migration', () => {
  test('le tableau des dépôts est le premier tableau par défaut', () => {
    const s = defaultState();
    expect(s.boards[0]!.id).toBe(REPOS_BOARD_ID);
    expect(s.activeBoard).toBe(REPOS_BOARD_ID);
  });

  test('reposBoard : une colonne « à relire » puis une colonne par dépôt', () => {
    const board = reposBoard();
    expect(board.columns).toHaveLength(REPOS.length + 1);
    for (const r of REPOS) expect(board.columns[0]!.query).toContain(`repo:${r}`);
    REPOS.forEach((r, i) => {
      expect(board.columns[i + 1]).toMatchObject({ query: `is:open repo:${r}`, name: r.split('/')[1] });
    });
  });

  test('migrate ajoute le tableau des dépôts aux anciennes configurations', () => {
    const data = migrate({ boards: [{ id: 'x', name: 'Mon travail', columns: [] }], activeBoard: 'x' });
    expect(data.boards.map((b) => b.id)).toEqual([REPOS_BOARD_ID, 'x']);
    expect(data.activeBoard).toBe('x');
    expect(data.reposSeeded).toBe(true);
  });

  test('migrate ne recrée pas un tableau des dépôts supprimé', () => {
    const data = migrate({ boards: [{ id: 'x', name: 'A', columns: [] }], reposSeeded: true });
    expect(data.boards.map((b) => b.id)).toEqual(['x']);
  });

  test('migrate complète les paramètres et corrige le tableau actif', () => {
    const data = migrate({ boards: [{ id: 'x', name: 'A', columns: [] }], reposSeeded: true, activeBoard: 'gone', settings: { theme: 'dark' } as never });
    expect(data.settings).toMatchObject({ theme: 'dark', refresh: 300 });
    expect(data.activeBoard).toBe('x');
  });

  test('migrate sur un utilisateur vierge renvoie l’état par défaut', () => {
    expect(migrate({}).boards.map((b) => b.name)).toEqual(['Dépôts', 'Mon travail', 'Veille']);
  });
});

describe('métadonnées PR', () => {
  test('patchPrMeta fusionne et retire les champs vides', () => {
    let prs = patchPrMeta({}, 'k', { pinned: true, note: 'n' });
    expect(prs).toEqual({ k: { pinned: true, note: 'n' } });
    prs = patchPrMeta(prs, 'k', { note: '', tags: [] });
    expect(prs).toEqual({ k: { pinned: true } });
    prs = patchPrMeta(prs, 'k', { pinned: false });
    expect(prs).toEqual({});
  });

  test('isSnoozed compare à la date courante', () => {
    expect(isSnoozed({ snoozeUntil: '2030-01-01T00:00:00Z' }, Date.parse('2029-01-01'))).toBe(true);
    expect(isSnoozed({ snoozeUntil: '2030-01-01T00:00:00Z' }, Date.parse('2031-01-01'))).toBe(false);
    expect(isSnoozed({})).toBe(false);
  });
});

describe('filtre et tri', () => {
  test('matchesFilter : texte, repo, auteur, #tag et labels', () => {
    const p = pr(1, { title: 'Fix login', labels: [{ name: 'urgent', color: 'ff0000' }] });
    expect(matchesFilter(p, {}, 'login')).toBe(true);
    expect(matchesFilter(p, {}, 'service-clm alice')).toBe(true);
    expect(matchesFilter(p, {}, '#urg')).toBe(true);
    expect(matchesFilter(p, { tags: ['perso'] }, '#perso')).toBe(true);
    expect(matchesFilter(p, {}, 'logout')).toBe(false);
  });

  test('visiblePrs masque hidden/snooze et trie épinglées puis priorité', () => {
    const items = [pr(1), pr(2), pr(3), pr(4), pr(5)];
    const prs = {
      [items[0]!.key]: { hidden: true },
      [items[1]!.key]: { priority: 'low' as const },
      [items[2]!.key]: { priority: 'high' as const },
      [items[3]!.key]: { pinned: true },
      [items[4]!.key]: { snoozeUntil: '2999-01-01T00:00:00Z' },
    };
    expect(visiblePrs(items, prs, '', false).map((x) => x.pr.number)).toEqual([4, 3, 2]);
    expect(visiblePrs(items, prs, '', true)).toHaveLength(5);
  });

  test('moveColumn déplace une colonne à la place de la cible', () => {
    const col = (id: string) => ({ id, name: id, query: '', color: '', sort: 'updated' as const, limit: 30, notify: false });
    const board: Board = { id: 'b', name: 'B', columns: [col('a'), col('b'), col('c')] };
    expect(moveColumn(board, 'c', 'a').columns.map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(moveColumn(board, 'a', 'c').columns.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(moveColumn(board, 'a', 'a')).toBe(board);
  });
});
