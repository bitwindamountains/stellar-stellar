import type { CSSProperties } from 'react'

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
// Platform marks etched into the asteroids, drawn in the same thin stroke as the other icons.
const MARKS = {
  fb: <path d="M14.5 6.5H13a2.5 2.5 0 0 0-2.5 2.5v11M7.5 12.5h6" />,
  ig: <><rect x="5" y="5" width="14" height="14" rx="4" /><circle cx="12" cy="12" r="3.2" /><path d="M16.3 7.7h.01" /></>,
  yt: <><rect x="3" y="6.5" width="18" height="11" rx="3.5" /><path d="m10.5 9.6 4 2.4-4 2.4Z" /></>,
  tt: <path d="M13 5v9.5a3 3 0 1 1-3-3M13 5c.5 2 2 3.3 4 3.5" />,
}
// size px, top of its lane, seconds per crossing, start offset (negative: already mid-flight on load),
// vertical drift and wobble over one crossing (small, so the marks stay readable).
const ROCKS = [
  { mark: 'fb', size: 58, top: '12%', dur: 38, delay: -6, dy: '40px', spin: '-28deg' },
  { mark: 'yt', size: 68, top: '40%', dur: 54, delay: -22, dy: '46px', spin: '22deg' },
  { mark: 'ig', size: 48, top: '66%', dur: 46, delay: -33, dy: '-34px', spin: '30deg' },
  { mark: 'tt', size: 42, top: '82%', dur: 42, delay: -12, dy: '-20px', spin: '-20deg' },
] as const
const ROCK = 'M33 4c9 1 18 6 22 14s5 17 1 25-11 15-21 16-19-2-24-9S3 33 5 24 14 6 22 5Z'

// Decorative asteroid belt for the night-sky scenes: one rock per platform PostPilot posts to.
export const Asteroids = () => (
  <div className="belt" aria-hidden="true">
    {ROCKS.map((r) => (
      <div key={r.mark} className="lane"
        style={{ top: r.top, animationDuration: `${r.dur}s`, animationDelay: `${r.delay}s`, '--dy': r.dy } as CSSProperties}>
        <span className="rock" style={{ width: r.size, height: r.size, animationDuration: `${r.dur}s`, animationDelay: `${r.delay}s`, '--spin': r.spin } as CSSProperties}>
          <svg viewBox="0 0 64 64" width="100%" height="100%">
            <defs>
              <radialGradient id="rock-fill" cx="0.32" cy="0.28" r="0.85">
                <stop offset="0" stopColor="#737dbd" />
                <stop offset="0.55" stopColor="#363e74" />
                <stop offset="1" stopColor="#171c38" />
              </radialGradient>
            </defs>
            <path d={ROCK} fill="url(#rock-fill)" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
            <circle cx="47" cy="44" r="3.5" fill="rgba(8,10,24,0.35)" />
            <circle cx="16" cy="40" r="2.2" fill="rgba(8,10,24,0.3)" />
            <g transform="translate(16 16) scale(1.33)" {...base} stroke="#fff" strokeWidth={1.7}>
              {MARKS[r.mark]}
            </g>
          </svg>
        </span>
      </div>
    ))}
  </div>
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
