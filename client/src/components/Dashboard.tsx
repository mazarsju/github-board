import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { PrList } from './PrList.tsx';
import { RepoAlert } from './RepoAlert.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';

const LOGO = 'M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.25 2.25 0 1 0 1.5 0Zm7.5 5.256V6.5A2.5 2.5 0 0 0 10 4H8.56l1.22-1.22-1.06-1.06L5.69 4.75l3.03 3.03 1.06-1.06L8.56 5.5H10a1 1 0 0 1 1 1v4.128a2.251 2.251 0 1 0 1.5 0Z';

export function Logo() {
  return <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"><path fill="currentColor" d={LOGO} /></svg>;
}

export function Dashboard({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // Shortcuts: `/` filter, `r` refresh.
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
        <div className="actions">
          <input ref={filterRef} type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer (titre, projet, auteur)…" aria-label="Filtrer" />
          <button type="button" className={`btn${fetching ? ' spinning' : ''}`} title="Rafraîchir (R)" aria-label="Rafraîchir" onClick={() => void refresh()}>⟳</button>
          <button type="button" className="btn" title="Paramètres" aria-label="Paramètres" onClick={() => setSettingsOpen(true)}>⚙</button>
          <img className="avatar" src={session.user.avatarUrl} alt="" title={`Connecté : ${session.user.login}`} />
        </div>
      </header>

      <RepoAlert />

      <main>
        <PrList filter={filter} />
      </main>

      <footer className="statusbar">
        <span>{fetching ? 'Chargement…' : updatedAt ? `Mis à jour ${updatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '—'}</span>
        <span>{rateText}</span>
      </footer>

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} canLogout={!session.envToken}
          onLogout={() => { setSettingsOpen(false); onLogout(); }} />
      )}
    </>
  );
}
