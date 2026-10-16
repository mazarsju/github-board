// Personal state (settings): loaded from the backend and saved automatically.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';

const SAVE_DELAY = 400;

interface AppStateValue {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ initial, children, onSaveError }: {
  initial: AppState; children: ReactNode; onSaveError?: (err: Error) => void;
}) {
  const [state, setState] = useState(initial);
  const first = useRef(true);
  const errorRef = useRef(onSaveError);
  errorRef.current = onSaveError;

  // Debounced save after each change.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => api.saveState(state).catch((err: Error) => errorRef.current?.(err)), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [state]);

  const update = useCallback((fn: (s: AppState) => AppState) => setState(fn), []);
  return <Ctx.Provider value={{ state, update }}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState used outside AppStateProvider');
  return v;
}
