import { Moon, Sun } from 'lucide-react'
import type { ThemeSettings } from '@shared/ipc'
import { themeMode, withMode, type ThemeMode } from '../lib/themeMode'

const OPTIONS: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'light', label: 'Claro', Icon: Sun }
]

interface Props {
  theme: ThemeSettings
  disabled?: boolean
  onChange: (theme: ThemeSettings) => void
}

/** Dark/light in one click; the color picker stays available for anything in between. */
export default function ThemeModeToggle({ theme, disabled, onChange }: Props): JSX.Element {
  const current = themeMode(theme)
  return (
    <div className="mode-toggle" role="radiogroup" aria-label="Modo do tema">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={current === value}
          disabled={disabled}
          className={`mode-toggle__option ${current === value ? 'mode-toggle__option--active' : ''}`}
          onClick={() => current !== value && onChange(withMode(theme, value))}
        >
          <Icon size={14} strokeWidth={2.4} />
          {label}
        </button>
      ))}
    </div>
  )
}
