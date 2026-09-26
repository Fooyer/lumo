import fs from 'fs'
import { createHash } from 'crypto'
import { basename, extname, join, resolve, sep, posix } from 'path'
import { pathToFileURL } from 'url'
import { net } from 'electron'
import { unzipSync } from 'fflate'
import {
  MOD_SCHEME,
  type ModInfo,
  type ModInstallResult,
  type ModSounds,
  type ModWallpaper,
  type SoundEvent,
  type ThemeSettings
} from '../shared/ipc'

// Mods use Opera GX's manifest format (https://github.com/opera-gaming/gxmods): a manifest.json with
// `mod.payload.{background_music, browser_sounds, keyboard_sounds, ...}`, shipped as a folder, .zip or .crx,
// or fetched from the GX Store (see installFromStore).
// Used: the sounds, the theme colors and the wallpaper. Shaders and page styles are ignored.
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm', '.opus'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])
const MEDIA_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS])
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_TOTAL_BYTES = 400 * 1024 * 1024
const MAX_ENTRIES = 2000
const TOO_BIG = 'O mod é grande demais.'
const STORE_ASSETS = 'https://mods.store.gx.me/mods'

const KEYBOARD_KEYS: Record<string, SoundEvent> = {
  TYPING_LETTER: 'key-letter',
  TYPING_SPACE: 'key-space',
  TYPING_ENTER: 'key-enter',
  TYPING_BACKSPACE: 'key-backspace'
}
const BROWSER_KEYS: Record<string, SoundEvent> = {
  TAB_INSERT: 'tab-open',
  TAB_CLOSE: 'tab-close'
}

type Files = Map<string, Uint8Array>

interface Hsl {
  h?: unknown
  s?: unknown
  l?: unknown
}
interface ThemeVariant {
  gx_accent?: Hsl
  gx_secondary_base?: Hsl
}
interface WallpaperVariant {
  image?: unknown
  first_frame?: unknown
  text_color?: unknown
  text_shadow?: unknown
}

interface Manifest {
  name?: unknown
  description?: unknown
  version?: unknown
  developer?: { name?: unknown }
  icons?: Record<string, unknown>
  mod?: { payload?: Record<string, unknown> }
}

/** What the mod offers, whichever way its manifest lays it out. */
interface Payload {
  music: string[]
  keyboard: Record<string, string[]>
  browser: Record<string, string[]>
  theme: ThemeVariant | undefined
  wallpaper: WallpaperVariant | undefined
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The GX Store's manifests wrap every group in a list of variants (`[{ id, name, sounds }]`), while the
 * documented template holds the group itself. Either way, the first variant is the one used.
 */
function firstVariant(v: unknown): unknown {
  return Array.isArray(v) && isObject(v[0]) ? v[0] : v
}

function soundMap(group: unknown): Record<string, string[]> {
  const variantGroup = firstVariant(group)
  const map = isObject(variantGroup) && isObject(variantGroup.sounds) ? variantGroup.sounds : variantGroup
  const out: Record<string, string[]> = {}
  if (isObject(map)) for (const [key, value] of Object.entries(map)) out[key] = pathList(value)
  return out
}

function readPayload(manifest: Manifest | null): Payload {
  const p = manifest?.mod?.payload ?? {}
  const music = firstVariant(p.background_music)
  const theme = firstVariant(p.theme)
  const wallpaper = firstVariant(p.wallpaper)
  return {
    music: pathList(isObject(music) ? music.tracks : music),
    keyboard: soundMap(p.keyboard_sounds),
    browser: soundMap(p.browser_sounds),
    theme: isObject(theme) ? variant(theme as Record<string, ThemeVariant | undefined>) : undefined,
    wallpaper: isObject(wallpaper) ? variant(wallpaper as Record<string, WallpaperVariant | undefined>) : undefined
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** "a" or ["a", "b"] -> ["a", "b"]; empty strings (GX allows them as placeholders) are dropped. */
function pathList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v]
  return list.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim())
}

