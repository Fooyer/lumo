import type { DownloadItem } from '@shared/ipc'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

function formatSpeed(bytesPerSecond: number): string {
  const mb = bytesPerSecond / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`
}

/**
 * A basic estimate for a running download: the average speed since it started, and the time left
 * at that speed. Returns null until there is enough to go on (a second of data, a known total size).
 */
export function downloadEta(d: DownloadItem, now: number = Date.now()): string | null {
  const elapsedSeconds = (now - d.startTime) / 1000
  if (d.state !== 'progressing' || elapsedSeconds < 1 || d.receivedBytes <= 0) return null
  const speed = d.receivedBytes / elapsedSeconds
  if (d.totalBytes <= 0 || d.totalBytes <= d.receivedBytes) return formatSpeed(speed)
  const remaining = (d.totalBytes - d.receivedBytes) / speed
  return `${formatSpeed(speed)} · ${formatDuration(remaining)} restantes`
}
