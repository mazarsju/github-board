// One row of a PR table: title, author (or action), age, approvals, status and size.
import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { REQUIRED_APPROVALS } from '../../../shared/config.ts';
import { prStatus } from '../../../shared/state.ts';
import type { PrDetails, PrStatus, PullRequest, ReviewSession, StackedPr } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { age } from '../lib/format.ts';
import { AttachDialog } from './ReviewDialogs.tsx';

/** Deepest indentation of a stacked PR; deeper levels stay aligned on it. */
const MAX_INDENT = 6;
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
  conflict: ['ko', 'Conflict'],
  changes: ['ko', 'Changes requested'],
  approved: ['ok', 'Approved'],
  pending: ['wait', 'Review pending'],
};

/** Small 4-point star, the "Review with Claude" icon. */
function SparkIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 0l1.8 6.2L16 8l-6.2 1.8L8 16l-1.8-6.2L0 8l6.2-1.8z" /></svg>;
}

function ReviewButton({ pr, onReview }: { pr: PullRequest; onReview: (pr: PullRequest) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const label = `Review with Claude: ${pr.repo}#${pr.number}`;
  return (
    <button type="button" className={`btn icon${busy ? ' spinning' : ''}`} title={label} aria-label={label} disabled={busy}
      onClick={() => { setBusy(true); void onReview(pr).finally(() => setBusy(false)); }}>
      <SparkIcon />
    </button>
  );
}

/** Shown instead of the Review button while the PR's review session runs: tells how to open it. */
function RunningReviewButton({ review }: { review: ReviewSession }) {
  const [open, setOpen] = useState(false);
  const label = review.state === 'waiting' ? 'Review waiting for your answer: open the session' : 'Review running: open the session';
  return (
    <>
      <button type="button" className={`btn icon running${review.state === 'waiting' ? ' waiting' : ''}`} title={label} aria-label={label} onClick={() => setOpen(true)}>
        <SparkIcon />
      </button>
      {open && <AttachDialog review={review} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * One PR row. With `action`, the row belongs to "Actions for me": the action replaces the
 * author (always the user) and the project name precedes the title. With `onReview`, a last
 * cell holds the "Review" button, replaced by a "running" button while `review` runs.
 */
export function PrRow({ row: { pr, depth, stackSize = 1, parent }, stackEnd = false, refresh, action, onReview, review }: {
  row: StackedPr; stackEnd?: boolean; refresh: number; action?: ReactNode;
  onReview?: (pr: PullRequest) => Promise<void>; review?: ReviewSession;
}) {
  const { data: d, error } = useQuery({
    queryKey: ['details', pr.key, pr.updatedAt],
    queryFn: () => api.details(pr),
    staleTime: Infinity,
    retry: false,
    refetchInterval: (q) => detailsPollInterval(q.state.data, q.state.dataUpdateCount, refresh),
  });
  const status = d ? prStatus(pr, d) : pr.draft ? 'draft' : null;
  const loading = <span className="muted" title={error ? error.message : 'Loading…'}>{error ? '—' : '…'}</span>;

  const inStack = depth > 0 || stackSize > 1;
  const rowClass = inStack ? `in-stack${stackEnd ? ' stack-end' : ''}` : undefined;

  return (
    <tr data-key={pr.key} className={rowClass}>
      <td className={depth ? 'title stacked' : 'title'} style={depth ? { '--depth': Math.min(depth, MAX_INDENT) } as CSSProperties : undefined}>
        {action && <span className="row-repo">{pr.repo} </span>}
        {parent && <span className="stack-arrow" title={`Stacked on #${parent.number} (${pr.baseRef})`}>↳ </span>}
        <a href={pr.url} target="_blank" rel="noopener noreferrer" title={pr.title}>{pr.title}</a> <span className="muted">#{pr.number}</span>
        {stackSize > 1 && <span className="stack-tag" title={`${stackSize} PRs stacked from this one`}>stack · {stackSize}</span>}
      </td>
      {action ? <td className="action">{action}</td> : (
        <td className="author">
          {pr.author ? <><img src={`${pr.author.avatar}&s=32`} alt="" loading="lazy" /> {pr.author.login}</> : '—'}
        </td>
      )}
      <td title={`Opened on ${new Date(pr.createdAt).toLocaleString('en-GB')}`}>{age(pr.createdAt)}</td>
      <td className="num">
        {d ? <span className={d.approvals >= REQUIRED_APPROVALS ? 'approvals ok' : 'approvals'}>{d.approvals}/{REQUIRED_APPROVALS}</span> : loading}
      </td>
      <td>{status ? <span className={`badge ${STATUS[status][0]}`}>{STATUS[status][1]}</span> : loading}</td>
      <td className="num diff" title={d ? `${d.changedFiles} file${d.changedFiles === 1 ? '' : 's'}` : undefined}>
        {d ? <><span className="add">+{d.additions}</span> <span className="del">−{d.deletions}</span></> : loading}
      </td>
      {onReview && (
        <td className="row-actions">
          {review?.running ? <RunningReviewButton review={review} /> : <ReviewButton pr={pr} onReview={onReview} />}
        </td>
      )}
    </tr>
  );
}
