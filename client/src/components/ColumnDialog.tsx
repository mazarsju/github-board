import { useState } from 'react';
import { uid } from '../../../shared/state.ts';
import type { Column, SortKey } from '../../../shared/types.ts';
import { useAppState } from '../state/AppState.tsx';
import { Modal } from './Modal.tsx';

/** Création (col = null) ou modification d'une colonne du tableau actif. */
export function ColumnDialog({ col, onClose }: { col: Column | null; onClose: () => void }) {
  const { update, updateBoard } = useAppState();
  const [form, setForm] = useState({
    name: col?.name ?? '',
    query: col?.query ?? 'is:open ',
    color: col?.color ?? '#8957e5',
    sort: col?.sort ?? 'updated',
    limit: String(col?.limit ?? 30),
    notify: col?.notify ?? false,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    const data = {
      name: form.name.trim(),
      query: form.query.trim(),
      color: form.color,
      sort: form.sort,
      limit: Math.min(100, Math.max(5, Number(form.limit) || 30)),
      notify: form.notify,
    };
    if (data.notify && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    updateBoard((b) => ({
      ...b,
      columns: col ? b.columns.map((c) => (c.id === col.id ? { ...c, ...data } : c)) : [...b.columns, { id: uid(), ...data }],
    }));
    onClose();
  };

  const remove = () => {
    if (!col || !window.confirm(`Supprimer la colonne « ${col.name} » ?`)) return;
    updateBoard((b) => ({ ...b, columns: b.columns.filter((c) => c.id !== col.id) }));
    update(({ seen: { [col.id]: _, ...seen }, ...s }) => ({ ...s, seen }));
    onClose();
  };

  return (
    <Modal
      title={col ? 'Modifier la colonne' : 'Nouvelle colonne'}
      onClose={onClose}
      onSubmit={save}
      footer={col && <button type="button" className="btn danger" onClick={remove}>Supprimer</button>}
    >
      <label>Nom <input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={60} /></label>
      <label>Requête de recherche GitHub
        <textarea value={form.query} onChange={(e) => set('query', e.target.value)} rows={3} required spellCheck={false} />
      </label>
      <p className="hint">
        Syntaxe de <a href="https://docs.github.com/search-github/searching-on-github/searching-issues-and-pull-requests" target="_blank" rel="noopener noreferrer">recherche GitHub</a>.{' '}
        <code>is:pr</code> est ajouté automatiquement. Ex. : <code>is:open review-requested:@me</code>, <code>is:open org:mon-org label:urgent</code>.
      </p>
      <div className="row">
        <label>Couleur <input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} /></label>
        <label>Tri
          <select value={form.sort} onChange={(e) => set('sort', e.target.value as SortKey)}>
            <option value="updated">Mise à jour</option>
            <option value="created">Création</option>
            <option value="comments">Commentaires</option>
          </select>
        </label>
        <label>Max <input type="number" min={5} max={100} value={form.limit} onChange={(e) => set('limit', e.target.value)} /></label>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={form.notify} onChange={(e) => set('notify', e.target.checked)} /> Notifier les nouvelles PRs dans cette colonne
      </label>
    </Modal>
  );
}
