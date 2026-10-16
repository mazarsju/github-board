import { chmod, mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  claudeCli, isLoopback, lastAnswer, parseFindings, reviewName, reviewPrompt, reviewTarget, toReviewSessions, type BackgroundSession,
} from '../src/claude.ts';

let dir = '';
afterEach(async () => {
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** Fake `claude` executable running `script`. */
async function fakeClaude(script: string) {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'gb-claude-')));
  const bin = join(dir, 'claude');
  await writeFile(bin, `#!/bin/sh\n${script}\n`);
  await chmod(bin, 0o755);
  return bin;
}

describe('claudeCli', () => {
  test('starts `claude --bg` named, in the given folder, without the GitHub token', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'secret');
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('KEEP_ME', 'yes');
    const bin = await fakeClaude('printf "%s|" "$@"; echo "token=${GITHUB_TOKEN:-none} cc=${CLAUDECODE:-none} keep=$KEEP_ME cwd=$(pwd)"');
    const out = await claudeCli({ bin, cwd: dir }).startBackground('/standup', 'review r#1; rm -rf ~');
    // The name stays one argument: no shell interprets it.
    expect(out).toBe(`--bg|--name|review r#1; rm -rf ~|/standup|token=none cc=none keep=yes cwd=${dir}`);
  });

  test('reports a missing executable and CLI errors', async () => {
    await expect(claudeCli({ bin: '/nonexistent/claude' }).startBackground('/x', 'n')).rejects.toThrow('"/nonexistent/claude" not found');
    const bin = await fakeClaude('echo "Not logged in" >&2; exit 1');
    await expect(claudeCli({ bin }).startBackground('/x', 'n')).rejects.toThrow('Not logged in');
  });

  test('explains how to fix a folder Claude Code does not trust yet', async () => {
    const bin = await fakeClaude('echo "Workspace not trusted" >&2; exit 1');
    await expect(claudeCli({ bin, cwd: dir }).startBackground('/x', 'n')).rejects.toThrow(
      `Workspace not trusted — Claude Code does not trust the folder ${dir} yet: run "claude" once in that folder and accept, or pick a trusted folder with CLAUDE_CWD.`,
    );
  });

  test('lists the background sessions from `claude agents --json --all`', async () => {
    const bin = await fakeClaude(`[ "$*" = "agents --json --all" ] || exit 2
cat <<'JSON'
[
  { "name": "my terminal", "status": "idle", "cwd": "/x", "kind": "interactive", "startedAt": 1 },
  { "id": "dd52f6fd", "sessionId": "dd52f6fd-uuid", "name": "review service-clm#7", "state": "done", "kind": "background", "startedAt": 2, "cwd": "/x" },
  { "id": "broken", "kind": "background" }
]
JSON`);
    expect(await claudeCli({ bin }).listBackground()).toEqual([
      { id: 'dd52f6fd', sessionId: 'dd52f6fd-uuid', name: 'review service-clm#7', state: 'done', startedAt: 2 },
    ]);
  });

  test('reads the last answer of a session from its transcript', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'gb-claude-')));
    await mkdir(join(dir, 'projects', '-Users-me-repo'), { recursive: true });
    await writeFile(join(dir, 'projects', '-Users-me-repo', 's-1.jsonl'), [
      JSON.stringify({ type: 'user', message: { content: '/standup' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Draft' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Final synthesis' }] } }),
    ].join('\n'));
    const cli = claudeCli({ configDir: dir });
    expect(await cli.readResult('s-1')).toBe('Final synthesis');
    expect(await cli.readResult('unknown')).toBeNull();
    expect(await claudeCli({ configDir: join(dir, 'missing') }).readResult('s-1')).toBeNull();
  });

  test('reads the findings the /pr-review skill saved for a PR, unless they predate the session', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'gb-claude-')));
    const workdir = join(dir, 'DiliTrust-service-clm-7');
    await mkdir(workdir);
    await writeFile(join(workdir, 'findings.json'), JSON.stringify([
      { id: 1, severity: 'minor', file: 'a.ts', line: 3, start_line: null, title: 'Edge case', body: 'Body', suggestion: null },
    ]));
    await writeFile(join(workdir, 'context.json'), JSON.stringify({ head: 'abcdef1234' }));
    await utimes(join(workdir, 'findings.json'), 2000, 2000); // seconds
    const cli = claudeCli({ findingsDir: dir });
    expect(await cli.readFindings('DiliTrust', 'service-clm', 7, 1_000_000)).toEqual({
      findings: [{ id: 1, severity: 'minor', file: 'a.ts', line: 3, startLine: null, title: 'Edge case', body: 'Body', suggestion: null }],
      head: 'abcdef1234',
    });
    expect(await cli.readFindings('DiliTrust', 'service-clm', 7, 3_000_000)).toBeNull(); // from an earlier review
    expect(await cli.readFindings('DiliTrust', 'service-clm', 8, 0)).toBeNull();
  });
});

