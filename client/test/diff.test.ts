import { expect, test } from 'vitest';
import { lineDiff, toLines } from '../src/lib/diff.ts';

test('lineDiff keeps the unchanged lines and marks the replaced ones', () => {
  expect(lineDiff(['a', 'b', 'c'], ['a', 'B', 'c', 'd'])).toEqual([
    { kind: 'same', text: 'a' },
    { kind: 'del', text: 'b' },
    { kind: 'add', text: 'B' },
    { kind: 'same', text: 'c' },
    { kind: 'add', text: 'd' },
  ]);
  expect(lineDiff(['x'], [])).toEqual([{ kind: 'del', text: 'x' }]);
  expect(lineDiff([], ['y'])).toEqual([{ kind: 'add', text: 'y' }]);
});

test('toLines ignores a trailing newline', () => {
  expect(toLines('a\nb\n')).toEqual(['a', 'b']);
  expect(toLines('a')).toEqual(['a']);
});
