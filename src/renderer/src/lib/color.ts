export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function mix(hex: string, target: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex)
  const [r2, g2, b2] = hexToRgb(target)
  const mixChannel = (a: number, b: number): number => Math.round(a + (b - a) * amount)
  const toHex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${toHex(mixChannel(r1, r2))}${toHex(mixChannel(g1, g2))}${toHex(mixChannel(b1, b2))}`
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount)
}
