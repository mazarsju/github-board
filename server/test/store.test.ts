import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { defaultState } from '../../shared/state.ts';
import { JsonFileStore } from '../src/store.ts';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

test('JsonFileStore persists the state per user', async () => {
  dir = await mkdtemp(join(tmpdir(), 'gb-'));
  const file = join(dir, 'sub', 'state.json');
  const store = new JsonFileStore(file);

  expect(await store.get('alice')).toEqual(defaultState()); // missing file → defaults
  await store.set('alice', { settings: { refresh: 60, theme: 'dark', collapsed: ['DiliTrust/webapp-clm'], dismissedReviews: ['r1'] } });
  await store.set('bob', defaultState());

  const raw = JSON.parse(await readFile(file, 'utf8'));
  expect(Object.keys(raw.users)).toEqual(['alice', 'bob']);
  expect(await new JsonFileStore(file).get('alice')).toEqual({ settings: { refresh: 60, theme: 'dark', collapsed: ['DiliTrust/webapp-clm'], dismissedReviews: ['r1'] } });
});

test('JsonFileStore reads files written by the old board version', async () => {
  dir = await mkdtemp(join(tmpdir(), 'gb-'));
  const file = join(dir, 'state.json');
  await writeFile(file, JSON.stringify({ users: { alice: { boards: [], prs: { 'o/r#1': { pinned: true } }, settings: { refresh: 900, theme: 'light', compact: true } } } }));
  expect(await new JsonFileStore(file).get('alice')).toEqual({ settings: { refresh: 900, theme: 'light', collapsed: [], dismissedReviews: [] } });
});
