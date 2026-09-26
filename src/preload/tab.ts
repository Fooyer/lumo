import { ipcRenderer, webFrame } from 'electron'

// Electron hands pages a bare `window.chrome` ({}), while Chrome's has `app`, `csi` and `loadTimes`. Google's
// sign-in reads that as the mark of an embedded browser and refuses with "This browser or app may not be
// secure". This completes the object in the page's own world before any page script runs, in every frame.
// (webFrame rather than an inline <script>: it isn't subject to the page's Content-Security-Policy.)
const COMPLETE_CHROME_OBJECT = `(() => {
  const chrome = window.chrome || (window.chrome = {})
  const define = (name, value) => {
    if (name in chrome) return
    Object.defineProperty(chrome, name, { value, writable: true, enumerable: true, configurable: true })
  }
  define('app', {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: function getDetails() { return null },
    getIsInstalled: function getIsInstalled() { return false },
    installState: function installState(callback) { if (callback) callback('not_installed') },
    runningState: function runningState() { return 'cannot_run' }
  })
  define('csi', function csi() {
    const t = performance.timing
    return { startE: t.navigationStart, onloadT: t.domContentLoadedEventEnd, pageT: Date.now() - t.navigationStart, tran: 15 }
  })
  define('loadTimes', function loadTimes() {
    const t = performance.timing
    return {
      requestTime: t.navigationStart / 1000, startLoadTime: t.navigationStart / 1000, commitLoadTime: t.responseStart / 1000,
      finishDocumentLoadTime: t.domContentLoadedEventEnd / 1000, finishLoadTime: t.loadEventEnd / 1000,
      firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true,
      wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
    }
  })
})()`

void webFrame.executeJavaScript(COMPLETE_CHROME_OBJECT).catch(() => {})

// Swaps the page's window.alert() for Lumo's own styled dialog. Since contextIsolation keeps this
// preload's `window` separate from the page's, the override is injected as an inline <script> that
// runs directly in the page's own world, and it talks back to us here via postMessage.
const ALERT_BRIDGE_EVENT = '__lumo_alert__'

function injectAlertOverride(): void {
  const target = document.documentElement || document.head || document.body
  if (!target) {
    setTimeout(injectAlertOverride, 0)
    return
  }
  const script = document.createElement('script')
  script.textContent = `(() => {
    window.alert = function (message) {
      window.postMessage({ type: '${ALERT_BRIDGE_EVENT}', message: String(message) }, '*')
    }
  })()`
  target.appendChild(script)
  script.remove()
}
injectAlertOverride()

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as { type?: string; message?: string } | null
  if (data?.type === ALERT_BRIDGE_EVENT) {
    ipcRenderer.send('dialog:alert', { message: data.message ?? '', domain: location.hostname })
  }
})

// Typing sounds: tells the UI a key was pressed in a text field. Only the kind of key is sent, never which one.
function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && /^(text|search|email|url|tel|password|number)$/.test(el.type)
  }
  return false
}

window.addEventListener(
  'keydown',
  (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || !isEditable(document.activeElement)) return
    const kind =
      e.key === 'Backspace' ? 'key-backspace' : e.key === 'Enter' ? 'key-enter' : e.key === ' ' ? 'key-space' : e.key.length === 1 ? 'key-letter' : null
    if (kind) ipcRenderer.send('sound:key', kind)
  },
  true
)
