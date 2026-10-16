// List view: every open PR of the tracked repositories, one compact row per PR, grouped by repository.
import { useQuery } from '@tanstack/react-query';
import { listQuery, REQUIRED_APPROVALS } from '../../../shared/config.ts';
import { groupByRepo, matchesFilter, prStatus, toggleCollapsed } from '../../../shared/state.ts';
import type { PrDetails, PrStatus, PullRequest } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { age } from '../lib/format.ts';
import { useAppState } from '../state/AppState.tsx';

const QUERY = listQuery();
/** Maximum page size of the GitHub search API. */
const LIMIT = 100;
/** GitHub computes mergeability lazily: poll a few times while it is still "unknown". */
const UNKNOWN_POLL_MS = 10_000;
const UNKNOWN_MAX_POLLS = 5;

/** When to fetch a PR's details again: neither mergeability nor CI completion changes its updatedAt. */
function detailsPollInterval(d: PrDetails | undefined, polls: number, refresh: number): number | false {
  if (d?.mergeableState === 'unknown' && polls < UNKNOWN_MAX_POLLS) return UNKNOWN_POLL_MS;
  if (d?.ci === 'pending' && refresh > 0) return refresh * 1000;
  return false;
}

const STATUS: Record<PrStatus, [className: string, label: string]> = {
  'ci-failed': ['ko strong', 'CI FAILED'],
  draft: ['draft', 'Draft'],
  conflict: ['ko', 'Conflit'],
  changes: ['ko', 'Changements demandés'],
  approved: ['ok', 'Approuvée'],
  pending: ['wait', 'Review en attente'],
};

export function PrList({ filter }: { filter: string }) {
  const { state, update } = useAppState();
  const { refresh, collapsed } = state.settings;
  const toggle = (repo: string) => update((s) => ({ ...s, settings: toggleCollapsed(s.settings, repo) }));
  const { data, error, isPending } = useQuery({
    queryKey: ['search', QUERY, 'created', LIMIT],
    queryFn: () => api.search(QUERY, 'created', LIMIT),
    refetchInterval: refresh > 0 ? refresh * 1000 : false,
  });
  const all = data?.items ?? [];
  const items = all.filter((pr) => matchesFilter(pr, filter));
  const total = data?.total ?? 0;

  let body;
  if (error) body = <p className="list-message error">{error.message}</p>;
  else if (isPending) body = <p className="list-message">Chargement…</p>;
  else if (!items.length) body = <p className="list-message">{all.length ? 'Aucune PR ne correspond au filtre' : 'Aucune PR ouverte 🎉'}</p>;
  else {
    body = (
      <div className="pr-list-wrap">
        <table className="pr-list">
          <thead>
            <tr>
              <th scope="col">PR</th>
              <th scope="col">Auteur</th>
              <th scope="col">Ouverte depuis</th>
              <th scope="col" className="num">Approbations</th>
              <th scope="col">Statut</th>
              <th scope="col" className="num">Taille</th>
            </tr>
          </thead>
          {groupByRepo(items).map(({ repo, prs }) => {
            // Rows of a collapsed group are not rendered, so their details are not fetched either.
            const open = !collapsed.includes(repo);
            return (
              <tbody key={repo} className={open ? undefined : 'collapsed'}>
                <tr className="group">
                  <th scope="rowgroup" colSpan={6}>
                    <button type="button" aria-expanded={open} title={open ? 'Replier' : 'Déplier'} onClick={() => toggle(repo)}>
                      <span className="chevron" aria-hidden="true">▾</span>
                      {repo.split('/')[1]} <span className="muted">· {prs.length}</span>
                    </button>
                  </th>
                </tr>
                {open && prs.map((pr) => <PrRow key={pr.key} pr={pr} refresh={refresh} />)}
              </tbody>
            );
          })}
        </table>
      </div>
    );
  }

  return (
    <section className="list-view" aria-label="Liste des PRs">
      {data && (
        <p className="list-count">
          {items.length} PR(s) ouverte(s)
          {items.length < all.length && ` sur ${all.length} (filtre)`}
          {total > all.length && ` · ${all.length} plus récentes sur ${total}`}
        </p>
      )}
      {body}
    </section>
  );
}

function PrRow({ pr, refresh }: { pr: PullRequest; refresh: number }) {
  const { data: d, error } = useQuery({
    queryKey: ['details', pr.key, pr.updatedAt],
    queryFn: () => api.details(pr),
    staleTime: Infinity,
    retry: false,
    refetchInterval: (q) => detailsPollInterval(q.state.data, q.state.dataUpdateCount, refresh),
  });
  const status = d ? prStatus(pr, d) : pr.draft ? 'draft' : null;
  const loading = <span className="muted" title={error ? error.message : 'Chargement…'}>{error ? '—' : '…'}</span>;

  return (
    <tr data-key={pr.key}>
      <td className="title">
        <a href={pr.url} target="_blank" rel="noopener noreferrer" title={pr.title}>{pr.title}</a> <span className="muted">#{pr.number}</span>
      </td>
      <td className="author">
        {pr.author ? <><img src={`${pr.author.avatar}&s=32`} alt="" loading="lazy" /> {pr.author.login}</> : '—'}
      </td>
      <td title={`Ouverte le ${new Date(pr.createdAt).toLocaleString('fr-FR')}`}>{age(pr.createdAt)}</td>
      <td className="num">
        {d ? <span className={d.approvals >= REQUIRED_APPROVALS ? 'approvals ok' : 'approvals'}>{d.approvals}/{REQUIRED_APPROVALS}</span> : loading}
      </td>
      <td>{status ? <span className={`badge ${STATUS[status][0]}`}>{STATUS[status][1]}</span> : loading}</td>
      <td className="num diff" title={d ? `${d.changedFiles} fichier(s)` : undefined}>
        {d ? <><span className="add">+{d.additions}</span> <span className="del">−{d.deletions}</span></> : loading}
      </td>
    </tr>
  );
}
