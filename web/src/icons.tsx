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
// Faceted silhouettes so no two rocks look alike.
const SHAPES = [
  'M30 5l13 3 10 9 6 13-2 13-8 10-13 6-14-1-11-7-6-12 1-14 7-11Z',
  'M34 4c8 0 15 5 20 11s7 15 4 23-8 15-17 18-19 1-26-5S3 37 5 27s8-17 15-21 9-2 14-2Z',
  'M27 6l15-1 11 8 5 11-1 9 4 9-6 11-14 6-12-2-12-7-8-11 2-13 6-12Z',
  'M32 6c10-1 20 6 23 15 2 7-1 11 1 17s-3 14-11 17-17 4-24 0S7 45 6 36s0-17 6-23 12-7 20-7Z',
]
// Near rocks are big and fast, far debris small, slow and soft: parallax without any scroll handling.
// size px, lane top, seconds per crossing, start offset (negative: already mid-flight), vertical drift,
// wobble (small, so marks stay readable), and a faint platform tint on the lit edge.
const ROCKS = [
  { id: 'fb', mark: 'fb', shape: 0, size: 62, top: '10%', dur: 34, delay: -5, dy: '40px', spin: '-24deg', tint: '#7f9cf0' },
  { id: 'yt', mark: 'yt', shape: 1, size: 72, top: '42%', dur: 40, delay: -21, dy: '46px', spin: '18deg', tint: '#ee8a7e' },
  { id: 'ig', mark: 'ig', shape: 2, size: 50, top: '64%', dur: 48, delay: -34, dy: '-34px', spin: '26deg', tint: '#ee9cbb' },
  { id: 'tt', mark: 'tt', shape: 3, size: 44, top: '80%', dur: 52, delay: -12, dy: '-20px', spin: '-18deg', tint: '#7fdde2' },
  { id: 'd1', mark: null, shape: 2, size: 16, top: '24%', dur: 80, delay: -50, dy: '12px', spin: '90deg', tint: '' },
  { id: 'd2', mark: null, shape: 0, size: 11, top: '56%', dur: 92, delay: -20, dy: '-10px', spin: '-120deg', tint: '' },
  { id: 'd3', mark: null, shape: 3, size: 14, top: '88%', dur: 74, delay: -64, dy: '8px', spin: '140deg', tint: '' },
] as const

// Decorative asteroid belt for the night-sky scenes: one rock per platform PostPilot posts to, some far
// debris, and the odd shooting star. Gradients are defined once and shared by every rock.
export const Asteroids = () => (
  <div className="belt" aria-hidden="true">
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <radialGradient id="rock-lit" cx="0.3" cy="0.26" r="0.9">
          <stop offset="0" stopColor="#8a93cc" />
          <stop offset="0.45" stopColor="#3c447c" />
          <stop offset="1" stopColor="#151a34" />
        </radialGradient>
        <linearGradient id="rock-shade" x1="0.2" y1="0.15" x2="0.85" y2="0.95">
          <stop offset="0.45" stopColor="#05070f" stopOpacity="0" />
          <stop offset="1" stopColor="#05070f" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="rock-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
    {ROCKS.map((r) => (
      <div key={r.id} className={r.mark ? 'lane' : 'lane far'}
        style={{ top: r.top, animationDuration: `${r.dur}s`, animationDelay: `${r.delay}s`, '--dy': r.dy } as CSSProperties}>
        <span className="rock"
          style={{ width: r.size, height: r.size, animationDuration: `${r.dur}s`, animationDelay: `${r.delay}s`, '--spin': r.spin, '--tint': r.tint || 'transparent' } as CSSProperties}>
          <svg viewBox="0 0 64 64" width="100%" height="100%">
            <path d={SHAPES[r.shape]} fill="url(#rock-lit)" />
            <path d={SHAPES[r.shape]} fill="url(#rock-shade)" />
            <ellipse cx="46" cy="45" rx="4.5" ry="3.6" fill="rgba(6,8,20,0.45)" />
            <path d="M42.5 47.2a4.5 3.6 0 0 0 7.6-.6" stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" fill="none" />
            <ellipse cx="17" cy="42" rx="2.6" ry="2" fill="rgba(6,8,20,0.4)" />
            <ellipse cx="40" cy="15" rx="1.8" ry="1.4" fill="rgba(6,8,20,0.3)" />
            <path d={SHAPES[r.shape]} fill="none" stroke="url(#rock-rim)" strokeWidth="1.2" />
            {r.mark && (
              <g transform="translate(16 16) scale(1.33)" {...base}>
                {/* etched: a dark groove offset under a light stroke */}
                <g stroke="rgba(5,7,18,0.7)" strokeWidth={2.2} transform="translate(0.7 0.7)">{MARKS[r.mark]}</g>
                <g stroke="#fff" strokeWidth={1.6}>{MARKS[r.mark]}</g>
              </g>
            )}
          </svg>
        </span>
      </div>
    ))}
    <span className="meteor" style={{ top: '8%', left: '58%', animationDelay: '-3s' } as CSSProperties} />
    <span className="meteor" style={{ top: '34%', left: '84%', animationDelay: '-9.5s', animationDuration: '13s' } as CSSProperties} />
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
