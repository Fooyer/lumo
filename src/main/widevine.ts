import fs from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { app, components } from 'electron'

// Google no longer serves the standalone Widevine CDM to non-Chrome clients on Windows, so the
// component updater reports it as "not installed" and DRM playback (Crunchyroll, Netflix, …) fails
// with "Unsupported keySystem". Chromium registers any valid CDM found in <userData>/WidevineCdm,
// so we reuse the copy that Chrome/Edge/Brave already keep on this machine (Windows and Linux).
const CDM_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const CDM_BINARY =
  process.platform === 'win32'
    ? join('_platform_specific', `win_${CDM_ARCH}`, 'widevinecdm.dll')
    : join('_platform_specific', `linux_${CDM_ARCH}`, 'libwidevinecdm.so')
const WIDEVINE_WAIT_MS = 5_000

interface CdmCopy {
  version: string
  dir: string
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function readCdm(dir: string): CdmCopy | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(join(dir, 'manifest.json'), 'utf-8'))
    if (typeof manifest.version !== 'string' || !fs.existsSync(join(dir, CDM_BINARY))) return null
    return { version: manifest.version, dir }
  } catch {
    return null
  }
}

function newestCdmIn(parents: string[], sub: string): CdmCopy | null {
  let best: CdmCopy | null = null
  for (const parent of parents) {
    let entries: string[]
    try {
      entries = fs.readdirSync(parent)
    } catch {
      continue
    }
    for (const entry of entries) {
      const cdm = readCdm(sub ? join(parent, entry, sub) : join(parent, entry))
      if (cdm && (!best || compareVersions(cdm.version, best.version) > 0)) best = cdm
    }
  }
  return best
}

function newestCdmAmong(dirs: string[]): CdmCopy | null {
  let best: CdmCopy | null = null
  for (const dir of dirs) {
    const cdm = readCdm(dir)
    if (cdm && (!best || compareVersions(cdm.version, best.version) > 0)) best = cdm
  }
  return best
}

function browserApplicationDirs(): string[] {
  const programFiles = process.env['ProgramFiles']
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env['LOCALAPPDATA']
  return [
    programFiles && join(programFiles, 'Google', 'Chrome', 'Application'),
    programFilesX86 && join(programFilesX86, 'Google', 'Chrome', 'Application'),
    localAppData && join(localAppData, 'Google', 'Chrome', 'Application'),
    programFilesX86 && join(programFilesX86, 'Microsoft', 'Edge', 'Application'),
    programFiles && join(programFiles, 'Microsoft', 'Edge', 'Application'),
    programFiles && join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application'),
    localAppData && join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application')
  ].filter((p): p is string => !!p)
}

/** Chrome keeps its CDM in <version>/WidevineCdm on Windows, but in a single WidevineCdm folder on Linux. */
function findBrowserCdm(): CdmCopy | null {
  if (process.platform === 'win32') return newestCdmIn(browserApplicationDirs(), 'WidevineCdm')
  if (process.platform !== 'linux') return null
  const home = homedir()
  // The Flatpak build (the usual one on immutable distros such as Bazzite) ships the CDM in its runtime
  // files; a native install puts it next to the binary; Chrome's own updater drops newer <version> folders
  // in the profile directory.
  const shipped = newestCdmAmong([
    '/var/lib/flatpak/app/com.google.Chrome/x86_64/stable/active/files/extra/WidevineCdm',
    join(home, '.local/share/flatpak/app/com.google.Chrome/x86_64/stable/active/files/extra/WidevineCdm'),
    '/opt/google/chrome/WidevineCdm'
  ])
  const updated = newestCdmIn(
    [
      join(home, '.var/app/com.google.Chrome/config/google-chrome/WidevineCdm'),
      join(home, '.config/google-chrome/WidevineCdm')
    ],
    ''
  )
  return updated && (!shipped || compareVersions(updated.version, shipped.version) > 0) ? updated : shipped
}

/** Must run before the app is ready, i.e. before Chromium registers its components. */
export function installWidevineFromBrowser(): void {
  try {
    const source = findBrowserCdm()
    if (!source) return
    const target = join(app.getPath('userData'), 'WidevineCdm')
    const installed = newestCdmIn([target], '')
    if (installed && compareVersions(installed.version, source.version) >= 0) return
    fs.cpSync(source.dir, join(target, source.version), { recursive: true })
  } catch (err) {
    console.warn('[lumo] Não foi possível instalar o Widevine a partir do navegador instalado:', err)
  }
}

/** Waits (bounded) for the Widevine components so the first DRM page doesn't race their registration. */
export async function whenWidevineReady(): Promise<void> {
  try {
    // No component is *required*: the updater can legitimately have nothing to offer (see above).
    await Promise.race([
      components.whenReady([]),
      new Promise((resolve) => setTimeout(resolve, WIDEVINE_WAIT_MS))
    ])
    if (components.status()[components.WIDEVINE_CDM_ID]?.status === 'not-installed') {
      console.warn('[lumo] Widevine indisponível: instale o Google Chrome (ou o Microsoft Edge no Windows) para tocar conteúdo com DRM.')
    }
  } catch (err) {
    console.warn('[lumo] Falha ao preparar o Widevine:', err)
  }
}
