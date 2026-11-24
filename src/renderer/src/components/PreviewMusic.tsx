import { useEffect, useRef } from 'react'
import type { Clip } from '@shared/types'
import { bounded, fadeOpacity } from '@shared/editorEffects'
export default function PreviewMusic({clip,time,duration,playing}:{clip:Clip;time:number;duration:number;playing:boolean}):React.JSX.Element {
  const audio=useRef<HTMLAudioElement>(null)
  const music=clip.edit.music
  useEffect(()=>{
    const element=audio.current
    if(!element || !music?.enabled) return
    let alive=true
    const sync=():void=>{
      if(!alive || !Number.isFinite(element.duration)) return
      const offset=bounded(music.offset,0,0,86400)%element.duration
      const target=(offset+time)%element.duration
      if(Math.abs(element.currentTime-target)>.2) element.currentTime=target
      element.volume=bounded(music.volume,.2,0,1)*fadeOpacity(time,duration,clip.edit.fades?.audioIn,clip.edit.fades?.audioOut)
      if(playing) void element.play().catch(()=>undefined)
      else element.pause()
    }
    sync(); element.addEventListener('loadedmetadata',sync)
    return()=>{alive=false; element.removeEventListener('loadedmetadata',sync)}
  },[music,time,duration,playing,clip.edit.fades])
  return <audio ref={audio} src={music?.enabled ? window.cutawan.mediaUrl(music.path):undefined} loop preload="metadata" />
}