/** Normalizes a path from a manifest or an archive; null when it would escape its folder. */
function cleanRelative(p: string): string | null {
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.')
  if (parts.length === 0 || parts.some((s) => s === '..' || /^[a-zA-Z]:$/.test(s))) return null
  return parts.join('/')
}

function hslToHex(c: Hsl | undefined): string | null {
  if (!c) return null
  const h = Number(c.h)
  const sat = Number(c.s) / 100
  const l = Number(c.l) / 100
  if (![h, sat, l].every(Number.isFinite)) return null
  const a = sat * Math.min(l, 1 - l)
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(Math.min(Math.max(v, 0), 1) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Lumo is a dark UI, so the mod's dark variant wins; a mod with only a light one still gets used. */
function variant<T>(group: Record<string, T | undefined> | undefined): T | undefined {
  return group?.dark ?? group?.light
}

const cssColor = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : null)

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return `${base || 'mod'}-${createHash('sha1').update(name).digest('hex').slice(0, 6)}`
}

/** A .crx is a zip behind a header (Cr24, version, then the header's length or key/signature sizes). */
function stripCrxHeader(data: Buffer): Buffer {
  if (data.subarray(0, 4).toString('latin1') !== 'Cr24') return data
  const version = data.readUInt32LE(4)
  if (version === 3) return data.subarray(12 + data.readUInt32LE(8))
  if (version === 2) return data.subarray(16 + data.readUInt32LE(8) + data.readUInt32LE(12))
  throw new Error('Versão de .crx não suportada.')
}

function readArchive(file: string): Files {
  const zipped = stripCrxHeader(fs.readFileSync(file))
  let total = 0
  let count = 0
  const entries = unzipSync(new Uint8Array(zipped), {
    filter: (info) => {
      if (info.name.endsWith('/')) return false
      const ext = extname(info.name).toLowerCase()
      const wanted = basename(info.name).toLowerCase() === 'manifest.json' || MEDIA_EXTENSIONS.has(ext)
      if (!wanted) return false
      if (info.originalSize > MAX_FILE_BYTES) return false
      total += info.originalSize
      if (total > MAX_TOTAL_BYTES || ++count > MAX_ENTRIES) throw new Error('O mod é grande demais.')
      return true
    }
  })
  return new Map(Object.entries(entries))
}

function readFolder(root: string): Files {
  const files: Files = new Map()
  let total = 0
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, rel)
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(entry.name).toLowerCase()
      if (entry.name.toLowerCase() !== 'manifest.json' && !MEDIA_EXTENSIONS.has(ext)) continue
      const size = fs.statSync(full).size
      total += size
      if (size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES || files.size >= MAX_ENTRIES) throw new Error('O mod é grande demais.')
      files.set(rel, fs.readFileSync(full))
    }
  }
  walk(root, '')
  return files
}

