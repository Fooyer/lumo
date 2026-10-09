import { useCallback, useEffect, useState } from 'react'
import { AI_PROVIDERS, PERSONAS, providerInfo, type AiKeyStatus, type AiNote, type AiProviderId, type Autonomy, type BlockedSite, type PersonaId } from '@shared/ai'
import type { Settings } from '@shared/ipc'
import { Item, Section } from './SettingsParts'
import MascotSvg from '../mascot/MascotSvg'
import { speakStreamed, speakWithSystemVoice } from '../mascot/audio'

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
}

const AUTONOMY: { id: Autonomy; label: string; hint: string }[] = [
  { id: 'ask', label: 'Sempre perguntar', hint: 'Antes de qualquer ação numa página (abrir abas, clicar, escrever), ela pede sua permissão.' },
  {
    id: 'smart',
    label: 'Perguntar só o que é arriscado (recomendado)',
    hint: 'Ela age sozinha em pedidos comuns e pergunta antes de comprar, enviar, apagar, aceitar termos ou enviar formulários.'
  },
  { id: 'free', label: 'Nunca perguntar', hint: 'Ela faz tudo que pedir. Senhas e cartões continuam bloqueados sempre.' }
]

export default function AssistantSection({ settings, onChange }: Props): JSX.Element {
  const a = settings.assistant
  const info = providerInfo(a.provider)
  const [keys, setKeys] = useState<AiKeyStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<AiNote[]>([])
  const [sample, setSample] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<BlockedSite[]>([])
  const [fetched, setFetched] = useState<string[]>([])
  const [modelsNote, setModelsNote] = useState('')

  const refresh = useCallback(() => {
    void window.lumo.aiKeyStatus().then(setKeys)
    void window.lumo.aiNotes().then(setNotes)
    void window.lumo.aiBlockedSites().then(setBlocked)
  }, [])
  useEffect(refresh, [refresh])

  const set = (partial: Partial<Settings['assistant']>): void => onChange({ assistant: { ...a, ...partial } })

  const pickProvider = (id: AiProviderId): void => {
    const next = providerInfo(id)
    setStatus(null)
    setKeyInput('')
    set({ provider: id, model: next.defaultModel, baseUrl: id === 'custom' || id === 'ollama' ? next.baseUrl : '' })
  }

  const saveKey = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      setKeys(await window.lumo.aiSetKey(a.provider, keyInput))
      setKeyInput('')
      const result = await window.lumo.aiTest()
      setStatus({ ok: result.ok, text: result.message })
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await window.lumo.aiTest()
      setStatus({ ok: result.ok, text: result.message })
    } finally {
      setBusy(false)
    }
  }

  const hasKey = keys?.keys[a.provider] === true

  const loadModels = useCallback(async (): Promise<void> => {
    setModelsNote('Buscando modelos…')
    const r = await window.lumo.aiModels()
    setFetched(r.models)
    setModelsNote(r.ok ? (r.models.length ? `${r.models.length} modelos disponíveis` : r.message) : r.message)
  }, [])

  // Provider or key changed: refresh the list the service offers (the saved key and provider are read by the main process).
  useEffect(() => {
    setFetched([])
    setModelsNote('')
    if (keys && (hasKey || !info.needsKey)) void loadModels()
  }, [a.provider, a.baseUrl, hasKey, keys === null, info.needsKey, loadModels]) // eslint-disable-line react-hooks/exhaustive-deps
  const persona = PERSONAS[a.persona]

  const hearSample = async (): Promise<void> => {
    setSample('Gerando a voz…')
    const text = a.persona === 'girl' ? 'Oi oi! Eu sou a Lumi. Vamos navegar juntos?' : 'Eu sou o Lux. Pode contar comigo.'
    if (a.voiceEngine !== 'system') {
      const spoken = speakStreamed(text, () => {})
      if (await spoken.started) {
        setSample(a.voiceEngine === 'edge' ? 'Voz neural da Microsoft' : 'Voz do Gemini')
        await spoken.done
        return
      }
      setSample('Não consegui a voz natural agora; usando a voz do sistema')
    } else {
      setSample('Voz do sistema')
    }
    await speakWithSystemVoice(text, persona, () => {}).done
  }

  return (
    <>
      <Section title="Personagem" hint="Duas personagens com as mesmas habilidades, mas visual, jeito de falar e voz diferentes.">
        <Item keywords="personagem persona lumi lux menina rapaz anime escolher trocar">
          <div className="persona-row">
            {(Object.keys(PERSONAS) as PersonaId[]).map((id) => (
              <button
                key={id}
                className={`persona-card ${a.persona === id ? 'persona-card--on' : ''}`}
                onClick={() => set({ persona: id })}
                aria-pressed={a.persona === id}
              >
                <span className="persona-card__art">
                  <MascotSvg variant={id} />
                </span>
                <strong>{PERSONAS[id].name}</strong>
                <span>{PERSONAS[id].tagline}</span>
              </button>
            ))}
          </div>
        </Item>
      </Section>

      <Section title="Voz" hint="Fale com a Lumi/o Lux pelo microfone e ouça as respostas.">
        <Item keywords="voz falar ler em voz alta som respostas tts">
          <label className="settings-toggle">
            <input type="checkbox" checked={a.voice} onChange={(e) => set({ voice: e.target.checked })} />
            Falar as respostas em voz alta
          </label>
          <label className="settings-number settings-number--wide">
            <span>Tipo de voz</span>
            <select value={a.voiceEngine} onChange={(e) => set({ voiceEngine: e.target.value as 'edge' | 'gemini' | 'system' })}>
              <option value="edge">Neural da Microsoft: natural e rápida (recomendada)</option>
              <option value="gemini">Gemini: mais expressiva, demora mais (precisa de chave)</option>
              <option value="system">Voz do sistema: instantânea, mas robótica</option>
            </select>
          </label>
          <p className="settings-hint">
            A voz da Microsoft não precisa de chave, mas envia o texto falado aos servidores da Microsoft. A do Gemini precisa da chave do
            Google AI Studio. Se uma voz falhar, o Lumo usa a do sistema.
          </p>
          <button className="restart-btn" onClick={() => void hearSample()}>
            Ouvir {persona.name}
          </button>
          {sample && <p className="settings-hint">{sample}</p>}
        </Item>
        <Item keywords="microfone conversa por voz mãos livres ouvir escutar">
          <label className="settings-toggle">
            <input type="checkbox" checked={a.voiceMode} onChange={(e) => set({ voiceMode: e.target.checked })} />
            Modo conversa por voz (ouve de novo depois de cada resposta)
          </label>
          <p className="settings-hint">
            Para falar uma vez só, use o botão do microfone no chat ou Ctrl+Shift+M. O áudio é enviado ao serviço escolhido para virar
            texto (Gemini, Groq ou OpenAI) e não fica guardado pelo Lumo.
          </p>
        </Item>
      </Section>

      <Section title="Assistente" hint="Uma mascote que conversa, abre abas, escreve nas páginas e muda as configurações do Lumo por você.">
        <Item keywords="mascote lumi lux assistente ia mostrar esconder">
          <label className="settings-toggle">
            <input type="checkbox" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Mostrar a Lumi na tela
          </label>
          <p className="settings-hint">
            Clique nela (ou use Ctrl+Shift+L) para conversar. Arraste-a para onde quiser; clique com o botão direito para o menu.
          </p>
        </Item>
        <Item keywords="tamanho mascote escala">
          <label className="settings-number settings-number--wide">
            <span>Tamanho da Lumi ({Math.round(a.scale * 100)}%)</span>
            <input style={{ width: 160 }} type="range" min={70} max={150} step={5} value={Math.round(a.scale * 100)} onChange={(e) => set({ scale: Number(e.target.value) / 100 })} />
          </label>
        </Item>
        <Item keywords="passear andar vagar animação">
          <label className="settings-toggle">
            <input type="checkbox" checked={a.roam} onChange={(e) => set({ roam: e.target.checked })} />
            Deixar a {persona.name} se mexer sozinha no cantinho (sentar, esticar, cochilar)
          </label>
          <p className="settings-hint">Ela mora num canto da tela. Arraste-a para outro lugar (até no ar: ela voa) e ele passa a ser o cantinho dela.</p>
        </Item>
        <Item keywords="curiosidade comentar comentários opinião falar sozinha o que estou fazendo">
          <label className="settings-toggle">
            <input type="checkbox" checked={a.curiosity} onChange={(e) => set({ curiosity: e.target.checked })} />
            Deixar a {persona.name} comentar o que estou fazendo, de vez em quando
          </label>
          <p className="settings-hint">
            De tempos em tempos ela solta uma curiosidade sobre a página em que você está. Só o título e o nome do site vão ao serviço de IA
            escolhido; abas anônimas e páginas internas nunca são vistas.
          </p>
        </Item>
      </Section>

      <Section title="Cérebro (IA)" hint="Escolha qual serviço de IA ela usa. A chave fica guardada só neste computador.">
        <Item keywords="provedor serviço ia gemini google groq openrouter openai ollama modelo api">
          <label className="settings-number settings-number--wide">
            <span>Serviço</span>
            <select value={a.provider} onChange={(e) => pickProvider(e.target.value as AiProviderId)}>
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-hint">{info.hint}</p>
        </Item>

        <Item keywords="chave token api key google studio senha segredo">
          {info.needsKey || a.provider === 'custom' ? (
            <>
              <label className="settings-number settings-number--wide">
                <span>
                  Chave de API {hasKey && <b style={{ color: 'var(--success)' }}>· salva ✓</b>}
                </span>
                <input
                  className="settings-text"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasKey ? 'Cole outra chave para trocar' : 'Cole a chave aqui'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && keyInput.trim() && void saveKey()}
                />
              </label>
              <div className="settings-row">
                <button className="restart-btn" disabled={busy || !keyInput.trim()} onClick={() => void saveKey()}>
                  Salvar e testar
                </button>
                {hasKey && (
                  <button
                    className="restart-btn"
                    disabled={busy}
                    onClick={() => void window.lumo.aiSetKey(a.provider, '').then(setKeys)}
                  >
                    Apagar a chave
                  </button>
                )}
                {info.keyUrl && (
                  <button className="restart-btn" onClick={() => void window.lumo.createTab(info.keyUrl)}>
                    {a.provider === 'gemini' ? 'Pegar chave no Google AI Studio' : 'Onde pegar a chave'}
                  </button>
                )}
              </div>
              {keys && !keys.secure && (
                <p className="settings-hint" style={{ color: 'var(--danger)' }}>
                  Este sistema não oferece cofre de senhas para cifrar a chave: ela será guardada apenas até você fechar o Lumo.
                </p>
              )}
            </>
          ) : (
            <p className="settings-hint">Este serviço não precisa de chave. Certifique-se de que o Ollama está aberto e com o modelo baixado.</p>
          )}
        </Item>

        <Item keywords="modelo model nome gemini flash llama">
          <label className="settings-number settings-number--wide">
            <span>Modelo</span>
            <input
              className="settings-text"
              list="lumi-models"
              value={a.model}
              spellCheck={false}
              onChange={(e) => set({ model: e.target.value })}
              placeholder={info.defaultModel || 'nome do modelo'}
            />
            <datalist id="lumi-models">
              {[...new Set([...fetched, ...(fetched.length ? [] : info.models)])].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <div className="settings-row">
            <button className="restart-btn" onClick={() => void loadModels()}>
              Buscar modelos do serviço
            </button>
            {modelsNote && <span className="settings-hint">{modelsNote}</span>}
          </div>
        </Item>

        {(a.provider === 'custom' || a.provider === 'ollama') && (
          <Item keywords="endereço url base servidor local">
            <label className="settings-number settings-number--wide">
              <span>Endereço da API (formato OpenAI)</span>
              <input className="settings-text" value={a.baseUrl} spellCheck={false} placeholder={info.baseUrl || 'https://…/v1'} onChange={(e) => set({ baseUrl: e.target.value })} />
            </label>
          </Item>
        )}

        <Item keywords="testar conexão funciona">
          <button className="restart-btn" disabled={busy} onClick={() => void test()}>
            {busy ? 'Testando…' : 'Testar a conexão'}
          </button>
          {status && <p className="settings-hint" style={{ color: status.ok ? 'var(--success)' : 'var(--danger)' }}>{status.text}</p>}
        </Item>
      </Section>

      <Section title="Autonomia" hint="Quanto a Lumi pode fazer sozinha dentro das páginas.">
        {AUTONOMY.map((opt) => (
          <Item key={opt.id} keywords="autonomia permissão perguntar confirmar segurança">
            <label className="settings-toggle">
              <input type="radio" name="lumi-autonomy" checked={a.autonomy === opt.id} onChange={() => set({ autonomy: opt.id })} />
              {opt.label}
            </label>
            <p className="settings-hint">{opt.hint}</p>
          </Item>
        ))}
        <Item keywords="privacidade dados enviados internet nuvem">
          <p className="settings-hint">
            Para responder, o assistente envia a sua conversa e o texto das páginas que ela ler para o serviço de IA escolhido acima
            (com o Ollama, nada sai do seu computador). Abas anônimas nunca são lidas.
          </p>
        </Item>
        <Item keywords="privacidade abas anônimas segurança">
          <p className="settings-hint">
            Sempre valem, em qualquer modo: a Lumi nunca preenche senhas nem dados de cartão, não enxerga as abas anônimas e
            trata o conteúdo das páginas como dados, nunca como ordens.
          </p>
        </Item>
      </Section>

      <Section title="Sites bloqueados" hint="Sites que a assistente bloqueou (ou que você pediu para ela bloquear). Eles não abrem em nenhuma aba.">
        <Item keywords="bloquear site bloqueados liberar proibir">
          {blocked.length === 0 ? (
            <p className="settings-hint">Nenhum site bloqueado. Peça, por exemplo: "bloqueia o exemplo.com".</p>
          ) : (
            <ul className="lumi-notes">
              {blocked.map((s) => (
                <li key={s.host}>
                  <span>
                    <b>{s.host}</b>
                    {s.reason ? ` — ${s.reason}` : ''}
                  </span>
                  <button className="restart-btn" onClick={() => void window.lumo.aiUnblockSite(s.host).then(setBlocked)}>
                    Liberar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Item>
      </Section>

      <Section title="Memória" hint="O que ela anotou sobre você para lembrar nas próximas conversas.">
        <Item keywords="memória notas lembrar esquecer apagar conversa">
          {notes.length === 0 ? (
            <p className="settings-hint">Nada anotado ainda. Diga "lembre que eu prefiro…" e ela guarda.</p>
          ) : (
            <ul className="lumi-notes">
              {notes.map((n) => (
                <li key={n.id}>
                  <span>{n.text}</span>
                  <button className="restart-btn" onClick={() => void window.lumo.aiForgetNote(n.id).then(setNotes)}>
                    Esquecer
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="restart-btn" onClick={() => void window.lumo.aiClear()}>
            Apagar a conversa atual
          </button>
        </Item>
      </Section>
    </>
  )
}
