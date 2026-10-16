// List view: every open PR of the tracked repositories, one compact row per PR,
// grouped by repository, stacked PRs kept together under the PR they build on.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PullRequest } from '../../../shared/types.ts';
import { groupByRepo, matchesFilter, orderStacks, toggleCollapsed } from '../../../shared/state.ts';
import { api } from '../lib/api.ts';
import { useAppState } from '../state/AppState.tsx';
import { useToast } from './Toast.tsx';
import { MyActions } from './MyActions.tsx';
import { PrRow } from './PrRow.tsx';

/** Number of PRs shown: the newest ones across the tracked repositories (each costs ~5 API calls for its details). */
const LIMIT = 100;
/** How often review sessions are checked while one of them runs. */
const RUNNING_REVIEW_POLL_MS = 5_000;

export function PrList({ filter }: { filter: string }) {
  const { state, update } = useAppState();
  const { refresh, collapsed } = state.settings;
  const toggle = (repo: string) => update((s) => ({ ...s, settings: toggleCollapsed(s.settings, repo) }));
  const toast = useToast();
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ['reviews'],
    queryFn: api.reviews,
    retry: false,
    refetchInterval: (q) => (q.state.data?.some((r) => r.running) ? RUNNING_REVIEW_POLL_MS : refresh > 0 ? refresh * 1000 : false),
  });
  const reviewByKey = new Map((reviews.data ?? []).map((r) => [r.key, r]));
  const review = async (pr: PullRequest) => {
    try {
      const { name } = await api.review(pr);
      toast(`Claude session started in the background. To follow it: claude attach "${name}"`, 10_000);
      await queryClient.invalidateQueries({ queryKey: ['reviews'] });
    } catch (err) {
      toast((err as Error).message, 10_000);
    }
  };
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
  else if (isPending) body = <p className="list-message">Loading…</p>;
  else if (!items.length) body = <p className="list-message">{all.length ? 'No PR matches the filter' : 'No open PR 🎉'}</p>;
  else {
    body = (
      <div className="pr-list-wrap">
        <table className="pr-list">
          <thead>
            <tr>
              <th scope="col">PR</th>
              <th scope="col">Author</th>
              <th scope="col">Open for</th>
              <th scope="col" className="num">Approvals</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">Size</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          {groupByRepo(items).map(({ repo, prs }) => {
            // Rows of a collapsed group are not rendered, so their details are not fetched either.
            const open = !collapsed.includes(repo);
            return (
              <tbody key={repo} className={open ? undefined : 'collapsed'}>
                <tr className="group">
                  <th scope="rowgroup" colSpan={7}>
                    <button type="button" aria-expanded={open} title={open ? 'Collapse' : 'Expand'} onClick={() => toggle(repo)}>
                      <span className="chevron" aria-hidden="true">▾</span>
                      {repo.split('/')[1]} <span className="muted">· {prs.length}</span>
                    </button>
                  </th>
                </tr>
                {open && orderStacks(prs).map((row, i, rows) => (
                  // The last row of a stack is followed by the next root (depth 0), or by nothing.
                  <PrRow key={row.pr.key} row={row} stackEnd={!rows[i + 1]?.depth} refresh={refresh} onReview={review} review={reviewByKey.get(row.pr.key)} />
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    );
  }

  return (
    <section className="list-view" aria-label="PR list">
      <MyActions filter={filter} refresh={refresh} pulls={all} reviews={reviews.data ?? []} />
      {data && (
        <p className="list-count">
          {items.length} open PR{items.length === 1 ? '' : 's'}
          {items.length < all.length && ` of ${all.length} (filtered)`}
          {total > all.length && ` · newest ${all.length} of ${total}`}
        </p>
      )}
      {body}
    </section>
  );
}
