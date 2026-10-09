/** Shared between the main process (the AI brain), the preload bridge and the mascot/chat renderers. */

export type AiProviderId = 'gemini' | 'groq' | 'openrouter' | 'openai' | 'ollama' | 'pollinations' | 'custom'

export interface AiProviderInfo {
  id: AiProviderId
  label: string
  /** OpenAI-compatible base URL (Gemini uses its own API and ignores it). */
  baseUrl: string
  defaultModel: string
  /** Suggestions only: any model name can be typed. */
  models: string[]
  needsKey: boolean
  /** The service does not do tool calls: she can only chat, not act on the browser. */
  noTools?: boolean
  /** Where to get a key. */
  keyUrl: string
  /** One line shown in the settings. */
  hint: string
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'gemini',
    label: 'Google AI Studio (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'],
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    hint: 'Tem plano gratuito generoso. Recomendado para começar.'
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    hint: 'Gratuito e muito rápido (com limite de uso por minuto).'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'deepseek/deepseek-chat-v3-0324:free',
      'qwen/qwen3-235b-a22b:free',
      'google/gemini-2.0-flash-001'
    ],
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    hint: 'Um só acesso a vários modelos; os que terminam em ":free" não custam nada.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: 'Pago, cobrado por uso.'
  },
  {
    id: 'ollama',
    label: 'Ollama (no seu computador)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'qwen2.5', 'mistral-nemo'],
    needsKey: false,
    keyUrl: 'https://ollama.com/download',
    hint: 'Roda localmente, sem enviar nada para a internet. Use um modelo com suporte a ferramentas.'
  },
  {
    id: 'pollinations',
    label: 'Sem chave (Pollinations)',
    baseUrl: 'https://text.pollinations.ai/openai',
    defaultModel: 'openai',
    models: ['openai'],
    needsKey: false,
    noTools: true,
    keyUrl: '',
    hint: 'Gratuito e sem cadastro, mas só conversa: não abre abas nem mexe nas páginas. A conversa passa por um serviço público, então não conte nada sensível. A qualidade varia.'
  },
  {
    id: 'custom',
    label: 'Outra (compatível com OpenAI)',
    baseUrl: '',
    defaultModel: '',
    models: [],
    needsKey: false,
    keyUrl: '',
    hint: 'Qualquer serviço que fale o formato da OpenAI: LM Studio, Together, Mistral, DeepSeek…'
  }
]

/** Model names the services have retired: saved settings that still use them move to the current default. */
export const RETIRED_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash']

export function providerInfo(id: AiProviderId): AiProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0]
}

/** How freely the assistant may act on pages without asking. */
export type Autonomy = 'ask' | 'smart' | 'free'

export type PersonaId = 'girl' | 'boy'

export interface PersonaInfo {
  id: PersonaId
  name: string
  /** Short line shown in the picker. */
  tagline: string
  /** Gemini TTS voice and the acting direction that goes with it. */
  ttsVoice: string
  ttsStyle: string
  /** Microsoft neural voice (fast, natural) with a little pitch/rate acting. */
  edgeVoice: { name: string; pitch: string; rate: string }
  /** Fallback with the system voices: pitch/rate and name fragments that mark a fitting voice. */
  systemVoice: { pitch: number; rate: number; prefer: string[]; avoid: string[] }
  greeting: string
  quips: string[]
}

