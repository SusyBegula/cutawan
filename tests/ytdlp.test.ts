import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadUrlVideo, fetchUrlMeta } from '../src/main/pipeline/ytdlp'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const url = 'https://www.youtube.com/watch?v=test'

function reply(data: object | string[], errorMessage?: string): void {
  vi.mocked(spawn).mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough()
    })
    queueMicrotask(() => {
      if (Array.isArray(data)) child.stdout.emit('data', Buffer.from(data.join('\n') + '\n'))
      else if (!errorMessage) child.stdout.emit('data', Buffer.from(JSON.stringify(data)))
      if (errorMessage) child.stderr.emit('data', Buffer.from(`ERROR: ${errorMessage}\n`))
      child.emit('close', errorMessage ? 1 : 0)
    })
    return child as unknown as ReturnType<typeof spawn>
  })
}

beforeEach(() => vi.resetAllMocks())

describe('URL metadata', () => {
  it('accepts a live YouTube video with no duration', async () => {
    reply({ id: 'test', title: 'Live', is_live: true, extractor_key: 'Youtube', webpage_url: url })
    await expect(fetchUrlMeta('yt-dlp', url)).resolves.toMatchObject({
      title: 'Live', durationSec: 0, liveSnapshot: true, webpageUrl: url
    })
  })

  it('detects live_status even when is_live is absent or a duration is advertised', async () => {
    reply({ live_status: 'is_live', duration: 300, extractor_key: 'Youtube' })
    await expect(fetchUrlMeta('yt-dlp', url)).resolves.toMatchObject({ liveSnapshot: true })
  })

  it('keeps normal videos and archived broadcasts on the regular download path', async () => {
    for (const live_status of ['not_live', 'was_live']) {
      reply({ duration: 120, live_status, extractor_key: 'Youtube' })
      await expect(fetchUrlMeta('yt-dlp', url)).resolves.toMatchObject({ durationSec: 120, liveSnapshot: false })
    }
  })

  it('rejects upcoming broadcasts with an actionable message', async () => {
    reply({ live_status: 'is_upcoming', extractor_key: 'Youtube' })
    await expect(fetchUrlMeta('yt-dlp', url)).rejects.toThrow('has not started yet')
  })

  it('does not start unbounded downloads for live streams on other sites', async () => {
    reply({ is_live: true, duration: 300, extractor_key: 'TwitchStream' })
    await expect(fetchUrlMeta('yt-dlp', url)).rejects.toThrow('YouTube only')
  })

  it('still rejects ordinary videos without a valid duration', async () => {
    for (const duration of [undefined, 0, -1]) {
      reply({ duration, extractor_key: 'Youtube' })
      await expect(fetchUrlMeta('yt-dlp', url)).rejects.toThrow('downloadable video')
    }
  })

  it('still chooses the main video from a multi-file item', async () => {
    reply({ _type: 'playlist', title: 'Archive', entries: [
      { duration: 4, url: 'https://example.com/preview.mp4' },
      { duration: 120, url: 'https://example.com/main.mp4' }
    ] })
    await expect(fetchUrlMeta('yt-dlp', url)).resolves.toMatchObject({
      durationSec: 120, webpageUrl: 'https://example.com/main.mp4', liveSnapshot: false
    })
  })
})

