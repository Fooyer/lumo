import { useMemo, useState } from 'react'
import type { TabSnapshot, MemorySnapshot, AiStatusPayload, Settings } from '@shared/ipc'

interface Props {
  open: boolean
  tabs: TabSnapshot[]
  memory: MemorySnapshot | null
  aiStatus: AiStatusPayload
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onSuspend: (id: string) => void
  onResume: (id: string) => void
  onOrganize: () => void
  onDismiss: () => void
  onSaveSettings: (partial: Partial<Settings>) => void
}

export default function TabManagerPanel({
  open,
  tabs,
  memory,
  aiStatus,
  onActivate,
  onClose,
  onSuspend,
  onResume,
  onOrganize,
  onDismiss,
  onSaveSettings
}: Props): JSX.Element {
  const [saverEnabled, setSaverEnabled] = useState(memory?.saverEnabled ?? true)

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; color: string; tabs: TabSnapshot[] }>()
    for (const tab of tabs) {
      const entry = map.get(tab.groupId) ?? { label: tab.groupLabel, color: tab.groupColor, tabs: [] }
      entry.tabs.push(tab)
      map.set(tab.groupId, entry)
    }
    return [...map.values()]
  }, [tabs])

  const memoryByTab = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of memory?.tabs ?? []) m.set(t.id, t.memoryMB)
    return m
  }, [memory])

  return (
    <div className={`manager-panel ${open ? 'manager-panel--open' : ''}`}>
      <div className="manager-panel__header">
        <div>
          <strong>Abas &amp; memória</strong>
          <span className="manager-panel__total">
            {memory ? `${memory.totalMB} MB em uso agora` : 'Medindo uso de memória…'}
          </span>
        </div>
        <div className="manager-panel__actions">
          <label className="saver-toggle">
            <input
              type="checkbox"
              checked={saverEnabled}
              onChange={(e) => {
                setSaverEnabled(e.target.checked)
                onSaveSettings({ memorySaverEnabled: e.target.checked })
              }}
            />
            Suspender abas ociosas automaticamente
          </label>
          <button className="organize-btn" onClick={onOrganize} disabled={aiStatus.busy}>
            ✦ Organizar com IA
          </button>
          <button className="manager-panel__close" onClick={onDismiss}>
            Fechar
          </button>
        </div>
      </div>

      <div className="manager-panel__groups">
        {groups.map((group) => (
          <div key={group.label} className="manager-group">
            <div className="manager-group__title">
              <span className="tab__dot" style={{ background: group.color }} />
              {group.label}
              <span className="manager-group__count">{group.tabs.length}</span>
            </div>
            <div className="manager-group__tabs">
              {group.tabs.map((tab) => {
                const mb = memoryByTab.get(tab.id)
                return (
                  <div key={tab.id} className={`manager-row ${tab.isActive ? 'manager-row--active' : ''}`}>
                    <button className="manager-row__label" onClick={() => onActivate(tab.id)}>
                      {tab.favicon && <img src={tab.favicon} alt="" />}
                      <span>{tab.title || tab.domain}</span>
                      {tab.suspended && <em className="manager-row__suspended">suspensa</em>}
                    </button>
                    <span className="manager-row__mem">{mb !== undefined ? `${mb} MB` : '—'}</span>
                    {tab.suspended ? (
                      <button className="manager-row__btn" onClick={() => onResume(tab.id)}>
                        Retomar
                      </button>
                    ) : (
                      <button
                        className="manager-row__btn"
                        onClick={() => onSuspend(tab.id)}
                        disabled={tab.isActive}
                      >
                        Suspender
                      </button>
                    )}
                    <button className="manager-row__btn manager-row__btn--danger" onClick={() => onClose(tab.id)}>
                      Fechar
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
