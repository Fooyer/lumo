import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Headphones, Mic, Send, Settings as SettingsIcon, Square, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import {
  AI_PROVIDERS,
  PERSONAS,
  parseEmoteTags,
  providerInfo,
  type AiChatMessage,
  type AiEvent,
  type AiKeyStatus,
  type AiProviderId,
  type AssistantSettings,
  type VoiceState
} from '@shared/ai'
import { useTheme } from '../lib/useTheme'

type Item =
  | { kind: 'msg'; msg: AiChatMessage; fresh: boolean }
  | { kind: 'step'; id: string; label: string; state: 'run' | 'ok' | 'fail' }
  | { kind: 'error'; id: string; text: string }

interface Confirm {
  id: string
  title: string
  detail: string
}

const SUGGESTIONS = [
  'O que você consegue fazer?',
  'Pesquise receitas de bolo de cenoura',
  'Mude para o tema claro',
  'Resuma esta página para mim'
]

/** Bold, inline code and links; everything else stays text. */
function renderInline(text: string, openUrl: (url: string) => void): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g
  let last = 0
  let key = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) parts.push(text.slice(last, i))
    const tok = m[0]
    if (tok.startsWith('**')) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) parts.push(<code key={key++}>{tok.slice(1, -1)}</code>)
    else {
      const url = tok.replace(/[.,;:!?]+$/, '')
      parts.push(
        <a key={key++} onClick={() => openUrl(url)} title={url}>
          {url.length > 46 ? `${url.slice(0, 44)}…` : url}
        </a>
      )
      if (url.length < tok.length) parts.push(tok.slice(url.length))
    }
    last = i + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/** Reveals the text as if she were saying it. */
function Typed({ text, animate, onTick, openUrl }: { text: string; animate: boolean; onTick: () => void; openUrl: (u: string) => void }): JSX.Element {
  const [shown, setShown] = useState(animate ? 0 : text.length)
  useEffect(() => {
    if (!animate) return
    let n = 0
    const timer = setInterval(() => {
      n = Math.min(text.length, n + Math.max(1, Math.round(text.length / 140)))
      setShown(n)
      onTick()
      if (n >= text.length) clearInterval(timer)
    }, 24)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate])
  return <>{renderInline(text.slice(0, shown), openUrl)}</>
}

