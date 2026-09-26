import { useEffect, useState } from 'react'
import type { ModInfo, Settings } from '@shared/ipc'
import { soundEngine, type MusicStatus } from '../lib/soundEngine'
import { Item, Section } from './SettingsParts'

const RADIOS: { group: string; items: { name: string; url: string }[] }[] = [
  {
    group: 'Lofi',
    items: [
      { name: 'Lofi · laut.fm', url: 'https://stream.laut.fm/lofi' },
      { name: 'Lofi Hip Hop Radio', url: 'https://stream.zeno.fm/0r0xa792kwzuv' },
      { name: 'Lofi Music', url: 'https://stream.zeno.fm/f3wvbbqmdg8uv' },
      { name: 'Lofi Radio', url: 'https://play.streamafrica.net/lofiradio' },
      { name: 'Chillhop · I♥CHILLHOP', url: 'https://streams.ilovemusic.de/iloveradio17.mp3' }
    ]
  },
  {
    group: 'Rock',
    items: [
      { name: 'Rock · laut.fm', url: 'https://stream.laut.fm/rock' },
      { name: 'Classic Rock · laut.fm', url: 'https://stream.laut.fm/classicrock' },
      { name: 'Rock-Radio · laut.fm', url: 'https://stream.laut.fm/rockradio' },
      { name: '181.FM Rock 181', url: 'https://listen.181fm.com/181-rock_128k.mp3' },
      { name: 'Metal · laut.fm', url: 'https://stream.laut.fm/metal' },
      { name: 'Metal Detector · SomaFM', url: 'https://ice1.somafm.com/metal-128-mp3' }
    ]
  },
  {
    group: 'Eletrônica e ambiente',
    items: [
      { name: 'SomaFM · Groove Salad', url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
      { name: 'SomaFM · Deep Space One', url: 'https://ice1.somafm.com/deepspaceone-128-mp3' },
      { name: 'SomaFM · Drone Zone', url: 'https://ice1.somafm.com/dronezone-128-mp3' },
      { name: 'SomaFM · DEF CON Radio', url: 'https://ice1.somafm.com/defcon-128-mp3' },
      { name: 'SomaFM · Secret Agent', url: 'https://ice1.somafm.com/secretagent-128-mp3' }
    ]
  }
]
const ALL_RADIOS = RADIOS.flatMap((g) => g.items)
const CUSTOM_RADIO = 'custom'

const MUSIC_STATUS: Record<MusicStatus, string> = {
  off: '',
  loading: 'Conectando…',
  playing: 'Tocando agora.',
  error: 'Não consegui tocar essa fonte. Confira o endereço da rádio.'
}

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
  mods: ModInfo[]
}

