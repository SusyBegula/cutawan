import { describe, expect, it } from 'vitest'
import type { Clip, ContentRegion } from '@shared/types'
import { compositionPixels, presenterComposition, usefulComposition, validComposition } from '@shared/composition'
import { automaticLayoutShots, compositionHidesTitle, detailCaptionRanges, layoutReviewMessage, layoutShotAt, protectLayoutRanges, validLayoutShots } from '@shared/contentType'
import { mergeClipSave, mergeReframeResult, userClipEdit } from '@shared/reframe'

const content = { x: .2, y: .3, width: .6, height: .6 }
const presenter = { x: .82, y: .02, width: .16, height: .26 }
const clip = (): Clip => ({ edit: { start: 10, end: 20, aspect: '9:16', reframeMode: 'crop', framing: 'auto' },
  visualLayout: { start: 10, end: 20, preserveContext: true, allowZoom: false, reason: 'screen',
    shots: [{ start: 10, end: 20, mode: 'fit', composition: presenterComposition(content, presenter),
      review: { status: 'checked', reason: 'Readable samples' } }] } }) as Clip

describe('manual output arrangements and fixed regions', () => {
  it('clips manual output at negative coordinates without clamping or shrinking its source crop', () => {
    const c = presenterComposition(content, presenter)!
    c.manual = true
    c.layers[0].target = { x: -.2, y: -.1, width: 1.4, height: 1.2 }
    expect(validComposition(c)).toBe(true)
    const pixels = compositionPixels(c, { width: 1280, height: 720 }, 1080, 1920)
    expect(pixels[0].target.x).toBeLessThan(0)
    expect(pixels[0].target.width).toBeGreaterThan(1080)
    c.layers[0].source = { ...c.layers[0].source, x: -.1 }
    expect(validComposition(c)).toBe(false)
  })
  it.each(['fit-letterbox', 'fit-blur'] as const)('uses fixed regions with manual framing in %s', mode => {
    const current = clip()
    current.edit.reframeMode = mode
    current.edit.framing = 'manual'
    expect(automaticLayoutShots(current)).toEqual([])
    current.edit.manualComposition = presenterComposition(content, presenter)!
    expect(automaticLayoutShots(current)[0].composition).toEqual(current.edit.manualComposition)
    current.edit.manualComposition = undefined
    current.edit.layoutChosen = true
    current.visualLayout!.revision = 1
    expect(automaticLayoutShots(current)[0].composition).toEqual(current.visualLayout!.shots![0].composition)
  })
  it('allows user panels to overlap within the output frame', () => {
    const composition = presenterComposition(content, presenter)!
    composition.manual = true
    composition.layers[0].target = { x: 0, y: 0, width: 1, height: 1 }
    expect(validComposition(composition)).toBe(true)
    composition.layers[1].target.x = 2.1
    expect(validComposition(composition)).toBe(false)
  })
  it('retains fixed crops and targets across scene changes, trim and JSON persistence', () => {
    const current = clip()
    const composition = presenterComposition(content, presenter)!
    composition.manual = true
    current.edit.manualComposition = composition
    current.edit.start = 5
    current.edit.end = 35
    current.edit.compositionPreference = 'stacked'
    const restored: Clip = JSON.parse(JSON.stringify(current))
    expect(automaticLayoutShots(restored)).toEqual([{ start: 5, end: 35, mode: 'fit', composition }])
    expect(layoutShotAt(restored, 30)?.composition).toEqual(composition)
    expect(compositionPixels(automaticLayoutShots(restored)[0].composition!, { width: 1920, height: 1080 }, 1080, 1920))
      .toEqual(compositionPixels(composition, { width: 1920, height: 1080 }, 1080, 1920))
  })
  it('keeps the fixed arrangement when asynchronous analysis returns', () => {
    const current = clip()
    current.edit.manualComposition = presenterComposition(content, presenter)!
    const analysed = clip()
    analysed.edit.framing = 'manual'
    analysed.edit.reframeMode = 'fit-letterbox'
    const merged = mergeReframeResult(current, analysed, 'auto', true)
    expect(merged.edit).toEqual(current.edit)
    expect(automaticLayoutShots(merged)[0].composition).toEqual(current.edit.manualComposition)
  })
  it('leaves a fixed layout inactive in other output aspect ratios', () => {
    const current = clip()
    current.edit.manualComposition = presenterComposition(content, presenter)!
    current.edit.aspect = '16:9'
    expect(automaticLayoutShots(current).every(shot => !shot.composition)).toBe(true)
  })
})

