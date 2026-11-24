import { useState } from 'react'
import type { Clip, ClipEditState } from '@shared/types'
import { hookStyle } from '@shared/editorEffects'
import { useStore } from '../store'

const field = 'mt-2 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-xs text-zinc-200'
export default function CreativeControls({ clip, mode }: { clip: Clip; mode: 'hook' | 'audio' | 'effects' }): React.JSX.Element {
  const [error, setError] = useState('')
  const fonts = useStore(s => s.customFonts)
  const save = (patch: Partial<ClipEditState>): void => {
    const current = useStore.getState().project?.clips.find(c => c.id === clip.id) ?? clip
    void useStore.getState().updateClip({ ...current, edit: { ...current.edit, ...patch } }).catch(e => setError(String(e)))
  }
  const h = hookStyle(clip.edit)
  const hook = (patch: Partial<typeof h>): void => save({ hookStyle: { ...h, ...patch } })
  const number = (label: string, value: number, commit: (n: number) => void, min = 0, max = 60): React.JSX.Element => <label className="block text-xs text-zinc-400">{label}<input className={field} type="number" min={min} max={max} step={.1} key={`${label}:${value}`} defaultValue={value} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={e => { const n = Number(e.target.value); if (e.target.value && Number.isFinite(n)) commit(Math.max(min, Math.min(max,n))) }} /></label>
  return <div className="space-y-5">
    <div><h2 className="text-base font-semibold text-white">{mode === 'hook' ? 'Hook text' : mode === 'audio' ? 'Audio & music' : 'Fades & transitions'}</h2><p className="mt-1 text-xs leading-relaxed text-zinc-500">{mode === 'hook' ? 'Make the opening line stand out.' : mode === 'audio' ? 'Balance the original audio and your soundtrack.' : 'Ease the picture and sound in or out.'}</p></div>
    {mode === 'hook' && <>
      <label className="flex justify-between text-xs text-zinc-300">Show hook text<input type="checkbox" checked={clip.edit.showTitle} onChange={e => save({ showTitle: e.target.checked })} /></label>
      <textarea aria-label="Hook text" className={field} rows={3} key={`${clip.id}:${clip.hook}`} defaultValue={clip.hook || clip.title} onBlur={e => { void useStore.getState().updateClip({ ...clip, hook: e.target.value }).catch(e => setError(String(e))) }} />
      <label className="block text-xs text-zinc-400">Style<select className={field} value={h.preset} onChange={e => hook({ preset: e.target.value as typeof h.preset })}><option value="card">Filled card</option><option value="plain">Clean text</option><option value="banner">Outlined text</option></select></label>
      <label className="block text-xs text-zinc-400">Font<select className={field} value={h.fontFamily} onChange={e => hook({ fontFamily: e.target.value })}>{[...new Set(['Arial','Anton','Poppins',...fonts.map(f => f.family)])].map(f => <option key={f}>{f}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3">{(['color','background'] as const).map(key => <label key={key} className="text-xs capitalize text-zinc-400">{key}<input aria-label={`Hook ${key}`} className="mt-2 h-9 w-full cursor-pointer rounded border border-surface-600" type="color" value={h[key]} onChange={e => hook({ [key]: e.target.value })} /></label>)}</div>
      <label className="block text-xs text-zinc-400">Size <span className="float-right">{Math.round(h.scale*100)}%</span><input aria-label="Hook size" className="mt-3 w-full" type="range" min={40} max={300} value={h.scale*100} onChange={e => hook({ scale: Number(e.target.value)/100 })} /></label>
      {number('Display duration (seconds)',h.duration,duration => hook({duration}),.1)}
      <p className="text-xs text-zinc-500">Use Edit on canvas to drag and resize the hook. It stays independent of captions.</p>
      <details className="rounded-lg border border-surface-600 p-3 text-xs text-zinc-400"><summary className="cursor-pointer">Precise position</summary><div className="mt-3 grid grid-cols-2 gap-3">{number('Hook X %',h.x*100,x => hook({x:x/100}),-100,200)}{number('Hook Y %',h.y*100,y => hook({y:y/100}),-100,200)}</div></details>
    </>}
    {mode === 'audio' && <>
      <label className="block text-xs text-zinc-400">Original audio <span className="float-right">{Math.round((clip.edit.sourceVolume ?? 1)*100)}%</span><input aria-label="Original audio volume" className="mt-3 w-full" type="range" min={0} max={100} value={(clip.edit.sourceVolume ?? 1)*100} onChange={e => save({ sourceVolume:Number(e.target.value)/100 })} /></label>
      <button aria-label="Add background music" className="w-full rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-3 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20" onClick={() => { void window.cutawan.selectMusic().then(m => { if(m) save({ music: {...m,enabled:true,volume:.2,offset:0} }) }).catch(e => setError(String(e))) }}>+ {clip.edit.music ? 'Replace music' : 'Add music file'}</button>
      {clip.edit.music && <div className="space-y-4 rounded-xl border border-surface-600 bg-surface-850 p-4">
        <p className="truncate text-xs text-zinc-200" title={clip.edit.music.name}>{clip.edit.music.name}</p>
        <label className="flex justify-between text-xs text-zinc-400">Music enabled<input type="checkbox" checked={clip.edit.music.enabled} onChange={e => save({ music:{...clip.edit.music!,enabled:e.target.checked} })} /></label>
        <label className="block text-xs text-zinc-400">Music volume <span className="float-right">{Math.round(clip.edit.music.volume*100)}%</span><input aria-label="Music volume" type="range" className="mt-3 w-full" min={0} max={100} value={clip.edit.music.volume*100} onChange={e => save({music:{...clip.edit.music!,volume:Number(e.target.value)/100}})} /></label>
        {number('Start in music file (seconds)',clip.edit.music.offset,offset=>save({music:{...clip.edit.music!,offset}}),0,clip.edit.music.duration ? Math.max(0,clip.edit.music.duration-.1) : 86400)}
        <p className="text-[11px] text-zinc-500">The soundtrack loops to fill the edited clip. Imported audio is copied into local app storage.</p>
        <button className="text-xs text-red-300" onClick={() => save({music:undefined})}>Remove music</button>
      </div>}
    </>}
    {mode === 'effects' && <>{(['videoIn','videoOut','audioIn','audioOut'] as const).map(key => <div key={key}>{number(({videoIn:'Picture fade in',videoOut:'Picture fade out',audioIn:'Audio fade in',audioOut:'Audio fade out'})[key]+' (seconds)',clip.edit.fades?.[key] ?? 0,n => save({fades:{...clip.edit.fades,[key]:n}}),0,10)}</div>)}<p className="text-[11px] text-zinc-500">Set 0 for a hard cut. Audio fades apply to both voice and music. Long fades are limited to half the edited clip.</p></>}
    {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
  </div>
}
