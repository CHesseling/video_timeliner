import { useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useProjectStore } from '../../store/useProjectStore'
import type { AudioSyncResult, Clip } from '@video-timeliner/shared'

type Tab = 'manual' | 'visual' | 'audio'

function rotatedVideoStyle(clip: Clip | undefined): CSSProperties {
  const rotation = clip?.rotation ?? 0
  return {
    maxHeight: 160,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  }
}

function parseOffset(input: string, eventStart: string | undefined): number {
  // Accept HH:MM:SS, MM:SS, or raw seconds
  const parts = input.trim().split(':').map(Number)
  let seconds = 0
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1]
  else seconds = parts[0]

  if (eventStart) {
    const eventSeconds = new Date(eventStart).getTime() / 1000
    // If input looks like a wall-clock time (>= 3 parts), subtract event start
    if (input.includes(':') && parts.length >= 2) {
      const inputDate = new Date(eventStart)
      const [h, m, s] = input.trim().split(':').map(Number)
      if (input.trim().split(':').length === 3) {
        inputDate.setHours(h, m, s, 0)
        return Math.max(0, (inputDate.getTime() / 1000) - eventSeconds)
      }
    }
  }
  return Math.max(0, seconds)
}

export function SyncDialog() {
  const syncDialogClipId = useProjectStore(s => s.syncDialogClipId)
  const project = useProjectStore(s => s.project)
  const closeSyncDialog = useProjectStore(s => s.closeSyncDialog)
  const updateClipOffset = useProjectStore(s => s.updateClipOffset)
  const removeClip = useProjectStore(s => s.removeClip)
  const refetchProject = useProjectStore(s => s.refetchProject)

  const [tab, setTab] = useState<Tab>('manual')
  const [manualInput, setManualInput] = useState('')
  const [audioResult, setAudioResult] = useState<AudioSyncResult | null>(null)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState('')

  const refVideoRef = useRef<HTMLVideoElement>(null)
  const tgtVideoRef = useRef<HTMLVideoElement>(null)
  const refMarkTime = useRef<number | null>(null)
  const tgtMarkTime = useRef<number | null>(null)
  const [refMarked, setRefMarked] = useState(false)
  const [tgtMarked, setTgtMarked] = useState(false)
  const [visualOffset, setVisualOffset] = useState<number | null>(null)

  if (!syncDialogClipId || !project) return null

  const clip = project.clips.find(c => c.id === syncDialogClipId)
  if (!clip) return null

  const refClip = project.clips[0]
  const isRefClip = clip.id === refClip?.id

  function applyOffset(offset: number, method: string) {
    updateClipOffset(clip!.id, offset)
    fetch(`/api/clips/${clip!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timelineOffset: offset, syncMethod: method }),
    }).then(() => refetchProject())
    closeSyncDialog()
  }

  function handleManualApply() {
    const offset = parseOffset(manualInput, project?.eventStartTime)
    applyOffset(offset, 'manual')
  }

  function markRef() {
    refMarkTime.current = refVideoRef.current?.currentTime ?? null
    setRefMarked(true)
    computeVisualOffset()
  }

  function markTgt() {
    tgtMarkTime.current = tgtVideoRef.current?.currentTime ?? null
    setTgtMarked(true)
    computeVisualOffset()
  }

  function computeVisualOffset() {
    if (refMarkTime.current !== null && tgtMarkTime.current !== null && refClip) {
      const offset = (refMarkTime.current + refClip.timelineOffset) - tgtMarkTime.current
      setVisualOffset(offset)
    }
  }

  async function handleAudioSync() {
    if (!refClip) return
    setAudioLoading(true)
    setAudioError('')
    setAudioResult(null)
    try {
      const res = await fetch('/api/sync/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceClipId: refClip.id, targetClipId: clip!.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAudioResult(data)
    } catch (e: any) {
      setAudioError(e.message)
    } finally {
      setAudioLoading(false)
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'manual', label: 'Manual' },
    { id: 'visual', label: 'Visual Cue' },
    { id: 'audio', label: 'Audio Sync' },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeSyncDialog}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-[720px] max-w-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Sync Clip</h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[400px]">{clip.filename}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { removeClip(clip.id); closeSyncDialog() }}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remove clip
            </button>
            <button onClick={closeSyncDialog} className="text-zinc-400 hover:text-zinc-200 text-xl leading-none">×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm transition-colors ${tab === t.id ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* Manual tab */}
          {tab === 'manual' && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-zinc-400">
                Enter the real-world time when this clip started.
                {project.eventStartTime
                  ? ` Event reference: ${project.eventStartTime}`
                  : ' Set an event start time in project settings to use wall-clock input.'}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
                  placeholder="HH:MM:SS or seconds from event start"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleManualApply()}
                />
                <button
                  onClick={handleManualApply}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
                >
                  Apply
                </button>
              </div>
              <p className="text-xs text-zinc-500">Current offset: {clip.timelineOffset.toFixed(2)}s</p>
            </div>
          )}

          {/* Visual cue tab */}
          {tab === 'visual' && (
            <div className="flex flex-col gap-4">
              {isRefClip ? (
                <p className="text-xs text-zinc-400">This is the reference clip — other clips sync to it.</p>
              ) : (
                <>
                  <p className="text-xs text-zinc-400">
                    Play both videos to the same moment, then mark each. The offset will be calculated automatically.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">Reference: {refClip?.filename}</p>
                      <video
                        ref={refVideoRef}
                        src={`/media/${refClip?.filename}`}
                        controls
                        className="w-full rounded bg-black"
                        style={rotatedVideoStyle(refClip)}
                      />
                      <button
                        onClick={markRef}
                        className={`mt-2 w-full py-1.5 rounded text-xs font-medium transition-colors ${refMarked ? 'bg-green-700 text-green-100' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'}`}
                      >
                        {refMarked ? '✓ Marked' : 'Mark here'}
                      </button>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">This clip</p>
                      <video
                        ref={tgtVideoRef}
                        src={`/media/${clip.filename}`}
                        controls
                        className="w-full rounded bg-black"
                        style={rotatedVideoStyle(clip)}
                      />
                      <button
                        onClick={markTgt}
                        className={`mt-2 w-full py-1.5 rounded text-xs font-medium transition-colors ${tgtMarked ? 'bg-green-700 text-green-100' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'}`}
                      >
                        {tgtMarked ? '✓ Marked' : 'Mark here'}
                      </button>
                    </div>
                  </div>
                  {visualOffset !== null && (
                    <div className="flex items-center justify-between bg-zinc-800 rounded p-3">
                      <span className="text-sm text-zinc-300">Calculated offset: <strong>{visualOffset.toFixed(3)}s</strong></span>
                      <button
                        onClick={() => applyOffset(visualOffset, 'visual')}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Audio sync tab */}
          {tab === 'audio' && (
            <div className="flex flex-col gap-4">
              {isRefClip ? (
                <p className="text-xs text-zinc-400">This is the reference clip — other clips sync to it.</p>
              ) : (
                <>
                  <p className="text-xs text-zinc-400">
                    Automatically finds the time offset by cross-correlating the audio of this clip with the reference clip.
                    Works best when both clips share overlapping ambient sound or voices.
                  </p>
                  {!audioResult && !audioLoading && (
                    <button
                      onClick={handleAudioSync}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium self-start"
                    >
                      Analyze audio
                    </button>
                  )}
                  {audioLoading && (
                    <div className="text-sm text-zinc-400">Analyzing audio… (may take a few seconds)</div>
                  )}
                  {audioError && <div className="text-sm text-red-400">{audioError}</div>}
                  {audioResult && (
                    <div className="flex items-center justify-between bg-zinc-800 rounded p-3">
                      <div>
                        <div className="text-sm text-zinc-300">
                          Offset: <strong>{audioResult.offsetSeconds.toFixed(3)}s</strong>
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          Confidence: {Math.round(audioResult.confidence * 100)}%
                          {audioResult.confidence < 0.3 && ' — low confidence, verify visually'}
                        </div>
                      </div>
                      <button
                        onClick={() => applyOffset(audioResult.offsetSeconds, 'audio')}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
