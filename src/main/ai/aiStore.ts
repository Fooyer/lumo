import fs from 'fs'
import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import type { AiChatMessage, AiNote, AiProviderId, BlockedSite } from '../../shared/ai'

const MAX_NOTES = 60
const MAX_NOTE_CHARS = 300
const MAX_HISTORY = 40

interface Persisted {
  /** provider → the key, encrypted by the operating system (base64). */
  keys: Partial<Record<AiProviderId, string>>
  notes: AiNote[]
  history: AiChatMessage[]
  blockedSites: BlockedSite[]
}

/**
 * Everything the assistant keeps: the API keys (encrypted with the OS keychain via safeStorage, and never
 * handed to a renderer), the notes she took about the user, and the conversation. Where the OS cannot
 * encrypt, a key lives in memory only, until Lumo closes.
 */
export class AiStore {
  private data: Persisted
  private memoryKeys: Partial<Record<AiProviderId, string>> = {}

  constructor(private filePath: string) {
    this.data = this.load()
  }

  private load(): Persisted {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<Persisted>
      return {
        keys: raw.keys ?? {},
        notes: Array.isArray(raw.notes) ? raw.notes : [],
        history: Array.isArray(raw.history) ? raw.history : [],
        blockedSites: Array.isArray(raw.blockedSites) ? raw.blockedSites : []
      }
    } catch {
      return { keys: {}, notes: [], history: [], blockedSites: [] }
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
    } catch {
      // disk unavailable: it stays in memory for this session
    }
  }

  get secure(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  setKey(provider: AiProviderId, key: string): void {
    const trimmed = key.trim()
    if (!trimmed) {
      this.clearKey(provider)
      return
    }
    if (this.secure) {
      this.data.keys[provider] = safeStorage.encryptString(trimmed).toString('base64')
      delete this.memoryKeys[provider]
      this.save()
    } else {
      this.memoryKeys[provider] = trimmed
    }
  }

  clearKey(provider: AiProviderId): void {
    delete this.data.keys[provider]
    delete this.memoryKeys[provider]
    this.save()
  }

  getKey(provider: AiProviderId): string | null {
    if (this.memoryKeys[provider]) return this.memoryKeys[provider] ?? null
    const stored = this.data.keys[provider]
    if (!stored || !this.secure) return null
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  keyStatus(): Partial<Record<AiProviderId, boolean>> {
    const out: Partial<Record<AiProviderId, boolean>> = {}
    for (const id of new Set([...Object.keys(this.data.keys), ...Object.keys(this.memoryKeys)]) as Set<AiProviderId>) {
      out[id] = this.getKey(id) !== null
    }
    return out
  }

  notes(): AiNote[] {
    return this.data.notes
  }

  addNote(text: string): AiNote | null {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS)
    if (!clean) return null
    const existing = this.data.notes.find((n) => n.text.toLowerCase() === clean.toLowerCase())
    if (existing) return existing
    const note: AiNote = { id: randomUUID().slice(0, 8), text: clean, at: Date.now() }
    this.data.notes.push(note)
    if (this.data.notes.length > MAX_NOTES) this.data.notes.shift()
    this.save()
    return note
  }

  removeNote(idOrText: string): boolean {
    const needle = idOrText.trim().toLowerCase()
    const before = this.data.notes.length
    this.data.notes = this.data.notes.filter((n) => n.id !== idOrText && !n.text.toLowerCase().includes(needle))
    if (this.data.notes.length === before) return false
    this.save()
    return true
  }

  blockedSites(): BlockedSite[] {
    return this.data.blockedSites
  }

  /** The entry that covers this address (the site itself or any of its subdomains), if there is one. */
  blockedEntry(url: string): BlockedSite | null {
    let host: string
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      return null
    }
    return this.data.blockedSites.find((s) => host === s.host || host.endsWith(`.${s.host}`)) ?? null
  }

  blockSite(host: string, reason: string): BlockedSite | null {
    const clean = host.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) return null
    const entry: BlockedSite = { host: clean, reason: reason.replace(/\s+/g, ' ').trim().slice(0, 200), at: Date.now() }
    this.data.blockedSites = [...this.data.blockedSites.filter((s) => s.host !== clean), entry]
    this.save()
    return entry
  }

  unblockSite(host: string): boolean {
    const before = this.data.blockedSites.length
    this.data.blockedSites = this.data.blockedSites.filter((s) => s.host !== host.trim().toLowerCase())
    if (this.data.blockedSites.length === before) return false
    this.save()
    return true
  }

  history(): AiChatMessage[] {
    return this.data.history
  }

  appendHistory(...messages: AiChatMessage[]): void {
    this.data.history.push(...messages)
    if (this.data.history.length > MAX_HISTORY) this.data.history.splice(0, this.data.history.length - MAX_HISTORY)
    this.save()
  }

  clearHistory(): void {
    this.data.history = []
    this.save()
  }
}
