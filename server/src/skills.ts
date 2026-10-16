// Files and scripts of the user's `/pr-review` and `/pick-change` Claude Code skills: the findings
// a review saved, the decisions taken on them, and the posting of an approved finding.
import { execFile } from 'node:child_process';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FindingPlacement, FindingSeverity, ReviewFinding } from '../../shared/types.ts';

/** A tracked PR (owner and repo validated against the tracked repositories). */
export interface PrTarget {
  owner: string;
  repo: string;
  number: number;
}

/** A finding as saved, with the background session editing it, if any. */
export type SavedFinding = Omit<ReviewFinding, 'editing'> & { editSession: string | null };

export interface SavedFindings {
  findings: SavedFinding[];
  /** Reviewed commit, from the skill's `context.json`. */
  head: string | null;
}

export interface Skills {
  /** Findings `/pr-review` saved for a PR, if written since `since` (ms): older ones come from a previous review. */
  readFindings(pr: PrTarget, since: number): Promise<SavedFindings | null>;
  /**
   * Changes the finding `id` in `findings.json`, keeping the fields the app does not know.
   * `fields` uses the skill's names (snake_case); an undefined value removes the field.
   */
  updateFinding(pr: PrTarget, id: number, fields: Record<string, unknown>): Promise<void>;
  /** Where `/pick-change` would post the finding. Read-only. */
  placement(pr: PrTarget, finding: SavedFinding): Promise<FindingPlacement>;
  /**
   * Posts `body` for the finding at the reviewed commit, with `/pick-change`'s script, only if it
   * still lands as `mode`. Resolves with the comment's URL.
   */
  post(pr: PrTarget, finding: SavedFinding, head: string, body: string, mode: FindingPlacement): Promise<string>;
}

/** Thrown when a finding would no longer land where the user approved it: nothing was posted. */
export class PlacementChanged extends Error {}

/** Variables not passed on to the scripts: `gh` would use them instead of its own login. */
const HIDDEN_ENV = ['GITHUB_TOKEN', 'GH_TOKEN'];

/**
 * Skills whose findings live in `findingsDir` (default ~/.cache/pr-review, shared by both skills)
 * and whose posting script is `postScript` (default: `/pick-change`'s `post_comment.py`), run by `python`.
 */
export function skills({
  findingsDir = join(homedir(), '.cache', 'pr-review'),
  postScript = join(homedir(), '.claude', 'skills', 'pick-change', 'scripts', 'post_comment.py'),
  python = 'python3',
}: { findingsDir?: string; postScript?: string; python?: string } = {}): Skills {
  const workdir = (pr: PrTarget) => join(findingsDir, `${pr.owner}-${pr.repo}-${pr.number}`);

  // Arguments are passed without a shell, values as `--name=value` so that none is read as an option.
  const script = (args: string[]) => new Promise<string>((resolve, reject) => {
    const env = { ...process.env };
    for (const key of HIDDEN_ENV) delete env[key];
    execFile(python, ['-I', postScript, ...args], { env, timeout: 60_000 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout.trim());
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(`Command "${python}" not found`));
      if (/placement changed/.test(stdout)) return reject(new PlacementChanged('The comment would now land elsewhere: review it again.'));
      reject(new Error(stderr.trim() || stdout.trim() || err.message));
    });
  });
  const placeArgs = (pr: PrTarget, f: SavedFinding) => {
    if (!f.file || !f.line) throw new Error('This finding has no file or line: post it with /pick-change.');
    return [`--repo=${pr.owner}/${pr.repo}`, `--pr=${pr.number}`, `--path=${f.file}`, `--line=${f.line}`,
      ...(f.startLine ? [`--start-line=${f.startLine}`] : [])];
  };

  return {
    async readFindings(pr, since) {
      const file = join(workdir(pr), 'findings.json');
      const info = await stat(file).catch(() => null);
      if (!info || info.mtimeMs < since) return null;
      const findings = parseFindings(JSON.parse(await readFile(file, 'utf8')));
      const context = JSON.parse(await readFile(join(workdir(pr), 'context.json'), 'utf8').catch(() => '{}')) as { head?: unknown };
      const head = typeof context.head === 'string' && /^[0-9a-f]{7,40}$/.test(context.head) ? context.head : null;
      return { findings, head };
    },

    async updateFinding(pr, id, fields) {
      const file = join(workdir(pr), 'findings.json');
      const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
      const item = Array.isArray(raw) ? raw.find((f) => f && typeof f === 'object' && f.id === id) as Record<string, unknown> | undefined : undefined;
      if (!item) throw new Error(`No finding ${id} in ${file}`);
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete item[key];
        else item[key] = value;
      }
      // Atomic: a temporary file, then a rename.
      await writeFile(`${file}.tmp`, JSON.stringify(raw, null, 2) + '\n');
      await rename(`${file}.tmp`, file);
    },

    async placement(pr, f) {
      const { mode } = JSON.parse(await script(['where', ...placeArgs(pr, f)])) as { mode: FindingPlacement };
      return mode;
    },

    async post(pr, f, head, body, mode) {
      // Same file as /pick-change: the approved body, unchanged.
      const bodyFile = join(workdir(pr), `comment-${f.id}.md`);
      await writeFile(bodyFile, body);
      const out = await script(['post', ...placeArgs(pr, f), `--commit=${head}`, `--body-file=${bodyFile}`, `--expect-mode=${mode}`]);
      const { url } = JSON.parse(out) as { url?: string };
      if (!url) throw new Error('GitHub did not return the comment');
      return url;
    },
  };
}

