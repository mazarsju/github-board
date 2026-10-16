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
      title="Settings"
      cancelLabel="Close"
      onClose={onClose}
      onSubmit={() => { update((s) => ({ ...s, settings })); onClose(); }}
      footer={canLogout && <button type="button" className="btn danger" onClick={onLogout}>Sign out</button>}
    >
      <label>Auto refresh
        <select value={settings.refresh} onChange={(e) => set('refresh', Number(e.target.value))}>
          <option value={0}>Off</option>
          <option value={60}>Every minute</option>
          <option value={300}>Every 5 minutes</option>
          <option value={900}>Every 15 minutes</option>
        </select>
      </label>
      <label>Theme
        <select value={settings.theme} onChange={(e) => set('theme', e.target.value as Theme)}>
          <option value="auto">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </Modal>
  );
}
