import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';

/** Signale les dépôts suivis (shared/config.ts) que le token ne peut pas lire. */
export function RepoAlert() {
  const { data } = useQuery({ queryKey: ['repos-access'], queryFn: api.repoAccess, staleTime: Infinity });
  const denied = (data ?? []).filter((r) => !r.ok);
  if (!denied.length) return null;
  return (
    <div className="alert" role="alert">
      <strong>Accès impossible à {denied.length} dépôt(s) suivi(s) : leurs PRs n'apparaîtront pas.</strong>
      <ul>
        {denied.map((r) => (
          <li key={r.repo}>
            <code>{r.repo}</code> — {r.status === 404 ? 'introuvable ou non accessible avec ce token' : r.error}
          </li>
        ))}
      </ul>
      <span className="muted">Vérifiez le scope repo du token et, pour une organisation SSO, cliquez sur « Configure SSO » → « Authorize » dans les paramètres du token.</span>
    </div>
  );
}
