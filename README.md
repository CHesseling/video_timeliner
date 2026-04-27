# Video Timeliner

Local web app for importing social video clips, aligning them on a shared timeline, and rendering a synchronized multi-clip output video.

## Requirements

- Node.js 20+
- `ffmpeg` and `ffprobe`
- `yt-dlp`

Install examples:

- macOS: `brew install ffmpeg yt-dlp`
- Windows: `winget install Gyan.FFmpeg yt-dlp.yt-dlp`
- Linux: install `ffmpeg` via your distro package manager and install `yt-dlp` via package manager or the official binary.

If the tools are not on `PATH`, set `FFMPEG_PATH`, `FFPROBE_PATH`, and `YTDLP_PATH`.

## Development

```bash
npm install
npm run dev
```

Client: `http://localhost:5173`
Server: `http://localhost:3001`

Local project data, imported media, waveform caches, and render output are stored in `server/data/` by default. Override with `VIDEO_TIMELINER_DATA_DIR` if needed.
