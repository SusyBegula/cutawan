import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMergeReporter, mergerArgs, mergeProgressMessage, parseMergeProgress } from '../src/main/pipeline/mergeProgress'

afterEach(() => vi.useRealTimers())

describe('FFmpeg merge reports', () => {
  it('ignores an incomplete trailing report and reads the last complete one', () => {
    expect(parseMergeProgress('out_time_us=2500000\nspeed=20.5x\ntotal_size=5000\nprogress=continue\nout_time_us=9999999\n'))
      .toEqual({ seconds: 2.5, speed: 20.5, bytes: 5000, finished: false })
  })

  it('handles Windows line endings, legacy microseconds and the final report', () => {
    expect(parseMergeProgress('out_time_ms=3000000\r\nspeed=N/A\r\nprogress=end\r\n'))
      .toEqual({ seconds: 3, speed: undefined, bytes: undefined, finished: true })
  })

  it('uses timestamps when numeric time is unavailable', () => {
    expect(parseMergeProgress('out_time=01:02:03.500\nspeed=2x\nprogress=continue\n')?.seconds).toBe(3723.5)
    expect(parseMergeProgress('out_time_us=-1\nspeed=N/A\nprogress=continue\n')?.seconds).toBe(0)
    expect(parseMergeProgress('out_time_us=1000000\n')).toBeUndefined()
  })

  it('shows phase percentage, processing speed and remaining time', () => {
    expect(mergeProgressMessage({ seconds: 120, speed: 4, finished: false }, 240)).toEqual({
      progress: 0.97, phaseProgress: 0.5,
      message: 'Merging audio/video… 50% · 00:02:00 / 00:04:00 · 4.0× realtime · ~00:00:30 remaining'
    })
  })

  it('keeps progress below completion until FFmpeg finishes', () => {
    expect(mergeProgressMessage({ seconds: 241, finished: false }, 240).phaseProgress).toBeLessThan(1)
    expect(mergeProgressMessage({ seconds: 241, finished: true }, 240).phaseProgress).toBe(1)
  })

  it('does not invent a percentage or ETA for unknown duration', () => {
    expect(mergeProgressMessage({ seconds: 15, finished: false }, 0)).toEqual({
      progress: -1, phaseProgress: -1, message: 'Merging audio/video… · 00:00:15'
    })
  })

  it('overrides faststart only for the merger and quotes progress paths for shlex', () => {
    const args = mergerArgs("C:\\User's videos\\merge.progress")
    expect(args).toContain('Merger+ffmpeg_o:-movflags -faststart')
    expect(args).toContain(`'C:\\User'"'"'s videos\\merge.progress'`)
    expect(args).toContain('-nostats -stats_period 0.5')
  })
})

it('reports elapsed preparation, reads progress, then cleans up its log', async () => {
  vi.useFakeTimers()
  const root = await mkdtemp(join(tmpdir(), 'cutawan-merge-progress-'))
  const path = join(root, 'merge.progress')
  const progress = vi.fn()
  const reporter = createMergeReporter(path, progress)
  reporter.start()
  reporter.setDuration(10)
  await vi.advanceTimersByTimeAsync(5500)
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phaseProgress: -1 }))
  await writeFile(path, 'out_time_us=5000000\nspeed=2x\nprogress=continue\n')
  // finish performs a final awaited read even if the polling read is pending.
  await reporter.finish()
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phaseProgress: 0.5 }))
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phaseProgress: 1 }))
  await reporter.stop()
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
})
