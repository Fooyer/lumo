/**
 * What the assistant can do inside a web page. Everything here runs through the page's own web contents:
 * a script reads the DOM, and the actions go through real input events (insertText, mouse, keys) so that
 * pages treat them like the user's own.
 *
 * The scripts are plain strings on purpose: they run in the page, so they must not be touched by the bundler.
 */

export interface PageElement {
  id: number
  kind: 'link' | 'button' | 'input' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'editable' | 'other'
  label: string
  type?: string
  value?: string
  href?: string
  disabled?: boolean
  checked?: boolean
  options?: string[]
  /** A search box: submitting it is harmless. */
  search?: boolean
  /** A password / card field: never filled by the assistant. */
  secret?: boolean
}

export interface PageSnapshot {
  title: string
  url: string
  text: string
  elements: PageElement[]
  scrollY: number
  scrollMax: number
}

const SNAPSHOT_SCRIPT = String.raw`(() => {
  try {
    document.querySelectorAll('[data-lumo-id]').forEach((e) => e.removeAttribute('data-lumo-id'))
    const SEL = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=textbox],[role=searchbox],[role=combobox],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[contenteditable=""],[contenteditable="true"],[onclick]'
    const vw = innerWidth, vh = innerHeight
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const seen = new Set()
    const items = []
    for (const el of document.querySelectorAll(SEL)) {
      if (seen.has(el)) continue
      seen.add(el)
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue
      const inView = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
      items.push({ el, inView })
    }
    items.sort((a, b) => Number(b.inView) - Number(a.inView))
    const elements = []
    items.slice(0, 70).forEach(({ el }, i) => {
      const id = i + 1
      el.setAttribute('data-lumo-id', String(id))
      const tag = el.tagName.toLowerCase()
      const type = (el.getAttribute('type') || '').toLowerCase()
      const role = (el.getAttribute('role') || '').toLowerCase()
      let kind = 'other'
      if (tag === 'a' || role === 'link') kind = 'link'
      else if (tag === 'button' || role === 'button' || role === 'tab' || role === 'menuitem' || tag === 'summary') kind = 'button'
      else if (tag === 'textarea') kind = 'textarea'
      else if (tag === 'select') kind = 'select'
      else if (tag === 'input') {
        if (type === 'checkbox') kind = 'checkbox'
        else if (type === 'radio') kind = 'radio'
        else if (['button', 'submit', 'reset', 'image'].includes(type)) kind = 'button'
        else kind = 'input'
      } else if (el.isContentEditable || role === 'textbox' || role === 'searchbox' || role === 'combobox') kind = 'editable'
      else if (role === 'checkbox' || role === 'switch') kind = 'checkbox'
      const lab = el.labels && el.labels[0] ? el.labels[0].innerText : ''
      let label = clean(el.getAttribute('aria-label')) || clean(lab) || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title')) || clean(el.getAttribute('alt'))
      if (!label) label = clean(el.innerText || el.textContent)
      if (!label) label = clean(el.getAttribute('name') || el.id || el.value)
      const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
      const nm = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase()
      const secret = type === 'password' || ac.startsWith('cc-') || /(cvv|cvc|card.?number|cartao|senha|passw)/.test(nm)
      const search = type === 'search' || role === 'searchbox' || /(^|[^a-z])(q|query|search|busca|pesquis)/.test(nm + ' ' + label.toLowerCase())
      const entry = { id, kind, label: label.slice(0, 90) }
      if (type && kind !== 'link') entry.type = type
      if (kind === 'input' || kind === 'textarea' || kind === 'editable') {
        const v = secret ? '(oculto)' : clean(el.value !== undefined ? el.value : el.textContent)
        if (v) entry.value = v.slice(0, 80)
      }
      if (kind === 'link' && el.href) entry.href = String(el.href).slice(0, 110)
      if (el.disabled) entry.disabled = true
      if (kind === 'checkbox' || kind === 'radio') entry.checked = !!el.checked || el.getAttribute('aria-checked') === 'true'
      if (kind === 'select') entry.options = Array.from(el.options).slice(0, 14).map((o) => clean(o.text).slice(0, 40))
      if (search) entry.search = true
      if (secret) entry.secret = true
      elements.push(entry)
    })
    const root = document.querySelector('main, article, [role=main]') || document.body
    const text = ((root && root.innerText) || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 7000)
    return {
      title: document.title || '',
      url: location.href,
      text,
      elements,
      scrollY: Math.round(scrollY),
      scrollMax: Math.max(0, Math.round(document.documentElement.scrollHeight - innerHeight))
    }
  } catch (e) {
    return { error: String(e && e.message || e) }
  }
})()`

const PULSE = String.raw`const pulse = (el) => {
  try {
    const r = el.getBoundingClientRect()
    const d = document.createElement('div')
    d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ffb84d;border-radius:10px;box-shadow:0 0 0 5px rgba(255,184,77,.30),0 0 22px rgba(255,184,77,.85);transition:opacity .55s,transform .55s;left:' + (r.left - 5) + 'px;top:' + (r.top - 5) + 'px;width:' + (r.width + 10) + 'px;height:' + (r.height + 10) + 'px'
    document.documentElement.appendChild(d)
    setTimeout(() => { d.style.opacity = '0'; d.style.transform = 'scale(1.07)' }, 750)
    setTimeout(() => d.remove(), 1400)
  } catch (e) {}
};`

