import { useState, type FormEvent } from 'react';
import type { SessionInfo } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';

export function LoginPage({ onLogin }: { onLogin: (s: SessionInfo) => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError('');
    try {
      onLogin(await api.login(token.trim()));
    } catch (err) {
      setError(`Échec de connexion : ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>Github Board</h1>
        <p>Organisez vos Pull Requests dans des colonnes construites à partir de recherches GitHub, avec épinglage, snooze, notes et tags personnels.</p>
        <label htmlFor="tokenInput">Personal Access Token GitHub</label>
        <input type="password" id="tokenInput" value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_… ou github_pat_…" autoComplete="off" />
        <p className="hint">
          Scope requis : <code>repo</code> (classic) ou accès en lecture <em>Pull requests</em>, <em>Contents</em>, <em>Commit statuses</em> et <em>Checks</em> (fine-grained).
          Le token est conservé par le serveur Github Board le temps de la session (jamais dans le navigateur).{' '}
          Pour éviter de le saisir, définissez <code>GITHUB_TOKEN</code> dans <code>.env</code>.{' '}
          <a href="https://github.com/settings/tokens/new?scopes=repo&description=Github%20Board" target="_blank" rel="noopener noreferrer">Créer un token</a>
        </p>
        <button className="btn primary" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <p className="error">{error}</p>
      </form>
    </section>
  );
}
