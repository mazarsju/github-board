// Dialogs of the "Review" background sessions: how to follow a running one, and the synthesis of a finished one.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReviewSession } from '../../../shared/types.ts';
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
          : <Synthesis text={data.text} />}
      {/* A finished session is no longer found by name: attach takes its id. */}
      <p className="hint">Pour poursuivre la conversation : <code>claude attach {review.id}</code></p>
    </Modal>
  );
}
