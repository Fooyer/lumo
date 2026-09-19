import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { TabSnapshot } from '@shared/ipc'
import FaviconImg from './FaviconImg'

interface Props {
  tabs: TabSnapshot[]
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNewTab: () => void
  orientation?: 'horizontal' | 'vertical'
  /** Vertical only: show favicons without titles. */
  collapsed?: boolean
}

type DragZone = 'before' | 'after' | 'combine'

const COMBINE_HOLD_MS = 2000

function chunkBySplitGroup(tabs: TabSnapshot[]): TabSnapshot[][] {
  const result: TabSnapshot[][] = []
  let i = 0
  while (i < tabs.length) {
    const tab = tabs[i]
    const chunk = [tab]
    let j = i + 1
    if (tab.splitGroupId) {
      while (j < tabs.length && tabs[j].splitGroupId === tab.splitGroupId) {
        chunk.push(tabs[j])
        j++
      }
    }
    result.push(chunk)
    i = j
  }
  return result
}

export default function TabStrip({
  tabs,
  onActivate,
  onClose,
  onNewTab,
  orientation = 'horizontal',
  collapsed = false
}: Props): JSX.Element {
  const vertical = orientation === 'vertical'
  const [dragOver, setDragOver] = useState<{ id: string; zone: DragZone } | null>(null)
  const dwellRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)

  const clearDwell = (): void => {
    if (dwellRef.current) {
      clearTimeout(dwellRef.current.timer)
      dwellRef.current = null
    }
  }

  useEffect(() => clearDwell, [])

  const dropOn = (targetId: string, zone: DragZone, draggedId: string): void => {
    if (!draggedId || draggedId === targetId) return
    if (zone === 'combine') {
      window.lumo.combineSplit(draggedId, targetId)
      return
    }
    const idx = tabs.findIndex((t) => t.id === targetId)
    const beforeId = zone === 'after' ? tabs[idx + 1]?.id ?? null : targetId
    window.lumo.reorderTab(draggedId, beforeId)
  }

  return (
    <div
      className={`tab-strip ${vertical ? 'tab-strip--vertical' : ''} ${collapsed && vertical ? 'tab-strip--collapsed' : ''}`}
    >
      <div
        className="tab-strip__tabs"
        onWheel={(e) => {
          if (!vertical && e.deltaY !== 0 && e.deltaX === 0) {
            e.currentTarget.scrollLeft += e.deltaY
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          clearDwell()
          const draggedId = e.dataTransfer.getData('text/plain')
          if (draggedId) window.lumo.reorderTab(draggedId, null)
          setDragOver(null)
        }}
      >
        {chunkBySplitGroup(tabs).map((chunk) => {
          const groupClass = chunk.length > 1 ? 'tab-group' : 'tab-group tab-group--single'
          return (
            <div key={chunk[0].id} className={groupClass}>
              {chunk.map((tab) => (
                <button
                  key={tab.id}
                  draggable
                  className={`tab ${tab.isActive ? 'tab--active' : ''} ${tab.suspended ? 'tab--suspended' : ''} ${
                    dragOver?.id === tab.id ? `tab--drag-${dragOver.zone}` : ''
                  }`}
                  onClick={() => onActivate(tab.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1) onClose(tab.id)
                  }}
                  onContextMenu={() => window.lumo.showTabContextMenu(tab.id)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', tab.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()

                    // Holding over the same tab for a couple seconds switches to "combine into
                    // split view"; a quick pass just decides which side to reorder to instead.
                    if (dwellRef.current?.id !== tab.id) {
                      clearDwell()
                      const timer = setTimeout(() => {
                        setDragOver({ id: tab.id, zone: 'combine' })
                      }, COMBINE_HOLD_MS)
                      dwellRef.current = { id: tab.id, timer }
                    }

                    // Read the DOM measurement now, synchronously, while `e` is still valid — the
                    // browser nulls out a native event's currentTarget as soon as dispatch ends,
                    // and this could otherwise run later inside the setDragOver updater below.
                    const rect = e.currentTarget.getBoundingClientRect()
                    const ratio = vertical
                      ? (e.clientY - rect.top) / rect.height
                      : (e.clientX - rect.left) / rect.width
                    const positionZone: DragZone = ratio < 0.5 ? 'before' : 'after'

                    setDragOver((prev) => {
                      if (prev?.id === tab.id && prev.zone === 'combine') return prev
                      return { id: tab.id, zone: positionZone }
                    })
                  }}
                  onDragLeave={() => {
                    clearDwell()
                    setDragOver((d) => (d?.id === tab.id ? null : d))
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    clearDwell()
                    const draggedId = e.dataTransfer.getData('text/plain')
                    if (draggedId && dragOver) dropOn(tab.id, dragOver.zone, draggedId)
                    setDragOver(null)
                  }}
                  onDragEnd={() => {
                    clearDwell()
                    setDragOver(null)
                  }}
                  title={vertical && collapsed ? `${tab.title || tab.domain}\n${tab.url}` : tab.url}
                >
                  <FaviconImg
                    src={tab.favicon}
                    className="tab__favicon"
                    fallbackClassName="tab__dot"
                    fallbackColor={tab.groupColor}
                  />
                  <span className="tab__title">
                    {tab.loading ? 'Carregando…' : tab.title || tab.domain}
                  </span>
                  <span
                    className="tab__close"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose(tab.id)
                    }}
                  >
                    <X size={13} strokeWidth={2.6} />
                  </span>
                </button>
              ))}
            </div>
          )
        })}
        <button className="tab-strip__new" onClick={onNewTab} title="Nova aba">
          <Plus size={15} strokeWidth={2.6} />
          {vertical && !collapsed && <span className="tab-strip__new-label">Nova aba</span>}
        </button>
      </div>
    </div>
  )
}
