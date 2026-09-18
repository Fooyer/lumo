function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Smoothly ramps a numeric value over `duration` ms, calling `onUpdate` each frame. Returns a cancel function. */
export function animateValue(
  from: number,
  to: number,
  duration: number,
  onUpdate: (value: number) => void
): () => void {
  if (from === to) {
    onUpdate(to)
    return () => {}
  }
  const start = performance.now()
  let raf = 0

  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration)
    onUpdate(from + (to - from) * easeOutCubic(t))
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}
