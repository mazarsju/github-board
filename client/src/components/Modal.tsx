import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

/** Dialogue natif <dialog> modal, affiché tant que le composant est monté. */
export function Modal({ title, subtitle, onClose, onSubmit, children, footer, cancelLabel = 'Annuler' }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
  /** Boutons à gauche du pied (ex. Supprimer). */
  footer?: ReactNode;
  cancelLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal?.();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-label={title}>
      <form className="dialog-form" onSubmit={submit}>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
        <menu>
          {footer}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{cancelLabel}</button>
          <button type="submit" className="btn primary">Enregistrer</button>
        </menu>
      </form>
    </dialog>
  );
}
