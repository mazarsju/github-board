// Line diff between two short blocks of code (a finding's lines and its suggestion).

export interface DiffLine {
  kind: 'same' | 'del' | 'add';
  text: string;
}

/** Lines of `before` replaced by `after`, unchanged lines kept as context (longest common subsequence). */
export function lineDiff(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  // common[i][j]: length of the longest common subsequence of before[i..] and after[j..].
  const common = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i]![j] = before[i] === after[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: 'same', text: before[i++]! });
      j++;
    } else if (common[i + 1]![j]! >= common[i]![j + 1]!) {
      out.push({ kind: 'del', text: before[i++]! });
    } else {
      out.push({ kind: 'add', text: after[j++]! });
    }
  }
  while (i < n) out.push({ kind: 'del', text: before[i++]! });
  while (j < m) out.push({ kind: 'add', text: after[j++]! });
  return out;
}

/** Lines of a suggestion: a trailing newline does not add an empty line. */
export const toLines = (code: string): string[] => code.replace(/\n$/, '').split('\n');
