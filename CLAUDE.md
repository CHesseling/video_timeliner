# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal local web app for reconstructing multi-perspective event videos. Users import clips from X, Bluesky, Threads etc., place them on a shared timeline, sync them, then render a composite output video that shows all active clips simultaneously in an auto-arranged grid.

## Commands

```bash
# Install all workspaces
npm install

# Dev (client on :5173, server on :3001 — Vite proxies /api to server)
npm run dev

# Type-check server only
npx tsc --project server/tsconfig.json --noEmit

# Type-check client only
npx tsc --project client/tsconfig.app.json --noEmit

# Build all
npm run build
```

## System dependencies

The server shells out to `ffmpeg`, `ffprobe`, and `yt-dlp`. They should usually be on `PATH`.

- macOS: `brew install ffmpeg yt-dlp`
- Windows: `winget install Gyan.FFmpeg yt-dlp.yt-dlp` or install both manually and add them to `PATH`
- Linux: install `ffmpeg` from the distro package manager and install `yt-dlp` via package manager or the official binary

Optional overrides when tools are not on `PATH`:

```bash
FFMPEG_PATH=/absolute/path/to/ffmpeg
FFPROBE_PATH=/absolute/path/to/ffprobe
YTDLP_PATH=/absolute/path/to/yt-dlp
VIDEO_TIMELINER_DATA_DIR=/absolute/path/to/app-data
```

## Architecture

**Monorepo** with three npm workspaces:

| Workspace | Purpose |
|---|---|
| `shared/` | TypeScript types shared between client and server (`Clip`, `Project`, `RenderProgress`, etc.) |
| `server/` | Express API on port 3001 |
| `client/` | React + Vite SPA on port 5173 |

**Server (`server/src/`)**
- `services/paths.ts` — stable server data paths; defaults to `server/data/`, overridable with `VIDEO_TIMELINER_DATA_DIR`
- `services/storage.ts` — `lowdb` JSON persistence at `<data>/project.json`; all reads/writes go through `getProject`, `addClip`, `updateClip`, `removeClip`
- `services/ffmpeg.ts` — video probe, thumbnail extraction, audio PCM extraction, per-segment render, segment concatenation
- `services/ytdlp.ts` — shells out to `yt-dlp`; media saved to `<data>/media/`; SSE progress parsing
- `services/audioSync.ts` — pure-JS FFT cross-correlation against two mono 16kHz PCM extracts; returns `{ offsetSeconds, confidence }`
- `routes/clips.ts` — import (POST SSE stream), update offset, delete
- `routes/sync.ts` — audio sync endpoint
- `routes/render.ts` — builds time segments from clip boundaries, renders each with FFmpeg filter_complex, concatenates; SSE progress stream

**Client (`client/src/`)**
- `store/useProjectStore.ts` — Zustand store; single source of truth for `project`, `scrubberTime`, `isPlaying`, `zoom`, `syncDialogClipId`
- `components/Timeline/` — custom CSS timeline; clips positioned by `timelineOffset × zoom`; drag updates offset optimistically then persists via PUT; Ctrl/Cmd+scroll to zoom
- `components/VideoGrid/` — one `<video>` per clip; at scrub time T, each video seeks to `T − clip.timelineOffset`; first clip audio on, rest muted
- `components/ImportPanel/` — SSE-driven download progress
- `components/SyncDialog/` — three sync tabs: manual offset input, visual cue (dual video players + mark), audio cross-correlation
- `components/RenderPanel/` — SSE-driven render progress + download link

## Key data model

```ts
interface Clip {
  id: string
  timelineOffset: number  // seconds from project t=0 — THE core field
  duration: number
  syncMethod: 'manual' | 'audio' | 'visual' | 'drag' | 'none'
  localPath: string       // absolute path on server
  filename: string        // used as /media/<filename> URL
  color: string           // hex, for timeline bar
}
```

## Render pipeline

The render route (`server/src/routes/render.ts`) computes time segment boundaries from all clip start/end points, renders each segment with `filter_complex` (hstack/vstack/xstack depending on clip count), then concatenates. Layouts: 1=full, 2=hstack, 3=big-left + 2-stacked-right, 4=2×2, 5+=xstack grid.
