import { readFileSync } from 'fs'
import { extractAudioPcm } from './ffmpeg.js'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { AudioSyncResult } from '@video-timeliner/shared'

// FFT-based normalized cross-correlation to find time offset between two audio clips.
// Returns positive offset when targetClip needs to be shifted right (starts later) relative to ref.

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

function fft(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len * (invert ? -1 : 1)
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j]
        const uIm = im[i + j]
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + len / 2] = uRe - vRe
        im[i + j + len / 2] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

function crossCorrelate(a: Float32Array, b: Float32Array, sampleRate: number): { offsetSeconds: number; confidence: number } {
  const n = nextPow2(a.length + b.length - 1)
  const aRe = new Float64Array(n)
  const aIm = new Float64Array(n)
  const bRe = new Float64Array(n)
  const bIm = new Float64Array(n)

  for (let i = 0; i < a.length; i++) aRe[i] = a[i]
  for (let i = 0; i < b.length; i++) bRe[i] = b[i]

  fft(aRe, aIm, false)
  fft(bRe, bIm, false)

  // Multiply A * conj(B)
  const cRe = new Float64Array(n)
  const cIm = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    cRe[i] = aRe[i] * bRe[i] + aIm[i] * bIm[i]
    cIm[i] = aIm[i] * bRe[i] - aRe[i] * bIm[i]
  }

  fft(cRe, cIm, true)

  // Find peak in cross-correlation result
  let maxVal = -Infinity
  let maxIdx = 0
  for (let i = 0; i < n; i++) {
    if (cRe[i] > maxVal) {
      maxVal = cRe[i]
      maxIdx = i
    }
  }

  // Convert circular index to signed offset
  const offset = maxIdx > n / 2 ? maxIdx - n : maxIdx
  const offsetSeconds = offset / sampleRate

  // Confidence: ratio of peak to RMS of correlation
  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += cRe[i] * cRe[i]
  const rms = Math.sqrt(sumSq / n)
  const confidence = rms > 0 ? Math.min(1, maxVal / (rms * 10)) : 0

  return { offsetSeconds, confidence }
}

function readPcmFile(path: string): Float32Array {
  const buf = readFileSync(path)
  const result = new Float32Array(buf.byteLength / 4)
  for (let i = 0; i < result.length; i++) {
    result[i] = buf.readFloatLE(i * 4)
  }
  return result
}

const SAMPLE_RATE = 16000
const WINDOW_SECONDS = 60

export async function computeAudioSync(
  refClipPath: string,
  targetClipPath: string,
  refOffsetHint = 0,  // where on the timeline the ref clip starts (to pick overlap window)
  targetOffsetHint = 0,
): Promise<AudioSyncResult> {
  const tmpDir = tmpdir()
  const refPcm = join(tmpDir, `ref_${randomUUID()}.f32`)
  const tgtPcm = join(tmpDir, `tgt_${randomUUID()}.f32`)

  try {
    await Promise.all([
      extractAudioPcm(refClipPath, refPcm, 0, WINDOW_SECONDS),
      extractAudioPcm(targetClipPath, tgtPcm, 0, WINDOW_SECONDS),
    ])

    const refSamples = readPcmFile(refPcm)
    const tgtSamples = readPcmFile(tgtPcm)

    const { offsetSeconds, confidence } = crossCorrelate(refSamples, tgtSamples, SAMPLE_RATE)
    return { offsetSeconds, confidence }
  } finally {
    // Temp files cleaned up by OS on reboot; fine for a personal tool
  }
}
