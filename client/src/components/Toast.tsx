import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/** Shows `msg` for `ms` milliseconds. */
type Toast = (msg: string, ms?: number) => void;

const Ctx = createContext<Toast>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback<Toast>((m, ms = 2600) => {
    setMsg(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), ms);
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className={`toast${show ? ' show' : ''}`} role="status">{msg}</div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
