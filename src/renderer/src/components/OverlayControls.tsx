import { useEffect, useState } from 'react'
import type { Clip, ClipEditState, SettingsUpdate } from '@shared/types'
import { captionPositionAt } from '@shared/contentRegion'
import { detailCaptionRanges } from '@shared/contentType'
import { resolveCaptionStyle } from '@shared/captionStyles'
import { useStore } from '../store'
import { usePreviewBus } from '../lib/previewBus'

export default function OverlayControls({ clip, mode }: { clip: Clip; mode: 'captions' | 'watermark' }): React.JSX.Element {
  const branding = useStore(s => s.settings?.branding)
  const time = usePreviewBus(s => s.time)
  const source = useStore(s => s.project?.video)
  const [logoAspect, setLogoAspect] = useState(1)
  useEffect(() => {
    if (!branding?.imagePath) return
    const image = new Image()
    image.onload = () => { if (image.naturalHeight) setLogoAspect(image.naturalWidth / image.naturalHeight) }
    image.src = window.cutawan.mediaUrl(branding.imagePath)
    return () => { image.onload = null }
  }, [branding?.imagePath])
  const [error, setError] = useState('')
  const caption = clip.edit.captionPosition ?? { x: .5, y: captionPositionAt(detailCaptionRanges(clip), time, resolveCaptionStyle(clip.edit.captionStyleId).positionY) }
  const ratio = clip.edit.aspect === 'original' ? (source ? source.width / source.height : 16 / 9)
    : clip.edit.aspect === '9:16' ? 9 / 16 : clip.edit.aspect === '1:1' ? 1 : 16 / 9
  const scale = Math.max(.04, Math.min(.5, branding?.scale ?? .16))
  const watermark = clip.edit.watermarkTransform ?? {
    x: branding?.position.endsWith('right') ? 1 - .03 - scale : .03,
    y: branding?.position.startsWith('bottom') ? 1 - .03 * ratio - scale * ratio / logoAspect : .03 * ratio, scale
  }
  const save = (patch: Partial<ClipEditState>): void => {
    const current = useStore.getState().project?.clips.find(c => c.id === clip.id) ?? clip
    void useStore.getState().updateClip({ ...current, edit: { ...current.edit, ...patch } }).catch(e => setError(String(e)))
  }
  const settings = (patch: NonNullable<SettingsUpdate['branding']>): void => {
    void useStore.getState().saveSettings({ branding: patch }).catch(e => setError(String(e)))
  }
  const input = (label: string, value: number, change: (value: number) => void, min = -100): React.JSX.Element =>
    <label className="text-[11px] text-zinc-400">{label}<input aria-label={label} type="number" min={min} max={200} step={.1}
      key={`${label}:${value}`} defaultValue={Number((value * 100).toFixed(1))} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={e => {
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isFinite(n)) change(Math.max(min / 100, Math.min(2, n / 100)))
      }} className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-2 py-2 text-xs text-zinc-200" /></label>
  return <div className="space-y-4">
    {mode === 'watermark' && <>
      <h3 className="text-sm font-medium text-zinc-200">Watermark</h3>
      {branding?.imagePath && <div className="flex h-28 items-center justify-center rounded-xl border border-surface-600 bg-black/40 p-4">
        <img src={window.cutawan.mediaUrl(branding.imagePath)} alt="Watermark image" className="max-h-full max-w-full object-contain" />
      </div>}
      <button className="w-full rounded-lg border border-surface-600 px-3 py-2 text-xs text-zinc-200 hover:bg-surface-800"
        onClick={() => { void useStore.getState().selectBrandingLogo().catch(e => setError(String(e))) }}>{branding?.imagePath ? 'Replace image…' : 'Choose watermark image…'}</button>
      {branding?.imagePath && <>
        <label className="flex items-center justify-between text-xs text-zinc-300">Show watermark<input type="checkbox" checked={branding.enabled}
          onChange={e => settings({ enabled: e.target.checked })} /></label>
        <label className="block text-xs text-zinc-400">Opacity <span className="float-right tabular-nums">{Math.round(branding.opacity * 100)}%</span>
          <input aria-label="Watermark opacity" type="range" min={5} max={100} value={Math.round(branding.opacity * 100)} className="mt-2 w-full"
            onChange={e => settings({ opacity: Number(e.target.value) / 100 })} /></label>
        {input('Watermark width %', watermark.scale, scale => save({ watermarkTransform: { ...watermark, scale } }), 2)}
        <p className="text-[11px] text-zinc-500">Image, visibility and opacity apply to all clips. Size and position are saved for this clip.</p>
      </>}
    </>}
    {mode === 'captions' && <label className="block text-xs text-zinc-400">Caption size <span className="float-right tabular-nums">{Math.round((clip.edit.captionScale ?? 1) * 100)}%</span>
      <input aria-label="Caption size" type="range" min={50} max={200} value={Math.round((clip.edit.captionScale ?? 1) * 100)} className="mt-2 w-full"
        onChange={e => save({ captionScale: Number(e.target.value) / 100 })} /></label>}
    {(mode === 'captions' || branding?.imagePath) && <>
      <p className="text-[11px] text-zinc-500">Use <span className="text-zinc-300">Edit on canvas</span> above the preview to drag {mode === 'captions' ? 'captions' : 'the watermark'} into place.</p>
      <details className="rounded-lg border border-surface-600 p-3 text-xs text-zinc-400">
        <summary className="cursor-pointer">Advanced position</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {mode === 'captions' ? <>
            {input('Caption x %', caption.x, x => save({ captionPosition: { ...caption, x } }))}
            {input('Caption y %', caption.y, y => save({ captionPosition: { ...caption, y } }))}
          </> : <>
            {input('Watermark x %', watermark.x, x => save({ watermarkTransform: { ...watermark, x } }))}
            {input('Watermark y %', watermark.y, y => save({ watermarkTransform: { ...watermark, y } }))}
          </>}
        </div>
        <p className="mt-2 text-[10px] text-zinc-500">Negative values place items beyond the frame.</p>
      </details>
      <button className="text-[11px] text-zinc-400 underline" onClick={() => save(mode === 'captions' ? { captionPosition: undefined, captionScale: undefined } : { watermarkTransform: undefined })}>Reset {mode === 'captions' ? 'caption placement and size' : 'watermark placement'}</button>
    </>}
    {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
  </div>
}
