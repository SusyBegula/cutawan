import { useRef, useState } from 'react'
import type { Clip, ClipEditState } from '@shared/types'
import { captionPositionAt } from '@shared/contentRegion'
import { detailCaptionRanges } from '@shared/contentType'
import { resolveCaptionStyle } from '@shared/captionStyles'
import { useStore } from '../store'
import { usePreviewBus } from '../lib/previewBus'

const clamp = (n: number, min = -1, max = 2): number => Math.max(min, Math.min(max, n))

/** Per-clip output placement, independent of the video's framing mode. */
export default function OverlayControls({ clip }: { clip: Clip }): React.JSX.Element {
  const branding = useStore(s => s.settings?.branding)
  const source = useStore(s => s.project?.video)
  const time = usePreviewBus(s => s.time)
  const [logoAspect, setLogoAspect] = useState(1)
  const [error, setError] = useState('')
  const canvas = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ kind: 'caption' | 'watermark'; resize: boolean; x: number; y: number;
    original: { x: number; y: number; scale: number } } | null>(null)
  const ratio = clip.edit.aspect === 'original' ? (source ? source.width / source.height : 16 / 9)
    : clip.edit.aspect === '9:16' ? 9 / 16 : clip.edit.aspect === '1:1' ? 1 : 16 / 9
  const style = resolveCaptionStyle(clip.edit.captionStyleId)
  const caption = clip.edit.captionPosition ?? { x: .5, y: captionPositionAt(detailCaptionRanges(clip), time, style.positionY) }
  const scale = Math.min(.5, Math.max(.04, branding?.scale ?? .16))
  const watermark = clip.edit.watermarkTransform ?? {
    x: branding?.position.endsWith('right') ? 1 - .03 - scale : .03,
    y: branding?.position.startsWith('bottom') ? 1 - .03 * ratio - scale * ratio / logoAspect : .03 * ratio,
    scale
  }
  const latest = (): Clip => useStore.getState().project?.clips.find(c => c.id === clip.id) ?? clip
  const save = (patch: Partial<ClipEditState>): void => {
    const current = latest()
    void useStore.getState().updateClip({ ...current, edit: { ...current.edit, ...patch } })
      .catch(e => setError(String(e)))
  }
  const begin = (event: React.PointerEvent, kind: 'caption' | 'watermark', resize = false): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setDrag({ kind, resize, x: event.clientX, y: event.clientY,
      original: kind === 'caption' ? { ...caption, scale: 0 } : { ...watermark } })
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const finish = (): void => { if (drag) { setDrag(null); save({}) } }
  const input = (label: string, value: number, change: (value: number) => void, min = -100): React.JSX.Element =>
    <label className="text-[10px] text-zinc-400">{label}<input aria-label={label} type="number" min={min} max={200} step={.1}
      key={`${label}:${value}`} defaultValue={Number((value * 100).toFixed(1))} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={e => {
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isFinite(n)) change(clamp(n / 100, min / 100))
      }} className="mt-1 w-full rounded border border-surface-600 bg-surface-850 p-1 text-xs text-zinc-200" /></label>
  return <details className="mt-3 space-y-2 rounded-lg border border-surface-600 p-2">
    <summary className="cursor-pointer text-xs text-zinc-200">Move captions and watermark</summary>
    <p className="mt-2 text-[11px] text-zinc-400">Drag the labels below. Drag the watermark's lower-right handle to resize. Changes appear on the left and stay fixed for this clip in every layout, including Fit and Fit + blur. Negative positions move items past the frame edge.</p>
    <div ref={canvas} className="relative mx-auto w-44 touch-none overflow-hidden rounded border border-surface-600 bg-black"
      style={{ aspectRatio: ratio }} aria-label="Caption and watermark placement canvas"
      onPointerMove={e => {
        const bounds = canvas.current?.getBoundingClientRect()
        if (!drag || !bounds) return
        const dx = (e.clientX - drag.x) / bounds.width, dy = (e.clientY - drag.y) / bounds.height
        const position = { x: clamp(drag.original.x + dx), y: clamp(drag.original.y + dy) }
        const current = latest()
        useStore.getState().updateClipLocal({ ...current, edit: { ...current.edit,
          ...(drag.kind === 'caption' ? { captionPosition: position } : { watermarkTransform: drag.resize
            ? { ...drag.original, scale: clamp(drag.original.scale + dx, .02) }
            : { ...position, scale: drag.original.scale } }) } })
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <button type="button" aria-label="Drag captions" onPointerDown={e => begin(e, 'caption')}
        className="absolute cursor-move whitespace-nowrap rounded border border-yellow-300 bg-black/80 px-1 text-[10px] text-yellow-200"
        style={{ left: `${caption.x * 100}%`, top: `${caption.y * 100}%`, transform: 'translate(-50%, -50%)' }}>Captions</button>
      {branding?.imagePath && <div className="absolute border border-white" style={{ left: `${watermark.x * 100}%`, top: `${watermark.y * 100}%`, width: `${watermark.scale * 100}%` }}>
        <img alt="Drag watermark" draggable={false} src={window.cutawan.mediaUrl(branding.imagePath)}
          onLoad={e => setLogoAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          onPointerDown={e => begin(e, 'watermark')} className="block w-full cursor-move" style={{ opacity: branding.opacity }} />
        <button type="button" aria-label="Resize watermark" onPointerDown={e => begin(e, 'watermark', true)}
          className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize border border-black bg-white" />
      </div>}
    </div>
    <div className="grid grid-cols-2 gap-2">
      {input('Caption x %', caption.x, x => save({ captionPosition: { ...caption, x } }))}
      {input('Caption y %', caption.y, y => save({ captionPosition: { ...caption, y } }))}
    </div>
    <button className="text-[11px] text-zinc-400 underline" onClick={() => save({ captionPosition: undefined })}>Reset caption position</button>
    <button className="block rounded border border-surface-600 px-2 py-1 text-xs text-zinc-200"
      onClick={() => { void useStore.getState().selectBrandingLogo().catch(e => setError(String(e))) }}>{branding?.imagePath ? 'Replace watermark image…' : 'Choose watermark image…'}</button>
    {branding?.imagePath && <>
      <label className="flex gap-2 text-xs text-zinc-300"><input type="checkbox" checked={branding.enabled}
        onChange={e => { void useStore.getState().saveSettings({ branding: { enabled: e.target.checked } }).catch(e => setError(String(e))) }} />Show watermark (all clips)</label>
      <div className="grid grid-cols-3 gap-2">
        {input('Watermark x %', watermark.x, x => save({ watermarkTransform: { ...watermark, x } }))}
        {input('Watermark y %', watermark.y, y => save({ watermarkTransform: { ...watermark, y } }))}
        {input('Watermark width %', watermark.scale, scale => save({ watermarkTransform: { ...watermark, scale } }), 2)}
      </div>
      <button className="text-[11px] text-zinc-400 underline" onClick={() => save({ watermarkTransform: undefined })}>Reset watermark to branding position</button>
    </>}
    {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
  </details>
}
