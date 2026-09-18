import { MessageSquare } from 'lucide-react'
import type { AlertDialogPayload } from '@shared/ipc'

interface Props {
  alert: AlertDialogPayload
  onDismiss: () => void
}

export default function AlertModal({ alert, onDismiss }: Props): JSX.Element {
  return (
    <div className="alert-overlay" onClick={onDismiss}>
      <div className="alert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="alert-modal__icon">
          <MessageSquare size={18} strokeWidth={2.2} />
        </div>
        <div className="alert-modal__domain">{alert.domain}</div>
        <p className="alert-modal__message">{alert.message}</p>
        <button className="alert-modal__ok" onClick={onDismiss} autoFocus>
          OK
        </button>
      </div>
    </div>
  )
}
