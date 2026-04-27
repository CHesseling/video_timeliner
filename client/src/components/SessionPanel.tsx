import { useRef, useState } from 'react'
import { useProjectStore } from '../store/useProjectStore'
import type { ImportProgress } from '@video-timeliner/shared'

// EDL markdown format:
// ## Clips
// | offset_s | duration_s | sync_method | rotation | source_url |
// |----------|------------|-------------|----------|------------|
// | 0.000    | 73.4       | manual      | 90       | https://.. |

function exportEdl(project: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>): string {
  const lines = [
    `# Video Timeliner EDL`,
    ``,
    `## Project: ${project.name}`,
    project.eventStartTime ? `Event Start: ${project.eventStartTime}` : '',
    ``,
    `## Clips`,
    ``,
    `| Offset (s) | Duration (s) | Sync | Rotation | Source URL |`,
    `|------------|--------------|------|----------|------------|`,
    ...project.clips.map(c =>
      `| ${c.timelineOffset.toFixed(3)} | ${c.duration.toFixed(3)} | ${c.syncMethod} | ${c.rotation ?? 0} | ${c.sourceUrl} |`
    ),
  ].filter(l => l !== undefined)
  return lines.join('\n')
}

interface EdlRow {
  offset: number
  url: string
  syncMethod: string
  rotation: number
}

function parseEdl(text: string): EdlRow[] {
  const rows: EdlRow[] = []
  let inTable = false
  for (const line of text.split('\n')) {
    if (line.startsWith('| Offset')) { inTable = true; continue }
    if (line.startsWith('|---')) continue
    if (!inTable) continue
    if (!line.startsWith('|')) break
    const cols = line.split('|').map(s => s.trim()).filter(Boolean)
    if (cols.length < 4) continue
    const offset = parseFloat(cols[0])
    const syncMethod = cols[2]
    const hasRotation = cols.length >= 5
    const rotation = hasRotation ? parseFloat(cols[3]) : 0
    const url = hasRotation ? cols[4] : cols[3]
    if (!isNaN(offset) && url.startsWith('http')) {
      rows.push({ offset, url, syncMethod, rotation: normalizeRotation(rotation) })
    }
  }
  return rows
}

function normalizeRotation(value: number): number {
  const normalized = ((value % 360) + 360) % 360
  return [0, 90, 180, 270].includes(normalized) ? normalized : 0
}

interface ImportJob {
  url: string
  targetOffset: number
  status: 'pending' | 'downloading' | 'done' | 'error'
  message: string
}

export function SessionPanel() {
  const project = useProjectStore(s => s.project)
  const refetchProject = useProjectStore(s => s.refetchProject)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [jobs, setJobs] = useState<ImportJob[]>([])

  function handleExport() {
    if (!project) return
    const content = exportEdl(project)
    const blob = new Blob([content], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${project.name.replace(/\s+/g, '_')}_session.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function handleImportEdl(file: File) {
    const text = await file.text()
    const rows = parseEdl(text)
    if (!rows.length) return alert('No valid clip rows found in EDL file.')

    setImporting(true)
    setJobs(rows.map(r => ({ url: r.url, targetOffset: r.offset, status: 'pending', message: '' })))

    for (const row of rows) {
      setJobs(prev => prev.map(j => j.url === row.url ? { ...j, status: 'downloading' } : j))

      try {
        const res = await fetch('/api/clips/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: row.url }),
        })

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let clipId: string | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data: ImportProgress = JSON.parse(line.slice(6))
            if (data.type === 'done') clipId = data.clipId ?? null
            if (data.type === 'error') throw new Error(data.message)
          }
        }

        // Apply the saved offset from the EDL
        if (clipId) {
          await fetch(`/api/clips/${clipId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timelineOffset: row.offset, syncMethod: row.syncMethod, rotation: row.rotation }),
          })
        }

        setJobs(prev => prev.map(j => j.url === row.url ? { ...j, status: 'done', message: 'Done' } : j))
        await refetchProject()
      } catch (e: any) {
        setJobs(prev => prev.map(j => j.url === row.url ? { ...j, status: 'error', message: e.message } : j))
      }
    }
    setImporting(false)
  }

  return (
    <div className="flex flex-col gap-2 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Session</h2>
      <p className="text-[11px] text-zinc-500">Project is auto-saved. Export an EDL to share or re-import later.</p>
      <div className="flex gap-2">
        <button
          onClick={handleExport}
          disabled={!project?.clips.length}
          className="flex-1 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 rounded text-xs font-medium transition-colors"
        >
          Export EDL
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="flex-1 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 rounded text-xs font-medium transition-colors"
        >
          Import EDL
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImportEdl(f) }}
        />
      </div>

      {jobs.length > 0 && (
        <div className="flex flex-col gap-1 max-h-32 overflow-y-auto mt-1">
          {jobs.map(j => (
            <div key={j.url} className="flex items-center gap-2 text-[11px]">
              <span className={
                j.status === 'done' ? 'text-green-400' :
                j.status === 'error' ? 'text-red-400' :
                j.status === 'downloading' ? 'text-blue-400' : 'text-zinc-500'
              }>
                {j.status === 'done' ? '✓' : j.status === 'error' ? '✗' : j.status === 'downloading' ? '↓' : '·'}
              </span>
              <span className="text-zinc-400 truncate">{j.url}</span>
              {j.status === 'error' && <span className="text-red-400 shrink-0">{j.message}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
