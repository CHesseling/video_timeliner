import { useState } from 'react'
import { useProjectStore } from '../store/useProjectStore'
import { evictWaveform, evictAllWaveforms } from '../services/waveformCache'

const SLOT_LABELS = ['★', '2', '3', '4', '5', '6', '7', '8']

export function ClipList() {
  const project = useProjectStore(s => s.project)
  const openSyncDialog = useProjectStore(s => s.openSyncDialog)
  const removeClip = useProjectStore(s => s.removeClip)
  const toggleClipHidden = useProjectStore(s => s.toggleClipHidden)
  const toggleClipVertical = useProjectStore(s => s.toggleClipVertical)
  const rotateClip = useProjectStore(s => s.rotateClip)
  const reorderClip = useProjectStore(s => s.reorderClip)
  const bumpWaveformRevision = useProjectStore(s => s.bumpWaveformRevision)
  const [reextracting, setReextracting] = useState<Set<string>>(new Set())

  const clips = project?.clips ?? []
  if (!clips.length) return null

  const sorted = [...clips].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))

  async function reextractOne(clipId: string) {
    setReextracting(prev => new Set(prev).add(clipId))
    try {
      await fetch(`/api/waveform/${clipId}`, { method: 'DELETE' })
      evictWaveform(clipId)
      bumpWaveformRevision()
    } finally {
      setReextracting(prev => { const s = new Set(prev); s.delete(clipId); return s })
    }
  }

  async function reextractAll() {
    const ids = sorted.map(c => c.id)
    setReextracting(new Set(ids))
    try {
      await fetch('/api/waveform', { method: 'DELETE' })
      evictAllWaveforms()
      bumpWaveformRevision()
    } finally {
      setReextracting(new Set())
    }
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Clips</span>
        <button
          onClick={reextractAll}
          className="text-[10px] text-zinc-500 hover:text-zinc-200 flex items-center gap-1 transition-colors"
          title="Re-extract audio waveforms for all clips"
        >
          ↺ all audio
        </button>
      </div>

      {sorted.map((clip, i) => (
        <div
          key={clip.id}
          className={`flex flex-col gap-2 px-3 py-2.5 rounded border transition-colors min-w-0 ${
            clip.hidden
              ? 'bg-zinc-900 border-zinc-800 opacity-50'
              : 'bg-zinc-800/60 border-zinc-700/50 hover:bg-zinc-800'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            {/* Slot badge */}
            <span
              className="text-xs font-bold w-5 text-center shrink-0 pt-0.5"
              style={{ color: clip.color }}
              title="Grid position (★ = main/largest)"
            >
              {SLOT_LABELS[i] ?? String(i + 1)}
            </span>

            {/* Filename + offset */}
            <div className="flex-1 min-w-0">
              <div
                className={`text-xs font-medium leading-snug break-all ${clip.hidden ? 'line-through opacity-60' : ''}`}
                style={{ color: clip.color }}
                title={clip.filename}
              >
                {clip.filename}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">
                Offset {clip.timelineOffset.toFixed(2)}s · Duration {formatDuration(clip.duration)}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(1.75rem,1fr))] gap-1 w-full">
            <button
              onClick={() => reorderClip(clip.id, 'up')}
              disabled={i === 0}
              className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 text-xs h-7 flex items-center justify-center rounded bg-zinc-900/60"
              title="Move up"
            >▲</button>
            <button
              onClick={() => reorderClip(clip.id, 'down')}
              disabled={i === sorted.length - 1}
              className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 text-xs h-7 flex items-center justify-center rounded bg-zinc-900/60"
              title="Move down"
            >▼</button>

            {/* Re-extract waveform */}
            <button
              onClick={() => reextractOne(clip.id)}
              disabled={reextracting.has(clip.id)}
              className="text-zinc-500 hover:text-blue-400 disabled:opacity-40 disabled:animate-pulse text-xs h-7 flex items-center justify-center rounded bg-zinc-900/60 transition-colors"
              title="Re-extract audio waveform"
            >↺</button>

            {/* Vertical (portrait) blur-fill toggle */}
            <button
              onClick={() => toggleClipVertical(clip.id)}
              className="text-xs h-7 flex items-center justify-center rounded bg-zinc-900/60 transition-colors"
              style={{ color: clip.vertical ? clip.color : undefined }}
              title={clip.vertical ? 'Portrait mode (blur-fill) — click to disable' : 'Enable portrait blur-fill'}
            >↕</button>

            <button
              onClick={() => rotateClip(clip.id, 'ccw')}
              className="text-zinc-500 hover:text-zinc-200 text-xs h-7 flex items-center justify-center rounded bg-zinc-900/60 transition-colors"
              title="Rotate 90° counter-clockwise"
            >↶</button>

            <button
              onClick={() => rotateClip(clip.id, 'cw')}
              className="text-xs h-7 flex items-center justify-center rounded bg-zinc-900/60 transition-colors"
              style={{ color: (clip.rotation ?? 0) !== 0 ? clip.color : undefined }}
              title={`Rotate 90° clockwise (current: ${clip.rotation ?? 0}°)`}
            >{clip.rotation ?? 0}°</button>

            <button
              onClick={() => toggleClipHidden(clip.id)}
              className={`text-sm h-7 flex items-center justify-center rounded bg-zinc-900/60 transition-colors ${
                clip.hidden ? 'text-zinc-600 hover:text-zinc-400' : 'text-zinc-300 hover:text-white'
              }`}
              title={clip.hidden ? 'Show track' : 'Hide track'}
            >{clip.hidden ? '🙈' : '👁'}</button>

            <button
              onClick={() => openSyncDialog(clip.id)}
              className="text-zinc-500 hover:text-zinc-200 text-xs h-7 flex items-center justify-center rounded bg-zinc-900/60"
              title="Sync options"
            >⚙</button>

            <button
              onClick={() => removeClip(clip.id)}
              className="text-zinc-600 hover:text-red-400 text-xs h-7 flex items-center justify-center rounded bg-zinc-900/60"
              title="Remove"
            >✕</button>
          </div>
        </div>
      ))}

      <p className="text-[10px] text-zinc-600 mt-1 leading-relaxed">
        ▲▼ reorder · ↺ audio · ↕ portrait · ↶/° rotate · 👁 hide
      </p>
    </div>
  )
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return m > 0 ? `${m}m${sec}s` : `${sec}s`
}
