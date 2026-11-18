import { useEffect, useRef, useState } from 'react'
import type { Composition, ContentRegion } from '@shared/types'
import { validComposition } from '@shared/composition'
import { dragPanel, type PanelCorner } from '@shared/panelDrag'
import { usePreviewBus } from '../lib/previewBus'
import LayoutImage from './LayoutImage'

export default function ManualLayoutEditor({ composition, locked, onSave, clipId, blurBackground, captionPosition }: {
  composition: Composition; locked: boolean; onSave: (composition: Composition, lock: boolean) => void
  clipId: string; blurBackground: boolean
  captionPosition?: { x: number; y: number }
}): React.JSX.Element {
  const [draft, setDraft] = useState<Composition>(() => ({ ...composition,
    layers: composition.layers.map(layer => ({ ...layer, source: { ...layer.source }, target: { ...layer.target } })) }))
  const [selected, setSelected] = useState(0)
  const [lock, setLock] = useState(locked)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const canvas = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ pointer: number; index: number; x: number; y: number; rect: ContentRegion; corner?: PanelCorner } | null>(null)
  useEffect(() => {
    const result = { ...draft, manual: true }
    usePreviewBus.getState().setLayoutDraft(open && validComposition(result) ? { clipId, composition: result } : null)
    return () => { if (usePreviewBus.getState().layoutDraft?.clipId === clipId) usePreviewBus.getState().setLayoutDraft(null) }
  }, [draft, open, clipId])
  const layer = draft.layers[selected]
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="space-y-2 rounded-lg border border-surface-600 p-2">
    <summary className="cursor-pointer text-xs text-zinc-200">Arrange presenter and content manually</summary>
    <p className="mt-2 text-[11px] text-zinc-400">Drag panels to move; drag a corner handle to resize. Dotted bounds show the allotted space; the video is fitted inside. Changes preview live on the left. Apply saves them.</p>
    <div ref={canvas} className="relative mx-auto mt-2 w-44 touch-none overflow-hidden rounded bg-black" style={{ aspectRatio: '9 / 16' }}
      aria-label="Output layout canvas"
      onPointerMove={event => {
        const current = drag
        const bounds = canvas.current?.getBoundingClientRect()
        if (!current || current.pointer !== event.pointerId || !bounds) return
        const next = dragPanel({ ...current.rect }, (event.clientX - current.x) / bounds.width,
          (event.clientY - current.y) / bounds.height, current.corner, true)
        const target = { x: next.x, y: next.y, width: next.width, height: next.height }
        setDraft(previous => ({ ...previous, layers: previous.layers.map((item, index) => index !== current.index ? item : {
          ...item, target
        }) }))
      }}
      onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}>
      {open && <LayoutImage composition={{ ...draft, manual: true }} blur={blurBackground} />}
      {draft.layers.map((item, index) => <div key={item.role} className="absolute"
        style={{ left: `${item.target.x * 100}%`, top: `${item.target.y * 100}%`, width: `${item.target.width * 100}%`, height: `${item.target.height * 100}%` }}>
        <button type="button" aria-pressed={selected === index}
        aria-label={`Move ${item.role} panel`} onClick={() => setSelected(index)}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          setSelected(index)
          setDrag({ pointer: event.pointerId, index, x: event.clientX, y: event.clientY, rect: { ...item.target } })
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        className={`absolute inset-0 flex h-full w-full cursor-move items-start border border-dashed text-[10px] capitalize ${selected === index ? 'border-white' : 'border-white/40'}`}>
        <span className="bg-black/70 px-1 text-white">{item.role}</span>
      </button>
      {selected === index && (['nw', 'ne', 'sw', 'se'] as const).map(corner => <button key={corner} type="button"
        aria-label={`Resize ${item.role} ${corner} corner`} data-testid={`resize-${item.role}-${corner}`}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          setDrag({ pointer: event.pointerId, index, x: event.clientX, y: event.clientY, rect: { ...item.target }, corner })
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        className="absolute z-10 h-3 w-3 rounded-sm border border-black bg-white"
        style={{ left: corner.includes('w') ? -3 : undefined, right: corner.includes('e') ? -3 : undefined,
          top: corner.includes('n') ? -3 : undefined, bottom: corner.includes('s') ? -3 : undefined,
          cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize' }} />)}
      </div>)}
      <div className="pointer-events-none absolute w-full border-t border-dashed border-white/40 text-center text-[10px] text-white/60"
        style={{ left: `${((captionPosition?.x ?? .5) - .5) * 100}%`, top: `${(captionPosition?.y ?? draft.captionY) * 100}%` }}>Captions</div>
    </div>
    <div className="flex gap-2">{draft.layers.map((item, index) => <button key={item.role} type="button"
      onClick={() => setSelected(index)} aria-pressed={selected === index}
      className="rounded border border-surface-600 px-2 py-1 text-xs capitalize text-zinc-200">{item.role}</button>)}</div>
    <div className="grid grid-cols-4 gap-1">{(['x', 'y', 'width', 'height'] as const).map(field => <label key={field} className="text-[10px] text-zinc-400">
      {field} %<input type="number" min={field === 'width' || field === 'height' ? 2 : -100} max={200} step={.1}
        key={`${selected}:${field}:${layer.target[field]}`} defaultValue={Number((layer.target[field] * 100).toFixed(1))}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
        onBlur={event => {
          const value = Number(event.target.value) / 100
          if (event.target.value === '' || !Number.isFinite(value)) return
          setDraft(previous => ({ ...previous, layers: previous.layers.map((item, index) => index !== selected ? item : {
            ...item, target: { ...item.target, [field]: value }
          }) }))
        }} className="mt-1 w-full rounded border border-surface-600 bg-surface-850 p-1 text-xs text-zinc-200" />
    </label>)}</div>
    <label className="flex gap-2 text-[11px] text-zinc-300"><input type="checkbox" checked={lock} onChange={event => setLock(event.target.checked)} />
      Keep this arrangement and source regions fixed for the whole clip</label>
    {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    <button type="button" className="rounded border border-surface-600 px-3 py-2 text-xs text-zinc-200" onClick={() => {
      const result = { ...draft, manual: true }
      if (!validComposition(result)) { setError('Use positions from -100% to 200% and sizes from 2% to 200%. Parts outside the frame are clipped.'); return }
      setError('')
      onSave(result, lock)
    }}>Apply manual arrangement</button>
  </details>
}
