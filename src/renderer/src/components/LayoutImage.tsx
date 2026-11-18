import { useEffect, useRef } from 'react'
import type { Composition } from '@shared/types'
import { compositionPixels } from '@shared/composition'

/** Draw the same source frame and fitted geometry as the main player/export. */
export default function LayoutImage({ composition, blur }: { composition: Composition; blur: boolean }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let frame = 0, last = 0
    const paint = (now: number): void => {
      const video = document.querySelector<HTMLVideoElement>('video[data-preview-source]')
      const context = ref.current?.getContext('2d')
      if (context && video && video.readyState >= 2 && now - last >= 33) {
        last = now
        context.setTransform(352 / 1080, 0, 0, 626 / 1920, 0, 0)
        context.fillStyle = '#000'
        context.fillRect(0, 0, 1080, 1920)
        if (blur) {
          const scale = Math.max(1080 / video.videoWidth, 1920 / video.videoHeight)
          const w = video.videoWidth * scale, h = video.videoHeight * scale
          context.filter = 'blur(24px) brightness(0.88)'
          context.drawImage(video, (1080 - w) / 2, (1920 - h) / 2, w, h)
          context.filter = 'none'
        }
        for (const { source: s, target: t } of compositionPixels(composition,
          { width: video.videoWidth, height: video.videoHeight }, 1080, 1920)) {
          context.drawImage(video, s.x, s.y, s.width, s.height, t.x, t.y, t.width, t.height)
        }
      }
      frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame)
  }, [composition, blur])
  return <canvas ref={ref} width={352} height={626} className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Actual fitted layout preview" />
}
