import { useState, useEffect, useRef, useCallback } from 'react'
import { useProjectStore } from '../../store/useProjectStore'
import { waveformCache } from '../../services/waveformCache'
import type { Clip } from '@video-timeliner/shared'

const RULER_HEIGHT = 28
const LANE_HEIGHT = 40
const LANE_GAP = 4

function formatTime(s: number): string {
  const abs = Math.abs(s)
  const m = Math.floor(abs / 60)
  const sec = Math.floor(abs % 60)
  return `${s < 0 ? '-' : ''}${m}:${sec.toString().padStart(2, '0')}`
}

function assignLanes(clips: Clip[]): Map<string, number> {
  const sorted = [...clips].sort((a, b) => a.timelineOffset - b.timelineOffset)
  const laneEnds: number[] = []
  const result = new Map<string, number>()
  for (const clip of sorted) {
    const clipEnd = clip.timelineOffset + clip.duration
    let lane = laneEnds.findIndex(end => end <= clip.timelineOffset)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = clipEnd
    result.set(clip.id, lane)
  }
  return result
}

// --- Waveform ---

function useWaveform(clipId: string): number[] | null {
  const revision = useProjectStore(s => s.waveformRevision)
  const [peaks, setPeaks] = useState<number[] | null>(waveformCache.get(clipId) ?? null)

  useEffect(() => {
    if (waveformCache.has(clipId)) {
      setPeaks(waveformCache.get(clipId)!)
      return
    }
    setPeaks(null)
    fetch(`/api/waveform/${clipId}`)
      .then(r => r.json())
      .then(({ peaks }: { peaks: number[] }) => {
        waveformCache.set(clipId, peaks)
        setPeaks(peaks)
      })
      .catch(() => {})
  }, [clipId, revision])

  return peaks
}

function WaveformSVG({ peaks }: { peaks: number[] }) {
  const n = peaks.length
  const H = 100
  const mid = H / 2
  const scale = mid * 0.88
  const d = peaks
    .map((p, i) => {
      const amp = Math.max(1, p * scale)
      return `M${i},${(mid - amp).toFixed(1)} L${i},${(mid + amp).toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${n} ${H}`}
      preserveAspectRatio="none"
    >
      <path d={d} stroke="rgba(255,255,255,0.55)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// --- ClipBar (own component so useWaveform hook is valid) ---

interface ClipBarProps {
  clip: Clip
  x: number
  y: number
  w: number
  onMouseDown: (e: React.MouseEvent, clip: Clip) => void
  onDoubleClick: (clipId: string) => void
}

function ClipBar({ clip, x, y, w, onMouseDown, onDoubleClick }: ClipBarProps) {
  const peaks = useWaveform(clip.id)
  return (
    <div
      className="absolute rounded overflow-hidden group cursor-grab"
      style={{
        left: x,
        top: y,
        width: w,
        height: LANE_HEIGHT,
        background: clip.hidden ? `${clip.color}44` : clip.color,
        opacity: clip.hidden ? 0.5 : 1,
        outline: `2px solid ${clip.color}`,
        outlineOffset: '-1px',
      }}
      onMouseDown={e => onMouseDown(e, clip)}
      onDoubleClick={() => onDoubleClick(clip.id)}
      title={`${clip.filename}${clip.hidden ? ' (hidden)' : ''} — double-click to sync`}
    >
      {peaks && <WaveformSVG peaks={peaks} />}
      <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
        <span className="text-white text-[11px] font-semibold truncate drop-shadow-sm z-10">
          {clip.filename}
        </span>
        <button
          className="ml-auto opacity-0 group-hover:opacity-100 text-white/80 hover:text-white text-xs pl-1 shrink-0 transition-opacity pointer-events-auto z-10"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDoubleClick(clip.id) }}
          title="Sync options"
        >⚙</button>
      </div>
    </div>
  )
}

// --- Timeline ---

