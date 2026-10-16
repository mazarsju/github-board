// Local Claude Code CLI: starts the "Review" background sessions, lists them and reads their result.
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FindingSeverity, ReviewFinding, ReviewSession } from '../../shared/types.ts';

/** A background session as listed by `claude agents --json --all`. */
export interface BackgroundSession {
  /** Short id taken by `claude attach`, `logs`, `stop`… */
  id: string;
  /** Conversation id, which names the session's transcript file. */
  sessionId: string;
  name: string;
  /** "done" or "failed" once finished; other values (working, waiting…) mean it is still going. */
  state: string;
  startedAt: number;
}

export interface ClaudeCli {
  /** Starts `claude --bg` with `prompt` in a session named `name`; resolves with what the CLI printed (the session id). */
  startBackground(prompt: string, name: string): Promise<string>;
  /** Background sessions of this machine, finished ones included. */
  listBackground(): Promise<BackgroundSession[]>;
  /** Last answer of a session (its final text message), or null when there is none yet. */
  readResult(sessionId: string): Promise<string | null>;
  /**
   * Findings the `/pr-review` skill saved for a PR, if written since `since` (ms): older ones
   * come from a previous review. `owner` and `repo` must be validated (tracked repository).
   */
  readFindings(owner: string, repo: string, number: number, since: number): Promise<{ findings: ReviewFinding[]; head: string | null } | null>;
}

/** Variables not passed on to Claude: the server's GitHub token, and the markers of a parent Claude Code session. */
const HIDDEN_ENV = ['GITHUB_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN'];

/**
 * CLI running the `bin` executable (default `claude`) in `cwd`. Arguments are passed without
 * a shell, so the prompt and name are never interpreted. Transcripts are read from
 * `configDir` (default: CLAUDE_CONFIG_DIR, or ~/.claude), the skill's findings from
 * `findingsDir` (default ~/.cache/pr-review, where `/pr-review` saves them).
 */
export function claudeCli({
  bin = 'claude', cwd, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
  findingsDir = join(homedir(), '.cache', 'pr-review'),
}: {
  bin?: string; cwd?: string; configDir?: string; findingsDir?: string;
} = {}): ClaudeCli {
  const run = (args: string[]) => new Promise<string>((resolve, reject) => {
    const env = { ...process.env };
    for (const key of HIDDEN_ENV) delete env[key];
    execFile(bin, args, { cwd, env, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout.trim());
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(`Commande « ${bin} » introuvable (variable CLAUDE_BIN)`));
      const message = stderr.trim() || err.message;
      // Claude Code only works in folders the user trusted once, interactively.
      if (/trust/i.test(message)) {
        return reject(new Error(`${message} — Claude Code n'a pas encore approuvé le dossier ${cwd ?? process.cwd()} : `
          + 'lancez une fois « claude » dans ce dossier et acceptez, ou choisissez un dossier approuvé avec CLAUDE_CWD.'));
      }
      reject(new Error(message));
    });
  });

  return {
    // `--bg` returns as soon as the session is started.
    startBackground: (prompt, name) => run(['--bg', '--name', name, prompt]),

    async listBackground() {
      const sessions = JSON.parse(await run(['agents', '--json', '--all']) || '[]') as (Partial<BackgroundSession> & { kind?: string })[];
      return sessions
        .filter((s) => s.kind === 'background' && s.id && s.sessionId && s.name)
        .map((s) => ({ id: s.id!, sessionId: s.sessionId!, name: s.name!, state: s.state ?? '', startedAt: s.startedAt ?? 0 }));
    },

    async readResult(sessionId) {
      // Transcripts live in ~/.claude/projects/<folder>/<sessionId>.jsonl; the folder name encodes the session's cwd.
      const projects = join(configDir, 'projects');
      const folders = await readdir(projects).catch(() => [] as string[]);
      for (const folder of folders) {
        const content = await readFile(join(projects, folder, `${sessionId}.jsonl`), 'utf8').catch(() => null);
        if (content !== null) return lastAnswer(content);
      }
      return null;
    },

    async readFindings(owner, repo, number, since) {
      // Same folder as the skill: ~/.cache/pr-review/<owner>-<repo>-<n>.
      const workdir = join(findingsDir, `${owner}-${repo}-${number}`);
      const file = join(workdir, 'findings.json');
      const info = await stat(file).catch(() => null);
      if (!info || info.mtimeMs < since) return null;
      const findings = parseFindings(JSON.parse(await readFile(file, 'utf8')));
      const context = JSON.parse(await readFile(join(workdir, 'context.json'), 'utf8').catch(() => '{}')) as { head?: unknown };
      const head = typeof context.head === 'string' && /^[0-9a-f]{7,40}$/.test(context.head) ? context.head : null;
      return { findings, head };
    },
  };
}

