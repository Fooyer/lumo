import { session, type Session } from 'electron'

/**
 * Private tabs share one browser session that lives only in memory: a partition name without the `persist:`
 * prefix never touches the disk (no cookies, cache, local storage or IndexedDB are written). It is wiped when the
 * last private tab closes, so the next private tab starts from nothing, as if it were a new window.
 */
export const PRIVATE_PARTITION = 'lumo-private'

// Second-level labels under a country code, so "shop.example.co.uk" is "example.co.uk" and not "co.uk".
// It's an approximation of the public suffix list, enough to tell "same site" from "another site".
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'])

/** "a.b.example.com" -> "example.com"; IPs and single labels are returned as they are. */
export function registrableDomain(host: string): string {
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host
  const labels = host.toLowerCase().split('.')
  if (labels.length <= 2) return host.toLowerCase()
  const take = labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2
  return labels.slice(-take).join('.')
}

function siteOf(url: string): string | null {
  try {
    return registrableDomain(new URL(url).hostname)
  } catch {
    return null
  }
}

/** True for a request a page makes to another site than the one in the tab (an ad, an analytics script, an embed). */
function isThirdParty(details: { url: string; resourceType: string; webContents?: Electron.WebContents }): boolean {
  if (details.resourceType === 'mainFrame') return false
  const top = details.webContents && !details.webContents.isDestroyed() ? siteOf(details.webContents.getURL()) : null
  const target = siteOf(details.url)
  return !!top && !!target && top !== target
}

const DENIED_PERMISSIONS = new Set(['geolocation', 'notifications', 'midi', 'midiSysex', 'hid', 'serial', 'usb'])

let configured = false

/** The private session, set up on first use. `adjustHeaders` lets the app apply its own per-site header tweaks. */
export function getPrivateSession(
  adjustHeaders: (url: string, headers: Record<string, string>) => Record<string, string>
): Session {
  const ses = session.fromPartition(PRIVATE_PARTITION)
  if (configured) return ses
  configured = true

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    let headers: Record<string, string> = { ...details.requestHeaders }
    // "Do not track" and Global Privacy Control: honored by the sites that respect them.
    headers['DNT'] = '1'
    headers['Sec-GPC'] = '1'
    if (isThirdParty(details)) {
      // Another site's cookies aren't sent along with what a page embeds from it, and it only learns the
      // origin of the page, not the full address.
      for (const name of Object.keys(headers)) if (name.toLowerCase() === 'cookie') delete headers[name]
      if (details.referrer) {
        try {
          headers['Referer'] = new URL(details.referrer).origin + '/'
        } catch {
          delete headers['Referer']
        }
      }
    }
    headers = adjustHeaders(details.url, headers)
    callback({ requestHeaders: headers })
  })

  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!isThirdParty(details) || !details.responseHeaders) return callback({})
    // ...and what such requests answer with can't set cookies, which is how most cross-site tracking follows you.
    const responseHeaders = { ...details.responseHeaders }
    for (const name of Object.keys(responseHeaders)) if (name.toLowerCase() === 'set-cookie') delete responseHeaders[name]
    callback({ responseHeaders })
  })

  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(!DENIED_PERMISSIONS.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => !DENIED_PERMISSIONS.has(permission))
  return ses
}

/** Forgets everything the private tabs stored or cached. */
export async function wipePrivateSession(): Promise<void> {
  if (!configured) return
  const ses = session.fromPartition(PRIVATE_PARTITION)
  await Promise.allSettled([
    ses.clearStorageData(),
    ses.clearCache(),
    ses.clearAuthCache(),
    ses.clearHostResolverCache(),
    ses.clearCodeCaches({})
  ])
}
