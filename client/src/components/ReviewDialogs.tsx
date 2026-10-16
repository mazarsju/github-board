// Dialogs of the "Review" background sessions: how to follow a running one, the synthesis of a finished one
// and the detail of one of its findings.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  CodeExcerpt, FindingPlacement, FindingSeverity, JiraTicket, PullRequest, ReviewFinding, ReviewSession,
} from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { lineDiff, toLines, type DiffLine } from '../lib/diff.ts';
import { Modal } from './Modal.tsx';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn" onClick={() => {
      void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
    }}>{copied ? 'Copied ✓' : 'Copy'}</button>
  );
}

/** Command to open a running review session in a terminal. */
export function AttachDialog({ review, onClose }: { review: ReviewSession; onClose: () => void }) {
  const command = `claude attach "${review.name}"`;
  return (
    <Modal title="Review running" subtitle={review.name} cancelLabel="Close" onClose={onClose}>
      <p>The Claude session runs in the background{review.state === 'waiting' ? ' and waits for your answer' : ''}. To open it, run in a terminal:</p>
      <div className="command">
        <code>{command}</code>
        <CopyButton text={command} />
      </div>
      <p className="hint"><code>claude agents</code> lists all background sessions.</p>
    </Modal>
  );
}

/** Label and badge class of each finding severity. */
export const SEVERITY: Record<FindingSeverity, [label: string, className: string]> = {
  critical: ['Critical', 'sev critical'],
  major: ['Major', 'sev major'],
  minor: ['Minor', 'sev minor'],
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
function Synthesis({ text, className = 'synthesis', lang }: { text: string; className?: string; lang?: string }) {
  return (
    <div className={`${className} markdown`} lang={lang}>
      <Markdown remarkPlugins={[remarkGfm]} components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      }}>{text}</Markdown>
    </div>
  );
}

type CodeLine = DiffLine & { number: number | null };

