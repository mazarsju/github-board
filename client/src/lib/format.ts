// Display helpers.

const AGE_UNITS: [string, number][] = [
  ['an', 31536000], ['mois', 2592000], ['sem.', 604800], ['j', 86400], ['h', 3600], ['min', 60],
];

/** Compact elapsed time since a date: "45 min", "5 h", "3 j", "2 sem.", "4 mois", "2 ans". */
export function age(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  for (const [unit, sec] of AGE_UNITS) {
    if (s < sec) continue;
    const n = Math.floor(s / sec);
    return `${n} ${unit === 'an' && n > 1 ? 'ans' : unit}`;
  }
  return '< 1 min';
}
