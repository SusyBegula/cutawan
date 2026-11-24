import { hookStyle } from '@shared/editorEffects'
import { useEffect, useRef, useState } from 'react'
import type { Clip, Composition, ContentRegion, Project } from '@shared/types'
import { compositionPixels, validComposition } from '@shared/composition'
import { dragPanel, type PanelCorner } from '@shared/panelDrag'
import { captionPositionAt } from '@shared/contentRegion'
import { detailCaptionRanges, layoutShotAt } from '@shared/contentType'
import { resolveCaptionStyle } from '@shared/captionStyles'
import { usePreviewBus } from '../lib/previewBus'
import { useStore } from '../store'

type Item = { id: string; label: string; rect: ContentRegion; target: ContentRegion; index?: number }
const clamp = (n: number, min = -1, max = 2): number => Math.max(min, Math.min(max, n))

/** Selection bounds use the exact fitted output geometry shared with FFmpeg. */
export default function CanvasTools({ clip, project, ratio, onSelect, onStart }: {
  clip: Clip; project: Project; ratio: number; onSelect: (tool: 'layout' | 'captions' | 'watermark' | 'hook') => void; onStart: () => void
}): React.JSX.Element {
  const frame = useRef<HTMLDivElement>(null)
  const time = usePreviewBus(s => s.time)
  const branding = useStore(s => s.settings?.branding)
  const [logoAspect, setLogoAspect] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState<{ item: Item; x: number; y: number; pointer: number; corner?: PanelCorner;
    composition?: Composition; captionScale: number } | null>(null)
  useEffect(() => {
    if (!branding?.imagePath) return
    const image = new Image()
    image.onload = () => { if (image.naturalHeight) setLogoAspect(image.naturalWidth / image.naturalHeight) }
    image.src = window.cutawan.mediaUrl(branding.imagePath)
    return () => { image.onload = null }
  }, [branding?.imagePath])
  const composition = layoutShotAt(clip, time)?.composition
  const items: Item[] = []
  if (composition) {
    const pixels = compositionPixels(composition, project.video, 1080, 1920)
    composition.layers.forEach((layer, index) => {
      const r = pixels[index]?.target
      if (r) items.push({ id: `${layer.role}-${index}`, label: layer.role === 'presenter' ? 'Presenter' : layer.role === 'content' ? 'Content' : 'Speaker',
        index, target: layer.target, rect: { x: r.x / 1080, y: r.y / 1920, width: r.width / 1080, height: r.height / 1920 } })
    })
  }
  if (clip.edit.showTitle) {
    const h=hookStyle(clip.edit)
    const rect={x:h.x-.4,y:h.y-.055*h.scale,width:.8,height:.11*h.scale}
    items.push({id:'hook',label:'Hook text',rect,target:rect})
  }
  if (clip.edit.captionsEnabled) {
    const style = resolveCaptionStyle(clip.edit.captionStyleId, branding?.colors, clip.edit.captionFontFamily, clip.edit.captionScale)
    const p = clip.edit.captionPosition ?? { x: .5, y: captionPositionAt(detailCaptionRanges(clip), time, style.positionY) }
    const rect = { x: p.x - .38, y: p.y - style.fontScale * 1.25, width: .76, height: style.fontScale * 2.5 }
    items.push({ id: 'caption', label: 'Captions', rect, target: rect })
  }
  if (branding?.enabled && branding.imagePath) {
    const scale = clip.edit.watermarkTransform?.scale ?? clamp(branding.scale, .04, .5)
    const p = clip.edit.watermarkTransform ?? { x: branding.position.endsWith('right') ? 1 - .03 - scale : .03,
      y: branding.position.startsWith('bottom') ? 1 - .03 * ratio - scale * ratio / logoAspect : .03 * ratio }
    const rect = { x: p.x, y: p.y, width: scale, height: scale * ratio / logoAspect }
    items.push({ id: 'watermark', label: 'Watermark', rect, target: rect })
  }
  const begin = (e: React.PointerEvent, item: Item, corner?: PanelCorner): void => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    onStart()
    usePreviewBus.getState().setLayoutDraft(null)
    setSelected(item.id)
    onSelect(item.id === 'hook' ? 'hook' : item.id === 'caption' ? 'captions' : item.id === 'watermark' ? 'watermark' : 'layout')
    setDrag({ item, x: e.clientX, y: e.clientY, pointer: e.pointerId, corner, composition, captionScale: clip.edit.captionScale ?? 1 })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent): void => {
      const bounds = frame.current?.getBoundingClientRect()
      if (!drag || drag.pointer !== e.pointerId || !bounds) return
      const dx = (e.clientX - drag.x) / bounds.width, dy = (e.clientY - drag.y) / bounds.height
      const next = useStore.getState().project?.clips.find(c => c.id === clip.id)
      if (!next) return
      let edit = { ...next.edit }
      if (drag.item.id === 'hook') {
        const r=drag.item.rect, h=hookStyle(next.edit)
        edit={...edit,hookStyle:{...h,...(drag.corner?{scale:clamp((r.height/.11)*(1+(drag.corner.includes('w')?-dx:dx)/r.width),.4,3)}:{x:clamp(r.x+r.width/2+dx),y:clamp(r.y+r.height/2+dy)})}}
      } else if (drag.item.id === 'caption') {
        const r = drag.item.rect
        edit = { ...edit, ...(drag.corner ? { captionScale: clamp(drag.captionScale * (1 + (drag.corner.includes('w') ? -dx : dx) / r.width), .5, 2) }
          : { captionPosition: { x: clamp(r.x + r.width / 2 + dx), y: clamp(r.y + r.height / 2 + dy) } }) }
      } else if (drag.item.id === 'watermark') {
        const r = drag.item.rect
        const scale = drag.corner ? clamp(r.width + (drag.corner.includes('w') ? -dx : dx), .02, 2) : r.width
        const x = drag.corner ? drag.corner.includes('w') ? r.x + r.width - scale : r.x : clamp(r.x + dx)
        const y = drag.corner ? drag.corner.includes('n') ? r.y + r.height - scale * ratio / logoAspect : r.y : clamp(r.y + dy)
        edit = { ...edit, watermarkTransform: { x: clamp(x), y: clamp(y), scale } }
      } else if (drag.composition) {
        const target = dragPanel(drag.item.target, dx, dy, drag.corner, true)
        const manual = { ...drag.composition, manual: true, layers: drag.composition.layers.map((layer, index) => index === drag.item.index ? { ...layer, target } : layer) }
        if (!validComposition(manual)) return
        edit = { ...edit, manualComposition: manual, layoutChosen: true, framing: 'auto', autoZoom: false }
      }
      useStore.getState().updateClipLocal({ ...next, edit })

    }
    const finish = (): void => {
      setDrag(null)
      const current = useStore.getState().project?.clips.find(c => c.id === clip.id)
      if (current) void useStore.getState().updateClip(current).catch(e => setError(String(e)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    window.addEventListener('blur', finish, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
    }
  }, [drag, clip.id, ratio, logoAspect])
  return <div ref={frame} className="pointer-events-none absolute inset-0 z-20 touch-none" aria-label="Canvas editing controls">
    {items.map(item => <div key={item.id} className="absolute" style={{ left: `${item.rect.x * 100}%`, top: `${item.rect.y * 100}%`, width: `${item.rect.width * 100}%`, height: `${item.rect.height * 100}%` }}>
      <button type="button" aria-label={`Move ${item.label.toLowerCase()} on canvas`} onPointerDown={e => begin(e, item)} onFocus={() => setSelected(item.id)}
        className={`pointer-events-auto absolute inset-0 h-full w-full cursor-move border ${selected === item.id ? 'border-white' : 'border-white/35 border-dashed hover:border-white'}`}>
        <span className="absolute -top-5 left-0 rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white">{item.label}</span>
      </button>
      {selected === item.id && (['nw', 'ne', 'sw', 'se'] as const).map(corner => <button key={corner} type="button" aria-label={`Resize ${item.label.toLowerCase()} ${corner} on canvas`}
        onPointerDown={e => begin(e, item, corner)} className="pointer-events-auto absolute h-3 w-3 rounded-sm border border-black bg-white"
        style={{ left: corner.includes('w') ? -5 : undefined, right: corner.includes('e') ? -5 : undefined, top: corner.includes('n') ? -5 : undefined,
          bottom: corner.includes('s') ? -5 : undefined, cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize' }} />)}
    </div>)}
    {error && <p role="alert" className="absolute bottom-0 bg-black p-2 text-xs text-amber-300">{error}</p>}
  </div>
}
