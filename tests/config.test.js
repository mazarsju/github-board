import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPOS, reposQuery } from '../js/config.js';

test('REPOS liste les dépôts DiliTrust suivis', () => {
  assert.deepEqual(REPOS, ['DiliTrust/service-clm', 'DiliTrust/DT_Public_API', 'DiliTrust/webapp-clm']);
  for (const r of REPOS) assert.match(r, /^[\w.-]+\/[\w.-]+$/);
});

test('reposQuery produit un qualificatif repo: par dépôt', () => {
  assert.equal(reposQuery(['a/b', 'c/d']), 'repo:a/b repo:c/d');
  assert.equal(reposQuery(), REPOS.map((r) => `repo:${r}`).join(' '));
});
