import type { ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { TabSnapshot } from '@shared/ipc'
import TabStrip from './TabStrip'

interface Props {
  side: 'left' | 'right'
  tabs: TabSnapshot[]
  collapsed: boolean
  onToggleCollapsed: () => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNewTab: () => void
  /** Dev/downloads/settings buttons, pinned above the collapse toggle. */
  tools?: ReactNode
}

export default function TabSidebar({
  side,
  tabs,
  collapsed,
  onToggleCollapsed,
  onActivate,
  onClose,
  onNewTab,
  tools
}: Props): JSX.Element {
  // The icon shows what the button will do: point the panel toward the edge it collapses into.
  const CollapseIcon =
    side === 'left' ? (collapsed ? PanelLeftOpen : PanelLeftClose) : collapsed ? PanelRightOpen : PanelRightClose

  return (
    <aside className={`tab-sidebar tab-sidebar--${side} ${collapsed ? 'tab-sidebar--collapsed' : ''}`}>
      <TabStrip
        tabs={tabs}
        onActivate={onActivate}
        onClose={onClose}
        onNewTab={onNewTab}
        orientation="vertical"
        collapsed={collapsed}
      />
      {tools && <div className="tab-sidebar__tools">{tools}</div>}
      <button
        className="tab-sidebar__toggle"
        onClick={onToggleCollapsed}
        title={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
      >
        <CollapseIcon size={16} strokeWidth={2.2} />
        {!collapsed && <span>Recolher</span>}
      </button>
    </aside>
  )
}
