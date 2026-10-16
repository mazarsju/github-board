// Express application: the board's REST API + serving of the built frontend.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { REPOS } from '../../shared/config.ts';
import { appStateSchema } from '../../shared/schema.ts';
import type { SessionInfo } from '../../shared/types.ts';
import { claudeCli, isLoopback, reviewName, reviewPrompt, reviewTarget, toReviewSessions, type ClaudeCli } from './claude.ts';
import { excerpt, GitHubClient, GitHubError } from './github.ts';
import type { StateStore } from './store.ts';

export interface AppOptions {
  store: StateStore;
  /** GitHub token provided by the environment: shared, no login required. */
  envToken?: string;
  /** GitHub client factory (replaceable in tests). */
  createClient?: (token: string) => GitHubClient;
  /** Folder of the built frontend to serve (production). */
  staticDir?: string;
  /** Local Claude Code CLI for the "Review" button (replaceable in tests). */
  claude?: ClaudeCli;
}

interface Session {
  client: GitHubClient;
  login: string;
  avatarUrl: string;
}

const COOKIE = 'gb_session';
/**
 * Header the app sends to the review routes. Another website cannot add it to a request
 * to this server without a CORS preflight, which is not granted: this blocks cross-site
 * requests even without a session cookie (GITHUB_TOKEN mode).
 */
export const REVIEW_HEADER = 'x-github-board';

const pullParams = z.object({
  owner: z.string().regex(/^[\w.-]+$/),
  repo: z.string().regex(/^[\w.-]+$/),
  number: z.coerce.number().int().positive(),
});

const pullsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function createApp({ store, envToken, createClient = (t) => new GitHubClient(t), staticDir, claude = claudeCli() }: AppOptions) {
  const app = express();
  const sessions = new Map<string, Session>(); // session id (cookie) → session
  let envSession: Promise<Session> | null = null;

  async function openSession(token: string): Promise<Session> {
    const client = createClient(token);
    const user = await client.getUser();
    return { client, login: user.login, avatarUrl: user.avatar_url };
  }

  async function currentSession(req: Request): Promise<Session | null> {
    if (envToken) {
      envSession ??= openSession(envToken).catch((err: unknown) => { envSession = null; throw err; });
      return envSession;
    }
    const sid = readCookie(req, COOKIE);
    return (sid && sessions.get(sid)) || null;
  }

  const sessionInfo = (s: Session): SessionInfo => ({ user: { login: s.login, avatarUrl: s.avatarUrl }, envToken: !!envToken });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();

  api.post('/session', async (req, res) => {
    if (envToken) return void res.status(409).json({ error: 'Token provided by the server (GITHUB_TOKEN).' });
    const { token } = z.object({ token: z.string().trim().min(1) }).parse(req.body);
    const session = await openSession(token);
    const sid = randomBytes(24).toString('base64url');
    sessions.set(sid, session);
    res.cookie(COOKIE, sid, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
    res.json(sessionInfo(session));
  });

  // Every following route requires a session.
  api.use(async (req, res, next) => {
    const session = await currentSession(req);
    if (!session) return void res.status(401).json({ error: 'Not signed in' });
    res.locals.session = session;
    next();
  });
  const session = (res: Response) => res.locals.session as Session;

  api.get('/session', (_req, res) => {
    res.json(sessionInfo(session(res)));
  });

  api.delete('/session', (req, res) => {
    const sid = readCookie(req, COOKIE);
    if (sid) sessions.delete(sid);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  api.get('/state', async (_req, res) => {
    res.json(await store.get(session(res).login));
  });

  api.put('/state', async (req, res) => {
    const state = appStateSchema.parse(req.body);
    await store.set(session(res).login, state);
    res.status(204).end();
  });

  api.get('/repos/access', async (_req, res) => {
    res.json(await session(res).client.checkRepoAccess(REPOS));
  });

  api.get('/pulls', async (req, res) => {
    const { limit } = pullsQuery.parse(req.query);
    res.json(await session(res).client.listOpenPRs(REPOS, limit));
  });

  api.get('/actions', async (_req, res) => {
    const s = session(res);
    res.json(await s.client.myActions(s.login, REPOS));
  });

  api.get('/pulls/:owner/:repo/:number/details', async (req, res) => {
    const { owner, repo, number } = pullParams.parse(req.params);
    const updatedAt = typeof req.query.updatedAt === 'string' ? req.query.updatedAt : '';
    res.json(await session(res).client.getDetails(owner, repo, number, updatedAt));
  });

  // The review routes run the Claude CLI or read its files on this machine: only for
  // requests from this machine, sent by the app itself.
  const localOnly = (req: Request, res: Response, next: NextFunction) => {
    if (isLoopback(req.socket.remoteAddress) && req.get(REVIEW_HEADER) === '1') return next();
    res.status(403).json({ error: 'Reviews can only be started from the app, on the server\'s machine.' });
  };
  const claudeError = (res: Response, action: string, err: unknown) =>
    res.status(500).json({ error: `${action}: ${(err as Error).message}` });

  api.post('/pulls/:owner/:repo/:number/review', localOnly, async (req, res) => {
    const { owner, repo, number } = pullParams.parse(req.params);
    if (!REPOS.includes(`${owner}/${repo}`)) return void res.status(404).json({ error: 'Repository not tracked' });
    const name = reviewName(repo, number);
    try {
      const output = await claude.startBackground(reviewPrompt(owner, repo, number), name);
      res.json({ name, output });
    } catch (err) {
      claudeError(res, 'Could not start Claude', err);
    }
  });

  api.get('/reviews', localOnly, async (_req, res) => {
    try {
      res.json(toReviewSessions(await claude.listBackground(), REPOS));
    } catch (err) {
      claudeError(res, 'Could not read the Claude sessions', err);
    }
  });

  api.get('/reviews/:id/result', localOnly, async (req, res) => {
    const { id } = z.object({ id: z.string().regex(/^[\w-]+$/) }).parse(req.params);
    try {
      // Files are found from the CLI's own listing (transcript id, session name mapped to a
      // tracked repository), never from a client-provided path.
      const bg = (await claude.listBackground()).find((s) => s.id === id);
      const text = bg && /^[\w-]+$/.test(bg.sessionId) ? await claude.readResult(bg.sessionId) : null;
      const target = bg && reviewTarget(bg.name, REPOS);
      const saved = target ? await claude.readFindings(target.owner, target.repo, target.number, bg.startedAt) : null;
      if (text === null && !saved) return void res.status(404).json({ error: 'No result for this session.' });
      // The commented code at the reviewed commit, as GitHub shows it with a review comment.
      const { client } = session(res);
      const findings = saved && target && saved.head ? await Promise.all(saved.findings.map(async (f) => {
        if (!f.file || !f.line) return { ...f, code: null };
        const lines = await client.fileLines(target.owner, target.repo, f.file, saved.head!).catch(() => null);
        return { ...f, code: lines && excerpt(lines, f.startLine ?? f.line, f.line) };
      })) : saved?.findings ?? null;
      res.json({ text, findings, head: saved?.head ?? null });
    } catch (err) {
      claudeError(res, 'Could not read the result', err);
    }
  });

  api.get('/rate', (_req, res) => {
    res.json(session(res).client.rate);
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Unknown route' });
  });

  app.use('/api', api);

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: 'Invalid request', issues: err.issues });
    if (err instanceof GitHubError) return void res.status(err.status >= 500 ? 502 : err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
