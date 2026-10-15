// État personnel (tableaux, colonnes, métadonnées PR) : chargé depuis le backend et sauvegardé automatiquement.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { patchPrMeta } from '../../../shared/state.ts';
import type { AppState, Board, PrMeta } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';

const SAVE_DELAY = 400;

interface AppStateValue {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  activeBoard: Board;
  updateBoard: (fn: (b: Board) => Board) => void;
  setPrMeta: (key: string, patch: Partial<PrMeta>) => void;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ initial, children, onSaveError }: {
  initial: AppState; children: ReactNode; onSaveError?: (err: Error) => void;
}) {
  const [state, setState] = useState(initial);
  const first = useRef(true);
  const errorRef = useRef(onSaveError);
  errorRef.current = onSaveError;

  // Sauvegarde différée après chaque modification.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => api.saveState(state).catch((err: Error) => errorRef.current?.(err)), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [state]);

  const update = useCallback((fn: (s: AppState) => AppState) => setState(fn), []);
  const activeBoard = state.boards.find((b) => b.id === state.activeBoard) ?? state.boards[0]!;

  const value: AppStateValue = {
    state,
    update,
    activeBoard,
    updateBoard: (fn) => update((s) => ({
      ...s,
      boards: s.boards.map((b) => (b.id === activeBoard.id ? fn(b) : b)),
    })),
    setPrMeta: (key, patch) => update((s) => ({ ...s, prs: patchPrMeta(s.prs, key, patch) })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState hors AppStateProvider');
  return v;
}