describe('independent presenter/content composition', () => {
  it.each([[.02, .02], [.82, .02], [.02, .72], [.82, .72]])('handles an inset at %s,%s without moving the destination', (x, y) => {
    const result = presenterComposition(content, { ...presenter, x, y })!
    expect(validComposition(result)).toBe(true)
    expect(result.layers[1].target).toEqual(presenterComposition(content, presenter)!.layers[1].target)
    expect(usefulComposition(result, { width: 1920, height: 1080 })).toBe(true)
  })

  it('rejects invalid regions, source duplication and caption collisions', () => {
    expect(presenterComposition(content, { ...presenter, x: NaN })).toBeUndefined()
    expect(presenterComposition(content, { ...presenter, width: 1 })).toBeUndefined()
    expect(presenterComposition(content, content)).toBeUndefined()
    const c = presenterComposition(content, presenter)!
    c.layers[0].target.y = .7
    expect(validComposition(c)).toBe(false)
    expect(validComposition({ ...c, layers: null } as never)).toBe(false)
  })

  it('rejects upscaling a tiny presenter and content with no useful enlargement', () => {
    const c = presenterComposition(content, presenter)!
    expect(usefulComposition(c, { width: 320, height: 180 })).toBe(false)
    const broad = presenterComposition({ x: .02, y: .3, width: .96, height: .6 }, presenter)!
    expect(usefulComposition(broad, { width: 1920, height: 1080 })).toBe(false)
  })

  it('fits even-pixel rectangles inside disjoint destinations and keeps their aspect ratio', () => {
    const c = presenterComposition(content, presenter)!
    for (const size of [{ width: 1920, height: 1080 }, { width: 641, height: 361 }]) {
      for (const p of compositionPixels(c, size, 1080, 1920)) {
        expect(Object.values(p.source).every(n => n % 2 === 0)).toBe(true)
        expect(Object.values(p.target).every(n => n % 2 === 0)).toBe(true)
        expect(p.target.x + p.target.width).toBeLessThanOrEqual(1080)
        expect(p.target.y + p.target.height).toBeLessThan(1920 * .76)
        expect(Math.abs(p.target.width / p.target.height - p.source.width / p.source.height)).toBeLessThan(.03)
      }
    }
  })

  it('preserves composites across face-detail guards, trim and layout changes', () => {
    const c = clip()
    expect(validLayoutShots(c.visualLayout, 12, 18)).toBe(true)
    expect(protectLayoutRanges(c.visualLayout, 10, 20, [{ start: 13, end: 15 }])?.shots?.every(s => s.composition)).toBe(true)
    expect(detailCaptionRanges(c)).toEqual([{ start: 10, end: 20, positionY: .83 }])
    expect(compositionHidesTitle(c)).toBe(true)
    c.edit.compositionPreference = 'stacked'
    expect(automaticLayoutShots(c)[0].composition?.preset).toBe('stacked')
    expect(automaticLayoutShots(c)[0].review?.status).toBe('needs-review')
    c.edit.compositionPreference = 'content-only'
    expect(automaticLayoutShots(c)[0].composition?.layers).toHaveLength(1)
    c.edit.aspect = '1:1'
    expect(automaticLayoutShots(c)[0].composition).toBeUndefined()
    c.edit.framing = 'manual'
    expect(automaticLayoutShots(c)).toEqual([])
    expect(compositionHidesTitle(c)).toBe(false)
  })

  it('preserves a manual region correction across save and late background analysis', () => {
    const saved = clip(), manual = clip()
    manual.visualLayout!.revision = 1
    const source: ContentRegion = { ...content, y: .25 }
    manual.visualLayout!.shots![0].composition = presenterComposition(source, presenter)
    expect(mergeClipSave(manual, saved, 'auto').visualLayout).toEqual(manual.visualLayout)
    expect(mergeReframeResult(manual, saved, 'auto').visualLayout).toEqual(manual.visualLayout)
    expect(mergeClipSave(saved, manual, 'auto').visualLayout).toEqual(manual.visualLayout)
  })

  it('selects the final visible shot at the trim end, including trims on an internal cut', () => {
    const c = clip()
    const first = { ...c.visualLayout!.shots![0], end: 15 }
    const last = { ...first, start: 15, end: 20 }
    c.visualLayout!.shots = [first, last]
    expect(layoutShotAt(c, 20)).toBe(last)
    expect(layoutShotAt(c, 15)).toBe(last)
    c.edit.end = 15
    expect(layoutShotAt(c, 15)).toBe(first)
    expect(layoutShotAt(c, 20)).toBe(first)
  })

  it('keeps the full scene when a manual composition no longer covers an extended trim', () => {
    const manual = clip(), analysed = clip()
    manual.visualLayout!.revision = 1
    manual.edit.end = 25
    analysed.edit.end = 25
    analysed.reframeAnalysis = { start: 10, end: 25, version: 1 }
    analysed.visualLayout!.end = 25
    analysed.visualLayout!.shots![0].end = 25
    const merged = mergeReframeResult(manual, analysed, 'auto')
    expect(merged.visualLayout).toBe(manual.visualLayout)
    expect(automaticLayoutShots(merged)).toEqual([{ start: 10, end: 25, mode: 'fit',
      review: expect.objectContaining({ status: 'needs-review' }) }])
    expect(layoutReviewMessage(merged)).toContain('full source retained')
    merged.edit.end = 19
    expect(automaticLayoutShots(merged)[0].composition).toBeDefined()
  })
})

