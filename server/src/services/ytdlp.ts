import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { once } from 'events'
import { basename, join, parse } from 'path'
import { createWriteStream, mkdirSync } from 'fs'
import { MEDIA_DIR } from './paths.js'

mkdirSync(MEDIA_DIR, { recursive: true })
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp'

export interface DownloadResult {
  filePath: string
  videoId: string
}

function isThreadsUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return /(^|\.)threads\.(net|com)$/.test(hostname)
  } catch {
    return false
  }
}

function isDirectMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()
    return pathname.endsWith('.mp4') || (
      hostname.endsWith('cdninstagram.com') && pathname.includes('/v/')
    )
  } catch {
    return false
  }
}

function mediaIdFromUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16)
}

function normalizeEscapedUrl(value: string): string {
  return value
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
}

function extractInstagramVideoUrl(html: string): string | null {
  const normalized = normalizeEscapedUrl(html)
  const matches = normalized.match(/https?:\/\/[^"'<>\\\s]+cdninstagram\.com\/[^"'<>\\\s]+?\.mp4(?:\?[^"'<>\\\s]+)?/g)
  return matches?.[0] ?? null
}

async function extractThreadsMediaUrl(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml',
    },
  })
  if (!res.ok) throw new Error(`Threads page request failed with ${res.status}`)
  return extractInstagramVideoUrl(await res.text())
}

async function downloadDirectMedia(
  url: string,
  onProgress: (percent: number, message: string) => void,
): Promise<DownloadResult> {
  const videoId = mediaIdFromUrl(url)
  const filePath = join(MEDIA_DIR, `${videoId}.mp4`)

  onProgress(0, 'Downloading direct media URL...')

  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
      'accept': 'video/mp4,video/*,*/*',
    },
  })
  if (!res.ok) throw new Error(`Direct media download failed with ${res.status}`)
  if (!res.body) throw new Error('Direct media download returned an empty response body')

  const total = Number(res.headers.get('content-length') ?? 0)
  let downloaded = 0
  const out = createWriteStream(filePath)

  try {
    for await (const chunk of res.body as any) {
      const buffer = Buffer.from(chunk)
      downloaded += buffer.length
      if (!out.write(buffer)) await once(out, 'drain')
      if (total > 0) {
        const percent = Math.min(99, (downloaded / total) * 100)
        onProgress(percent, `Downloading direct media: ${Math.round(percent)}%`)
      }
    }
  } finally {
    out.end()
  }

  await once(out, 'finish')
  onProgress(100, 'Direct media download complete')
  return { filePath, videoId }
}

async function downloadWithYtdlp(
  url: string,
  onProgress: (percent: number, message: string) => void,
): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-playlist',
      '--no-update',
      '--print', 'after_move:filepath',
      '--progress',
      '--newline',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', join(MEDIA_DIR, '%(id)s.%(ext)s'),
      url,
    ]

    const proc = spawn(YTDLP_BIN, args)
    let resolvedPath = ''
    const stderrLines: string[] = []

    proc.stdout.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()

      // Last line after --print is the final filepath
      if (line && !line.startsWith('[') && !line.includes('%')) {
        resolvedPath = line
        return
      }

      // Parse progress lines: "[download]  45.2% of ..."
      const pctMatch = line.match(/(\d+\.?\d*)%/)
      if (pctMatch) {
        onProgress(parseFloat(pctMatch[1]), line)
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim()
      if (!msg) return
      stderrLines.push(msg)
      console.error('[yt-dlp stderr]', msg)
      onProgress(0, msg)
    })

    proc.on('close', code => {
      if (code !== 0) {
        const detail = stderrLines.join('\n') || '(no stderr output)'
        console.error(`[yt-dlp] exited with code ${code}\n${detail}`)
        return reject(new Error(`yt-dlp exited with code ${code}:\n${detail}`))
      }
      if (!resolvedPath) return reject(new Error('yt-dlp did not output a file path'))
      const videoId = parse(basename(resolvedPath)).name || 'unknown'
      resolve({ filePath: resolvedPath, videoId })
    })

    proc.on('error', err => reject(new Error(`Failed to run ${YTDLP_BIN}: ${err.message}`)))
  })
}

export async function downloadVideo(
  url: string,
  onProgress: (percent: number, message: string) => void,
): Promise<DownloadResult> {
  if (isDirectMediaUrl(url)) {
    return downloadDirectMedia(url, onProgress)
  }

  if (isThreadsUrl(url)) {
    onProgress(0, 'Inspecting Threads page for embedded media...')
    const mediaUrl = await extractThreadsMediaUrl(url)
    if (!mediaUrl) {
      throw new Error(
        'Could not find a direct video file in this Threads page. Open the post in the browser developer tools and paste the cdninstagram.com .mp4 URL directly.'
      )
    }
    return downloadDirectMedia(mediaUrl, onProgress)
  }

  return downloadWithYtdlp(url, onProgress)
}
