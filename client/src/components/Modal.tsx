import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

/** Native modal <dialog>, shown while the component is mounted. Without `onSubmit`, it only has a close button. */
export function Modal({ title, subtitle, onClose, onSubmit, children, footer, cancelLabel = 'Annuler', className }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
  /** Buttons on the left of the footer (e.g. Delete). */
  footer?: ReactNode;
  cancelLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal?.();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  return (
    <dialog ref={ref} className={className} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-label={title}>
      <form className="dialog-form" onSubmit={submit}>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
        <menu>
          {footer}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{cancelLabel}</button>
          {onSubmit && <button type="submit" className="btn primary">Enregistrer</button>}
        </menu>
      </form>
    </dialog>
  );
}
