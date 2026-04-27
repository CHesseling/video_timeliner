import ffmpeg from 'fluent-ffmpeg'
import { join, dirname } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { promisify } from 'util'

if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH)
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH)

export interface ProbeResult {
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err)
      const videoStream = data.streams.find(s => s.codec_type === 'video')
      const audioStream = data.streams.find(s => s.codec_type === 'audio')
      resolve({
        duration: data.format.duration ?? 0,
        width: videoStream?.width ?? 1920,
        height: videoStream?.height ?? 1080,
        hasAudio: !!audioStream,
      })
    })
  })
}

export async function extractThumbnail(videoPath: string, outputPath: string): Promise<void> {
  mkdirSync(dirname(outputPath), { recursive: true })
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(1)
      .frames(1)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

export async function extractAudioPcm(
  videoPath: string,
  outputPath: string,
  startSeconds = 0,
  durationSeconds = 60,
): Promise<void> {
  mkdirSync(dirname(outputPath), { recursive: true })
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(startSeconds)
      .duration(durationSeconds)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_f32le')
      .format('f32le')
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

export interface RenderSegment {
  clips: Array<{
    localPath: string
    startInClip: number
    duration: number
    vertical: boolean
    rotation: number
    hasAudio: boolean
  }>
  duration: number
  outputPath: string
}

// Produce the filter chain that scales input i into a cell of cellW×cellH.
// Vertical (portrait) clips get a blurred background fill instead of black bars.
function rotationFilter(rotation: number): string {
  const normalized = ((rotation % 360) + 360) % 360
  if (normalized === 90) return 'transpose=1,'
  if (normalized === 180) return 'hflip,vflip,'
  if (normalized === 270) return 'transpose=2,'
  return ''
}

function prepareClip(i: number, cellW: number, cellH: number, isVertical: boolean, rotation: number): string {
  const scaleBase = `scale=${cellW}:${cellH}:force_divisible_by=2`
  const prefix = `[${i}:v]${rotationFilter(rotation)}format=yuv420p,setsar=1,`
  if (isVertical) {
    // Scale up to fill cell width, crop top/bottom — matches object-cover in preview
    return `${prefix}${scaleBase}:force_original_aspect_ratio=increase,crop=${cellW}:${cellH},format=yuv420p,setsar=1[v${i}]`
  }
  return `${prefix}${scaleBase}:force_original_aspect_ratio=decrease,pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p,setsar=1[v${i}]`
}

function buildFilterComplex(
  numClips: number,
  targetW: number,
  targetH: number,
  verticals: boolean[],
  rotations: number[],
): string {
  const vert = (i: number) => verticals[i] ?? false
  const rot = (i: number) => rotations[i] ?? 0

  if (numClips === 1) {
    return prepareClip(0, targetW, targetH, vert(0), rot(0)).replace('[v0]', '[out]')
  }

  if (numClips === 2) {
    const w = evenDimension(Math.floor(targetW * 2 / 3))
    const w2 = targetW - w
    return [
      prepareClip(0, w, targetH, vert(0), rot(0)),
      prepareClip(1, w2, targetH, vert(1), rot(1)),
      `[v0][v1]hstack=inputs=2[out]`,
    ].join(';')
  }

  if (numClips === 3) {
    // If both secondary clips are vertical, put them side by side (matches preview layout)
    if (vert(1) && vert(2)) {
      const smallW = evenDimension(Math.floor(targetW / 4))
      const bigW = targetW - (smallW * 2)
      return [
        prepareClip(0, bigW, targetH, vert(0), rot(0)),
        prepareClip(1, smallW, targetH, vert(1), rot(1)),
        prepareClip(2, smallW, targetH, vert(2), rot(2)),
        `[v0][v1][v2]hstack=inputs=3[out]`,
      ].join(';')
    }
    const bigW = evenDimension(Math.floor(targetW * 0.6))
    const smallW = targetW - bigW
    const smallH = Math.floor(targetH / 2)
    return [
      prepareClip(0, bigW, targetH, vert(0), rot(0)),
      prepareClip(1, smallW, smallH, vert(1), rot(1)),
      prepareClip(2, smallW, smallH, vert(2), rot(2)),
      `[v1][v2]vstack=inputs=2[right]`,
      `[v0][right]hstack=inputs=2[out]`,
    ].join(';')
  }

  // 4+ clips: grid. Use xstack so incomplete final rows keep the full output width.
  const cols = numClips <= 4 ? 2 : 3
  const rows = Math.ceil(numClips / cols)
  const cellW = evenDimension(Math.floor(targetW / cols))
  const cellH = evenDimension(Math.floor(targetH / rows))

  const prepares = Array.from({ length: numClips }, (_, i) =>
    prepareClip(i, cellW, cellH, vert(i), rot(i))
  )
  const inputs = Array.from({ length: numClips }, (_, i) => `[v${i}]`).join('')
  const layout = Array.from({ length: numClips }, (_, i) => {
    const x = (i % cols) * cellW
    const y = Math.floor(i / cols) * cellH
    return `${x}_${y}`
  }).join('|')

  return [
    prepares.join(';'),
    `${inputs}xstack=inputs=${numClips}:layout=${layout}:fill=black[stacked]`,
    `[stacked]pad=${targetW}:${targetH}:0:0:black,crop=${targetW}:${targetH}[out]`,
  ].join(';')
}

function evenDimension(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2)
}

function renderDimension(value: number): number {
  return Math.max(12, Math.floor(value / 12) * 12)
}

export async function renderSegment(
  segment: RenderSegment,
  targetW = 1920,
  targetH = 1080,
  onProgress?: (percent: number) => void,
): Promise<void> {
  mkdirSync(dirname(segment.outputPath), { recursive: true })
  const n = segment.clips.length
  const outputW = renderDimension(targetW)
  const outputH = renderDimension(targetH)

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()
    for (const clip of segment.clips) {
      cmd = cmd.input(clip.localPath).seekInput(clip.startInClip).duration(clip.duration)
    }

    const rotations = segment.clips.map(c => c.rotation ?? 0)
    const verticals = segment.clips.map((c, i) =>
      rotations[i] % 180 === 0 ? c.vertical : !c.vertical
    )
    const filterComplex = buildFilterComplex(n, outputW, outputH, verticals, rotations)

    // Build audio filter — only include clips that actually have an audio stream
    const audioIndices = segment.clips
      .map((c, i) => ({ i, hasAudio: c.hasAudio }))
      .filter(x => x.hasAudio)
      .map(x => x.i)

    let audioFilter: string
    if (audioIndices.length === 0) {
      audioFilter = `anullsrc=r=44100:cl=stereo:d=${segment.duration}[aout]`
    } else if (audioIndices.length === 1) {
      audioFilter = `[${audioIndices[0]}:a]acopy[aout]`
    } else {
      const inputs = audioIndices.map(i => `[${i}:a]`).join('')
      audioFilter = `${inputs}amix=inputs=${audioIndices.length}:duration=longest[aout]`
    }

    const fullFilter = `${filterComplex};${audioFilter}`

    cmd
      .complexFilter(fullFilter)
      .outputOptions(['-filter_threads 1', '-map [out]', '-map [aout]', '-c:v libx264', '-crf 18', '-preset fast', '-pix_fmt yuv420p', '-c:a aac'])
      .output(segment.outputPath)
      .on('progress', p => onProgress?.(p.percent ?? 0))
      .on('end', () => resolve())
      .on('error', (err, _stdout, stderr) => {
        reject(new Error(stderr ? `${err.message}\n${stderr}` : err.message))
      })
      .run()
  })
}

export async function concatenateSegments(
  segmentPaths: string[],
  outputPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  mkdirSync(dirname(outputPath), { recursive: true })
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()
    for (const p of segmentPaths) cmd = cmd.input(p)
    const inputs = segmentPaths.map((_, i) => `[${i}:v][${i}:a]`).join('')
    cmd
      .complexFilter(`${inputs}concat=n=${segmentPaths.length}:v=1:a=1[v][a]`)
      .outputOptions(['-map [v]', '-map [a]', '-c:v libx264', '-crf 18', '-preset fast', '-c:a aac'])
      .output(outputPath)
      .on('progress', p => onProgress?.(p.percent ?? 0))
      .on('end', () => resolve())
      .on('error', (err, _stdout, stderr) => {
        reject(new Error(stderr ? `${err.message}\n${stderr}` : err.message))
      })
      .run()
  })
}
