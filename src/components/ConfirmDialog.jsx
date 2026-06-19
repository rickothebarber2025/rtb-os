import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';

export default function ConfirmDialog({
  busy = false,
  children,
  confirmDisabled = false,
  confirmLabel = 'Confirm',
  description,
  onClose,
  onConfirm,
  title,
  tone = 'danger',
}) {
  return (
    <Modal title={title} onClose={busy ? undefined : onClose}>
      <div className="confirm-dialog">
        <div className={`confirm-dialog__message ${tone}`}>
          <AlertTriangle size={20} />
          <p>{description}</p>
        </div>
        {children}
        <div className="action-row end">
          <button className="ghost-button" disabled={busy} type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={tone === 'danger' ? 'danger-button' : 'primary-button'}
            disabled={busy || confirmDisabled}
            type="button"
            onClick={onConfirm}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
