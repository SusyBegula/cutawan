import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { Clip, BrandingSettings } from '@shared/types'
import { probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { renderClip } from '../src/main/pipeline/render'

it.each(['fit-letterbox', 'fit-blur'] as const)('exports negative panel and watermark positions in %s', async mode => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-overlay-'))
  try {
    const path = join(dir, 'source.mp4'), imagePath = join(dir, 'logo.ppm')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=blue:size=320x180:rate=5:duration=1', '-c:v', 'mpeg4', path])
    await writeFile(imagePath, Buffer.concat([Buffer.from('P6\n10 10\n255\n'), Buffer.from(Array.from({ length: 300 }, (_, i) => i % 3 === 0 ? 255 : 0))]))
    const source = await probeVideo(path)
    const clip: Clip = { id: 'overlay', title: '', hook: '', focusTrack: null, broll: [],
      suggestedStart: 0, suggestedEnd: 1, summary: '', viralityScore: 0, viralityReason: '',
      visualSummary: null, hashtags: [], thumbnailPath: null,
      edit: { aspect: '9:16', framing: 'manual', reframeMode: mode, start: 0, end: 1, captionsEnabled: false,
        autoZoom: false, tightenCuts: false, showTitle: false, focusX: .5, captionStyleId: 'clean',
        watermarkTransform: { x: -.05, y: .1, scale: .2 },
        manualComposition: { version: 1, manual: true, preset: 'content-only', captionY: .83,
          layers: [{ role: 'content', source: { x: 0, y: 0, width: 1, height: 1 },
            target: { x: -.2, y: .4, width: .6, height: .4 } }] } } }
    const branding = { enabled: true, imagePath, opacity: 1, scale: .16, position: 'bottom-right' } as BrandingSettings
    const outputPath = join(dir, 'output.mp4')
    await renderClip({ clip, source, transcript: null, outputPath, branding, encoder: 'cpu', quality: 'draft' })
    const frame = join(dir, 'frame.rgb')
    await runFfmpeg(['-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', frame])
    const raw = await readFile(frame)
    const pixel = (x: number, y: number): number[] => [...raw.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)]
    expect(pixel(10, 220)[0]).toBeGreaterThan(200)
    expect(pixel(10, 220)[2]).toBeLessThan(30)
    expect(pixel(200, 220)[0]).toBeLessThan(30)
    expect(pixel(10, 1100)[2]).toBeGreaterThan(200)
    if (mode === 'fit-letterbox') expect(Math.max(...pixel(500, 1100))).toBeLessThan(10)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 20000)
