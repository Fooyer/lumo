import type { TabLayout } from '@shared/ipc'

const OPTIONS: { value: TabLayout; label: string }[] = [
  { value: 'top', label: 'Topo' },
  { value: 'left', label: 'Esquerda' },
  { value: 'right', label: 'Direita' },
  { value: 'bottom', label: 'Inferior' }
]

interface Props {
  value: TabLayout
  onChange: (value: TabLayout) => void
}

export default function LayoutPicker({ value, onChange }: Props): JSX.Element {
  return (
    <div className="layout-picker" role="radiogroup" aria-label="Posição das abas">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={`layout-picker__option ${value === o.value ? 'layout-picker__option--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          <span className={`layout-preview layout-preview--${o.value}`} aria-hidden="true">
            <i className="layout-preview__tabs" />
            <i className="layout-preview__page" />
          </span>
          <span className="layout-picker__label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