const SEVERITIES: FindingSeverity[] = ['critical', 'major', 'minor', 'nit'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const int = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

/** Findings of a `findings.json`, keeping the well-formed ones, most severe first. */
export function parseFindings(raw: unknown): SavedFinding[] {
  if (!Array.isArray(raw)) return [];
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
      easySummary: str(f.easy_summary).trim() || null,
      decision: f.decision === 'posted' || f.decision === 'dropped' ? f.decision as 'posted' | 'dropped' : null,
      url: str(f.url) || null,
      edited: f.edited === true,
      editError: str(f.edit_error) || null,
      editSession: /^[\w-]+$/.test(str(f.edit_session)) ? str(f.edit_session) : null,
    }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

const EMOJI: Record<FindingSeverity, string> = { critical: '🔴', major: '🟠', minor: '🟡', nit: '⚪' };

/** The comment posted for a finding, as `/pick-change` writes it (never with the easy summary). */
export function commentBody(f: Pick<ReviewFinding, 'severity' | 'title' | 'body' | 'suggestion'>): string {
  const severity = f.severity[0]!.toUpperCase() + f.severity.slice(1);
  const parts = [`**${EMOJI[f.severity]} ${severity}**: ${f.title}`, f.body.trim()];
  if (f.suggestion) parts.push('```suggestion\n' + f.suggestion.replace(/\n$/, '') + '\n```');
  return parts.filter(Boolean).join('\n\n');
}

/** Name of the background session editing a finding, e.g. `edit service-clm#16664 finding 2`. */
export function editName(pr: PrTarget, id: number): string {
  return `edit ${pr.repo}#${pr.number} finding ${id}`;
}

/** Prompt of the session editing a finding at the user's request. Only its answer is used. */
export function editPrompt(pr: PrTarget, f: SavedFinding, request: string): string {
  const current = { file: f.file, line: f.line, start_line: f.startLine, title: f.title, body: f.body, suggestion: f.suggestion, easy_summary: f.easySummary };
  return [
    `Rewrite one review comment that /pr-review drafted for https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}.`,
    'Never post to GitHub and never modify, commit or push anything. You may read the PR and its code with `gh` if needed.',
    '',
    'Current finding:',
    JSON.stringify(current, null, 2),
    '',
    'The user asks for this change:',
    '"""',
    request,
    '"""',
    '',
    'Apply it to this finding only. Keep the body concise, in English, explaining the failure scenario and the fix. Keep',
    '`suggestion` the exact replacement code for lines start_line..line (or line), or null when the fix is not that local.',
    'Update `easy_summary` (in French, 2 to 4 plain sentences for the user) if what is asked changes.',
    'Reply with only this JSON object and nothing else:',
    '{"title": "<≤60 chars>", "body": "...", "suggestion": "..." or null, "easy_summary": "..."}',
  ].join('\n');
}

/** The finding fields an edit session answered (its JSON, possibly in a code fence), or null. */
export function parseEdit(answer: string | null): { title: string; body: string; suggestion: string | null; easy_summary: string | null } | null {
  const json = answer?.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const e = JSON.parse(json) as Record<string, unknown>;
    if (!str(e.title).trim() || !str(e.body).trim()) return null;
    return {
      title: str(e.title).trim(),
      body: str(e.body).trim(),
      suggestion: str(e.suggestion) || null,
      easy_summary: str(e.easy_summary).trim() || null,
    };
  } catch {
    return null;
  }
}