const SEVERITIES: FindingSeverity[] = ['critical', 'major', 'minor', 'nit'];

/** Findings of a `findings.json`, keeping the well-formed ones, most severe first. */
export function parseFindings(raw: unknown): ReviewFinding[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const int = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && !!str(f.title))
    .map((f, i) => ({
      id: int(f.id) ?? i + 1,
      severity: SEVERITIES.includes(f.severity as FindingSeverity) ? f.severity as FindingSeverity : 'minor',
      file: str(f.file),
      line: int(f.line),
      startLine: int(f.start_line),
      title: str(f.title),
      body: str(f.body),
      suggestion: typeof f.suggestion === 'string' && f.suggestion ? f.suggestion : null,
    }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

/** Text of the last assistant message of a transcript (JSON lines), or null. Unreadable lines are skipped. */
export function lastAnswer(transcript: string): string | null {
  let last: string | null = null;
  for (const line of transcript.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
      if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
      const text = (entry.message.content as { type?: string; text?: string }[])
        .filter((c) => c.type === 'text' && c.text?.trim()).map((c) => c.text!.trim()).join('\n\n');
      if (text) last = text;
    } catch { /* partial or foreign line */ }
  }
  return last;
}

/** Name given to the review session of a PR, e.g. `review service-clm#16664`. */
export function reviewName(repo: string, number: number): string {
  return `review ${repo}#${number}`;
}

/** Prompt of the review session: the `/pr-review` skill on the PR's URL. */
export function reviewPrompt(owner: string, repo: string, number: number): string {
  return `/pr-review https://github.com/${owner}/${repo}/pull/${number}`;
}

/** Tracked PR a session named by reviewName reviews, or null. */
export function reviewTarget(name: string, repos: readonly string[]): { owner: string; repo: string; number: number } | null {
  const match = /^review ([\w.-]+)#(\d+)$/.exec(name);
  const full = match && repos.find((r) => r.split('/')[1] === match[1]);
  if (!full) return null;
  const [owner = '', repo = ''] = full.split('/');
  return { owner, repo, number: Number(match[2]) };
}

/** States of a session that is over. */
const FINISHED = new Set(['done', 'failed', 'stopped', 'killed', 'cancelled', 'error']);

/**
 * Review sessions of the tracked repositories, from the background sessions: those named by
 * reviewName, mapped to their PR, the latest one per PR.
 */
export function toReviewSessions(sessions: BackgroundSession[], repos: readonly string[]): ReviewSession[] {
  const latest = new Map<string, ReviewSession>();
  for (const s of sessions) {
    const target = reviewTarget(s.name, repos);
    if (!target) continue;
    const key = `${target.owner}/${target.repo}#${target.number}`;
    const seen = latest.get(key);
    if (seen && seen.startedAt >= s.startedAt) continue;
    latest.set(key, { key, id: s.id, name: s.name, running: !FINISHED.has(s.state), state: s.state, startedAt: s.startedAt });
  }
  return [...latest.values()];
}

/** Whether a socket address is this machine. */
export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
