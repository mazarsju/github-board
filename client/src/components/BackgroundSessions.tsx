// Top bar counter of the Claude background sessions still running on the server's machine,
// opening the list of those sessions, each of which can be stopped.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RunningSession } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { age } from '../lib/format.ts';
import { Modal } from './Modal.tsx';

/** Above this many running sessions, the counter turns red with a warning. */
export const MAX_BACKGROUND_SESSIONS = 4;
const POLL_MS = 15_000;

function SessionsDialog({ sessions, onClose }: { sessions: RunningSession[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState('');
  const stop = async (s: RunningSession) => {
    setStopping(s.id);
    setError('');
    try {
      await api.stopBackground(s.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['background'] }),
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
      ]);
    } catch (err) {
      setError(`Could not stop ${s.name}: ${(err as Error).message}`);
    } finally {
      setStopping(null);
    }
  };
  return (
    <Modal title="Claude background sessions" subtitle="Running on the server's machine" cancelLabel="Close" className="wide" onClose={onClose}>
      {sessions.length > MAX_BACKGROUND_SESSIONS && (
        <p className="error">⚠ {sessions.length} sessions are running: stop the ones you no longer need.</p>
      )}
      {sessions.length ? (
        <ul className="session-list" aria-label="Running sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              <span className="session-name">{s.name}</span>
              <span className="badge" title="State reported by the Claude CLI">{s.state || 'unknown'}</span>
              <span className="muted" title={new Date(s.startedAt).toLocaleString('en-GB')}>{age(new Date(s.startedAt).toISOString())}</span>
              <code className="muted">{s.id}</code>
              <button type="button" className="btn small danger" disabled={stopping === s.id} onClick={() => void stop(s)}
                aria-label={`Stop ${s.name}`}>{stopping === s.id ? 'Stopping…' : 'Stop'}</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">No background session is running.</p>}
      {error && <p className="error">{error}</p>}
      <p className="hint">Stopping keeps the conversation: <code>claude attach &lt;id&gt;</code> still opens it.</p>
    </Modal>
  );
}

export function BackgroundSessions() {
  const [open, setOpen] = useState(false);
  const { data, error } = useQuery({ queryKey: ['background'], queryFn: api.background, refetchInterval: POLL_MS, retry: false });
  // The CLI is only reachable on the server's machine: nothing to show elsewhere.
  if (error || !data) return null;
  const n = data.length;
  const tooMany = n > MAX_BACKGROUND_SESSIONS;
  const label = `${n} Claude background session${n === 1 ? '' : 's'} running${tooMany ? ': too many, stop some' : ''}`;
  return (
    <>
      <button type="button" className={`btn sessions-count${tooMany ? ' too-many' : ''}`} title={label} aria-label={label} onClick={() => setOpen(true)}>
        {tooMany && <span aria-hidden="true">⚠ </span>}✦ {n}
      </button>
      {open && <SessionsDialog sessions={data} onClose={() => setOpen(false)} />}
    </>
  );
}