export class ModsManager {
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true })
  }

  private dirOf(id: string): string | null {
    if (!/^[a-z0-9-]+$/.test(id)) return null
    return join(this.root, id)
  }

  private readManifest(id: string): Manifest | null {
    const dir = this.dirOf(id)
    if (!dir) return null
    try {
      return JSON.parse(fs.readFileSync(join(dir, 'manifest.json'), 'utf-8')) as Manifest
    } catch {
      return null
    }
  }

  private info(id: string, manifest: Manifest): ModInfo {
    const payload = readPayload(manifest)
    const icons = manifest.icons ?? {}
    const iconPath = str(icons['512']) ?? str(Object.values(icons)[0])
    const icon = iconPath && cleanRelative(iconPath)
    const has = (group: Record<string, string[]>, keys: string[]): boolean => keys.some((k) => (group[k]?.length ?? 0) > 0)
    return {
      id,
      name: str(manifest.name) ?? id,
      author: str(manifest.developer?.name),
      description: str(manifest.description),
      version: str(manifest.version),
      icon: icon ? `${MOD_SCHEME}://${id}/${encodeURI(icon)}` : null,
      hasMusic: payload.music.length > 0,
      hasKeyboard: has(payload.keyboard, Object.keys(KEYBOARD_KEYS)),
      hasTabSounds: has(payload.browser, Object.keys(BROWSER_KEYS)),
      hasTheme: !!this.theme(id, manifest),
      hasWallpaper: !!this.wallpaper(id, manifest)
    }
  }

  list(): ModInfo[] {
    const mods: ModInfo[] = []
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = this.readManifest(entry.name)
      if (manifest) mods.push(this.info(entry.name, manifest))
    }
    return mods.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** The colors the mod asks for; the danger color has no GX counterpart, so it stays the user's. */
  theme(id: string, manifest = this.readManifest(id)): Pick<ThemeSettings, 'accent' | 'bg'> | null {
    const v = readPayload(manifest).theme
    const accent = hslToHex(v?.gx_accent)
    const bg = hslToHex(v?.gx_secondary_base)
    return accent && bg ? { accent, bg } : null
  }

  wallpaper(id: string, manifest = this.readManifest(id)): ModWallpaper | null {
    const v = readPayload(manifest).wallpaper
    const file = typeof v?.image === 'string' ? cleanRelative(v.image) : null
    if (!v || !file) return null
    const ext = extname(file).toLowerCase()
    const video = VIDEO_EXTENSIONS.has(ext)
    if (!video && !IMAGE_EXTENSIONS.has(ext)) return null
    const url = (rel: string): string => `${MOD_SCHEME}://${id}/${encodeURI(rel)}`
    const poster = typeof v.first_frame === 'string' ? cleanRelative(v.first_frame) : null
    return {
      url: url(file),
      video,
      poster: poster && IMAGE_EXTENSIONS.has(extname(poster).toLowerCase()) ? url(poster) : null,
      textColor: cssColor(v.text_color),
      textShadow: cssColor(v.text_shadow)
    }
  }

  sounds(id: string): ModSounds | null {
    const manifest = this.readManifest(id)
    if (!manifest) return null
    const payload = readPayload(manifest)
    const url = (p: string): string | null => {
      const rel = cleanRelative(p)
      return rel && AUDIO_EXTENSIONS.has(extname(rel).toLowerCase()) ? `${MOD_SCHEME}://${id}/${encodeURI(rel)}` : null
    }
    const urls = (list: string[] | undefined): string[] => (list ?? []).map(url).filter((u): u is string => !!u)
    const events: ModSounds['events'] = {}
    const collect = (group: Record<string, string[]>, map: Record<string, SoundEvent>): void => {
      for (const [key, event] of Object.entries(map)) {
        const list = urls(group[key])
        if (list.length) events[event] = list
      }
    }
    collect(payload.keyboard, KEYBOARD_KEYS)
    collect(payload.browser, BROWSER_KEYS)
    return { music: urls(payload.music), events }
  }

  /** Installs a mod from a folder or a .zip/.crx file. */
  install(source: string): ModInstallResult {
    try {
      return this.commit(fs.statSync(source).isDirectory() ? readFolder(source) : readArchive(source))
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível instalar o mod.' }
    }
  }

  /**
   * Installs a mod published on the GX Store. The store has no download button outside Opera GX, but a mod's
   * files sit at public addresses next to its manifest.json, so they are fetched one by one from there.
   * `ids` are the three UUIDs from the store's asset addresses (validated by the caller).
   */
  async installFromStore(ids: [string, string, string]): Promise<ModInstallResult> {
    const base = `${STORE_ASSETS}/${ids.join('/')}/contents/`
    const get = async (rel: string, limit: number): Promise<Uint8Array> => {
      const res = await net.fetch(base + rel.split('/').map(encodeURIComponent).join('/'))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = new Uint8Array(await res.arrayBuffer())
      if (data.byteLength > limit) throw new Error('arquivo grande demais')
      return data
    }
    try {
      let manifestData: Uint8Array
      try {
        manifestData = await get('manifest.json', 5 * 1024 * 1024)
      } catch {
        return { ok: false, error: 'Não consegui baixar o mod da loja. Tente de novo em instantes.' }
      }
      const manifest = JSON.parse(Buffer.from(manifestData).toString('utf-8').replace(/^\uFEFF/, '')) as Manifest
      const payload = readPayload(manifest)

      const wanted = new Set<string>()
      const add = (p: unknown): void => {
        const rel = typeof p === 'string' ? cleanRelative(p) : null
        if (rel && MEDIA_EXTENSIONS.has(extname(rel).toLowerCase())) wanted.add(rel)
      }
      payload.music.forEach(add)
      for (const key of Object.keys(KEYBOARD_KEYS)) payload.keyboard[key]?.forEach(add)
      for (const key of Object.keys(BROWSER_KEYS)) payload.browser[key]?.forEach(add)
      add(payload.wallpaper?.image)
      add(payload.wallpaper?.first_frame)
      const icons = manifest.icons ?? {}
      add(icons['512'] ?? Object.values(icons)[0])
      if (wanted.size > MAX_ENTRIES) return { ok: false, error: 'O mod é grande demais.' }

      const files: Files = new Map([['manifest.json', manifestData]])
      let total = 0
      const queue = [...wanted]
      // A few at a time: a mod can be dozens of files, some of them several MB.
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let rel = queue.shift(); rel; rel = queue.shift()) {
            try {
              const data = await get(rel, MAX_FILE_BYTES)
              total += data.byteLength
              if (total > MAX_TOTAL_BYTES) throw new Error(TOO_BIG)
              files.set(rel, data)
            } catch (err) {
              // One file missing on the store's side shouldn't sink the whole mod.
              if (err instanceof Error && err.message === TOO_BIG) throw err
            }
          }
        })
      )
      return this.commit(files)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível instalar o mod.' }
    }
  }

  /** Writes a mod's files (a manifest.json plus its media, possibly inside a wrapper folder) into the mods folder. */
  private commit(files: Files): ModInstallResult {
    // The manifest may sit inside a wrapper folder; everything is read relative to it.
    const manifestPath = [...files.keys()]
      .filter((k) => posix.basename(k).toLowerCase() === 'manifest.json')
      .sort((a, b) => a.split('/').length - b.split('/').length)[0]
    if (!manifestPath) return { ok: false, error: 'Não encontrei o manifest.json — isso não parece um mod.' }
    const prefix = manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) : ''

    let manifest: Manifest
    try {
      manifest = JSON.parse(Buffer.from(files.get(manifestPath)!).toString('utf-8').replace(/^\uFEFF/, ''))
    } catch {
      return { ok: false, error: 'O manifest.json do mod não é um JSON válido.' }
    }
    const name = str(manifest.name)
    if (!name) return { ok: false, error: 'O mod não tem nome no manifest.json.' }

    const id = slug(name)
    const target = resolve(this.dirOf(id)!)
    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(target, { recursive: true })
    for (const [path, data] of files) {
      if (!path.startsWith(prefix)) continue
      const rel = cleanRelative(path.slice(prefix.length))
      if (!rel) continue
      const out = resolve(target, rel)
      if (!out.startsWith(target + sep)) continue
      fs.mkdirSync(join(out, '..'), { recursive: true })
      fs.writeFileSync(out, data)
    }

    const mod = this.info(id, manifest)
    if (!mod.hasMusic && !mod.hasKeyboard && !mod.hasTabSounds && !mod.hasTheme && !mod.hasWallpaper) {
      fs.rmSync(target, { recursive: true, force: true })
      return { ok: false, error: 'Este mod só traz shaders ou estilos de página, que o Lumo ainda não usa.' }
    }
    return { ok: true, mod }
  }

  remove(id: string): void {
    const dir = this.dirOf(id)
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }

  /** Serves lumo-mod://<id>/<path>: only files inside that mod's own folder. */
  handleRequest(request: Request): Promise<Response> | Response {
    const url = new URL(request.url)
    const dir = this.dirOf(url.hostname)
    const rel = cleanRelative(decodeURIComponent(url.pathname))
    if (!dir || !rel) return new Response('Bad request', { status: 400 })
    const file = resolve(dir, rel)
    if (!file.startsWith(resolve(dir) + sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 })
    // The request's headers carry Range, which the audio element needs to seek.
    return net.fetch(pathToFileURL(file).toString(), { headers: request.headers })
  }
}
