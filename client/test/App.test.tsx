import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defaultState } from '../../shared/state.ts';
import type { AppState, MyAction, PrDetails, PullRequest, ReviewSession } from '../../shared/types.ts';
import { App } from '../src/App.tsx';
import { ToastProvider } from '../src/components/Toast.tsx';

const SESSION = { user: { login: 'alice', avatarUrl: 'https://avatar' }, envToken: false };

const pr = (repo: string, n: number, title: string, extra: Partial<PullRequest> = {}): PullRequest => ({
  key: `DiliTrust/${repo}#${n}`, owner: 'DiliTrust', repo, number: n, title,
  url: `https://github.com/DiliTrust/${repo}/pull/${n}`, draft: false,
  author: { login: 'bob', avatar: 'https://a?v=4' }, baseRef: 'develop', headRef: `${repo}-${n}`,
  createdAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-15T10:00:00Z', ...extra,
});

/** Open PRs of the tracked repositories: one for each status of the list. */
const PRS = [
  pr('service-clm', 1, 'PR de service-clm'),
  pr('DT_Public_API', 1, 'PR de DT_Public_API'),
  pr('webapp-clm', 1, 'PR de webapp-clm', { author: { login: 'carol', avatar: 'https://c?v=4' } }),
  // Stacked on service-clm#1: its base branch is that PR's branch.
  pr('service-clm', 2, 'Refonte service', { createdAt: '2026-10-01T10:00:00Z', baseRef: 'service-clm-1' }),
  pr('webapp-clm', 2, 'Brouillon webapp', { draft: true }),
  pr('DT_Public_API', 2, 'CI cassée', { draft: true }),
];

const DETAILS: PrDetails = { additions: 5, deletions: 2, changedFiles: 1, mergeableState: 'clean', review: 'approved', approvals: 2, ci: 'success' };

/** Details per "repo#number" overriding DETAILS. */
const DETAILS_BY_PR: Record<string, Partial<PrDetails>> = {
  'service-clm#1': { mergeableState: 'dirty' },
  'service-clm#2': { review: 'changes', approvals: 1, additions: 120, deletions: 40 },
  'webapp-clm#1': { approvals: 1, ci: 'pending' },
  'DT_Public_API#2': { ci: 'failure', mergeableState: 'dirty' },
};

let loggedIn: boolean;
let saved: AppState[];
let initialState: AppState;
let actions: MyAction[];
let reviews: ReviewSession[];

const session = (key: string, id: string, running: boolean): ReviewSession => ({
  key, id, name: `review ${key.split('/')[1]}`, running, state: running ? 'working' : 'done', startedAt: 1,
});

/** Mocked backend: the /api routes used by the app. */
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
      case '/api/state': return method === 'PUT' ? (saved.push(JSON.parse(String(init.body))), json(204)) : json(200, initialState);
      case '/api/rate': return json(200, { core: { remaining: 10, limit: 5000, reset: 0 }, search: null });
      case '/api/repos/access': return json(200, [
        { repo: 'DiliTrust/service-clm', ok: true },
        { repo: 'DiliTrust/webapp-clm', ok: false, status: 404, error: 'Not Found' },
      ]);
      case '/api/pulls': return json(200, { total: PRS.length, items: PRS });
      case '/api/actions': return json(200, actions);
      case '/api/pulls/DiliTrust/service-clm/2/review':
        if (init.method !== 'POST' || new Headers(init.headers).get('X-Github-Board') !== '1') return json(403, { error: 'Refusé' });
        reviews = [session('DiliTrust/service-clm#2', 'started', true)];
        return json(200, { name: 'review service-clm#2', output: 'abc' });
      case '/api/reviews': return json(200, reviews);
      case '/api/reviews/r2/result': return json(200, { text: '## Verdict\n\n**Rien de bloquant.**\n\n- Deux remarques [mineures](https://example.com/n)\n\n<img src=x onerror="alert(1)">', head: 'abc1234', findings: [
        { id: 2, severity: 'minor', file: 'src/a b.ts', line: 12, startLine: 10, title: 'Erreur avalée', body: 'Le `catch` ignore **tout**.', suggestion: 'throw err;' },
        { id: 1, severity: 'critical', file: 'src/db.ts', line: 3, startLine: null, title: 'Injection SQL', body: 'Requête concaténée.', suggestion: null },
      ] });
      case '/api/pulls/DiliTrust/webapp-clm/1/review': return json(500, { error: 'Lancement de Claude impossible : Not logged in' });
      default: {
        const m = /^\/api\/pulls\/DiliTrust\/([\w-]+)\/(\d+)\/details$/.exec(url.pathname);
        if (m) return json(200, { ...DETAILS, ...DETAILS_BY_PR[`${m[1]}#${m[2]}`] });
        return json(404, { error: 'Route inconnue' });
      }
    }
  }));
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><App /></ToastProvider></QueryClientProvider>);
}

