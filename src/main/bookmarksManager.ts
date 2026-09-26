import fs from 'fs'
import { randomUUID } from 'crypto'
import type { Bookmark } from '../shared/ipc'

/**
 * Bookmarks and their folders, kept as one flat list: a folder is an entry with `kind: 'folder'`, and what is
 * inside it points back with `parentId`. Folders hold bookmarks only (one level), so the list's order is the
 * order on the bar and, for each folder, the order inside it.
 */
export class BookmarksManager {
  private items: Bookmark[]

  constructor(private filePath: string) {
    this.items = this.load()
  }

  private load(): Bookmark[] {
    try {
      const items: Bookmark[] = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      const folderIds = new Set(items.filter((b) => b.kind === 'folder').map((b) => b.id))
      // Files from before folders have neither field; a parent that no longer exists puts the item back on the bar.
      return items.map((b) => ({
        ...b,
        parentId: b.kind !== 'folder' && b.parentId && folderIds.has(b.parentId) ? b.parentId : null
      }))
    } catch {
      return []
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.items, null, 2))
    } catch {
      // disco indisponível: mantém apenas em memória nesta sessão
    }
  }

  list(): Bookmark[] {
    return this.items
  }

  get(id: string): Bookmark | undefined {
    return this.items.find((b) => b.id === id)
  }

  folders(): Bookmark[] {
    return this.items.filter((b) => b.kind === 'folder')
  }

  childrenOf(folderId: string): Bookmark[] {
    return this.items.filter((b) => b.parentId === folderId)
  }

  add(input: { title: string; url: string; favicon: string | null }): Bookmark {
    const bookmark: Bookmark = { ...input, id: randomUUID(), createdAt: Date.now(), parentId: null }
    this.items.push(bookmark)
    this.save()
    return bookmark
  }

  addFolder(title: string): Bookmark {
    const folder: Bookmark = {
      id: randomUUID(),
      kind: 'folder',
      title: title.trim() || 'Nova pasta',
      url: '',
      favicon: null,
      createdAt: Date.now(),
      parentId: null
    }
    this.items.push(folder)
    this.save()
    return folder
  }

  rename(id: string, title: string): void {
    const item = this.get(id)
    const name = title.trim()
    if (!item || item.kind !== 'folder' || !name) return
    item.title = name
    this.save()
  }

  /** Removing a folder keeps what was inside it: those bookmarks go back to the bar. */
  remove(id: string): void {
    const item = this.get(id)
    if (item?.kind === 'folder') for (const b of this.items) if (b.parentId === id) b.parentId = null
    this.items = this.items.filter((b) => b.id !== id)
    this.save()
  }

  findByUrl(url: string): Bookmark | undefined {
    return this.items.find((b) => b.kind !== 'folder' && b.url === url)
  }

  /** Puts a bookmark at the end of a folder, or back on the bar (`folderId` null). */
  moveToFolder(id: string, folderId: string | null): void {
    const item = this.get(id)
    if (!item || item.kind === 'folder') return
    if (folderId !== null && this.get(folderId)?.kind !== 'folder') return
    this.items = this.items.filter((b) => b.id !== id)
    item.parentId = folderId
    this.items.push(item)
    this.save()
  }

  /**
   * Moves `draggedId` to sit immediately before `beforeId`, joining that item's folder (or the bar). With no
   * `beforeId` it goes to the end of `parentId` (the bar when null). A folder can only live on the bar.
   */
  reorder(draggedId: string, beforeId: string | null, parentId: string | null = null): void {
    const fromIdx = this.items.findIndex((b) => b.id === draggedId)
    if (fromIdx === -1) return
    const target = beforeId ? this.get(beforeId) : undefined
    const newParent = target ? target.parentId ?? null : parentId
    const dragged = this.items[fromIdx]
    if (dragged.kind === 'folder' && newParent) return
    if (newParent && this.get(newParent)?.kind !== 'folder') return

    this.items.splice(fromIdx, 1)
    dragged.parentId = newParent
    let toIdx = beforeId ? this.items.findIndex((b) => b.id === beforeId) : this.items.length
    if (toIdx === -1) toIdx = this.items.length
    this.items.splice(toIdx, 0, dragged)
    this.save()
  }

  moveToStart(id: string): void {
    const item = this.get(id)
    if (!item) return
    const first = this.items.find((b) => (b.parentId ?? null) === (item.parentId ?? null))
    if (!first || first.id === id) return
    this.reorder(id, first.id)
  }

  moveToEnd(id: string): void {
    const item = this.get(id)
    if (item) this.reorder(id, null, item.parentId ?? null)
  }
}
