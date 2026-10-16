import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';

/** Reports the tracked repositories (shared/config.ts) the token cannot read. */
export function RepoAlert() {
  const { data } = useQuery({ queryKey: ['repos-access'], queryFn: api.repoAccess, staleTime: Infinity });
  const denied = (data ?? []).filter((r) => !r.ok);
  if (!denied.length) return null;
  return (
    <div className="alert" role="alert">
      <strong>No access to {denied.length} tracked repositor{denied.length > 1 ? 'ies' : 'y'}: their PRs will not be listed.</strong>
      <ul>
        {denied.map((r) => (
          <li key={r.repo}>
            <code>{r.repo}</code> — {r.status === 404 ? 'not found, or not accessible with this token' : r.error}
          </li>
        ))}
      </ul>
      <span className="muted">Check the token's repo scope and, for an SSO organization, click “Configure SSO” → “Authorize” in the token's settings.</span>
    </div>
  );
}
