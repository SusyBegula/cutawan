import type { ContentRegion } from './types'
export type PanelCorner = 'nw' | 'ne' | 'sw' | 'se'
/** Normalised movement/resizing, with a fixed opposite corner and 2% minimum. */
export function dragPanel(rect: ContentRegion, dx: number, dy: number, corner?: PanelCorner, overflow = false): ContentRegion {
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
  if (overflow) {
    if (!corner) return { ...rect, x: clamp(rect.x + dx, -1, 2), y: clamp(rect.y + dy, -1, 2) }
    const width = clamp(rect.width + (corner.includes('w') ? -dx : dx), .02, 2)
    const height = clamp(rect.height + (corner.includes('n') ? -dy : dy), .02, 2)
    return { x: corner.includes('w') ? clamp(rect.x + rect.width - width, -1, 2) : rect.x,
      y: corner.includes('n') ? clamp(rect.y + rect.height - height, -1, 2) : rect.y, width, height }
  }
  if (!corner) return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.width), y: clamp(rect.y + dy, 0, 1 - rect.height) }
  let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height
  if (corner.includes('w')) left = clamp(left + dx, 0, right - .02)
  else right = clamp(right + dx, left + .02, 1)
  if (corner.includes('n')) top = clamp(top + dy, 0, bottom - .02)
  else bottom = clamp(bottom + dy, top + .02, 1)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
