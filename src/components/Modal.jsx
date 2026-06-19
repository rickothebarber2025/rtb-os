import { X } from 'lucide-react';

export default function Modal({ children, onClose, title }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          {onClose ? (
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          ) : null}
        </header>
        {children}
      </section>
    </div>
  );
}
