import { useQuery } from '@tanstack/react-query';
import { isSnoozed } from '../../../shared/state.ts';
import type { PrDetails, PrMeta, PullRequest } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { ago, labelStyle } from '../lib/format.ts';
import { useAppState } from '../state/AppState.tsx';
import { useToast } from './Toast.tsx';

export function PrCard({ pr, meta, isNew, onEdit }: {
  pr: PullRequest; meta: PrMeta; isNew: boolean; onEdit: (pr: PullRequest) => void;
}) {
  const { state, setPrMeta } = useAppState();
  const toast = useToast();
  const snoozed = isSnoozed(meta);
  const withDetails = state.settings.details && pr.state === 'open';
  const details = useQuery({
    queryKey: ['details', pr.key, pr.updatedAt],
    queryFn: () => api.details(pr),
    enabled: withDetails,
    staleTime: Infinity,
    retry: false,
  });

  const classes = ['card'];
  if (meta.pinned) classes.push('pinned');
  if (meta.priority) classes.push(`prio-${meta.priority}`);
  if (meta.hidden || snoozed) classes.push('dimmed');
  if (isNew) classes.push('is-new');

  return (
    <article className={classes.join(' ')} data-key={pr.key}>
      <div className="card-top">
        <span className="repo">{pr.owner}/{pr.repo} #{pr.number}</span>
        <div className="card-actions">
          <button type="button" className="btn icon" title={meta.pinned ? 'Désépingler' : 'Épingler'} aria-label={meta.pinned ? 'Désépingler' : 'Épingler'}
            onClick={() => setPrMeta(pr.key, { pinned: !meta.pinned })}>{meta.pinned ? '★' : '☆'}</button>
          <button type="button" className="btn icon" title="Notes, tags, priorité, snooze" aria-label="Notes, tags, priorité, snooze" onClick={() => onEdit(pr)}>✎</button>
          <button type="button" className="btn icon" title={meta.hidden ? 'Réafficher' : 'Masquer'} aria-label={meta.hidden ? 'Réafficher' : 'Masquer'}
            onClick={() => { setPrMeta(pr.key, { hidden: !meta.hidden }); toast(meta.hidden ? 'PR réaffichée' : 'PR masquée'); }}>
            {meta.hidden ? '◉' : '⊘'}
          </button>
        </div>
      </div>
      <a className="card-title" href={pr.url} target="_blank" rel="noopener noreferrer">{pr.title}</a>
      <div className="card-meta">
        {pr.author && <span><img src={`${pr.author.avatar}&s=32`} alt="" loading="lazy" /> {pr.author.login}</span>}
        <span title={new Date(pr.updatedAt).toLocaleString('fr-FR')}>{ago(pr.updatedAt)}</span>
        {pr.comments > 0 && <span title="Commentaires">💬 {pr.comments}</span>}
        {pr.draft && <span className="badge draft">Brouillon</span>}
        {pr.state === 'merged' && <span className="badge ok">Mergée</span>}
        {pr.state === 'closed' && <span className="badge ko">Fermée</span>}
        {snoozed && <span className="badge wait" title="Snooze">⏰ {new Date(meta.snoozeUntil!).toLocaleDateString('fr-FR')}</span>}
      </div>
      {(pr.labels.length > 0 || !!meta.tags?.length) && (
        <div className="labels">
          {pr.labels.map((l) => <span key={l.name} className="label" style={labelStyle(l.color)}>{l.name}</span>)}
          {meta.tags?.map((t) => <span key={t} className="tag">#{t}</span>)}
        </div>
      )}
      {meta.note && <div className="note">{meta.note}</div>}
      {withDetails && details.data && <DetailsBadges d={details.data} />}
    </article>
  );
}

const CI = { success: ['ok', '✓ CI'], failure: ['ko', '✗ CI'], pending: ['wait', '● CI'], none: null } as const;
const REVIEW = { approved: ['ok', '✓ Approuvée'], changes: ['ko', '✗ Changements demandés'], pending: ['wait', 'Review en attente'] } as const;

export function DetailsBadges({ d }: { d: PrDetails }) {
  const ci = CI[d.ci];
  const rv = REVIEW[d.review];
  return (
    <div className="card-meta details">
      {ci && <span className={`badge ${ci[0]}`}>{ci[1]}</span>}
      <span className={`badge ${rv[0]}`}>{rv[1]}</span>
      {d.mergeableState === 'dirty' && <span className="badge ko" title="Conflits avec la branche cible">Conflits</span>}
      <span className="diff" title={`${d.changedFiles} fichier(s)`}>
        <span className="add">+{d.additions}</span> <span className="del">−{d.deletions}</span>
      </span>
      {d.requestedReviewers.length > 0 && <span title="Relecteurs demandés">👀 {d.requestedReviewers.join(', ')}</span>}
    </div>
  );
}
