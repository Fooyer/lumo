import fs from 'fs'
import { randomUUID } from 'crypto'
import type { Bookmark } from '../shared/ipc'

export class BookmarksManager {
  private items: Bookmark[]

  constructor(private filePath: string) {
    this.items = this.load()
  }

  private load(): Bookmark[] {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
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

  add(input: { title: string; url: string; favicon: string | null }): Bookmark {
    const bookmark: Bookmark = { ...input, id: randomUUID(), createdAt: Date.now() }
    this.items.push(bookmark)
    this.save()
    return bookmark
  }

  remove(id: string): void {
    this.items = this.items.filter((b) => b.id !== id)
    this.save()
  }

  findByUrl(url: string): Bookmark | undefined {
    return this.items.find((b) => b.url === url)
  }

  /** Moves `draggedId` to sit immediately before `beforeId` (or to the end when null). */
  reorder(draggedId: string, beforeId: string | null): void {
    const fromIdx = this.items.findIndex((b) => b.id === draggedId)
    if (fromIdx === -1) return
    const [item] = this.items.splice(fromIdx, 1)

    let toIdx = beforeId ? this.items.findIndex((b) => b.id === beforeId) : this.items.length
    if (toIdx === -1) toIdx = this.items.length
    this.items.splice(toIdx, 0, item)
    this.save()
  }

  moveToStart(id: string): void {
    const first = this.items[0]
    if (!first || first.id === id) return
    this.reorder(id, first.id)
  }

  moveToEnd(id: string): void {
    this.reorder(id, null)
  }
}
