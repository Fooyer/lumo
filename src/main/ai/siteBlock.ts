import type { Session } from 'electron'
import { PERSONAS, type BlockedSite, type PersonaId } from '../../shared/ai'

/** Cancels main-frame loads of blocked sites; the tab then shows the character's own page (see `blockedPageUrl`). */
export function installSiteBlocker(ses: Session, find: (url: string) => BlockedSite | null): void {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (details.resourceType === 'mainFrame' && find(details.url)) return callback({ cancel: true })
    callback({})
  })
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

/** The page that takes the blocked site's place: who blocked it, why, and how to undo it. */
export function blockedPageUrl(entry: BlockedSite, persona: PersonaId): string {
  const who = PERSONAS[persona]
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Site bloqueado</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#14151d;color:#f1f1f6}
main{max-width:460px;padding:32px;text-align:center}
.shield{font-size:54px;line-height:1}
h1{font-size:22px;margin:14px 0 6px}
p{color:#b9bbcb;line-height:1.5;margin:6px 0}
b{color:#f1f1f6}
code{background:#23253a;padding:2px 7px;border-radius:6px}
@media (prefers-color-scheme:light){body{background:#f5f5fa;color:#1d1e2b}p{color:#555770}b{color:#1d1e2b}code{background:#e6e7f2}}
</style></head><body><main>
<div class="shield">🛡️</div>
<h1>${esc(who.name)} bloqueou este site</h1>
<p><code>${esc(entry.host)}</code></p>
<p>${entry.reason ? `<b>Motivo:</b> ${esc(entry.reason)}` : 'Ela preferiu que você não entrasse aqui.'}</p>
<p>Se mudou de ideia, peça para ${esc(who.name)} liberar, ou remova o site em <b>Configurações → Assistente → Sites bloqueados</b>.</p>
</main></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
