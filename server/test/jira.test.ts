import { afterEach, expect, test, vi } from 'vitest';
import { JiraClient, JiraError, mentions } from '../src/jira.ts';

afterEach(() => { vi.unstubAllGlobals(); });

const ME = 'acc-me';
const mention = (id: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi ' }, { type: 'mention', attrs: { id } }] }] });
const issue = (key: string, fields: Record<string, unknown>) => ({
  key, fields: { summary: `Summary ${key}`, status: { name: 'To Do' }, updated: '2026-10-01T10:00:00.000+0200', assignee: null, comment: { comments: [] }, ...fields },
});

function mockJira(issues: unknown[]) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/rest/api/3/myself')) return new Response(JSON.stringify({ accountId: ME, displayName: 'Jane "J" Doe' }));
    if (url.endsWith('/rest/api/3/search/jql')) return new Response(JSON.stringify({ issues }));
    return new Response(JSON.stringify({ errorMessages: ['Not found'] }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('mentions finds a mention of the account anywhere in a comment', () => {
  expect(mentions(mention(ME), ME)).toBe(true);
  expect(mentions(mention('other'), ME)).toBe(false);
  expect(mentions('text', ME)).toBe(false);
});

test('myActions keeps the tickets assigned to, mentioning or commented by the user', async () => {
  const fetch = mockJira([
    issue('A-1', { assignee: { accountId: ME } }),
    issue('A-2', { comment: { comments: [{ author: { accountId: 'other' }, body: mention(ME) }] } }),
    issue('A-3', { comment: { comments: [{ author: { accountId: ME }, body: mention('other') }] } }),
    issue('A-4', { comment: { comments: [{ author: { accountId: 'other' }, body: mention('other') }] } }), // only watched
  ]);
  const actions = await new JiraClient('https://x.atlassian.net/', 'me@x.com', 'tok').myActions();
  expect(actions.map(({ key, assigned, mentioned, commented }) => [key, assigned, mentioned, commented])).toEqual([
    ['A-1', true, false, false],
    ['A-2', false, true, false],
    ['A-3', false, false, true],
  ]);
  expect(actions[0]).toMatchObject({ url: 'https://x.atlassian.net/browse/A-1', summary: 'Summary A-1', status: 'To Do', updatedAt: '2026-10-01T10:00:00.000+0200' });

  const [url, init] = fetch.mock.calls[1]!;
  expect(url).toBe('https://x.atlassian.net/rest/api/3/search/jql');
  expect((init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('me@x.com:tok').toString('base64')}`);
  const { jql } = JSON.parse(String(init!.body));
  expect(jql).toContain('statusCategory != Done');
  expect(jql).toContain('assignee = currentUser()');
  // The name, quoted as a phrase, its own quotes escaped.
  expect(jql).toContain(String.raw`comment ~ "\"Jane \\\"J\\\" Doe\""`);
});

test('myActions lists one row per CLM ticket, with the other projects\' tickets linked to it', async () => {
  const link = (key: string, summary = `Linked ${key}`) => ({ outwardIssue: { key, fields: { summary, status: { name: 'Open' } } } });
  const mine = { assignee: { accountId: ME } };
  mockJira([
    // Another project's ticket linked to a CLM ticket that is not the user's: the CLM row is built from the link.
    issue('PV-1', { ...mine, updated: 'u1', issuelinks: [link('CLM-9', 'Main nine')] }),
    // A CLM ticket with its other projects' tickets (links and parent), and a CLM link that is not attached.
    issue('CLM-1', { ...mine, updated: 'u2', issuelinks: [link('PV-2'), link('CLM-3')], parent: { key: 'EP-1' } }),
    // Its own CLM ticket comes later: the reasons and attached tickets add up.
    issue('PV-3', { updated: 'u3', comment: { comments: [{ author: { accountId: ME } }] }, issuelinks: [{ inwardIssue: { key: 'CLM-4' } }] }),
    issue('CLM-4', { ...mine, updated: 'u4', summary: 'Main four', issuelinks: [link('PV-3'), link('PV-5')] }),
    // No CLM ticket linked.
    issue('PV-6', { ...mine, updated: 'u6', issuelinks: [link('PV-7')] }),
  ]);
  const rows = await new JiraClient('https://x.atlassian.net', 'me@x.com', 'tok').myActions();
  expect(rows.map((r) => [r.key, r.summary, r.updatedAt, r.attached.map((a) => a.key), r.assigned, r.commented, r.needsClm])).toEqual([
    ['CLM-9', 'Main nine', 'u1', ['PV-1'], true, false, false],
    ['CLM-1', 'Summary CLM-1', 'u2', ['PV-2', 'EP-1'], true, false, false],
    ['CLM-4', 'Main four', 'u4', ['PV-3', 'PV-5'], true, true, false],
    ['PV-6', 'Summary PV-6', 'u6', [], true, false, true],
  ]);
  expect(rows[0]!.attached[0]).toEqual({ key: 'PV-1', url: 'https://x.atlassian.net/browse/PV-1' });
});

test('Jira errors carry their message', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errorMessages: ['Unauthorized'] }), { status: 401 })));
  const err = await new JiraClient('https://x.atlassian.net', 'me@x.com', 'bad').myActions().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(JiraError);
  expect(err).toMatchObject({ status: 401, message: 'Jira: Unauthorized' });
});
