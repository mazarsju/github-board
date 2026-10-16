import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { BackgroundSessions } from './BackgroundSessions.tsx';
import { PrList } from './PrList.tsx';
import { RepoAlert } from './RepoAlert.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';

const LOGO = 'M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.25 2.25 0 1 0 1.5 0Zm7.5 5.256V6.5A2.5 2.5 0 0 0 10 4H8.56l1.22-1.22-1.06-1.06L5.69 4.75l3.03 3.03 1.06-1.06L8.56 5.5H10a1 1 0 0 1 1 1v4.128a2.251 2.251 0 1 0 1.5 0Z';

// GitHub Octicons (sync-16, gear-16).
const SYNC = 'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z';
const GEAR = 'M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z';

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
}

export function Logo() {
  return <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"><path fill="currentColor" d={LOGO} /></svg>;
}

export function Dashboard({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const fetching = useIsFetching({ queryKey: ['pulls'] }) > 0;
  const rate = useQuery({ queryKey: ['rate'], queryFn: api.rate, refetchInterval: 15_000 });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (fetching) return;
    setUpdatedAt(new Date());
    void queryClient.invalidateQueries({ queryKey: ['rate'] });
  }, [fetching, queryClient]);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['pulls'] }),
    queryClient.invalidateQueries({ queryKey: ['reviews'] }),
    queryClient.invalidateQueries({ queryKey: ['background'] }),
  ]);

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

  const core = rate.data?.core;
  const rateText = core ? `API ${core.remaining}/${core.limit}` : '';

  return (
    <>
      <header className="topbar">
        <div className="brand"><Logo /><span>Github Board</span></div>
        <div className="actions">
          <input ref={filterRef} type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter (title, project, author)…" aria-label="Filter" />
          <button type="button" className={`btn square${fetching ? ' busy' : ''}`} title="Refresh (R)" aria-label="Refresh" onClick={() => void refresh()}><Icon d={SYNC} /></button>
          <BackgroundSessions />
          <button type="button" className="btn square" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Icon d={GEAR} /></button>
          <img className="avatar" src={session.user.avatarUrl} alt="" title={`Signed in: ${session.user.login}`} />
        </div>
      </header>

      <RepoAlert />

      <main>
        <PrList filter={filter} />
      </main>

      <footer className="statusbar">
        <span>{fetching ? 'Loading…' : updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '—'}</span>
        <span>{rateText}</span>
      </footer>

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} canLogout={!session.envToken}
          onLogout={() => { setSettingsOpen(false); onLogout(); }} />
      )}
    </>
  );
}