it('applies an upgraded composition to the old generated letterbox defaults', () => {
  const current = clip(), analysed = clip()
  current.visualLayout!.shots = [{ start: 10, end: 20, mode: 'fit' }]
  current.reframeAnalysis = { start: 10, end: 20, version: 1 }
  Object.assign(current.edit, { reframeMode: 'fit-letterbox', framing: 'manual', focusX: .5, autoZoom: false })
  analysed.reframeAnalysis = { start: 10, end: 20, version: 2 }
  const merged = mergeReframeResult(current, analysed, 'auto')
  expect(merged.edit.reframeMode).toBe('crop')
  expect(merged.edit.framing).toBe('auto')
  expect(automaticLayoutShots(merged)[0].composition).toBeDefined()
  const staleSave = mergeClipSave({ ...current, title: 'New title' }, analysed, 'auto')
  expect(staleSave.edit.framing).toBe('auto')
  expect(staleSave.title).toBe('New title')
})


it('never treats a pending webinar letterbox choice as a completed legacy upgrade', () => {
  const pending = clip(), analysed = clip()
  pending.reframeStatus = 'pending'
  pending.visualLayout!.shots = undefined
  Object.assign(pending.edit, { reframeMode: 'fit-letterbox', framing: 'manual', focusX: .5, autoZoom: false })
  analysed.reframeAnalysis = { start: 10, end: 20, version: 2 }
  expect(mergeReframeResult(pending, analysed, 'webinar').edit.reframeMode).toBe('fit-letterbox')
  pending.reframeStatus = 'done'
  pending.reframeAnalysis = { start: 10, end: 20, version: 1 }
  // Even choosing the same value during an old clip's upgrade records intent.
  pending.edit = userClipEdit(pending.edit, { reframeMode: 'fit-letterbox' })
  expect(mergeReframeResult(pending, analysed, 'webinar').edit.reframeMode).toBe('fit-letterbox')
  expect(mergeClipSave(pending, analysed, 'webinar').edit.reframeMode).toBe('fit-letterbox')
})
