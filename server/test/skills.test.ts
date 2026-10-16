import { chmod, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  commentBody, editName, editPrompt, parseEdit, parseFindings, PlacementChanged, skills, type SavedFinding,
} from '../src/skills.ts';

let dir = '';
afterEach(async () => {
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const PR = { owner: 'DiliTrust', repo: 'service-clm', number: 7 };

/** A findings folder for PR, as /pr-review leaves it. */
async function workdir(findings: unknown[]) {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'gb-skills-')));
  const work = join(dir, 'DiliTrust-service-clm-7');
  await mkdir(work);
  await writeFile(join(work, 'findings.json'), JSON.stringify(findings));
  await writeFile(join(work, 'context.json'), JSON.stringify({ head: 'abcdef1234' }));
  return work;
}

const saved = (extra: Partial<SavedFinding> = {}): SavedFinding => ({
  id: 1, severity: 'major', file: 'src/a.ts', line: 12, startLine: 10, title: 'Bug', body: 'Body', suggestion: null,
  easySummary: null, decision: null, url: null, edited: false, editError: null, editSession: null, ...extra,
});

describe('findings files', () => {
  test('reads the findings saved for a PR, unless they predate the session', async () => {
    const work = await workdir([
      { id: 1, severity: 'minor', file: 'a.ts', line: 3, start_line: null, title: 'Edge case', body: 'Body', suggestion: null, easy_summary: ' En clair. ' },
    ]);
    await utimes(join(work, 'findings.json'), 2000, 2000); // seconds
    const s = skills({ findingsDir: dir });
    expect(await s.readFindings(PR, 1_000_000)).toEqual({
      findings: [{
        id: 1, severity: 'minor', file: 'a.ts', line: 3, startLine: null, title: 'Edge case', body: 'Body', suggestion: null,
        easySummary: 'En clair.', decision: null, url: null, edited: false, editError: null, editSession: null,
      }],
      head: 'abcdef1234',
    });
    expect(await s.readFindings(PR, 3_000_000)).toBeNull(); // from an earlier review
    expect(await s.readFindings({ ...PR, number: 8 }, 0)).toBeNull();
  });

  test('updateFinding changes one finding and keeps the fields the app does not know', async () => {
    const work = await workdir([
      { id: 1, title: 'A', body: 'x', custom: 'kept', edit_session: 'e1' },
      { id: 2, title: 'B', body: 'y' },
    ]);
    const s = skills({ findingsDir: dir });
    await s.updateFinding(PR, 1, { decision: 'posted', url: 'https://u', edit_session: undefined });
    expect(JSON.parse(await readFile(join(work, 'findings.json'), 'utf8'))).toEqual([
      { id: 1, title: 'A', body: 'x', custom: 'kept', decision: 'posted', url: 'https://u' },
      { id: 2, title: 'B', body: 'y' },
    ]);
    await expect(s.updateFinding(PR, 9, { decision: 'dropped' })).rejects.toThrow('No finding 9');
  });
});

describe('posting script', () => {
  /** Fake `python` running a shell script in place of post_comment.py. */
  async function fakePython(script: string) {
    const work = await workdir([]);
    const bin = join(dir, 'python');
    await writeFile(bin, `#!/bin/sh\n${script}\n`);
    await chmod(bin, 0o755);
    return { work, s: skills({ findingsDir: dir, python: bin, postScript: '/skills/post_comment.py' }) };
  }

  test('placement asks the script where the comment would land, without the server token', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'secret');
    const { s } = await fakePython('[ -z "$GITHUB_TOKEN" ] || exit 3; printf "%s|" "$@" >&2; echo \'{"mode": "inline"}\'');
    expect(await s.placement(PR, saved())).toBe('inline');
  });

  test('post writes the approved body and passes every value as one argument', async () => {
    const { work, s } = await fakePython('printf "%s\\n" "$@" > "$(dirname "$0")/args"; echo \'{"mode": "inline", "url": "https://github.com/c/1"}\'');
    const url = await s.post(PR, saved({ file: '--evil; rm -rf ~' }), 'abcdef1234', 'The **body**', 'inline');
    expect(url).toBe('https://github.com/c/1');
    expect(await readFile(join(work, 'comment-1.md'), 'utf8')).toBe('The **body**');
    expect((await readFile(join(dir, 'args'), 'utf8')).trim().split('\n')).toEqual([
      '-I', '/skills/post_comment.py', 'post', '--repo=DiliTrust/service-clm', '--pr=7', '--path=--evil; rm -rf ~', '--line=12',
      '--start-line=10', '--commit=abcdef1234', `--body-file=${join(work, 'comment-1.md')}`, '--expect-mode=inline',
    ]);
  });

  test('post reports a placement that changed since the approval, and other failures', async () => {
    const moved = await fakePython('echo \'{"error": "placement changed", "approved": "inline", "now": "file"}\'; exit 2');
    await expect(moved.s.post(PR, saved(), 'abcdef1234', 'b', 'inline')).rejects.toBeInstanceOf(PlacementChanged);
    await rm(dir, { recursive: true, force: true });
    const broken = await fakePython('echo "error: gh api: Not Found" >&2; exit 1');
    await expect(broken.s.post(PR, saved(), 'abcdef1234', 'b', 'inline')).rejects.toThrow('error: gh api: Not Found');
    await expect(broken.s.placement(PR, saved({ line: null }))).rejects.toThrow('no file or line');
  });
});

