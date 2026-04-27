import { LowSync } from 'lowdb'
import { JSONFileSync } from 'lowdb/node'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type { Project } from '@video-timeliner/shared'
import { DATA_DIR } from './paths.js'

mkdirSync(DATA_DIR, { recursive: true })

interface DbSchema {
  project: Project
}

const defaultProject: Project = {
  id: 'default',
  name: 'My Project',
  clips: [],
}

const adapter = new JSONFileSync<DbSchema>(join(DATA_DIR, 'project.json'))
const db = new LowSync<DbSchema>(adapter, { project: defaultProject })
db.read()

export function getProject(): Project {
  const p = db.data.project
  // Normalize legacy clips missing fields added after initial import
  p.clips = p.clips.map((c, i) => ({
    ...c,
    slot: c.slot ?? i,
    hidden: c.hidden ?? false,
    vertical: c.vertical ?? false,
    rotation: c.rotation ?? 0,
    hasAudio: c.hasAudio ?? true,
  }))
  return p
}

export function saveProject(project: Project): void {
  db.data.project = project
  db.write()
}

export function updateClip(clipId: string, updates: Partial<Project['clips'][0]>): void {
  const clip = db.data.project.clips.find(c => c.id === clipId)
  if (!clip) throw new Error(`Clip ${clipId} not found`)
  Object.assign(clip, updates)
  db.write()
}

export function addClip(clip: Project['clips'][0]): void {
  db.data.project.clips.push(clip)
  db.write()
}

export function removeClip(clipId: string): void {
  db.data.project.clips = db.data.project.clips.filter(c => c.id !== clipId)
  db.write()
}
