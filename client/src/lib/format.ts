// Display helpers.

const AGE_UNITS: [string, number][] = [
  ['y', 31536000], ['mo', 2592000], ['w', 604800], ['d', 86400], ['h', 3600], ['min', 60],
];

/** Compact elapsed time since a date: "45 min", "5 h", "3 d", "2 w", "4 mo", "2 y". */
export function age(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  for (const [unit, sec] of AGE_UNITS) {
    if (s < sec) continue;
    const n = Math.floor(s / sec);
    return `${n} ${unit}`;
  }
  return '< 1 min';
}
