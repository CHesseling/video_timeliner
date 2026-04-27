export type SyncMethod = 'manual' | 'audio' | 'visual' | 'drag' | 'none'
export type RotationDegrees = 0 | 90 | 180 | 270

export interface Clip {
  id: string
  sourceUrl: string
  localPath: string
  filename: string
  duration: number        // seconds
  timelineOffset: number  // seconds from project t=0
  syncMethod: SyncMethod
  thumbnail: string       // path to extracted frame (served by server)
  color: string           // hex color for timeline bar
  slot: number            // grid position (0 = main/largest)
  hidden: boolean         // excluded from preview and render
  vertical: boolean       // portrait (9:16) — crop/zoom fill in preview and render
  rotation: RotationDegrees // clockwise display/render rotation
  hasAudio: boolean       // false for video-only clips
}

export interface Project {
  id: string
  name: string
  eventStartTime?: string // ISO datetime string, optional reference for manual sync
  clips: Clip[]
  outputPath?: string
}

export interface RenderProgress {
  type: 'progress' | 'done' | 'error'
  segment?: number
  totalSegments?: number
  message?: string
  outputPath?: string
}

export interface ImportProgress {
  type: 'progress' | 'done' | 'error'
  percent?: number
  message?: string
  clipId?: string
}

export interface AudioSyncResult {
  offsetSeconds: number
  confidence: number  // 0-1
}
