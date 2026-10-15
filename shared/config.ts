// Configuration du projet : dépôts GitHub suivis par l'application.
// Pour ajouter ou retirer un dépôt, modifiez simplement cette liste ("owner/repo").
export const REPOS: readonly string[] = [
  'DiliTrust/service-clm',
  'DiliTrust/DT_Public_API',
  'DiliTrust/webapp-clm',
];

/** Qualificatifs de recherche GitHub ciblant les dépôts donnés (combinés en OU par GitHub). */
export function reposQuery(repos: readonly string[] = REPOS): string {
  return repos.map((r) => `repo:${r}`).join(' ');
}
