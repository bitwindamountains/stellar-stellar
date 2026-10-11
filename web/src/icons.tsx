// Thin-stroke inline icons; decorative unless a label is given.
const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth={1.3} {...base} aria-hidden="true">
    <path d="M3 11.5 21 4l-7.5 18-2.6-7.9L3 11.5Z" />
    <path d="m10.9 14.1 4.6-4.6" />
  </svg>
)
export const Plus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth={1.6} {...base} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
export const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth={1.6} {...base} aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
export const Check = ({ label }: { label?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth={1.6} {...base}
    {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} style={{ flex: 'none' }}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
export const Alert = ({ label }: { label?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth={1.6} {...base}
    {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} style={{ flex: 'none' }}>
    <path d="M12 8v5M12 16.5v.5" />
    <circle cx="12" cy="12" r="9" />
  </svg>
)
