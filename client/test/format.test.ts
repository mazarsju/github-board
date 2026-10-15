import { expect, test } from 'vitest';
import { defaultState } from '../../shared/state.ts';
import { exportConfig, parseConfig } from '../src/components/SettingsDialog.tsx';
import { ago, githubSearchUrl, labelStyle } from '../src/lib/format.ts';

test('ago formate une durée relative en français', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  expect(ago('2026-10-15T11:58:00Z', now)).toBe('il y a 2 minutes');
  expect(ago('2026-10-14T12:00:00Z', now)).toBe('hier');
  expect(ago('2026-10-15T11:59:50Z', now)).toBe('à l’instant');
});

test('labelStyle choisit un texte lisible', () => {
  expect(labelStyle('ffffff')).toEqual({ background: '#ffffff', color: '#1f2328' });
  expect(labelStyle('000000')).toEqual({ background: '#000000', color: '#fff' });
});

test('githubSearchUrl ajoute is:pr si absent', () => {
  expect(githubSearchUrl('is:open')).toBe('https://github.com/pulls?q=is%3Apr%20is%3Aopen');
  expect(githubSearchUrl('is:pr x')).toBe('https://github.com/pulls?q=is%3Apr%20x');
});

test('export/import de configuration (y compris format de l’ancienne version statique)', () => {
  const current = defaultState();
  const exported = JSON.parse(exportConfig(current));
  expect(exported.seen).toBeUndefined();
  expect(parseConfig(JSON.stringify(exported), current).boards).toEqual(current.boards);

  const legacy = { version: 1, boards: [{ id: 'x', name: 'Ancien', columns: [] }], activeBoard: 'x', prs: { 'o/r#1': { pinned: true } } };
  const imported = parseConfig(JSON.stringify(legacy), current);
  expect(imported.boards.map((b) => b.name)).toEqual(['Dépôts', 'Ancien']);
  expect(imported.prs).toEqual({ 'o/r#1': { pinned: true } });

  expect(() => parseConfig('{"boards":[]}', current)).toThrow('aucun tableau');
});
