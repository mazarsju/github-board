import { useState } from 'react';
import type { Settings, Theme } from '../../../shared/types.ts';
import { useAppState } from '../state/AppState.tsx';
import { Modal } from './Modal.tsx';

export function SettingsDialog({ onClose, onLogout, canLogout }: {
  onClose: () => void; onLogout: () => void; canLogout: boolean;
}) {
  const { state, update } = useAppState();
  const [settings, setSettings] = useState<Settings>(state.settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));

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
    </Modal>
  );
}
