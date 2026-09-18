import { ipcRenderer } from 'electron'

interface CredentialForDomain {
  username: string
  password: string
}

function usernameCandidates(scope: Document | HTMLFormElement): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input:not([type])'))
}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer
    .invoke('passwords:get-for-domain', location.hostname)
    .then((cred: CredentialForDomain | null) => {
      if (!cred) return
      const passInput = document.querySelector<HTMLInputElement>('input[type="password"]')
      if (!passInput) return
      const scope = passInput.form ?? document
      const userInput = usernameCandidates(scope)[0]
      if (userInput) setValue(userInput, cred.username)
      setValue(passInput, cred.password)
    })
    .catch(() => {})
})

document.addEventListener(
  'submit',
  (event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    const passInput = form.querySelector<HTMLInputElement>('input[type="password"]')
    if (!passInput || !passInput.value) return
    const userInput = usernameCandidates(form)[0]
    ipcRenderer.send('passwords:capture', {
      domain: location.hostname,
      username: userInput?.value ?? '',
      password: passInput.value
    })
  },
  true
)

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
