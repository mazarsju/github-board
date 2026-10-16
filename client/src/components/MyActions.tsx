// "Actions for me", highlighted above the list: the user's own PRs waiting for them,
// and the finished "Review" sessions, with their synthesis and findings.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { matchesFilter } from '../../../shared/state.ts';
import type { MyAction, PullRequest, ReviewSession } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAppState } from '../state/AppState.tsx';
import { PrRow } from './PrRow.tsx';
import { FindingDialog, findingPlace, SEVERITY, SynthesisDialog } from './ReviewDialogs.tsx';

const COLUMNS = 6;
/** How often a review's findings are checked while one of them is being edited. */
const EDIT_POLL_MS = 5_000;

function Reasons({ action: { approved, unanswered, conflict, ciFailed } }: { action: MyAction }) {
  return (
    <span className="reasons">
      {ciFailed && <span className="badge ko strong" title="A CI check or commit status of the last commit failed">CI FAILED</span>}
      {conflict && <span className="badge ko strong" title="Merge conflict with the base branch">Conflict</span>}
      {approved && <span className="badge ok strong" title="Enough approvals to merge">Ready to merge</span>}
      {unanswered > 0 && (
        <span className="badge wait strong" title="Unresolved review threads, or a conversation whose last message is not yours (bots excluded)">
          {unanswered} unanswered comment{unanswered === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}

/** A finished review: its PR row, then one row per finding, opening its detail. */
function ReviewEntry({ review, pr, refresh, onRead }: {
  review: ReviewSession; pr: PullRequest; refresh: number; onRead: () => void;
}) {
  const [open, setOpen] = useState<number | 'synthesis' | null>(null);
  // Same query as the synthesis dialog: fetched once, then again while a finding is being edited.
  const { data, error } = useQuery({
    queryKey: ['review-result', review.id],
    queryFn: () => api.reviewResult(review.id),
    staleTime: Infinity,
    retry: false,
    refetchInterval: (q) => (q.state.data?.findings?.some((f) => f.editing) ? EDIT_POLL_MS : false),
  });
  // Decided findings (posted or rejected) leave the list; an open detail stays to show the outcome.
  const all = data?.findings ?? [];
  const findings = all.filter((f) => !f.decision);
  const opened = typeof open === 'number' ? all.find((f) => f.id === open) : undefined;
  return (
    <>
      <PrRow row={{ pr, depth: 0 }} refresh={refresh} action={
        <span className="reasons">
          <button type="button" className="btn primary small" title="Result of the Claude review" onClick={() => setOpen('synthesis')}>Review summary</button>
          {review.state === 'failed' && <span className="badge ko strong" title="The Claude session ended with an error">Review failed</span>}
          {data?.findings?.length === 0 && <span className="badge ok">No findings</span>}
          {all.length > 0 && !findings.length && <span className="badge ok" title="Every finding was posted or rejected">All findings handled</span>}
          {error && <span className="muted" title={error.message}>—</span>}
        </span>
      } />
      {findings.map((f) => (
        <tr key={f.id} className="finding-row">
          <td colSpan={COLUMNS}>
            <button type="button" className="finding" onClick={() => setOpen(f.id)}>
              <span className={`badge ${SEVERITY[f.severity][1]}`}>{SEVERITY[f.severity][0]}</span>
              <span className="finding-title">{f.title}</span>
              {f.file && <code className="muted">{findingPlace(f)}</code>}
              {f.suggestion && <span className="badge" title="Fix proposed">suggestion</span>}
              {f.editing && <span className="badge wait" title="Claude is rewriting this finding">editing…</span>}
            </button>
          </td>
        </tr>
      ))}
      {open === 'synthesis' && <SynthesisDialog review={review} onClose={() => setOpen(null)} onDismiss={onRead} />}
      {opened && <FindingDialog finding={opened} pr={pr} head={data?.head ?? null} jiraTickets={data?.jiraTickets ?? []} review={review.id} onClose={() => setOpen(null)} />}
    </>
  );
}

export function MyActions({ filter, refresh, pulls, reviews }: {
  filter: string; refresh: number; pulls: PullRequest[]; reviews: ReviewSession[];
}) {
  const { state, update } = useAppState();
  // Key under "pulls" so that the refresh button and the loading indicator include it.
  const { data, error } = useQuery({
    queryKey: ['pulls', 'actions'],
    queryFn: api.actions,
    refetchInterval: refresh > 0 ? refresh * 1000 : false,
  });
  const byKey = new Map(pulls.map((pr) => [pr.key, pr]));
  // Finished reviews not marked as read, for PRs still in the list.
  const syntheses = reviews
    .filter((r) => !r.running && !state.settings.dismissedReviews.includes(r.id))
    .map((review) => ({ review, pr: byKey.get(review.key) }))
    .filter((s): s is { review: ReviewSession; pr: PullRequest } => !!s.pr && matchesFilter(s.pr, filter));
  const dismiss = (review: ReviewSession) => {
    update((s) => ({ ...s, settings: { ...s.settings, dismissedReviews: [...s.settings.dismissedReviews, review.id] } }));
  };

  if (error && !syntheses.length) return <p className="my-actions-empty error">Actions for me unavailable: {error.message}</p>;
  if (!data && !syntheses.length) return null;
  const actions = (data ?? []).filter((a) => matchesFilter(a.pr, filter));
  if (!actions.length && !syntheses.length) return <p className="my-actions-empty">Actions for me: nothing pending ✓</p>;

  return (
    <section className="my-actions" aria-label="Actions for me">
      <h2>Actions for me <span className="count">{actions.length + syntheses.length}</span></h2>
      <div className="pr-list-wrap">
        <table className="pr-list">
          <thead>
            <tr>
              <th scope="col">PR</th>
              <th scope="col">Action</th>
              <th scope="col">Open for</th>
              <th scope="col" className="num">Approvals</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">Size</th>
            </tr>
          </thead>
          <tbody>
            {syntheses.map(({ review, pr }) => (
              <ReviewEntry key={`review-${review.id}`} review={review} pr={pr} refresh={refresh} onRead={() => dismiss(review)} />
            ))}
            {actions.map((a) => <PrRow key={a.pr.key} row={{ pr: a.pr, depth: 0 }} refresh={refresh} action={<Reasons action={a} />} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
