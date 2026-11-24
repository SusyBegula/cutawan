import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { buildAss } from '../src/main/pipeline/captions'
import { makeTranscript } from './helpers'
import type { Clip } from '@shared/types'
import { fadeOpacity } from '@shared/editorEffects'
import { runFfmpeg, probeVideo } from '../src/main/pipeline/ffmpeg'
import { renderClip } from '../src/main/pipeline/render'

it('exports independent hook styling and placement without caption events',()=>{
  const ass=buildAss(makeTranscript([]),{styleId:'beast',width:1080,height:1920,clipStart:0,clipEnd:10,title:'Custom hook',hook:{x:.3,y:.4,scale:1.5,duration:6,fontFamily:'Arial',preset:'plain',color:'#ff0000'}})
  expect(ass).toContain('Style: Title,Arial,')
  expect(ass).toContain('\\pos(324,768)')
  expect(ass).toContain('0:00:06.00,Title')
  expect(ass).not.toContain('Dialogue: 0,')
})
it('clamps overlapping fades and matches the preview envelope',()=>{
  expect(fadeOpacity(0,4,1,1)).toBe(0)
  expect(fadeOpacity(.5,4,1,1)).toBe(.5)
  expect(fadeOpacity(2,4,50,50)).toBe(1)
  expect(fadeOpacity(4,4,1,1)).toBe(0)
})
it('adds looping music to silent footage, burns independent hook text, and fades the final picture and audio',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cutawan-creative-'))
  try {
    const path=join(dir,'source.mp4'),music=join(dir,'music.wav'),out=join(dir,'export.mp4')
    await runFfmpeg(['-f','lavfi','-i','color=blue:size=320x180:rate=10:duration=3','-c:v','mpeg4',path])
    await runFfmpeg(['-f','lavfi','-i','sine=frequency=440:duration=1',music])
    const source=await probeVideo(path),clip: Clip={id:'creative',title:'Hook',hook:'Hello world',broll:[],focusTrack:null,suggestedStart:0,suggestedEnd:3,summary:'',viralityScore:0,viralityReason:'',visualSummary:null,hashtags:[],thumbnailPath:null,edit:{start:0,end:3,aspect:'original',reframeMode:'fit-letterbox',framing:'manual',focusX:.5,captionStyleId:'beast',captionsEnabled:false,showTitle:true,tightenCuts:false}}
    clip.edit={...clip.edit,aspect:'original',captionsEnabled:false,showTitle:true,autoZoom:false,tightenCuts:false,hookStyle:{x:.5,y:.3,preset:'plain'},music:{path:music,name:'Test',enabled:true,volume:.2,offset:.1},fades:{videoIn:.5,videoOut:.5,audioIn:.5,audioOut:.5}}
    await renderClip({clip,source,transcript:null,outputPath:out,encoder:'cpu',quality:'draft'})
    expect((await probeVideo(out)).hasAudio).toBe(true)
    const raw=join(dir,'frame.rgb')
    await runFfmpeg(['-i',out,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',raw])
    expect(Math.max(...(await readFile(raw)).subarray(0,300))).toBeLessThan(15)
  } finally {await rm(dir,{recursive:true,force:true})}
},20000)
