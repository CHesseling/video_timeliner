import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { join, basename } from 'path'
import { downloadVideo } from '../services/ytdlp.js'
import { MEDIA_DIR } from '../services/paths.js'
import { probeVideo, extractThumbnail } from '../services/ffmpeg.js'
import { addClip, removeClip, updateClip, getProject } from '../services/storage.js'
import type { Clip, ImportProgress } from '@video-timeliner/shared'

const CLIP_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
]

function nextColor(clips: Clip[]): string {
  return CLIP_COLORS[clips.length % CLIP_COLORS.length]
}

export const clipsRouter = Router()

// SSE: download progress for a single import
clipsRouter.post('/import', async (req: Request, res: Response) => {
  const { url } = req.body as { url: string }
  if (!url) return res.status(400).json({ error: 'url required' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: ImportProgress) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const { filePath } = await downloadVideo(url, (percent, message) => {
      send({ type: 'progress', percent, message })
    })

    send({ type: 'progress', percent: 100, message: 'Probing video...' })

    const probe = await probeVideo(filePath)
    const id = randomUUID()
    const thumbPath = join(MEDIA_DIR, `${id}_thumb.jpg`)
    await extractThumbnail(filePath, thumbPath)

    const project = getProject()
    const clip: Clip = {
      id,
      sourceUrl: url,
      localPath: filePath,
      filename: basename(filePath),
      duration: probe.duration,
      timelineOffset: 0,
      syncMethod: 'none',
      thumbnail: `/media/${id}_thumb.jpg`,
      color: nextColor(project.clips),
      slot: project.clips.length,
      hidden: false,
      vertical: probe.width < probe.height,
      rotation: 0,
      hasAudio: probe.hasAudio,
    }

    addClip(clip)
    send({ type: 'done', clipId: id })
    res.end()
  } catch (err: any) {
    send({ type: 'error', message: err.message })
    res.end()
  }
})

clipsRouter.put('/:id', (req: Request, res: Response) => {
  try {
    updateClip(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(404).json({ error: err.message })
  }
})

clipsRouter.delete('/:id', (req: Request, res: Response) => {
  removeClip(req.params.id)
  res.json({ ok: true })
})