test('parseFindings keeps well-formed findings, most severe first', () => {
  expect(parseFindings({ not: 'an array' })).toEqual([]);
  expect(parseFindings([
    { id: 2, severity: 'nit', file: 'b.ts', line: 1, title: 'Naming', body: 'Rename', suggestion: 'x' },
    null,
    { id: 3, severity: 'critical', file: 'a.ts', line: 10, start_line: 8, title: 'Crash', body: 'Fix it', suggestion: '' },
    { id: 4, severity: 'weird', title: 'Unknown severity', line: -1 },
    { id: 5, severity: 'major' }, // no title
  ])).toEqual([
    { id: 3, severity: 'critical', file: 'a.ts', line: 10, startLine: 8, title: 'Crash', body: 'Fix it', suggestion: null },
    { id: 4, severity: 'minor', file: '', line: null, startLine: null, title: 'Unknown severity', body: '', suggestion: null },
    { id: 2, severity: 'nit', file: 'b.ts', line: 1, startLine: null, title: 'Naming', body: 'Rename', suggestion: 'x' },
  ]);
});

test('lastAnswer keeps the last text of the assistant, skipping tool calls and broken lines', () => {
  const transcript = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'First' }] } }),
    '{ not json',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Part 1' }, { type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'Part 2' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }),
    JSON.stringify({ type: 'cost-state', totalCostUSD: 0.1 }),
  ].join('\n');
  expect(lastAnswer(transcript)).toBe('Part 1\n\nPart 2');
  expect(lastAnswer('')).toBeNull();
});

describe('review sessions', () => {
  const s = (id: string, name: string, state: string, startedAt: number): BackgroundSession => ({ id, sessionId: `${id}-uuid`, name, state, startedAt });

  test('reviewName names the session after the PR', () => {
    expect(reviewName('service-clm', 16664)).toBe('review service-clm#16664');
    expect(reviewPrompt('DiliTrust', 'service-clm', 16664)).toBe('/pr-review https://github.com/DiliTrust/service-clm/pull/16664');
  });

  test('reviewTarget finds the tracked PR of a review session', () => {
    expect(reviewTarget('review service-clm#7', ['DiliTrust/service-clm'])).toEqual({ owner: 'DiliTrust', repo: 'service-clm', number: 7 });
    expect(reviewTarget('review other#7', ['DiliTrust/service-clm'])).toBeNull();
    expect(reviewTarget('review service-clm#7 ../x', ['DiliTrust/service-clm'])).toBeNull();
  });

  test('toReviewSessions maps review sessions to tracked PRs, latest one per PR', () => {
    const repos = ['DiliTrust/service-clm', 'DiliTrust/webapp-clm'];
    expect(toReviewSessions([
      s('old', 'review service-clm#7', 'done', 1),
      s('new', 'review service-clm#7', 'waiting', 3),
      s('w', 'review webapp-clm#2', 'done', 2),
      s('f', 'review webapp-clm#5', 'failed', 2),
      s('x', 'review other-repo#1', 'done', 2), // not tracked
      s('y', 'my own session', 'working', 2),
    ], repos)).toEqual([
      { key: 'DiliTrust/service-clm#7', id: 'new', name: 'review service-clm#7', running: true, state: 'waiting', startedAt: 3 },
      { key: 'DiliTrust/webapp-clm#2', id: 'w', name: 'review webapp-clm#2', running: false, state: 'done', startedAt: 2 },
      { key: 'DiliTrust/webapp-clm#5', id: 'f', name: 'review webapp-clm#5', running: false, state: 'failed', startedAt: 2 },
    ]);
  });
});

test('isLoopback accepts only this machine', () => {
  expect(['127.0.0.1', '::1', '::ffff:127.0.0.1'].map(isLoopback)).toEqual([true, true, true]);
  expect(['10.0.0.5', '::ffff:192.168.1.2', undefined].map(isLoopback)).toEqual([false, false, false]);
});
