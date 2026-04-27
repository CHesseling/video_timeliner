import { useRef, useEffect, useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import { useProjectStore } from '../../store/useProjectStore'
import type { Clip } from '@video-timeliner/shared'

function rotation(clip: Clip): number {
  return clip.rotation ?? 0
}

function effectiveVertical(clip: Clip): boolean {
  return rotation(clip) % 180 === 0 ? clip.vertical : !clip.vertical
}

function gridStyle(clips: Clip[]): CSSProperties {
  const n = clips.length
  const allVertical = n > 0 && clips.every(effectiveVertical)

  if (n <= 1) return { display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }

  if (n === 2) {
    if (allVertical) return { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' }
    return { display: 'grid', gridTemplateColumns: '2fr 1fr' }
  }

  if (n === 3) {
    if (allVertical) return { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr' }
    // If the two secondary clips are both vertical, put them side by side
    if (clips[1] && clips[2] && effectiveVertical(clips[1]) && effectiveVertical(clips[2])) {
      return { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gridTemplateRows: '1fr' }
    }
    return { display: 'grid', gridTemplateColumns: '2fr 1fr', gridTemplateRows: '1fr 1fr' }
  }

  const cols = Math.ceil(Math.sqrt(n))
  return { display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)` }
}

function cellStyle(index: number, clips: Clip[]): CSSProperties {
  const total = clips.length
  const allVertical = clips.every(effectiveVertical)
  const sideVertical = total === 3 && clips[1] && clips[2] && effectiveVertical(clips[1]) && effectiveVertical(clips[2])
  if (index === 0 && total >= 2 && total <= 3 && !allVertical && !sideVertical) return { gridRow: 'span 2' }
  return {}
}

function videoTransformStyle(clip: Clip): CSSProperties {
  const degrees = rotation(clip)
  return degrees ? { transform: `rotate(${degrees}deg)` } : {}
}

export function VideoGrid() {
  const project = useProjectStore(s => s.project)
  const scrubberTime = useProjectStore(s => s.scrubberTime)
  const isPlaying = useProjectStore(s => s.isPlaying)
  const setScrubberTime = useProjectStore(s => s.setScrubberTime)
  const setIsPlaying = useProjectStore(s => s.setIsPlaying)
  const swapClipSlots = useProjectStore(s => s.swapClipSlots)
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const clips = project?.clips ?? []

  const visibleClips = [...clips]
    .filter(c => !c.hidden)
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))

  const activeIds = new Set(
    visibleClips
      .filter(c => scrubberTime >= c.timelineOffset && scrubberTime <= c.timelineOffset + c.duration)
      .map(c => c.id)
  )
  const activeClips = visibleClips.filter(c => activeIds.has(c.id))

  const minOffset = visibleClips.length
    ? Math.min(0, ...visibleClips.map(c => c.timelineOffset))
    : 0
  const totalDuration = visibleClips.length
    ? Math.max(...visibleClips.map(c => c.timelineOffset + c.duration))
    : 60

  const offsetSignature = visibleClips.map(c => `${c.id}:${c.timelineOffset}`).join(',')

  useEffect(() => {
    if (isPlaying) return
    for (const clip of visibleClips) {
      const targetTime = scrubberTime - clip.timelineOffset
      if (targetTime < 0 || targetTime > clip.duration) continue
      const video = videoRefs.current.get(clip.id)
      if (video && Math.abs(video.currentTime - targetTime) > 0.15) {
        video.currentTime = targetTime
      }
    }
  }, [scrubberTime, offsetSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const clip of visibleClips) {
      const shouldPlay = isPlaying && activeIds.has(clip.id)
      const video = videoRefs.current.get(clip.id)
      if (!video) continue
      if (shouldPlay) video.play().catch(() => {})
      else video.pause()
    }
  }, [isPlaying, scrubberTime]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTimeUpdate = useCallback((clip: Clip) => {
    if (!isPlaying) return
    const video = videoRefs.current.get(clip.id)
    if (!video) return
    setScrubberTime(video.currentTime + clip.timelineOffset)
  }, [isPlaying, setScrubberTime])

  const togglePlay = useCallback(() => setIsPlaying(!isPlaying), [isPlaying, setIsPlaying])

  if (clips.length === 0 || visibleClips.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
        Import clips to get started
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden bg-black relative" style={gridStyle(activeClips)}>
        {activeClips.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm">
            No active clips at {scrubberTime.toFixed(1)}s
          </div>
        )}
        {activeClips.map((clip, i) => {
          const isBeingDragged = draggedId === clip.id
          const isDropTarget = dragOverId === clip.id && draggedId !== clip.id
          return (
            <div
              key={clip.id}
              draggable
              onDragStart={() => setDraggedId(clip.id)}
              onDragOver={e => { e.preventDefault(); setDragOverId(clip.id) }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={e => {
                e.preventDefault()
                if (draggedId && draggedId !== clip.id) swapClipSlots(draggedId, clip.id)
                setDraggedId(null)
                setDragOverId(null)
              }}
              onDragEnd={() => { setDraggedId(null); setDragOverId(null) }}
              className="relative overflow-hidden bg-black cursor-grab active:cursor-grabbing"
              style={{
                ...cellStyle(i, activeClips),
                outline: isDropTarget ? '2px dashed white' : `2px solid ${clip.color}`,
                outlineOffset: '-2px',
                opacity: isBeingDragged ? 0.4 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              <video
                ref={el => {
                  if (el) videoRefs.current.set(clip.id, el)
                  else videoRefs.current.delete(clip.id)
                }}
                src={`/media/${clip.filename}`}
                className={`absolute inset-0 w-full h-full ${effectiveVertical(clip) ? 'object-cover' : 'object-contain'}`}
                style={videoTransformStyle(clip)}
                muted={i > 0}
                playsInline
                onTimeUpdate={() => handleTimeUpdate(clip)}
                onEnded={() => setIsPlaying(false)}
              />

              {/* Label */}
              <div className="absolute bottom-1 left-1 flex items-center gap-1 pointer-events-none" style={{ zIndex: 2 }}>
                {effectiveVertical(clip) && (
                  <span className="text-[9px] text-white/70 bg-black/50 px-1 rounded">↕</span>
                )}
                {(clip.rotation ?? 0) !== 0 && (
                  <span className="text-[9px] text-white/70 bg-black/50 px-1 rounded">{clip.rotation}°</span>
                )}
                <span className="text-[10px] text-white/50 bg-black/40 px-1 rounded">{clip.filename}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-t border-zinc-800 shrink-0">
        <button onClick={togglePlay} className="text-zinc-100 hover:text-white text-xl w-8 shrink-0">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="text-xs text-zinc-400 w-24 shrink-0 tabular-nums">
          {formatTime(scrubberTime)} / {formatTime(totalDuration)}
        </span>
        <input
          type="range"
          min={minOffset}
          max={totalDuration || 60}
          step={0.1}
          value={Math.min(Math.max(scrubberTime, minOffset), totalDuration)}
          onChange={e => {
            setIsPlaying(false)
            setScrubberTime(parseFloat(e.target.value))
          }}
          className="flex-1 accent-yellow-400 min-w-0"
        />
      </div>
    </div>
  )
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
