/** Scrolls an element into view, without animation when the person asks for reduced motion. */
export function reveal(id: string, block: ScrollLogicalPosition = 'start'): void {
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block })
}
