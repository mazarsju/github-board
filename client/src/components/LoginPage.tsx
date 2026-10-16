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
      setError(`Sign-in failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>Github Board</h1>
        <p>All open pull requests of the tracked repositories, one row per PR: author, age, approvals, status and size.</p>
        <label htmlFor="tokenInput">GitHub personal access token</label>
        <input type="password" id="tokenInput" value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_… or github_pat_…" autoComplete="off" />
        <p className="hint">
          Required scope: <code>repo</code> (classic) or read access to <em>Pull requests</em>, <em>Commit statuses</em> and <em>Checks</em> (fine-grained).
          The token is kept by the Github Board server for the session (never in the browser).{' '}
          To skip this step, set <code>GITHUB_TOKEN</code> in <code>.env</code>.{' '}
          <a href="https://github.com/settings/tokens/new?scopes=repo&description=Github%20Board" target="_blank" rel="noopener noreferrer">Create a token</a>
        </p>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="error">{error}</p>
      </form>
    </section>
  );
}
