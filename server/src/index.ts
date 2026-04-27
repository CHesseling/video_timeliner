import express from 'express'
import cors from 'cors'
import { mkdirSync } from 'fs'
import { clipsRouter } from './routes/clips.js'
import { syncRouter } from './routes/sync.js'
import { renderRouter } from './routes/render.js'
import { waveformRouter } from './routes/waveform.js'
import { getProject, saveProject } from './services/storage.js'
import { MEDIA_DIR, OUTPUT_DIR } from './services/paths.js'

const PORT = 3001
const app = express()

app.use(cors())
app.use(express.json())

// Serve downloaded media files (videos + thumbnails)
app.use('/media', express.static(MEDIA_DIR))

// Serve rendered output files
mkdirSync(OUTPUT_DIR, { recursive: true })
app.use('/output', express.static(OUTPUT_DIR))

app.get('/api/project', (_req, res) => {
  res.json(getProject())
})

app.put('/api/project', (req, res) => {
  saveProject(req.body)
  res.json({ ok: true })
})

app.use('/api/clips', clipsRouter)
app.use('/api/sync', syncRouter)
app.use('/api/render', renderRouter)
app.use('/api/waveform', waveformRouter)

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
