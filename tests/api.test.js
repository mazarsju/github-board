import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubAPI, reviewDecision, ciState } from '../js/api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(routes) {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const [status, body] = routes[path] || [404, { message: 'Not Found' }];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

test('checkRepoAccess distingue dépôts lisibles et inaccessibles', async () => {
  mockFetch({
    '/repos/DiliTrust/service-clm': [200, { private: true }],
    '/repos/DiliTrust/webapp-clm': [403, { message: 'Resource protected by organization SAML enforcement.' }],
  });
  const res = await new GitHubAPI('t').checkRepoAccess(['DiliTrust/service-clm', 'DiliTrust/DT_Public_API', 'DiliTrust/webapp-clm']);
  assert.deepEqual(res, [
    { repo: 'DiliTrust/service-clm', ok: true, private: true },
    { repo: 'DiliTrust/DT_Public_API', ok: false, status: 404, error: 'Not Found' },
    { repo: 'DiliTrust/webapp-clm', ok: false, status: 403, error: 'Resource protected by organization SAML enforcement.' },
  ]);
});

test('searchPRs ajoute is:pr et normalise les résultats', async () => {
  let query;
  globalThis.fetch = async (url) => {
    query = new URL(url).searchParams.get('q');
    return new Response(JSON.stringify({
      total_count: 1,
      items: [{ id: 1, number: 7, title: 'T', html_url: 'u', state: 'open', repository_url: 'https://api.github.com/repos/DiliTrust/service-clm', labels: [], comments: 0 }],
    }), { status: 200 });
  };
  const { total, items } = await new GitHubAPI('t').searchPRs('repo:DiliTrust/service-clm');
  assert.equal(query, 'is:pr repo:DiliTrust/service-clm');
  assert.equal(total, 1);
  assert.equal(items[0].key, 'DiliTrust/service-clm#7');
});

test('reviewDecision retient le dernier avis significatif', () => {
  assert.equal(reviewDecision([]), 'pending');
  assert.equal(reviewDecision([{ user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'a' }, state: 'APPROVED' }]), 'approved');
  assert.equal(reviewDecision([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'b' }, state: 'CHANGES_REQUESTED' }]), 'changes');
});

test('ciState combine check-runs et statuts', () => {
  assert.equal(ciState(null, null), 'none');
  assert.equal(ciState({ check_runs: [{ status: 'completed', conclusion: 'success' }] }, null), 'success');
  assert.equal(ciState({ check_runs: [{ status: 'in_progress' }] }, null), 'pending');
  assert.equal(ciState({ check_runs: [{ status: 'completed', conclusion: 'success' }] }, { state: 'error', statuses: [{}] }), 'failure');
});
