import type { ClipEditState } from './types'
export interface HookStyle { x?: number; y?: number; scale?: number; duration?: number; preset?: 'card' | 'plain' | 'outline'; color?: string; background?: string; fontFamily?: string }
export interface ClipFades { videoIn?: number; videoOut?: number; audioIn?: number; audioOut?: number }
export const bounded = (n: number | undefined, fallback: number, min: number, max: number): number => Number.isFinite(n) ? Math.max(min, Math.min(max, n!)) : fallback
export function hookStyle(edit: ClipEditState): Required<HookStyle> {
  const h = edit.hookStyle ?? {}
  return { x: bounded(h.x, .5, -1, 2), y: bounded(h.y, .12, -1, 2), scale: bounded(h.scale, 1, .4, 3), duration: bounded(h.duration, 4, .1, 60),
    preset: h.preset ?? 'card', color: /^#[0-9a-f]{6}$/i.test(h.color ?? '') ? h.color! : '#ffffff', background: /^#[0-9a-f]{6}$/i.test(h.background ?? '') ? h.background! : '#151923', fontFamily: h.fontFamily || 'Arial' }
}
export function fadeDuration(value: number | undefined, duration: number): number { return bounded(value, 0, 0, duration / 2) }
export function fadeOpacity(time: number, duration: number, fadeIn?: number, fadeOut?: number): number {
  const start = fadeDuration(fadeIn, duration), end = fadeDuration(fadeOut, duration)
  return Math.max(0, Math.min(1, start ? time / start : 1, end ? (duration - time) / end : 1))
}
