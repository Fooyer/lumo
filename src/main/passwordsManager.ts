import fs from 'fs'
import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import type { SavedPassword } from '../shared/ipc'

interface StoredCredential {
  id: string
  domain: string
  username: string
  encryptedPassword: string
  updatedAt: number
}

export class PasswordsManager {
  private items: StoredCredential[]

  constructor(private filePath: string) {
    this.items = this.load()
  }

  private load(): StoredCredential[] {
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

  list(): SavedPassword[] {
    return this.items.map(({ id, domain, username, updatedAt }) => ({ id, domain, username, updatedAt }))
  }

  /** Decrypts and returns the plaintext password for one saved credential — an explicit, user-initiated reveal. */
  reveal(id: string): string | null {
    if (!safeStorage.isEncryptionAvailable()) return null
    const entry = this.items.find((i) => i.id === id)
    if (!entry) return null
    try {
      return safeStorage.decryptString(Buffer.from(entry.encryptedPassword, 'base64'))
    } catch {
      return null
    }
  }

  findForDomain(domain: string): { username: string; password: string } | null {
    const entry = this.items.find((i) => i.domain === domain)
    if (!entry) return null
    const password = this.reveal(entry.id)
    if (password === null) return null
    return { username: entry.username, password }
  }

  upsert(domain: string, username: string, password: string): void {
    if (!safeStorage.isEncryptionAvailable() || !password) return
    const encryptedPassword = safeStorage.encryptString(password).toString('base64')
    const existing = this.items.find((i) => i.domain === domain && i.username === username)
    if (existing) {
      existing.encryptedPassword = encryptedPassword
      existing.updatedAt = Date.now()
    } else {
      this.items.push({ id: randomUUID(), domain, username, encryptedPassword, updatedAt: Date.now() })
    }
    this.save()
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id)
    this.save()
  }
}
