import { ShieldAlert } from 'lucide-react'
import type { CertWarningPayload } from '@shared/ipc'

interface Props {
  warning: CertWarningPayload
  onBack: () => void
  onProceed: () => void
}

function describeError(error: string): string {
  if (error.includes('AUTHORITY_INVALID')) {
    return 'O certificado foi emitido por uma entidade não reconhecida (pode ser autoassinado).'
  }
  if (error.includes('DATE_INVALID')) return 'O certificado está expirado ou ainda não é válido.'
  if (error.includes('COMMON_NAME_INVALID')) return 'O certificado não corresponde ao endereço do site.'
  if (error.includes('REVOKED')) return 'O certificado foi revogado.'
  return 'Não foi possível verificar o certificado de segurança deste site.'
}

export default function CertWarningModal({ warning, onBack, onProceed }: Props): JSX.Element {
  return (
    <div className="alert-overlay">
      <div className="alert-modal" role="alertdialog" aria-modal="true">
        <div className="alert-modal__icon alert-modal__icon--danger">
          <ShieldAlert size={18} strokeWidth={2.2} />
        </div>
        <div className="alert-modal__domain">{warning.host}</div>
        <p className="alert-modal__message">
          Sua conexão com este site não é segura. {describeError(warning.error)}
          {'\n\n'}
          Informações enviadas a ele (como senhas) podem ser interceptadas.
        </p>
        <div className="alert-modal__error">{warning.error}</div>
        <div className="alert-modal__actions">
          <button className="alert-modal__ok" onClick={onBack} autoFocus>
            Voltar
          </button>
          <button className="alert-modal__secondary" onClick={onProceed}>
            Prosseguir mesmo assim
          </button>
        </div>
      </div>
    </div>
  )
}
