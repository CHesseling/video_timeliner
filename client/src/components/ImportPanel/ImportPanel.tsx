import { useState } from 'react'
import { useProjectStore } from '../../store/useProjectStore'
import type { ImportProgress } from '@video-timeliner/shared'

interface DownloadJob {
  url: string
  status: 'downloading' | 'done' | 'error'
  percent: number
  message: string
}

export function ImportPanel() {
  const [urlInput, setUrlInput] = useState('')
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const refetchProject = useProjectStore(s => s.refetchProject)

  function updateJob(url: string, updates: Partial<DownloadJob>) {
    setJobs(prev => prev.map(j => j.url === url ? { ...j, ...updates } : j))
  }

  async function handleImport() {
    const urls = urlInput
      .split('\n')
      .map(u => u.trim())
      .filter(Boolean)
    if (!urls.length) return
    setUrlInput('')

    for (const url of urls) {
      setJobs(prev => [...prev, { url, status: 'downloading', percent: 0, message: 'Starting...' }])

      const res = await fetch('/api/clips/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
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
          const data: ImportProgress = JSON.parse(line.slice(6))
          if (data.type === 'progress') {
            updateJob(url, { percent: data.percent ?? 0, message: data.message ?? '' })
          } else if (data.type === 'done') {
            updateJob(url, { status: 'done', percent: 100, message: 'Done' })
            refetchProject()
          } else if (data.type === 'error') {
            updateJob(url, { status: 'error', message: data.message ?? 'Unknown error' })
          }
        }
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Import Clips</h2>
      <textarea
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:border-blue-500"
        rows={3}
        placeholder="Paste URLs (one per line)&#10;Supports yt-dlp URLs and direct .mp4 media links..."
        value={urlInput}
        onChange={e => setUrlInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleImport()
        }}
      />
      <button
        onClick={handleImport}
        disabled={!urlInput.trim()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
      >
        Import
      </button>

      {jobs.length > 0 && (
        <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
          {jobs.map(job => (
            <div key={job.url} className="text-xs bg-zinc-800 rounded p-2">
              <div className="flex justify-between mb-1">
                <span className="text-zinc-400 truncate max-w-[80%]">{job.url}</span>
                <span className={job.status === 'error' ? 'text-red-400' : job.status === 'done' ? 'text-green-400' : 'text-blue-400'}>
                  {job.status === 'done' ? '✓' : job.status === 'error' ? '✗' : `${Math.round(job.percent)}%`}
                </span>
              </div>
              {job.status === 'downloading' && (
                <div className="h-1 bg-zinc-700 rounded overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${job.percent}%` }} />
                </div>
              )}
              {job.status === 'error' && <div className="text-red-400 mt-1">{job.message}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
