import { useEffect } from 'react'
import { useProjectStore } from './store/useProjectStore'
import { ImportPanel } from './components/ImportPanel/ImportPanel'
import { Timeline } from './components/Timeline/Timeline'
import { VideoGrid } from './components/VideoGrid/VideoGrid'
import { SyncDialog } from './components/SyncDialog/SyncDialog'
import { ClipList } from './components/ClipList'
import { RenderPanel } from './components/RenderPanel'
import { SessionPanel } from './components/SessionPanel'

export default function App() {
  const refetchProject = useProjectStore(s => s.refetchProject)
  const zoom = useProjectStore(s => s.zoom)
  const setZoom = useProjectStore(s => s.setZoom)

  useEffect(() => {
    refetchProject()
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      const { isPlaying, setIsPlaying } = useProjectStore.getState()
      setIsPlaying(!isPlaying)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <span className="text-sm font-semibold text-zinc-200">Video Timeliner</span>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
          <span>Zoom</span>
          <input
            type="range"
            min={10}
            max={200}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="w-24 accent-blue-500"
          />
          <span className="w-12">{zoom}px/s</span>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="w-64 shrink-0 flex flex-col gap-4 p-4 bg-zinc-900 border-r border-zinc-800 overflow-y-auto">
          <ImportPanel />
          <ClipList />
          <div className="mt-auto flex flex-col gap-4">
            <SessionPanel />
            <RenderPanel />
          </div>
        </div>

        {/* Center: preview + timeline */}
        <div className="flex flex-col flex-1 min-w-0">
          <VideoGrid />
          <Timeline />
        </div>
      </div>

      <SyncDialog />
    </div>
  )
}
