import { open, rm } from 'node:fs/promises'
import type { ImportProgress } from '@shared/types'

export interface MergeStatus {
  seconds: number
  speed?: number
  bytes?: number
  finished: boolean
}

function nonNegative(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

/** Only consume complete FFmpeg reports; file reads can split a report. */
export function parseMergeProgress(text: string): MergeStatus | undefined {
  const reports = [...text.matchAll(/(?:^|\n)progress=(continue|end)\r?(?:\n|$)/g)]
  const last = reports.at(-1)
  if (!last) return undefined
  const previous = reports.at(-2)
  const start = previous ? previous.index! + previous[0].length : 0
  const block = text.slice(start, last.index)
  const values = new Map(block.split(/\r?\n/).map(line => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1).trim()]
  }))
  // FFmpeg calls both out_time_us and legacy out_time_ms microseconds.
  const microseconds = nonNegative(values.get('out_time_us')) ?? nonNegative(values.get('out_time_ms'))
  const timestamp = values.get('out_time')?.match(/^(\d+):(\d+):([\d.]+)$/)
  const seconds = microseconds !== undefined ? microseconds / 1e6
    : timestamp ? Number(timestamp[1]) * 3600 + Number(timestamp[2]) * 60 + Number(timestamp[3]) : 0
  return { seconds: Number.isFinite(seconds) ? seconds : 0,
    speed: nonNegative(values.get('speed')?.replace(/x$/, '')),
    bytes: nonNegative(values.get('total_size')), finished: last[1] === 'end' }
}

function timestamp(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
    .map(part => String(part).padStart(2, '0')).join(':')
}

export function mergeProgressMessage(status: MergeStatus, durationSec: number): ImportProgress {
  const fraction = status.finished ? 1 : durationSec > 0 ? Math.min(0.995, status.seconds / durationSec) : undefined
  const percentage = fraction === undefined ? '' : ` ${Math.floor(fraction * 100)}%`
  const duration = durationSec > 0 ? ` / ${timestamp(durationSec)}` : ''
  const speed = status.speed ? ` · ${status.speed.toFixed(1)}× realtime` : ''
  const remaining = !status.finished && durationSec > status.seconds && status.speed
    ? ` · ~${timestamp((durationSec - status.seconds) / status.speed)} remaining` : ''
  return {
    progress: fraction === undefined ? -1 : 0.95 + fraction * 0.04,
    phaseProgress: fraction ?? -1,
    message: `Merging audio/video…${percentage} · ${timestamp(status.seconds)}${duration}${speed}${remaining}`
  }
}

/** Python uses shlex to split --postprocessor-args, including on Windows. */
export function mergerArgs(progressPath: string): string {
  const quoted = `'${progressPath.replace(/'/g, `'"'"'`)}'`
  // These are local editing sources. Skipping faststart avoids a second pass
  // moving the entire MP4's index to the front; stream copy keeps full quality.
  return `Merger+ffmpeg_o:-movflags -faststart -progress ${quoted} -nostats -stats_period 0.5`
}

async function readTail(path: string): Promise<string> {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const length = Math.min(size, 16384)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, size - length)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await file.close()
  }
}

export function createMergeReporter(path: string, onProgress: (progress: ImportProgress) => void,
  initialDurationSec = 0): {
    start: () => void
    setDuration: (seconds: number) => void
    finish: () => Promise<void>
    stop: () => Promise<void>
  } {
  let duration = initialDurationSec
  let timer: ReturnType<typeof setInterval> | undefined
  let pending: Promise<void> | undefined
  let startedAt = 0
  let lastHeartbeat = 0
  let lastReport = ''
  let haveProgress = false
  const preparing = (): void => {
    if (!haveProgress && Date.now() - lastHeartbeat >= 5000) {
      lastHeartbeat = Date.now()
      onProgress({ progress: 0.95, phaseProgress: -1,
        message: `Preparing stream merge… ${timestamp((Date.now() - startedAt) / 1000)} elapsed · reading source files` })
    }
  }
  const poll = async (): Promise<void> => {
    try {
      const text = await readTail(path)
      if (text === lastReport) { preparing(); return }
      const status = parseMergeProgress(text)
      if (status) {
        lastReport = text
        haveProgress = true
        onProgress(mergeProgressMessage(status, duration))
      } else preparing()
    } catch {
      // FFmpeg opens its progress file only after inspecting both inputs.
      preparing()
    }
  }
  return {
    start: () => {
      if (timer) return
      startedAt = lastHeartbeat = Date.now()
      onProgress({ progress: 0.95, phaseProgress: -1, message: 'Preparing stream merge… reading source files' })
      timer = setInterval(() => {
        if (pending) return
        pending = poll().finally(() => { pending = undefined })
      }, 500)
      timer.unref()
    },
    setDuration: seconds => { if (Number.isFinite(seconds) && seconds > 0) duration = seconds },
    finish: async () => {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
      await pending
      await poll()
      onProgress({ progress: 0.99, phaseProgress: 1, message: 'Audio and video merged' })
    },
    stop: async () => {
      if (timer) clearInterval(timer)
      timer = undefined
      await pending
      await rm(path, { force: true }).catch(() => { /* Never hide the import result with log cleanup. */ })
    }
  }
}
