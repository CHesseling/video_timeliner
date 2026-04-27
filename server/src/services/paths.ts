import { join } from 'path'

export const SERVER_ROOT = join(__dirname, '..', '..')
export const DATA_DIR = process.env.VIDEO_TIMELINER_DATA_DIR || join(SERVER_ROOT, 'data')
export const MEDIA_DIR = join(DATA_DIR, 'media')
export const OUTPUT_DIR = join(DATA_DIR, 'output')
export const WAVEFORM_DIR = join(DATA_DIR, 'waveforms')

