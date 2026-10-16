// List view: every open PR of the tracked repositories, one compact row per PR,
// grouped by repository, stacked PRs kept together under the PR they build on.
import { useQuery } from '@tanstack/react-query';
import { groupByRepo, matchesFilter, orderStacks, toggleCollapsed } from '../../../shared/state.ts';
import { api } from '../lib/api.ts';
import { useAppState } from '../state/AppState.tsx';
import { MyActions } from './MyActions.tsx';
import { PrRow } from './PrRow.tsx';

/** Number of PRs shown: the newest ones across the tracked repositories (each costs ~4 API calls for its details). */
const LIMIT = 100;

export function PrList({ filter }: { filter: string }) {
  const { state, update } = useAppState();
  const { refresh, collapsed } = state.settings;
  const toggle = (repo: string) => update((s) => ({ ...s, settings: toggleCollapsed(s.settings, repo) }));
  const { data, error, isPending } = useQuery({
    queryKey: ['pulls', LIMIT],
    queryFn: () => api.pulls(LIMIT),
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
                {open && orderStacks(prs).map((row, i, rows) => (
                  // The last row of a stack is followed by the next root (depth 0), or by nothing.
                  <PrRow key={row.pr.key} row={row} stackEnd={!rows[i + 1]?.depth} refresh={refresh} />
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    );
  }

  return (
    <section className="list-view" aria-label="Liste des PRs">
      <MyActions filter={filter} refresh={refresh} />
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
