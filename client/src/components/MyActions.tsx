// "Actions pour moi": the user's own PRs waiting for them, highlighted above the list.
import { useQuery } from '@tanstack/react-query';
import { matchesFilter } from '../../../shared/state.ts';
import type { MyAction } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { PrRow } from './PrRow.tsx';

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

export function MyActions({ filter, refresh }: { filter: string; refresh: number }) {
  // Key under "pulls" so that the refresh button and the loading indicator include it.
  const { data, error } = useQuery({
    queryKey: ['pulls', 'actions'],
    queryFn: api.actions,
    refetchInterval: refresh > 0 ? refresh * 1000 : false,
  });
  if (error) return <p className="my-actions-empty error">Actions pour moi indisponibles : {error.message}</p>;
  if (!data) return null;
  const actions = data.filter((a) => matchesFilter(a.pr, filter));
  if (!actions.length) return <p className="my-actions-empty">Actions pour moi : rien en attente ✓</p>;

  return (
    <section className="my-actions" aria-label="Actions pour moi">
      <h2>Actions pour moi <span className="count">{actions.length}</span></h2>
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
            {actions.map((a) => <PrRow key={a.pr.key} row={{ pr: a.pr, depth: 0 }} refresh={refresh} action={<Reasons action={a} />} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