export function Timeline() {
  const project = useProjectStore(s => s.project)
  const scrubberTime = useProjectStore(s => s.scrubberTime)
  const zoom = useProjectStore(s => s.zoom)
  const setScrubberTime = useProjectStore(s => s.setScrubberTime)
  const setZoom = useProjectStore(s => s.setZoom)
  const updateClipOffset = useProjectStore(s => s.updateClipOffset)
  const openSyncDialog = useProjectStore(s => s.openSyncDialog)
  const containerRef = useRef<HTMLDivElement>(null)

  const dragging = useRef<{ clipId: string; startX: number; startOffset: number } | null>(null)
  const [frozenLanes, setFrozenLanes] = useState<Map<string, number> | null>(null)

  const clips = project?.clips ?? []

  // Allow negative offsets: compute the left edge of the visible timeline
  const minOffset = clips.length ? Math.min(0, ...clips.map(c => c.timelineOffset)) : 0
  const maxEnd = clips.length ? Math.max(...clips.map(c => c.timelineOffset + c.duration)) : 120
  const timelineSpan = maxEnd - minOffset + 10  // seconds of canvas

  const lanes = frozenLanes ?? assignLanes(clips)
  const numLanes = Math.max(1, ...Array.from(lanes.values()).map(l => l + 1))
  const timelineHeight = RULER_HEIGHT + numLanes * (LANE_HEIGHT + LANE_GAP)
  const totalWidth = timelineSpan * zoom
  const tickInterval = zoom < 20 ? 60 : zoom < 50 ? 30 : zoom < 100 ? 10 : 5

  // Convert an absolute time to a canvas x position
  const toX = useCallback((t: number) => (t - minOffset) * zoom, [minOffset, zoom])

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const x = e.clientX - rect.left + (containerRef.current?.scrollLeft ?? 0)
    setScrubberTime(x / zoom + minOffset)
  }, [zoom, minOffset, setScrubberTime])

  const handleClipMouseDown = useCallback((e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation()
    dragging.current = { clipId: clip.id, startX: e.clientX, startOffset: clip.timelineOffset }
    setFrozenLanes(assignLanes(clips))
    document.body.style.cursor = 'grabbing'
  }, [clips])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return
      const dx = e.clientX - dragging.current.startX
      // No lower bound — clips can have negative offsets
      const newOffset = dragging.current.startOffset + dx / zoom
      updateClipOffset(dragging.current.clipId, newOffset)
    }
    function onMouseUp(e: MouseEvent) {
      if (!dragging.current) return
      const dx = e.clientX - dragging.current.startX
      const newOffset = dragging.current.startOffset + dx / zoom
      const clipId = dragging.current.clipId
      dragging.current = null
      document.body.style.cursor = ''
      setFrozenLanes(null)
      updateClipOffset(clipId, newOffset)
      fetch(`/api/clips/${clipId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timelineOffset: newOffset, syncMethod: 'drag' }),
      })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [zoom, updateClipOffset])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9))
    }
  }, [zoom, setZoom])

  // Ruler ticks: start from the rounded-down minOffset
  const startTick = Math.floor(minOffset / tickInterval) * tickInterval
  const numTicks = Math.ceil(timelineSpan / tickInterval) + 2
  const majorEvery = Math.round(60 / tickInterval)

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto overflow-y-hidden bg-zinc-950 border-t border-zinc-800 select-none"
      style={{ height: timelineHeight + 2 }}
      onWheel={handleWheel}
    >
      <div className="relative" style={{ width: totalWidth, height: timelineHeight }}>
        {/* Ruler */}
        <div
          className="absolute top-0 left-0 right-0 bg-zinc-900 border-b border-zinc-800 cursor-pointer"
          style={{ height: RULER_HEIGHT }}
          onClick={handleRulerClick}
        >
          {/* t=0 line when minOffset < 0 */}
          {minOffset < 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-zinc-400/40 pointer-events-none"
              style={{ left: toX(0) }}
            />
          )}
          {Array.from({ length: numTicks }, (_, i) => {
            const t = startTick + i * tickInterval
            const x = toX(t)
            if (x < 0 || x > totalWidth) return null
            const isMajor = Math.round((t - startTick) / tickInterval) % majorEvery === 0
            return (
              <div key={t} className="absolute top-0 flex flex-col items-center" style={{ left: x }}>
                <div
                  className="w-px bg-zinc-600"
                  style={{ height: isMajor ? 12 : 6, marginTop: isMajor ? 0 : 6 }}
                />
                {isMajor && (
                  <span className="text-[10px] text-zinc-500 mt-0.5 translate-x-1">{formatTime(t)}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Clip bars */}
        {clips.map(clip => {
          const lane = lanes.get(clip.id) ?? 0
          const x = toX(clip.timelineOffset)
          const w = Math.max(clip.duration * zoom, 8)
          const y = RULER_HEIGHT + lane * (LANE_HEIGHT + LANE_GAP) + LANE_GAP / 2
          return (
            <ClipBar
              key={clip.id}
              clip={clip}
              x={x}
              y={y}
              w={w}
              onMouseDown={handleClipMouseDown}
              onDoubleClick={openSyncDialog}
            />
          )
        })}

        {/* Scrubber */}
        <div
          className="absolute top-0 bottom-0 w-px bg-yellow-400 pointer-events-none z-10"
          style={{ left: toX(scrubberTime) }}
        >
          <div className="w-2.5 h-2.5 bg-yellow-400 rounded-full -translate-x-[5px]" />
        </div>
      </div>
    </div>
  )
}
