// Thin-stroke inline icons; decorative unless a label is given.
const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth={1.3} {...base} aria-hidden="true">
    <path d="M3 11.5 21 4l-7.5 18-2.6-7.9L3 11.5Z" />
    <path d="m10.9 14.1 4.6-4.6" />
  </svg>
)
// Decorative flight path for the night-sky headers (.sky in styles.css): a dashed route, a contrail that
// travels along it, and the logo plane landing at the end.
const ROUTE = 'M8 212C120 200 196 120 300 112S470 40 552 22'
export const FlightPath = () => (
  <svg className="flight" viewBox="0 0 560 230" fill="none" aria-hidden="true" focusable="false">
    <path d={ROUTE} stroke="rgba(255,255,255,0.28)" strokeWidth="1.2" strokeDasharray="2 7" strokeLinecap="round" />
    <path className="contrail" d={ROUTE} pathLength={100} stroke="url(#contrail)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="8" cy="212" r="4" fill="#0f1326" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" />
    <g transform="translate(540 8) rotate(8)" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 21 4l-7.5 18-2.6-7.9L3 11.5Z" fill="rgba(255,255,255,0.12)" />
      <path d="m10.9 14.1 4.6-4.6" />
    </g>
    <defs>
      <linearGradient id="contrail" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#f2a477" stopOpacity="0" />
        <stop offset="1" stopColor="#ffd9c2" />
      </linearGradient>
    </defs>
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
