import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defaultState } from '../../shared/state.ts';
import type { AppState, PullRequest } from '../../shared/types.ts';
import { App } from '../src/App.tsx';
import { ToastProvider } from '../src/components/Toast.tsx';

const SESSION = { user: { login: 'alice', avatarUrl: 'https://avatar' }, envToken: false };

const pr = (repo: string, n: number, title: string): PullRequest => ({
  key: `DiliTrust/${repo}#${n}`, id: n, owner: 'DiliTrust', repo, number: n, title,
  url: `https://github.com/DiliTrust/${repo}/pull/${n}`, state: 'open', draft: false,
  author: { login: 'bob', avatar: 'https://a?v=4' }, labels: [], comments: 0,
  createdAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-15T10:00:00Z',
});

let loggedIn: boolean;
let saved: AppState[];

/** Backend simulé : routes /api utilisées par l'app. */
function mockBackend() {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost');
    const json = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    const method = init.method ?? 'GET';
    if (url.pathname === '/api/session' && method === 'POST') {
      const { token } = JSON.parse(String(init.body));
      if (token !== 'good') return json(401, { error: 'Bad credentials' });
      loggedIn = true;
      return json(200, SESSION);
    }
    if (!loggedIn) return json(401, { error: 'Non connecté' });
    switch (url.pathname) {
      case '/api/session': return json(200, SESSION);
      case '/api/state': return method === 'PUT' ? (saved.push(JSON.parse(String(init.body))), json(204)) : json(200, defaultState());
      case '/api/rate': return json(200, { core: { remaining: 10, limit: 5000, reset: 0 }, search: null });
      case '/api/repos/access': return json(200, [
        { repo: 'DiliTrust/service-clm', ok: true },
        { repo: 'DiliTrust/webapp-clm', ok: false, status: 404, error: 'Not Found' },
      ]);
      case '/api/search': {
        const q = url.searchParams.get('q') ?? '';
        const repo = /repo:DiliTrust\/([\w-]+)$/.exec(q)?.[1];
        const items = repo && q.startsWith('is:open repo:') ? [pr(repo, 1, `PR de ${repo}`)] : [];
        return json(200, { total: items.length, items });
      }
      default:
        if (url.pathname.endsWith('/details')) {
          return json(200, { additions: 5, deletions: 2, changedFiles: 1, merged: false, mergeableState: 'clean', requestedReviewers: [], review: 'approved', ci: 'success' });
        }
        return json(404, { error: 'Route inconnue' });
    }
  }));
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><App /></ToastProvider></QueryClientProvider>);
}

beforeEach(() => { loggedIn = false; saved = []; mockBackend(); });
afterEach(() => { vi.unstubAllGlobals(); });

test('connexion puis affichage du tableau des dépôts suivis', async () => {
  const user = userEvent.setup();
  renderApp();

  await user.type(await screen.findByLabelText('Personal Access Token GitHub'), 'nope');
  await user.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByText(/Échec de connexion : Bad credentials/)).toBeInTheDocument();

  await user.clear(screen.getByLabelText('Personal Access Token GitHub'));
  await user.type(screen.getByLabelText('Personal Access Token GitHub'), 'good');
  await user.click(screen.getByRole('button', { name: 'Se connecter' }));

  expect(await screen.findByRole('button', { name: 'Dépôts' })).toHaveClass('active');
  const column = await screen.findByRole('region', { name: 'service-clm' });
  expect(await within(column).findByRole('link', { name: 'PR de service-clm' })).toHaveAttribute('href', 'https://github.com/DiliTrust/service-clm/pull/1');
  expect(await within(column).findByText('✓ Approuvée')).toBeInTheDocument();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('DiliTrust/webapp-clm');
  expect(alert).not.toHaveTextContent('DiliTrust/service-clm');
});

test('épingler une PR sauvegarde l’état sur le serveur', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  renderApp();

  const column = await screen.findByRole('region', { name: 'DT_Public_API' });
  await within(column).findByText('PR de DT_Public_API');
  await user.click(within(column).getByRole('button', { name: 'Épingler' }));

  await waitFor(() => expect(saved.at(-1)?.prs['DiliTrust/DT_Public_API#1']).toEqual({ pinned: true }));
  expect(within(column).getByRole('button', { name: 'Désépingler' })).toBeInTheDocument();
});

test('le filtre masque les PRs qui ne correspondent pas', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  renderApp();

  const column = await screen.findByRole('region', { name: 'webapp-clm' });
  await within(column).findByText('PR de webapp-clm');
  await user.type(screen.getByLabelText('Filtrer'), 'introuvable');
  expect(within(column).getByText('Tout est filtré ou masqué')).toBeInTheDocument();
});