const row = async (title: string) => {
  const list = await screen.findByRole('region', { name: 'Liste des PRs' });
  return (await within(list).findByRole('link', { name: title })).closest('tr')!;
};

beforeEach(() => { loggedIn = false; saved = []; initialState = defaultState(); actions = []; reviews = []; mockBackend(); });
afterEach(() => { vi.unstubAllGlobals(); });

test('logs in, then shows the PR list and the inaccessible repositories', async () => {
  const user = userEvent.setup();
  renderApp();

  await user.type(await screen.findByLabelText('Personal Access Token GitHub'), 'nope');
  await user.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByText(/Échec de connexion : Bad credentials/)).toBeInTheDocument();

  await user.clear(screen.getByLabelText('Personal Access Token GitHub'));
  await user.type(screen.getByLabelText('Personal Access Token GitHub'), 'good');
  await user.click(screen.getByRole('button', { name: 'Se connecter' }));

  expect(await screen.findByRole('link', { name: 'PR de service-clm' })).toHaveAttribute('href', 'https://github.com/DiliTrust/service-clm/pull/1');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('DiliTrust/webapp-clm');
  expect(alert).not.toHaveTextContent('DiliTrust/service-clm');
});

test('one row per open PR with author, approvals, status and size', async () => {
  loggedIn = true;
  renderApp();

  const conflict = await row('PR de service-clm');
  expect(within(conflict).getByText('#1')).toBeInTheDocument();
  expect(within(conflict).getByText('bob')).toBeInTheDocument();
  expect(await within(conflict).findByText('Conflit')).toBeInTheDocument();
  expect(within(conflict).getByText('2/2')).toBeInTheDocument();
  expect(within(conflict).getByText('+5')).toBeInTheDocument();
  expect(within(conflict).getByText('−2')).toBeInTheDocument();

  expect(await within(await row('PR de DT_Public_API')).findByText('Approuvée')).toBeInTheDocument();
  const waiting = await row('PR de webapp-clm');
  expect(within(waiting).getByText('carol')).toBeInTheDocument();
  expect(await within(waiting).findByText('Review en attente')).toBeInTheDocument();
  expect(within(waiting).getByText('1/2')).toBeInTheDocument();
  const changes = await row('Refonte service');
  expect(await within(changes).findByText('Changements demandés')).toBeInTheDocument();
  expect(within(changes).getByText('+120')).toBeInTheDocument();
  expect(await within(await row('Brouillon webapp')).findByText('Draft')).toBeInTheDocument();
  // A failed CI wins even over draft and conflict.
  expect(await within(await row('CI cassée')).findByText('CI FAILED')).toBeInTheDocument();

  // Header row + 3 project rows + 6 PRs.
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(10);
  expect(screen.getByText('6 PR(s) ouverte(s)')).toBeInTheDocument();
});

test('PRs are grouped under one separator per project, in the configured order', async () => {
  loggedIn = true;
  renderApp();

  await row('Refonte service');
  const groups = screen.getAllByRole('rowgroup').slice(1); // first one is the column headers
  expect(groups.map((g) => within(g).getAllByRole('button')[0]!.textContent)).toEqual(['▾service-clm · 2', '▾DT_Public_API · 2', '▾webapp-clm · 2']);
  const titles = (g: HTMLElement) => within(g).getAllByRole('link').map((a) => a.textContent);
  expect(titles(groups[0]!)).toEqual(['PR de service-clm', 'Refonte service']);
  expect(titles(groups[1]!)).toEqual(['PR de DT_Public_API', 'CI cassée']);
  expect(titles(groups[2]!)).toEqual(['PR de webapp-clm', 'Brouillon webapp']);
});

test('a stacked PR is listed right under the PR it builds on, indented', async () => {
  loggedIn = true;
  renderApp();

  const root = await row('PR de service-clm');
  const child = await row('Refonte service');
  expect(root.nextElementSibling).toBe(child);
  expect(within(root).getByText('stack · 2')).toBeInTheDocument();
  expect(within(child).getByTitle('Empilée sur #1 (service-clm-1)')).toHaveTextContent('↳');
  expect(root).toHaveClass('in-stack');
  expect(root).not.toHaveClass('stack-end');
  expect(child).toHaveClass('in-stack', 'stack-end'); // last PR of the stack: shorter bar
  expect(within(child).getAllByRole('cell')[0]).toHaveClass('stacked');

  const standalone = await row('PR de DT_Public_API');
  expect(standalone).not.toHaveClass('in-stack');
  expect(within(standalone).queryByText(/stack ·/)).not.toBeInTheDocument();
});

