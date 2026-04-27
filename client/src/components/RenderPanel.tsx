import { useState } from 'react'
import { useProjectStore } from '../store/useProjectStore'
import type { RenderProgress } from '@video-timeliner/shared'

export function RenderPanel() {
  const project = useProjectStore(s => s.project)
  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState<RenderProgress | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)

  const clips = project?.clips ?? []
  const outputFile = outputPath ? outputPath.split(/[\\/]/).pop() : null

  async function handleRender() {
    setRendering(true)
    setProgress(null)
    setOutputPath(null)

    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data: RenderProgress = JSON.parse(line.slice(6))
        setProgress(data)
        if (data.type === 'done') {
          setOutputPath(data.outputPath ?? null)
          setRendering(false)
        } else if (data.type === 'error') {
          setRendering(false)
        }
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Render</h2>
      <button
        onClick={handleRender}
        disabled={rendering || clips.length === 0}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
      >
        {rendering ? 'Rendering…' : 'Render Output Video'}
      </button>

      {progress && (
        <div className="text-xs text-zinc-400">
          {progress.message}
          {progress.segment && progress.totalSegments && (
            <div className="mt-1 h-1 bg-zinc-700 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${(progress.segment / progress.totalSegments) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {outputPath && (
        <div className="text-xs text-emerald-400">
          ✓ Done — <a href={`/output/${outputFile}`} download className="underline">Download</a>
        </div>
      )}
      {progress?.type === 'error' && (
        <div className="text-xs text-red-400">{progress.message}</div>
      )}
    </div>
  )
}
