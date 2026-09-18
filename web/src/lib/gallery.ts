/** Rounding rather than flooring, so a scroll stopped a pixel short of a snap point still reports the frame the reader is looking at. */
export function frameAtScroll(scrollLeft: number, frameWidth: number, count: number): number {
  if (frameWidth <= 0 || count <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.round(scrollLeft / frameWidth)))
}
