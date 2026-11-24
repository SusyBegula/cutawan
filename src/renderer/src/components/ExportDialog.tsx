import { useEffect, useRef } from 'react'
import { Download, X } from 'lucide-react'
import type { Clip, QualityPreference, EncoderPreference } from '@shared/types'
import { useStore } from '../store'
import SizeTargetControls from './SizeTargetControls'

export default function ExportDialog({ clip, onClose, onExport }: { clip: Clip; onClose: () => void; onExport: () => void }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const settings = useStore(s => s.settings)
  const save = useStore(s => s.saveSettings)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} aria-labelledby="export-title" onCancel={onClose}
    className="m-auto max-h-[85vh] w-[460px] max-w-[90vw] overflow-y-auto rounded-2xl border border-surface-600 bg-surface-900 p-6 text-zinc-200 shadow-2xl backdrop:bg-black/75">
    <div className="mb-5 flex items-center justify-between"><h2 id="export-title" className="text-lg font-semibold">Export video</h2>
      <button type="button" aria-label="Close export options" onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-surface-700"><X size={18} /></button></div>
    <p className="mb-5 truncate text-xs text-zinc-500">{clip.title} · MP4 · {clip.edit.aspect === 'original' ? 'Original aspect ratio' : clip.edit.aspect}</p>
    <label className="block text-xs text-zinc-400">Quality<select value={settings?.quality ?? 'standard'} onChange={e => void save({ quality: e.target.value as QualityPreference })}
      className="mt-2 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm text-zinc-200">
      <option value="draft">Draft · faster</option><option value="standard">Balanced</option><option value="high">High · best quality</option></select></label>
    <label className="mt-4 block text-xs text-zinc-400">Encoder<select value={settings?.encoder ?? 'auto'} onChange={e => void save({ encoder: e.target.value as EncoderPreference })}
      className="mt-2 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm text-zinc-200">
      <option value="auto">Automatic</option><option value="cpu">CPU</option><option value="gpu" disabled={!settings?.gpu.available}>GPU{!settings?.gpu.available ? ' · unavailable' : ''}</option></select></label>
    <div className="mt-5"><SizeTargetControls compact /></div>
    <p className="mb-5 text-[11px] text-zinc-500">Export preferences also apply to your other clips. A size limit may reduce the output resolution.</p>
    <button type="button" onClick={onExport} className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-white"><Download size={15} />Export video</button>
  </dialog>
}
