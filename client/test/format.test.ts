import { expect, test } from 'vitest';
import { age } from '../src/lib/format.ts';

test('age formats a compact elapsed time', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  expect(age('2026-10-15T11:59:30Z', now)).toBe('< 1 min');
  expect(age('2026-10-15T11:15:00Z', now)).toBe('45 min');
  expect(age('2026-10-15T07:00:00Z', now)).toBe('5 h');
  expect(age('2026-10-12T12:00:00Z', now)).toBe('3 j');
  expect(age('2026-10-01T12:00:00Z', now)).toBe('2 sem.');
  expect(age('2026-06-01T12:00:00Z', now)).toBe('4 mois');
  expect(age('2025-10-15T12:00:00Z', now)).toBe('1 an');
  expect(age('2023-10-01T12:00:00Z', now)).toBe('3 ans');
  expect(age('2026-10-15T12:05:00Z', now)).toBe('< 1 min');
});
