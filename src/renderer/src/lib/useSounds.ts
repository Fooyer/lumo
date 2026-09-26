import { useEffect, useState } from 'react'
import type { ModSelection, ModSounds, SoundEvent, SoundSettings } from '@shared/ipc'
import { soundEngine, type ActiveSounds } from './soundEngine'

const KEY_EVENTS: SoundEvent[] = ['key-letter', 'key-space', 'key-enter', 'key-backspace']
const TAB_EVENTS: SoundEvent[] = ['tab-open', 'tab-close']

function pick(from: ModSounds | undefined, events: SoundEvent[]): ActiveSounds['events'] {
  const out: ActiveSounds['events'] = {}
  for (const e of events) if (from?.events[e]) out[e] = from.events[e]
  return out
}

/** Keeps the sound engine in step with the settings and plays what the main process reports. */
export function useSounds(sounds: SoundSettings, mods: ModSelection): void {
  const [active, setActive] = useState<ActiveSounds | null>(null)

  useEffect(() => {
    const off = window.lumo.onSound((event) => soundEngine.play(event))
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    const off = window.lumo.onMusicDuck((audible) => soundEngine.setTabAudible(audible))
    return () => {
      off()
    }
  }, [])

  // Each part can come from a different mod, so load every mod that is used by at least one of them.
  useEffect(() => {
    let stale = false
    const ids = [...new Set([mods.keyboard, mods.tabs, mods.music].filter((id): id is string => !!id))]
    void Promise.all(ids.map(async (id) => [id, await window.lumo.getModSounds(id)] as const)).then((loaded) => {
      if (stale) return
      const byId = new Map(loaded.map(([id, s]) => [id, s ?? undefined]))
      const of = (id: string | null): ModSounds | undefined => (id ? byId.get(id) : undefined)
      setActive({
        music: of(mods.music)?.music ?? [],
        events: { ...pick(of(mods.keyboard), KEY_EVENTS), ...pick(of(mods.tabs), TAB_EVENTS) },
        builtinKeys: !mods.keyboard,
        builtinTabs: !mods.tabs
      })
    })
    return () => {
      stale = true
    }
  }, [mods.keyboard, mods.tabs, mods.music])

  useEffect(() => {
    soundEngine.configure(sounds, active)
  }, [sounds, active])
}
