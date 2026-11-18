import { useEffect, useRef, useState } from 'react'
import type { Clip, Composition, ContentRegion } from '@shared/types'
import { isPresenterComposition, presenterComposition } from '@shared/composition'
import { compositionHidesTitle, layoutReviewMessage, layoutShotAt, validLayoutShots } from '@shared/contentType'
import { usePreviewBus } from '../lib/previewBus'
import { useStore } from '../store'
import ManualLayoutEditor from './ManualLayoutEditor'

const preferences = [
  ['auto', 'Automatic'], ['content-first', 'Content first'], ['stacked', 'Stacked'], ['content-only', 'Content only']
] as const
const startingRegions = presenterComposition({ x: .05, y: .35, width: .75, height: .6 },
  { x: .82, y: .02, width: .16, height: .28 })!

export default function CompositionControls({ clip }: { clip: Clip }): React.JSX.Element | null {
  const [adding, setAdding] = useState(false)
  // Subscribe to the stable scalar. Fixed layouts create a derived shot;
  // returning that fresh object from a Zustand selector loops React renders.
  const time = usePreviewBus(s => s.time)
  const shot = layoutShotAt(clip, time)
  const update = useStore(s => s.updateClip)
  const retry = useStore(s => s.ensureReframe)
  const busy = useStore(s => s.reframeBusy[clip.id])
  const error = useStore(s => s.reframeError[clip.id])
  const hasComposition = isPresenterComposition(clip.edit.manualComposition) || clip.visualLayout?.shots?.some(s => isPresenterComposition(s.composition))
  const hasSplits = clip.visualLayout?.shots?.some(s => s.composition?.preset === 'speakers')
  const splitsOn = clip.edit.speakerSplit !== false
  const issue = layoutReviewMessage(clip)
  const active = clip.edit.aspect === '9:16' && (clip.edit.reframeMode === 'fit-letterbox' || clip.edit.reframeMode === 'fit-blur' ||
    (clip.edit.framing === 'auto' && clip.edit.reframeMode === 'crop'))
  const saveRegions = (composition: Composition, lock = false): void => {
    const layout = clip.visualLayout
    const existing = validLayoutShots(layout, clip.edit.start, clip.edit.end)
    const replacement = { start: shot?.start ?? clip.edit.start, end: shot?.end ?? clip.edit.end, mode: 'fit' as const,
      composition, review: { status: 'needs-review' as const, reason: 'Source regions adjusted manually; review this shot before exporting.' } }
    void update({ ...clip, edit: { ...clip.edit, layoutChosen: true, compositionPreference: 'auto',
      manualComposition: lock ? composition : undefined, framing: 'auto',
      reframeMode: clip.edit.reframeMode === 'crop' ? 'crop' : clip.edit.reframeMode, autoZoom: false },
      visualLayout: { start: existing ? layout!.start : clip.edit.start, end: existing ? layout!.end : clip.edit.end,
        preserveContext: true, allowZoom: false, reason: 'Manually selected source regions.', revision: (layout?.revision ?? 0) + 1,
        shots: lock || clip.edit.manualComposition ? [{ ...replacement, start: clip.edit.start, end: clip.edit.end }]
          : existing && shot ? layout!.shots!.map(s => s.start === shot.start && s.end === shot.end ? replacement : s)
          : [{ ...replacement, start: clip.edit.start, end: clip.edit.end }] } })
    setAdding(false)
  }
  return <div className="mt-3 space-y-2">
    {issue && <p className="text-xs text-amber-300">Review layout: {issue}</p>}
    {issue && !clip.edit.layoutChosen && !clip.visualLayout?.revision && <div className="space-y-1">
      <button type="button" disabled={busy} onClick={() => void retry(clip.id, true)}
        className="text-xs text-zinc-300 underline underline-offset-4 disabled:opacity-40">
        {busy ? 'Retrying layout…' : 'Retry automatic layout'}
      </button>
      <p className="text-[11px] text-zinc-500">Reviews this clip using your configured AI provider. Keeps the transcript and clip selection.</p>
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    </div>}
    {hasSplits && clip.edit.aspect === '9:16' && <div className="space-y-1">
      <button type="button" aria-pressed={splitsOn}
        onClick={() => void update({ ...clip, edit: { ...clip.edit, speakerSplit: !splitsOn } })}
        className={`w-full rounded-lg border px-2 py-2 text-xs transition ${splitsOn ? 'border-white/30 bg-white/[0.07] text-zinc-100' : 'border-surface-600 text-zinc-400 hover:bg-surface-800'}`}>
        Split screen during conversations: {splitsOn ? 'on' : 'off'}
      </button>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Stacks both people while they trade quick turns in the same shot. Off follows whoever is speaking.
      </p>
    </div>}
    {hasComposition && <>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Presenter and content layout">
        {preferences.map(([value, label]) => <button key={value} type="button"
          aria-pressed={active && (clip.edit.compositionPreference ?? 'auto') === value}
          disabled={clip.edit.aspect !== '9:16'}
          onClick={() => {
            const layout = clip.visualLayout
            const shots = layout?.shots?.map(s => {
              if (!s.composition?.manual) return s
              const content = s.composition.layers.find(layer => layer.role === 'content')
              const presenter = s.composition.layers.find(layer => layer.role === 'presenter')
              return content && presenter ? { ...s, composition: presenterComposition(content.source, presenter.source,
                value === 'auto' ? 'content-first' : value) } : s
            })
            void update({ ...clip, visualLayout: layout ? { ...layout, shots } : layout,
              edit: { ...clip.edit, manualComposition: undefined, layoutChosen: true, compositionPreference: value, framing: 'auto',
                reframeMode: clip.edit.reframeMode === 'crop' ? 'crop' : clip.edit.reframeMode, autoZoom: false } })
          }}
          className={`rounded-lg border px-2 py-2 text-xs transition disabled:opacity-40 ${active && (clip.edit.compositionPreference ?? 'auto') === value ? 'border-white/30 bg-white/[0.07] text-zinc-100' : 'border-surface-600 text-zinc-400 hover:bg-surface-800'}`}>
          {label}
        </button>)}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        {clip.edit.aspect !== '9:16' ? 'Presenter layouts are available in 9:16. Other formats keep the full scene.' :
          'Separate crops from the original video. Automatic layouts are checked on sampled frames; review motion before exporting.'}
      </p>
      {compositionHidesTitle(clip) && clip.edit.showTitle && <p className="text-[11px] text-zinc-500">The hook title is hidden to keep the presenter clear.</p>}
      {active && isPresenterComposition(shot?.composition) && <RegionForm key={`${shot!.start}:${JSON.stringify(shot!.composition)}:${!!clip.edit.manualComposition}`}
        composition={shot!.composition!} locked={!!clip.edit.manualComposition} onSave={saveRegions} />}
      {active && shot?.composition && isPresenterComposition(shot.composition) && <ManualLayoutEditor
        key={`${JSON.stringify(shot.composition)}:${!!clip.edit.manualComposition}`} clipId={clip.id}
        captionPosition={clip.edit.captionPosition}
        blurBackground={clip.edit.reframeMode === 'fit-blur'} composition={shot.composition} locked={!!clip.edit.manualComposition} onSave={saveRegions} />}
      {clip.edit.manualComposition && <button type="button" className="text-xs text-amber-200 underline"
        onClick={() => void update({ ...clip, edit: { ...clip.edit, manualComposition: undefined } })}>Unlock whole-clip regions</button>}
    </>}
    {clip.edit.aspect === '9:16' && !shot?.composition && <>
      <button type="button" className="text-xs text-zinc-400 underline underline-offset-4" onClick={() => setAdding(!adding)}>
        {adding ? 'Cancel source regions' : 'Set presenter and content regions'}
      </button>
      {adding && <>
        <p className="text-[11px] text-zinc-500">For a separate presenter inset and screen content. Adjust these starting regions to match your source; no AI analysis is needed.</p>
        <RegionForm composition={startingRegions} onSave={saveRegions} open />
      </>}
    </>}
  </div>
}

