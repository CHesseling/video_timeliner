import { Router, Request, Response } from 'express'
import { getProject } from '../services/storage.js'
import { getWaveformPeaks, deleteWaveformCache } from '../services/waveform.js'

export const waveformRouter = Router()

waveformRouter.get('/:id', async (req: Request, res: Response) => {
  const project = getProject()
  const clip = project.clips.find(c => c.id === req.params.id)
  if (!clip) return res.status(404).json({ error: 'Clip not found' })

  try {
    const peaks = await getWaveformPeaks(clip.id, clip.localPath)
    res.json({ peaks })
  } catch {
    res.json({ peaks: new Array(800).fill(0) })
  }
})

// Delete cached waveform for one clip so next GET re-extracts it
waveformRouter.delete('/:id', (req: Request, res: Response) => {
  deleteWaveformCache(req.params.id)
  res.json({ ok: true })
})

// Delete all cached waveforms
waveformRouter.delete('/', (_req: Request, res: Response) => {
  const project = getProject()
  for (const clip of project.clips) {
    deleteWaveformCache(clip.id)
  }
  res.json({ ok: true })
})