describe('URL downloads', () => {
  it('uses the finite snapshot plugin, rewind and strict missing-fragment handling for live imports', async () => {
    reply({})
    const progress = vi.fn()
    await downloadUrlVideo('yt-dlp', url, 'source.mp4', progress, { cookiesFromBrowser: 'firefox' }, true)
    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args).toContain('--live-from-start')
    expect(args).toContain('CutawanLiveSnapshot:when=before_dl')
    expect(args).toContain('--abort-on-unavailable-fragments')
    expect(args).toContain('firefox')
    expect(args.slice(args.indexOf('--concurrent-fragments'), args.indexOf('--concurrent-fragments') + 2))
      .toEqual(['--concurrent-fragments', '32'])
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('rewind') }))
  })

  it('does not enable the snapshot plugin for ordinary downloads', async () => {
    reply({})
    await downloadUrlVideo('yt-dlp', url, 'source.mp4', vi.fn())
    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args).not.toContain('--live-from-start')
    expect(args).not.toContain('--use-postprocessor')
    expect(args[args.indexOf('--postprocessor-args') + 1]).toContain('Merger+ffmpeg_o:-movflags -faststart -progress')
  })

  it('explains when YouTube does not expose rewindable formats', async () => {
    reply({}, '--live-from-start is passed, but there are no formats that can be downloaded from the start.')
    await expect(downloadUrlVideo('yt-dlp', url, 'source.mp4', vi.fn(), {}, true))
      .rejects.toThrow('Enable DVR')
  })

  it('preserves unrelated download errors', async () => {
    reply({}, 'Network connection failed')
    await expect(downloadUrlVideo('yt-dlp', url, 'source.mp4', vi.fn(), {}, true))
      .rejects.toThrow('Network connection failed')
  })

  it('shows combined download speed while tracking the slower video', async () => {
    reply([
      '1: CUTAWAN_PROGRESS 299 downloading 1000000 NA NA 12000000 10 100',
      '2: CUTAWAN_PROGRESS 140 downloading 100000 NA NA 1000000 90 100',
      '2: CUTAWAN_PROGRESS 140 finished 100000 100000 NA NA NA NA'
    ])
    const progress = vi.fn()
    await downloadUrlVideo('yt-dlp', url, 'source.mp4', progress, {}, true)
    expect(progress).toHaveBeenCalledWith({ progress: 0.15 + 0.1 * 0.8,
      message: 'Downloading livestream snapshot… 13.0 MB/s (104 Mbps)' })
    expect(progress).toHaveBeenLastCalledWith({ progress: 0.15 + 0.1 * 0.8,
      message: 'Downloading livestream snapshot… 12.0 MB/s (96 Mbps)' })
  })

  it('handles missing speed and unknown sizes without displaying invalid numbers', async () => {
    reply(['CUTAWAN_PROGRESS 299 downloading 1024 NA NA NA NA NA'])
    const progress = vi.fn()
    await downloadUrlVideo('yt-dlp', url, 'source.mp4', progress)
    expect(progress).toHaveBeenLastCalledWith({ progress: -1, message: 'Downloading video…' })
  })

  it('uses byte progress for direct video downloads', async () => {
    reply(['CUTAWAN_PROGRESS mp4 downloading 2000000 4000000 NA 1000000 NA NA'])
    const progress = vi.fn()
    await downloadUrlVideo('yt-dlp', url, 'source.mp4', progress)
    expect(progress).toHaveBeenLastCalledWith({ progress: 0.55, message: 'Downloading video… 1.0 MB/s (8 Mbps)' })
  })

  it('keeps merging indeterminate until real progress arrives and only completes on success', async () => {
    reply(['[CutawanLiveSnapshot] CUTAWAN_SNAPSHOT_DURATION 120', '[Merger] Merging formats'])
    const progress = vi.fn()
    await downloadUrlVideo('yt-dlp', url, 'source.mp4', progress, {}, true)
    expect(progress).toHaveBeenCalledWith({ progress: 0.95, phaseProgress: -1,
      message: 'Preparing stream merge… reading source files' })
    expect(progress).toHaveBeenLastCalledWith({ progress: 0.99, phaseProgress: 1, message: 'Audio and video merged' })
  })

  it('does not report successful completion when the merger fails', async () => {
    reply(['[Merger] Merging formats'], 'Merge failed')
    const progress = vi.fn()
    await expect(downloadUrlVideo('yt-dlp', url, 'source.mp4', progress)).rejects.toThrow('Merge failed')
    expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ phaseProgress: 1 }))
  })
})