const LOCATE = (id: number, ms: number): string => String.raw`(() => {
  const el = document.querySelector('[data-lumo-id="${id}"]')
  if (!el) return null
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  try {
    const d = document.createElement('div')
    d.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #ff6b9d;border-radius:12px;box-shadow:0 0 0 6px rgba(255,107,157,.28),0 0 26px rgba(255,107,157,.9);transition:opacity .5s;left:' + (r.left - 6) + 'px;top:' + (r.top - 6) + 'px;width:' + (r.width + 12) + 'px;height:' + (r.height + 12) + 'px'
    document.documentElement.appendChild(d)
    setTimeout(() => { d.style.opacity = '0' }, ${ms})
    setTimeout(() => d.remove(), ${ms} + 600)
  } catch (e) {}
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
})()`

/** Finds the element a snapshot numbered, brings it into view and focuses/selects it for typing. */
const PREPARE_FILL = (id: number): string => String.raw`(() => {
  ${PULSE}
  const el = document.querySelector('[data-lumo-id="${id}"]')
  if (!el) return { ok: false, error: 'stale' }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const tag = el.tagName.toLowerCase()
  const type = (el.getAttribute('type') || '').toLowerCase()
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
  const nm = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase()
  if (type === 'password' || ac.startsWith('cc-') || /(cvv|cvc|card.?number|cartao|senha|passw)/.test(nm)) return { ok: false, error: 'secret' }
  pulse(el)
  if (tag === 'select') return { ok: true, kind: 'select' }
  if (type === 'checkbox' || type === 'radio' || ['button', 'submit', 'reset', 'file', 'image'].includes(type)) return { ok: true, kind: 'not-text' }
  const editable = el.isContentEditable || tag === 'input' || tag === 'textarea'
  if (!editable) return { ok: true, kind: 'not-text' }
  el.focus()
  if (tag === 'input' || tag === 'textarea') { try { el.select() } catch (e) {} }
  else { const range = document.createRange(); range.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range) }
  return { ok: true, kind: 'text' }
})()`

const READ_BACK = (id: number): string => String.raw`(() => {
  const el = document.querySelector('[data-lumo-id="${id}"]')
  if (!el) return null
  return el.value !== undefined && el.tagName.toLowerCase() !== 'div' ? String(el.value) : String(el.textContent || '')
})()`

/** Fallback for fields that ignore synthetic typing: the native setter plus the events frameworks listen to. */
const SET_VALUE = (id: number, text: string): string => String.raw`(() => {
  const el = document.querySelector('[data-lumo-id="${id}"]')
  if (!el) return false
  const text = ${JSON.stringify(text)}
  if (el.isContentEditable) { el.textContent = text }
  else {
    const proto = el.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(el, text); else el.value = text
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`

const SELECT_OPTION = (id: number, wanted: string): string => String.raw`(() => {
  const el = document.querySelector('[data-lumo-id="${id}"]')
  if (!el || el.tagName.toLowerCase() !== 'select') return { ok: false }
  const w = ${JSON.stringify(wanted)}.toLowerCase().trim()
  const opts = Array.from(el.options)
  const hit = opts.find((o) => o.text.trim().toLowerCase() === w || o.value.toLowerCase() === w) || opts.find((o) => o.text.toLowerCase().includes(w))
  if (!hit) return { ok: false, options: opts.slice(0, 14).map((o) => o.text.trim()) }
  el.value = hit.value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, chosen: hit.text.trim() }
})()`

const PREPARE_CLICK = (id: number): string => String.raw`(() => {
  ${PULSE}
  const el = document.querySelector('[data-lumo-id="${id}"]')
  if (!el) return { ok: false, error: 'stale' }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  const x = r.left + r.width / 2, y = r.top + r.height / 2
  const top = document.elementFromPoint(x, y)
  const covered = !(top && (top === el || el.contains(top) || top.contains(el)))
  pulse(el)
  return {
    ok: true, x, y, covered,
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    label: (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  }
})()`

const JS_CLICK = (id: number): string => String.raw`(() => {
  const el = document.querySelector('[data-lumo-id="${id}"]')
  if (!el) return false
  el.click()
  return true
})()`

const SCROLL = (direction: string): string => String.raw`(() => {
  let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
  let target = document.scrollingElement || document.documentElement
  while (el && el !== document.body && el !== document.documentElement) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 10) { target = el; break }
    el = el.parentElement
  }
  const page = target.clientHeight * 0.85
  const dir = ${JSON.stringify(direction)}
  if (dir === 'top') target.scrollTo({ top: 0, behavior: 'smooth' })
  else if (dir === 'bottom') target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' })
  else target.scrollBy({ top: dir === 'down' ? page : -page, behavior: 'smooth' })
  return { y: Math.round(target.scrollTop), max: Math.round(target.scrollHeight - target.clientHeight) }
})()`

