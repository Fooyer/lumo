import type { ModInfo, ModPart, ModSelection, Settings } from '@shared/ipc'

/** The parts of a mod that can be chosen one by one, in the order the settings list them. */
export const MOD_PARTS: { part: ModPart; label: string; hint: string; has: (mod: ModInfo) => boolean }[] = [
  { part: 'theme', label: 'Cores', hint: 'Cor de destaque e de fundo do Lumo', has: (m) => m.hasTheme },
  { part: 'wallpaper', label: 'Papel de parede', hint: 'Imagem ou vídeo da página de nova aba', has: (m) => m.hasWallpaper },
  { part: 'keyboard', label: 'Som de digitação', hint: 'Teclas ao digitar', has: (m) => m.hasKeyboard },
  { part: 'tabs', label: 'Sons de abas', hint: 'Abrir e fechar abas', has: (m) => m.hasTabSounds },
  { part: 'music', label: 'Música de fundo', hint: 'Faixas do mod', has: (m) => m.hasMusic }
]

/** Takes every part the mod has, leaving the parts it lacks as they were. */
export function adoptWholeMod(mod: ModInfo, current: ModSelection): Partial<Settings> {
  const mods = { ...current }
  for (const { part, has } of MOD_PARTS) if (has(mod)) mods[part] = mod.id
  return { mods }
}