export default function SoundsSection({ settings, onChange, mods }: Props): JSX.Element {
  const sounds = settings.sounds
  const set = (partial: Partial<Settings['sounds']>): void => onChange({ sounds: { ...sounds, ...partial } })
  const [musicStatus, setMusicStatus] = useState<MusicStatus>('off')
  const [customUrl, setCustomUrl] = useState(sounds.radioUrl)

  useEffect(() => soundEngine.onMusicStatus(setMusicStatus), [])

  const musicMod = mods.find((m) => m.id === settings.mods.music) ?? null
  const presetValue = ALL_RADIOS.some((r) => r.url === sounds.radioUrl) ? sounds.radioUrl : CUSTOM_RADIO

  return (
    <>
      <Section title="Sons" hint="Sons ao digitar e ao abrir e fechar abas. Começam desligados.">
        <Item keywords="sons efeitos ativar ligar desligar mudo áudio">
          <label className="settings-toggle">
            <input type="checkbox" checked={sounds.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Ativar sons
          </label>
        </Item>
        <Item keywords="teclado digitar digitação tecla mecânico">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={sounds.keyboard}
              disabled={!sounds.enabled}
              onChange={(e) => set({ keyboard: e.target.checked })}
            />
            Som ao digitar
          </label>
        </Item>
        <Item keywords="abas abrir fechar nova aba">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={sounds.tabs}
              disabled={!sounds.enabled}
              onChange={(e) => set({ tabs: e.target.checked })}
            />
            Som ao abrir e fechar abas
          </label>
        </Item>
        <Item keywords="volume sons efeitos">
          <label className="settings-range">
            <span>Volume dos sons</span>
            <input
              type="range"
              min={0}
              max={100}
              value={sounds.volume}
              disabled={!sounds.enabled}
              onChange={(e) => set({ volume: Number(e.target.value) })}
              onMouseUp={() => soundEngine.play('key-letter')}
            />
            <b>{sounds.volume}%</b>
          </label>
          <p className="settings-hint">Os sons de cada mod são escolhidos em Personalização → Usar de cada mod.</p>
        </Item>
      </Section>

      <Section title="Música de fundo" hint="Uma rádio ou live da internet, ou as músicas de um mod.">
        <Item keywords="música musica tocar rádio radio ligar desligar fundo">
          <label className="settings-toggle">
            <input type="checkbox" checked={sounds.music} onChange={(e) => set({ music: e.target.checked })} />
            Tocar música de fundo
          </label>
          {sounds.music && MUSIC_STATUS[musicStatus] && (
            <p className={`settings-hint ${musicStatus === 'error' ? 'settings-hint--error' : ''}`}>
              {MUSIC_STATUS[musicStatus]}
            </p>
          )}
        </Item>
        <Item keywords="fonte origem rádio mod músicas">
          <label className="settings-number settings-number--wide">
            <span>Fonte</span>
            <select value={sounds.musicSource} onChange={(e) => set({ musicSource: e.target.value as 'mod' | 'radio' })}>
              <option value="radio">Rádio / live na internet</option>
              <option value="mod" disabled={!musicMod}>
                {musicMod ? `Músicas do mod (${musicMod.name})` : 'Músicas de um mod (escolha um mod com música)'}
              </option>
            </select>
          </label>
        </Item>
        {sounds.musicSource === 'radio' && (
          <Item keywords="rádio radio lofi rock metal stream endereço link url live">
            <label className="settings-number settings-number--wide">
              <span>Rádio</span>
              <select
                value={presetValue}
                onChange={(e) => {
                  const radio = ALL_RADIOS.find((r) => r.url === e.target.value)
                  if (!radio) return
                  setCustomUrl(radio.url)
                  set({ radioUrl: radio.url, radioName: radio.name })
                }}
              >
                {RADIOS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((r) => (
                      <option key={r.url} value={r.url}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={CUSTOM_RADIO}>Outro endereço…</option>
              </select>
            </label>
            <label className="settings-number settings-number--wide">
              <span>Endereço do stream</span>
              <input
                type="url"
                className="settings-text"
                placeholder="https://…/stream.mp3"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                onBlur={() => {
                  const url = customUrl.trim()
                  if (url !== sounds.radioUrl) set({ radioUrl: url, radioName: url })
                }}
              />
            </label>
            <p className="settings-hint">
              Vale qualquer link direto de áudio (MP3, AAC, Ogg). As rádios da lista são públicas (laut.fm, SomaFM, Zeno
              e outras) e podem sair do ar.
            </p>
          </Item>
        )}
        <Item keywords="volume música">
          <label className="settings-range">
            <span>Volume da música</span>
            <input
              type="range"
              min={0}
              max={100}
              value={sounds.musicVolume}
              onChange={(e) => set({ musicVolume: Number(e.target.value) })}
            />
            <b>{sounds.musicVolume}%</b>
          </label>
        </Item>
        <Item keywords="abaixar reduzir vídeo aba tocando som duck">
          <label className="settings-toggle">
            <input type="checkbox" checked={sounds.duckMusic} onChange={(e) => set({ duckMusic: e.target.checked })} />
            Baixar a música quando uma aba estiver tocando som
          </label>
        </Item>
      </Section>
    </>
  )
}