const KEY_CODES: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  arrowdown: 'Down',
  arrowup: 'Up',
  arrowleft: 'Left',
  arrowright: 'Right',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  home: 'Home',
  end: 'End',
  backspace: 'Backspace'
}

export const ALLOWED_KEYS = Object.keys(KEY_CODES)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Waits until the page stops loading (or the timeout), plus a short pause for scripts to settle. */
export async function settle(wc: Electron.WebContents, timeoutMs = 10_000): Promise<void> {
  await sleep(350)
  if (!wc.isDestroyed() && wc.isLoading()) {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        wc.removeListener('did-stop-loading', done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      wc.once('did-stop-loading', done)
    })
  }
  await sleep(300)
}

export async function snapshotPage(wc: Electron.WebContents): Promise<PageSnapshot | { error: string }> {
  const result = (await wc.executeJavaScript(SNAPSHOT_SCRIPT, true)) as PageSnapshot | { error: string }
  return result
}

export type ActionResult = { ok: true; message: string } | { ok: false; error: string }

const STALE = 'Esse elemento não existe mais (a página mudou). Chame read_page de novo para ver os elementos atuais.'

export async function fillElement(
  wc: Electron.WebContents,
  id: number,
  text: string,
  submit: boolean
): Promise<ActionResult> {
  const prep = (await wc.executeJavaScript(PREPARE_FILL(id), true)) as { ok: boolean; error?: string; kind?: string }
  if (!prep.ok) {
    if (prep.error === 'secret') {
      return { ok: false, error: 'Esse é um campo de senha ou de cartão. Eu nunca preencho isso: peça para o usuário digitar.' }
    }
    return { ok: false, error: STALE }
  }
  if (prep.kind === 'not-text') return { ok: false, error: 'Esse elemento não aceita texto. Use click_element (ou fill_field em uma lista de opções).' }

  if (prep.kind === 'select') {
    const chosen = (await wc.executeJavaScript(SELECT_OPTION(id, text), true)) as { ok: boolean; chosen?: string; options?: string[] }
    if (!chosen.ok) return { ok: false, error: `Opção não encontrada. Opções: ${(chosen.options ?? []).join(' | ')}` }
    return { ok: true, message: `Opção "${chosen.chosen}" escolhida.` }
  }

  await wc.insertText(text)
  await sleep(120)
  let now = (await wc.executeJavaScript(READ_BACK(id), true)) as string | null
  if (now === null) return { ok: false, error: STALE }
  if (!now.includes(text.slice(0, 40))) {
    await wc.executeJavaScript(SET_VALUE(id, text), true)
    now = (await wc.executeJavaScript(READ_BACK(id), true)) as string | null
  }
  const typed = now !== null && now.includes(text.slice(0, 40))
  if (!typed) return { ok: false, error: 'O campo não aceitou o texto.' }

  if (submit) {
    await pressKey(wc, 'enter')
    await settle(wc)
    return { ok: true, message: 'Texto escrito e Enter pressionado.' }
  }
  return { ok: true, message: 'Texto escrito no campo.' }
}

export async function clickElement(wc: Electron.WebContents, id: number): Promise<ActionResult & { label?: string }> {
  const prep = (await wc.executeJavaScript(PREPARE_CLICK(id), true)) as {
    ok: boolean
    x: number
    y: number
    covered: boolean
    label: string
  }
  if (!prep.ok) return { ok: false, error: STALE }
  await sleep(180)
  if (prep.covered) {
    await wc.executeJavaScript(JS_CLICK(id), true)
  } else {
    const zoom = wc.getZoomFactor()
    const x = Math.round(prep.x * zoom)
    const y = Math.round(prep.y * zoom)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }
  await settle(wc)
  return { ok: true, message: `Cliquei em "${prep.label || 'elemento'}".`, label: prep.label }
}

/** Scrolls the element into view, rings it for a while and says where it is, in pixels of the page area. */
export async function locateElement(
  wc: Electron.WebContents,
  id: number,
  ringMs = 3500
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const r = (await wc.executeJavaScript(LOCATE(id, ringMs), true)) as { x: number; y: number; w: number; h: number } | null
  if (!r) return null
  const z = wc.getZoomFactor()
  return { x: r.x * z, y: r.y * z, w: r.w * z, h: r.h * z }
}

export async function pressKey(wc: Electron.WebContents, key: string): Promise<boolean> {
  const code = KEY_CODES[key.toLowerCase()]
  if (!code) return false
  wc.sendInputEvent({ type: 'keyDown', keyCode: code })
  if (code === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: code })
  await sleep(120)
  return true
}

export async function scrollPage(wc: Electron.WebContents, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<string> {
  const r = (await wc.executeJavaScript(SCROLL(direction), true)) as { y: number; max: number }
  await sleep(450)
  return r.max > 0 ? `Posição: ${Math.round((r.y / r.max) * 100)}% da página.` : 'A página não rola.'
}
