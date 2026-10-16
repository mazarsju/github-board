// "Actions pour moi", highlighted above the list: the user's own PRs waiting for them,
// and the syntheses of finished "Review" sessions.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { matchesFilter } from '../../../shared/state.ts';
import type { MyAction, PullRequest, ReviewSession } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAppState } from '../state/AppState.tsx';
import { PrRow } from './PrRow.tsx';
import { SynthesisDialog } from './ReviewDialogs.tsx';

function Reasons({ action: { approved, unanswered } }: { action: MyAction }) {
  return (
    <span className="reasons">
      {approved && <span className="badge ok strong" title="Assez d'approbations pour merger">À merger</span>}
      {unanswered > 0 && (
        <span className="badge wait strong" title="Fils de review non résolus ou conversation dont le dernier message n'est pas le vôtre (bots exclus)">
          {unanswered} commentaire(s) sans réponse
        </span>
      )}
    </span>
  );
}

export function MyActions({ filter, refresh, pulls, reviews }: {
  filter: string; refresh: number; pulls: PullRequest[]; reviews: ReviewSession[];
}) {
  const { state, update } = useAppState();
  const [reading, setReading] = useState<ReviewSession | null>(null);
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
    setReading(null);
  };

  if (error && !syntheses.length) return <p className="my-actions-empty error">Actions pour moi indisponibles : {error.message}</p>;
  if (!data && !syntheses.length) return null;
  const actions = (data ?? []).filter((a) => matchesFilter(a.pr, filter));
  if (!actions.length && !syntheses.length) return <p className="my-actions-empty">Actions pour moi : rien en attente ✓</p>;

  return (
    <section className="my-actions" aria-label="Actions pour moi">
      <h2>Actions pour moi <span className="count">{actions.length + syntheses.length}</span></h2>
      <div className="pr-list-wrap">
        <table className="pr-list">
          <thead>
            <tr>
              <th scope="col">PR</th>
              <th scope="col">Action</th>
              <th scope="col">Ouverte depuis</th>
              <th scope="col" className="num">Approbations</th>
              <th scope="col">Statut</th>
              <th scope="col" className="num">Taille</th>
            </tr>
          </thead>
          <tbody>
            {syntheses.map(({ review, pr }) => (
              <PrRow key={`review-${review.id}`} row={{ pr, depth: 0 }} refresh={refresh} action={
                <button type="button" className="btn primary small" title="Résultat de la review Claude" onClick={() => setReading(review)}>Synthèse review</button>
              } />
            ))}
            {actions.map((a) => <PrRow key={a.pr.key} row={{ pr: a.pr, depth: 0 }} refresh={refresh} action={<Reasons action={a} />} />)}
          </tbody>
        </table>
      </div>
      {reading && <SynthesisDialog review={reading} onClose={() => setReading(null)} onDismiss={() => dismiss(reading)} />}
    </section>
  );
}
