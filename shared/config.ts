// Project configuration: GitHub repositories tracked by the app.
// To add or remove a repository, just edit this list ("owner/repo").
export const REPOS: readonly string[] = [
  'DiliTrust/service-clm',
  'DiliTrust/DT_Public_API',
  'DiliTrust/webapp-clm',
];

/** Number of approvals a PR needs to be mergeable. */
export const REQUIRED_APPROVALS = 2;

/** GitHub search query listing every open PR of the given repositories (repo: qualifiers are OR-ed). */
export function listQuery(repos: readonly string[] = REPOS): string {
  return `is:open ${repos.map((r) => `repo:${r}`).join(' ')}`;
}
