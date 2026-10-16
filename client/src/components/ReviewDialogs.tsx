// Dialogs of the "Review" background sessions: how to follow a running one, the synthesis of a finished one
// and the detail of one of its findings.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FindingSeverity, PullRequest, ReviewFinding, ReviewSession } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { Modal } from './Modal.tsx';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn" onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
    }}>{copied ? 'Copié ✓' : 'Copier'}</button>
  );
}

/** Command to open a running review session in a terminal. */
export function AttachDialog({ review, onClose }: { review: ReviewSession; onClose: () => void }) {
  const command = `claude attach "${review.name}"`;
  return (
    <Modal title="Review en cours" subtitle={review.name} cancelLabel="Fermer" onClose={onClose}>
      <p>La session Claude tourne en arrière-plan{review.state === 'waiting' ? ' et attend une réponse de votre part' : ''}. Pour l'ouvrir, lancez dans un terminal :</p>
      <div className="command">
        <code>{command}</code>
        <CopyButton text={command} />
      </div>
      <p className="hint">« claude agents » liste toutes les sessions en arrière-plan.</p>
    </Modal>
  );
}

/** Label and badge class of each finding severity. */
export const SEVERITY: Record<FindingSeverity, [label: string, className: string]> = {
  critical: ['Critique', 'sev critical'],
  major: ['Majeur', 'sev major'],
  minor: ['Mineur', 'sev minor'],
  nit: ['Nit', 'sev nit'],
};

/** `file:line` (or `file:start-end`) of a finding. */
export function findingPlace(f: ReviewFinding): string {
  if (!f.line) return f.file;
  return `${f.file}:${f.startLine && f.startLine < f.line ? `${f.startLine}-${f.line}` : f.line}`;
}

/** Command posting chosen findings on GitHub, one confirmation per comment. */
const pickChange = (pr: PullRequest) => `/pick-change ${pr.url}`;

/** Markdown of a review answer. Raw HTML is not rendered; links open in a new tab. */
function Synthesis({ text }: { text: string }) {
  return (
    <div className="synthesis markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      }}>{text}</Markdown>
    </div>
  );
}

/** Detail of a finding, with a link to the code at the reviewed commit. */
export function FindingDialog({ finding: f, pr, head, onClose }: {
  finding: ReviewFinding; pr: PullRequest; head: string | null; onClose: () => void;
}) {
  const [label, className] = SEVERITY[f.severity];
  const lines = f.line ? `#L${f.startLine && f.startLine < f.line ? `${f.startLine}-L${f.line}` : f.line}` : '';
  const codeUrl = head && f.file
    ? `https://github.com/${pr.owner}/${pr.repo}/blob/${head}/${f.file.split('/').map(encodeURIComponent).join('/')}${lines}`
    : null;
  return (
    <Modal title={f.title} subtitle={`${pr.repo}#${pr.number} · finding ${f.id}`} cancelLabel="Fermer" className="wide" onClose={onClose}>
      <p className="finding-meta">
        <span className={`badge ${className}`}>{label}</span>
        {f.file && (codeUrl
          ? <a href={codeUrl} target="_blank" rel="noopener noreferrer"><code>{findingPlace(f)}</code></a>
          : <code>{findingPlace(f)}</code>)}
      </p>
      <Synthesis text={f.body || '_Pas de détail._'} />
      {f.suggestion && <>
        <h3 className="finding-heading">Suggestion</h3>
        <pre className="suggestion"><code>{f.suggestion}</code></pre>
      </>}
      <p className="hint">Pour publier des findings sur GitHub : <code>{pickChange(pr)}</code></p>
    </Modal>
  );
}

/** Final answer of a finished review session, full screen, with a way to mark it as read. */
export function SynthesisDialog({ review, onClose, onDismiss }: { review: ReviewSession; onClose: () => void; onDismiss: () => void }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['review-result', review.id],
    queryFn: () => api.reviewResult(review.id),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <Modal
      title="Synthèse review"
      subtitle={review.name}
      cancelLabel="Fermer"
      className="fullscreen"
      onClose={onClose}
      footer={<button type="button" className="btn" onClick={onDismiss}>Marquer comme lue</button>}
    >
      {error ? <p className="error">{error.message}</p>
        : isPending ? <p className="muted">Chargement…</p>
          : <Synthesis text={data.text ?? '_La session n’a pas laissé de message final._'} />}
      {/* A finished session is no longer found by name: attach takes its id. */}
      <p className="hint">Pour poursuivre la conversation : <code>claude attach {review.id}</code></p>
    </Modal>
  );
}
