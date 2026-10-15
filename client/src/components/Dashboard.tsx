import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { moveColumn } from '../../../shared/state.ts';
import type { Column, PullRequest, SessionInfo } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAppState } from '../state/AppState.tsx';
import { ColumnDialog } from './ColumnDialog.tsx';
import { ColumnView } from './ColumnView.tsx';
import { PrDialog } from './PrDialog.tsx';
import { RepoAlert } from './RepoAlert.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';

const LOGO = 'M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.25 2.25 0 1 0 1.5 0Zm7.5 5.256V6.5A2.5 2.5 0 0 0 10 4H8.56l1.22-1.22-1.06-1.06L5.69 4.75l3.03 3.03 1.06-1.06L8.56 5.5H10a1 1 0 0 1 1 1v4.128a2.251 2.251 0 1 0 1.5 0Z';

export function Logo() {
  return <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"><path fill="currentColor" d={LOGO} /></svg>;
}

export function Dashboard({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const { state, update, activeBoard, updateBoard } = useAppState();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [editingColumn, setEditingColumn] = useState<Column | null | undefined>(undefined);
  const [editingPr, setEditingPr] = useState<PullRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const fetching = useIsFetching({ queryKey: ['search'] }) > 0;
  const rate = useQuery({ queryKey: ['rate'], queryFn: api.rate, refetchInterval: 15_000 });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (fetching) return;
    setUpdatedAt(new Date());
    void queryClient.invalidateQueries({ queryKey: ['rate'] });
  }, [fetching, queryClient]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['search'] });

  // Raccourcis : `/` filtrer, `r` rafraîchir.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
      if (e.key === '/') { e.preventDefault(); filterRef.current?.focus(); }
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) void refresh();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const r = rate.data;
  const rateText = [
    r?.core && `API ${r.core.remaining}/${r.core.limit}`,
    r?.search && `Recherche ${r.search.remaining}/${r.search.limit}`,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <header className="topbar">
        <div className="brand"><Logo /><span>Github Board</span></div>
        <nav className="boards" aria-label="Tableaux">
          {state.boards.map((b) => (
            <button key={b.id} type="button" className={b.id === activeBoard.id ? 'active' : ''}
              onClick={() => update((s) => ({ ...s, activeBoard: b.id }))}>{b.name}</button>
          ))}
        </nav>
        <div className="actions">
          <input ref={filterRef} type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer (titre, repo, auteur, #tag)…" aria-label="Filtrer" />
          <label className="toggle" title="Afficher les PRs masquées / en snooze">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> <span>Masquées</span>
          </label>
          <button type="button" className={`btn${fetching ? ' spinning' : ''}`} title="Rafraîchir (R)" aria-label="Rafraîchir" onClick={() => void refresh()}>⟳</button>
          <button type="button" className="btn" title="Paramètres" aria-label="Paramètres" onClick={() => setSettingsOpen(true)}>⚙</button>
          <img className="avatar" src={session.user.avatarUrl} alt="" title={`Connecté : ${session.user.login}`} />
        </div>
      </header>

      <RepoAlert />

      <main>
        <section className={`board${state.settings.compact ? ' compact' : ''}`} aria-live="polite">
          {activeBoard.columns.map((col) => (
            <ColumnView key={col.id} col={col} filter={filter} showHidden={showHidden}
              onEditColumn={setEditingColumn} onEditPr={setEditingPr}
              dragging={!!dragCol} onDragStart={setDragCol}
              onDrop={(to) => { if (dragCol) updateBoard((b) => moveColumn(b, dragCol, to)); setDragCol(null); }} />
          ))}
          <button type="button" className="add-column" onClick={() => setEditingColumn(null)}>+ Ajouter une colonne</button>
        </section>
      </main>

      <footer className="statusbar">
        <span>{fetching ? 'Chargement…' : updatedAt ? `Mis à jour ${updatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '—'}</span>
        <span>{rateText}</span>
      </footer>

      {editingColumn !== undefined && <ColumnDialog col={editingColumn} onClose={() => setEditingColumn(undefined)} />}
      {editingPr && <PrDialog pr={editingPr} onClose={() => setEditingPr(null)} />}
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} canLogout={!session.envToken}
          onLogout={() => { setSettingsOpen(false); onLogout(); }} />
      )}
    </>
  );
}