export default function MascotChat(): JSX.Element {
  useTheme()
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [confirms, setConfirms] = useState<Confirm[]>([])
  const [assistant, setAssistant] = useState<AssistantSettings | null>(null)
  const [keys, setKeys] = useState<AiKeyStatus | null>(null)
  const [input, setInput] = useState('')
  const [voice, setVoice] = useState<VoiceState>('idle')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)

  const openUrl = useCallback((url: string) => void window.lumo.createTab(url), [])

  const scrollDown = useCallback(() => {
    const el = logRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [])

  // ---- load: history, settings, key status
  useEffect(() => {
    void window.lumo.aiHistory().then(({ messages, busy: b }) => {
      setItems(messages.map((msg) => ({ kind: 'msg', msg, fresh: false })))
      setBusy(b)
    })
    void window.lumo.getSettings().then((s) => setAssistant(s.assistant))
    void window.lumo.aiKeyStatus().then(setKeys)
    const offSettings = window.lumo.onSettingsChanged((s) => setAssistant(s.assistant))
    const offState = window.lumo.onMascotChatState((o) => {
      setOpen(o)
      if (o) {
        void window.lumo.aiKeyStatus().then(setKeys)
        setTimeout(() => inputRef.current?.focus(), 60)
      }
    })
    const offAi = window.lumo.onAiEvent((e: AiEvent) => {
      if (e.type === 'busy') setBusy(e.busy)
      else if (e.type === 'tool-start') setItems((list) => [...list, { kind: 'step', id: e.id, label: e.label, state: 'run' }])
      else if (e.type === 'tool-end')
        setItems((list) => list.map((it) => (it.kind === 'step' && it.id === e.id ? { ...it, state: e.ok ? 'ok' : 'fail' } : it)))
      else if (e.type === 'message') setItems((list) => [...list, { kind: 'msg', msg: e.message, fresh: true }])
      else if (e.type === 'error') {
        setItems((list) => [...list, { kind: 'error', id: `${Date.now()}`, text: e.message }])
        if (e.code === 'no-key' || e.code === 'auth') void window.lumo.aiKeyStatus().then(setKeys)
      } else if (e.type === 'confirm') setConfirms((list) => [...list, { id: e.id, title: e.title, detail: e.detail }])
      else if (e.type === 'confirm-done') setConfirms((list) => list.filter((c) => c.id !== e.id))
      else if (e.type === 'cleared') setItems([])
      else if (e.type === 'voice') setVoice(e.state)
      else if (e.type === 'user') setItems((list) => [...list, { kind: 'msg', msg: e.message, fresh: false }])
    })
    return () => {
      offSettings()
      offState()
      offAi()
    }
  }, [])

  useEffect(() => {
    scrollDown()
  }, [items, busy, confirms, scrollDown])

  const needsKey = useMemo(() => {
    if (!assistant || !keys) return false
    const info = providerInfo(assistant.provider)
    return info.needsKey && !keys.keys[assistant.provider]
  }, [assistant, keys])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busy) return
      setInput('')
      stickRef.current = true
      setItems((list) => [...list, { kind: 'msg', msg: { id: `u${Date.now()}`, role: 'user', text, at: Date.now() }, fresh: false }])
      const result = await window.lumo.aiSend(text)
      if (!result.ok && result.code === 'no-key') {
        setItems((list) => list.slice(0, -1))
        void window.lumo.aiKeyStatus().then(setKeys)
      } else if (!result.ok && result.code === 'busy') {
        setItems((list) => [...list, { kind: 'error', id: `${Date.now()}`, text: result.error ?? 'Ocupada no momento.' }])
      }
    },
    [busy]
  )

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(input)
    }
  }

  const grow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`
  }

  const persona = PERSONAS[assistant?.persona ?? 'girl']
  const status =
    voice === 'listening'
      ? 'ouvindo você…'
      : voice === 'transcribing'
        ? 'entendendo o que você disse…'
        : voice === 'speaking'
          ? 'falando…'
          : busy
            ? 'trabalhando nisso…'
            : assistant
              ? `${providerInfo(assistant.provider).label.split(' (')[0]} · ${assistant.model || providerInfo(assistant.provider).defaultModel}`
              : ''
  const setAssistantFlag = (partial: Partial<AssistantSettings>): void => {
    if (assistant) void window.lumo.setSettings({ assistant: { ...assistant, ...partial } })
  }

  return (
    <div className={`lc-wrap ${open ? '' : 'lc-wrap--closing'}`}>
      <div className="lc-head">
        <div className={`lc-avatar lc-avatar--${persona.id}`}>{persona.name[0]}</div>
        <div className="lc-title">
          <strong>{persona.name}</strong>
          <span>{status}</span>
        </div>
        <button
          className={`lc-iconbtn ${assistant?.voice ? 'lc-iconbtn--on' : ''}`}
          title={assistant?.voice ? 'Desligar a voz dela' : 'Ligar a voz dela'}
          onClick={() => setAssistantFlag({ voice: !assistant?.voice })}
        >
          {assistant?.voice ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button
          className={`lc-iconbtn ${assistant?.voiceMode ? 'lc-iconbtn--on' : ''}`}
          title={assistant?.voiceMode ? 'Desligar o modo conversa por voz' : 'Modo conversa por voz (mãos livres)'}
          onClick={() => setAssistantFlag({ voiceMode: !assistant?.voiceMode })}
        >
          <Headphones size={15} />
        </button>
        <button className="lc-iconbtn" title="Apagar a conversa" onClick={() => void window.lumo.aiClear()}>
          <Trash2 size={15} />
        </button>
        <button className="lc-iconbtn" title="Configurações do assistente" onClick={() => window.lumo.openFullSettings()}>
          <SettingsIcon size={15} />
        </button>
        <button className="lc-iconbtn" title="Fechar (Esc)" onClick={() => window.lumo.closeAssistantChat()}>
          <X size={16} />
        </button>
      </div>

      <div
        className="lc-log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {needsKey && assistant && <KeySetup assistant={assistant} onDone={() => void window.lumo.aiKeyStatus().then(setKeys)} />}

        {items.length === 0 && !needsKey && (
          <div className="lc-msg lc-msg--bot">
            {persona.id === 'girl'
              ? 'Oi! Eu sou a Lumi. Posso abrir abas, pesquisar, preencher campos, trocar o tema e muito mais. Só pedir! Também dá pra falar comigo pelo microfone.'
              : 'Eu sou o Lux. Abro abas, pesquiso, preencho campos e ajusto o navegador. É só pedir, por texto ou pelo microfone.'}
          </div>
        )}

        {items.map((it) => {
          if (it.kind === 'step') {
            return (
              <div key={it.id} className={`lc-step ${it.state === 'ok' ? 'lc-step--done' : it.state === 'fail' ? 'lc-step--fail' : ''}`}>
                <span className="lc-step__dot" />
                {it.label}
              </div>
            )
          }
          if (it.kind === 'error') {
            return (
              <div key={it.id} className="lc-msg lc-msg--error">
                {it.text}
              </div>
            )
          }
          const isUser = it.msg.role === 'user'
          const text = isUser ? it.msg.text : parseEmoteTags(it.msg.text).text
          return (
            <div key={it.msg.id} className={`lc-msg ${isUser ? 'lc-msg--user' : 'lc-msg--bot'}`}>
              {isUser ? text : <Typed text={text} animate={it.fresh} onTick={scrollDown} openUrl={openUrl} />}
            </div>
          )
        })}

        {confirms.map((c) => (
          <div key={c.id} className="lc-confirm">
            <strong>{c.title}</strong>
            <p>{c.detail}</p>
            <div className="lc-confirm__row">
              <button className="lc-btn" onClick={() => window.lumo.aiConfirmReply(c.id, false)}>
                Agora não
              </button>
              <button className="lc-btn lc-btn--primary" onClick={() => window.lumo.aiConfirmReply(c.id, true)}>
                Pode fazer
              </button>
            </div>
          </div>
        ))}

        {busy && confirms.length === 0 && (
          <div className="lc-typing" aria-label="Lumi está pensando">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>

      {items.length === 0 && !needsKey && (
        <div className="lc-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="lc-chip" onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="lc-compose">
        <button
          className={`lc-mic ${voice === 'listening' ? 'lc-mic--live' : ''}`}
          title={voice === 'listening' ? 'Parar de ouvir' : 'Falar (Ctrl+Shift+M)'}
          disabled={needsKey || busy}
          onClick={() => window.lumo.voiceToggle()}
        >
          <Mic size={16} />
        </button>
        <textarea
          ref={inputRef}
          className="lc-input"
          rows={1}
          value={input}
          placeholder={needsKey ? 'Configure uma chave para conversar' : voice === 'listening' ? 'Estou ouvindo…' : 'Escreva ou use o microfone…'}
          disabled={needsKey}
          onChange={(e) => {
            setInput(e.target.value)
            grow(e.target)
          }}
          onKeyDown={onKey}
        />
        {busy ? (
          <button className="lc-send lc-send--stop" title="Parar" onClick={() => window.lumo.aiCancel()}>
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button className="lc-send" title="Enviar" disabled={!input.trim() || needsKey} onClick={() => void send(input)}>
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Shown in place of the conversation until a key is saved. */
function KeySetup({ assistant, onDone }: { assistant: AssistantSettings; onDone: () => void }): JSX.Element {
  const [provider, setProvider] = useState<AiProviderId>(assistant.provider)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const info = providerInfo(provider)

  const useWithoutKey = async (): Promise<void> => {
    const free = providerInfo('pollinations')
    await window.lumo.setSettings({ assistant: { ...assistant, provider: 'pollinations', model: free.defaultModel, baseUrl: '' } })
    onDone()
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const model = provider === assistant.provider && assistant.model ? assistant.model : info.defaultModel
      await window.lumo.setSettings({ assistant: { ...assistant, provider, model, baseUrl: provider === assistant.provider ? assistant.baseUrl : '' } })
      if (key.trim()) await window.lumo.aiSetKey(provider, key)
      const result = await window.lumo.aiTest()
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) {
        setKey('')
        setTimeout(onDone, 700)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lc-setup">
      <h3>Vamos nos conectar?</h3>
      <p>
        Para pensar, eu preciso de uma IA. Escolha um serviço e cole a sua chave. Ela fica guardada só neste computador,
        cifrada pelo sistema.
      </p>
      <select value={provider} onChange={(e) => setProvider(e.target.value as AiProviderId)}>
        {AI_PROVIDERS.filter((p) => p.needsKey).map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <p>{info.hint}</p>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="Cole a chave aqui"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && key.trim() && void save()}
      />
      {info.keyUrl && (
        <button className="lc-link" onClick={() => void window.lumo.createTab(info.keyUrl)}>
          Pegar uma chave grátis em {new URL(info.keyUrl).hostname}
        </button>
      )}
      <button className="lc-btn lc-btn--primary" disabled={busy || !key.trim()} onClick={() => void save()}>
        {busy ? 'Testando…' : 'Salvar e testar'}
      </button>
      {message && <p style={{ color: message.ok ? 'var(--success, #22c55e)' : 'var(--danger, #ff4d6a)' }}>{message.text}</p>}
      <button className="lc-link" onClick={() => void useWithoutKey()}>
        Prefiro usar sem chave (só conversa, sem abrir abas)
      </button>
      <p>Ollama ou outra API: veja em Configurações → Assistente.</p>
    </div>
  )
}
