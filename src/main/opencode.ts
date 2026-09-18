import { spawn } from 'child_process'

const BIN = process.env.LUMO_OPENCODE_BIN || 'opencode'
const TIMEOUT_MS = 20_000

export class OpencodeUnavailableError extends Error {}

/**
 * Invoca a CLI local `opencode` em modo não-interativo (`opencode run "<prompt>"`)
 * e retorna a saída de texto. O nome/args do binário podem ser sobrescritos via
 * LUMO_OPENCODE_BIN caso a CLI instalada use outra convenção de invocação.
 */
export function askOpencode(prompt: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let child
    try {
      child = spawn(BIN, ['run', prompt], { shell: process.platform === 'win32' })
    } catch (err) {
      reject(new OpencodeUnavailableError(String(err)))
      return
    }

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new OpencodeUnavailableError('opencode timeout'))
    }, TIMEOUT_MS)

    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()))

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new OpencodeUnavailableError(err.message))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && stdout.trim()) {
        resolvePromise(stdout.trim())
      } else {
        reject(new OpencodeUnavailableError(stderr.trim() || `opencode exited with code ${code}`))
      }
    })
  })
}

export interface NavigationIntent {
  kind: 'navigate' | 'search' | 'answer'
  detail: string
}

/**
 * Pede à IA local para decidir o que fazer com um texto digitado na barra de
 * endereço que não é claramente uma URL: navegar para um site específico,
 * pesquisar na web, ou responder diretamente à pergunta.
 */
export async function resolveNavigationIntent(input: string): Promise<NavigationIntent> {
  const prompt = [
    'Você é o interpretador da barra de endereço de um navegador.',
    'Dado o texto digitado pelo usuário, responda com UMA ÚNICA linha, em um dos formatos exatos:',
    'NAVIGATE:<url completa>  (quando o usuário claramente quer visitar um site específico)',
    'SEARCH:<termos de busca>  (quando é melhor pesquisar na web)',
    'ANSWER:<resposta curta e direta>  (quando você já sabe responder sem navegar)',
    'Não escreva nada além dessa única linha.',
    '',
    `Texto do usuário: ${input}`
  ].join('\n')

  const raw = await askOpencode(prompt)
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) || raw

  const navigateMatch = firstLine.match(/^NAVIGATE:(.+)$/i)
  if (navigateMatch) return { kind: 'navigate', detail: navigateMatch[1].trim() }

  const searchMatch = firstLine.match(/^SEARCH:(.+)$/i)
  if (searchMatch) return { kind: 'search', detail: searchMatch[1].trim() }

  const answerMatch = firstLine.match(/^ANSWER:(.+)$/i)
  if (answerMatch) return { kind: 'answer', detail: answerMatch[1].trim() }

  return { kind: 'answer', detail: raw }
}

export interface TabForGrouping {
  id: string
  title: string
  url: string
}

export interface AiGroupSuggestion {
  label: string
  color: string
  tabIds: string[]
}

/**
 * Pede à IA local para agrupar as abas abertas por assunto/intenção,
 * devolvendo grupos nomeados. Usado pelo botão "Organizar com IA".
 */
export async function suggestTabGroups(tabs: TabForGrouping[]): Promise<AiGroupSuggestion[]> {
  const prompt = [
    'Você organiza abas de navegador em grupos por assunto.',
    'Receberá uma lista JSON de abas (id, title, url).',
    'Responda APENAS com um JSON válido (sem markdown, sem comentários) no formato:',
    '[{"label": "Nome do grupo", "tabIds": ["id1", "id2"]}]',
    'Use no máximo 6 grupos, nomes curtos em português.',
    '',
    `Abas: ${JSON.stringify(tabs)}`
  ].join('\n')

  const raw = await askOpencode(prompt)
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('resposta da IA sem JSON reconhecível')

  const parsed = JSON.parse(jsonMatch[0]) as { label: string; tabIds: string[] }[]
  return parsed.map((g, i) => ({
    label: g.label,
    tabIds: g.tabIds,
    color: colorForIndex(i)
  }))
}

const PALETTE = ['#6C8CFF', '#33C2A3', '#F2A93B', '#E5636F', '#A56BE0', '#38B6E0']
function colorForIndex(i: number): string {
  return PALETTE[i % PALETTE.length]
}
