import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import type { SessionInfo, Theme } from '../../shared/types.ts';
import { Dashboard, Logo } from './components/Dashboard.tsx';
import { LoginPage } from './components/LoginPage.tsx';
import { useToast } from './components/Toast.tsx';
import { api } from './lib/api.ts';
import { AppStateProvider, useAppState } from './state/AppState.tsx';

function applyTheme(theme: Theme) {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

function ThemeSync() {
  const { state } = useAppState();
  useEffect(() => applyTheme(state.settings.theme), [state.settings.theme]);
  return null;
}

function Shell({ children, status }: { children?: ReactNode; status: string }) {
  return (
    <>
      <header className="topbar"><div className="brand"><Logo /><span>Github Board</span></div></header>
      <main>{children}</main>
      <footer className="statusbar"><span>{status}</span></footer>
    </>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const session = useQuery({ queryKey: ['session'], queryFn: api.getSession, staleTime: Infinity });
  const user = session.data?.user.login;
  const appState = useQuery({ queryKey: ['state', user], queryFn: api.getState, enabled: !!user, staleTime: Infinity });

  const onLogin = (s: SessionInfo) => queryClient.setQueryData(['session'], s);
  const onLogout = async () => {
    await api.logout().catch(() => {});
    queryClient.clear();
    queryClient.setQueryData(['session'], null);
  };

  if (session.isPending) return <Shell status="Connexion…" />;
  if (session.error) return <Shell status={`Serveur injoignable : ${session.error.message}`} />;
  if (!session.data) return <Shell status="Non connecté"><LoginPage onLogin={onLogin} /></Shell>;
  if (appState.error) return <Shell status={`Chargement impossible : ${appState.error.message}`} />;
  if (!appState.data) return <Shell status="Chargement…" />;

  return (
    <AppStateProvider key={user} initial={appState.data} onSaveError={(err) => toast(`Sauvegarde impossible : ${err.message}`)}>
      <ThemeSync />
      <Dashboard session={session.data} onLogout={() => void onLogout()} />
    </AppStateProvider>
  );
}
