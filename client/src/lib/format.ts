// Utilitaires d'affichage.

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60],
];

export function ago(iso: string, now = Date.now()): string {
  const s = (new Date(iso).getTime() - now) / 1000;
  for (const [u, sec] of UNITS) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return 'à l’instant';
}

/** Style d'un label GitHub (texte clair ou foncé selon la luminosité du fond). */
export function labelStyle(hex: string): { background: string; color: string } {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const light = (r * 299 + g * 587 + b * 114) / 1000 > 150;
  return { background: `#${hex}`, color: light ? '#1f2328' : '#fff' };
}

/** ISO → valeur d'un <input type="datetime-local"> (heure locale). */
export function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function githubSearchUrl(query: string): string {
  return `https://github.com/pulls?q=${encodeURIComponent(/\bis:pr\b/.test(query) ? query : `is:pr ${query}`)}`;
}
