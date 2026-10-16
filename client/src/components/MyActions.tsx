// "Actions for me", highlighted above the list: the user's own PRs waiting for them,
// and the finished "Review" sessions, with their synthesis and findings.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { matchesFilter } from '../../../shared/state.ts';
import type { FindingSeverity, MyAction, PullRequest, ReviewFinding, ReviewSession } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAppState } from '../state/AppState.tsx';
import { PrRow } from './PrRow.tsx';
import { FindingDialog, findingPlace, SEVERITY, SynthesisDialog } from './ReviewDialogs.tsx';

const COLUMNS = 6;

function Reasons({ action: { approved, unanswered } }: { action: MyAction }) {
  return (
    <span className="reasons">
      {approved && <span className="badge ok strong" title="Enough approvals to merge">Ready to merge</span>}
      {unanswered > 0 && (
        <span className="badge wait strong" title="Unresolved review threads, or a conversation whose last message is not yours (bots excluded)">
          {unanswered} unanswered comment{unanswered === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}

/** Count of findings per severity, e.g. "1 Critical · 2 Minor". */
function FindingCounts({ findings }: { findings: ReviewFinding[] }) {
  if (!findings.length) return <span className="badge ok">No findings</span>;
  const counts = new Map<FindingSeverity, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  return <>{[...counts].map(([severity, n]) => (
    <span key={severity} className={`badge ${SEVERITY[severity][1]}`}>{n} {SEVERITY[severity][0]}</span>
  ))}</>;
}

/** A finished review: its PR row, then one row per finding, opening its detail. */
function ReviewEntry({ review, pr, refresh, onRead }: {
  review: ReviewSession; pr: PullRequest; refresh: number; onRead: () => void;
}) {
  const [open, setOpen] = useState<ReviewFinding | 'synthesis' | null>(null);
  // Same query as the synthesis dialog: fetched once.
  const { data, error } = useQuery({
    queryKey: ['review-result', review.id],
    queryFn: () => api.reviewResult(review.id),
    staleTime: Infinity,
    retry: false,
  });
  const findings = data?.findings ?? [];
  return (
    <>
      <PrRow row={{ pr, depth: 0 }} refresh={refresh} action={
        <span className="reasons">
          <button type="button" className="btn primary small" title="Result of the Claude review" onClick={() => setOpen('synthesis')}>Review summary</button>
          {review.state === 'failed' && <span className="badge ko strong" title="The Claude session ended with an error">Review failed</span>}
          {data?.findings && <FindingCounts findings={data.findings} />}
          {error && <span className="muted" title={error.message}>—</span>}
        </span>
      } />
      {findings.map((f) => (
        <tr key={f.id} className="finding-row">
          <td colSpan={COLUMNS}>
            <button type="button" className="finding" onClick={() => setOpen(f)}>
              <span className={`badge ${SEVERITY[f.severity][1]}`}>{SEVERITY[f.severity][0]}</span>
              <span className="finding-title">{f.title}</span>
              {f.file && <code className="muted">{findingPlace(f)}</code>}
              {f.suggestion && <span className="badge" title="Fix proposed">suggestion</span>}
            </button>
          </td>
        </tr>
      ))}
      {open === 'synthesis' && <SynthesisDialog review={review} onClose={() => setOpen(null)} onDismiss={onRead} />}
      {open && open !== 'synthesis' && <FindingDialog finding={open} pr={pr} head={data?.head ?? null} onClose={() => setOpen(null)} />}
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