test('parseFindings keeps well-formed findings, most severe first, with their decision', () => {
  expect(parseFindings({ not: 'an array' })).toEqual([]);
  const base = { decision: null, url: null, edited: false, editError: null, editSession: null, easySummary: null };
  expect(parseFindings([
    { id: 2, severity: 'nit', file: 'b.ts', line: 1, title: 'Naming', body: 'Rename', suggestion: 'x', decision: 'posted', url: 'https://u' },
    null,
    { id: 3, severity: 'critical', file: 'a.ts', line: 10, start_line: 8, title: 'Crash', body: 'Fix it', suggestion: '', edited: true, edit_session: 'e-1' },
    { id: 4, severity: 'weird', title: 'Unknown severity', line: -1, decision: 'maybe', edit_session: '../x', edit_error: 'Oops' },
    { id: 5, severity: 'major' }, // no title
  ])).toEqual([
    { ...base, id: 3, severity: 'critical', file: 'a.ts', line: 10, startLine: 8, title: 'Crash', body: 'Fix it', suggestion: null, edited: true, editSession: 'e-1' },
    { ...base, id: 4, severity: 'minor', file: '', line: null, startLine: null, title: 'Unknown severity', body: '', suggestion: null, editError: 'Oops' },
    { ...base, id: 2, severity: 'nit', file: 'b.ts', line: 1, startLine: null, title: 'Naming', body: 'Rename', suggestion: 'x', decision: 'posted', url: 'https://u' },
  ]);
});

test('commentBody writes the comment as /pick-change does, without the easy summary', () => {
  expect(commentBody({ severity: 'major', title: 'Bug', body: 'It breaks.\n', suggestion: 'fixed();\n' }))
    .toBe('**🟠 Major**: Bug\n\nIt breaks.\n\n```suggestion\nfixed();\n```');
  expect(commentBody({ severity: 'nit', title: 'Naming', body: 'Rename it.', suggestion: null })).toBe('**⚪ Nit**: Naming\n\nRename it.');
});

test('the edit session is named after the finding and gets the request and the current finding', () => {
  expect(editName(PR, 3)).toBe('edit service-clm#7 finding 3');
  const prompt = editPrompt(PR, saved({ easySummary: 'En clair.' }), 'Make it shorter');
  expect(prompt).toContain('https://github.com/DiliTrust/service-clm/pull/7');
  expect(prompt).toContain('"""\nMake it shorter\n"""');
  expect(prompt).toContain('"easy_summary": "En clair."');
  expect(prompt).toContain('Never post to GitHub');
});

test('parseEdit reads the edited finding from the session\'s answer', () => {
  expect(parseEdit('```json\n{"title": " Shorter ", "body": "New body", "suggestion": null, "easy_summary": "Plus court."}\n```')).toEqual({
    title: 'Shorter', body: 'New body', suggestion: null, easy_summary: 'Plus court.',
  });
  expect(parseEdit('{"title": "T", "body": "B", "suggestion": "x()"}')).toEqual({ title: 'T', body: 'B', suggestion: 'x()', easy_summary: null });
  expect(parseEdit('I could not do it.')).toBeNull();
  expect(parseEdit('{"title": "", "body": "B"}')).toBeNull();
  expect(parseEdit('{ broken')).toBeNull();
  expect(parseEdit(null)).toBeNull();
});
