// Local Claude Code CLI: starts the "Review" (and finding edit) background sessions, lists them and reads their result.
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ReviewSession } from '../../shared/types.ts';

/** A background session as listed by `claude agents --json --all`. */
export interface BackgroundSession {
  /** Short id taken by `claude attach`, `logs`, `stop`… */
  id: string;
  /** Conversation id, which names the session's transcript file. */
  sessionId: string;
  name: string;
  /** "done" or "failed" once finished; other values (working, waiting…) mean it is still going. */
  state: string;
  /** Whether a turn is running ("idle" between turns). Optional: older CLIs may not report it. */
  status?: string;
  startedAt: number;
  /** Its process still runs (the CLI lists a pid), finished or not: `claude stop` ends it. */
  alive?: boolean;
}

export interface ClaudeCli {
  /** Starts `claude --bg` with `prompt` in a session named `name`; resolves with what the CLI printed (the session id). */
  startBackground(prompt: string, name: string): Promise<string>;
  /** Background sessions of this machine, finished ones included. */
  listBackground(): Promise<BackgroundSession[]>;
  /** Last answer of a session (its final text message), or null when there is none yet. */
  readResult(sessionId: string): Promise<string | null>;
  /** Stops a background session (`claude stop`); its conversation is kept. */
  stop(id: string): Promise<void>;
}

/** Variables not passed on to Claude: the server's GitHub token, and the markers of a parent Claude Code session. */
const HIDDEN_ENV = ['GITHUB_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN'];

/**
 * CLI running the `bin` executable (default `claude`) in `cwd`. Arguments are passed without
 * a shell, so the prompt and name are never interpreted. Transcripts are read from
 * `configDir` (default: CLAUDE_CONFIG_DIR, or ~/.claude).
 */
export function claudeCli({
  bin = 'claude', cwd, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
}: {
  bin?: string; cwd?: string; configDir?: string;
} = {}): ClaudeCli {
  const run = (args: string[]) => new Promise<string>((resolve, reject) => {
    const env = { ...process.env };
    for (const key of HIDDEN_ENV) delete env[key];
    execFile(bin, args, { cwd, env, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout.trim());
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(`Command "${bin}" not found (CLAUDE_BIN variable)`));
      const message = stderr.trim() || err.message;
      // Claude Code only works in folders the user trusted once, interactively.
      if (/trust/i.test(message)) {
        return reject(new Error(`${message} — Claude Code does not trust the folder ${cwd ?? process.cwd()} yet: `
          + 'run "claude" once in that folder and accept, or pick a trusted folder with CLAUDE_CWD.'));
      }
      reject(new Error(message));
    });
  });

  return {
    // `--bg` returns as soon as the session is started.
    startBackground: (prompt, name) => run(['--bg', '--name', name, prompt]),

    async listBackground() {
      const sessions = JSON.parse(await run(['agents', '--json', '--all']) || '[]') as (Partial<BackgroundSession> & { kind?: string; pid?: number })[];
      return sessions
        .filter((s) => s.kind === 'background' && s.id && s.sessionId && s.name)
        .map((s) => ({
          id: s.id!, sessionId: s.sessionId!, name: s.name!, state: s.state ?? '', startedAt: s.startedAt ?? 0,
          ...(s.status ? { status: s.status } : {}),
          ...(s.pid ? { alive: true } : {}),
        }));
    },

    async stop(id) {
      // Never an option: ids from the CLI's listing start with a letter or a digit.
      if (!/^\w[\w-]*$/.test(id)) throw new Error(`Invalid session id: ${id}`);
      await run(['stop', id]);
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
  };
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

/**
 * Sessions still running for the review `review`: itself, the earlier reviews of the same PR,
 * and the sessions editing its findings (named `edit <repo>#<n> finding <id>`).
 */
export function attachedSessions(review: BackgroundSession, sessions: BackgroundSession[], repos: readonly string[]): BackgroundSession[] {
  const target = reviewTarget(review.name, repos);
  if (!target) return review.alive ? [review] : [];
  const edits = `edit ${target.repo}#${target.number} finding `;
  return sessions.filter((s) => s.alive && (
    s.id === review.id
    || (s.name === review.name && s.startedAt <= review.startedAt)
    || s.name.startsWith(edits)
  ));
}

/** States of a session that is over. */
const FINISHED = new Set(['done', 'failed', 'stopped', 'killed', 'cancelled', 'error']);

/**
 * Whether a background session is over. The CLI's `state` can stay "working" after the last
 * turn ended (seen with `status: "idle"`): nothing runs any more, so it is over too. An idle
 * session "waiting" for the user is not.
 */
export function isOver(s: Pick<BackgroundSession, 'state' | 'status'>): boolean {
  return FINISHED.has(s.state) || (s.status === 'idle' && s.state === 'working');
}

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
    latest.set(key, { key, id: s.id, name: s.name, running: !isOver(s), state: s.state, startedAt: s.startedAt });
  }
  return [...latest.values()];
}

/** Whether a socket address is this machine. */
export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