function RegionForm({ composition, onSave, open, locked = false }: { composition: Composition; onSave: (composition: Composition, lock?: boolean) => void; open?: boolean; locked?: boolean }): React.JSX.Element {
  const [error, setError] = useState('')
  const [highlight, setHighlight] = useState(false)
  const [selection, setSelection] = useState<'presenter' | 'content' | null>(null)
  const [lock, setLock] = useState(locked)
  const form = useRef<HTMLFormElement>(null)
  const [regions, setRegions] = useState<Record<string, ContentRegion>>(() =>
    Object.fromEntries(composition.layers.map(layer => [layer.role, { ...layer.source }])))
  return <details open={open} className="text-xs text-zinc-400"><summary className="cursor-pointer py-1">Adjust source regions for this shot</summary>
    <form ref={form} className="mt-2 space-y-3" onSubmit={event => {
      event.preventDefault()
      const values = new FormData(event.currentTarget)
      const regions: Record<string, ContentRegion> = Object.fromEntries(composition.layers.map(layer => {
        const value = (field: string): number => Number(values.get(`${layer.role}-${field}`)) / 100
        return [layer.role, { x: value('x'), y: value('y'), width: value('width'), height: value('height') }]
      }))
      const updated = regions.presenter && presenterComposition(regions.content, regions.presenter, composition.preset)
      if (!updated) { setError('Keep both regions inside the source and avoid overlapping the presenter with the content.'); return }
      setError('')
      onSave(composition.manual ? { ...updated, manual: true, layers: updated.layers.map(layer => ({ ...layer,
        target: composition.layers.find(previous => previous.role === layer.role)?.target ?? layer.target })) } : updated, lock)
    }}>
      <button type="button" aria-pressed={highlight} onClick={() => setHighlight(!highlight)}
        className={`w-full rounded-lg border px-3 py-2 text-xs ${highlight ? 'border-amber-400/60 bg-amber-400/10 text-amber-200' : 'border-surface-600 text-zinc-300'}`}>
        {highlight ? 'Hide presenter highlight' : 'Highlight presenter region'}
      </button>
      <div className="flex gap-2">
        {(['presenter', 'content'] as const).map(role => <button key={role} type="button" aria-pressed={selection === role}
          onClick={() => { setSelection(selection === role ? null : role); setHighlight(true) }}
          className="flex-1 rounded-lg border border-surface-600 px-2 py-2 text-xs text-zinc-200">
          {selection === role ? 'Cancel selection' : `Draw ${role} region`}
        </button>)}
      </div>
      {(highlight || selection) && regions.presenter && <PresenterRegionPreview
        region={regions[selection ?? 'presenter']} role={selection ?? 'presenter'} selecting={selection !== null}
        onCancel={() => setSelection(null)} onSelect={region => {
          if (!selection) return
          for (const field of ['x', 'y', 'width', 'height'] as const) {
            const input = form.current?.elements.namedItem(`${selection}-${field}`)
            if (input instanceof HTMLInputElement) input.value = String(Number((region[field] * 100).toFixed(1)))
          }
          setRegions(previous => ({ ...previous, [selection]: region }))
          setError('')
          setSelection(null)
        }} />}
      {composition.layers.map(layer => <fieldset key={layer.role}>
        <legend className="mb-1 capitalize">{layer.role} (% of source)</legend>
        <div className="grid grid-cols-4 gap-1">
          {(['x', 'y', 'width', 'height'] as const).map(field => <label key={field} className="text-[10px]">
            {field}<input name={`${layer.role}-${field}`} type="number" required min={0} max={100} step={.1}
              defaultValue={Number((layer.source[field] * 100).toFixed(1))}
              onChange={event => {
                const value = Number(event.target.value) / 100
                setRegions(previous => ({ ...previous, [layer.role]: { ...previous[layer.role], [field]: value } }))
              }}
              className="mt-1 w-full rounded border border-surface-600 bg-surface-850 p-1 text-xs text-zinc-200" />
          </label>)}
        </div>
      </fieldset>)}
      {error && <p role="alert" className="text-amber-300">{error}</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={lock} onChange={event => setLock(event.target.checked)} />
        Keep these source regions fixed for the whole clip</label>
      <button type="submit" className="rounded border border-surface-600 px-3 py-1.5 text-zinc-200">Apply regions</button>
    </form>
  </details>
}

/** The original source frame keeps region coordinates independent of output crops. */
function PresenterRegionPreview({ region, role, selecting, onSelect, onCancel }: {
  region: ContentRegion; role: 'presenter' | 'content'; selecting: boolean
  onSelect: (region: ContentRegion) => void; onCancel: () => void
}): React.JSX.Element | null {
  const source = useStore(state => state.project?.video)
  const video = useRef<HTMLVideoElement>(null)
  const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const [draft, setDraft] = useState<ContentRegion | null>(null)
  const visible = selecting && draft ? draft : region
  const point = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
  }
  const rectangle = (event: React.PointerEvent<HTMLDivElement>): ContentRegion => {
    const end = point(event)
    const start = drag.current!
    // Round once to the same precision as the coordinate fields and saved crop.
    const round = (value: number): number => Math.round(value * 1000) / 1000
    const x = round(Math.min(start.x, end.x))
    const y = round(Math.min(start.y, end.y))
    return { x, y, width: round(round(Math.max(start.x, end.x)) - x),
      height: round(round(Math.max(start.y, end.y)) - y) }
  }
  useEffect(() => {
    const element = video.current
    if (!element) return
    let lastSeek = 0
    const sync = (force = false): void => {
      const time = usePreviewBus.getState().time
      if (element.readyState < 1 || element.seeking || (!force && Date.now() - lastSeek < 400)) return
      if (Math.abs(element.currentTime - time) > 0.25) {
        lastSeek = Date.now()
        element.currentTime = Math.max(0, Math.min(time, element.duration || time))
      }
    }
    const loaded = (): void => sync(true)
    element.addEventListener('loadedmetadata', loaded)
    sync(true)
    const unsubscribe = usePreviewBus.subscribe(() => sync())
    return () => {
      unsubscribe()
      element.removeEventListener('loadedmetadata', loaded)
    }
  }, [source?.path])
  if (!source) return null
  return <div className="space-y-1.5" data-testid="presenter-region-preview">
    <p className="text-[11px] text-zinc-400">{selecting ? `Drag a box around the ${role}. Escape cancels.` : 'Original video · presenter highlighted in amber'}</p>
    <div className={`relative isolate overflow-hidden rounded-lg bg-black ${selecting ? 'cursor-crosshair touch-none' : ''}`}
      style={{ aspectRatio: `${source.width} / ${source.height}` }} tabIndex={selecting ? 0 : undefined}
      aria-label={selecting ? `Draw ${role} region on the original video` : undefined}
      onKeyDown={event => { if (event.key === 'Escape') { drag.current = null; setDraft(null); onCancel() } }}
      onPointerDown={event => {
        if (!selecting || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        usePreviewBus.getState().scrub(usePreviewBus.getState().time)
        drag.current = { ...point(event), pointerId: event.pointerId }
        setDraft(null)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => { if (selecting && drag.current?.pointerId === event.pointerId) setDraft(rectangle(event)) }}
      onPointerUp={event => {
        if (!selecting || drag.current?.pointerId !== event.pointerId) return
        const region = rectangle(event)
        drag.current = null
        setDraft(null)
        event.currentTarget.releasePointerCapture(event.pointerId)
        if (region.width >= .02 && region.height >= .02) onSelect(region)
      }}
      onPointerCancel={() => { drag.current = null; setDraft(null) }}
      onLostPointerCapture={() => { drag.current = null; setDraft(null) }}>
      <video ref={video} src={window.cutawan.mediaUrl(source.path)} muted playsInline preload="metadata"
        className="pointer-events-none absolute inset-0 h-full w-full object-contain" aria-label="Original video frame for selecting the presenter" />
      <div className="pointer-events-none absolute border-2 border-amber-400 bg-amber-400/10"
        style={{ left: `${visible.x * 100}%`, top: `${visible.y * 100}%`, width: `${visible.width * 100}%`, height: `${visible.height * 100}%`,
          boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}>
        <span className="absolute left-0 top-0 bg-amber-400 px-1 text-[10px] font-semibold capitalize text-black">{role}</span>
      </div>
    </div>
    <p className="text-[11px] text-zinc-500">Scrub the clip to inspect another frame. Coordinates update this highlight immediately; choose Apply regions to save.</p>
  </div>
}
