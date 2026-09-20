import fs from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { app, components } from 'electron'

// Google no longer serves the standalone Widevine CDM to non-Chrome clients on Windows, so the
// component updater reports it as "not installed" and DRM playback (Crunchyroll, Netflix, …) fails
// with "Unsupported keySystem". Chromium registers any valid CDM found in <userData>/WidevineCdm,
// so we reuse the copy that Edge/Chrome/Brave already keep on this machine (Windows and Linux).
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

/**
 * The newest CDM a Linux browser offers: the copy shipped with the app (Flatpak runtime files or a native
 * install next to the binary) or a newer <version> folder its own updater dropped in the profile.
 */
function newestLinuxCdm(shippedDirs: string[], profileDirs: string[]): CdmCopy | null {
  const shipped = newestCdmAmong(shippedDirs)
  const updated = newestCdmIn(profileDirs, '')
  return updated && (!shipped || compareVersions(updated.version, shipped.version) > 0) ? updated : shipped
}

/** Windows keeps the CDM in <version>/WidevineCdm; Linux in a single WidevineCdm folder (Flatpak on Bazzite). */
function findBrowserCdm(): CdmCopy | null {
  if (process.platform === 'win32') return newestCdmIn(browserApplicationDirs(), 'WidevineCdm')
  if (process.platform !== 'linux') return null
  const home = homedir()
  const flatpakExtra = (id: string): string[] => [
    `/var/lib/flatpak/app/${id}/x86_64/stable/active/files/extra/WidevineCdm`,
    join(home, `.local/share/flatpak/app/${id}/x86_64/stable/active/files/extra/WidevineCdm`)
  ]
  // Edge first: it's the browser Google's sign-in and the streaming sites accepted this build alongside,
  // while the CDM copied from Chrome went with a "This browser may not be secure" on Google login.
  // Chrome is only the fallback when Edge isn't installed.
  return (
    newestLinuxCdm(
      [...flatpakExtra('com.microsoft.Edge'), '/opt/microsoft/msedge/WidevineCdm'],
      [
        join(home, '.var/app/com.microsoft.Edge/config/microsoft-edge/WidevineCdm'),
        join(home, '.config/microsoft-edge/WidevineCdm')
      ]
    ) ??
    newestLinuxCdm(
      [...flatpakExtra('com.google.Chrome'), '/opt/google/chrome/WidevineCdm'],
      [
        join(home, '.var/app/com.google.Chrome/config/google-chrome/WidevineCdm'),
        join(home, '.config/google-chrome/WidevineCdm')
      ]
    )
  )
}

/** Must run before the app is ready, i.e. before Chromium registers its components. */
export function installWidevineFromBrowser(): void {
  try {
    const source = findBrowserCdm()
    if (!source) return
    const target = join(app.getPath('userData'), 'WidevineCdm')
    const installed = newestCdmIn([target], '')
    if (installed) {
      const order = compareVersions(installed.version, source.version)
      // Windows only ever moves forward. On Linux the source is chosen by preference (Edge over Chrome), so
      // a copy of a different version — say one taken from Chrome earlier — is replaced, not kept.
      if (process.platform === 'linux' ? order === 0 : order >= 0) return
      if (process.platform === 'linux') fs.rmSync(target, { recursive: true, force: true })
    }
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
      console.warn('[lumo] Widevine indisponível: instale o Microsoft Edge (ou o Google Chrome) para tocar conteúdo com DRM.')
    }
  } catch (err) {
    console.warn('[lumo] Falha ao preparar o Widevine:', err)
  }
}
