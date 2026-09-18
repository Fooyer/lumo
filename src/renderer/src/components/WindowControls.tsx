import { Minus, Square, Copy, X } from 'lucide-react'

interface Props {
  isMaximized: boolean
}

export default function WindowControls({ isMaximized }: Props): JSX.Element {
  return (
    <div className="window-controls">
      <button
        className="window-controls__btn"
        onClick={() => window.lumo.minimizeWindow()}
        title="Minimizar"
      >
        <Minus size={15} strokeWidth={2.4} />
      </button>
      <button
        className="window-controls__btn"
        onClick={() => window.lumo.toggleMaximizeWindow()}
        title={isMaximized ? 'Restaurar' : 'Maximizar'}
      >
        {isMaximized ? <Copy size={13} strokeWidth={2.2} /> : <Square size={13} strokeWidth={2.2} />}
      </button>
      <button
        className="window-controls__btn window-controls__btn--close"
        onClick={() => window.lumo.closeWindow()}
        title="Fechar"
      >
        <X size={15} strokeWidth={2.4} />
      </button>
    </div>
  )
}
