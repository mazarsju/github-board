// One row of a PR table: title, author (or action), age, approvals, status and size.
import { useQuery } from '@tanstack/react-query';
import type { CSSProperties, ReactNode } from 'react';
import { REQUIRED_APPROVALS } from '../../../shared/config.ts';
import { prStatus } from '../../../shared/state.ts';
import type { PrDetails, PrStatus, StackedPr } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { age } from '../lib/format.ts';

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
  conflict: ['ko', 'Conflit'],
  changes: ['ko', 'Changements demandés'],
  approved: ['ok', 'Approuvée'],
  pending: ['wait', 'Review en attente'],
};

/**
 * One PR row. With `action`, the row belongs to "Actions pour moi": the action replaces the
 * author (always the user) and the project name precedes the title.
 */
export function PrRow({ row: { pr, depth, stackSize = 1, parent }, stackEnd = false, refresh, action }: {
  row: StackedPr; stackEnd?: boolean; refresh: number; action?: ReactNode;
}) {
  const { data: d, error } = useQuery({
    queryKey: ['details', pr.key, pr.updatedAt],
    queryFn: () => api.details(pr),
    staleTime: Infinity,
    retry: false,
    refetchInterval: (q) => detailsPollInterval(q.state.data, q.state.dataUpdateCount, refresh),
  });
  const status = d ? prStatus(pr, d) : pr.draft ? 'draft' : null;
  const loading = <span className="muted" title={error ? error.message : 'Chargement…'}>{error ? '—' : '…'}</span>;

  const inStack = depth > 0 || stackSize > 1;
  const rowClass = inStack ? `in-stack${stackEnd ? ' stack-end' : ''}` : undefined;

  return (
    <tr data-key={pr.key} className={rowClass}>
      <td className={depth ? 'title stacked' : 'title'} style={depth ? { '--depth': Math.min(depth, MAX_INDENT) } as CSSProperties : undefined}>
        {action && <span className="row-repo">{pr.repo} </span>}
        {parent && <span className="stack-arrow" title={`Empilée sur #${parent.number} (${pr.baseRef})`}>↳ </span>}
        <a href={pr.url} target="_blank" rel="noopener noreferrer" title={pr.title}>{pr.title}</a> <span className="muted">#{pr.number}</span>
        {stackSize > 1 && <span className="stack-tag" title={`${stackSize} PRs empilées à partir de celle-ci`}>stack · {stackSize}</span>}
      </td>
      {action ? <td className="action">{action}</td> : (
        <td className="author">
          {pr.author ? <><img src={`${pr.author.avatar}&s=32`} alt="" loading="lazy" /> {pr.author.login}</> : '—'}
        </td>
      )}
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
