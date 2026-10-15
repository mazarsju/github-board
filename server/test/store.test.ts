import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { defaultState } from '../../shared/state.ts';
import { JsonFileStore } from '../src/store.ts';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

test('JsonFileStore persiste l’état par utilisateur', async () => {
  dir = await mkdtemp(join(tmpdir(), 'gb-'));
  const file = join(dir, 'sub', 'state.json');
  const store = new JsonFileStore(file);

  expect((await store.get('alice')).boards[0]!.id).toBe('repos'); // fichier absent → défaut
  await store.set('alice', { ...defaultState(), prs: { 'o/r#1': { note: 'a' } } });
  await store.set('bob', defaultState());

  const raw = JSON.parse(await readFile(file, 'utf8'));
  expect(Object.keys(raw.users)).toEqual(['alice', 'bob']);
  expect((await new JsonFileStore(file).get('alice')).prs).toEqual({ 'o/r#1': { note: 'a' } });
});
