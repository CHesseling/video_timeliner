import { create } from 'zustand'
import type { Project, RotationDegrees } from '@video-timeliner/shared'

interface ProjectStore {
  project: Project | null
  selectedClipId: string | null
  scrubberTime: number
  isPlaying: boolean
  zoom: number
  syncDialogClipId: string | null
  waveformRevision: number

  setProject: (p: Project) => void
  updateClipOffset: (id: string, offset: number) => void
  setSelectedClip: (id: string | null) => void
  setScrubberTime: (t: number) => void
  setIsPlaying: (v: boolean) => void
  setZoom: (z: number) => void
  openSyncDialog: (clipId: string) => void
  closeSyncDialog: () => void
  removeClip: (id: string) => void
  toggleClipHidden: (id: string) => void
  toggleClipVertical: (id: string) => void
  rotateClip: (id: string, direction: 'cw' | 'ccw') => void
  reorderClip: (id: string, direction: 'up' | 'down') => void
  swapClipSlots: (idA: string, idB: string) => void
  refetchProject: () => Promise<void>
  bumpWaveformRevision: () => void
}

function persistClip(id: string, updates: Record<string, unknown>) {
  fetch(`/api/clips/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

function normalizeRotation(value: number): RotationDegrees {
  return (((value % 360) + 360) % 360) as RotationDegrees
}

export const useProjectStore = create<ProjectStore>((set, _get) => ({
  project: null,
  selectedClipId: null,
  scrubberTime: 0,
  isPlaying: false,
  zoom: 50,
  syncDialogClipId: null,
  waveformRevision: 0,

  setProject: (p) => set({ project: p }),

  updateClipOffset: (id, offset) => {
    set(state => {
      if (!state.project) return {}
      return {
        project: {
          ...state.project,
          clips: state.project.clips.map(c => c.id === id ? { ...c, timelineOffset: offset } : c),
        },
      }
    })
  },

  toggleClipVertical: (id) => {
    set(state => {
      if (!state.project) return {}
      const clips = state.project.clips.map(c =>
        c.id === id ? { ...c, vertical: !c.vertical } : c
      )
      const clip = clips.find(c => c.id === id)
      if (clip) persistClip(id, { vertical: clip.vertical })
      return { project: { ...state.project, clips } }
    })
  },

  rotateClip: (id, direction) => {
    set(state => {
      if (!state.project) return {}
      const delta = direction === 'cw' ? 90 : -90
      const clips = state.project.clips.map(c =>
        c.id === id ? { ...c, rotation: normalizeRotation((c.rotation ?? 0) + delta) } : c
      )
      const clip = clips.find(c => c.id === id)
      if (clip) persistClip(id, { rotation: clip.rotation })
      return { project: { ...state.project, clips } }
    })
  },

  toggleClipHidden: (id) => {
    set(state => {
      if (!state.project) return {}
      const clips = state.project.clips.map(c =>
        c.id === id ? { ...c, hidden: !c.hidden } : c
      )
      const clip = clips.find(c => c.id === id)
      if (clip) persistClip(id, { hidden: clip.hidden })
      return { project: { ...state.project, clips } }
    })
  },

  reorderClip: (id, direction) => {
    set(state => {
      if (!state.project) return {}
      // Sort by slot (with fallback for old clips without slot)
      const sorted = [...state.project.clips].sort(
        (a, b) => (a.slot ?? 0) - (b.slot ?? 0)
      )
      const idx = sorted.findIndex(c => c.id === id)
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= sorted.length) return {}

      // Swap slot values
      const slotA = sorted[idx].slot ?? idx
      const slotB = sorted[swapIdx].slot ?? swapIdx
      const updatedA = { ...sorted[idx], slot: slotB }
      const updatedB = { ...sorted[swapIdx], slot: slotA }

      persistClip(updatedA.id, { slot: updatedA.slot })
      persistClip(updatedB.id, { slot: updatedB.slot })

      const clips = state.project!.clips.map(c => {
        if (c.id === updatedA.id) return updatedA
        if (c.id === updatedB.id) return updatedB
        return c
      })
      return { project: { ...state.project!, clips } }
    })
  },

  swapClipSlots: (idA, idB) => {
    set(state => {
      if (!state.project) return {}
      const clipA = state.project.clips.find(c => c.id === idA)
      const clipB = state.project.clips.find(c => c.id === idB)
      if (!clipA || !clipB) return {}
      const slotA = clipA.slot ?? 0
      const slotB = clipB.slot ?? 0
      persistClip(idA, { slot: slotB })
      persistClip(idB, { slot: slotA })
      return {
        project: {
          ...state.project,
          clips: state.project.clips.map(c => {
            if (c.id === idA) return { ...c, slot: slotB }
            if (c.id === idB) return { ...c, slot: slotA }
            return c
          }),
        },
      }
    })
  },

  setSelectedClip: (id) => set({ selectedClipId: id }),
  setScrubberTime: (t) => set({ scrubberTime: t }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setZoom: (z) => set({ zoom: Math.max(10, Math.min(200, z)) }),
  openSyncDialog: (clipId) => set({ syncDialogClipId: clipId }),
  closeSyncDialog: () => set({ syncDialogClipId: null }),

  removeClip: (id) => {
    set(state => {
      if (!state.project) return {}
      return {
        project: {
          ...state.project,
          clips: state.project.clips.filter(c => c.id !== id),
        },
      }
    })
    fetch(`/api/clips/${id}`, { method: 'DELETE' })
  },

  bumpWaveformRevision: () => set(s => ({ waveformRevision: s.waveformRevision + 1 })),

  refetchProject: async () => {
    const res = await fetch('/api/project')
    const data = await res.json() as Project
    // Normalize legacy clips that predate slot/hidden fields
    const clips = data.clips.map((c, i) => ({
      ...c,
      slot: c.slot ?? i,
      hidden: c.hidden ?? false,
      rotation: c.rotation ?? 0,
    }))
    set({ project: { ...data, clips } })
  },
}))