/** Lines of code with their numbers; `marked` lines (the commented ones) are highlighted. */
function CodeBlock({ lines, label, marked }: { lines: CodeLine[]; label: string; marked?: (line: CodeLine) => boolean }) {
  return (
    <div className="code-view" role="table" aria-label={label}>
      {lines.map((l, i) => (
        <div key={i} role="row" className={`code-line ${l.kind}${marked?.(l) ? ' marked' : ''}`}>
          <span role="cell" className="code-num">{l.number ?? ''}</span>
          <span role="cell" className="code-sign">{l.kind === 'del' ? '−' : l.kind === 'add' ? '+' : ''}</span>
          <span role="cell" className="code-text">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}

/** The excerpt's lines, numbered. */
const numbered = (code: CodeExcerpt): CodeLine[] =>
  code.lines.map((text, i) => ({ kind: 'same', text, number: code.start + i }));

/**
 * The suggestion as a diff of the commented lines (`from`..`to`), between the excerpt's
 * context lines. Added lines have no number, as on GitHub.
 */
function suggestionDiff(code: CodeExcerpt, from: number, to: number, suggestion: string): CodeLine[] {
  const all = numbered(code);
  const before = all.filter((l) => l.number! < from);
  const target = all.filter((l) => l.number! >= from && l.number! <= to);
  const after = all.filter((l) => l.number! > to);
  let n = from;
  const changed = lineDiff(target.map((l) => l.text), toLines(suggestion))
    .map((d): CodeLine => ({ ...d, number: d.kind === 'add' ? null : n++ }));
  return [...before, ...changed, ...after];
}

/** Where a comment lands on GitHub, in words. */
function placementText(mode: FindingPlacement, f: ReviewFinding): string {
  if (mode === 'inline') return `Inline comment on ${findingPlace(f)}`;
  if (mode === 'file') return `Comment on the file ${f.file} (the lines are outside the PR's diff)`;
  return 'General PR comment, with a link to the lines (the file is not in the PR)';
}

/** Name of the session editing a finding (as the server names it). */
const editSessionName = (pr: PullRequest, f: ReviewFinding) => `edit ${pr.repo}#${pr.number} finding ${f.id}`;

type Step = 'view' | 'approve' | 'edit';

/**
 * Decision on a finding, at the bottom of its detail: approve (shows the exact comment and where
 * it lands, then posts it on a second click), reject, or ask Claude to edit it.
 */
function FindingDecision({ finding: f, pr, review, step, setStep, onDone }: {
  finding: ReviewFinding; pr: PullRequest; review: string; step: Step; setStep: (s: Step) => void; onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState('');
  const placement = useQuery({
    queryKey: ['finding-placement', review, f.id, f.body, f.title, f.suggestion],
    queryFn: () => api.findingPlacement(review, f.id),
    enabled: step === 'approve',
    retry: false,
    staleTime: 0,
  });
  const run = async (action: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['review-result', review] });
      after();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (f.decision === 'posted') {
    return <p className="decision ok">Posted on GitHub ✓ {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer">See the comment</a>}</p>;
  }
  if (f.editing) {
    return (
      <p className="decision wait">
        Claude is rewriting this finding… You will be asked again once it is done.{' '}
        <span className="muted">To follow it: <code>claude attach "{editSessionName(pr, f)}"</code></span>
      </p>
    );
  }
  return (
    <>
      {f.editError && <p className="error">Last edit not applied: {f.editError}</p>}
      {step === 'approve' && (
        <section className="decision-step" aria-label="Comment to post">
          <h3 className="finding-heading">Comment to post</h3>
          {placement.isPending ? <p className="muted">Checking where it lands…</p>
            : placement.error ? <p className="error">{placement.error.message}</p>
              : <>
                <p className="placement">{placementText(placement.data.mode, f)}, at the reviewed commit.</p>
                <Synthesis text={placement.data.body} className="comment-preview" />
              </>}
        </section>
      )}
      {step === 'edit' && (
        <label className="decision-step">What should change?
          <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} maxLength={2000} autoFocus
            placeholder="e.g. Make it shorter, drop the suggestion, mention the null case…" />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="decision-buttons">
        {step === 'view' && <>
          <button type="button" className="btn primary" onClick={() => setStep('approve')}>Approve</button>
          <button type="button" className="btn" onClick={() => setStep('edit')}>Edit</button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void run(() => api.rejectFinding(review, f.id), onDone)}>Reject</button>
        </>}
        {step === 'approve' && <>
          <button type="button" className="btn primary" disabled={busy || !placement.data}
            onClick={() => void run(() => api.postFinding(review, f.id, placement.data!), () => setStep('view'))}>
            {busy ? 'Posting…' : 'Post on GitHub'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setStep('view')}>Back</button>
        </>}
        {step === 'edit' && <>
          <button type="button" className="btn primary" disabled={busy || !request.trim()}
            onClick={() => void run(() => api.editFinding(review, f.id, request), () => setStep('view'))}>
            {busy ? 'Sending…' : 'Send to Claude'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setStep('view')}>Back</button>
        </>}
      </div>
    </>
  );
}

/** The Jira tickets the review used as context, one button-like link each, opening the ticket. */
function JiraLinks({ tickets }: { tickets: JiraTicket[] }) {
  if (!tickets.length) return null;
  return (
    <nav className="jira-links" aria-label="Jira tickets">
      <span className="muted">Jira context:</span>
      {tickets.map((t) => (
        <a key={t.url} className="btn small" href={t.url} target="_blank" rel="noopener noreferrer" title={`Open ${t.key} in Jira`}>{t.key}</a>
      ))}
    </nav>
  );
}

/** Detail of a finding, as GitHub shows a review comment: the code, the comment, the suggested change, and the decision. */
export function FindingDialog({ finding: f, pr, head, jiraTickets, review, onClose }: {
  finding: ReviewFinding; pr: PullRequest; head: string | null; jiraTickets: JiraTicket[]; review: string; onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('view');
  const [label, className] = SEVERITY[f.severity];
  const from = f.startLine && f.line && f.startLine < f.line ? f.startLine : f.line;
  const lines = f.line ? `#L${f.startLine && f.startLine < f.line ? `${f.startLine}-L${f.line}` : f.line}` : '';
  const codeUrl = head && f.file
    ? `https://github.com/${pr.owner}/${pr.repo}/blob/${head}/${f.file.split('/').map(encodeURIComponent).join('/')}${lines}`
    : null;
  return (
    <Modal title={f.title} subtitle={`${pr.repo}#${pr.number} · finding ${f.id}`} cancelLabel="Close" className="wide code" onClose={onClose}>
      <JiraLinks tickets={jiraTickets} />
      <p className="finding-meta">
        <span className={`badge ${className}`}>{label}</span>
        {f.edited && <span className="badge" title="Rewritten at your request">edited</span>}
        {f.file && (codeUrl
          ? <a href={codeUrl} target="_blank" rel="noopener noreferrer"><code>{findingPlace(f)}</code></a>
          : <code>{findingPlace(f)}</code>)}
      </p>
      {f.easySummary && (
        <details className="easy-summary">
          <summary><span aria-hidden="true">👶</span> Easy explanation of the problem</summary>
          {/* Written in French by the skill, for the user only. */}
          <Synthesis text={f.easySummary} className="easy-text" lang="fr" />
        </details>
      )}
      {f.code && from && f.line && (
        <CodeBlock lines={numbered(f.code)} label="Commented code" marked={(l) => l.number! >= from && l.number! <= f.line!} />
      )}
      <Synthesis text={f.body || '_No details._'} />
      {f.suggestion && <>
        <h3 className="finding-heading">Suggested change</h3>
        {f.code && from && f.line
          ? <CodeBlock lines={suggestionDiff(f.code, from, f.line, f.suggestion)} label="Suggested change" />
          : <CodeBlock lines={toLines(f.suggestion).map((text) => ({ kind: 'add', text, number: null }))} label="Suggested change" />}
      </>}
      <FindingDecision finding={f} pr={pr} review={review} step={step} setStep={setStep} onDone={onClose} />
      <p className="hint">Or go through all the findings in Claude Code: <code>{pickChange(pr)}</code></p>
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
      title="Review summary"
      subtitle={review.name}
      cancelLabel="Close"
      className="fullscreen"
      onClose={onClose}
      footer={<button type="button" className="btn" onClick={onDismiss}>Mark as read</button>}
    >
      {error ? <p className="error">{error.message}</p>
        : isPending ? <p className="muted">Loading…</p>
          : <>
            <JiraLinks tickets={data.jiraTickets ?? []} />
            <Synthesis text={data.text ?? '_The session left no final message._'} />
          </>}
      {/* A finished session is no longer found by name: attach takes its id. */}
      <p className="hint">To continue the conversation: <code>claude attach {review.id}</code></p>
    </Modal>
  );
}