test('a project group collapses and expands, and the choice is saved', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  renderApp();

  await row('Brouillon webapp');
  const toggle = screen.getByRole('button', { name: /webapp-clm · 2/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('link', { name: 'Brouillon webapp' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'PR de webapp-clm' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Refonte service' })).toBeInTheDocument(); // other projects untouched
  expect(toggle).toHaveTextContent('webapp-clm · 2'); // the count stays visible
  await waitFor(() => expect(saved.at(-1)?.settings.collapsed).toEqual(['DiliTrust/webapp-clm']));

  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByRole('link', { name: 'Brouillon webapp' })).toBeInTheDocument();
  await waitFor(() => expect(saved.at(-1)?.settings.collapsed).toEqual([]));
});

test('a group saved as collapsed starts collapsed and does not load its PR details', async () => {
  loggedIn = true;
  initialState = { settings: { ...defaultState().settings, collapsed: ['DiliTrust/service-clm'] } };
  renderApp();

  await row('PR de DT_Public_API');
  expect(screen.getByRole('button', { name: /service-clm · 2/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('link', { name: 'Refonte service' })).not.toBeInTheDocument();
  const calls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
  expect(calls.some((u) => u.includes('/pulls/DiliTrust/service-clm/'))).toBe(false);
  expect(calls.some((u) => u.includes('/pulls/DiliTrust/DT_Public_API/'))).toBe(true);
});

test('"Actions pour moi" lists the user\'s PRs to merge or with unanswered comments, above the list', async () => {
  loggedIn = true;
  actions = [
    { pr: PRS[1]!, approved: true, unanswered: 0 },
    { pr: PRS[2]!, approved: false, unanswered: 3 },
  ];
  renderApp();

  const section = await screen.findByRole('region', { name: 'Actions pour moi' });
  expect(within(section).getByRole('heading')).toHaveTextContent('Actions pour moi 2');
  const toMerge = within(section).getByRole('link', { name: 'PR de DT_Public_API' }).closest('tr')!;
  expect(within(toMerge).getByText('DT_Public_API')).toBeInTheDocument(); // project before the title
  expect(within(toMerge).getByText('À merger')).toBeInTheDocument();
  expect(await within(toMerge).findByText('Approuvée')).toBeInTheDocument();
  const toAnswer = within(section).getByRole('link', { name: 'PR de webapp-clm' }).closest('tr')!;
  expect(within(toAnswer).getByText('3 commentaire(s) sans réponse')).toBeInTheDocument();
  expect(within(toAnswer).queryByText('carol')).not.toBeInTheDocument(); // the action replaces the author

  // Shown before the PR list, which still lists the same PRs in their project.
  const list = screen.getByRole('region', { name: 'Liste des PRs' });
  expect(list.firstElementChild).toBe(section);
  expect(screen.getAllByRole('link', { name: 'PR de DT_Public_API' })).toHaveLength(2);
});

test('"Actions pour moi" is a quiet line when nothing waits, and follows the filter', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  actions = [{ pr: PRS[1]!, approved: true, unanswered: 0 }];
  renderApp();

  await screen.findByRole('region', { name: 'Actions pour moi' });
  await user.type(screen.getByLabelText('Filtrer'), 'webapp');
  expect(screen.queryByRole('region', { name: 'Actions pour moi' })).not.toBeInTheDocument();
  expect(screen.getByText('Actions pour moi : rien en attente ✓')).toBeInTheDocument();
});

test('the "Review" button of a list row starts a background Claude session', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  actions = [{ pr: PRS[1]!, approved: true, unanswered: 0 }];
  renderApp();

  await user.click(within(await row('Refonte service')).getByRole('button', { name: 'Review avec Claude : service-clm#2' }));
  expect(await screen.findByText('Session Claude lancée en arrière-plan. Pour la suivre : claude attach "review service-clm#2"')).toBeInTheDocument();
  // The sessions are checked again at once: the row now shows the running session.
  expect(await within(await row('Refonte service')).findByRole('button', { name: 'Review en cours : ouvrir la session' })).toBeInTheDocument();

  await user.click(within(await row('PR de webapp-clm')).getByRole('button', { name: /Review avec Claude/ }));
  expect(await screen.findByText('Lancement de Claude impossible : Not logged in')).toBeInTheDocument();

  // Only in the project list, not in "Actions pour moi".
  const section = screen.getByRole('region', { name: 'Actions pour moi' });
  expect(within(section).queryByRole('button', { name: /Review avec Claude/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Review avec Claude/ })).toHaveLength(PRS.length - 1); // one is running
});

test('a running review replaces the Review button with one telling how to open the session', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  reviews = [session('DiliTrust/service-clm#2', 'r1', true)];
  renderApp();

  const running = await within(await row('Refonte service')).findByRole('button', { name: 'Review en cours : ouvrir la session' });
  expect(within(await row('Refonte service')).queryByRole('button', { name: /Review avec Claude/ })).not.toBeInTheDocument();
  await user.click(running);
  const dialog = await screen.findByRole('dialog', { name: 'Review en cours' });
  expect(within(dialog).getByText('claude attach "review service-clm#2"')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Copier' })).toBeInTheDocument();
  // Running sessions are not in "Actions pour moi" yet.
  expect(screen.queryByRole('button', { name: 'Synthèse review' })).not.toBeInTheDocument();
});

test('a finished review shows its synthesis in "Actions pour moi" until marked as read', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  reviews = [session('DiliTrust/DT_Public_API#1', 'r2', false)];
  renderApp();

  const section = await screen.findByRole('region', { name: 'Actions pour moi' });
  const entry = within(section).getByRole('link', { name: 'PR de DT_Public_API' }).closest('tr')!;
  await user.click(within(entry).getByRole('button', { name: 'Synthèse review' }));
  const dialog = await screen.findByRole('dialog', { name: 'Synthèse review' });
  // Rendered as Markdown; raw HTML is not.
  expect(await within(dialog).findByRole('heading', { name: 'Verdict' })).toBeInTheDocument();
  expect(within(dialog).getByText('Rien de bloquant.').tagName).toBe('STRONG');
  expect(within(dialog).getByRole('listitem')).toHaveTextContent('Deux remarques mineures');
  expect(within(dialog).getByRole('link', { name: 'mineures' })).toHaveAttribute('target', '_blank');
  expect(dialog.querySelector('img')).toBeNull();
  expect(within(dialog).getByText('claude attach r2')).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'Marquer comme lue' }));
  expect(screen.queryByRole('dialog', { name: 'Synthèse review' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Actions pour moi' })).not.toBeInTheDocument();
  expect(screen.getByText('Actions pour moi : rien en attente ✓')).toBeInTheDocument();
  await waitFor(() => expect(saved.at(-1)?.settings.dismissedReviews).toEqual(['r2']));
  // The PR can be reviewed again.
  expect(within(await row('PR de DT_Public_API')).getByRole('button', { name: /Review avec Claude/ })).toBeInTheDocument();
});

test('the findings of a finished review are stacked under it and open their detail', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  reviews = [session('DiliTrust/DT_Public_API#1', 'r2', false)];
  renderApp();

  const section = await screen.findByRole('region', { name: 'Actions pour moi' });
  const entry = within(section).getByRole('link', { name: 'PR de DT_Public_API' }).closest('tr')!;
  expect(await within(entry).findByText('1 Critique')).toBeInTheDocument();
  expect(within(entry).getByText('1 Mineur')).toBeInTheDocument();
  // One row per finding, right under the PR, in the skill's order.
  const first = entry.nextElementSibling as HTMLElement;
  expect(first).toHaveTextContent('Erreur avalée');
  expect(first).toHaveTextContent('src/a b.ts:10-12');
  expect(first.nextElementSibling).toHaveTextContent('Injection SQL');

  await user.click(within(first).getByRole('button'));
  const dialog = await screen.findByRole('dialog', { name: 'Erreur avalée' });
  expect(within(dialog).getByText('tout').tagName).toBe('STRONG');
  expect(within(dialog).getByText('throw err;')).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: 'src/a b.ts:10-12' }))
    .toHaveAttribute('href', 'https://github.com/DiliTrust/DT_Public_API/blob/abc1234/src/a%20b.ts#L10-L12');
  expect(within(dialog).getByText(/^\/pick-change /)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('the filter narrows the list', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  renderApp();

  await row('Refonte service');
  await user.type(screen.getByLabelText('Filtrer'), 'carol');
  // Header row + the webapp-clm project row + 1 PR: empty projects are hidden.
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
  expect(screen.getByText('webapp-clm')).toBeInTheDocument();
  expect(screen.queryByText('service-clm')).not.toBeInTheDocument();
  expect(screen.getByText('1 PR(s) ouverte(s) sur 6 (filtre)')).toBeInTheDocument();

  await user.clear(screen.getByLabelText('Filtrer'));
  await user.type(screen.getByLabelText('Filtrer'), 'introuvable');
  expect(screen.getByText('Aucune PR ne correspond au filtre')).toBeInTheDocument();
});

test('settings are saved on the server', async () => {
  loggedIn = true;
  const user = userEvent.setup();
  renderApp();

  await row('PR de service-clm');
  await user.click(screen.getByRole('button', { name: 'Paramètres' }));
  const dialog = await screen.findByRole('dialog', { name: 'Paramètres' });
  await user.selectOptions(within(dialog).getByLabelText('Thème'), 'dark');
  await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(saved.at(-1)).toEqual({ settings: { refresh: 300, theme: 'dark', collapsed: [], dismissedReviews: [] } }));
  expect(document.documentElement.dataset.theme).toBe('dark');
});
