// Express application: the board's REST API + serving of the built frontend.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { REPOS } from '../../shared/config.ts';
import { appStateSchema } from '../../shared/schema.ts';
import type { SessionInfo } from '../../shared/types.ts';
import { GitHubClient, GitHubError } from './github.ts';
import type { StateStore } from './store.ts';

export interface AppOptions {
  store: StateStore;
  /** GitHub token provided by the environment: shared, no login required. */
  envToken?: string;
  /** GitHub client factory (replaceable in tests). */
  createClient?: (token: string) => GitHubClient;
  /** Folder of the built frontend to serve (production). */
  staticDir?: string;
}

interface Session {
  client: GitHubClient;
  login: string;
  avatarUrl: string;
}

const COOKIE = 'gb_session';

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

export function createApp({ store, envToken, createClient = (t) => new GitHubClient(t), staticDir }: AppOptions) {
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
    if (envToken) return void res.status(409).json({ error: 'Token fourni par le serveur (GITHUB_TOKEN).' });
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
    if (!session) return void res.status(401).json({ error: 'Non connecté' });
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

  api.get('/pulls/:owner/:repo/:number/details', async (req, res) => {
    const { owner, repo, number } = z.object({
      owner: z.string().regex(/^[\w.-]+$/),
      repo: z.string().regex(/^[\w.-]+$/),
      number: z.coerce.number().int().positive(),
    }).parse(req.params);
    const updatedAt = typeof req.query.updatedAt === 'string' ? req.query.updatedAt : '';
    res.json(await session(res).client.getDetails(owner, repo, number, updatedAt));
  });

  api.get('/rate', (_req, res) => {
    res.json(session(res).client.rate);
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Route inconnue' });
  });

  app.use('/api', api);

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: 'Requête invalide', issues: err.issues });
    if (err instanceof GitHubError) return void res.status(err.status >= 500 ? 502 : err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne' });
  });

  return app;
}
