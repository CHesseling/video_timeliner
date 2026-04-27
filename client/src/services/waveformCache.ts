export const waveformCache = new Map<string, number[]>()

export function evictWaveform(clipId: string) {
  waveformCache.delete(clipId)
}

export function evictAllWaveforms() {
  waveformCache.clear()
}
