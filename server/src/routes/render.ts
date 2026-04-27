import { Router, Request, Response } from 'express'
import { join } from 'path'
import { rmSync, mkdirSync } from 'fs'
import { getProject } from '../services/storage.js'
import { renderSegment, concatenateSegments, RenderSegment } from '../services/ffmpeg.js'
import type { RenderProgress, Clip } from '@video-timeliner/shared'
import { OUTPUT_DIR } from '../services/paths.js'

export const renderRouter = Router()

// Build time segments from clip list
function buildSegments(clips: Clip[]): Array<{ start: number; end: number; clips: Clip[] }> {
  const boundaries = new Set<number>()
  for (const clip of clips) {
    boundaries.add(clip.timelineOffset)
    boundaries.add(clip.timelineOffset + clip.duration)
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b)

  const segments: Array<{ start: number; end: number; clips: Clip[] }> = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]
    const end = sorted[i + 1]
    const active = clips.filter(c => c.timelineOffset <= start && c.timelineOffset + c.duration >= end)
    if (active.length > 0) {
      segments.push({ start, end, clips: active })
    }
  }
  return segments
}

renderRouter.post('/', async (req: Request, res: Response) => {
  const { width = 1920, height = 1080 } = req.body as { width?: number; height?: number }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: RenderProgress) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const project = getProject()
  const visibleClips = project.clips
    .filter(c => !c.hidden)
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))

  if (visibleClips.length === 0) {
    send({ type: 'error', message: 'No visible clips in project' })
    return res.end()
  }

  const tmpDir = join(OUTPUT_DIR, `tmp_${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    const timeSegments = buildSegments(visibleClips)
    const segmentPaths: string[] = []

    for (let i = 0; i < timeSegments.length; i++) {
      const seg = timeSegments[i]
      const segPath = join(tmpDir, `seg_${i.toString().padStart(4, '0')}.mp4`)
      segmentPaths.push(segPath)

      const renderSeg: RenderSegment = {
        duration: seg.end - seg.start,
        outputPath: segPath,
        clips: seg.clips.map(clip => ({
          localPath: clip.localPath,
          startInClip: seg.start - clip.timelineOffset,
          duration: seg.end - seg.start,
          vertical: clip.vertical ?? false,
          rotation: clip.rotation ?? 0,
          hasAudio: clip.hasAudio ?? true,
        })),
      }

      send({ type: 'progress', segment: i + 1, totalSegments: timeSegments.length, message: `Rendering segment ${i + 1}/${timeSegments.length}` })

      await renderSegment(renderSeg, width, height, percent => {
        send({ type: 'progress', segment: i + 1, totalSegments: timeSegments.length, message: `Segment ${i + 1}: ${Math.round(percent)}%` })
      })
    }

    send({ type: 'progress', message: 'Concatenating segments...' })
    const finalPath = join(OUTPUT_DIR, `output_${Date.now()}.mp4`)
    mkdirSync(OUTPUT_DIR, { recursive: true })

    if (segmentPaths.length === 1) {
      const { copyFileSync } = await import('fs')
      copyFileSync(segmentPaths[0], finalPath)
    } else {
      await concatenateSegments(segmentPaths, finalPath, percent => {
        send({ type: 'progress', message: `Concatenating: ${Math.round(percent)}%` })
      })
    }

    rmSync(tmpDir, { recursive: true, force: true })
    send({ type: 'done', outputPath: finalPath })
    res.end()
  } catch (err: any) {
    send({ type: 'error', message: err.message })
    res.end()
  }
})
