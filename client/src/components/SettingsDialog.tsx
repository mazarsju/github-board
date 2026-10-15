import { useState, type ChangeEvent } from 'react';
import { appStateSchema } from '../../../shared/schema.ts';
import { defaultState, migrate, uid } from '../../../shared/state.ts';
import type { AppState, Settings, Theme } from '../../../shared/types.ts';
import { useAppState } from '../state/AppState.tsx';
import { Modal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

export function exportConfig(state: AppState): string {
  const { seen: _seen, ...rest } = state;
  return JSON.stringify({ version: 2, ...rest }, null, 2);
}

/** Lit une configuration exportée (y compris celles de l'ancienne version statique). */
export function parseConfig(json: string, current: AppState): AppState {
  const data = JSON.parse(json) as Partial<AppState>;
  if (!Array.isArray(data.boards) || !data.boards.length) throw new Error('Fichier invalide : aucun tableau.');
  const next = migrate({ ...data, seen: current.seen, settings: { ...current.settings, ...data.settings } });
  const parsed = appStateSchema.safeParse(next);
  if (!parsed.success) throw new Error('Fichier invalide : format inattendu.');
  return parsed.data;
}

export function SettingsDialog({ onClose, onLogout, canLogout }: {
  onClose: () => void; onLogout: () => void; canLogout: boolean;
}) {
  const { state, update, activeBoard } = useAppState();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(state.settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  const addBoard = () => {
    const name = window.prompt('Nom du nouveau tableau ?')?.trim();
    if (!name) return;
    const id = uid();
    update((s) => ({ ...s, boards: [...s.boards, { id, name, columns: [] }], activeBoard: id }));
    onClose();
  };
  const renameBoard = () => {
    const name = window.prompt('Nouveau nom du tableau ?', activeBoard.name)?.trim();
    if (!name) return;
    update((s) => ({ ...s, boards: s.boards.map((b) => (b.id === activeBoard.id ? { ...b, name } : b)) }));
  };
  const deleteBoard = () => {
    if (state.boards.length <= 1) return toast('Il faut garder au moins un tableau.');
    if (!window.confirm(`Supprimer le tableau « ${activeBoard.name} » et ses colonnes ?`)) return;
    update((s) => {
      const boards = s.boards.filter((b) => b.id !== activeBoard.id);
      return { ...s, boards, activeBoard: boards[0]!.id };
    });
    onClose();
  };
  const exportJson = () => {
    const blob = new Blob([exportConfig(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'github-board-config.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = parseConfig(await file.text(), state);
      update(() => next);
      toast('Configuration importée');
      onClose();
    } catch (err) {
      toast(`Import impossible : ${(err as Error).message}`);
    }
  };
  const reset = () => {
    if (!window.confirm('Réinitialiser tableaux, colonnes et notes ?')) return;
    update(() => defaultState());
    onClose();
  };

  return (
    <Modal
      title="Paramètres"
      cancelLabel="Fermer"
      onClose={onClose}
      onSubmit={() => { update((s) => ({ ...s, settings })); onClose(); }}
      footer={canLogout && <button type="button" className="btn danger" onClick={onLogout}>Se déconnecter</button>}
    >
      <label>Rafraîchissement automatique
        <select value={settings.refresh} onChange={(e) => set('refresh', Number(e.target.value))}>
          <option value={0}>Désactivé</option>
          <option value={60}>Toutes les minutes</option>
          <option value={300}>Toutes les 5 minutes</option>
          <option value={900}>Toutes les 15 minutes</option>
        </select>
      </label>
      <label>Thème
        <select value={settings.theme} onChange={(e) => set('theme', e.target.value as Theme)}>
          <option value="auto">Système</option>
          <option value="light">Clair</option>
          <option value="dark">Sombre</option>
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.details} onChange={(e) => set('details', e.target.checked)} /> Charger CI, reviews et diff de chaque PR (plus d'appels API)
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.compact} onChange={(e) => set('compact', e.target.checked)} /> Cartes compactes
      </label>
      <fieldset>
        <legend>Tableaux</legend>
        <div className="row">
          <button type="button" className="btn" onClick={addBoard}>+ Nouveau tableau</button>
          <button type="button" className="btn" onClick={renameBoard}>Renommer</button>
          <button type="button" className="btn danger" onClick={deleteBoard}>Supprimer</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Configuration</legend>
        <div className="row">
          <button type="button" className="btn" onClick={exportJson}>Exporter JSON</button>
          <label className="btn file">Importer JSON<input type="file" accept="application/json" hidden onChange={importJson} /></label>
          <button type="button" className="btn" onClick={reset}>Réinitialiser</button>
        </div>
      </fieldset>
    </Modal>
  );
}
