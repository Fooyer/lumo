import fs from 'fs'

export interface SavedTab {
  url: string
  title: string
  favicon: string | null
}

export interface SavedSession {
  tabs: SavedTab[]
  activeIndex: number
  /** Split-view groups, as lists of indexes into `tabs`. */
  groups: number[][]
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'lumo:'])

function isRestorableUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export class SessionStore {
  constructor(private filePath: string) {}

  load(): SavedSession | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      if (!Array.isArray(raw?.tabs)) return null

      // Tabs that fail validation are dropped, so every index below is remapped to the kept ones.
      const indexMap = new Map<number, number>()
      const tabs: SavedTab[] = []
      raw.tabs.forEach((t: Partial<SavedTab>, i: number) => {
        if (!isRestorableUrl(t?.url)) return
        indexMap.set(i, tabs.length)
        tabs.push({
          url: t.url,
          title: typeof t.title === 'string' ? t.title : '',
          favicon: typeof t.favicon === 'string' ? t.favicon : null
        })
      })
      if (tabs.length === 0) return null

      const activeIndex = indexMap.get(raw.activeIndex) ?? 0
      const groups: number[][] = (Array.isArray(raw.groups) ? raw.groups : [])
        .map((g: unknown) =>
          Array.isArray(g)
            ? g.map((i) => indexMap.get(i)).filter((i): i is number => i !== undefined)
            : []
        )
        .filter((g: number[]) => g.length > 1)
      return { tabs, activeIndex, groups }
    } catch {
      return null
    }
  }

  save(session: SavedSession): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(session))
    } catch {
      // disco indisponível: a sessão só não será restaurada na próxima abertura
    }
  }
}
