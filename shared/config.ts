// Project configuration: GitHub repositories tracked by the app.
// To add or remove a repository, just edit this list ("owner/repo").
export const REPOS: readonly string[] = [
  'DiliTrust/service-clm',
  'DiliTrust/DT_Public_API',
  'DiliTrust/webapp-clm',
];

/** Jira project whose tickets "Actions for me" lists; other projects' tickets are shown attached to them. */
export const JIRA_PROJECT = 'CLM';

/** Number of approvals a PR needs to be mergeable. */
export const REQUIRED_APPROVALS = 2;