export const PERSONAS: Record<PersonaId, PersonaInfo> = {
  girl: {
    id: 'girl',
    name: 'Lumi',
    tagline: 'Menina de anime: elétrica, curiosa e carinhosa. Orelhas de gatinha e duas maria-chiquinhas.',
    edgeVoice: { name: 'pt-BR-FranciscaNeural', pitch: '+9%', rate: '+8%' },
    ttsVoice: 'Leda',
    ttsStyle: 'Fale em português do Brasil com a voz jovem, doce e animada de uma personagem feminina de anime: ',
    systemVoice: {
      pitch: 1.5,
      rate: 1.08,
      prefer: ['maria', 'francisca', 'luciana', 'female', 'feminina', 'helena', 'zira'],
      avoid: ['daniel', 'antonio', 'ricardo', 'male', 'masculin', 'david']
    },
    greeting: 'Oi oi! Eu sou a Lumi, a mascote do Lumo! Clica em mim pra gente conversar!',
    quips: [
      'Psiu... precisa de alguma coisa?',
      'Eu cuido das suas abas, pode deixar!',
      'Quer que eu pesquise algo? Ehehe.',
      'Tem aba demais por aqui, hein...',
      'Que tal um tema novo? Uwaa, seria lindo!',
      'Me arrasta pra onde quiser!',
      'Eu preencho formulários! (Menos senhas, tá?)'
    ]
  },
  boy: {
    id: 'boy',
    name: 'Lux',
    tagline: 'Homem de anime: calmo, esperto e protetor. Orelhas de raposa e uma cauda cheia de luz.',
    edgeVoice: { name: 'pt-BR-AntonioNeural', pitch: '-2%', rate: '+4%' },
    ttsVoice: 'Puck',
    ttsStyle: 'Fale em português do Brasil com a voz calma, confiante e levemente descontraída de um personagem masculino de anime: ',
    systemVoice: {
      pitch: 0.8,
      rate: 0.98,
      prefer: ['daniel', 'antonio', 'ricardo', 'male', 'masculin', 'david', 'mark'],
      avoid: ['maria', 'francisca', 'luciana', 'female', 'feminina', 'helena', 'zira']
    },
    greeting: 'Hm. Eu sou o Lux, o guardião do Lumo. Clique em mim se precisar de algo.',
    quips: [
      'Estou de olho nas suas abas. Calma.',
      'Precisa de ajuda? É só falar.',
      'Silêncio demais. Sinal de que dá pra organizar algo.',
      'Posso pesquisar isso pra você. Deixa comigo.',
      'Um tema escuro cai bem... só uma opinião.',
      'Pode me arrastar. Eu aguento.',
      'Formulários eu preencho. Senhas, jamais.'
    ]
  }
}

export interface AssistantSettings {
  /** Show the mascot (and make her available). */
  enabled: boolean
  /** Which character she is: they share the skills but not the looks, the manners or the voice. */
  persona: PersonaId
  provider: AiProviderId
  model: string
  /** Overrides the provider's base URL (needed for "custom"; optional for Ollama). */
  baseUrl: string
  /** ask: confirm every action on a page. smart: confirm only the risky ones. free: never ask. */
  autonomy: Autonomy
  /** Size of the mascot, 0.7–1.5. */
  scale: number
  /** She wanders about the page when idle. */
  roam: boolean
  /** Speak the answers aloud. */
  voice: boolean
  /** Hands-free: listen again after every answer. */
  voiceMode: boolean
  /** Always listening (on this computer only) for her name, like "Hey Alexa": say "Lumi, ..." and she answers. */
  wakeWord: boolean
  /** Extra words that call her, besides her own name. */
  wakeWords: string[]
  /** Now and then she comments on what the user is doing, like a person next to them would. */
  curiosity: boolean
  /** system: the operating system's voice, starts at once. gemini: a natural voice made by the service, takes a moment. */
  voiceEngine: 'edge' | 'gemini' | 'system'
}

export const DEFAULT_ASSISTANT: AssistantSettings = {
  enabled: true,
  persona: 'girl',
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  baseUrl: '',
  autonomy: 'smart',
  scale: 1,
  roam: true,
  voice: true,
  voiceMode: false,
  voiceEngine: 'edge',
  wakeWord: false,
  wakeWords: [],
  curiosity: true
}

/** Facial expressions / moods the AI can ask for with `[tag]` markers or the mascot tool. */
export const MOODS = [
  'neutral',
  'happy',
  'excited',
  'sad',
  'surprised',
  'thinking',
  'shy',
  'sleepy',
  'angry',
  'love',
  'wink'
] as const
export type Mood = (typeof MOODS)[number]

/** One-off body actions. */
export const GESTURES = ['wave', 'dance', 'jump', 'cheer', 'sit', 'sleep', 'spin', 'stretch', 'peek'] as const
export type Gesture = (typeof GESTURES)[number]

/** Portuguese tags the model writes in its replies → what the mascot does. */
export const EMOTE_TAGS: Record<string, { mood?: Mood; gesture?: Gesture }> = {
  neutra: { mood: 'neutral' },
  feliz: { mood: 'happy' },
  animada: { mood: 'excited' },
  triste: { mood: 'sad' },
  surpresa: { mood: 'surprised' },
  pensando: { mood: 'thinking' },
  envergonhada: { mood: 'shy' },
  sonolenta: { mood: 'sleepy' },
  brava: { mood: 'angry' },
  apaixonada: { mood: 'love' },
  piscando: { mood: 'wink' },
  acenando: { mood: 'happy', gesture: 'wave' },
  dançando: { mood: 'excited', gesture: 'dance' },
  pulando: { mood: 'excited', gesture: 'jump' },
  comemorando: { mood: 'excited', gesture: 'cheer' },
  girando: { mood: 'happy', gesture: 'spin' },
  espreguiçando: { mood: 'sleepy', gesture: 'stretch' }
}

