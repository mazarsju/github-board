import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPOS } from '../js/config.js';
import { defaultBoards, reposBoard, migrate, REPOS_BOARD_ID } from '../js/store.js';

test('le tableau des dépôts est le premier tableau par défaut', () => {
  const [first] = defaultBoards();
  assert.equal(first.id, REPOS_BOARD_ID);
});

test('reposBoard : une colonne globale puis une colonne par dépôt', () => {
  const board = reposBoard();
  assert.equal(board.columns.length, REPOS.length + 1);
  for (const r of REPOS) assert.match(board.columns[0].query, new RegExp(`repo:${r}\\b`));
  REPOS.forEach((r, i) => {
    const col = board.columns[i + 1];
    assert.equal(col.query, `is:open repo:${r}`);
    assert.equal(col.name, r.split('/')[1]);
  });
});

test('migrate ajoute le tableau des dépôts aux anciennes configurations', () => {
  const old = { boards: [{ id: 'x', name: 'Mon travail', columns: [] }], activeBoard: 'x' };
  const data = migrate(old);
  assert.deepEqual(data.boards.map((b) => b.id), [REPOS_BOARD_ID, 'x']);
  assert.equal(data.activeBoard, 'x');
  assert.equal(data.reposSeeded, true);
});

test('migrate ne recrée pas un tableau des dépôts supprimé', () => {
  const data = migrate({ boards: [{ id: 'x', name: 'A', columns: [] }], reposSeeded: true });
  assert.deepEqual(data.boards.map((b) => b.id), ['x']);
});

test('migrate conserve les paramètres existants', () => {
  const data = migrate({ boards: [], reposSeeded: true, settings: { theme: 'dark' } });
  assert.equal(data.settings.theme, 'dark');
  assert.equal(data.settings.refresh, 300);
});
