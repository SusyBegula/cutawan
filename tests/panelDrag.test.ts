import { expect, it } from 'vitest'
import { dragPanel } from '@shared/panelDrag'
const rect = { x: .2, y: .2, width: .5, height: .4 }
it('allows manual panels to move and resize beyond the frame', () => {
  expect(dragPanel(rect, -.4, -.3, undefined, true).x).toBeCloseTo(-.2)
  const resized = dragPanel(rect, -.4, -.3, 'nw', true)
  expect(resized.x).toBeCloseTo(-.2)
  expect(resized.y).toBeCloseTo(-.1)
  expect(resized.width).toBeCloseTo(.9)
  expect(resized.height).toBeCloseTo(.7)
})
it('moves without changing size and clamps to the output frame', () => {
  expect(dragPanel(rect, 2, -2)).toEqual({ ...rect, x: .5, y: 0 })
})
it.each(['nw', 'ne', 'sw', 'se'] as const)('resizes from %s while retaining the opposite corner', corner => {
  const resized = dragPanel(rect, .1, .1, corner)
  if (corner.includes('w')) expect(resized.x + resized.width).toBeCloseTo(.7)
  else expect(resized.x).toBe(.2)
  if (corner.includes('n')) expect(resized.y + resized.height).toBeCloseTo(.6)
  else expect(resized.y).toBe(.2)
})
it('prevents inverted rectangles and confines extreme resizing to the frame', () => {
  const small = dragPanel(rect, 3, 3, 'nw')
  expect(small.width).toBeCloseTo(.02)
  expect(small.height).toBeCloseTo(.02)
  const full = dragPanel(rect, 3, 3, 'se')
  expect(full.x + full.width).toBe(1)
  expect(full.y + full.height).toBe(1)
})
