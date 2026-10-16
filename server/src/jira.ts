// Jira Cloud REST client, used server-side (the token never leaves the backend).
import { JIRA_PROJECT } from '../../shared/config.ts';
import type { JiraAction, JiraTicket } from '../../shared/types.ts';

export class JiraError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface Myself { accountId: string; displayName: string }
interface Comment { author?: { accountId?: string }; body?: unknown }
/** A linked issue, as Jira embeds it in a link or as a parent. */
interface LinkedIssue { key: string; fields?: { summary?: string; status?: { name?: string } } }
interface Issue {
  key: string;
  fields: {
    summary: string;
    status?: { name?: string };
    updated: string;
    assignee?: { accountId?: string } | null;
    comment?: { comments?: Comment[] };
    issuelinks?: { inwardIssue?: LinkedIssue; outwardIssue?: LinkedIssue }[];
    parent?: LinkedIssue;
  };
}

const isMain = (key: string) => key.startsWith(`${JIRA_PROJECT}-`);

/** The issues linked to `issue` (both directions) and its parent. */
const linked = ({ fields: f }: Issue): LinkedIssue[] =>
  [...(f.issuelinks ?? []).flatMap((l) => [l.inwardIssue, l.outwardIssue]), f.parent].filter((i): i is LinkedIssue => !!i);

/** Quotes a value for JQL. */
const jqlString = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`;

/** Whether an Atlassian document (a comment body) mentions the account. */
export function mentions(node: unknown, accountId: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: unknown; attrs?: { id?: unknown }; content?: unknown };
  if (n.type === 'mention' && n.attrs?.id === accountId) return true;
  return Array.isArray(n.content) && n.content.some((c) => mentions(c, accountId));
}

export class JiraClient {
  private base: string;
  private auth: string;
  private me: Promise<Myself> | null = null;

  /** `base`: the site, e.g. https://acme.atlassian.net; `token`: an API token of the `email` account. */
  constructor(base: string, email: string, token: string) {
    this.base = base.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  async request<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: this.auth,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      let msg = `Jira: ${res.status} ${res.statusText}`;
      try {
        const data = (await res.json()) as { errorMessages?: string[]; message?: string };
        const detail = data.errorMessages?.join(', ') || data.message;
        if (detail) msg = `Jira: ${detail}`;
      } catch { /* non-JSON body */ }
      throw new JiraError(msg, res.status);
    }
    return (await res.json()) as T;
  }

  private myself(): Promise<Myself> {
    this.me ??= this.request<Myself>('/rest/api/3/myself').catch((err: unknown) => { this.me = null; throw err; });
    return this.me;
  }

  /**
   * Unresolved tickets assigned to the user, mentioning them in a comment, or that they commented,
   * most recently updated first, one row per JIRA_PROJECT ticket: another project's ticket is shown
   * on the row of the JIRA_PROJECT tickets linked to it, or on its own row when there is none.
   */
  async myActions(): Promise<JiraAction[]> {
    const me = await this.myself();
    // Commenting makes you a watcher by default; mentions are found by the text search on the name.
    // Both are then checked against the comments themselves.
    const jql = `statusCategory != Done AND (assignee = currentUser() OR watcher = currentUser() OR comment ~ ${jqlString(jqlString(me.displayName))}) ORDER BY updated DESC`;
    // ponytail: first 100 tickets only; page with nextPageToken if that falls short.
    const { issues } = await this.request<{ issues: Issue[] }>('/rest/api/3/search/jql', {
      jql, maxResults: 100, fields: ['summary', 'status', 'updated', 'assignee', 'comment', 'issuelinks', 'parent'],
    });
    const ticket = (key: string): JiraTicket => ({ key, url: `${this.base}/browse/${encodeURIComponent(key)}` });
    const row = (i: LinkedIssue, updatedAt: string): JiraAction => ({
      ...ticket(i.key), summary: i.fields?.summary ?? '', status: i.fields?.status?.name ?? '', updatedAt,
      assigned: false, mentioned: false, commented: false, attached: [], needsClm: false,
    });
    const rows = new Map<string, JiraAction>(); // in order of first appearance: most recently updated first
    const attach = (r: JiraAction, key: string) => { if (!r.attached.some((t) => t.key === key)) r.attached.push(ticket(key)); };
    for (const issue of issues) {
      const comments = issue.fields.comment?.comments ?? [];
      const why = {
        assigned: issue.fields.assignee?.accountId === me.accountId,
        mentioned: comments.some((c) => mentions(c.body, me.accountId)),
        commented: comments.some((c) => c.author?.accountId === me.accountId),
      };
      if (!why.assigned && !why.mentioned && !why.commented) continue;
      const links = linked(issue);
      const addWhy = (r: JiraAction) => { r.assigned ||= why.assigned; r.mentioned ||= why.mentioned; r.commented ||= why.commented; };
      if (isMain(issue.key)) {
        // Possibly added already through a linked ticket: its own data wins, the reasons and attached tickets add up.
        const prev = rows.get(issue.key);
        const r = row(issue, issue.fields.updated);
        if (prev) Object.assign(r, { assigned: prev.assigned, mentioned: prev.mentioned, commented: prev.commented, attached: prev.attached });
        rows.set(issue.key, r);
        addWhy(r);
        for (const l of links) if (!isMain(l.key)) attach(r, l.key);
        continue;
      }
      const mains = links.filter((l) => isMain(l.key));
      if (!mains.length) {
        rows.set(issue.key, { ...row(issue, issue.fields.updated), ...why, needsClm: true });
        continue;
      }
      // Shown on its JIRA_PROJECT tickets' rows, among their attached tickets.
      for (const m of mains) {
        if (!rows.has(m.key)) rows.set(m.key, row(m, issue.fields.updated));
        addWhy(rows.get(m.key)!);
        attach(rows.get(m.key)!, issue.key);
      }
    }
    return [...rows.values()];
  }
}
