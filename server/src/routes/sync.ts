import { Router, Request, Response } from 'express'
import { computeAudioSync } from '../services/audioSync.js'
import { getProject } from '../services/storage.js'

export const syncRouter = Router()

syncRouter.post('/audio', async (req: Request, res: Response) => {
  const { referenceClipId, targetClipId } = req.body as {
    referenceClipId: string
    targetClipId: string
  }

  const project = getProject()
  const refClip = project.clips.find(c => c.id === referenceClipId)
  const tgtClip = project.clips.find(c => c.id === targetClipId)

  if (!refClip || !tgtClip) {
    return res.status(404).json({ error: 'Clip not found' })
  }

  try {
    const result = await computeAudioSync(
      refClip.localPath,
      tgtClip.localPath,
      refClip.timelineOffset,
      tgtClip.timelineOffset,
    )
    // offsetSeconds: how much later target starts relative to reference
    // new timelineOffset for target = refClip.timelineOffset + result.offsetSeconds
    const newOffset = refClip.timelineOffset + result.offsetSeconds
    res.json({ offsetSeconds: newOffset, confidence: result.confidence })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
