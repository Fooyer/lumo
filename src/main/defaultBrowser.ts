import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { app, shell } from 'electron'
import type { DefaultBrowserStatus } from '../shared/ipc'

const run = promisify(execFile)

const APP_NAME = 'Lumo'
const URL_PROG_ID = 'LumoURL'
const HTML_PROG_ID = 'LumoHTML'
const HTML_EXTENSIONS = ['.htm', '.html', '.xhtml']

interface RegistryRoots {
  classes: string
  clients: string
  registered: string
}

const HKCU: RegistryRoots = {
  classes: 'HKCU\\Software\\Classes',
  clients: 'HKCU\\Software\\Clients\\StartMenuInternet',
  registered: 'HKCU\\Software\\RegisteredApplications'
}

function regAdd(key: string, name: string | null, data: string): Promise<unknown> {
  const target = name === null ? ['/ve'] : ['/v', name]
  return run('reg', ['add', key, ...target, '/t', 'REG_SZ', '/d', data, '/f'])
}

/**
 * Registers Lumo as a browser under HKCU (no admin rights needed), which is what makes it show up in
 * Windows' "Default apps" list. Windows 10/11 deliberately don't let an app make itself the default.
 * `roots` is a parameter only so the registration can be exercised against a scratch registry key.
 */
export async function registerAsBrowser(
  roots: RegistryRoots = HKCU,
  exe: string = process.execPath,
  appPath: string | null = process.defaultApp ? app.getAppPath() : null
): Promise<void> {
  const launcher = appPath ? `"${exe}" "${appPath}"` : `"${exe}"`
  const openWithArg = `${launcher} "%1"`
  const capabilities = `${roots.clients}\\${APP_NAME}\\Capabilities`

  const progId = async (id: string, description: string, isUrl: boolean): Promise<void> => {
    const key = `${roots.classes}\\${id}`
    await regAdd(key, null, description)
    if (isUrl) await regAdd(key, 'URL Protocol', '')
    await regAdd(`${key}\\DefaultIcon`, null, `${exe},0`)
    await regAdd(`${key}\\shell\\open\\command`, null, openWithArg)
  }
  await progId(URL_PROG_ID, 'Lumo URL', true)
  await progId(HTML_PROG_ID, 'Lumo HTML Document', false)

  await regAdd(`${roots.clients}\\${APP_NAME}`, null, APP_NAME)
  await regAdd(capabilities, 'ApplicationName', APP_NAME)
  await regAdd(capabilities, 'ApplicationDescription', 'Lumo - navegador inteligente')
  await regAdd(capabilities, 'ApplicationIcon', `${exe},0`)
  for (const protocol of ['http', 'https']) {
    await regAdd(`${capabilities}\\URLAssociations`, protocol, URL_PROG_ID)
  }
  for (const ext of HTML_EXTENSIONS) {
    await regAdd(`${capabilities}\\FileAssociations`, ext, HTML_PROG_ID)
  }
  await regAdd(`${roots.clients}\\${APP_NAME}\\shell\\open\\command`, null, launcher)
  await regAdd(roots.registered, APP_NAME, `Software\\Clients\\StartMenuInternet\\${APP_NAME}\\Capabilities`)
}

async function chosenHandler(protocol: string): Promise<string | null> {
  try {
    const { stdout } = await run('reg', [
      'query',
      `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${protocol}\\UserChoice`,
      '/v',
      'ProgId'
    ])
    return /ProgId\s+REG_SZ\s+(\S+)/i.exec(String(stdout))?.[1] ?? null
  } catch {
    return null
  }
}

export async function getDefaultBrowserStatus(): Promise<DefaultBrowserStatus> {
  if (process.platform !== 'win32') return { supported: false, isDefault: false }
  const [http, https] = await Promise.all([chosenHandler('http'), chosenHandler('https')])
  return { supported: true, isDefault: http === URL_PROG_ID && https === URL_PROG_ID }
}

export async function makeDefaultBrowser(): Promise<void> {
  if (process.platform !== 'win32') return
  await registerAsBrowser()
  // On Windows 11 this jumps straight to Lumo's page in Default apps; on 10 it opens the list.
  await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${APP_NAME}`)
}

/**
 * Pages other programs hand to Lumo on the command line (as the default browser they pass the URL,
 * or the path of an .html file). Only http(s) and local HTML documents are accepted.
 */
export function externalUrlsFromArgv(argv: string[]): string[] {
  const urls: string[] = []
  for (const arg of argv.slice(1)) {
    if (/^https?:\/\//i.test(arg)) {
      urls.push(arg)
    } else if (!arg.startsWith('-') && HTML_EXTENSIONS.some((e) => arg.toLowerCase().endsWith(e))) {
      try {
        if (fs.statSync(arg).isFile()) urls.push(pathToFileURL(arg).href)
      } catch {
        // not a file we can open
      }
    }
  }
  return urls
}
