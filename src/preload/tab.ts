import { ipcRenderer } from 'electron'

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