/** Splits `[tag]` markers out of a reply: the text to show and the tags (in order) to act out. */
export function parseEmoteTags(raw: string): { text: string; tags: string[] } {
  const tags: string[] = []
  const text = raw
    .replace(/\[([a-zçãáâéêíóôõú]+)\]/gi, (whole, name: string) => {
      const key = name.toLowerCase()
      if (!(key in EMOTE_TAGS)) return whole
      tags.push(key)
      return ''
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s+/, '')
    .trimEnd()
  return { text, tags }
}

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** For the assistant this still holds the `[tag]` markers. */
  text: string
  at: number
}

/** A site the assistant keeps the user from opening (she decided, or the user asked). */
export interface BlockedSite {
  host: string
  reason: string
  at: number
}

export interface AiNote {
  id: string
  text: string
  at: number
}

/** What the mascot should look like she is doing while a tool runs. */
export type ToolAnim = 'search' | 'read' | 'type' | 'click' | 'tabs' | 'settings' | 'think' | 'bookmark' | 'fly'

export type AiEvent =
  | { type: 'busy'; busy: boolean }
  | { type: 'tool-start'; id: string; name: string; label: string; anim: ToolAnim }
  | { type: 'tool-end'; id: string; ok: boolean; summary: string }
  | { type: 'message'; message: AiChatMessage }
  | { type: 'error'; message: string; code?: 'no-key' | 'auth' | 'quota' | 'network' | 'other' }
  | { type: 'confirm'; id: string; title: string; detail: string }
  | { type: 'confirm-done'; id: string }
  | { type: 'cleared' }
  /** Said by voice: the transcription, shown as the user's message. */
  | { type: 'user'; message: AiChatMessage }
  | { type: 'voice'; state: VoiceState }

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'speaking'

export interface VoiceSendResult {
  ok: boolean
  text?: string
  error?: string
}

export interface WakeResult {
  /** The utterance opened with a wake word. */
  wake: boolean
  /** ...and something was said after it (a request in the same breath). */
  hasCommand: boolean
  /** What the local model heard (for debugging; never stored). */
  text: string
}

export interface WakeStatus {
  state: 'idle' | 'downloading' | 'ready' | 'error'
  progress: number
  message?: string
}

/** One piece of a streamed voice: 16-bit mono PCM (base64), or the end/failure of the stream with that id. */
export interface TtsChunk {
  id: string
  /** A complete MP3 file (base64): one sentence from the Microsoft voice. */
  mp3?: string
  pcm?: string
  sampleRate?: number
  done?: boolean
  error?: string
}

/** 16-bit mono PCM from the speech engine. */
export interface TtsResult {
  ok: boolean
  pcm?: string
  sampleRate?: number
  error?: string
}

export interface AiSendResult {
  ok: boolean
  error?: string
  code?: 'no-key' | 'busy' | 'auth' | 'quota' | 'network' | 'other'
}

export interface AiTestResult {
  ok: boolean
  message: string
}

export interface AiModelsResult {
  ok: boolean
  models: string[]
  message: string
}

export interface AiKeyStatus {
  /** Which providers have a key saved. */
  keys: Partial<Record<AiProviderId, boolean>>
  /** The key is stored encrypted by the operating system; false means it only lives until Lumo closes. */
  secure: boolean
}

/** Things the main process (menu, AI tools) tells the mascot to do. */
export type MascotCommand =
  | { kind: 'voice'; action: 'toggle' | 'start' | 'stop' | 'stop-speaking' }
  | { kind: 'mood'; mood: Mood; ms?: number }
  | { kind: 'gesture'; gesture: Gesture }
  | { kind: 'move'; to: 'left' | 'right' | 'center' }
  | { kind: 'say'; text: string; speak?: boolean }
  | { kind: 'wake' }
  /** Flies to a spot of the page area (x, y are fractions 0-1 of it) and stays there `hold` ms before going home (0 = stays). */
  | { kind: 'fly'; x: number; y: number; hold?: number }
  /** Flies next to something on the page and points at it (stage pixels: the middle of the thing and its size). */
  | { kind: 'point'; x: number; y: number; w: number; h: number; hold?: number; guard?: boolean }
  /** Back to her corner. */
  | { kind: 'home' }

/** Where the mascot stands (feet, stage coordinates) and how big her view needs to be. */
export interface MascotRect {
  fx: number
  fy: number
  w: number
  h: number
}

/** The area she can walk on: the page area of the window. */
export interface MascotStage {
  width: number
  height: number
  /** Where the page area starts in the window (below the toolbar). */
  top: number
}

export type MascotBrowserEvent = 'tab-opened' | 'tab-closed' | 'download-done' | 'update-ready' | 'page-loaded'

export const CHAT_VIEW_WIDTH = 380
export const CHAT_VIEW_HEIGHT = 540
