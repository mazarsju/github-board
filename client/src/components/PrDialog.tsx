import { useState } from 'react';
import { isSnoozed } from '../../../shared/state.ts';
import type { Priority, PullRequest } from '../../../shared/types.ts';
import { toLocalInput } from '../lib/format.ts';
import { useAppState } from '../state/AppState.tsx';
import { Modal } from './Modal.tsx';

/** Organisation personnelle d'une PR : tags, priorité, note, snooze. */
export function PrDialog({ pr, onClose }: { pr: PullRequest; onClose: () => void }) {
  const { state, setPrMeta } = useAppState();
  const meta = state.prs[pr.key] ?? {};
  const [tags, setTags] = useState((meta.tags ?? []).join(', '));
  const [priority, setPriority] = useState<Priority | ''>(meta.priority ?? '');
  const [note, setNote] = useState(meta.note ?? '');
  const [snooze, setSnooze] = useState(isSnoozed(meta) ? toLocalInput(meta.snoozeUntil) : '');

  const save = () => {
    setPrMeta(pr.key, {
      tags: tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
      priority: priority || undefined,
      note: note.trim(),
      snoozeUntil: snooze ? new Date(snooze).toISOString() : '',
    });
    onClose();
  };

  return (
    <Modal title={pr.title} subtitle={`${pr.owner}/${pr.repo} #${pr.number}`} onClose={onClose} onSubmit={save}>
      <label>Tags personnels (séparés par des virgules)
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="à tester, bloquant, v2" />
      </label>
      <label>Priorité
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | '')}>
          <option value="">Aucune</option>
          <option value="high">Haute</option>
          <option value="medium">Moyenne</option>
          <option value="low">Basse</option>
        </select>
      </label>
      <label>Note personnelle
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Visible uniquement par vous" />
      </label>
      <label>Snooze jusqu'au <input type="datetime-local" value={snooze} onChange={(e) => setSnooze(e.target.value)} /></label>
    </Modal>
  );
}
