import ffmpeg from 'fluent-ffmpeg'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { WAVEFORM_DIR } from './paths.js'

if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH)

const CACHE_DIR = WAVEFORM_DIR
const EXTRACT_RATE = 200  // Hz — coarse enough to be fast, fine enough to show transients

export function deleteWaveformCache(clipId: string): void {
  const cachePath = join(CACHE_DIR, `${clipId}.json`)
  if (existsSync(cachePath)) unlinkSync(cachePath)
}

export async function getWaveformPeaks(
  clipId: string,
  videoPath: string,
  numSamples = 800,
): Promise<number[]> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cachePath = join(CACHE_DIR, `${clipId}.json`)

  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as number[]
  }

  const tmpFile = join(tmpdir(), `wf_${randomUUID()}.f32`)

  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(EXTRACT_RATE)
      .audioCodec('pcm_f32le')
      .format('f32le')
      .output(tmpFile)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })

  const buf = readFileSync(tmpFile)
  try { unlinkSync(tmpFile) } catch { /* ignore */ }

  const totalSamples = Math.floor(buf.byteLength / 4)
  const chunkSize = Math.max(1, Math.floor(totalSamples / numSamples))
  const peaks: number[] = []

  for (let i = 0; i < numSamples; i++) {
    let peak = 0
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, totalSamples)
    for (let j = start; j < end; j++) {
      const v = Math.abs(buf.readFloatLE(j * 4))
      if (v > peak) peak = v
    }
    peaks.push(Math.min(1, peak))
  }

  writeFileSync(cachePath, JSON.stringify(peaks))
  return peaks
}
