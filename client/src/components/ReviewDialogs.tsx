// Dialogs of the "Review" background sessions: how to follow a running one, the synthesis of a finished one
// and the detail of one of its findings.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CodeExcerpt, FindingSeverity, PullRequest, ReviewFinding, ReviewSession } from '../../../shared/types.ts';
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
function Synthesis({ text }: { text: string }) {
  return (
    <div className="synthesis markdown">
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

/** Detail of a finding, as GitHub shows a review comment: the code, the comment, the suggested change. */
export function FindingDialog({ finding: f, pr, head, onClose }: {
  finding: ReviewFinding; pr: PullRequest; head: string | null; onClose: () => void;
}) {
  const [label, className] = SEVERITY[f.severity];
  const from = f.startLine && f.line && f.startLine < f.line ? f.startLine : f.line;
  const lines = f.line ? `#L${f.startLine && f.startLine < f.line ? `${f.startLine}-L${f.line}` : f.line}` : '';
  const codeUrl = head && f.file
    ? `https://github.com/${pr.owner}/${pr.repo}/blob/${head}/${f.file.split('/').map(encodeURIComponent).join('/')}${lines}`
    : null;
  return (
    <Modal title={f.title} subtitle={`${pr.repo}#${pr.number} · finding ${f.id}`} cancelLabel="Close" className="wide code" onClose={onClose}>
      <p className="finding-meta">
        <span className={`badge ${className}`}>{label}</span>
        {f.file && (codeUrl
          ? <a href={codeUrl} target="_blank" rel="noopener noreferrer"><code>{findingPlace(f)}</code></a>
          : <code>{findingPlace(f)}</code>)}
      </p>
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
      <p className="hint">To post findings on GitHub: <code>{pickChange(pr)}</code></p>
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
          : <Synthesis text={data.text ?? '_The session left no final message._'} />}
      {/* A finished session is no longer found by name: attach takes its id. */}
      <p className="hint">To continue the conversation: <code>claude attach {review.id}</code></p>
    </Modal>
  );
}
