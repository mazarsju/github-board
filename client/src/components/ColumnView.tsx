import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type CSSProperties } from 'react';
import { visiblePrs } from '../../../shared/state.ts';
import type { Column, PullRequest } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { githubSearchUrl } from '../lib/format.ts';
import { useAppState } from '../state/AppState.tsx';
import { PrCard } from './PrCard.tsx';

export function searchQueryKey(col: Column) {
  return ['search', col.query, col.sort, col.limit] as const;
}

export function ColumnView({ col, filter, showHidden, onEditColumn, onEditPr, dragging, onDragStart, onDrop }: {
  col: Column;
  filter: string;
  showHidden: boolean;
  onEditColumn: (col: Column) => void;
  onEditPr: (pr: PullRequest) => void;
  dragging: boolean;
  onDragStart: (id: string | null) => void;
  onDrop: (targetId: string) => void;
}) {
  const { state, update } = useAppState();
  const refresh = state.settings.refresh;
  const { data, error, isPending } = useQuery({
    queryKey: searchQueryKey(col),
    queryFn: () => api.search(col.query, col.sort, col.limit),
    refetchInterval: refresh > 0 ? refresh * 1000 : false,
  });
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [over, setOver] = useState(false);

  // Détection des nouvelles PRs (badge + notification navigateur), à chaque résultat.
  useEffect(() => {
    if (!data) return;
    const prev = state.seen[col.id];
    const newItems = prev ? data.items.filter((i) => !prev.includes(i.key)) : [];
    const keys = data.items.map((i) => i.key);
    update((s) => ({ ...s, seen: { ...s.seen, [col.id]: keys } }));
    setFresh(new Set(newItems.map((i) => i.key)));
    if (col.notify && newItems.length && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(`${col.name} : ${newItems.length} nouvelle(s) PR`, {
        body: newItems.slice(0, 3).map((i) => `${i.repo}#${i.number} ${i.title}`).join('\n'),
        tag: col.id,
      });
      n.onclick = () => { window.focus(); if (newItems.length === 1) window.open(newItems[0]!.url, '_blank'); };
    }
  }, [data]);

  const all = data?.items ?? [];
  const items = visiblePrs(all, state.prs, filter, showHidden);
  const total = data?.total ?? 0;
  const hiddenCount = all.length - items.length;

  let body;
  if (error) body = <div className="column-error">{error.message}</div>;
  else if (isPending) body = <div className="column-empty">Chargement…</div>;
  else if (!items.length) body = <div className="column-empty">{all.length ? 'Tout est filtré ou masqué' : 'Aucune PR 🎉'}</div>;
  else body = items.map(({ pr, meta }) => <PrCard key={pr.key} pr={pr} meta={meta} isNew={fresh.has(pr.key)} onEdit={onEditPr} />);

  return (
    <section
      className={`column${over ? ' drag-over' : ''}`}
      style={{ '--col': col.color } as CSSProperties}
      data-id={col.id}
      aria-label={col.name}
      onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(col.id); }}
    >
      <div className="column-head" draggable title={col.query}
        onDragStart={() => onDragStart(col.id)} onDragEnd={() => onDragStart(null)}>
        <h3>{col.name}</h3>
        <span className="count" title={hiddenCount > 0 ? `${hiddenCount} filtrée(s)/masquée(s)` : ''}>
          {total > all.length ? `${items.length}/${total}` : items.length}
        </span>
        <a className="btn icon" title="Ouvrir la recherche sur GitHub" aria-label="Ouvrir la recherche sur GitHub" href={githubSearchUrl(col.query)} target="_blank" rel="noopener noreferrer">↗</a>
        <button type="button" className="btn icon" title="Modifier la colonne" aria-label="Modifier la colonne" onClick={() => onEditColumn(col)}>✎</button>
      </div>
      <div className="column-body">{body}</div>
    </section>
  );
}
